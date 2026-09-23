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
import { type UsageStoreInstance, type UsageUiState } from '../src/client/usage-store.ts'
import { emptyTotals, type ProviderSnapshotView, type UsageOverviewView } from '../src/core/types.ts'

afterEach(cleanup)

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

/**
 * Form fake over one effective section: writes are recorded and answered by
 * the caller's policy, so a test drives the section's controls exactly the way
 * the shared form contract answers them (`true` accepted, `false` refused).
 * `publish` stands in for a Host answer that replaces the effective section.
 */
function fakeForm(policy: {
  value?: UsageSettings
  writable?: boolean
  answer?: (field: string, value: unknown) => boolean | Promise<boolean>
} = {}): { form: ConfigForm<UsageSettings>; writes: Array<[string, unknown]>; publish: (patch: UsageSettings) => void } {
  const writes: Array<[string, unknown]> = []
  let listeners: Array<() => void> = []
  const snapshot = (current: UsageSettings): ConfigFormSnapshot<UsageSettings> => ({
    status: 'ready',
    value: current,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: policy.writable ?? true,
    mode: 'host',
  })
  let held = snapshot(policy.value ?? {})
  const form = {
    getSnapshot: () => held,
    subscribe: (listener: () => void) => {
      listeners.push(listener)
      return () => { listeners = listeners.filter((candidate) => candidate !== listener) }
    },
    set: (field: string, next: unknown) => {
      writes.push([field, next])
      return Promise.resolve(policy.answer?.(field, next) ?? true)
    },
    unset: () => Promise.resolve(false),
    mutate: () => Promise.resolve(false),
  }
  return {
    form: form as unknown as ConfigForm<UsageSettings>,
    writes,
    publish: (patch) => {
      held = snapshot({ ...held.value, ...patch })
      for (const listener of [...listeners]) listener()
    },
  }
}

function cardProps(snapshot: UsageOverviewView): ComponentProps<typeof UsageSectionCard> {
  return {
    store: fakeStore({ snapshot, status: 'ready', error: null }),
    poll: () => {},
    refresh: () => {},
    settings,
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

  it('user sees the none-configured empty states when no provider has a credential', () => {
    // Given a catalog in which no provider carries a credential
    const unconfigured = [
      provider({ provider: 'zenmux', displayName: 'ZenMux', balanceSupported: true }),
      provider({ provider: 'openai-codex', displayName: 'Codex', planSupported: true }),
    ]
    render(<UsageSectionCard {...cardProps(overview(unconfigured))} />)
    // When the balance card renders
    // Then the balance card reports nothing configured rather than an empty table
    expect(screen.getAllByText('没有已配置的提供方')).toHaveLength(1)
    // And the plans tab reports the same for plan providers
    fireEvent.click(screen.getByRole('tab', { name: '个人套餐' }))
    expect(screen.getAllByText('没有已配置的套餐类 provider（如 Kimi、GLM、OpenCode Go、MiniMax、Codex 订阅）')).toHaveLength(1)
  })
})

describe('Token 银行 tab', () => {
  it('user sees the empty state when the DeepSeek official family has no usage', () => {
    // Given an overview whose DeepSeek official family has no usage
    render(<UsageSectionCard {...cardProps(overview([]))} />)
    // When the user opens the Token 银行 tab
    fireEvent.click(screen.getByRole('tab', { name: 'Token 银行' }))
    // Then the bank reports the missing official usage and offers no save button
    expect(screen.getByText('暂无 DeepSeek 官方用量数据（统计自插件启用起）').textContent).toBe('暂无 DeepSeek 官方用量数据（统计自插件启用起）')
    expect(screen.queryByRole('button', { name: '保存图片' })).toBeNull()
  })

  it('user gets the voucher minted from the whole-ledger rows with save offered and no share without canShare', () => {
    // Given a whole-ledger aggregate of 1,234,567 tokens across the official family
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
    // Then the voucher mints 1 whale yuan at the 1,000,000:1 exchange rate and reports the folded ledger
    expect(screen.getByText('累计铸造 1 鲸元（1.23M tokens）').textContent).toBe('累计铸造 1 鲸元（1.23M tokens）')
    expect(screen.getByText('消费估算：约 ¥3.50').textContent).toBe('消费估算：约 ¥3.50')
    expect(screen.getByText('12 次调用').textContent).toBe('12 次调用')
    expect(screen.getByText('统计窗口 2025-12-01 ~ 2026-01-01').textContent).toBe('统计窗口 2025-12-01 ~ 2026-01-01')
    // And save is offered while share stays hidden without navigator.canShare
    expect(screen.getByRole('button', { name: '保存图片' }).textContent).toBe('保存图片')
    expect(screen.queryByRole('button', { name: '分享' })).toBeNull()
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

/**
 * #1500: disabling the plugin deregisters the host routes, so the panel must
 * stop polling, say why, and keep the enable checkbox reachable — the earlier
 * panel-wide error return left no way back from the UI.
 */
describe('UsageSectionCard disabled and failed states', () => {
  it('stops polling and keeps the enable checkbox while the plugin is disabled', () => {
    const poll = vi.fn()
    const live = fakeForm({ value: { enabled: false } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} poll={poll} settings={live.form} />)
    expect(poll).not.toHaveBeenCalled()
    expect(screen.getByText(/插件已停用/)).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()
  })

  it('resumes polling once the Host reports the plugin enabled again', () => {
    const poll = vi.fn()
    const live = fakeForm({ value: { enabled: false } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} poll={poll} settings={live.form} />)
    expect(poll).not.toHaveBeenCalled()
    act(() => { live.publish({ enabled: true }) })
    expect(poll).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/插件已停用/)).toBeNull()
  })

  it('keeps the settings controls mounted when the overview transport fails', () => {
    const failing = fakeStore({ snapshot: null, status: 'error', error: 'usage /api/dsh-usage/overview failed: 500' })
    render(<UsageSectionCard {...cardProps(overview(mixed))} store={failing} />)
    expect(screen.getByText(/failed: 500/)).toBeTruthy()
    expect(screen.getByRole('checkbox')).toBeTruthy()
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
    render(<UsageSectionCard {...cardProps(overview(mixed))} settings={live.form} />)
    // The checkbox starts from the form's effective value and writes the toggle.
    fireEvent.click(screen.getByRole('checkbox'))
    expect(live.writes).toEqual([['enabled', false]])
    await waitFor(() => { expect(screen.getByText(/保存失败/)).toBeTruthy() })
  })

  it('surfaces a rejecting transport with its own message', async () => {
    const live = fakeForm({ value: { enabled: true }, answer: () => Promise.reject(new Error('settings bridge unreachable')) })
    render(<UsageSectionCard {...cardProps(overview(mixed))} settings={live.form} />)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => { expect(screen.getByText(/保存失败.*settings bridge unreachable/)).toBeTruthy() })
  })

  it('reports no failure for an accepted write', async () => {
    const live = fakeForm({ value: { enabled: true } })
    render(<UsageSectionCard {...cardProps(overview(mixed))} settings={live.form} />)
    fireEvent.click(screen.getByRole('checkbox'))
    await act(async () => { await Promise.resolve() })
    expect(live.writes).toEqual([['enabled', false]])
    expect(screen.queryByText(/保存失败/)).toBeNull()
  })

  it('writes the rounded poll interval and keeps out-of-range drafts off the wire', () => {
    const live = fakeForm()
    render(<UsageSectionCard {...cardProps(overview(mixed))} settings={live.form} />)
    const interval = screen.getByRole('spinbutton')
    fireEvent.change(interval, { target: { value: '120' } })
    expect(live.writes).toEqual([['pollIntervalSec', 120]])
    fireEvent.change(interval, { target: { value: '10' } })
    expect(live.writes).toEqual([['pollIntervalSec', 120]])
  })
})
