import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAnnouncement } from '../../dsh-pet/src/announce.ts'
import { createLedgerDocument, foldUsage, localDateKey } from '../src/core/ledger.ts'
import { emptyTotals } from '../src/core/types.ts'
import { buildAnnouncement, USAGE_ANNOUNCE_SOURCE, UsageService, type UsageServiceOptions } from '../src/host/usage-service.ts'

/**
 * Host-service behavior tests. The cordis Context is replaced by a minimal
 * fake: the service only ever calls ctx.on('session/event') and the
 * duck-typed service<T>(ctx, name) reads, so a plain object with on/get
 * covers every path. Provider HTTP probes run against a stubbed global
 * fetch, and DSH_HOME points at a temp dir per test.
 */

const OPTIONS: UsageServiceOptions = { pollIntervalSec: 3600, bubbleMode: 'always', retainDays: 180 }

const BALANCE_BODY = { balance_infos: [{ currency: 'CNY', total_balance: '110.00' }] }

const CREDENTIALS_ENV = {
  readRecord: async () => undefined,
  resolve: async (): Promise<{ value: string } | undefined> => ({ value: 'sk-test' }),
}

const LLM_DEEPSEEK = {
  listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
  listConfigurableProviders: () => [],
}

/** The live route id the llm-deepseek adapter registers (sessions carry it). */
const LLM_DEEPSEEK_OFFICIAL = {
  listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
  listConfigurableProviders: () => [],
}

const LLM_KIMI = {
  listProviders: () => [{ id: 'kimi-coding', name: 'Kimi For Coding' }],
  listConfigurableProviders: () => [],
}

const CREDENTIALS_KIMI_KEY = {
  readRecord: async () => ({ kind: 'api-key', key: 'sk-kimi' }),
  resolve: async () => ({ value: 'unused' }),
}

function makeCtx(services: Record<string, unknown> = {}) {
  const sessionListeners: Array<(session: object, event: unknown) => void> = []
  const ctx = {
    on: (event: string, cb: (session: object, event: unknown) => void) => {
      if (event === 'session/event') sessionListeners.push(cb)
      return () => {}
    },
    get: (name: string) => services[name],
  }
  return {
    ctx: ctx as never,
    fireSessionEvent(session: object, event: unknown): void {
      for (const cb of sessionListeners) cb(session, event)
    },
  }
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL | Request) => handler(input instanceof Request ? input.url : String(input)))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const requestHeaderEvent = (provider: string, model: string) => ({
  type: 'request/header',
  data: { header: { config: { provider, model } } },
})

const usageEvent = (inputTokens: number, outputTokens: number) => ({
  type: 'assistant/message',
  data: { usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } },
})

function makeRecorderPet() {
  const announced: Array<Record<string, unknown>> = []
  return { announced, announce: (input: Record<string, unknown>) => void announced.push(input) }
}

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-usage-service-'))
  process.env.DSH_HOME = home
})

afterEach(() => {
  delete process.env.DSH_HOME
  rmSync(home, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

function writeLedgerFile(days: Record<string, Record<string, Record<string, unknown>>>): void {
  mkdirSync(join(home, 'dsh-usage'), { recursive: true })
  writeFileSync(join(home, 'dsh-usage', 'usage-ledger.json'), JSON.stringify({ version: 1, days }), 'utf8')
}

const readLedgerFile = (): { days: Record<string, Record<string, Record<string, { inputTokens: number; calls: number }>>> } =>
  JSON.parse(readFileSync(join(home, 'dsh-usage', 'usage-ledger.json'), 'utf8'))

describe('session fold → overview', () => {
  it('folds assistant usage under the route seen in the request header', () => {
    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(session, usageEvent(100, 50))
    fireSessionEvent(session, usageEvent(10, 5))

    const overview = service.overview()
    expect(overview.current).toEqual({ provider: 'deepseek', model: 'deepseek-v4-pro', source: 'live' })
    expect(overview.usage.today.totals).toMatchObject({ inputTokens: 110, outputTokens: 55, calls: 2 })
    expect(overview.usage.today.providers[0]?.provider).toBe('deepseek')
    expect(overview.usage.days.at(-1)?.totals.calls).toBe(2)
    service.stop()
  })

  it('ignores usage reports without an attributed route', () => {
    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, usageEvent(100, 50))
    expect(service.overview().usage.today.totals.calls).toBe(0)
    service.stop()
  })
})

describe('probes and per-fact errors', () => {
  it('probes the balance and reports the snapshot on the overview', async () => {
    stubFetch((url) => url.includes('api.deepseek.com') ? jsonResponse(BALANCE_BODY) : jsonResponse({}, 404))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()

    const provider = service.overview().providers[0]
    expect(provider).toMatchObject({
      provider: 'deepseek',
      displayName: 'DeepSeek',
      credential: 'env',
      supported: true,
      balance: { currency: 'CNY', totalBalance: '110.00' },
    })
    expect(provider?.error).toBeUndefined()
    service.stop()
  })

  it('surfaces a balance failure as the view error even though the cycle completes', async () => {
    stubFetch(() => jsonResponse({ message: 'Invalid key' }, 401))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()
    expect(service.overview().providers[0]?.error).toBe('HTTP 401: Invalid key')
    service.stop()
  })

  it('keeps the previous fact on failure and clears the error only on that fact\'s own success', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()
    expect(service.overview().providers[0]?.balance).toBeDefined()

    // Balance fails: the stale balance stays visible, with the error line.
    fetchMock.mockImplementation(async () => jsonResponse({ message: 'Invalid key' }, 401))
    await service.refresh()
    let provider = service.overview().providers[0]
    expect(provider?.balance).toMatchObject({ totalBalance: '110.00' })
    expect(provider?.error).toBe('HTTP 401: Invalid key')

    // Balance recovers: its error slot clears.
    fetchMock.mockImplementation(async () => jsonResponse(BALANCE_BODY))
    await service.refresh()
    provider = service.overview().providers[0]
    expect(provider?.error).toBeUndefined()
    service.stop()
  })

  it('resets the row when the credential disappears instead of keeping stale facts', async () => {
    const credentials = { ...CREDENTIALS_ENV }
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()
    expect(service.overview().providers[0]?.balance).toBeDefined()

    credentials.resolve = async () => undefined
    await service.refresh()
    const provider = service.overview().providers[0]
    expect(provider?.credential).toBe('none')
    expect(provider?.balance).toBeUndefined()
    expect(provider?.error).toBeUndefined()
    service.stop()
  })
})

describe('pet announce linkage', () => {
  it('announces the balance and the payload passes the pet validator round-trip', async () => {
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    await service.refresh()

    expect(pet.announced).toHaveLength(1)
    expect(pet.announced[0]).toMatchObject({ source: USAGE_ANNOUNCE_SOURCE, kind: 'balance', title: 'DeepSeek', amount: '¥110.00', tone: 'ok' })
    expect(parseAnnouncement(pet.announced[0], Date.now())).toBeDefined()
    service.stop()
  })

  it('announces the live deepseek-official route as a cost bubble with the peak period and a poll-cadence ttl', async () => {
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK_OFFICIAL, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek-official', 'deepseek-v4-flash-vision-exp'))
    fireSessionEvent(session, usageEvent(1_000_000, 100_000))
    await service.refresh()

    // The session route folds with a fold-time spend estimate, and the
    // announce resolves the deepseek-official snapshot (adapter alias + env
    // fallback) instead of dying on the id mismatch.
    expect(service.overview().usage.today.totals.cost).toBeGreaterThan(0)
    expect(pet.announced).toHaveLength(1)
    const payload = pet.announced[0] as Record<string, unknown>
    expect(payload).toMatchObject({ source: USAGE_ANNOUNCE_SOURCE, kind: 'cost', title: 'DeepSeek', tone: expect.stringMatching(/ok|warn/) })
    expect(String(payload.amount)).toMatch(/^今日 ¥\d/)
    expect(String(payload.note)).toMatch(/高峰时段|空闲时段/)
    expect(payload.ttlMs).toBe(7_200_000)
    expect(parseAnnouncement(payload, Date.now())).toBeDefined()
    service.stop()
  })

  it('falls back to the adapter-family snapshot when the current route id has none of its own', async () => {
    stubFetch((url) => url.includes('api.deepseek.com') ? jsonResponse(BALANCE_BODY) : jsonResponse({}, 404))
    const pet = makeRecorderPet()
    // Only the catalog alias `deepseek` is enumerated, but the session runs
    // under the live `deepseek-official` route id.
    const { ctx, fireSessionEvent } = makeCtx({ llm: {
      listProviders: () => [],
      listConfigurableProviders: () => [{ provider: 'deepseek', displayName: 'deepseek' }],
    }, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek-official', 'deepseek-v4-flash-vision-exp'))
    await service.refresh()
    // The deepseek-official snapshot is absent, but the family fallback finds
    // the catalog alias's balance and announces it for the live route.
    expect(pet.announced).toHaveLength(1)
    expect(pet.announced[0]).toMatchObject({ kind: 'balance', title: 'deepseek', amount: '¥110.00' })
    service.stop()
  })

  it('never announces a plan whose windows all lack a percent', async () => {
    stubFetch(() => jsonResponse({ limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: '5h limit' } }] }))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_KIMI, credentials: CREDENTIALS_KIMI_KEY, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('kimi-coding', 'kimi-latest'))
    await service.refresh()

    // The plan snapshot itself is served to the UI, but the pet contract
    // rejects percent-less plan payloads, so nothing announces.
    expect(service.overview().providers[0]?.plan?.windows).toHaveLength(1)
    expect(pet.announced).toHaveLength(0)
    service.stop()
  })

  it('announces the highest-percent plan window and passes the pet validator round-trip', async () => {
    stubFetch(() => jsonResponse({
      usage: { limit: '100', used: '85', resetTime: '2026-08-31T00:00:00Z' },
      limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: '5h limit', limit: '100', used: '20' } }],
    }))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_KIMI, credentials: CREDENTIALS_KIMI_KEY, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('kimi-coding', 'kimi-latest'))
    await service.refresh()

    expect(pet.announced).toHaveLength(1)
    expect(pet.announced[0]).toMatchObject({ kind: 'plan', title: 'Kimi For Coding', percent: 85, tone: 'warn' })
    expect(parseAnnouncement(pet.announced[0], Date.now())).toBeDefined()
    service.stop()
  })

  it('re-announces in change mode only when the value changes', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, { ...OPTIONS, bubbleMode: 'change' })
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    await service.refresh()
    await service.refresh()
    expect(pet.announced).toHaveLength(1)

    fetchMock.mockImplementation(async () => jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '99.00' }] }))
    await service.refresh()
    expect(pet.announced).toHaveLength(2)
    expect(pet.announced[1]).toMatchObject({ amount: '¥99.00' })
    service.stop()
  })
})

describe('lifecycle fences', () => {
  it('does not probe or announce after stop', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    await service.stop()

    await service.refresh()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(pet.announced).toHaveLength(0)
  })

  it('abandons the post-probe work when the service is disposed mid-cycle', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = stubFetch(async () => {
      await gate
      return jsonResponse(BALANCE_BODY)
    })
    const pet = makeRecorderPet()
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, pet })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    const cycle = service.refresh()
    const stopped = service.stop()
    release()
    await Promise.all([cycle, stopped])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(pet.announced).toHaveLength(0)
  })

  it('joins the running cycle instead of no-oping, so refresh waits for real probes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = stubFetch(async () => {
      await gate
      return jsonResponse(BALANCE_BODY)
    })
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    const first = service.refresh()
    const second = service.refresh()

    let settled = false
    void Promise.all([first, second]).then(() => { settled = true })
    await sleep(30)
    expect(settled).toBe(false)

    release()
    await Promise.all([first, second])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(service.overview().providers[0]?.balance).toBeDefined()
    service.stop()
  })
})

describe('persistence', () => {
  it('merges the persisted ledger with folds that landed during the load window', async () => {
    writeLedgerFile({ [localDateKey(Date.now())]: { deepseek: { 'deepseek-v4-pro': { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, calls: 1 } } } })
    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    // Folded in the same tick as start(), so before the async load resolves.
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(session, usageEvent(50, 0))
    await sleep(30)

    // Replacement-on-load would drop the in-window fold (100); the merge keeps both (150).
    expect(service.overview().usage.today.totals.inputTokens).toBe(150)
    await service.stop()
  })

  it('never overwrites the ledger file before the load completed', async () => {
    writeLedgerFile({ [localDateKey(Date.now())]: { deepseek: { 'deepseek-v4-pro': { inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, calls: 1 } } } })
    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(session, usageEvent(50, 0))
    await service.stop()

    expect(readLedgerFile().days[localDateKey(Date.now())]?.deepseek?.['deepseek-v4-pro']).toMatchObject({ inputTokens: 100 })
  })

  it('flushes pending folds on stop', async () => {
    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    await sleep(20)
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(session, usageEvent(70, 30))
    await service.stop()

    expect(readLedgerFile().days[localDateKey(Date.now())]?.deepseek?.['deepseek-v4-pro']).toMatchObject({ inputTokens: 70, calls: 1 })
  })

  it('prunes days past retention on load and immediately when retention shrinks', async () => {
    const twentyDaysAgo = new Date()
    twentyDaysAgo.setDate(twentyDaysAgo.getDate() - 20)
    twentyDaysAgo.setHours(12, 0, 0, 0)
    const doc = createLedgerDocument()
    foldUsage(doc, twentyDaysAgo.getTime(), 'deepseek', 'm', { ...emptyTotals(), inputTokens: 5, calls: 1 })
    foldUsage(doc, Date.now(), 'deepseek', 'm', { ...emptyTotals(), inputTokens: 7, calls: 1 })
    writeLedgerFile(JSON.parse(JSON.stringify(doc)).days)

    const { ctx } = makeCtx()
    const service = new UsageService(ctx, { ...OPTIONS, retainDays: 180 })
    service.start()
    await sleep(30)
    expect(service.overview().usage.days.map((day) => day.date)).toContain(localDateKey(twentyDaysAgo.getTime()))

    service.applyOptions({ ...OPTIONS, retainDays: 7 })
    expect(service.overview().usage.days.map((day) => day.date)).toEqual([localDateKey(Date.now())])
    await service.stop()
  })
})

describe('buildAnnouncement contract', () => {
  it('produces parseAnnouncement-valid payloads for every shape it can return', () => {
    const balance = buildAnnouncement({ displayName: 'DeepSeek', balance: { currency: 'CNY', totalBalance: '110.00', updatedAt: 1 } })
    expect(balance).toMatchObject({ kind: 'balance', title: 'DeepSeek', amount: '¥110.00', tone: 'ok' })
    expect(parseAnnouncement({ source: USAGE_ANNOUNCE_SOURCE, ttlMs: undefined, ...balance! }, 1)).toBeDefined()

    const plan = buildAnnouncement({ displayName: 'Kimi', plan: { windows: [{ key: 'week', percent: 85 }, { key: '5h', percent: 20 }], updatedAt: 1 } })
    expect(plan).toMatchObject({ kind: 'plan', title: 'Kimi', percent: 85, tone: 'warn' })
    expect(parseAnnouncement({ source: USAGE_ANNOUNCE_SOURCE, ...plan! }, 1)).toBeDefined()

    const planWithNote = buildAnnouncement({ displayName: 'Kimi', plan: { planName: 'Pro', windows: [{ key: 'week', percent: 95, resetsAt: '2026-08-31T00:00:00.000Z' }], updatedAt: 1 } })
    expect(planWithNote).toMatchObject({ percent: 95, tone: 'low', note: 'Pro', resetAt: '2026-08-31T00:00:00.000Z' })
    expect(parseAnnouncement({ source: USAGE_ANNOUNCE_SOURCE, ...planWithNote! }, 1)).toBeDefined()
  })

  it('announces today spend first for a priced family, with the peak period and the balance in the note', () => {
    const snapshot = { displayName: 'DeepSeek', balance: { currency: 'CNY', totalBalance: '1109.95', updatedAt: 1 } }
    const cost = buildAnnouncement(snapshot, { todayCost: 12.3456, peak: true })
    expect(cost).toMatchObject({ kind: 'cost', title: 'DeepSeek', amount: '今日 ¥12.35', tone: 'warn', note: '高峰时段 计价×2 · 余额 ¥1109.95' })
    expect(parseAnnouncement({ source: USAGE_ANNOUNCE_SOURCE, ...cost! }, 1)).toBeDefined()

    const offPeak = buildAnnouncement(snapshot, { todayCost: 0.5, peak: false })
    expect(offPeak).toMatchObject({ kind: 'cost', amount: '今日 ¥0.50', tone: 'ok', note: '空闲时段 计价减半 · 余额 ¥1109.95' })

    // No readable balance: the note carries the period alone.
    const noBalance = buildAnnouncement({ displayName: 'DeepSeek' }, { todayCost: 1, peak: false })
    expect(noBalance).toMatchObject({ kind: 'cost', note: '空闲时段 计价减半' })
    expect(parseAnnouncement({ source: USAGE_ANNOUNCE_SOURCE, ...noBalance! }, 1)).toBeDefined()
  })

  it('falls back to the balance bubble when the family has no spend today', () => {
    const balance = buildAnnouncement({ displayName: 'DeepSeek', balance: { currency: 'CNY', totalBalance: '110.00', updatedAt: 1 } }, { todayCost: 0, peak: true })
    expect(balance).toMatchObject({ kind: 'balance', amount: '¥110.00' })
  })

  it('returns undefined when nothing satisfies the pet contract', () => {
    // Percent-less plan windows never announce.
    expect(buildAnnouncement({ displayName: 'K', plan: { windows: [{ key: '5h' }, { key: 'week', resetsAt: 'x' }], updatedAt: 1 } })).toBeUndefined()
    expect(buildAnnouncement({ displayName: 'D' })).toBeUndefined()
  })
})
