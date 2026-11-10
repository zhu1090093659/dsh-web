import { describe, expect, it } from 'vitest'
import { CAP_USAGE, MINOR, SERVED_CAPABILITIES } from '../src/core/protocol.ts'
import { BALANCE_CACHE_TTL_MS, UsageService, type UsageFaces, type FetchFace } from '../src/core/usage.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** 一套宿主服务：活会话名单 + 宿主名册 + 凭据 + 设置，缺的就不给。 */
interface HostServices {
  readonly live?: readonly string[]
  /** 宿主名册里的会话 id；省略就是这台宿主给不出名册。 */
  readonly roster?: readonly string[]
  readonly credentials?: UsageFaces['credentials']
  readonly settings?: UsageFaces['settings']
  /** 会话此刻的路由；省略就是这台宿主给不出这一档。 */
  readonly route?: UsageFaces['route']
}

/** 一份用量服务，时钟与上游都由套件自己拿着。 */
function usageOver(services: HostServices, clock: { now: number }, fetch: FetchFace, log: (message: string) => void = () => {}): UsageService {
  const live = services.live ?? []
  return new UsageService({
    faces: () => ({
      ...(services.live === undefined ? {} : { sessions: { get: id => (live.includes(id) ? { id } : undefined) } }),
      ...(services.roster === undefined ? {} : { roster: { ids: async () => services.roster } }),
      ...(services.credentials === undefined ? {} : { credentials: services.credentials }),
      ...(services.settings === undefined ? {} : { settings: services.settings }),
      ...(services.route === undefined ? {} : { route: services.route }),
    }),
    now: () => clock.now,
    log,
    fetch,
  })
}

/** 一个记录上游调用的 fetch 替身：脚本说答什么，它答什么。 */
function upstreamOf(answer: { readonly status: number; readonly body: unknown } | 'timeout'): { readonly fetch: FetchFace; readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url, _init) => {
      calls.push(url)
      if (answer === 'timeout') throw new Error('The operation was aborted due to timeout')
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      }
    },
  }
}

/**
 * 一个按 URL 应答模型目录的 fetch 替身：记下每次请求的地址与请求头。
 *
 * 目录那一档与余额那一档打的是不同主机，各自要断言的也不一样，所以这个替身只
 * 服务 `/models`：读了几次、带没带凭据、打没打到对的 origin，都由调用方检查。
 */
function catalogOf(answer: { readonly status: number; readonly body: unknown }): {
  readonly fetch: FetchFace
  readonly calls: { readonly url: string; readonly headers: Record<string, string> }[]
} {
  const calls: { url: string; headers: Record<string, string> }[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, headers: init?.headers ?? {} })
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      }
    },
  }
}

/** 一条官方 `/user/balance` 的应答体：金额按字符串给，元口径。 */
const OFFICIAL_BALANCE = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
}

/** 官方路由那一档的凭据：环境变量引用解析出一把 API key。 */
const OFFICIAL_CREDENTIALS = {
  readRecord: async () => undefined,
  resolve: async (ref: string) => (ref === 'DEEPSEEK_API_KEY' ? { value: 'sk-official' } : undefined),
}

/** 官方适配器的设置段：没配 `apiKeyEnv` 时读 `DEEPSEEK_API_KEY`。 */
const OFFICIAL_SETTINGS = {
  get: (ns: string): unknown => (ns === 'llm-deepseek' ? { apiKeyEnv: 'DEEPSEEK_API_KEY' } : undefined),
}

/** 一次握手：宣告给定的能力。 */
async function greet(harness: ConnectionHarness, cap: readonly string[]): Promise<void> {
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...cap] }))
}

describe('usage channel over protocol v1', () => {
  it('user greeting the bridge is told the usage channel is served here with the minor that carries it', async () => {
    // Given a bridge that serves the usage channel
    const harness = makeConnection({ paired: true })
    // When the user greets it
    await greet(harness, [CAP_USAGE])
    // Then the announcement names the capability beside every other served one,
    // and the minor is the one that carries the two new reply bodies
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.capabilities).toEqual([...SERVED_CAPABILITIES])
    expect(hello.capabilities).toContain(CAP_USAGE)
    expect(hello.minor).toBe(MINOR)
    expect(MINOR).toBe(22)
  })

  it('user that declared no capability is told neither usage method exists and every other method still answers', async () => {
    // Given a paired client written before the usage channel existed
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [] })
    await greet(harness, [])
    // When it calls one usage method and one method it always had
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-1' }))
    await harness.connection.handleText(requestFrame(3, 'usage.balance', { provider: 'deepseek-official' }))
    await harness.connection.handleText(requestFrame(4, 'session.list'))
    // Then both usage methods are unknown to it, and the roster is untouched
    expect(answerOf(harness, 2).e).toEqual({ code: 'unknown-method', msg: 'unknown method usage.session' })
    expect(answerOf(harness, 3).e).toEqual({ code: 'unknown-method', msg: 'unknown method usage.balance' })
    expect(answerOf(harness, 4).r).toEqual({ mode: 'reset', token: '', sessions: [] })
  })

  it('user reading a session that broadcast its window and its request reads both the host value and the estimate', async () => {
    // Given a live session whose host broadcast a window, a header with one tool,
    // a system prompt and two messages
    const clock = { now: 1_700_000_000_000 }
    const usage = usageOver({ live: ['s-1'] }, clock, upstreamOf({ status: 200, body: OFFICIAL_BALANCE }).fetch)
    usage.record('s-1', { type: 'request/context', data: { provider: 'deepseek-official', model: 'deepseek-chat', contextWindow: 131072 } })
    usage.record('s-1', { type: 'request/header', data: { header: { tools: [{ name: 'bash' }] } } })
    usage.record('s-1', { type: 'system/message', data: { message: { content: [{ type: 'text', text: 'You are the bridge.' }] } } })
    usage.record('s-1', { type: 'user/message', data: { content: [{ type: 'text', text: 'ping' }] } })
    usage.record('s-1', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'pong' }] } } })
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks what that session's next request is made of
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-1' }))
    // Then the window is the host's own reading and every component is the UTF-8
    // byte length divided by four, each one floored and marked as an estimate
    expect(answerOf(harness, 2).r).toEqual({
      contextWindow: 131072,
      composition: { system: 4, tools: 4, messages: 2, estimated: true },
    })
  })

  it('user reading a session the host never broadcast a window for reads the composition alone', async () => {
    // Given a session whose only broadcast events are a tool-less header and a message
    const clock = { now: 1_700_000_000_000 }
    const usage = usageOver({ live: ['s-1'] }, clock, upstreamOf({ status: 200, body: OFFICIAL_BALANCE }).fetch)
    usage.record('s-1', { type: 'request/header', data: { header: {} } })
    usage.record('s-1', { type: 'user/message', data: { content: [{ type: 'text', text: 'ping' }] } })
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks about it
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-1' }))
    // Then there is no window key at all, and the tool-less header is a real zero
    // for its own component rather than a missing one
    expect(answerOf(harness, 2).r).toEqual({
      composition: { system: 0, tools: 0, messages: 1, estimated: true },
    })
  })

  it('user reading a live session that broadcast nothing is answered an empty object rather than zeros', async () => {
    // Given a live session nothing was ever observed for
    const clock = { now: 1_700_000_000_000 }
    const usage = usageOver({ live: ['s-1'] }, clock, upstreamOf({ status: 200, body: OFFICIAL_BALANCE }).fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks about it
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-1' }))
    // Then the answer says "nothing is known", not "nothing is there"
    expect(answerOf(harness, 2).r).toEqual({})
  })

  it('user reading a session the host roster names but this process never observed is answered an empty object', async () => {
    // Given a session the host's own roster knows while it is neither live nor observed
    const clock = { now: 1_700_000_000_000 }
    const usage = usageOver({ live: ['s-1'], roster: ['s-1', 's-cold'] }, clock, upstreamOf({ status: 200, body: OFFICIAL_BALANCE }).fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user reads it after the bridge was reloaded
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-cold' }))
    // Then it is a session this host has with no reading yet, not a session this
    // host never had, and nothing was invented for the two missing readings
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: {} })
    expect(Object.keys(answerOf(harness, 2).r as Record<string, unknown>)).toEqual([])
  })

  it('user reading a session this host never had is refused as an unknown session', async () => {
    // Given a bridge whose roster, live store and event fold all know no such session
    const clock = { now: 1_700_000_000_000 }
    const usage = usageOver({ live: ['s-1'], roster: ['s-1'] }, clock, upstreamOf({ status: 200, body: OFFICIAL_BALANCE }).fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks about a session id nothing ever named
    await harness.connection.handleText(requestFrame(2, 'usage.session', { sessionId: 's-404' }))
    // Then the bridge says the session does not exist instead of answering {} or
    // a composition of zeros
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unknown-session', msg: 'session s-404 does not exist on this host' } })
  })

  it('user reading the balance of the official route is answered the four amounts in yuan', async () => {
    // Given a deepseek route with no baseURL of its own and a resolvable API key
    const clock = { now: 1_700_000_000_000 }
    const upstream = upstreamOf({ status: 200, body: OFFICIAL_BALANCE })
    const usage = usageOver({ credentials: OFFICIAL_CREDENTIALS, settings: OFFICIAL_SETTINGS }, clock, upstream.fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks for that route's balance
    await harness.connection.handleText(requestFrame(2, 'usage.balance', { provider: 'deepseek-official' }))
    // Then the money crosses as numbers in the currency the endpoint reported,
    // stamped with this host's clock, and one upstream call was made
    expect(answerOf(harness, 2).r).toEqual({
      provider: 'deepseek-official',
      currency: 'CNY',
      total: 110,
      toppedUp: 100,
      granted: 10,
      updatedAt: clock.now,
    })
    expect(upstream.calls).toEqual(['https://api.deepseek.com/user/balance'])
  })

  it('user reading the balance of a route pointed at another origin is told it is no deepseek route', async () => {
    // Given a profile that reuses the deepseek id for a reseller endpoint
    const clock = { now: 1_700_000_000_000 }
    const upstream = upstreamOf({ status: 200, body: OFFICIAL_BALANCE })
    const usage = usageOver({
      credentials: OFFICIAL_CREDENTIALS,
      settings: { get: (ns: string): unknown => (ns === 'llm-pi-ai' ? { providers: { 'deepseek-official': { baseURL: 'https://dashscope.aliyuncs.com/v1' } } } : undefined) },
    }, clock, upstream.fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks for that route's balance
    await harness.connection.handleText(requestFrame(2, 'usage.balance', { provider: 'deepseek-official' }))
    // Then the bridge refuses to print the official account's money under it, and
    // no upstream call was made at all
    expect(answerOf(harness, 2).r).toEqual({ provider: 'deepseek-official', unsupported: 'not-deepseek-route' })
    expect(upstream.calls).toEqual([])
  })

  it('user reading the balance of a route with no credential at all is told so without an upstream call', async () => {
    // Given a deepseek route whose credential record and env reference both read empty
    const clock = { now: 1_700_000_000_000 }
    const upstream = upstreamOf({ status: 200, body: OFFICIAL_BALANCE })
    const usage = usageOver({
      credentials: { readRecord: async () => undefined, resolve: async () => undefined },
    }, clock, upstream.fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks for that route's balance
    await harness.connection.handleText(requestFrame(2, 'usage.balance', { provider: 'deepseek-official' }))
    // Then nothing was probed and the answer names the missing credential
    expect(answerOf(harness, 2).r).toEqual({ provider: 'deepseek-official', unsupported: 'no-credential' })
    expect(upstream.calls).toEqual([])
  })

  it('user reading the balance when the official endpoint answers 401 is told the probe failed', async () => {
    // Given an official route whose key the endpoint rejects
    const clock = { now: 1_700_000_000_000 }
    const upstream = upstreamOf({ status: 401, body: { error: { message: 'Authentication Fails' } } })
    const usage = usageOver({ credentials: OFFICIAL_CREDENTIALS, settings: OFFICIAL_SETTINGS }, clock, upstream.fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    // When the user asks for that route's balance
    await harness.connection.handleText(requestFrame(2, 'usage.balance', { provider: 'deepseek-official' }))
    // Then the refusal is named as a failed probe with its short reason, and no
    // amount is invented for a reading that never happened
    expect(answerOf(harness, 2).r).toEqual({ provider: 'deepseek-official', unsupported: 'probe-failed', reason: 'HTTP 401' })
    expect(upstream.calls).toHaveLength(1)
  })

  it('user reading the same balance twice inside a minute causes one upstream call, and a later read a second', async () => {
    // Given an official route that probed once already
    const clock = { now: 1_700_000_000_000 }
    const upstream = upstreamOf({ status: 200, body: OFFICIAL_BALANCE })
    const usage = usageOver({ credentials: OFFICIAL_CREDENTIALS, settings: OFFICIAL_SETTINGS }, clock, upstream.fetch)
    const harness = makeConnection({ paired: true, usage })
    await greet(harness, [CAP_USAGE])
    await harness.connection.handleText(requestFrame(2, 'usage.balance', { provider: 'deepseek-official' }))
    // When two more phones ask inside the window, at the same instant
    const [first, second] = await Promise.all([
      usage.balance('deepseek-official'),
      usage.balance('deepseek-official'),
    ])
    // Then the window served both from one reading and the single flight merged
    // the two concurrent calls into no new upstream request at all
    expect(upstream.calls).toHaveLength(1)
    expect(first).toEqual(second)
    // When the window has passed
    clock.now += BALANCE_CACHE_TTL_MS
    const later = await usage.balance('deepseek-official')
    // Then a fresh reading is asked for and the answer carries a new timestamp
    expect(upstream.calls).toHaveLength(2)
    expect(later).toEqual({
      provider: 'deepseek-official',
      currency: 'CNY',
      total: 110,
      toppedUp: 100,
      granted: 10,
      updatedAt: clock.now,
    })
  })

  it('user reading a session the host broadcast a window for is never offered a model declaration', async () => {
    // Given a session whose host broadcast the real window, on a route whose
    // catalog declares a different one
    const clock = { now: 1_700_000_000_000 }
    const catalog = catalogOf({ status: 200, body: { data: [{ id: 'deepseek-chat', context_length: 65_536 }] } })
    const usage = usageOver({
      live: ['s-1'],
      credentials: OFFICIAL_CREDENTIALS,
      settings: OFFICIAL_SETTINGS,
      route: { current: async () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
    }, clock, catalog.fetch)
    usage.record('s-1', { type: 'request/context', data: { contextWindow: 131_072 } })
    // When the user asks about it
    const answer = await usage.session('s-1')
    // Then only the host's own reading is there: the two numbers are never mixed,
    // and the catalog was not even read
    expect(answer).toEqual({ contextWindow: 131_072 })
    expect(catalog.calls).toEqual([])
  })

  it('user reading a session the host never broadcast a window for is offered the catalog window', async () => {
    // Given a session with no host window, on the official route, whose catalog
    // declares both a context length and a max input size for that model
    const clock = { now: 1_700_000_000_000 }
    const catalog = catalogOf({
      status: 200,
      body: { data: [{ id: 'deepseek-chat', context_length: 65_536, max_input_tokens: 999 }, { id: 'other', context_window: 1_024 }] },
    })
    const usage = usageOver({
      live: ['s-1'],
      credentials: OFFICIAL_CREDENTIALS,
      settings: OFFICIAL_SETTINGS,
      route: { current: async () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
    }, clock, catalog.fetch)
    // When the user asks about it
    const answer = await usage.session('s-1')
    // Then the declaration crosses under its own key, first field name first, and
    // the request went to that route's own catalog with that route's credential
    expect(answer).toEqual({ modelContextWindow: 65_536 })
    expect(catalog.calls).toEqual([{
      url: 'https://api.deepseek.com/models',
      headers: { accept: 'application/json', authorization: 'Bearer sk-official' },
    }])
  })

  it('user reading two sessions of one route inside the window causes one catalog read', async () => {
    // Given two live sessions on the same route, neither with a host window
    const clock = { now: 1_700_000_000_000 }
    const catalog = catalogOf({ status: 200, body: { data: [{ id: 'deepseek-chat', context_length: 65_536 }] } })
    const usage = usageOver({
      live: ['s-1', 's-2'],
      credentials: OFFICIAL_CREDENTIALS,
      settings: OFFICIAL_SETTINGS,
      route: { current: async () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
    }, clock, catalog.fetch)
    // When both are read
    const [first, second] = await Promise.all([usage.session('s-1'), usage.session('s-2')])
    // Then one catalog read served both, because the declaration is a fact about
    // the route rather than about either session
    expect(first).toEqual({ modelContextWindow: 65_536 })
    expect(second).toEqual({ modelContextWindow: 65_536 })
    expect(catalog.calls).toHaveLength(1)
  })

  it('user reading a session whose route has no readable catalog is answered without that key', async () => {
    // Given a route whose catalog answers an error
    const clock = { now: 1_700_000_000_000 }
    const failing = catalogOf({ status: 500, body: { error: 'boom' } })
    const unavailable = usageOver({
      live: ['s-1'],
      credentials: OFFICIAL_CREDENTIALS,
      settings: OFFICIAL_SETTINGS,
      route: { current: async () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
    }, clock, failing.fetch)
    // When the user asks about it
    // Then the key is absent rather than invented, and the read was attempted once
    expect(await unavailable.session('s-1')).toEqual({})
    expect(failing.calls).toHaveLength(1)
    // And a catalog that does not list this model is the same absence, not a fallback
    const silent = catalogOf({ status: 200, body: { data: [{ id: 'another-model', context_length: 4_096 }] } })
    const missing = usageOver({
      live: ['s-1'],
      credentials: OFFICIAL_CREDENTIALS,
      settings: OFFICIAL_SETTINGS,
      route: { current: async () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }) },
    }, clock, silent.fetch)
    expect(await missing.session('s-1')).toEqual({})
  })
})
