/**
 * Sidebar foot card: the compact usage glance seated below the shell sidebar's
 * Settings row. It is deliberately a GLANCE, not the panel the 2026-09-18
 * removal took out. Two states, persisted across reloads:
 *
 * - expanded (default): a price-first headline (today's estimated spend,
 *   falling back to today's tokens when nothing priced was recorded), a
 *   tokens/calls line, up to two configured-provider balances, and an
 *   updated-at footer;
 * - collapsed: a one-line strip with the gauge glyph, the spending
 *   provider's name, the label and the headline value.
 *
 * The card body is one button that opens the settings panel on the usage
 * section, so detail lives in exactly one place; the corner chevron toggles
 * the collapse state (sibling buttons — buttons inside a button are invalid
 * HTML).
 *
 * Data comes from the same shared store the settings section reads; the card
 * runs its own relaxed poll loop (30 s, visible-tab only) because the sidebar
 * foot is permanently mounted. The card disappears while the plugin is
 * disabled (settings flag) or while the host serves no usage routes (a 404
 * means the host half is off), matching the section's own gating.
 * @module @linxin666/dsh-usage/client/UsageFootCard
 */

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { t } from './locales.ts'
import styles from './usage.module.css'
import { formatTokens, type UsageSettings } from './UsageSectionCard.tsx'
import { totalTokens } from '../core/ledger.ts'
import type { BalanceView, ProviderSnapshotView, UsageOverviewView } from '../core/types.ts'
import type { UsageStoreInstance } from './usage-store.ts'

/** Props the mount forwards into the React tree. */
export interface UsageFootCardProps {
  /** The shared overview store (section and card read the same snapshot). */
  store: UsageStoreInstance
  /** Fetch one overview now. */
  poll: () => void
  /** Card-body click: open the settings panel on the usage section. */
  onOpen: () => void
  /** The shared settings form; the card hides while the plugin is disabled. */
  settings: ConfigForm<UsageSettings>
  /** Locale-change source; the plain copy re-renders on a language switch. */
  locale?: { subscribe(listener: () => void): () => void }
}

/** Poll cadence of the permanently seated card; the section's 10 s loop stays its own. */
export const FOOT_CARD_POLL_MS = 30_000

/** localStorage key holding the collapsed flag ('1' = collapsed strip). */
export const FOOT_CARD_COLLAPSED_KEY = 'dsh-usage.foot-card.collapsed'

/** At most this many provider balances render before a +N overflow marker. */
const BALANCE_CAP = 2

/** Read the persisted collapsed flag (absent = expanded). */
export function readFootCardCollapsed(): boolean {
  try {
    return window.localStorage.getItem(FOOT_CARD_COLLAPSED_KEY) === '1'
  } catch {
    // Storage can be unavailable (privacy modes); the card stays expanded.
    return false
  }
}

/** Persist the collapsed flag; storage failures keep the session state. */
function writeFootCardCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(FOOT_CARD_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Storage unavailable: the state still flips for this session.
  }
}

/** Inline gauge glyph, 14px beside the card title. */
function GaugeIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12.5a7 7 0 0 1 11 -4.3" />
      <path d="M8 12.5V8.2l2.9-2.1" />
      <circle cx="8" cy="12.5" r="1" />
    </svg>
  )
}

/** Disclosure chevrons: down collapses the expanded card, up expands the strip. */
function ChevronIcon(props: { collapsed: boolean }): ReactNode {
  return props.collapsed
    ? (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m4 10 4-4 4 4" />
      </svg>
    )
    : (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m4 6 4 4 4-4" />
      </svg>
    )
}

/** A provider row worth showing a balance for: configured, with a probed balance. */
function balanceRow(provider: ProviderSnapshotView): boolean {
  const supported = provider.balanceSupported === true || (provider.balanceSupported === undefined && provider.supported)
  return provider.credential !== 'none' && supported && provider.balance !== undefined
}

/** Currency-symbol prefix for the priced balances (CNY/USD), else the ISO code. */
function formatBalance(balance: BalanceView): string {
  const currency = balance.currency.toUpperCase()
  if (currency === 'CNY') return '¥' + balance.totalBalance
  if (currency === 'USD') return '$' + balance.totalBalance
  return currency + ' ' + balance.totalBalance
}

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Display name of the provider owning today's priced spend: the day's highest
 * cost row, else the current session route, resolved through the provider
 * snapshot (an older host without the day rows falls back to the current
 * route). Undefined when there is no route to name.
 */
function spendProvider(snapshot: UsageOverviewView): string | undefined {
  let top: UsageOverviewView['usage']['today']['providers'][number] | undefined
  for (const row of snapshot.usage.today.providers) {
    if (row.totals.cost <= 0) continue
    if (top === undefined || row.totals.cost > top.totals.cost) top = row
  }
  const route = top?.provider ?? snapshot.current.provider
  if (route === undefined) return undefined
  return snapshot.providers.find((entry) => entry.provider === route)?.displayName
    ?? (route === snapshot.current.provider ? snapshot.current.displayName : undefined)
    ?? route
}

/**
 * The headline triple: today's priced spend, else today's tokens, else zero.
 * tokenFallback tells the sub-line to keep only the call count instead of
 * repeating the total the headline already shows; provider names the spender
 * beside the collapsed cost headline.
 */
function headline(snapshot: UsageOverviewView): { label: string; value: string; tokenFallback: boolean; provider?: string } {
  const totals = snapshot.usage.today.totals
  if (totals.cost > 0) return { label: t('usage.foot.cost'), value: '¥' + totals.cost.toFixed(2), tokenFallback: false, provider: spendProvider(snapshot) }
  if (totals.calls > 0) return { label: t('usage.today'), value: formatTokens(totalTokens(totals)) + ' tokens', tokenFallback: true }
  return { label: t('usage.foot.cost'), value: '¥0.00', tokenFallback: false }
}

/** The tokens/calls sub-line under the headline; a quiet no-data line on an empty day. */
function usageLine(snapshot: UsageOverviewView, tokenFallback: boolean): string {
  const totals = snapshot.usage.today.totals
  if (totals.calls === 0) return t('usage.foot.noData')
  const calls = t('usage.calls', { n: totals.calls })
  return tokenFallback ? calls : formatTokens(totalTokens(totals)) + ' tokens · ' + calls
}

/** The balance line: up to BALANCE_CAP providers plus a +N overflow marker. */
function balanceLine(snapshot: UsageOverviewView): string | undefined {
  const rows = snapshot.providers.filter(balanceRow)
  if (rows.length === 0) return undefined
  const shown = rows.slice(0, BALANCE_CAP).map((provider) => provider.displayName + ' ' + formatBalance(provider.balance!))
  return shown.join(' · ') + (rows.length > BALANCE_CAP ? ' +' + String(rows.length - BALANCE_CAP) : '')
}

/** Card chrome classes for the current collapse state. */
function cardClass(collapsed: boolean): string {
  return collapsed ? styles.footCard + ' ' + styles.footCardCollapsed : styles.footCard
}

/**
 * Render the foot card content for the current store snapshot.
 * @param props - store, poller, settings form and open callback from the mount.
 * @returns the card, or null while disabled / host-off.
 */
export function UsageFootCard(props: UsageFootCardProps): ReactNode {
  const { store, poll, onOpen, settings, locale } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  // Settings writes and locale switches both re-render the card's copy/visibility.
  const [, bump] = useState(0)
  useEffect(() => settings.subscribe(() => bump((count) => count + 1)), [settings])
  useEffect(() => locale?.subscribe(() => bump((count) => count + 1)), [locale])
  const enabled = settings.getSnapshot().value?.enabled ?? true

  // The collapse choice is one localStorage flag, read at mount and persisted
  // on every flip (the old sidebar strip used the same contract shape).
  const [collapsed, setCollapsed] = useState(readFootCardCollapsed)
  const toggleCollapsed = (): void => {
    setCollapsed((current) => {
      writeFootCardCollapsed(!current)
      return !current
    })
  }

  // The permanently seated card pays a relaxed cadence; a hidden tab pauses.
  useEffect(() => {
    if (!enabled) return undefined
    poll()
    let timer: number | undefined
    const start = (): void => {
      if (timer === undefined && document.visibilityState === 'visible') timer = window.setInterval(poll, FOOT_CARD_POLL_MS)
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        poll()
        start()
      } else if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll, enabled])

  if (!enabled) return null
  const snapshot = ui.snapshot
  // A 404 means the host half serves no usage routes (plugin off): the card
  // bows out instead of pinning a permanent error to the sidebar foot.
  if (snapshot === null && ui.status === 'error' && /failed: 404/.test(ui.error ?? '')) return null

  const toggle = (
    <button
      type="button"
      className={styles.footToggle}
      data-dsh-part="foot-card-toggle"
      aria-label={t(collapsed ? 'usage.foot.expand' : 'usage.foot.collapse')}
      title={t(collapsed ? 'usage.foot.expand' : 'usage.foot.collapse')}
      onClick={toggleCollapsed}
    >
      <ChevronIcon collapsed={collapsed} />
    </button>
  )

  if (snapshot === null) {
    const quiet = ui.status === 'error' ? t('usage.error', { error: ui.error ?? '' }) : t('usage.loading')
    return (
      <div className={cardClass(collapsed)} data-dsh-plugin="usage" data-dsh-part="foot-card">
        <button type="button" className={styles.footMain} data-dsh-part="foot-card-main" aria-label={t('usage.foot.open')} title={t('usage.foot.open')} onClick={onOpen}>
          {collapsed
            ? <span className={styles.footStrip} data-dsh-part="foot-card-strip"><GaugeIcon /><span className={styles.footStripValue}>—</span></span>
            : (
              <>
                <span className={styles.footHead}>
                  <span className={styles.footTitle}><GaugeIcon />{t('usage.title')}</span>
                </span>
                <span className={styles.footLine}>{quiet}</span>
              </>
            )}
        </button>
        {toggle}
      </div>
    )
  }

  const head = headline(snapshot)
  const balances = balanceLine(snapshot)

  if (collapsed) {
    return (
      <div className={cardClass(true)} data-dsh-plugin="usage" data-dsh-part="foot-card">
        <button type="button" className={styles.footMain} data-dsh-part="foot-card-main" aria-label={t('usage.foot.open')} title={t('usage.foot.open')} onClick={onOpen}>
          <span className={styles.footStrip} data-dsh-part="foot-card-strip">
            <GaugeIcon />
            {head.provider !== undefined && <span className={styles.footStripProvider}>{head.provider}</span>}
            <span className={styles.footStripLabel}>{head.label}</span>
            <span className={styles.footStripValue}>{head.value}</span>
          </span>
        </button>
        {toggle}
      </div>
    )
  }

  return (
    <div className={cardClass(false)} data-dsh-plugin="usage" data-dsh-part="foot-card">
      <button type="button" className={styles.footMain} data-dsh-part="foot-card-main" aria-label={t('usage.foot.open')} title={t('usage.foot.open')} onClick={onOpen}>
        <span className={styles.footHead}>
          <span className={styles.footTitle}><GaugeIcon />{head.label}</span>
          <span className={styles.footValue}>{head.value}</span>
        </span>
        <span className={styles.footLine} data-dsh-part="foot-card-usage">{usageLine(snapshot, head.tokenFallback)}</span>
        {balances !== undefined && <span className={styles.footLine} data-dsh-part="foot-card-balances">{balances}</span>}
        <span className={styles.footMeta}>{t('usage.updated', { time: formatClock(snapshot.updatedAt) })}</span>
      </button>
      {toggle}
    </div>
  )
}
