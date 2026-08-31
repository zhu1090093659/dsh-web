import { describe, expect, it } from 'vitest'
import { adapterFor, isDeepSeekProviderRoute, providerErrorMessage, PROVIDER_ADAPTERS } from '../src/core/adapters.ts'

describe('adapterFor', () => {
  it('serves every documented route id', () => {
    for (const id of ['deepseek', 'deepseek-official', 'moonshotai-cn', 'moonshotai', 'kimi-coding', 'zai-coding-cn', 'zai-coding', 'opencode-go', 'minimax-cn', 'minimax', 'openai-codex', 'openrouter', 'siliconflow', 'siliconflow-intl', 'zenmux']) {
      expect(adapterFor(id), id).toBeDefined()
    }
    expect(adapterFor('unknown-provider')).toBeUndefined()
  })

  it('serves the official DeepSeek live route and the catalog alias with one adapter', () => {
    // `deepseek-official` is the llm-deepseek route sessions carry; `deepseek`
    // is the configurable-catalog key. The announce fallback keys on family
    // identity, so both ids must land on the same adapter object.
    expect(adapterFor('deepseek-official')).toBe(adapterFor('deepseek'))
    expect(isDeepSeekProviderRoute('deepseek-official')).toBe(true)
    expect(isDeepSeekProviderRoute('deepseek')).toBe(true)
    expect(isDeepSeekProviderRoute('kimi-coding')).toBe(false)
    expect(isDeepSeekProviderRoute('zenmux')).toBe(false)
    expect(isDeepSeekProviderRoute('unknown-provider')).toBe(false)
  })

  it('keeps route ids unique across adapters', () => {
    const seen = new Set<string>()
    for (const adapter of PROVIDER_ADAPTERS) {
      for (const id of adapter.ids) {
        expect(seen.has(id), id).toBe(false)
        seen.add(id)
      }
    }
  })
})

describe('deepseek balance parse', () => {
  const adapter = adapterFor('deepseek')!
  it('builds a bearer probe and parses the documented shape', () => {
    expect(adapter.balance?.build({ apiKey: 'sk-x' })).toEqual({
      url: 'https://api.deepseek.com/user/balance',
      headers: { authorization: 'Bearer sk-x' },
    })
    expect(adapter.balance?.parse(200, {
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00' }],
    })).toEqual({ currency: 'CNY', totalBalance: '110.00' })
  })

  it('rejects error statuses and malformed bodies', () => {
    expect(adapter.balance?.parse(401, {})).toBeUndefined()
    expect(adapter.balance?.parse(200, { balance_infos: [] })).toBeUndefined()
    expect(adapter.balance?.parse(200, null)).toBeUndefined()
  })
})

describe('kimi coding plan parse', () => {
  const adapter = adapterFor('kimi-coding')!
  it('parses limits[] rows and the weekly usage summary', () => {
    const parsed = adapter.plan?.parse(200, {
      user: { membership: { level: 'LEVEL_8' } },
      usage: { limit: '100', used: '45', resetTime: '2026-08-31T00:00:00Z' },
      limits: [
        { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { name: '5h limit', limit: '100', used: '2', resetTime: '2026-08-29T12:00:00Z' } },
      ],
    })
    expect(parsed?.planName).toBe('LEVEL_8')
    expect(parsed?.windows).toContainEqual({ key: '5h', name: '5h limit', percent: 2, resetsAt: '2026-08-29T12:00:00.000Z' })
    expect(parsed?.windows).toContainEqual({ key: 'week', name: 'Weekly', percent: 45, resetsAt: '2026-08-31T00:00:00.000Z' })
  })

  it('normalizes reset instants or drops them (never passes raw text through)', () => {
    const parse = (resetTime: unknown) =>
      adapter.plan?.parse(200, { limits: [{ window: { duration: 60, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { used: 1, limit: 2, resetTime } }] })
        ?.windows[0]?.resetsAt
    // Epoch instants as strings normalize through the numeric branch.
    expect(parse('1756428000')).toBe(new Date(1756428000 * 1000).toISOString())
    expect(parse('1756428000000')).toBe(new Date(1756428000000).toISOString())
    // Unparseable text resolves to undefined, not "Invalid Date" fodder.
    expect(parse('2026-13-45')).toBeUndefined()
    expect(parse('soon')).toBeUndefined()
    expect(parse('')).toBeUndefined()
    expect(parse(null)).toBeUndefined()
  })
})

describe('glm coding plan parse', () => {
  it.each([
    ['zai-coding-cn', 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'],
    ['zai-coding', 'https://api.z.ai/api/monitor/usage/quota/limit'],
  ])('%s probes the raw-key quota endpoint', (id, url) => {
    const adapter = adapterFor(id)!
    const spec = adapter.plan!.build({ apiKey: 'raw-key' })
    expect(spec.url).toBe(url)
    // GLM quirk: the raw key, no Bearer prefix.
    expect(spec.headers.authorization).toBe('raw-key')
    const parsed = adapter.plan!.parse(200, {
      success: true,
      data: {
        level: 'GLM-Code-Plan',
        limits: [
          { type: 'TOKENS_LIMIT', percentage: 12.5, unit: 3, nextResetTime: 1788000000000 },
          { type: 'TOKENS_LIMIT', percentage: 140, unit: 6, nextResetTime: 1788300000000 },
        ],
      },
    })
    expect(parsed?.planName).toBe('GLM-Code-Plan')
    expect(parsed?.windows[0]).toMatchObject({ key: '5h', percent: 12.5 })
    // Percent clamps into 0-100.
    expect(parsed?.windows[1]).toMatchObject({ key: 'week', percent: 100 })
  })
})

describe('opencode-go plan parse', () => {
  const adapter = adapterFor('opencode-go')!
  it('parses rolling/weekly/monthly percents and drops placeholder resets', () => {
    const parsed = adapter.plan?.parse(200, {
      usage: {
        rolling: { status: 'ok', percent: 19.5, resetsAt: '2026-08-29T10:00:00.000Z' },
        weekly: { status: 'ok', percent: 0, resetsAt: '2026-08-29T11:00:00.000Z' },
        monthly: { status: 'rate-limited', percent: 100, resetsAt: '2026-09-01T00:00:00.000Z' },
      },
    })
    expect(parsed?.windows).toEqual([
      { key: '5h', percent: 19.5, resetsAt: '2026-08-29T10:00:00.000Z' },
      { key: 'week', percent: 0, resetsAt: undefined },
      { key: 'month', percent: 100, resetsAt: '2026-09-01T00:00:00.000Z' },
    ])
  })
})

describe('minimax plan parse', () => {
  const adapter = adapterFor('minimax-cn')!
  it('inverts remaining percents for the general entry and honors weekly status', () => {
    const parsed = adapter.plan?.parse(200, {
      model_remains: [
        { model_name: 'video', current_interval_remaining_percent: 10 },
        {
          model_name: 'general',
          current_interval_remaining_percent: 70,
          end_time: 1787018000000,
          current_weekly_remaining_percent: 80,
          weekly_end_time: 1787500000000,
          current_weekly_status: 1,
        },
      ],
    })
    expect(parsed?.windows).toEqual([
      { key: '5h', percent: 30, resetsAt: new Date(1787018000000).toISOString() },
      { key: 'week', percent: 20, resetsAt: new Date(1787500000000).toISOString() },
    ])
    const noWeekly = adapter.plan?.parse(200, {
      model_remains: [{ model_name: 'general', current_interval_remaining_percent: 5, current_weekly_status: 3 }],
    })
    expect(noWeekly?.windows).toHaveLength(1)
  })
})

describe('openai-codex plan parse', () => {
  const adapter = adapterFor('openai-codex')!
  it('builds the wham/usage probe with the oauth bearer and account header', () => {
    expect(adapter.plan?.build({ apiKey: 'tok', accountId: 'acc-1' })).toEqual({
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: {
        authorization: 'Bearer tok',
        'user-agent': 'codex-cli',
        accept: 'application/json',
        'chatgpt-account-id': 'acc-1',
      },
    })
  })

  it('parses the primary/secondary windows onto the shared key vocabulary', () => {
    const parsed = adapter.plan?.parse(200, {
      rate_limit: {
        primary_window: { used_percent: 42.5, limit_window_seconds: 18000, reset_at: 1788000000 },
        secondary_window: { used_percent: 7, limit_window_seconds: 604800, reset_at: 1788300000 },
      },
    })
    expect(parsed?.windows).toEqual([
      { key: '5h', percent: 42.5, resetsAt: '2026-08-29T10:40:00.000Z' },
      { key: 'week', percent: 7, resetsAt: '2026-09-01T22:00:00.000Z' },
    ])
    const freePlan = adapter.plan?.parse(200, {
      rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 2_592_000, reset_at: 1789000000 } },
    })
    expect(freePlan?.windows[0]?.key).toBe('month')
    // Missing used_percent drops the window; a rate_limit-less body is rejected.
    expect(adapter.plan?.parse(200, { rate_limit: { primary_window: {} } })).toBeUndefined()
    expect(adapter.plan?.parse(200, {})).toBeUndefined()
  })
})

describe('moonshot / openrouter / siliconflow / zenmux balance parses', () => {
  it('moonshot reads available_balance', () => {
    const parsed = adapterFor('moonshotai-cn')!.balance?.parse(200, { code: 0, data: { available_balance: 821, voucher_balance: 10, cash_balance: 811 } })
    expect(parsed).toEqual({ currency: 'CNY', totalBalance: '821.00' })
  })

  it('openrouter subtracts usage from credits', () => {
    const parsed = adapterFor('openrouter')!.balance?.parse(200, { data: { total_credits: '10.00', total_usage: '3.10' } })
    expect(parsed).toEqual({ currency: 'USD', totalBalance: '6.90' })
  })

  it('siliconflow reads totalBalance', () => {
    const parsed = adapterFor('siliconflow')!.balance?.parse(200, { data: { balance: '-0.12', chargeBalance: '88.00', totalBalance: '88.88' } })
    expect(parsed).toEqual({ currency: 'CNY', totalBalance: '88.88' })
  })

  it('zenmux reads total_credits', () => {
    const parsed = adapterFor('zenmux')!.balance?.parse(200, { success: true, data: { currency: 'usd', total_credits: 482.74 } })
    expect(parsed).toEqual({ currency: 'USD', totalBalance: '482.74' })
  })
})

describe('providerErrorMessage', () => {
  it('extracts provider messages and truncates', () => {
    expect(providerErrorMessage(401, { error: { type: 'AuthError', message: 'Missing API key.' } })).toBe('HTTP 401: Missing API key.')
    expect(providerErrorMessage(429, { msg: 'x'.repeat(300) })).toBe('HTTP 429: ' + 'x'.repeat(120))
    expect(providerErrorMessage(500, 'whatever')).toBe('HTTP 500')
  })
})
