import { describe, expect, it } from 'vitest'
import { adapterFor, balanceAppliesToRoute, isDeepSeekProviderRoute, originOf, providerErrorMessage, PROVIDER_ADAPTERS, quotaUsedPercent, resolveRouteAdapter } from '../src/core/adapters.ts'

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

  it('operator keeps every family-only id out of the probe directory', () => {
    // Given every adapter in the directory
    const probed = new Set(PROVIDER_ADAPTERS.flatMap((adapter) => adapter.ids))
    const familyOnly = new Set<string>()
    // When the family-only ids are compared against the probed ids and
    // against each other
    for (const adapter of PROVIDER_ADAPTERS) {
      for (const id of adapter.familyOnlyIds ?? []) {
        // Then a family-only id claims no probe and belongs to one family,
        // so accounting and probing can never disagree about a route
        expect(probed.has(id), id).toBe(false)
        expect(familyOnly.has(id), id).toBe(false)
        familyOnly.add(id)
      }
    }
  })
})

// #1772: the signed-in DeepSeek account route (llm-deepseek-account registers
// `deepseek-account`) bills the same account as the official route, so the
// family must own it for pricing and the whale-yuan bank. It holds no API key,
// so the balance probe must not reach it: adding it to `ids` would let
// credential resolution fall back to the family DEEPSEEK_API_KEY and print
// the API-key account's money under the account route's name.
describe('isDeepSeekProviderRoute (family membership wider than the probe directory)', () => {
  it('user signed in to a DeepSeek account has their route recognized as the official family', () => {
    // Given the account route and the two API-key routes
    // When family membership is decided
    // Then all three belong to the official DeepSeek family, so their calls
    // are priced and mint whale yuan instead of falling outside both
    expect(isDeepSeekProviderRoute('deepseek-account')).toBe(true)
    expect(isDeepSeekProviderRoute('deepseek-official')).toBe(true)
    expect(isDeepSeekProviderRoute('deepseek')).toBe(true)
  })

  it('operator sees the account route stay out of the probe directory', () => {
    // Given a user signed in to a DeepSeek account on the account route
    // When the route is resolved for probing, credential fallback, alias
    // folding and the renderable provider row
    // Then no adapter serves it, so it can never inherit the official
    // API-key account's balance
    expect(adapterFor('deepseek-account')).toBeUndefined()
  })

  it('operator sees no adapter claim the account route for probing', () => {
    // Given the full adapter directory
    // When each adapter is asked for the account route
    // Then none claims it, so pricing and probing agree about the family
    const claimants = PROVIDER_ADAPTERS.filter((adapter) => adapterFor('deepseek-account') === adapter)
    expect(claimants).toEqual([])
  })
})

// #1688: `deepseek` is both the official catalog entry and a common id for an
// OpenAI-compatible reseller (Alibaba Bailian, ...) pointed at another host by
// the profile's baseURL. The balance endpoint belongs to one ORIGIN, so probing
// it for the reseller reported the official account's money under the reseller's
// name. These pin the origin gate.
describe('balanceAppliesToRoute', () => {
  const deepseek = adapterFor('deepseek')!

  it('operator sees the official balance endpoint apply to the official origin', () => {
    // Given the official route, with and without an explicit official base URL
    // When applicability is decided
    // Then the official endpoint is this route's account
    expect(balanceAppliesToRoute(deepseek, undefined)).toBe(true)
    expect(balanceAppliesToRoute(deepseek, 'https://api.deepseek.com')).toBe(true)
    expect(balanceAppliesToRoute(deepseek, 'https://api.deepseek.com/v1')).toBe(true)
  })

  it('operator sees a reseller profile keep its own account instead of the official one', () => {
    // Given a `deepseek` route pointed at Alibaba Bailian's compatible host
    const bailian = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    // When applicability is decided
    // Then the official endpoint is refused: it reports a different account
    expect(balanceAppliesToRoute(deepseek, bailian)).toBe(false)
    // And a trailing path or explicit port does not change the verdict
    expect(balanceAppliesToRoute(deepseek, 'https://api.deepseek.com.evil.example')).toBe(false)
  })

  it('operator sees adapters without a fixed origin apply to every route', () => {
    // Given a provider whose endpoint follows the profile host (siliconflow)
    const perRoute = adapterFor('siliconflow')!
    // When applicability is decided
    // Then no origin gate applies
    expect(balanceAppliesToRoute(perRoute, 'https://api.siliconflow.cn')).toBe(true)
    expect(balanceAppliesToRoute(perRoute, 'https://elsewhere.example')).toBe(true)
  })

  it('operator sees an unparsable base URL fall back to the family default', () => {
    // Given a malformed base URL in the profile
    // When applicability is decided
    // Then the route is treated as declaring no origin and keeps its adapter
    expect(originOf('not a url')).toBeUndefined()
    expect(balanceAppliesToRoute(deepseek, 'not a url')).toBe(true)
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

  it('operator derives used percent from limit - remaining when used is omitted (#2045)', () => {
    // Given a provider response that omits `used` on fresh or exhausted rows
    const parsed = adapter.plan?.parse(200, {
      usage: { limit: '100', remaining: '0', resetTime: '2026-08-31T00:00:00Z' },
      limits: [
        { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '100', resetTime: '2026-08-29T12:00:00Z' } },
        { window: { duration: 60, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '200', remaining: '50' } },
      ],
    })
    // When percentages are calculated
    // Then 0 remaining yields 100%, full remaining yields 0%, and partial yields 75%
    expect(parsed?.windows).toEqual([
      { key: '5h', name: undefined, percent: 0, resetsAt: '2026-08-29T12:00:00.000Z' },
      { key: 'w-60', name: undefined, percent: 75, resetsAt: undefined },
      { key: 'week', name: 'Weekly', percent: 100, resetsAt: '2026-08-31T00:00:00.000Z' },
    ])
    // And direct quotaUsedPercent prefers `used`, clamps bounds, and guards missing inputs
    expect(quotaUsedPercent('25', '100', '100')).toBe(25)
    expect(quotaUsedPercent(undefined, '150', '100')).toBe(0)
    expect(quotaUsedPercent(undefined, '-10', '100')).toBe(100)
    expect(quotaUsedPercent(undefined, undefined, '100')).toBeUndefined()
    expect(quotaUsedPercent('10', undefined, '0')).toBeUndefined()
  })
})

describe('resolveRouteAdapter (#2045)', () => {
  it('operator resolves secondary custom route ids by trusted official HTTPS baseURL', () => {
    // Given custom secondary provider route ids paired with official inference endpoints
    // When resolving each route id with its configured baseURL
    // Then each endpoint maps to its vendor adapter
    expect(resolveRouteAdapter('kimi-coding-2', 'https://api.kimi.com/coding/v1')).toBe(adapterFor('kimi-coding'))
    expect(resolveRouteAdapter('deepseek-work', 'https://api.deepseek.com/v1')).toBe(adapterFor('deepseek'))
    expect(resolveRouteAdapter('moonshot-2', 'https://api.moonshot.cn/v1')).toBe(adapterFor('moonshotai-cn'))
    expect(resolveRouteAdapter('moonshot-intl-2', 'https://api.moonshot.ai/v1')).toBe(adapterFor('moonshotai'))
    expect(resolveRouteAdapter('siliconflow-2', 'https://api.siliconflow.cn/v1')).toBe(adapterFor('siliconflow'))
    expect(resolveRouteAdapter('openrouter-2', 'https://openrouter.ai/api/v1')).toBe(adapterFor('openrouter'))
    expect(resolveRouteAdapter('minimax-2', 'https://api.minimaxi.com/v1')).toBe(adapterFor('minimax-cn'))
    expect(resolveRouteAdapter('glm-2', 'https://open.bigmodel.cn/api/paas/v4')).toBe(adapterFor('zai-coding-cn'))
    expect(resolveRouteAdapter('glm-coding-2', 'https://open.bigmodel.cn/api/coding/paas/v4')).toBe(adapterFor('zai-coding-cn'))
    expect(resolveRouteAdapter('zenmux-2', 'https://zenmux.ai/api/v1')).toBe(adapterFor('zenmux'))
    expect(resolveRouteAdapter('opencode-2', 'HTTPS://OPENCODE.AI/zen/go/v1')).toBe(adapterFor('opencode-go'))
  })

  it('operator rejects path-prefix mismatches, non-https origins, unknown hosts, and family-only routes', () => {
    // Given mismatched path boundaries, plaintext or unknown URLs, and guarded route ids
    // When resolving their adapters
    // Then only the known catalog id keeps its catalog entry while untrusted endpoints return undefined
    // Path boundary prevents matching unrelated sibling routes on the same host
    expect(resolveRouteAdapter('kimi-api-2', 'https://api.kimi.com/v1')).toBeUndefined()
    expect(resolveRouteAdapter('kimi-bad', 'https://api.kimi.com/coding2/v1')).toBeUndefined()
    expect(resolveRouteAdapter('openrouter-web', 'https://openrouter.ai/docs')).toBeUndefined()
    // Plaintext or unknown reseller endpoints never resolve an adapter
    expect(resolveRouteAdapter('deepseek-http', 'http://api.deepseek.com/v1')).toBeUndefined()
    expect(resolveRouteAdapter('reseller-custom', 'https://proxy.example.com/v1')).toBeUndefined()
    expect(resolveRouteAdapter('broken-url', 'not a url')).toBeUndefined()
    // #1772 guard: family-only route id stays outside API-key endpoint probing even on api.deepseek.com
    expect(resolveRouteAdapter('deepseek-account', 'https://api.deepseek.com')).toBeUndefined()
    expect(resolveRouteAdapter('deepseek-account', 'https://api.deepseek.com/v1')).toBeUndefined()
    // #1688 guard: known catalog id on a customized gateway still maps to DEEPSEEK so balanceSupported = false
    expect(resolveRouteAdapter('deepseek', 'https://custom-gateway.example/v1')).toBe(adapterFor('deepseek'))
  })
})

describe('glm coding plan parse', () => {
  it.each([
    ['zai-coding-cn', 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'],
    // The pi-ai catalog registers the z.ai coding plan as route id `zai`;
    // only this package's older aliases `zai-coding`/`zai-coding-cn` were
    // served before issue #1597.
    ['zai', 'https://api.z.ai/api/monitor/usage/quota/limit'],
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

  it('keys windows by the provider unit rather than by row position', () => {
    const adapter = adapterFor('zai')!
    const parsed = adapter.plan!.parse(200, {
      success: true,
      data: {
        level: 'GLM-Code-Plan',
        limits: [
          { type: 'TOKENS_LIMIT', percentage: 70, unit: 6, nextResetTime: 1788300000000 },
          { type: 'TOKENS_LIMIT', percentage: 30, unit: 5, nextResetTime: 1788900000000 },
          { type: 'TOKENS_LIMIT', percentage: 12.5, unit: 3, nextResetTime: 1788000000000 },
        ],
      },
    })
    expect(parsed?.windows.map(window => window.key)).toEqual(['week', 'month', '5h'])
    expect(parsed?.windows.map(window => window.percent)).toEqual([70, 30, 12.5])
  })

  it('renders the 5-hour-only legacy plan shape', () => {
    const adapter = adapterFor('zai')!
    const parsed = adapter.plan!.parse(200, {
      success: true,
      data: { level: 'GLM-Code-Plan', limits: [{ type: 'TOKENS_LIMIT', percentage: 42, unit: 3, nextResetTime: 1788000000000 }] },
    })
    expect(parsed?.windows).toEqual([{ key: '5h', percent: 42, resetsAt: '2026-08-29T10:40:00.000Z' }])
  })

  it('uses the exact credit ratio for a credits-based plan', () => {
    const adapter = adapterFor('zai')!
    const parsed = adapter.plan!.parse(200, {
      success: true,
      data: {
        level: 'GLM-Code-Plan',
        limits: [
          { type: 'CREDIT_LIMIT', unit: 6, usage: 2000, currentValue: 500, percentage: 0.1, nextResetTime: 1788300000000 },
          // No exact ratio available: the provider percentage is the fallback.
          { type: 'CREDIT_LIMIT', unit: 3, percentage: 25, nextResetTime: 1788000000000 },
        ],
      },
    })
    expect(parsed?.windows[0]).toMatchObject({ key: 'week', percent: 25 })
    expect(parsed?.windows[1]).toMatchObject({ key: '5h', percent: 25 })
  })

  it('skips the MCP request cap and unknown units instead of inventing windows', () => {
    const adapter = adapterFor('zai')!
    const parsed = adapter.plan!.parse(200, {
      success: true,
      data: {
        level: 'GLM-Code-Plan',
        limits: [
          { type: 'TIME_LIMIT', percentage: 80, unit: 3, nextResetTime: 1788000000000 },
          { type: 'TOKENS_LIMIT', percentage: 10, unit: 99, nextResetTime: 1788000000000 },
          { type: 'TOKENS_LIMIT', percentage: 20, unit: 3, nextResetTime: 1788000000000 },
        ],
      },
    })
    expect(parsed?.windows).toEqual([{ key: '5h', percent: 20, resetsAt: '2026-08-29T10:40:00.000Z' }])
    // Nothing renderable left: no plan data rather than an empty card.
    expect(adapter.plan!.parse(200, {
      success: true,
      data: { limits: [{ type: 'TIME_LIMIT', percentage: 80, unit: 3 }] },
    })).toBeUndefined()
  })

  it('reports no plan for the failure envelope the endpoint returns with HTTP 200', () => {
    const adapter = adapterFor('zai')!
    expect(adapter.plan!.parse(200, { success: false, code: 401, msg: 'invalid api key' })).toBeUndefined()
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
