/**
 * Browser-half state controller for the dsh-doctor recovery console.
 *
 * Owns one immutable snapshot (a small external store for useSyncExternalStore),
 * the refresh/action/report verbs over the loopback API, the passive probe
 * merge, and the poll loop. Resilience contract: every public method resolves
 * or no-ops, never throws; the host being absent, a fetch failure or a broken
 * response only degrades the snapshot.
 * @module @linxin666/dsh-doctor/client
 */

import { DoctorApi, type DoctorApiFail } from './doctor-api.ts'
import type {
  DoctorActionName,
  DoctorIncident,
  DoctorProfileRuntime,
  DoctorSnapshot,
} from './doctor-types.ts'
import { PassiveProbe, type PassiveIncident } from './doctor-passive.ts'
import { detectFailedPluginIds, type PluginModulesSeam } from './plugin-failures.ts'
import type { HarnessPort, HarnessTarget } from './harness-send.ts'
import type { PluginRepairPort, PluginsFailureItem } from './plugin-repair.ts'

/** Settled outcome of one send-to-Harness call. */
export type HarnessSendOutcome = { ok: true } | { ok: false; message: string }

/** Settled outcome of one plugin-disable call. */
export type PluginDisableOutcome = { ok: true } | { ok: false; message: string }

/** Console load phase. */
export type DoctorPhase = 'idle' | 'loading' | 'ready'

/** Host availability as last observed by the browser half. */
export type DoctorHostState = 'unknown' | 'available' | 'unavailable'

/** One boot/reconnect signal observed by the browser half. */
export interface DoctorBootSignal {
  kind: 'connection-reset'
  at: number
}

/** Settled outcome of one console action. */
export type DoctorActionOutcome =
  | { ok: true; kind: 'reported' | 'completed' | 'sent' | 'disabled'; id?: string }
  | { ok: false; message: string }

/** Immutable snapshot consumed by the console. */
export interface DoctorView {
  phase: DoctorPhase
  host: DoctorHostState
  snapshot: DoctorSnapshot | undefined
  profiles: DoctorProfileRuntime[]
  incidents: DoctorIncident[]
  /** Browser-side passive incidents (window errors, rejections, local signals). */
  probe: readonly PassiveIncident[]
  /** Recorded plugin boot failures from the plugin-manager service, when present. */
  pluginFailures: readonly PluginsFailureItem[]
  bootSignals: DoctorBootSignal[]
  lastCheckedAt: number | undefined
  lastError: string | undefined
  /** Machine code of the last offline failure (SUPERVISOR_UNPROVISIONED etc.). */
  lastErrorCode: string | undefined
  /** Version of the host half, when the last status response carried it. */
  hostVersion: string | undefined
  actionRunning: boolean
  action: DoctorActionOutcome | undefined
}

/** Initial (pre-connect) snapshot. */
export function initialDoctorView(): DoctorView {
  return {
    phase: 'idle',
    host: 'unknown',
    snapshot: undefined,
    profiles: [],
    incidents: [],
    probe: [],
    pluginFailures: [],
    bootSignals: [],
    lastCheckedAt: undefined,
    lastError: undefined,
    lastErrorCode: undefined,
    hostVersion: undefined,
    actionRunning: false,
    action: undefined,
  }
}

/** Minimal external store: immutable snapshots, never-throwing notify. */
export class DoctorStore {
  private view: DoctorView = initialDoctorView()
  private readonly listeners = new Set<() => void>()

  getSnapshot(): DoctorView {
    return this.view
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(patch: Partial<DoctorView>): void {
    this.view = { ...this.view, ...patch }
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // A broken subscriber must not stop the other subscribers.
      }
    }
  }
}

/** Injectable timer pair (defaults to the window globals). */
export interface DoctorTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

/** Options for DoctorController. */
export interface DoctorControllerOptions {
  api?: DoctorApi
  passive: PassiveProbe
  /** Poll interval while the tab is visible (default 15000 ms). */
  intervalMs?: number
  /** Clock seam (default Date.now). */
  now?: () => number
  /** Timer seam (default window.globalThis-based). */
  timers?: DoctorTimers
  /**
   * The web shell module system (ctx.modules), structurally. When present, the
   * controller reconciles the boot graph against the materialized registry and
   * records plugins that were enabled but never started.
   */
  modules?: PluginModulesSeam | undefined
  /**
   * Send-to-Harness port. When absent (no sessions service), the console
   * explains the gap instead of offering a dead send button.
   */
  harness?: HarnessPort | undefined
  /**
   * Plugin-repair port (the `pluginManager` service wrapper). When absent,
   * failed-plugin rows keep only their copy affordance.
   */
  pluginRepair?: PluginRepairPort | undefined
  /** How long an unresolved plugin must stay missing before it is recorded (default 8000 ms). */
  failureGraceMs?: number
}

/** Cap for the boot-signal ring. */
const BOOT_SIGNAL_MAX = 8

/** Default poll interval in ms. */
export const DEFAULT_POLL_INTERVAL_MS = 15_000

/** The default timer pair over the page globals (guarded for non-browser use). */
const defaultTimers: DoctorTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/** One-line summary of an API failure (never throws). */
export function describeApiFailure(failure: DoctorApiFail): string {
  if (failure.kind !== 'unprovisioned' && failure.kind !== 'supervisor-down' && failure.message !== undefined && failure.message !== '') return failure.message
  switch (failure.kind) {
    case 'network': return 'network error'
    case 'loopback': return 'loopback only'
    case 'not-available': return 'endpoint unavailable'
    case 'malformed': return 'malformed response'
    case 'http': return 'HTTP ' + String(failure.status ?? '')
    case 'supervisor': return 'supervisor refused'
    case 'unprovisioned': return 'supervisor service not provisioned'
    case 'supervisor-down': return 'supervisor service not answering'
  }
}

/**
 * Owns the console snapshot and its refresh loop. Construct with a PassiveProbe
 * whose notify callback routes to syncProbe; start() kicks the poll loop and
 * the visibility guard; dispose() stops everything.
 */
export class DoctorController {
  /** Read-only external store face. */
  readonly store: DoctorStore
  /** Bound subscribe for useSyncExternalStore. */
  readonly subscribe: (listener: () => void) => () => void
  /** Bound snapshot for useSyncExternalStore. */
  readonly getSnapshot: () => DoctorView

  private readonly api: DoctorApi
  private readonly passive: PassiveProbe
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly timers: DoctorTimers
  private readonly modules: PluginModulesSeam | undefined
  private readonly harness: HarnessPort | undefined
  private readonly pluginRepair: PluginRepairPort | undefined
  private readonly failureGraceMs: number
  /** Plugin ids seen missing so far; a steady config lets failures be confirmed across a poll. */
  private readonly pendingPluginFailures = new Map<string, number>()
  /** Plugin ids already recorded as startup failures. */
  private readonly recordedPluginFailures = new Set<string>()
  private timer: unknown | undefined
  private visibilityListener: ((event: Event) => void) | undefined
  private disposed = false

  constructor(options: DoctorControllerOptions) {
    this.store = new DoctorStore()
    this.subscribe = (listener) => this.store.subscribe(listener)
    this.getSnapshot = () => this.store.getSnapshot()
    this.api = options.api ?? new DoctorApi()
    this.passive = options.passive
    this.intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.now = options.now ?? (() => Date.now())
    this.timers = options.timers ?? defaultTimers
    this.modules = options.modules
    this.harness = options.harness
    this.pluginRepair = options.pluginRepair
    this.failureGraceMs = options.failureGraceMs ?? 8_000
  }

  /** Merge the passive probe's current ring into the snapshot. */
  syncProbe(): void {
    try {
      this.store.set({ probe: this.passive.snapshot() })
    } catch {
      // The controller must never throw.
    }
  }

  /**
   * Reconcile the boot graph against the module registry and record plugins
   * that were enabled but never started. A plugin must stay missing across the
   * grace window before it is recorded, so entries that materialize slightly
   * after this console's own apply are never misreported.
   */
  scanPluginFailures(): void {
    try {
      const missing = detectFailedPluginIds(this.modules)
      if (missing.length === 0) {
        this.pendingPluginFailures.clear()
        return
      }
      const nowMs = this.now()
      const missingSet = new Set(missing)
      for (const id of missing) {
        if (this.recordedPluginFailures.has(id) || this.pendingPluginFailures.has(id)) continue
        this.pendingPluginFailures.set(id, nowMs)
      }
      for (const [id, seenAt] of [...this.pendingPluginFailures]) {
        if (missingSet.has(id)) {
          if (nowMs - seenAt < this.failureGraceMs) continue
          this.recordedPluginFailures.add(id)
          this.pendingPluginFailures.delete(id)
          this.passive.recordPluginStartupFailure(id)
        } else {
          // The plugin materialized after all - never record it.
          this.pendingPluginFailures.delete(id)
        }
      }
      this.syncProbe()
    } catch {
      // The controller must never throw.
    }
  }

  /** Record a plugin startup failure observed by an external signal (loader event). */
  notePluginStartupFailure(pluginId: string): void {
    try {
      const id = typeof pluginId === 'string' ? pluginId.trim() : ''
      if (id === '') return
      if (this.recordedPluginFailures.has(id)) return
      this.recordedPluginFailures.add(id)
      this.passive.recordPluginStartupFailure(id)
      this.syncProbe()
    } catch {
      // The controller must never throw.
    }
  }

  /** Resolve the current session the console would send into. */
  harnessTarget(): HarnessTarget | undefined {
    try {
      return this.harness?.current()
    } catch {
      return undefined
    }
  }

  /** Refresh the plugin-manager failure ring (best effort). */
  async refreshPluginFailures(): Promise<void> {
    if (this.disposed) return
    try {
      const items = await this.pluginRepair?.failures()
      if (this.disposed) return
      this.store.set({ pluginFailures: items ?? [] })
    } catch {
      // A missing or broken plugin manager must never break the refresh.
    }
  }

  /**
   * Disable one failed plugin for the next host restart through the
   * plugin-manager port.
   */
  async disablePlugin(pluginId: string): Promise<PluginDisableOutcome> {
    const id = typeof pluginId === 'string' ? pluginId.trim() : ''
    if (id === '') {
      this.store.set({ action: { ok: false, message: 'empty plugin id' } })
      return { ok: false, message: 'empty plugin id' }
    }
    const port = this.pluginRepair
    if (port === undefined) {
      this.store.set({ action: { ok: false, message: 'plugin manager unavailable' } })
      return { ok: false, message: 'plugin manager unavailable' }
    }
    if (this.disposed) return { ok: false, message: 'disposed' }
    this.store.set({ actionRunning: true, action: undefined })
    let outcome: DoctorActionOutcome
    let result: PluginDisableOutcome
    try {
      const disabled = await port.disable(id)
      result = disabled.ok ? { ok: true } : { ok: false, message: disabled.message }
      outcome = disabled.ok ? { ok: true, kind: 'disabled', id } : { ok: false, message: disabled.message }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { ok: false, message }
      outcome = { ok: false, message }
    }
    if (this.disposed) return result
    this.store.set({ actionRunning: false, action: outcome })
    return result
  }

  /**
   * Queue the composed prompt into the current session; the outcome lands in
   * the snapshot's action line ('sent' on success).
   */
  async sendToHarness(text: string): Promise<HarnessSendOutcome> {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (trimmed === '') {
      this.store.set({ action: { ok: false, message: 'empty prompt' } })
      return { ok: false, message: 'empty prompt' }
    }
    const port = this.harness
    const target = port?.current()
    if (port === undefined || target === undefined) {
      const message = 'no current session'
      this.store.set({ action: { ok: false, message } })
      return { ok: false, message }
    }
    if (this.disposed) return { ok: false, message: 'disposed' }
    this.store.set({ actionRunning: true, action: undefined })
    let outcome: DoctorActionOutcome
    let result: HarnessSendOutcome
    try {
      const sent = await port.send(target, trimmed)
      result = sent.ok ? { ok: true } : { ok: false, message: sent.message }
      outcome = sent.ok ? { ok: true, kind: 'sent' } : { ok: false, message: sent.message }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result = { ok: false, message }
      outcome = { ok: false, message }
    }
    if (this.disposed) return result
    this.store.set({ actionRunning: false, action: outcome })
    return result
  }

  /** One refresh cycle: the supervisor snapshot over the loopback API. */
  async refresh(): Promise<void> {
    this.scanPluginFailures()
    void this.refreshPluginFailures()
    if (this.disposed) return
    const previous = this.store.getSnapshot()
    if (previous.host === 'unknown') this.store.set({ phase: 'loading' })
    let result: DoctorApiResultLike
    try {
      result = await this.api.status()
    } catch {
      result = { ok: false, kind: 'network' }
    }
    if (this.disposed) return
    if (result.ok) {
      const snapshot = result.value.snapshot
      this.store.set({
        phase: 'ready',
        host: 'available',
        snapshot,
        profiles: snapshot?.profiles ?? previous.profiles,
        incidents: snapshot?.incidents ?? previous.incidents,
        lastCheckedAt: this.now(),
        lastError: undefined,
        lastErrorCode: undefined,
        hostVersion: result.value.hostVersion,
      })
    } else {
      this.store.set({
        phase: 'ready',
        host: 'unavailable',
        lastError: describeApiFailure(result),
        lastErrorCode: result.code,
        hostVersion: undefined,
      })
    }
  }

  /** Run the diagnose action and merge the resulting snapshot. */
  async runDiagnose(): Promise<void> {
    await this.invokeAction('diagnose')
  }

  /** One-click lifecycle install/repair: deploy the service and refresh the capsule. */
  async runProvision(): Promise<void> {
    await this.invokeAction('provision')
  }

  /** Remove the user-level supervisor service (state data is kept). */
  async runUninstall(): Promise<void> {
    await this.invokeAction('uninstall')
  }

  /** Run the repair action against the first repairable incident. */
  async runRepair(): Promise<void> {
    const incident = this.firstRepairableIncident()
    if (incident === undefined) {
      this.store.set({ action: { ok: false, message: 'no repairable incident' } })
      return
    }
    await this.invokeAction('repair', { incidentId: incident.id, profileId: incident.profileId })
  }

  /** Confirm the first isolated candidate waiting for promotion. */
  async runConfirm(): Promise<void> {
    const incident = this.store.getSnapshot().incidents.find(item => item.phase === 'awaiting-confirmation' && item.candidateId !== undefined)
    if (incident === undefined) { this.store.set({ action: { ok: false, message: 'no candidate awaiting confirmation' } }); return }
    await this.invokeAction('confirm', { incidentId: incident.id, profileId: incident.profileId })
  }

  /** Report the newest passive incident to the supervisor (best effort). */
  async reportProbe(): Promise<void> {
    const incident = this.store.getSnapshot().probe[this.store.getSnapshot().probe.length - 1]
    if (incident === undefined) {
      this.store.set({ action: { ok: false, message: 'probe list empty' } })
      return
    }
    if (this.disposed) return
    this.store.set({ actionRunning: true, action: undefined })
    let outcome: DoctorActionOutcome
    try {
      const result = await this.api.reportClientFailure({
        message: incident.message,
        stack: incident.detail,
        phase: 'recovery-console:' + incident.kind,
      })
      outcome = result.ok
        ? { ok: true, kind: 'reported' }
        : { ok: false, message: describeApiFailure(result) }
    } catch {
      outcome = { ok: false, message: 'report failed' }
    }
    if (this.disposed) return
    this.store.set({ actionRunning: false, action: outcome })
  }

  /** Clear the passive probe ring (local only). */
  clearProbe(): void {
    try {
      this.passive.clear()
      this.store.set({ probe: [] })
    } catch {
      // The controller must never throw.
    }
  }

  /** Report a React boundary catch into the probe list. */
  recordBoundary(error: unknown): void {
    try {
      const text = error instanceof Error ? (error.message || error.name) : String(error)
      this.passive.record('react-boundary', text, error instanceof Error ? (error.message ?? '') : undefined)
      this.syncProbe()
    } catch {
      // The controller must never throw.
    }
  }

  /** Record a boot/reconnect signal and trigger a refresh. */
  noteConnectionReset(): void {
    try {
      const at = this.now()
      this.passive.record('connection-reset', 'connection/reset event observed')
      this.syncProbe()
      const view = this.store.getSnapshot()
      const ring = [...view.bootSignals, { kind: 'connection-reset' as const, at }]
      this.store.set({ bootSignals: ring.slice(-BOOT_SIGNAL_MAX) })
      void this.refresh()
    } catch {
      // The controller must never throw.
    }
  }

  /** First incident that is repairable and not already settled. */
  firstRepairableIncident(): DoctorIncident | undefined {
    return this.store.getSnapshot().incidents.find(incident =>
      incident.repairable === true && incident.phase !== 'recovered' && incident.phase !== 'rolled-back' && incident.phase !== 'unresolved',
    )
  }

  private async invokeAction(name: DoctorActionName, selection?: { profileId?: string; incidentId?: string }): Promise<void> {
    if (this.disposed) return
    const view = this.store.getSnapshot()
    if (view.actionRunning) return
    this.store.set({ actionRunning: true, action: undefined })
    let outcome: DoctorActionOutcome
    try {
      const result = await this.api.action(name, selection)
      if (result.ok) {
        const snapshot = result.value.snapshot
        this.store.set({
          snapshot,
          profiles: snapshot?.profiles ?? this.store.getSnapshot().profiles,
          incidents: snapshot?.incidents ?? this.store.getSnapshot().incidents,
          lastCheckedAt: this.now(),
          hostVersion: result.value.hostVersion,
          ...(result.value.hostVersion !== undefined ? { lastErrorCode: undefined } : {}),
        })
        outcome = { ok: true, kind: 'completed' }
      } else {
        outcome = { ok: false, message: describeApiFailure(result) }
      }
    } catch {
      outcome = { ok: false, message: 'action failed' }
    }
    if (this.disposed) return
    this.store.set({ actionRunning: false, action: outcome })
  }

  /**
   * Start the poll loop plus the visibility guard. Polling pauses while the
   * tab is hidden. Returns the disposer.
   */
  start(): () => void {
    void this.refresh()
    const tick = (): void => { void this.refresh() }
    this.timer = this.timers.set(tick, this.intervalMs)
    let visibilityListener: ((event: Event) => void) | undefined
    try {
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        const onVisibility = (): void => {
          try {
            if (document.visibilityState === 'visible') {
              void this.refresh()
              if (this.timer === undefined) this.timer = this.timers.set(tick, this.intervalMs)
            } else if (this.timer !== undefined) {
              this.timers.clear(this.timer)
              this.timer = undefined
            }
          } catch {
            // Visibility handling must never throw.
          }
        }
        document.addEventListener('visibilitychange', onVisibility)
        visibilityListener = onVisibility
      }
    } catch {
      // Without a document the poll loop alone still works.
    }
    this.visibilityListener = visibilityListener
    return () => this.dispose()
  }

  /** Stop the poll loop; the passive probe keeps its ring but listeners stay. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) {
      try {
        this.timers.clear(this.timer)
      } catch {
        // Teardown must never throw.
      }
      this.timer = undefined
    }
    if (this.visibilityListener !== undefined) {
      try {
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', this.visibilityListener!)
        }
      } catch {
        // Teardown must never throw.
      }
      this.visibilityListener = undefined
    }
  }
}

/** Structural alias used inside refresh. */
type DoctorApiResultLike = { ok: true; value: { snapshot?: DoctorSnapshot; hostVersion?: string } } | { ok: false; kind: DoctorApiFail['kind']; message?: string; code?: string }
