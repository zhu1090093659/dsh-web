/**
 * The usage statistics settings section: three tabs (用量: today's usage,
 * balances, trend; 个人套餐: per-provider plan quota windows; Token 银行:
 * the whale-yuan voucher minted from the DeepSeek official family's usage)
 * plus a compact settings row. Data comes from the host's loopback-fenced
 * /api/dsh-usage/overview document; polling runs only while the section is
 * mounted and the tab is visible.
 * @module @linxin666/dsh-usage/client/UsageSectionCard
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { UsageStoreInstance } from './usage-store.ts'
import { t } from './locales.ts'
import styles from './usage.module.css'
import { isDeepSeekProviderRoute } from '../core/adapters.ts'
import { deepseekPeriodAt } from '../core/pricing.ts'
import { deepseekVoucherData, drawVoucher, faceValue, formatDay, formatDenomination, loadVoucherArt } from './voucher.ts'
import type { ObservedSpendView, ProviderSnapshotView, UsageOverviewView, UsageProviderSummary, UsageTokenTotals, UsageWindowSummary } from '../core/types.ts'

/** The settings fields this section edits (immediate-apply semantics). */
export interface UsageSettings {
  enabled?: boolean
  pollIntervalSec?: number
}

/** The registration-side face the section's slot entry injects. */
export interface UsageSectionFace {
  /** The section-local store (overview snapshot + lifecycle). */
  store: UsageStoreInstance
  /** Fetch one overview now. */
  poll: () => void
  /** Force a host probe cycle now (resolves with the fresh overview). */
  refresh: () => void
  /** The shared configuration form this section's settings row reads and writes. */
  settings: ConfigForm<UsageSettings>
}

export interface UsageSectionProps extends UsageSectionFace {
  /** Close the settings panel (the shell owns the open state). */
  close: () => void
}

/** Poll cadence while the section is open. */
const SECTION_POLL_MS = 10_000

/** Compact token count: 12345 -> 12.3k, 1234567 -> 1.23M. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value < 1000) return String(value)
  if (value < 1_000_000) return trim(value / 1000) + 'k'
  if (value < 1_000_000_000) return trim(value / 1_000_000) + 'M'
  return trim(value / 1_000_000_000) + 'B'
}

function trim(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, '')
}

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString()
  } catch {
    return ''
  }
}

function formatClock(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Formatted CNY spend estimate (the only priced currency today). */
function formatCost(cost: number): string {
  return '¥' + cost.toFixed(2)
}

function toneClass(percent: number): string {
  if (percent >= 90) return styles.barLow
  if (percent >= 70) return styles.barWarn
  return styles.barFill
}

/** A provider row backed by a configured credential (api key, env key, or OAuth grant). */
function isConfigured(provider: ProviderSnapshotView): boolean {
  // An older wire document without the credential field renders as before.
  return provider.credential !== 'none'
}

function TotalsRow(props: { totals: UsageTokenTotals }): ReactNode {
  const { totals } = props
  return (
    <div className={styles.statRow}>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.total')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.input')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.outputTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.output')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.cacheReadTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.cacheRead')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.cacheWriteTokens)}</span>
        <span className={styles.statLabel}>{t('usage.tokens.cacheWrite')}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statValue}>{formatTokens(totals.calls)}</span>
        <span className={styles.statLabel}>{t('usage.calls', { n: totals.calls })}</span>
      </div>
    </div>
  )
}

function balanceLine(provider: ProviderSnapshotView): ReactNode {
  if (provider.balance !== undefined) {
    return <span className={styles.providerBalance}>{provider.balance.currency.toUpperCase() === 'CNY' ? '¥' : provider.balance.currency.toUpperCase() === 'USD' ? '$' : ''}{provider.balance.totalBalance}{provider.balance.currency.toUpperCase() !== 'CNY' && provider.balance.currency.toUpperCase() !== 'USD' ? ' ' + provider.balance.currency.toUpperCase() : ''}</span>
  }
  if (provider.credential === 'oauth') return <span className={styles.muted}>{t('usage.oauth')}</span>
  if (provider.credential === 'none') return <span className={styles.muted}>{t('usage.balance.noCredential')}</span>
  if (!provider.supported) return <span className={styles.muted}>{t('usage.balance.unsupported')}</span>
  return null
}

function ProviderRow(props: { provider: ProviderSnapshotView; current?: string }): ReactNode {
  const { provider, current } = props
  return (
    <div className={styles.providerRow} data-dsh-part="provider-row">
      <span className={styles.providerName}>
        {provider.displayName}
        {current === provider.provider && <span className={styles.currentBadge}>{t('usage.current')}</span>}
      </span>
      <span className={styles.providerTokens}>{balanceLine(provider)}</span>
    </div>
  )
}

/** The section component; the slot merges the face into these props. */
export function UsageSectionCard(props: UsageSectionProps): ReactNode {
  const { store, poll, refresh, settings } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const settingsSnapshot = settings.getSnapshot()
  const settingsValue = settingsSnapshot.value ?? {}
  const [tab, setTab] = useState<'usage' | 'plans' | 'bank'>('usage')
  const [refreshing, setRefreshing] = useState(false)
  // The enable checkbox writes through the shared form, so subscribing here
  // keeps the flag below live: the form republishes the Host's accepted value,
  // and the poll starts and stops with it instead of waiting for an unrelated
  // render.
  const [, bumpSettings] = useState(0)
  useEffect(() => settings.subscribe(() => bumpSettings((count) => count + 1)), [settings])
  const enabled = settingsValue.enabled ?? true

  // Poll while mounted, enabled and visible; the overview is cheap (no probes —
  // the host's own cycle owns those) so 10 s keeps balances fresh-ish between
  // manual refreshes.
  useEffect(() => {
    // A disabled plugin deregisters its host routes, so the poll must stop with
    // it; the section re-enables by writing the flag back through the checkbox.
    if (!enabled) return undefined
    poll()
    let timer: number | undefined
    const start = (): void => {
      if (timer === undefined && document.visibilityState === 'visible') timer = window.setInterval(poll, SECTION_POLL_MS)
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

  const snapshot = ui.snapshot

  const onRefresh = (): void => {
    setRefreshing(true)
    try {
      refresh()
    } finally {
      // The POST resolves through the next poll tick; unlock shortly either way.
      window.setTimeout(() => setRefreshing(false), 3000)
    }
  }

  // Disabled, failed and still-loading states keep the settings row mounted:
  // it owns the enable checkbox, so replacing the whole panel would leave the
  // user no way back from the UI.
  if (!enabled || ui.status === 'error' || snapshot === null) {
    return (
      <div className={styles.section} data-dsh-plugin="usage">
        <span className={styles.muted} data-dsh-part="status-line">
          {!enabled
            ? t('usage.disabled')
            : ui.status === 'error'
              ? t('usage.error', { error: ui.error ?? '' })
              : t('usage.loading')}
        </span>
        <SettingsRow settings={settings} snapshot={settingsSnapshot.status === 'ready' ? settingsSnapshot : undefined} value={settingsValue} />
      </div>
    )
  }

  const current = snapshot.current
  const currentProvider = snapshot.providers.find((provider) => provider.provider === current.provider)
  // Peak-period line: only when the official DeepSeek family is in play this
  // session (the current route, or spend recorded under one today).
  const deepseekPeriod = deepseekPeriodAt(Date.now())
  const deepseekVisible = (current.provider !== undefined && isDeepSeekProviderRoute(current.provider))
    || snapshot.usage.today.providers.some((row) => isDeepSeekProviderRoute(row.provider))
  // Plans tab: only configured routes with a real coding-plan/subscription
  // adapter (planSupported; an older host without the flag falls back to "has
  // a plan fact"). Balance-only providers (DeepSeek, ZenMux, ...) and
  // unconfigured routes (credential 'none') never appear here.
  const planProviders = snapshot.providers.filter((provider) => isConfigured(provider) && (provider.planSupported === true || (provider.planSupported === undefined && provider.plan !== undefined)))

  return (
    <div className={styles.section} data-dsh-plugin="usage">
      <div className={styles.header} data-dsh-part="header">
        <span className={styles.currentProvider}>
          {currentProvider !== undefined
            ? `${currentProvider.displayName}${current.model !== undefined && current.model !== '' ? ' · ' + current.model : ''}`
            : t('usage.noData')}
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.muted}>{t('usage.updated', { time: formatTime(snapshot.updatedAt) })}</span>
          <button type="button" className={styles.refreshBtn} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? t('usage.refreshing') : t('usage.refresh')}
          </button>
        </span>
      </div>

      <div className={styles.tabs} role="tablist" data-dsh-part="tabs">
        <button type="button" role="tab" aria-selected={tab === 'usage'} className={tab === 'usage' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab('usage')}>
          {t('usage.tab.usage')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'plans'} className={tab === 'plans' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab('plans')}>
          {t('usage.tab.plans')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'bank'} className={tab === 'bank' ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab('bank')}>
          {t('usage.tab.bank')}
        </button>
      </div>

      {tab === 'usage' && (
        <>
          <div className={styles.card} data-dsh-part="today-card">
            <span className={styles.cardTitle}>{t('usage.today')}</span>
            {deepseekVisible && (
              <span className={styles.muted} data-dsh-part="peak-status">
                {t(deepseekPeriod.peak ? 'usage.peak.on' : 'usage.peak.off', { time: formatClock(deepseekPeriod.boundaryMs) })}
              </span>
            )}
            {snapshot.usage.today.totals.calls === 0
              ? <span className={styles.muted}>{t('usage.noData')}</span>
              : <TotalsRow totals={snapshot.usage.today.totals} />}
            {snapshot.usage.today.totals.cost > 0 && (
              <div className={styles.providerRow} data-dsh-part="today-cost">
                <span className={styles.providerName}>{t('usage.today.cost')}</span>
                <span className={styles.providerTokens}>{formatCost(snapshot.usage.today.totals.cost)}</span>
              </div>
            )}
            {snapshot.usage.today.providers.length > 0 && (
              <div data-dsh-part="provider-list">
                {snapshot.usage.today.providers.map((row) => (
                  <div key={row.provider} className={styles.providerRow}>
                    <span className={styles.providerName}>
                      {snapshot.providers.find((provider) => provider.provider === row.provider)?.displayName ?? row.provider}
                      {current.provider === row.provider && <span className={styles.currentBadge}>{t('usage.current')}</span>}
                    </span>
                    <span className={styles.providerTokens}>{formatTokens(row.totals.inputTokens + row.totals.cacheReadTokens + row.totals.cacheWriteTokens + row.totals.outputTokens)} · {t('usage.calls', { n: row.totals.calls })}{row.totals.cost > 0 ? ` · ${formatCost(row.totals.cost)}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.card} data-dsh-part="balance-card">
            <span className={styles.cardTitle}>{t('usage.balance')}</span>
            {(() => {
              const configured = snapshot.providers.filter(isConfigured)
              const rows = configured.filter((provider) => provider.balanceSupported === true || (provider.balanceSupported === undefined && provider.supported))
              if (rows.length === 0) {
                return <span className={styles.muted}>{configured.length === 0 ? t('usage.balance.noneConfigured') : t('usage.balance.unsupported')}</span>
              }
              return rows.map((provider) => (
                <ProviderRow key={provider.provider} provider={provider} current={current.provider} />
              ))
            })()}
            {snapshot.providers.some((provider) => isConfigured(provider) && provider.error !== undefined) && (
              <span className={styles.errorLine}>
                {snapshot.providers.filter((provider) => isConfigured(provider) && provider.error !== undefined).map((provider) => `${provider.displayName}: ${t('usage.provider.error', { error: provider.error ?? '' })}`).join(t('usage.errorListSeparator'))}
              </span>
            )}
          </div>

          <RangeCard range={snapshot.usage.range} providers={snapshot.providers} currentProvider={current.provider} />

          <SettingsRow settings={settings} snapshot={settingsSnapshot.status === 'ready' ? settingsSnapshot : undefined} value={settingsValue} />
        </>
      )}

      {tab === 'plans' && (
        planProviders.length === 0
          ? <div className={styles.card}><span className={styles.muted}>{t('usage.plan.noneConfigured')}</span></div>
          : planProviders.map((provider) => <PlanCard key={provider.provider} provider={provider} current={current.provider} />)
      )}

      {tab === 'bank' && <VoucherCard window={snapshot.usage.all ?? snapshot.usage.range} observedSpend={snapshot.usage.observedSpend} />}
    </div>
  )
}

/** How many model sub-bars render under one provider bar. */
const CHART_MODEL_CAP = 3

/**
 * The 近 30 天 card: horizontal bars per provider over the trend window,
 * each with its heaviest models as nested sub-bars. Window totals come from
 * the host's aggregated `usage.range` (an older host without it renders no
 * card instead of a wrong one).
 */
function RangeCard(props: { range?: UsageOverviewView['usage']['range']; providers: ProviderSnapshotView[]; currentProvider?: string }): ReactNode {
  const { range, providers, currentProvider } = props
  if (range === undefined) return null
  const grandTotal = range.totals.inputTokens + range.totals.outputTokens + range.totals.cacheReadTokens + range.totals.cacheWriteTokens
  const maxProvider = Math.max(1, ...range.providers.map((row) => totalOf(row.totals)))
  const nameOf = (id: string): string => providers.find((provider) => provider.provider === id)?.displayName ?? id
  return (
    <div className={styles.card} data-dsh-part="trend-card">
      <span className={styles.cardTitle}>{t('usage.trend')}</span>
      {range.providers.length === 0 || grandTotal === 0
        ? <span className={styles.muted}>{t('usage.noData')}</span>
        : <div className={styles.chart} data-dsh-part="usage-chart">
            {range.providers.map((row) => (
              <ChartProviderRow key={row.provider} row={row} name={nameOf(row.provider)} max={maxProvider} current={currentProvider === row.provider} />
            ))}
            <span className={styles.trendAxis}>
              <span>{range.from.slice(5)}</span>
              <span>{range.to.slice(5)}</span>
            </span>
          </div>}
    </div>
  )
}

function ChartProviderRow(props: { row: UsageProviderSummary; name: string; max: number; current: boolean }): ReactNode {
  const { row, name, max, current } = props
  const total = totalOf(row.totals)
  const maxModel = Math.max(1, ...row.models.slice(0, CHART_MODEL_CAP).map((model) => totalOf(model.totals)))
  return (
    <div className={styles.chartProvider}>
      <span className={styles.chartHead}>
        <span className={styles.providerName}>
          {name}
          {current && <span className={styles.currentBadge}>{t('usage.current')}</span>}
        </span>
        <span className={styles.chartTokens}>{formatTokens(total)} · {t('usage.calls', { n: row.totals.calls })}</span>
      </span>
      <span className={styles.chartBar}>
        <span className={styles.chartFill} style={{ width: `${Math.max(2, Math.round((total / max) * 100))}%` }} />
      </span>
      {row.models.slice(0, CHART_MODEL_CAP).map((model) => {
        const modelTotal = totalOf(model.totals)
        return (
          <span key={model.model} className={styles.chartModel} title={`${row.provider} · ${model.model}: ${formatTokens(modelTotal)}`}>
            <span className={styles.chartModelName}>{model.model}</span>
            <span className={styles.chartModelBar}>
              <span className={styles.chartModelFill} style={{ width: `${Math.max(3, Math.round((modelTotal / maxModel) * 100))}%` }} />
            </span>
            <span className={styles.chartTokens}>{formatTokens(modelTotal)}</span>
          </span>
        )
      })}
    </div>
  )
}

function totalOf(totals: UsageTokenTotals): number {
  return totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens + totals.outputTokens
}

/**
 * The Token 银行 card: the DeepSeek official family's retained-ledger usage
 * minted onto the whale-yuan note at 1,000,000 tokens per whale yuan. The window
 * prefers the host's whole-ledger aggregate and falls back to the 30-day
 * trend when an older host serves no `all`; the spend line prefers the
 * official balance watch and falls back to the fold-time estimate; the
 * artwork draw failure degrades to an error line and never takes the
 * section down.
 */
function VoucherCard(props: { window?: UsageWindowSummary; observedSpend?: ObservedSpendView }): ReactNode {
  const { window: ledger, observedSpend } = props
  const data = deepseekVoucherData(ledger)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [drawError, setDrawError] = useState<string | undefined>(undefined)
  const dataKey = data === undefined ? '' : `${data.from}|${data.to}|${data.tokens}|${data.calls}|${data.cost}`

  useEffect(() => {
    if (data === undefined) return
    const voucher = data
    let cancelled = false
    loadVoucherArt().then((art) => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (canvas !== null) {
        try {
          drawVoucher(canvas, art, voucher)
        } catch (error) {
          if (!cancelled) setDrawError(error instanceof Error ? error.message : String(error))
        }
      }
    }, (error) => {
      if (!cancelled) setDrawError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
    }
  // dataKey covers every field the draw and the buttons read.
  }, [dataKey])

  const onSave = (): void => {
    const canvas = canvasRef.current
    if (canvas === null || data === undefined) return
    canvas.toBlob((blob) => {
      if (blob === null) return
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `dsh-whale-voucher-${data.to}.png`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }, 'image/png')
  }

  const shareSupported = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
  const onShare = (): void => {
    const canvas = canvasRef.current
    if (canvas === null || data === undefined || !shareSupported) return
    canvas.toBlob(async (blob) => {
      if (blob === null) return
      const file = new File([blob], `dsh-whale-voucher-${data.to}.png`, { type: 'image/png' })
      if (!navigator.canShare({ files: [file] })) return
      try {
        await navigator.share({ files: [file], title: t('usage.bank.title') })
      } catch {
        // A user-cancelled share sheet rejects; nothing to report.
      }
    }, 'image/png')
  }

  return (
    <div className={styles.card} data-dsh-part="bank-card">
      <span className={styles.cardTitle}>{t('usage.bank.title')}</span>
      {data === undefined
        ? <span className={styles.muted}>{t('usage.bank.noUsage')}</span>
        : <>
            <span className={styles.muted}>{t('usage.bank.hint')}</span>
            <div className={styles.voucherPreview} data-dsh-part="voucher-preview">
              <canvas ref={canvasRef} aria-label={t('usage.bank.title')} />
            </div>
            {drawError !== undefined && <span className={styles.errorLine}>{t('usage.bank.drawError', { error: drawError })}</span>}
            <div className={styles.providerRow}>
              <span className={styles.providerName}>{t('usage.bank.minted', { minted: formatDenomination(faceValue(data.tokens)), tokens: formatTokens(data.tokens) })}</span>
              <span className={styles.providerTokens}>{t('usage.calls', { n: data.calls })}</span>
            </div>
            <span className={styles.muted}>
              {observedSpend !== undefined
                ? t('usage.bank.spend.observed', { cost: observedSpend.cny.toFixed(2), since: formatDay(observedSpend.since) })
                : t('usage.bank.spend.estimated', { cost: data.cost.toFixed(2) })}
            </span>
            <span className={styles.muted}>{t('usage.bank.window', { from: data.from, to: data.to })}</span>
            <div className={styles.buttonRow}>
              <button type="button" className={styles.refreshBtn} onClick={onSave}>{t('usage.bank.save')}</button>
              {shareSupported && <button type="button" className={styles.refreshBtn} onClick={onShare}>{t('usage.bank.share')}</button>}
            </div>
          </>}
    </div>
  )
}

function PlanCard(props: { provider: ProviderSnapshotView; current?: string }): ReactNode {
  const { provider, current } = props
  return (
    <div className={`${styles.card} ${styles.planCard}`} data-dsh-part="plan-card">
      <div className={styles.planHead}>
        <span className={styles.planName}>
          {provider.displayName}
          {current === provider.provider && <span className={styles.currentBadge}>{t('usage.current')}</span>}
          {provider.plan?.planName !== undefined ? ` · ${provider.plan.planName}` : ''}
        </span>
      </div>
      {provider.error !== undefined && <span className={styles.errorLine}>{t('usage.provider.error', { error: provider.error })}</span>}
      {provider.credential === 'none' && provider.plan === undefined
        ? <span className={styles.muted}>{t('usage.balance.noCredential')}</span>
        : provider.plan === undefined || provider.plan.windows.length === 0
          ? <span className={styles.muted}>{t('usage.plan.noPlan')}</span>
          : provider.plan.windows.map((window) => (
            <div key={window.key} className={styles.windowRow} data-dsh-part="plan-window">
              <span className={styles.windowLabel}>
                <span>{window.name ?? t(`usage.plan.windows.${window.key}`)}</span>
                <span>{window.percent !== undefined ? `${window.percent >= 10 ? Math.round(window.percent) : window.percent.toFixed(1)}%` : ''}</span>
              </span>
              {window.percent !== undefined && (
                <span className={styles.bar}>
                  <span className={toneClass(window.percent)} style={{ width: `${Math.min(100, Math.max(0, window.percent))}%`, display: 'block' }} />
                </span>
              )}
              {window.resetsAt !== undefined && (
                <span className={styles.resetLine}>{t('usage.plan.reset', { date: new Date(window.resetsAt).toLocaleString() })}</span>
              )}
            </div>
          ))}
    </div>
  )
}

/**
 * The compact settings row. Both controls write through the shared form the
 * moment the user changes them, and the Host answers each write with a
 * boolean: a refused (or transport-failed) write is surfaced as a failed save,
 * because a value that did not land must never read as applied.
 */
function SettingsRow(props: {
  settings: UsageSectionProps['settings']
  snapshot?: ConfigFormSnapshot<UsageSettings>
  value: UsageSettings
}): ReactNode {
  const { settings, snapshot, value } = props
  const disabled = snapshot === undefined || !snapshot.writable
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const write = (field: 'enabled' | 'pollIntervalSec', next: boolean | number): void => {
    setFailure(undefined)
    let answer: Promise<boolean>
    try {
      answer = settings.set(field, next)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
      return
    }
    // false is the contract's refusal/skip answer (the Host rejected the value,
    // the entry is not writable, or the write was dropped); a rejecting
    // transport reports through the same failed-save surface.
    Promise.resolve(answer).then(
      (accepted) => { if (!accepted) setFailure('') },
      (error: unknown) => { setFailure(error instanceof Error ? error.message : String(error)) },
    )
  }

  return (
    <div className={styles.card} data-dsh-part="settings-row">
      <span className={styles.cardTitle}>{t('usage.config.title')}</span>
      <div className={styles.settingsGrid}>
        <label className={styles.settingItem}>
          <input
            type="checkbox"
            checked={value.enabled ?? true}
            disabled={disabled}
            onChange={(event) => { write('enabled', event.target.checked) }}
          />
          {t('usage.config.enabled')}
        </label>
        <label className={styles.settingItem}>
          {t('usage.config.pollIntervalSec')}
          <input
            type="number"
            min={30}
            max={3600}
            value={typeof value.pollIntervalSec === 'number' ? value.pollIntervalSec : 60}
            disabled={disabled}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              if (Number.isFinite(parsed) && parsed >= 30 && parsed <= 3600) write('pollIntervalSec', Math.round(parsed))
            }}
          />
        </label>
      </div>
      {failure !== undefined && (
        <span className={styles.errorLine} role="status">
          {t('usage.config.saveFailed')}{failure === '' ? '' : ' - ' + failure}
        </span>
      )}
    </div>
  )
}
