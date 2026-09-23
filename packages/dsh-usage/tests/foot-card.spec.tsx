/** @vitest-environment jsdom */

/**
 * The sidebar foot card's content rules: a price-first headline (today's
 * estimated spend, falling back to today's tokens when nothing priced was
 * recorded), the tokens/calls line, at most two configured-provider balances
 * with a +N overflow, and the visibility gates (settings flag off or a 404
 * host answer hides the card; other failures keep the last snapshot).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { FOOT_CARD_COLLAPSED_KEY, UsageFootCard, type UsageFootCardProps } from '../src/client/UsageFootCard.tsx'
import type { UsageSettings } from '../src/client/UsageSectionCard.tsx'
import type { UsageStoreInstance, UsageUiState } from '../src/client/usage-store.ts'
import { emptyTotals, type ProviderSnapshotView, type UsageOverviewView } from '../src/core/types.ts'

/** Previous localStorage descriptor, restored after each test. */
let originalStorage: PropertyDescriptor | undefined

/**
 * Ensure a working Web Storage backing store. jsdom supplies one, but on
 * Node >= 23 the runtime's own flag-less localStorage shadows it (vitest's
 * populateGlobal keeps the pre-existing global), so a standards-shaped
 * in-memory store takes its place for this spec; CI on Node 22 keeps the
 * jsdom original.
 */
function installStorage(): PropertyDescriptor | undefined {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  if (typeof window.localStorage?.setItem === 'function') return original
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return store.size },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => { store.set(name, value) },
      removeItem: (name: string) => { store.delete(name) },
      clear: () => { store.clear() },
    },
  })
  return original
}

beforeEach(() => {
  originalStorage = installStorage()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  document.documentElement.lang = ''
  if (originalStorage !== undefined) Object.defineProperty(globalThis, 'localStorage', originalStorage)
})

/** A wire provider row with view defaults; callers override the credential. */
function provider(row: Partial<ProviderSnapshotView> & Pick<ProviderSnapshotView, 'provider'>): ProviderSnapshotView {
  return { displayName: row.provider, credential: 'none', supported: true, ...row }
}

/** A minimal overview document; the today bucket and provider list are the caller's. */
function overview(providers: ProviderSnapshotView[], today: Partial<UsageOverviewView['usage']['today']['totals']> = {}): UsageOverviewView {
  return {
    updatedAt: 1_700_000_000_000,
    providers,
    current: { provider: 'deepseek', model: '', source: 'live' },
    usage: {
      today: { date: '2026-01-01', totals: { ...emptyTotals(), ...today }, providers: [] },
      days: [],
      range: { from: '2026-01-01', to: '2026-01-01', totals: emptyTotals(), providers: [] },
    },
  }
}

/** A mutable store fake; set() republishes to the subscribed component. */
function fakeStore(initial: UsageUiState): { store: UsageStoreInstance; set: (next: UsageUiState) => void } {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    store: {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getSnapshot: () => state,
    } as unknown as UsageStoreInstance,
    set: (next: UsageUiState) => {
      state = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A settings-form fake over one effective value; publish() stands in for a Host answer. */
function fakeForm(initial: UsageSettings = {}): { form: ConfigForm<UsageSettings>; publish: (patch: UsageSettings) => void } {
  const listeners = new Set<() => void>()
  const snapshot = (value: UsageSettings): ConfigFormSnapshot<UsageSettings> => ({
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  })
  let held = snapshot(initial)
  return {
    form: {
      getSnapshot: () => held,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: () => Promise.resolve(true),
      unset: () => Promise.resolve(false),
      mutate: () => Promise.resolve(false),
    } as unknown as ConfigForm<UsageSettings>,
    publish: (patch) => {
      held = snapshot({ ...held.value, ...patch })
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A locale source whose listeners the test fires by hand. */
function fakeLocale(): { locale: NonNullable<UsageFootCardProps['locale']>; emit: () => void } {
  const listeners = new Set<() => void>()
  return {
    locale: {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
    emit: () => { for (const listener of [...listeners]) listener() },
  }
}

function cardProps(over: UsageOverviewView | null, extra: Partial<UsageFootCardProps> = {}): UsageFootCardProps {
  return {
    store: fakeStore({ snapshot: over, status: over === null ? 'loading' : 'ready', error: null }).store,
    poll: () => {},
    onOpen: () => {},
    settings: fakeForm().form,
    ...extra,
  }
}

const deepseekBalance = provider({ provider: 'deepseek', displayName: 'DeepSeek', credential: 'env', balanceSupported: true, balance: { currency: 'CNY', totalBalance: '42.00', updatedAt: 1 } })

describe('UsageFootCard content', () => {
  it('user sees today spend with the tokens and calls line', () => {
    // Given an overview whose today bucket carries priced DeepSeek usage
    document.documentElement.lang = 'zh'
    const over = overview([deepseekBalance], { inputTokens: 10_000, outputTokens: 2300, calls: 45, cost: 12.34 })

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the headline is the spend, with the compact tokens/calls line under it
    const card = container.querySelector('[data-dsh-part="foot-card"]')
    expect(card?.textContent).toContain('¥12.34')
    expect(card?.textContent).toContain('今日消费')
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')?.textContent).toBe('12.3k tokens · 45 次调用')
  })

  it('user sees the token headline when nothing today was priced', () => {
    // Given an overview with unpriced usage only (cost stays 0)
    document.documentElement.lang = 'zh'
    const over = overview([], { inputTokens: 3000, calls: 3 })

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the headline falls back to today's tokens under the usage label,
    // and the sub-line keeps only the call count instead of repeating the total
    const card = container.querySelector('[data-dsh-part="foot-card"]')
    expect(card?.textContent).toContain('今日用量')
    expect(card?.textContent).toContain('3k tokens')
    expect(card?.textContent).not.toContain('¥0.00')
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')?.textContent).toBe('3 次调用')
  })

  it('user sees zero spend and the no-data line on a day without usage', () => {
    // Given an overview with an empty today bucket
    document.documentElement.lang = 'zh'
    const over = overview([deepseekBalance])

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the headline reads zero and the quiet no-data line replaces the counts
    const card = container.querySelector('[data-dsh-part="foot-card"]')
    expect(card?.textContent).toContain('¥0.00')
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')?.textContent).toBe('今日暂无用量')
  })

  it('user sees at most two balances with an overflow count', () => {
    // Given three configured providers with probed balances
    document.documentElement.lang = 'zh'
    const over = overview([
      deepseekBalance,
      provider({ provider: 'zenmux', displayName: 'ZenMux', credential: 'api-key', balanceSupported: true, balance: { currency: 'USD', totalBalance: '3.10', updatedAt: 1 } }),
      provider({ provider: 'openrouter', displayName: 'OpenRouter', credential: 'api-key', balanceSupported: true, balance: { currency: 'USD', totalBalance: '9.99', updatedAt: 1 } }),
    ])

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the first two balances render with their symbols and the third folds into +1
    const line = container.querySelector('[data-dsh-part="foot-card-balances"]')?.textContent
    expect(line).toBe('DeepSeek ¥42.00 · ZenMux $3.10 +1')
  })

  it('user never sees balances of unconfigured providers', () => {
    // Given one unconfigured catalog row whose balance field is stale data
    document.documentElement.lang = 'zh'
    const over = overview([provider({ provider: 'zenmux', balance: { currency: 'USD', totalBalance: '3.10', updatedAt: 1 } })])

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then no balance line reaches the card
    expect(container.querySelector('[data-dsh-part="foot-card-balances"]')).toBeNull()
  })

  it('user opens the usage settings section from the card', () => {
    // Given a rendered card
    document.documentElement.lang = 'zh'
    let opened = 0
    const { container } = render(<UsageFootCard {...cardProps(overview([]), { onOpen: () => { opened += 1 } })} />)

    // When the user clicks the card body
    const card = container.querySelector<HTMLButtonElement>('[data-dsh-part="foot-card-main"]')
    fireEvent.click(card!)

    // Then the open callback fires once and the card stays rendered
    expect(opened).toBe(1)
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('今日消费')
  })

  it('user reads the card in English after a language switch', () => {
    // Given a zh-rendered card wired to a locale source
    document.documentElement.lang = 'zh'
    const locale = fakeLocale()
    const over = overview([], { inputTokens: 10_000, outputTokens: 2300, calls: 45, cost: 12.34 })
    const { container } = render(<UsageFootCard {...cardProps(over, { locale: locale.locale })} />)
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('今日消费')

    // When the document language switches to English
    document.documentElement.lang = 'en'
    act(() => { locale.emit() })

    // Then the card copy follows without a reload
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('Today spend')
  })
})

describe('UsageFootCard visibility gates', () => {
  it('user loses the card while the plugin is disabled and gets it back on enable', () => {
    // Given a rendered card whose settings flag is on
    document.documentElement.lang = 'zh'
    const form = fakeForm({ enabled: true })
    const { container } = render(<UsageFootCard {...cardProps(overview([]), { settings: form.form })} />)
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('今日暂无用量')

    // When the Host answers with the plugin disabled
    act(() => { form.publish({ enabled: false }) })

    // Then the card leaves the sidebar foot
    expect(container.querySelector('[data-dsh-part="foot-card"]')).toBeNull()

    // When the user re-enables the plugin
    act(() => { form.publish({ enabled: true }) })

    // Then the card returns
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('今日暂无用量')
  })

  it('user sees no card while the host serves no usage routes', () => {
    // Given the overview endpoint answering 404 (the host half is off)
    document.documentElement.lang = 'zh'
    const store = fakeStore({ snapshot: null, status: 'error', error: 'usage /api/dsh-usage/overview failed: 404' })

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(null, { store: store.store })} />)

    // Then the card bows out instead of pinning a permanent error to the foot
    expect(container.querySelector('[data-dsh-part="foot-card"]')).toBeNull()
  })

  it('user reads the load failure on the card when no snapshot exists yet', () => {
    // Given a transport failure before the first snapshot (not a 404)
    document.documentElement.lang = 'zh'
    const store = fakeStore({ snapshot: null, status: 'error', error: 'network unreachable' })

    // When the foot card renders
    const { container } = render(<UsageFootCard {...cardProps(null, { store: store.store })} />)

    // Then the card stays clickable and carries the failure line
    const card = container.querySelector('[data-dsh-part="foot-card"]')
    expect(card?.textContent).toContain('加载失败：network unreachable')
  })

  it('user keeps the last snapshot when a later poll fails', () => {
    // Given a rendered card with data whose next poll fails
    document.documentElement.lang = 'zh'
    const store = fakeStore({ snapshot: overview([], { calls: 2, cost: 1.5, inputTokens: 100 }), status: 'ready', error: null })
    const { container } = render(<UsageFootCard {...cardProps(null, { store: store.store })} />)

    // When the store flips to the error state but keeps the snapshot
    act(() => { store.set({ snapshot: overview([], { calls: 2, cost: 1.5, inputTokens: 100 }), status: 'error', error: 'network unreachable' }) })

    // Then the card still shows the last good numbers
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('¥1.50')
  })
})


describe('UsageFootCard collapse state', () => {
  it('user collapses the card to a one-line strip and expands it back', () => {
    // Given a rendered expanded card with priced usage
    document.documentElement.lang = 'zh'
    const over = overview([deepseekBalance], { inputTokens: 10_000, outputTokens: 2300, calls: 45, cost: 12.34 })
    const { container } = render(<UsageFootCard {...cardProps(over)} />)
    expect(container.querySelector('[data-dsh-part="foot-card"]')?.textContent).toContain('12.3k tokens')

    // When the user clicks the corner toggle
    fireEvent.click(container.querySelector('[data-dsh-part="foot-card-toggle"]')!)

    // Then the card folds into a strip keeping the label and the spend, and the
    // choice is persisted
    const strip = container.querySelector('[data-dsh-part="foot-card-strip"]')
    expect(strip?.textContent).toContain('今日消费')
    expect(strip?.textContent).toContain('¥12.34')
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')).toBeNull()
    expect(container.querySelector('[data-dsh-part="foot-card-balances"]')).toBeNull()
    expect(window.localStorage.getItem(FOOT_CARD_COLLAPSED_KEY)).toBe('1')

    // When the user clicks the toggle again
    fireEvent.click(container.querySelector('[data-dsh-part="foot-card-toggle"]')!)

    // Then the full card returns and the flag clears
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')?.textContent).toBe('12.3k tokens · 45 次调用')
    expect(window.localStorage.getItem(FOOT_CARD_COLLAPSED_KEY)).toBe('0')
  })

  it('user reads the spending provider to the left of the collapsed spend label', () => {
    // Given a collapsed card whose priced day row belongs to DeepSeek
    document.documentElement.lang = 'zh'
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, '1')
    const over = overview([deepseekBalance], { calls: 45, cost: 12.34 })
    over.usage.today.providers = [
      { provider: 'deepseek', totals: { ...emptyTotals(), calls: 45, cost: 12.34 }, models: [] },
    ]

    // When the card renders collapsed
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the provider name sits before the spend label in the strip
    const text = container.querySelector('[data-dsh-part="foot-card-strip"]')?.textContent ?? ''
    expect(text.indexOf('DeepSeek')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('DeepSeek')).toBeLessThan(text.indexOf('今日消费'))
    expect(text).toContain('¥12.34')
  })

  it('user reads no provider name when the collapsed headline falls back to tokens', () => {
    // Given a collapsed card with unpriced usage only
    document.documentElement.lang = 'zh'
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, '1')
    const over = overview([deepseekBalance], { inputTokens: 3000, calls: 3 })

    // When the card renders collapsed
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then the token headline names no spender
    const text = container.querySelector('[data-dsh-part="foot-card-strip"]')?.textContent ?? ''
    expect(text).toContain('今日用量')
    expect(text).not.toContain('DeepSeek')
  })

  it('user collapse choice survives a remount', () => {
    // Given a persisted collapsed flag
    document.documentElement.lang = 'zh'
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, '1')
    const over = overview([deepseekBalance], { calls: 45, cost: 12.34 })

    // When the card remounts
    const { container } = render(<UsageFootCard {...cardProps(over)} />)

    // Then it remounts as the strip, and expanding clears the flag
    expect(container.querySelector('[data-dsh-part="foot-card-strip"]')?.textContent).toContain('¥12.34')
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')).toBeNull()
    fireEvent.click(container.querySelector('[data-dsh-part="foot-card-toggle"]')!)
    expect(container.querySelector('[data-dsh-part="foot-card-usage"]')?.textContent).toContain('45 次调用')
    expect(window.localStorage.getItem(FOOT_CARD_COLLAPSED_KEY)).toBe('0')
  })

  it('user opens the usage settings section from the collapsed strip', () => {
    // Given a collapsed card
    document.documentElement.lang = 'zh'
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, '1')
    let opened = 0
    const over = overview([], { calls: 2, cost: 1.5 })
    const { container } = render(<UsageFootCard {...cardProps(over, { onOpen: () => { opened += 1 } })} />)

    // When the user clicks the strip body
    fireEvent.click(container.querySelector('[data-dsh-part="foot-card-main"]')!)

    // Then the open callback fires and the strip stays collapsed
    expect(opened).toBe(1)
    expect(container.querySelector('[data-dsh-part="foot-card-strip"]')?.textContent).toContain('¥1.50')
  })

  it('user reads the loading and error states as a quiet strip while collapsed', () => {
    // Given a collapsed card whose first fetch is still in flight
    document.documentElement.lang = 'zh'
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, '1')

    // When the card renders
    const { container } = render(<UsageFootCard {...cardProps(null)} />)

    // Then the strip renders a neutral placeholder instead of the loading prose
    expect(container.querySelector('[data-dsh-part="foot-card-strip"]')?.textContent).toContain('—')
  })
})
