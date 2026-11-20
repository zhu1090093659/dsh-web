/** @vitest-environment jsdom */

/**
 * The section card's configured-provider filter: the balance card and the
 * plans tab render only providers with a resolved credential
 * (credential !== 'none'); unconfigured catalog routes never render, stale
 * unconfigured error lines neither, and the balance card distinguishes
 * "nothing configured" from "configured but no balance endpoint".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { UsageSectionCard, type UsageSettings } from '../src/client/UsageSectionCard.tsx'
import { UsageSettingsCardController, type UsageSettingsCardFace } from '../src/client/usage-settings-card.ts'
import { type UsageStoreInstance, type UsageUiState } from '../src/client/usage-store.ts'
import { emptyTotals, type ProviderSnapshotView, type UsageDayView, type UsageOverviewView } from '../src/core/types.ts'

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
})

/** A wire provider row with view defaults; callers override the credential. */
function provider(row: Partial<ProviderSnapshotView> & Pick<ProviderSnapshotView, 'provider'>): ProviderSnapshotView {
  return { displayName: row.provider, credential: 'none', supported: true, ...row }
}

/** A minimal overview document: no ledger usage, one current route. */
function overview(providers: ProviderSnapshotView[]): UsageOverviewView {
  return {
    updatedAt: 1_700_000_000_000,
    providers,
    current: { provider: 'deepseek', model: '', source: 'live' },
    usage: {
      today: { date: '2026-01-01', totals: emptyTotals(), providers: [] },
      days: [],
      range: { from: '2026-01-01', to: '2026-01-01', totals: emptyTotals(), providers: [] },
    },
  }
}

/** Stable-reference store fake (a fresh object per getSnapshot would loop useSyncExternalStore). */
function fakeStore(state: UsageUiState): UsageStoreInstance {
  return { subscribe: () => () => {}, getSnapshot: () => state } as unknown as UsageStoreInstance
}

const settings = fakeForm().form

/** The settings card the section reads, over one form; the plugin body builds the same. */
function cardOf(form: ConfigForm<UsageSettings>): UsageSettingsCardFace {
  return new UsageSettingsCardController(form).inject()
}

/**
 * Form fake over one effective section: each written field is recorded and the
 * mutation is answered by the caller's policy, so a test drives the section's
 * controls exactly the way the shared form contract answers them (`true`
 * accepted and folded into the section, `false` refused). `publish` stands in
 * for a Host answer that replaces the effective section.
 */
function fakeForm(policy: {
  value?: UsageSettings
  writable?: boolean
  answer?: (field: string, value: unknown) => boolean | Promise<boolean>
} = {}): { form: ConfigForm<UsageSettings>; writes: Array<[string, unknown]>; publish: (patch: UsageSettings) => void } {
  const writes: Array<[string, unknown]> = []
  let listeners: Array<() => void> = []
  const snapshot = (current: UsageSettings, user?: UsageSettings): ConfigFormSnapshot<UsageSettings> => ({
    status: 'ready',
    value: current,
    base: undefined,
    user,
    revision: 1,
    writable: policy.writable ?? true,
  })
  let held = snapshot(policy.value ?? {})
  const form = {
    getSnapshot: () => held,
    subscribe: (listener: () => void) => {
      listeners.push(listener)
      return () => { listeners = listeners.filter((candidate) => candidate !== listener) }
    },
    set: () => Promise.resolve(false),
    unset: () => Promise.resolve(false),
    mutate: async (ops: ReadonlyArray<{ op: 'set' | 'unset'; path: readonly string[]; value?: unknown }>) => {
      for (const op of ops) writes.push([op.path[0] ?? '', op.value])
      const answers = await Promise.all(ops.map((op) => policy.answer?.(op.path[0] ?? '', op.value) ?? true))
      if (!answers.every(Boolean)) return false
      fold(Object.fromEntries(ops.map((op) => [op.path[0] ?? '', op.value])))
      return true
    },
  }
  // An accepted write lands in the user layer, which is where the card reads it back.
  const fold = (patch: UsageSettings): void => {
    held = snapshot({ ...held.value, ...patch }, { ...(held.user as UsageSettings | undefined), ...patch })
    for (const listener of [...listeners]) listener()
  }
  return {
    form: form as unknown as ConfigForm<UsageSettings>,
    writes,
    publish: (patch) => {
      held = snapshot({ ...held.value, ...patch }, held.user as UsageSettings | undefined)
      for (const listener of [...listeners]) listener()
    },
  }
}

/** The day route double: answers the date it is asked for, zeroed by default. */
function dayStub(day: Partial<UsageDayView> = {}): (date: string) => Promise<UsageDayView> {
  return async (date: string) => ({ date, totals: emptyTotals(), providers: [], ...day })
}

function cardProps(snapshot: UsageOverviewView, loadDay: (date: string) => Promise<UsageDayView> = dayStub()): ComponentProps<typeof UsageSectionCard> {
  return {
    store: fakeStore({ snapshot, status: 'ready', error: null }),
    poll: () => {},
    refresh: () => {},
    loadDay,
    settingsCard: cardOf(settings),
    close: () => {},
  } as unknown as ComponentProps<typeof UsageSectionCard>
}

/** One configured balance provider, one configured plan provider, two unconfigured rows. */
const mixed = [
  provider({ provider: 'deepseek', displayName: 'DeepSeek', credential: 'env', balanceSupported: true, balance: { currency: 'CNY', totalBalance: '42.00', updatedAt: 1 } }),
  provider({ provider: 'kimi-coding', displayName: 'Kimi For Coding', credential: 'api-key', planSupported: true, plan: { windows: [{ key: '5h', percent: 12.5 }], updatedAt: 1 } }),
  provider({ provider: 'zenmux', displayName: 'ZenMux', balanceSupported: true }),
  provider({ provider: 'openai-codex', displayName: 'Codex', planSupported: true, error: 'HTTP 401' }),
]

describe('UsageSectionCard configured-provider filter', () => {
  it('user sees only configured providers in the balance card', () => {
    // Given a balance-capable provider with a credential, a plan-only provider,
    // and two catalog rows without one
    // When the balance card renders
    render(<UsageSectionCard {...cardProps(overview(mixed))} />)
    // Then one row renders per configured provider (the balance-capable one and
    // the credential-bearing plan-only one), and no unconfigured route or stale
    // error line reaches the card
    expect(document.querySelectorAll('[data-dsh-part="provider-row"]')).toHaveLength(2)
    expect(screen.getByText('¥42.00').textContent).toBe('¥42.00')
    expect(screen.queryByText('ZenMux')).toBeNull()
    expect(screen.queryByText('未配置凭据')).toBeNull()
    expect(screen.queryByText(/HTTP 401/)).toBeNull()
  })

  it('user sees only configured plan providers on the plans tab', () => {
    // Given the same providers, one of which reports a plan window
    render(<UsageSectionCard {...cardProps(overview(mixed))} />)
    // When the user opens the plans tab
    fireEvent.click(screen.getByRole('tab', { name: '个人套餐' }))
    // Then only the provider that reported a plan is listed
    expect(screen.getAllByText('Kimi For Coding')).toHaveLength(1)
    expect(screen.queryByText('ZenMux')).toBeNull()
    expect(screen.queryByText('Codex')).toBeNull()
  })

  it('user sees the dictionary label for Codex in a non-Chinese locale', () => {
    // Given a configured Codex plan whose host payload still carries a legacy Chinese label
    document.documentElement.lang = 'ru'
    const codex = provider({
      provider: 'openai-codex',
      displayName: '代码助手 (ChatGPT)',
      credential: 'oauth',
      planSupported: true,
      plan: { windows: [{ key: '5h', percent: 12.5 }], updatedAt: 1 },
    })
    render(<UsageSectionCard {...cardProps(overview([codex]))} />)
    // When the user opens the plans tab
    fireEvent.click(screen.getByRole('tab', { name: 'Plans' }))
    // Then the client replaces the host label with its dictionary entry
    expect(screen.getAllByText('Codex (ChatGPT)')).toHaveLength(1)
    expect(screen.queryByText('代码助手 (ChatGPT)')).toBeNull()
  })

  it('user sees the none-configured empty states when no provider has a credential', () => {
    // Given a catalog in which no provider carries a credential
    const unconfigured = [
      provider({ provider: 'zenmux', displayName: 'ZenMux', balanceSupported: true }),
      provider({ provider: 'openai-codex', displayName: 'Codex', planSupported: true }),
    ]
    render(<UsageSectionCard {...cardProps(overview(unconfigured))} />)
    // When the balance card renders
    // Then the balance card reports nothing configured rather than an empty table
    expect(screen.getAllByText('还没有配置提供方')).toHaveLength(1)
    // And the plans tab reports the same for plan providers
    fireEvent.click(screen.getByRole('tab', { name: '个人套餐' }))
    expect(screen.getAllByText('没有配置套餐类提供方，例如 Kimi、GLM、OpenCode Go、MiniMax、Codex 订阅。')).toHaveLength(1)
  })
})

describe('Token 银行 tab', () => {
  it('user sees the empty state when the ledger holds no usage', () => {
    // Given an overview whose ledger holds no usage at all
    render(<UsageSectionCard {...cardProps(overview([]))} />)
    // When the user opens the Token 银行 tab
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // Then the bank reports the missing usage and offers no save button
    expect(screen.getByText('暂无用量数据').textContent).toBe('暂无用量数据')
    expect(screen.queryByRole('button', { name: '保存图片' })).toBeNull()
  })

  it('user gets the voucher minted from the whole-ledger rows with save offered and no share without canShare', () => {
    // Given a whole-ledger aggregate of 1,234,567 tokens on one official row and
    // 999,999 tokens on a coding-subscription row, which now mints too
    const snapshot = overview([])
    snapshot.usage.all = {
      from: '2025-12-01',
      to: '2026-01-01',
      totals: emptyTotals(),
      providers: [
        { provider: 'deepseek', totals: { ...emptyTotals(), inputTokens: 1_000_000, outputTokens: 234_567, calls: 12, cost: 3.5 }, models: [] },
        { provider: 'kimi-coding', totals: { ...emptyTotals(), inputTokens: 999_999, calls: 5 }, models: [] },
      ],
    }
    render(<UsageSectionCard {...cardProps(snapshot)} />)
    // When the user opens the Token 银行 tab
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // Then the voucher mints 2 whale yuan from both providers at the 1,000,000:1
    // exchange rate and reports the merged calls beside the priced spend
    expect(screen.getByText('累计铸造 2 鲸元（2.23M tokens）').textContent).toBe('累计铸造 2 鲸元（2.23M tokens）')
    expect(screen.getByText('消费估算：约 ¥3.50').textContent).toBe('消费估算：约 ¥3.50')
    expect(screen.getByText('17 次调用').textContent).toBe('17 次调用')
    expect(screen.getByText('统计窗口 2025-12-01 ~ 2026-01-01').textContent).toBe('统计窗口 2025-12-01 ~ 2026-01-01')
    // And save is offered while share stays hidden without navigator.canShare
    expect(screen.getByRole('button', { name: '保存图片' }).textContent).toBe('保存图片')
    expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
  })

  // Every provider mints, so a profile whose largest route is a relay gateway
  // (the #1831 MiMo report) mints from it; the spend line still excludes it.
  it('user gets a non-official route minted beside the official family while the spend line stays the official estimate', () => {
    // Given a whole-ledger aggregate holding a relay route and one official
    // route; the relay row also carries a non-zero cost, which a host with no
    // price book for it never stamps and the bank must still refuse to fold
    // into the spend line
    const snapshot = overview([])
    snapshot.usage.all = {
      from: '2026-01-01',
      to: '2026-01-01',
      totals: emptyTotals(),
      providers: [
        { provider: 'mimo', totals: { ...emptyTotals(), inputTokens: 3_000_000, calls: 9, cost: 9.99 }, models: [] },
        { provider: 'deepseek-official', totals: { ...emptyTotals(), inputTokens: 500_000, calls: 1, cost: 0.1 }, models: [] },
      ],
    }
    render(<UsageSectionCard {...cardProps(snapshot)} />)
    // When the user opens the Token 银行 tab
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // Then its tokens and calls mint with the official ones
    expect(screen.getByText('累计铸造 4 鲸元（3.5M tokens）').textContent).toBe('累计铸造 4 鲸元（3.5M tokens）')
    expect(screen.getByText('10 次调用').textContent).toBe('10 次调用')
    // And the spend line stays the official family's fold-time estimate
    expect(screen.getByText('消费估算：约 ¥0.10').textContent).toBe('消费估算：约 ¥0.10')
    expect(screen.queryByText(/¥10\.09/)).toBeNull()
  })

  it('user sees the official balance watch preferred over the fold-time estimate for the spend line', () => {
    // Given a 50k-token official row and an observed balance spend of ¥12.50
    const snapshot = overview([])
    snapshot.usage.all = {
      from: '2026-01-01',
      to: '2026-01-01',
      totals: emptyTotals(),
      providers: [{ provider: 'deepseek', totals: { ...emptyTotals(), inputTokens: 50_000, calls: 2, cost: 0.1 }, models: [] }],
    }
    snapshot.usage.observedSpend = { cny: 12.5, since: new Date(2026, 0, 2, 12).getTime() }
    render(<UsageSectionCard {...cardProps(snapshot)} />)
    // When the user opens the Token 银行 tab
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // Then the spend line reports the observed balance watch and drops the fold-time estimate
    expect(screen.getByText('累计铸造 1 鲸元（50k tokens）').textContent).toBe('累计铸造 1 鲸元（50k tokens）')
    expect(screen.getByText('官方余额实测花费 ¥12.50（自 2026-01-02 起）').textContent).toBe('官方余额实测花费 ¥12.50（自 2026-01-02 起）')
    expect(screen.queryByText(/消费估算/)).toBeNull()
  })

  it('falls back to the 30-day trend window when an older host serves no all aggregate', () => {
    const snapshot = overview([])
    snapshot.usage.range = {
      from: '2026-01-01',
      to: '2026-01-01',
      totals: emptyTotals(),
      providers: [{ provider: 'deepseek-official', totals: { ...emptyTotals(), inputTokens: 5000, calls: 2, cost: 0.01 }, models: [] }],
    }
    render(<UsageSectionCard {...cardProps(snapshot)} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    expect(screen.getByText('统计窗口 2026-01-01 ~ 2026-01-01')).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存图片' })).toBeTruthy()
  })
})

describe('day pickers', () => {
  it('user sees one recorded past day instead of today on the usage tab', async () => {
    // Given an overview listing two recorded days and today's live totals
    const snapshot = overview([provider({ provider: 'kimi-coding', displayName: 'Kimi For Coding', credential: 'api-key' })])
    snapshot.usage.today = { date: '2026-01-02', totals: { ...emptyTotals(), inputTokens: 10, calls: 1 }, providers: [] }
    snapshot.usage.availableDays = ['2026-01-01', '2026-01-02']
    const loadDay = vi.fn(dayStub({
      totals: { ...emptyTotals(), inputTokens: 4242, outputTokens: 8, calls: 3 },
      providers: [{ provider: 'kimi-coding', totals: { ...emptyTotals(), inputTokens: 4242, outputTokens: 8, calls: 3 }, models: [] }],
    }))
    render(<UsageSectionCard {...cardProps(snapshot, loadDay)} />)
    // When the user picks the older day
    await act(async () => {
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-01-01' } })
    })
    // Then the card shows that day's own title, totals and provider row, and no longer today's
    expect(loadDay).toHaveBeenCalledWith('2026-01-01')
    expect(screen.getByText('2026-01-01 用量').textContent).toBe('2026-01-01 用量')
    expect(screen.getByText('4.24k').textContent).toBe('4.24k')
    expect(screen.getByText('4.25k · 3 次调用').textContent).toBe('4.25k · 3 次调用')
    expect(screen.queryByText('今日用量')).toBeNull()
    // And switching back to today is served by the live overview, with no second fetch
    await act(async () => {
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-01-02' } })
    })
    expect(screen.getByText('今日用量').textContent).toBe('今日用量')
    expect(loadDay).toHaveBeenCalledTimes(1)
  })

  it('user mints the whale-yuan voucher from one picked day instead of the whole ledger', async () => {
    // Given a whole-ledger aggregate worth five whale yuan and a host day worth one
    const snapshot = overview([])
    snapshot.usage.today = { date: '2026-01-02', totals: emptyTotals(), providers: [] }
    snapshot.usage.availableDays = ['2026-01-01', '2026-01-02']
    snapshot.usage.all = {
      from: '2025-12-01',
      to: '2026-01-02',
      totals: emptyTotals(),
      providers: [{ provider: 'deepseek', totals: { ...emptyTotals(), inputTokens: 5_000_000, calls: 40 }, models: [] }],
    }
    snapshot.usage.observedSpend = { cny: 9.9, since: new Date(2025, 11, 1, 12).getTime() }
    const loadDay = dayStub({
      totals: { ...emptyTotals(), inputTokens: 1_000_000, calls: 4, cost: 1.25 },
      providers: [{ provider: 'deepseek', totals: { ...emptyTotals(), inputTokens: 1_000_000, calls: 4, cost: 1.25 }, models: [] }],
    })
    render(<UsageSectionCard {...cardProps(snapshot, loadDay)} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // The whole retained ledger is the default window
    expect(screen.getByText('统计窗口 2025-12-01 ~ 2026-01-02').textContent).toBe('统计窗口 2025-12-01 ~ 2026-01-02')
    expect(screen.getByText('累计铸造 5 鲸元（5M tokens）').textContent).toBe('累计铸造 5 鲸元（5M tokens）')
    // When the user picks one day
    await act(async () => {
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-01-01' } })
    })
    // Then the note mints that day alone, and the cumulative balance watch drops
    // off the spend line because it never described a single day
    expect(screen.getByText('统计窗口 2026-01-01 ~ 2026-01-01').textContent).toBe('统计窗口 2026-01-01 ~ 2026-01-01')
    expect(screen.getByText('累计铸造 1 鲸元（1M tokens）').textContent).toBe('累计铸造 1 鲸元（1M tokens）')
    expect(screen.getByText('消费估算：约 ¥1.25').textContent).toBe('消费估算：约 ¥1.25')
    expect(screen.queryByText(/官方余额实测花费/)).toBeNull()
  })

  it('user falls back to today when the picked day ages out of the retention window', async () => {
    // Given two recorded days and a section that has selected the older one
    const snapshot = overview([])
    snapshot.usage.today = { date: '2026-01-02', totals: { ...emptyTotals(), inputTokens: 7, calls: 1 }, providers: [] }
    snapshot.usage.availableDays = ['2026-01-01', '2026-01-02']
    let held: UsageUiState = { snapshot, status: 'ready', error: null }
    const live = { subscribe: () => () => {}, getSnapshot: () => held } as unknown as UsageStoreInstance
    const loadDay = vi.fn(dayStub({ totals: { ...emptyTotals(), inputTokens: 4242, calls: 3 } }))
    const view = render(<UsageSectionCard {...cardProps(snapshot, loadDay)} store={live} />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-01-01' } })
    })
    expect(screen.getByText('2026-01-01 用量').textContent).toBe('2026-01-01 用量')
    // When a retention shrink drops that day and the next poll republishes
    const pruned = overview([])
    pruned.usage.today = snapshot.usage.today
    pruned.usage.availableDays = ['2026-01-02']
    held = { snapshot: pruned, status: 'ready', error: null }
    view.rerender(<UsageSectionCard {...cardProps(snapshot, loadDay)} store={live} />)
    // Then the card is back on today rather than on a day the host no longer holds
    expect(screen.getByText('今日用量').textContent).toBe('今日用量')
  })

  it('user sees a failed day load as its own error instead of a stale day', async () => {
    // Given a host whose day route rejects
    const snapshot = overview([])
    snapshot.usage.today = { date: '2026-01-02', totals: { ...emptyTotals(), inputTokens: 7, calls: 1 }, providers: [] }
    snapshot.usage.availableDays = ['2026-01-01', '2026-01-02']
    const failing = vi.fn(async () => { throw new Error('usage day failed: 500') })
    render(<UsageSectionCard {...cardProps(snapshot, failing)} />)
    // When the user picks the older day
    await act(async () => {
      fireEvent.change(screen.getByLabelText('查看日期'), { target: { value: '2026-01-01' } })
    })
    // Then the card reports the failed load and shows no totals of any day
    expect(screen.getByText('该日用量加载失败：usage day failed: 500').textContent).toBe('该日用量加载失败：usage day failed: 500')
    expect(screen.queryByText('7')).toBeNull()
  })
})

/**
 * #1500: disabling the plugin deregisters the host routes, so the page must
 * stop polling, say why, and keep the switch reachable — the earlier
 * panel-wide error return left no way back from the UI.
 */
describe('UsageSectionCard disabled and failed states', () => {
  it('stops polling and keeps the header switch while the plugin is disabled', () => {
    const poll = vi.fn()
    const live = fakeForm({ value: { enabled: false } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} poll={poll} settingsCard={cardOf(live.form)} />)
    expect(poll).not.toHaveBeenCalled()
    expect(screen.getByText(/已停用/)).toBeTruthy()
    expect(screen.getByRole('switch', { name: '使用统计' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('resumes polling once the Host reports the plugin enabled again', () => {
    const poll = vi.fn()
    const live = fakeForm({ value: { enabled: false } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} poll={poll} settingsCard={cardOf(live.form)} />)
    expect(poll).not.toHaveBeenCalled()
    act(() => { live.publish({ enabled: true }) })
    expect(poll).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/已停用/)).toBeNull()
  })

  it('keeps the settings controls mounted when the overview transport fails', () => {
    const failing = fakeStore({ snapshot: null, status: 'error', error: 'usage /api/dsh-usage/overview failed: 500' })
    render(<UsageSectionCard {...cardProps(overview(mixed))} store={failing} />)
    expect(screen.getByText(/failed: 500/)).toBeTruthy()
    expect(screen.getByRole('switch', { name: '使用统计' })).toBeTruthy()
    expect(screen.getByLabelText('轮询间隔（秒）')).toBeTruthy()
  })
})

/**
 * The shared form contract answers each write with a boolean: `false` is a
 * refusal or a skipped write (the value never reached the Host document), and a
 * dead transport rejects. Neither may read as a successful save.
 */
describe('UsageSectionCard settings writes', () => {
  it('surfaces a Host-refused write as a failed save', async () => {
    const live = fakeForm({ value: { enabled: true }, answer: () => false })
    render(<UsageSectionCard {...cardProps(overview(mixed))} settingsCard={cardOf(live.form)} />)
    // The switch starts from the form's effective value and writes the flip.
    fireEvent.click(screen.getByRole('switch', { name: '使用统计' }))
    await waitFor(() => { expect(screen.getByText(/没有保存成功/)).toBeTruthy() })
    expect(live.writes).toEqual([['enabled', false]])
    // The refused flip springs back, so the switch still reads on
    expect(screen.getByRole('switch', { name: '使用统计' }).getAttribute('aria-checked')).toBe('true')
  })

  it('surfaces a rejecting transport with its own message', async () => {
    const live = fakeForm({ value: { enabled: true }, answer: () => Promise.reject(new Error('settings bridge unreachable')) })
    render(<UsageSectionCard {...cardProps(overview(mixed))} settingsCard={cardOf(live.form)} />)
    fireEvent.click(screen.getByRole('switch', { name: '使用统计' }))
    await waitFor(() => { expect(screen.getByText(/没有保存成功.*settings bridge unreachable/)).toBeTruthy() })
  })

  it('reports no failure for an accepted write', async () => {
    const live = fakeForm({ value: { enabled: true } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} settingsCard={cardOf(live.form)} />)
    fireEvent.click(screen.getByRole('switch', { name: '使用统计' }))
    await waitFor(() => { expect(live.writes).toEqual([['enabled', false]]) })
    expect(screen.queryByText(/没有保存成功/)).toBeNull()
  })

  it('writes the typed poll interval on Enter and keeps out-of-range drafts off the wire', async () => {
    const live = fakeForm()
    render(<UsageSectionCard {...cardProps(overview(mixed))} settingsCard={cardOf(live.form)} />)
    const interval = screen.getByLabelText('轮询间隔（秒）')
    fireEvent.change(interval, { target: { value: '120' } })
    fireEvent.keyDown(interval, { key: 'Enter' })
    await waitFor(() => { expect(live.writes).toEqual([['pollIntervalSec', 120]]) })
    fireEvent.change(interval, { target: { value: '10' } })
    fireEvent.keyDown(interval, { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(live.writes).toEqual([['pollIntervalSec', 120]])
  })

  it('user switching the display currency gets the chosen currency and rate written', async () => {
    // Given the settings rows, which offer no rate while spend shows in yuan
    const live = fakeForm()
    render(<UsageSectionCard {...cardProps(overview(mixed))} settingsCard={cardOf(live.form)} />)
    expect(screen.queryByLabelText('汇率')).toBeNull()

    // When the user switches the display currency to USD and enters a rate
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    await waitFor(() => { expect(live.writes).toEqual([['spendCurrency', 'USD']]) })
    const rate = screen.getByLabelText('汇率')
    fireEvent.change(rate, { target: { value: '7.15' } })
    fireEvent.keyDown(rate, { key: 'Enter' })

    // Then both go on the wire, and an unusable rate draft stays off it
    await waitFor(() => { expect(live.writes).toEqual([['spendCurrency', 'USD'], ['cnyPerUsd', 7.15]]) })
    fireEvent.change(screen.getByLabelText('汇率'), { target: { value: '0' } })
    fireEvent.keyDown(screen.getByLabelText('汇率'), { key: 'Enter' })
    await act(async () => { await Promise.resolve() })
    expect(live.writes).toEqual([['spendCurrency', 'USD'], ['cnyPerUsd', 7.15]])
  })
})

/**
 * The peak line the usage tab shows for the official DeepSeek family: the same
 * red/green marker the sidebar foot card carries, with the priced sentence in
 * the line itself. Instants are fixed so the assertions never depend on when
 * the suite runs.
 */
describe('peak marker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('user reads the peak window sentence in the red state while it runs', () => {
    // Given the clock stands at Friday 10:00 Beijing time, inside a peak window
    document.documentElement.lang = 'zh'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T02:00:00Z'))

    // When the usage tab renders for a session on the DeepSeek route
    render(<UsageSectionCard {...cardProps(overview([provider({ provider: 'deepseek', displayName: 'DeepSeek', credential: 'env' })]))} />)

    // Then the line states the peak pricing and carries the red state
    const line = document.querySelector('[data-dsh-part="peak-status"]')
    expect(line?.getAttribute('data-peak')).toBe('on')
    expect(line?.textContent).toContain('高峰时段：计价 ×2')
  })

  it('user reads the off-peak sentence in the green state on a weekend', () => {
    // Given the clock stands at Saturday 10:00 Beijing time
    document.documentElement.lang = 'zh'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T02:00:00Z'))

    // When the usage tab renders for a session on the DeepSeek route
    render(<UsageSectionCard {...cardProps(overview([provider({ provider: 'deepseek', displayName: 'DeepSeek', credential: 'env' })]))} />)

    // Then the line states the off-peak pricing and carries the green state
    const line = document.querySelector('[data-dsh-part="peak-status"]')
    expect(line?.getAttribute('data-peak')).toBe('off')
    expect(line?.textContent).toContain('空闲时段')
  })
})
