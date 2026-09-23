/**
 * The dsh-usage host service: folds live session usage into the persistent
 * ledger, probes each configured provider's balance/coding-plan endpoint on
 * a poll cycle, and serves the current provider's strip-ready view inside
 * the overview document. Secrets stay in the host process; the browser only
 * ever sees the overview document.
 * @module @linxin666/dsh-usage/host/usage-service
 */

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { dshHome } from '../dsh-home.ts'
import { adapterFor, isDeepSeekProviderRoute, providerErrorMessage } from '../core/adapters.ts'
import type { BalanceParse, PlanParse } from '../core/adapters.ts'
import { foldAliasRoutes } from '../core/provider-routes.ts'
import { deepseekModelSpend } from '../core/pricing.ts'
import { createLedgerDocument, deserializeLedger, foldUsage, ledgerDayKeys, localDateKey, pruneLedger, summarizeDays, totalTokens } from '../core/ledger.ts'
import type { BalanceView, CredentialKind, ObservedSpendView, PlanView, ProviderSnapshotState, ProviderSnapshotView, UsageLedgerDocument, UsageOverviewView, UsageTokenTotals } from '../core/types.ts'
import { addTotals, emptyTotals } from '../core/types.ts'

/**
 * Persisted accrual state for the official DeepSeek family's real spend:
 * consecutive observations of the official CNY balance, decreases counted
 * as spent (a rise is a top-up and never accrues). `since` is the first
 * observation; the ledger keeps no such fact, so this watch is the only
 * source of the voucher's observed-spend figure.
 */
export interface SpendWatch {
  /** Total observed decrease since `since`, in CNY. */
  accruedCny: number
  /** Epoch ms of the first balance observation. */
  since: number
  /** The balance the previous observation ended on, when one exists. */
  lastBalanceCny?: number
}

/** Per-route credential fact the probes run against. */
interface ResolvedCredential {
  kind: CredentialKind
  /** The probe secret: an API key, or an OAuth access token for oauth-aware adapters. */
  key?: string
  /** Provider account id riding a dedicated header, when the credential carries one. */
  accountId?: string
}

/** One LLM provider route the service knows about. */
interface ProviderRoute {
  id: string
  displayName: string
  /** Whether the LLM runtime serves requests on this route; a catalog-only entry is dormant. */
  live: boolean
}

/** Poll-loop options; re-applied live on settings change. */
export interface UsageServiceOptions {
  pollIntervalSec: number
  retainDays: number
}

/** Probe timeout per HTTP call. */
const PROBE_TIMEOUT_MS = 10_000

/** Ledger flush debounce. */
const FLUSH_DEBOUNCE_MS = 3_000

/** How many trend days the overview serves. */
const TREND_DAYS = 30

/** Best-effort typed service read: absent services resolve to undefined at runtime. */
function service<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx as unknown as { get(name: string): unknown }).get(name) as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Atomic JSON write through a unique temp file + fsync + rename. The temp
 * name is per-call so two overlapping flushes can never interleave into one
 * temp file, and the fsync closes the rename-lands-but-bytes-are-not-durable
 * window.
 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(JSON.stringify(value, null, 1), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * Read a foreign settings namespace's resolved value (the llm adapter
 * profiles, the agent default model). Unregistered namespaces read as
 * undefined; nothing here throws into the poll loop.
 */
function readNamespace(ctx: Context, ns: string): unknown {
  try {
    const settings = service<{ get(ns: unknown): unknown }>(ctx, 'settings')
    if (settings === undefined) return undefined
    return settings.get(ns)
  } catch {
    return undefined
  }
}

export class UsageService {
  private readonly ctx: Context
  private options: UsageServiceOptions
  private readonly persistDir: string
  private readonly ledgerPath: string
  private readonly snapshotsPath: string

  private ledger: UsageLedgerDocument = createLedgerDocument()
  private readonly snapshots = new Map<string, ProviderSnapshotState>()
  /** The official DeepSeek family's real-spend watch (see SpendWatch). */
  private spendWatch: SpendWatch | undefined
  /** Per-live-session route attribution (WeakMap: disposed sessions age out). */
  private readonly sessionRoutes = new WeakMap<Session, { provider: string; model: string }>()
  /** The most recent route seen this boot; the sidebar strip and the header highlight follow it. */
  private current: { provider?: string; model?: string; source: 'live' | 'default' } = { source: 'default' }

  private sessionListenerDisposer: (() => void) | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private pollInFlight = false
  /** The running poll cycle; manual refresh joins it instead of no-oping. */
  private pollPromise: Promise<void> | undefined
  /** Serialized ledger flushes: overlapping debounce/stop flushes queue, never interleave. */
  private flushChain: Promise<void> = Promise.resolve()
  /** True once loadPersisted finished; nothing may overwrite the files before that. */
  private loaded = false
  private disposed = false
  /** Last prune guard: once per local day, and whenever retention shrinks. */
  private lastPrune: { dayKey: string; retainDays: number } | undefined

  constructor(ctx: Context, options: UsageServiceOptions) {
    this.ctx = ctx
    this.options = options
    this.persistDir = join(dshHome(), 'dsh-usage')
    this.ledgerPath = join(this.persistDir, 'usage-ledger.json')
    this.snapshotsPath = join(this.persistDir, 'provider-snapshots.json')
  }

  /** Start the listeners, load persisted state, and arm the first poll. */
  start(): void {
    this.sessionListenerDisposer = this.ctx.on('session/event', (session, event) => this.onSessionEvent(session, event))
    void this.loadPersisted()
    this.rearmPoll(2_000)
  }

  /**
   * Stop timers and flush pending ledger writes. The returned promise
   * resolves after the final flush lands, so a successor instance (the Host
   * reloads the profile row on a config change) can serialize its first load
   * behind it.
   */
  stop(): Promise<void> {
    this.disposed = true
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.sessionListenerDisposer?.()
    return this.flushLedger()
  }

  /** Re-apply options to this running instance; retention shrink prunes now. */
  applyOptions(options: UsageServiceOptions): void {
    this.options = options
    this.pruneIfNeeded()
  }

  /** Force one poll now (manual refresh route); joins an in-flight cycle. */
  async refresh(): Promise<void> {
    await this.pollNow()
  }

  /** Assemble the overview document the browser section renders. */
  overview(): UsageOverviewView {
    const todayKey = localDateKey(Date.now())
    const routes = this.listProviderRoutes()
    const providers: ProviderSnapshotView[] = []
    for (const route of routes) {
      const adapter = adapterFor(route.id)
      const snapshot = this.snapshots.get(route.id)
      const error = snapshot?.balanceError ?? snapshot?.planError
      providers.push({
        provider: route.id,
        displayName: route.displayName || adapter?.displayName || route.id,
        credential: snapshot?.credential ?? 'none',
        supported: adapter !== undefined && (adapter.balance !== undefined || adapter.plan !== undefined),
        ...(adapter?.balance !== undefined ? { balanceSupported: true } : {}),
        ...(adapter?.plan !== undefined ? { planSupported: true } : {}),
        ...(snapshot?.balance !== undefined ? { balance: snapshot.balance } : {}),
        ...(snapshot?.plan !== undefined ? { plan: snapshot.plan } : {}),
        ...(error !== undefined ? { error } : {}),
        ...(snapshot?.updatedAt !== undefined ? { updatedAt: snapshot.updatedAt } : {}),
      })
    }
    providers.sort((a, b) => Number(b.supported) - Number(a.supported) || a.displayName.localeCompare(b.displayName))
    const allKeys = ledgerDayKeys(this.ledger)
    const days = allKeys.slice(-TREND_DAYS)
    const range = summarizeDays(days.map((key) => this.ledger.days[key] ?? {}))
    const all = summarizeDays(allKeys.map((key) => this.ledger.days[key] ?? {}))
    return {
      updatedAt: Date.now(),
      providers,
      current: this.currentView(),
      usage: {
        today: this.daySummary(todayKey),
        days: days.map((date) => {
          const summary = this.daySummary(date)
          return { date, totals: summary.totals }
        }),
        range: {
          from: days[0] ?? todayKey,
          to: days[days.length - 1] ?? todayKey,
          totals: range.totals,
          providers: range.providers,
        },
        all: {
          from: allKeys[0] ?? todayKey,
          to: allKeys[allKeys.length - 1] ?? todayKey,
          totals: all.totals,
          providers: all.providers,
        },
        ...(this.spendWatch !== undefined && this.spendWatch.accruedCny > 0
          ? { observedSpend: { cny: this.spendWatch.accruedCny, since: this.spendWatch.since } satisfies ObservedSpendView }
          : {}),
      },
    }
  }

  /**
   * The strip-ready current-provider view: the resolved display name plus
   * today's ledger totals for the provider's adapter family (the route
   * itself when adapter-less). `today` is absent on a day without usage —
   * a strip about nothing is noise, not information.
   */
  private currentView(): UsageOverviewView['current'] {
    const provider = this.current.provider
    if (provider === undefined) return { ...this.current }
    let snapshot = this.snapshots.get(provider)
    if (snapshot === undefined) {
      const family = adapterFor(provider)
      if (family !== undefined) {
        for (const [id, candidate] of this.snapshots) {
          if (adapterFor(id) === family) {
            snapshot = candidate
            break
          }
        }
      }
    }
    const displayName = snapshot?.displayName ?? this.routeDisplayName(provider)
    const today = this.familyUsageToday(provider)
    return {
      ...this.current,
      displayName,
      ...(today.calls > 0 && totalTokens(today) > 0 ? { today } : {}),
    }
  }

  /** One local day aggregated per provider. */
  private daySummary(dateKey: string): UsageOverviewView['usage']['today'] {
    const day = this.ledger.days[dateKey] ?? {}
    const { totals, providers } = summarizeDays([day])
    return { date: dateKey, totals, providers }
  }

  /**
   * Today's ledger totals for one provider's adapter family — the exact
   * route when adapter-less, the merged family otherwise, so aliased routes
   * of one account (the deepseek catalog id and its runtime alias) fold
   * together.
   */
  private familyUsageToday(provider: string): UsageTokenTotals {
    const family = adapterFor(provider)
    let merged = emptyTotals()
    for (const row of this.daySummary(localDateKey(Date.now())).providers) {
      const same = family === undefined ? row.provider === provider : adapterFor(row.provider) === family
      if (same) merged = addTotals(merged, row.totals)
    }
    return merged
  }

  /**
   * Accrue the official DeepSeek family's real spend from observed CNY
   * balance decreases; a balance rise is a top-up and never counts. The
   * family's route ids can alias one account, so the watch follows the
   * largest balance seen this cycle and accrues only decreases of that
   * series — a failed probe keeps the stale balance and accrues nothing
   * until the next success reports the whole drop at once.
   */
  private accrueDeepSeekSpend(): void {
    let balanceCny: number | undefined
    for (const [id, snapshot] of this.snapshots) {
      if (!isDeepSeekProviderRoute(id)) continue
      const balance = snapshot.balance
      if (balance === undefined || balance.currency.toUpperCase() !== 'CNY') continue
      const value = Number(balance.totalBalance)
      if (!Number.isFinite(value)) continue
      balanceCny = balanceCny === undefined ? value : Math.max(balanceCny, value)
    }
    if (balanceCny === undefined) return
    const watch = this.spendWatch ?? { accruedCny: 0, since: Date.now() }
    if (watch.lastBalanceCny !== undefined && balanceCny < watch.lastBalanceCny) {
      watch.accruedCny += watch.lastBalanceCny - balanceCny
    }
    watch.lastBalanceCny = balanceCny
    this.spendWatch = watch
  }

  /**
   * The display name for a route key: the LLM runtime's first, then the
   * adapter's, then the id itself — the snapshot may not exist for
   * adapter-less routes, yet the sidebar strip still needs a legible title.
   */
  private routeDisplayName(provider: string): string {
    const route = this.listProviderRoutes().find((entry) => entry.id === provider)
    return route?.displayName || adapterFor(provider)?.displayName || provider
  }

  // ------------------------------------------------------------------
  // Session usage fold
  // ------------------------------------------------------------------

  private onSessionEvent(session: Session, event: SessionEvent): void {
    try {
      if (event.type === 'request/header') {
        const config = (event.data as { header?: { config?: { provider?: string; model?: string } } }).header?.config
        if (config?.provider !== undefined) {
          this.sessionRoutes.set(session, { provider: config.provider, model: config.model ?? '' })
          this.current = { provider: config.provider, model: config.model, source: 'live' }
        }
      } else if (event.type === 'request/context') {
        const data = event.data as { provider?: string; model?: string }
        if (data.provider !== undefined) {
          this.sessionRoutes.set(session, { provider: data.provider, model: data.model ?? '' })
          this.current = { provider: data.provider, model: data.model, source: 'live' }
        }
      } else if (event.type === 'assistant/message') {
        const usage = (event.data as { usage?: TokenUsage }).usage
        if (usage === undefined) return
        const route = this.sessionRoutes.get(session)
        if (route === undefined || route.provider === '') return
        foldUsage(this.ledger, Date.now(), route.provider, route.model || 'unknown', this.totalsFrom(usage, route.provider, route.model || 'unknown', Date.now()))
        this.scheduleFlush()
      }
    } catch {
      // A malformed event must never break the session loop.
    }
  }

  /**
   * Normalize a provider TokenUsage into the ledger bucket (one call). The
   * DeepSeek official family is priced at the fold instant (its billing
   * period is time-of-day); other families stay unpriced (cost 0).
   */
  private totalsFrom(usage: TokenUsage, provider: string, model: string, atMs: number): UsageTokenTotals {
    const totals = emptyTotals()
    totals.inputTokens = usage.inputTokens
    totals.outputTokens = usage.outputTokens
    totals.cacheReadTokens = usage.cacheReadTokens ?? 0
    totals.cacheWriteTokens = usage.cacheWriteTokens ?? 0
    totals.reasoningTokens = usage.reasoningTokens ?? 0
    totals.calls = 1
    if (isDeepSeekProviderRoute(provider)) totals.cost = deepseekModelSpend(model, totals, atMs)
    return totals
  }

  // ------------------------------------------------------------------
  // Persistence
  // ------------------------------------------------------------------

  private async loadPersisted(): Promise<void> {
    try {
      const [rawLedger, rawSnapshots] = await Promise.all([
        readFile(this.ledgerPath, 'utf8').catch(() => undefined),
        readFile(this.snapshotsPath, 'utf8').catch(() => undefined),
      ])
      if (rawLedger !== undefined) {
        const loaded = deserializeLedger(JSON.parse(rawLedger))
        // Merge into (never replace) the live document: folds that landed
        // during the read window must survive the load.
        for (const [dayKey, providers] of Object.entries(loaded.days)) {
          const atMs = new Date(dayKey + 'T12:00:00').getTime()
          for (const [provider, models] of Object.entries(providers)) {
            for (const [model, totals] of Object.entries(models)) {
              foldUsage(this.ledger, atMs, provider, model, totals)
            }
          }
        }
        pruneLedger(this.ledger, localDateKey(Date.now()), this.options.retainDays)
        this.lastPrune = { dayKey: localDateKey(Date.now()), retainDays: this.options.retainDays }
      }
      if (rawSnapshots !== undefined) {
        const parsed = JSON.parse(rawSnapshots) as { providers?: Record<string, ProviderSnapshotState>; spendWatch?: SpendWatch }
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.providers === 'object' && parsed.providers !== null) {
          for (const [provider, snapshot] of Object.entries(parsed.providers)) {
            if (typeof snapshot === 'object' && snapshot !== null && typeof snapshot.provider === 'string') {
              this.snapshots.set(provider, snapshot)
            }
          }
        }
        // Revive the spend watch strictly: a corrupt accrual would otherwise
        // quietly rewrite the user's real-spend figure.
        const watch = parsed.spendWatch
        if (typeof watch === 'object' && watch !== null && typeof watch.accruedCny === 'number' && Number.isFinite(watch.accruedCny) && watch.accruedCny >= 0
          && typeof watch.since === 'number' && Number.isFinite(watch.since) && watch.since > 0) {
          this.spendWatch = {
            accruedCny: watch.accruedCny,
            since: watch.since,
            ...(typeof watch.lastBalanceCny === 'number' && Number.isFinite(watch.lastBalanceCny) ? { lastBalanceCny: watch.lastBalanceCny } : {}),
          }
        }
      }
    } catch {
      // Corrupt or unreadable state starts fresh; the next flush rewrites it.
    } finally {
      // Only now may flushes overwrite the persisted files.
      this.loaded = true
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.disposed) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flushLedger()
    }, FLUSH_DEBOUNCE_MS)
  }

  /**
   * Queue one ledger flush behind the previous one. Debounce and stop-time
   * flushes serialize here, so two `writeJsonAtomic` calls can never run
   * concurrently on the same path.
   */
  private flushLedger(): Promise<void> {
    const next = this.flushChain.then(() => this.writeLedgerOnce())
    this.flushChain = next.catch(() => {})
    return next
  }

  private async writeLedgerOnce(): Promise<void> {
    // Never overwrite the persisted file before it has been loaded: a flush
    // racing the load window would otherwise clobber history with a partial
    // document.
    if (!this.loaded) return
    try {
      await mkdir(dirname(this.ledgerPath), { recursive: true })
      await writeJsonAtomic(this.ledgerPath, this.ledger)
    } catch {
      // Persistence failures degrade silently; the in-memory ledger keeps counting.
    }
  }

  /**
   * Prune days past retention. Runs at most once per local day and whenever
   * `retainDays` shrinks — not only at startup, so long-lived processes and
   * live settings changes both honor retention.
   */
  private pruneIfNeeded(): void {
    const todayKey = localDateKey(Date.now())
    if (this.lastPrune?.dayKey === todayKey && this.lastPrune.retainDays === this.options.retainDays) return
    const pruned = pruneLedger(this.ledger, todayKey, this.options.retainDays)
    this.lastPrune = { dayKey: todayKey, retainDays: this.options.retainDays }
    if (pruned > 0) this.scheduleFlush()
  }

  private async persistSnapshots(): Promise<void> {
    if (!this.loaded) return
    try {
      await mkdir(dirname(this.snapshotsPath), { recursive: true })
      await writeJsonAtomic(this.snapshotsPath, {
        version: 1,
        providers: Object.fromEntries(this.snapshots),
        ...(this.spendWatch !== undefined ? { spendWatch: this.spendWatch } : {}),
      })
    } catch {
      // Same silent degradation as the ledger.
    }
  }

  // ------------------------------------------------------------------
  // Poll loop
  // ------------------------------------------------------------------

  private rearmPoll(delayMs: number): void {
    if (this.disposed) return
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      void this.pollNow().finally(() => this.rearmPoll(Math.max(30, this.options.pollIntervalSec) * 1000))
    }, delayMs)
  }

  /**
   * One poll cycle: enumerate routes, resolve credentials, probe.
   * A call while a cycle is already running joins that cycle instead of
   * returning immediately, so a manual refresh always waits for real probes.
   */
  pollNow(): Promise<void> {
    if (this.pollInFlight) return this.pollPromise ?? Promise.resolve()
    if (this.disposed) return Promise.resolve()
    this.pollInFlight = true
    const cycle = (async () => {
      try {
        this.pruneIfNeeded()
        const routes = this.listProviderRoutes()
        const seen = new Set<string>()
        for (const route of routes) {
          // Probes serialize at up to 2 × PROBE_TIMEOUT_MS per route; bail
          // out of a cycle that outlived the service.
          if (this.disposed) return
          seen.add(route.id)
          const adapter = adapterFor(route.id)
          if (adapter === undefined || (adapter.balance === undefined && adapter.plan === undefined)) continue
          await this.probeRoute(route, adapter)
        }
        for (const id of [...this.snapshots.keys()]) {
          if (!seen.has(id)) this.snapshots.delete(id)
        }
        if (this.disposed) return
        this.accrueDeepSeekSpend()
        await this.persistSnapshots()
      } finally {
        this.pollInFlight = false
        this.pollPromise = undefined
      }
    })()
    this.pollPromise = cycle
    return cycle
  }

  /**
   * Every route the service probes and renders: the runtime's live providers
   * plus the configurable directory's catalog entries, then alias-folded so a
   * dormant catalog entry cannot shadow the live route of the same adapter
   * family (see foldAliasRoutes).
   */
  private listProviderRoutes(): ProviderRoute[] {
    const routes = new Map<string, ProviderRoute>()
    const runtime = service<{ listProviders(): Array<{ id: string; name: string }>; listConfigurableProviders(): Array<{ provider: string; displayName: string }> }>(this.ctx, 'llm')
    if (runtime !== undefined) {
      try {
        for (const provider of runtime.listProviders()) {
          if (provider.id !== '') routes.set(provider.id, { id: provider.id, displayName: provider.name, live: true })
        }
        for (const provider of runtime.listConfigurableProviders()) {
          if (!routes.has(provider.provider)) routes.set(provider.provider, { id: provider.provider, displayName: provider.displayName, live: false })
        }
      } catch {
        // Registry hiccups degrade to an empty list; the next poll retries.
      }
    }
    return foldAliasRoutes([...routes.values()])
  }

  private async probeRoute(route: ProviderRoute, adapter: NonNullable<ReturnType<typeof adapterFor>>): Promise<void> {
    const credential = await this.resolveCredential(route.id)
    const previous = this.snapshots.get(route.id)
    if (credential.key === undefined) {
      // Nothing to probe with (oauth grant, no credential): retained facts
      // would never refresh again, so the row resets to its credential
      // state instead of presenting stale data as current.
      this.snapshots.set(route.id, {
        provider: route.id,
        displayName: route.displayName || adapter.displayName,
        credential: credential.kind,
        supported: true,
        updatedAt: Date.now(),
      })
      return
    }
    const snapshot: ProviderSnapshotState = {
      provider: route.id,
      displayName: route.displayName || adapter.displayName,
      credential: credential.kind,
      supported: true,
      updatedAt: Date.now(),
    }
    const runProbe = async (kind: 'balance' | 'plan'): Promise<BalanceView | PlanView | undefined> => {
      const half = adapter[kind]
      if (half === undefined) return undefined
      try {
        const spec = half.build({ apiKey: credential.key as string, ...(credential.accountId !== undefined ? { accountId: credential.accountId } : {}) })
        const response = await fetch(spec.url, { headers: spec.headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        const body: unknown = await response.json().catch(() => undefined)
        if (!response.ok) throw new Error(providerErrorMessage(response.status, body))
        const parsed = half.parse(response.status, body)
        if (parsed === undefined) throw new Error('unrecognized response shape')
        const updatedAt = Date.now()
        if (kind === 'balance') {
          const fact = parsed as BalanceParse
          return { currency: fact.currency, totalBalance: fact.totalBalance, updatedAt }
        }
        const plan = parsed as PlanParse
        return { planName: plan.planName, windows: plan.windows, updatedAt }
      } catch (error) {
        // Per-fact error slot: a success in the other probe half can no
        // longer clear this failure (and a stale fact always carries the
        // error line explaining why it is stale).
        const message = error instanceof Error ? error.message.slice(0, 200) : String(error)
        if (kind === 'balance') snapshot.balanceError = message
        else snapshot.planError = message
        return undefined
      }
    }
    const balance = await runProbe('balance')
    // A failed probe keeps the previous fact visible (stale but useful).
    if (balance !== undefined) snapshot.balance = balance as BalanceView
    else if (previous?.balance !== undefined) snapshot.balance = previous.balance
    const plan = await runProbe('plan')
    if (plan !== undefined) snapshot.plan = plan as PlanView
    else if (previous?.plan !== undefined) snapshot.plan = previous.plan
    this.snapshots.set(route.id, snapshot)
  }

  /**
   * Resolve the credential backing one route: pi-ai credential records
   * first, then the profile's apiKeyEnv reference, then the DeepSeek
   * official adapter's env reference. OAuth grants hand their stored access
   * token to the oauth-aware adapters (Codex plan quota); a stale token
   * fails its probe with a 401 and refreshes the next time the harness
   * itself runs that provider.
   */
  private async resolveCredential(provider: string): Promise<ResolvedCredential> {
    const credentials = service<{
      readRecord(key: unknown): Promise<{ kind: string; key?: string; env?: Record<string, string>; payload?: unknown } | undefined>
      resolve(ref: unknown): Promise<{ value: string } | undefined>
    }>(this.ctx, 'credentials')
    if (credentials === undefined) return { kind: 'none' }
    try {
      const record = await credentials.readRecord(credentialKey('llm-pi-ai', provider))
      if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key !== '') {
        return { kind: 'api-key', key: record.key }
      }
      if (record?.kind === 'grant' && typeof record.payload === 'object' && record.payload !== null) {
        // pi-ai stores its OAuth credential verbatim: { type: 'oauth', access, refresh, expires, ... }.
        const payload = record.payload as Record<string, unknown>
        const access = typeof payload.access === 'string' && payload.access !== '' ? payload.access : undefined
        const accountId = typeof payload.chatgpt_account_id === 'string' && payload.chatgpt_account_id !== '' ? payload.chatgpt_account_id : undefined
        if (access !== undefined) return { kind: 'oauth', key: access, ...(accountId !== undefined ? { accountId } : {}) }
        return { kind: 'oauth' }
      }
    } catch {
      // Invalid record ids read as absent.
    }
    try {
      const profile = this.piAiProfile(provider)
      const envName = profile?.apiKeyEnv ?? (isDeepSeekProviderRoute(provider) ? this.deepseekApiKeyEnv() : undefined)
      if (typeof envName === 'string' && envName !== '') {
        const resolved = await credentials.resolve(credentialRef(envName))
        if (resolved?.value !== undefined && resolved.value !== '') return { kind: 'env', key: resolved.value }
      }
    } catch {
      // Malformed references read as absent.
    }
    return { kind: 'none' }
  }

  /** The llm-pi-ai profile object for one provider route, when configured. */
  private piAiProfile(provider: string): { apiKeyEnv?: string; baseURL?: string } | undefined {
    const section = readNamespace(this.ctx, 'llm-pi-ai') as { providers?: Record<string, { apiKeyEnv?: string; baseURL?: string }> } | undefined
    return section?.providers?.[provider]
  }

  /** The DeepSeek official adapter's credential reference name. */
  private deepseekApiKeyEnv(): string {
    const section = readNamespace(this.ctx, 'llm-deepseek') as { apiKeyEnv?: string } | undefined
    return section?.apiKeyEnv ?? 'DEEPSEEK_API_KEY'
  }

}
