import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLedgerDocument, foldUsage, localDateKey } from '../src/core/ledger.ts'
import { emptyTotals } from '../src/core/types.ts'
import { UsageService, type UsageServiceOptions } from '../src/host/usage-service.ts'

/**
 * Host-service behavior tests. The cordis Context is replaced by a minimal
 * fake: the service only ever calls ctx.on('session/event') and the
 * duck-typed service<T>(ctx, name) reads, so a plain object with on/get
 * covers every path. Provider HTTP probes run against a stubbed global
 * fetch, and DSH_HOME points at a temp dir per test.
 */

const OPTIONS: UsageServiceOptions = { pollIntervalSec: 3600, retainDays: 180 }

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

/** The live route id llm-deepseek-account registers for a signed-in account. */
const LLM_DEEPSEEK_ACCOUNT = {
  listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek Account' }],
  listConfigurableProviders: () => [],
}

/** Both DeepSeek channels live at once: the API-key route and the account route. */
const LLM_DEEPSEEK_BOTH = {
  listProviders: () => [
    { id: 'deepseek-official', name: 'DeepSeek' },
    { id: 'deepseek-account', name: 'DeepSeek Account' },
  ],
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

/**
 * start() folds the persisted ledger asynchronously, so a fixed sleep races
 * the file read on a loaded runner. Wait for an outcome that depends on the
 * load instead, bounded by vi.waitFor.
 */
const waitForPersistedLoad = (assert: () => void): Promise<void> => vi.waitFor(assert, { timeout: 2_000 })

const requestHeaderEvent = (provider: string, model: string) => ({
  type: 'request/header',
  data: { header: { config: { provider, model } } },
})

const usageEvent = (inputTokens: number, outputTokens: number) => ({
  type: 'assistant/message',
  data: { usage: { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } },
})

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
    expect(overview.current).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-pro', source: 'live', displayName: 'DeepSeek' })
    expect(overview.current.today?.inputTokens).toBe(110)
    expect(overview.current.today?.calls).toBe(2)
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

  it('serves the whole-ledger aggregate beyond the 30-day trend window', async () => {
    const dayAt = (daysAgo: number): Date => {
      const date = new Date()
      date.setDate(date.getDate() - daysAgo)
      date.setHours(12, 0, 0, 0)
      return date
    }
    // 34 pre-today days (inside the trend window) plus one day older than
    // the 30-entry trend cap: only the whole-ledger aggregate sees it.
    const doc = createLedgerDocument()
    foldUsage(doc, dayAt(40).getTime(), 'deepseek', 'm', { ...emptyTotals(), inputTokens: 500, calls: 1 })
    for (let offset = 1; offset <= 34; offset += 1) {
      foldUsage(doc, dayAt(offset).getTime(), 'deepseek', 'm', { ...emptyTotals(), inputTokens: 10, calls: 1 })
    }
    writeLedgerFile(JSON.parse(JSON.stringify(doc)).days)

    const { ctx, fireSessionEvent } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'm'))
    fireSessionEvent(session, usageEvent(50, 0))
    await waitForPersistedLoad(() => {
      expect(service.overview().usage.all?.from).toBe(localDateKey(dayAt(40).getTime()))
    })

    const usage = service.overview().usage
    // The trend window caps at the last 30 recorded days; the whole-ledger
    // aggregate reaches back to the oldest retained day (the voucher's
    // minted total).
    expect(usage.all?.from).toBe(localDateKey(dayAt(40).getTime()))
    expect(usage.all?.to).toBe(localDateKey(Date.now()))
    expect(usage.all?.totals.inputTokens).toBe(890)
    expect(usage.range?.totals.inputTokens).toBe(340)
    expect(usage.all?.providers.map((row) => row.provider)).toEqual(['deepseek'])
    await service.stop()
  })
})

describe('one retained day on demand', () => {
  it('user sees one picked day per provider and model, and a zeroed day for a day without usage', async () => {
    const dayAt = (daysAgo: number): number => {
      const date = new Date()
      date.setDate(date.getDate() - daysAgo)
      date.setHours(12, 0, 0, 0)
      return date.getTime()
    }
    // Given a persisted ledger holding yesterday under two DeepSeek models and
    // the day before that under a second provider
    const doc = createLedgerDocument()
    foldUsage(doc, dayAt(1), 'deepseek', 'deepseek-v4-pro', { ...emptyTotals(), inputTokens: 900, outputTokens: 100, calls: 2 })
    foldUsage(doc, dayAt(1), 'deepseek', 'deepseek-flash', { ...emptyTotals(), inputTokens: 50, calls: 1 })
    foldUsage(doc, dayAt(2), 'kimi-coding', 'k2', { ...emptyTotals(), outputTokens: 300, calls: 3 })
    writeLedgerFile(JSON.parse(JSON.stringify(doc)).days)

    const { ctx } = makeCtx()
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const yesterday = localDateKey(dayAt(1))
    await waitForPersistedLoad(() => {
      expect(service.overview().usage.availableDays).toContain(yesterday)
    })

    // When the day route asks for yesterday
    const day = service.day(yesterday)
    // Then that day alone is aggregated, heaviest model first, with no other day mixed in
    expect(day.date).toBe(yesterday)
    expect(day.totals.inputTokens).toBe(950)
    expect(day.totals.calls).toBe(3)
    expect(day.providers.map((row) => row.provider)).toEqual(['deepseek'])
    expect(day.providers[0]?.models.map((model) => model.model)).toEqual(['deepseek-v4-pro', 'deepseek-flash'])
    // And the other provider shows up under its own day only
    expect(service.day(localDateKey(dayAt(2))).providers.map((row) => row.provider)).toEqual(['kimi-coding'])
    // And a day the ledger never held reads as a zeroed day, not a missing one
    const empty = service.day(localDateKey(dayAt(3)))
    expect(empty.totals.calls).toBe(0)
    expect(empty.providers).toEqual([])
    // And the picker's option list reaches every retained day, not just the trend window
    expect(service.overview().usage.availableDays).toEqual([localDateKey(dayAt(2)), yesterday])
    await service.stop()
  })
})

describe('probes and per-fact errors', () => {
  it('probes the balance and reports the snapshot on the overview', async () => {
    const fetchMock = stubFetch((url) => url.includes('api.deepseek.com') ? jsonResponse(BALANCE_BODY) : jsonResponse({}, 404))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()

    // The alpha.2 host fetch drops decompression, so the probe must request identity.
    const probeInit = (fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined])?.[1]
    expect(new Headers(probeInit?.headers).get('accept-encoding')).toBe('identity')

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

  // #1688: a `deepseek` route pointed at another host by its pi-ai profile is
  // a DIFFERENT account. Probing the official endpoint for it would print the
  // official account's money under the reseller's name, so the row reports the
  // balance as unsupported and no request is made.
  it('operator with a reseller deepseek route sees unsupported instead of the official balance', async () => {
    // Given a profile whose `deepseek` route points at Alibaba Bailian and
    // credentials that would resolve for either account.
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const settings = {
      get: (ns: string) => ns === 'llm-pi-ai'
        ? { providers: { deepseek: { apiKeyEnv: 'DASHSCOPE_API_KEY', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' } } }
        : undefined,
    }
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, settings })
    const service = new UsageService(ctx, OPTIONS)

    // When the cycle runs
    await service.refresh()

    // Then no balance request was issued and the row carries no balance.
    expect(fetchMock).not.toHaveBeenCalled()
    const provider = service.overview().providers[0]
    expect(provider?.balanceSupported).toBe(false)
    expect(provider?.balance).toBeUndefined()
    expect(provider?.error).toBeUndefined()
    service.stop()
  })

  // #1772: `llm-deepseek-account` registers the live route `deepseek-account`
  // for a user signed in to a DeepSeek account. It bills the same account and
  // must be priced, but it holds no API key: probing it with the official
  // balance endpoint would fail, and with DEEPSEEK_API_KEY configured it would
  // print the API-key account's money under the account route's name.
  it('user signed in to a DeepSeek account sees priced usage and no borrowed balance', async () => {
    // Given a live account route, credentials that would resolve the family
    // env fallback, and a session spending on that route
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK_ACCOUNT, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek-account', 'deepseek-flash'))
    fireSessionEvent(session, usageEvent(1_000, 500))

    // When the overview is assembled
    const overview = service.overview()
    // Then the account route issued no request and carries no balance fact, so
    // the API-key account's money is never printed under the account route
    expect(fetchMock).not.toHaveBeenCalled()
    const row = overview.providers.find((provider) => provider.provider === 'deepseek-account')
    expect(row?.balance).toBeUndefined()
    expect(row?.balanceSupported).toBeUndefined()

    // And its calls are still priced as the official family, so the fold-time
    // spend estimate and the whale-yuan bank are no longer empty
    const today = overview.usage.today.providers.find((entry) => entry.provider === 'deepseek-account')
    expect(today?.totals.calls).toBe(1)
    expect(today?.totals.cost).toBeGreaterThan(0)
    expect(overview.current.displayName).toBe('DeepSeek Account')
    service.stop()
  })

  it('user with both DeepSeek channels sees two rows, not one aliased account', async () => {
    // Given the API-key route and the account route live at once, which are
    // two real accounts rather than one account named twice
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK_BOTH, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    // When the cycle runs and the overview is assembled
    await service.refresh()
    const rows = service.overview().providers
    // Then both rows survive, the key route still carries the official
    // balance, and the account route stays separate and unprobed
    expect(rows.map((provider) => provider.provider).sort()).toEqual(['deepseek-account', 'deepseek-official'])
    const official = rows.find((provider) => provider.provider === 'deepseek-official')
    expect(official?.balance).toMatchObject({ currency: 'CNY', totalBalance: '110.00' })
    expect(rows.find((provider) => provider.provider === 'deepseek-account')?.balance).toBeUndefined()
    service.stop()
  })
  it('operator with the official deepseek origin still sees its balance', async () => {
    // Given the same route id explicitly pointed at the official origin.
    const fetchMock = stubFetch((url) => url.includes('api.deepseek.com') ? jsonResponse(BALANCE_BODY) : jsonResponse({}, 404))
    const settings = {
      get: (ns: string) => ns === 'llm-pi-ai'
        ? { providers: { deepseek: { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: 'https://api.deepseek.com' } } }
        : undefined,
    }
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV, settings })
    const service = new UsageService(ctx, OPTIONS)

    // When the cycle runs
    await service.refresh()

    // Then the official account's balance is probed and rendered.
    expect(fetchMock).toHaveBeenCalled()
    const provider = service.overview().providers[0]
    expect(provider?.balanceSupported).toBe(true)
    expect(provider?.balance).toMatchObject({ currency: 'CNY', totalBalance: '110.00' })
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

describe('alias route folding', () => {
  it('user sees one DeepSeek row when the catalog alias shadows the live route', async () => {
    // Given the runtime serves deepseek-official while the catalog still lists deepseek
    const probes: string[] = []
    stubFetch((url) => {
      probes.push(url)
      return url.includes('api.deepseek.com') ? jsonResponse(BALANCE_BODY) : jsonResponse({}, 404)
    })
    const llm = {
      listProviders: LLM_DEEPSEEK_OFFICIAL.listProviders,
      listConfigurableProviders: () => [{ provider: 'deepseek', displayName: 'deepseek' }],
    }
    const { ctx } = makeCtx({ llm, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)

    // When the poll cycle probes the configured providers
    await service.refresh()

    // Then the account renders once under the live route's name and is probed once
    const providers = service.overview().providers
    expect(providers.map((row) => row.provider)).toEqual(['deepseek-official'])
    expect(providers[0]).toMatchObject({
      displayName: 'DeepSeek',
      credential: 'env',
      balance: { currency: 'CNY', totalBalance: '110.00' },
    })
    expect(probes).toEqual(['https://api.deepseek.com/user/balance'])
    service.stop()
  })
})

describe('DeepSeek real-spend watch', () => {
  it('accrues observed balance decreases, skips top-ups, and survives a restart', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    await sleep(30)
    await service.refresh()
    // The first observation only anchors the series; nothing accrued yet.
    expect(service.overview().usage.observedSpend).toBeUndefined()

    fetchMock.mockImplementation(async () => jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '108.50' }] }))
    await service.refresh()
    const observed = service.overview().usage.observedSpend
    expect(observed?.cny).toBeCloseTo(1.5)
    expect(observed?.since).toBeGreaterThan(0)

    // A balance rise is a top-up: it neither accrues nor resets the figure.
    fetchMock.mockImplementation(async () => jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: '200.00' }] }))
    await service.refresh()
    expect(service.overview().usage.observedSpend?.cny).toBeCloseTo(1.5)
    await service.stop()

    // The accrual persists with the provider snapshots and revives on load.
    const revived = new UsageService(ctx, OPTIONS)
    revived.start()
    await waitForPersistedLoad(() => {
      expect(revived.overview().usage.observedSpend?.cny).toBeCloseTo(1.5)
    })
    await revived.stop()
  })

  it('keeps no observed spend for families without an official CNY balance', async () => {
    stubFetch(() => jsonResponse({ error: 'no balance endpoint here' }, 404))
    const { ctx } = makeCtx({ llm: LLM_KIMI, credentials: CREDENTIALS_KIMI_KEY })
    const service = new UsageService(ctx, OPTIONS)
    await service.refresh()
    expect(service.overview().usage.observedSpend).toBeUndefined()
    service.stop()
  })
})

describe('poll cycle', () => {
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

describe('current view in the overview document', () => {
  it('user sees the current provider name and today totals strip-ready', async () => {
    // Given a service whose deepseek route carries one usage event today
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const session = {}
    fireSessionEvent(session, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(session, usageEvent(1000, 500))

    // When the poll cycle completes
    await service.refresh()

    // Then the overview carries the strip-ready current view with the priced cost
    const current = service.overview().current
    expect(current.provider).toBe('deepseek')
    expect(current.displayName).toBe('DeepSeek')
    expect(current.today?.inputTokens).toBe(1000)
    expect(current.today?.outputTokens).toBe(500)
    expect(current.today?.calls).toBe(1)
    expect(current.today?.cost).toBeGreaterThan(0)
    await service.stop()
  })

  it('user sees aliased family routes folded into one today figure', async () => {
    // Given the deepseek catalog alias and its runtime route each carrying usage today
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const llm = {
      listProviders: () => [
        { id: 'deepseek', name: 'DeepSeek' },
        { id: 'deepseek-official', name: 'DeepSeek' },
      ],
      listConfigurableProviders: () => [],
    }
    const { ctx, fireSessionEvent } = makeCtx({ llm, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    const sessionA = {}
    const sessionB = {}
    fireSessionEvent(sessionA, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))
    fireSessionEvent(sessionA, usageEvent(100, 50))
    fireSessionEvent(sessionB, requestHeaderEvent('deepseek-official', 'deepseek-v4-flash'))
    fireSessionEvent(sessionB, usageEvent(200, 100))

    // When the poll cycle completes with the runtime route as the current one
    await service.refresh()

    // Then today's view merges the whole adapter family
    const current = service.overview().current
    expect(current.provider).toBe('deepseek-official')
    expect(current.displayName).toBe('DeepSeek')
    expect(current.today?.inputTokens).toBe(300)
    expect(current.today?.outputTokens).toBe(150)
    expect(current.today?.calls).toBe(2)
    await service.stop()
  })

  it('user without usage today sees the name but no today figure', async () => {
    // Given a service whose session named a provider but recorded no usage
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx, fireSessionEvent } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    service.start()
    fireSessionEvent({}, requestHeaderEvent('deepseek', 'deepseek-v4-pro'))

    // When the poll cycle completes
    await service.refresh()

    // Then the strip fields resolve the name and leave the today figure absent
    const current = service.overview().current
    expect(current.displayName).toBe('DeepSeek')
    expect(current.today).toBeUndefined()
    await service.stop()
  })

  it('user without any session sees no strip fields', async () => {
    // Given a service that has not seen a session this boot
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK, credentials: CREDENTIALS_ENV })
    const service = new UsageService(ctx, OPTIONS)
    service.start()

    // When the poll cycle completes
    await service.refresh()

    // Then the current view stays bare
    const current = service.overview().current
    expect(current.provider).toBeUndefined()
    expect(current.displayName).toBeUndefined()
    expect(current.today).toBeUndefined()
    await service.stop()
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
    // Replacement-on-load would drop the in-window fold (100); the merge keeps both (150).
    await waitForPersistedLoad(() => {
      expect(service.overview().usage.today.totals.inputTokens).toBe(150)
    })
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
    await waitForPersistedLoad(() => {
      expect(service.overview().usage.days.map((day) => day.date)).toContain(localDateKey(twentyDaysAgo.getTime()))
    })

    service.applyOptions({ ...OPTIONS, retainDays: 7 })
    expect(service.overview().usage.days.map((day) => day.date)).toEqual([localDateKey(Date.now())])
    await service.stop()
  })
})
describe('DSH 0.1.7 foreign settings resolution (#1739)', () => {
  it('operator sees apiKeyEnv for pi-ai provider resolved from settings.describe() with volatile unwrap', async () => {
    // Given an OpenCode Go endpoint and DSH 0.1.7 SettingsForms describe providing volatile profiles
    stubFetch(() => jsonResponse({
      usage: {
        rolling: { percent: 10, resetsAt: '2026-09-27T12:00:00Z' },
      },
    }))
    const llm = {
      listProviders: () => [{ id: 'opencode-go', name: 'OpenCode Go' }],
      listConfigurableProviders: () => [],
    }
    const credentials = {
      readRecord: async () => undefined,
      resolve: async (ref: unknown) => {
        if (ref === 'OPENCODE_GO_API_KEY') return { value: 'sk-opencode-secret' }
        return undefined
      },
    }
    const settings = {
      describe: () => [
        {
          ns: 'llm-pi-ai',
          value: {
            providers: {
              get: () => ({
                'opencode-go': {
                  apiKeyEnv: 'OPENCODE_GO_API_KEY',
                  baseURL: 'https://opencode.ai/v1',
                },
              }),
            },
          },
        },
      ],
    }
    const { ctx } = makeCtx({ llm, credentials, settings })
    const service = new UsageService(ctx, OPTIONS)

    // When the poll cycle runs
    await service.refresh()

    // Then the credential resolves as env and plan windows are populated
    const snapshot = service.overview().providers.find((p) => p.provider === 'opencode-go')
    expect(snapshot?.credential).toBe('env')
    expect(snapshot?.plan?.windows).toHaveLength(1)
    await service.stop()
  })

  it('operator sees apiKeyEnv for pi-ai provider resolved from configEditor fallback', async () => {
    // Given an OpenCode Go endpoint and profile configuration under configEditor
    stubFetch(() => jsonResponse({
      usage: {
        rolling: { percent: 20, resetsAt: '2026-09-27T12:00:00Z' },
      },
    }))
    const llm = {
      listProviders: () => [{ id: 'opencode-go', name: 'OpenCode Go' }],
      listConfigurableProviders: () => [],
    }
    const credentials = {
      readRecord: async () => undefined,
      resolve: async (ref: unknown) => {
        if (ref === 'OPENCODE_GO_API_KEY') return { value: 'sk-opencode-editor' }
        return undefined
      },
    }
    const configEditor = {
      configuration: () => [
        {
          entry: { options: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' } },
          inherited: {},
          override: {
            providers: {
              'opencode-go': {
                apiKeyEnv: 'OPENCODE_GO_API_KEY',
              },
            },
          },
        },
      ],
    }
    const { ctx } = makeCtx({ llm, credentials, configEditor })
    const service = new UsageService(ctx, OPTIONS)

    // When the poll cycle runs
    await service.refresh()

    // Then the credential resolves as env from configEditor
    const snapshot = service.overview().providers.find((p) => p.provider === 'opencode-go')
    expect(snapshot?.credential).toBe('env')
    await service.stop()
  })

  it('operator sees official balance excluded when deepseek baseURL is customized in llm-deepseek', async () => {
    // Given a custom gateway baseURL declared for deepseek
    stubFetch(() => jsonResponse(BALANCE_BODY))
    const llm = {
      listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
      listConfigurableProviders: () => [],
    }
    const settings = {
      describe: () => [
        {
          ns: 'llm-deepseek',
          value: {
            baseURL: 'https://custom-gateway.example/v1',
          },
        },
      ],
    }
    const { ctx } = makeCtx({ llm, credentials: CREDENTIALS_ENV, settings })
    const service = new UsageService(ctx, OPTIONS)

    // When the poll cycle runs
    await service.refresh()

    // Then the balance is marked unsupported and not probed
    const snapshot = service.overview().providers.find((p) => p.provider === 'deepseek')
    expect(snapshot?.balanceSupported).toBe(false)
    expect(snapshot?.balance).toBeUndefined()
    await service.stop()
  })

  it('operator with a secondary custom-id account probes quota by baseURL and computes percent from remaining (#2045)', async () => {
    // Given two Kimi For Coding accounts (catalog id and secondary custom id with official baseURL)
    const probes: Array<{ url: string; auth: string | null }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      const auth = new Headers(init?.headers).get('authorization')
      probes.push({ url, auth })
      if (auth === 'Bearer sk-kimi-1') {
        return jsonResponse({
          usage: { limit: '100', used: '40', resetTime: '2026-08-31T00:00:00Z' },
          limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '10' } }],
        })
      }
      return jsonResponse({
        usage: { limit: '100', remaining: '20', resetTime: '2026-08-31T00:00:00Z' },
        limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '100' } }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const llm = {
      listProviders: () => [
        { id: 'kimi-coding', name: 'Kimi Account 1' },
        { id: 'kimi-coding-2', name: 'Kimi Account 2' },
      ],
      listConfigurableProviders: () => [],
    }
    const credentials = {
      readRecord: async (key: unknown) => String(key).includes('kimi-coding-2')
        ? { kind: 'api-key', key: 'sk-kimi-2' }
        : { kind: 'api-key', key: 'sk-kimi-1' },
      resolve: async () => undefined,
    }
    const settings = {
      get: (ns: string) => ns === 'llm-pi-ai'
        ? { providers: { 'kimi-coding-2': { baseURL: 'https://api.kimi.com/coding/v1' } } }
        : undefined,
    }
    const { ctx } = makeCtx({ llm, credentials, settings })
    const service = new UsageService(ctx, OPTIONS)

    // When the poll cycle runs
    await service.refresh()

    // Then both accounts appear with plan quotas, including the remaining-only response
    const rows = service.overview().providers
    const second = rows.find((p) => p.provider === 'kimi-coding-2')
    expect(second?.supported).toBe(true)
    expect(second?.planSupported).toBe(true)
    expect(second?.credential).toBe('api-key')
    expect(second?.plan?.windows).toEqual([
      { key: '5h', name: undefined, percent: 0, resetsAt: undefined },
      { key: 'week', name: 'Weekly', percent: 80, resetsAt: '2026-08-31T00:00:00.000Z' },
    ])
    expect(rows.find((p) => p.provider === 'kimi-coding')?.plan?.windows.find((w) => w.key === 'week')?.percent).toBe(40)
    expect(probes.map((p) => p.auth).sort()).toEqual(['Bearer sk-kimi-1', 'Bearer sk-kimi-2'])
    await service.stop()
  })

  it('user signed in to App-managed DeepSeek sees combined recharge and bonus balance and observed spend (#2047)', async () => {
    // Given a host mounting deepseekAccount beside credential storage
    const fetchMock = stubFetch(() => jsonResponse(BALANCE_BODY))
    let status: 'signed-out' | 'credential-stored' = 'credential-stored'
    let balanceOutcome: { status: 'ready'; value: Array<{ currency: 'CNY' | 'USD'; balance: string }>; bonusWallets: Array<{ currency: 'CNY' | 'USD'; balance: string }> } | { status: 'failed' } | null = {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '12.50' }],
      bonusWallets: [{ currency: 'CNY', balance: '7.50' }],
    }
    const deepseekAccount = {
      getState: async () => ({ status }),
      getBalance: async () => balanceOutcome,
    }
    const { ctx } = makeCtx({ llm: LLM_DEEPSEEK_ACCOUNT, credentials: CREDENTIALS_ENV, deepseekAccount })
    const service = new UsageService(ctx, OPTIONS)

    // When the first poll cycle runs
    await service.refresh()

    // Then no HTTP request touches the API-key endpoint and the combined CNY balance is shown
    expect(fetchMock).not.toHaveBeenCalled()
    let row = service.overview().providers.find((p) => p.provider === 'deepseek-account')
    expect(row).toMatchObject({
      provider: 'deepseek-account',
      displayName: 'DeepSeek Account',
      credential: 'oauth',
      supported: true,
      balanceSupported: true,
      balance: { currency: 'CNY', totalBalance: '20.00' },
    })
    expect(service.overview().usage.observedSpend).toBeUndefined()

    // When the next cycle sees balance decrease, observed spend accrues the delta
    balanceOutcome = {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '10.70' }],
      bonusWallets: [{ currency: 'CNY', balance: '7.50' }],
    }
    await service.refresh()
    expect(service.overview().providers.find((p) => p.provider === 'deepseek-account')?.balance?.totalBalance).toBe('18.20')
    expect(service.overview().usage.observedSpend?.cny).toBeCloseTo(1.8)

    // When the balance query fails transiently, the previous balance survives beside an error message
    balanceOutcome = { status: 'failed' }
    await service.refresh()
    row = service.overview().providers.find((p) => p.provider === 'deepseek-account')
    expect(row?.balance?.totalBalance).toBe('18.20')
    expect(row?.error).toBe('account balance query failed')

    // When the user signs out, stale balance and error clear immediately
    status = 'signed-out'
    await service.refresh()
    row = service.overview().providers.find((p) => p.provider === 'deepseek-account')
    expect(row?.credential).toBe('none')
    expect(row?.balance).toBeUndefined()
    expect(row?.error).toBeUndefined()
    await service.stop()
  })
})

