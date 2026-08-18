/**
 * Pet host service — the `pet.*` RPC domain. A composition facade: it wires
 * the pure event projection (`event-projection`) onto the state machine,
 * delegates the affinity economy to the ledger (`ledger`), and routes
 * persistence through `persist`. The API gateway maps these methods onto
 * `pet.state` / `pet.pets` / `pet.interact` / `pet.setVisible` /
 * `pet.setConfig` / `pet.setName` / `pet.setPet` for browser consumers.
 *
 * Concurrent sessions each keep their own machine: the sprite animation
 * follows the most recent meaningful event (the display session) while the
 * state view carries one bubble per active session.
 * @module @linxin666/dsh-pet/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SettingsNamespace, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { AffinityConfig, PetAffinityView, PetInteraction } from './affinity.ts'
import type { TreatConfig } from './treats.ts'
import { createInteractionIntent, type PetIntent } from './core/intent.ts'
import { PET_DESKTOP_SCALE_MAX, PET_DESKTOP_SCALE_MIN } from './contracts/desktop-host.ts'
import {
  emptyProjectionRuntime,
  isActivityPhase,
  projectOfficialEvent,
  type ActivityStatusEventLike,
  type ProjectionRuntime,
} from './event-projection.ts'
import { PetLedger, type LedgerConfig, type LedgerInteractionResult } from './ledger.ts'
import {
  DEFAULT_PET_NAME,
  DISPLAY_INSET_MAX,
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  PET_NAME_MAX_LENGTH,
  loadPetPersist,
  petHomeDir,
  savePetPersist,
  type PetDisplayConfig,
  type PetPersist,
} from './persist.ts'
import {
  loadPetRegistry,
  petEntryView,
  petPackageRoot,
  type PetDefinition,
  type PetManifest,
  type PetRegistry,
} from './registry.ts'
import { WHISPER_TTL_MS } from './chatter.ts'
import {
  defaultPetStateConfig,
  PetStateMachine,
  type PetStateConfig,
  type PetStateInput,
  type PetStateSnapshot,
} from './state.ts'

/** Plugin configuration. */
export interface PetConfig {
  /** Affinity tuning. */
  affinity?: Partial<AffinityConfig>
  /** State machine tuning. */
  state?: Partial<PetStateConfig>
  /** Treat economy tuning. */
  treats?: Partial<TreatConfig>
  /** Persistence directory override (defaults to $DSH_HOME). */
  persistDir?: string
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
  /** Desktop presentation defaults; the browser presentation stays independent. */
  desktop?: Partial<PetDesktopSettings>
  /** Prebuilt registry (tests); defaults to scanning the package + user dirs. */
  registry?: PetRegistry
  /** Extra manifest entries composed by the embedding application. */
  pets?: readonly PetManifest[]
}

/**
 * The pet's settings-namespace section: the pet selection and display fields
 * the web settings surface edits. `right`/`bottom` are also updated by drag
 * interactions, which keep the settings document in sync through the service.
 * Naming is per pet and lives outside the settings document (the hover-panel
 * rename targets the selected pet).
 */
export interface PetSettingsSection {
  /** Selected pet id (a registry entry; the service clamps stale values). */
  petId?: string
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
  /** Start the managed desktop presentation with this DSH Host. */
  desktopEnabled?: boolean
  /** Show the desktop window while keeping its process available. */
  desktopVisible?: boolean
  /** Keep the desktop window above ordinary windows. */
  desktopAlwaysOnTop?: boolean
  /** Prevent pointer dragging of the desktop window. */
  desktopLocked?: boolean
  /** Desktop surface scale, independent from the browser sprite size. */
  desktopScale?: number
}

/** Desktop-only presentation settings stored by the DSH settings namespace. */
export interface PetDesktopSettings {
  enabled: boolean
  visible: boolean
  alwaysOnTop: boolean
  locked: boolean
  scale: number
}

/** Settings descriptor exposed by the pet's loopback-only browser bridge. */
export interface PetSettingsView {
  value: PetSettingsSection
  base?: Partial<PetSettingsSection>
  user?: Partial<PetSettingsSection>
  revision: number
  writable: boolean
}

export const DEFAULT_PET_DESKTOP_SETTINGS: PetDesktopSettings = {
  enabled: false,
  visible: true,
  alwaysOnTop: true,
  locked: false,
  scale: 1,
}

/** Normalize composed or persisted desktop preferences through one boundary. */
export function normalizePetDesktopSettings(
  value: Partial<PetDesktopSettings> = {},
): PetDesktopSettings {
  const scale = typeof value.scale === 'number' && Number.isFinite(value.scale)
    ? value.scale
    : DEFAULT_PET_DESKTOP_SETTINGS.scale
  return {
    enabled: value.enabled ?? DEFAULT_PET_DESKTOP_SETTINGS.enabled,
    visible: value.visible ?? DEFAULT_PET_DESKTOP_SETTINGS.visible,
    alwaysOnTop: value.alwaysOnTop ?? DEFAULT_PET_DESKTOP_SETTINGS.alwaysOnTop,
    locked: value.locked ?? DEFAULT_PET_DESKTOP_SETTINGS.locked,
    scale: Math.min(PET_DESKTOP_SCALE_MAX, Math.max(PET_DESKTOP_SCALE_MIN, scale)),
  }
}

export { PET_DESKTOP_SCALE_MAX, PET_DESKTOP_SCALE_MIN } from './contracts/desktop-host.ts'

/** Settings namespace of the pet capability. Spelled here rather than imported: the browser half spells the same value. */
export const PET_SETTINGS_NAMESPACE = 'pet'

/**
 * One active TOP-LEVEL session as the pet displays it. Sessions run in
 * parallel, so each gets its own bubble while the sprite itself follows the
 * most recent meaningful event (the display session). Subagent children
 * report no bubble of their own: their work is already reflected by the
 * bubble of the conversation that spawned them, and the bubble buttons
 * navigate to GUI sessions, which subagents are not.
 */
export interface PetSessionView {
  /** Session identity (stringified for the wire; never exposed as a key). */
  sessionId: string
  /** The animation this session's activity maps onto. */
  animation: PetStateSnapshot['animation']
  /** This session's status bubble copy. */
  bubble: string
  /** This session's raw activity phase. */
  phase: PetStateSnapshot['phase']
}

/** Hard cap on simultaneously displayed session bubbles (most recent first). */
export const MAX_SESSION_BUBBLES = 12

/** Snapshot returned by `pet.state`. */
export interface PetStateView {
  animation: PetStateSnapshot['animation']
  bubble?: string
  phase: PetStateSnapshot['phase']
  sessionActive: boolean
  /**
   * Per-session bubbles for every concurrently active TOP-LEVEL session,
   * most recent first; optional so older hosts without the multi-session
   * view stay consumable. The single 'bubble' above mirrors the display
   * session.
   */
  sessions?: PetSessionView[]
  /** Affinity ledger snapshot. */
  affinity: PetAffinityView
  /** Display configuration. */
  display: PetDisplayConfig
  /** The selected pet's registry identity. */
  pet: {
    /** Registry id. */
    id: string
    /** Manifest display name (unrenamed default). */
    displayName: string
    /** Manifest description. */
    description: string
  }
  /** The selected pet's display name (user rename or manifest default). */
  name: string
  /** Treat (小鱼干) stock snapshot. */
  treats: {
    /** Stocked treats now. */
    stocked: number
    /** Stock cap. */
    max: number
  }
  /** Desktop presentation state; omitted by older Hosts. */
  companion?: PetDesktopSettings
  /**
   * The display session's fresh inner whisper (碎碎念), when one is within
   * its TTL — short inner-voice copy woken by the model's own output,
   * rendered by the client as a distinct whisper bubble.
   */
  whisper?: string
}

/** Result of `pet.interact`, including the renderer-neutral reaction intent. */
export interface PetInteractResult extends LedgerInteractionResult {
  intent: PetIntent
}

type PetStateListener = (snapshot: PetStateView) => void

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
  }
}

/** Per-session pet activity: projection runtime plus the session's own machine. */
interface SessionActivity {
  runtime: ProjectionRuntime
  machine: PetStateMachine
  /** The session's most recent meaningful input (for display fallback). */
  lastInput?: PetStateInput
  /** Latest inner whisper woken by this session's model output (碎碎念). */
  whisper?: {
    /** Whisper copy. */
    text: string
    /** Epoch ms when it appeared (view-side TTL applies). */
    at: number
  }
}

/**
 * Cordis service exposing the pet RPC domain. Lazy: nothing is scanned or
 * written until an economic event or interaction arrives; event listeners
 * update only in-memory state, and persistence happens on economic changes
 * (turn rewards, feeds, config/name changes) — never on a read.
 */
export class PetService extends Service {
  static inject: string[] = []

  private readonly machine: PetStateMachine
  private readonly stateConfig: PetStateConfig
  private readonly ledger: PetLedger
  private readonly registry: PetRegistry
  private readonly persistDir: string
  private enabled: boolean
  private desktop: PetDesktopSettings
  private disposeActivity: (() => void) | undefined
  private readonly presentationTimers = new Map<Session, NodeJS.Timeout>()
  private readonly cooldownTimers = new Map<PetInteraction, NodeJS.Timeout>()
  private whisperTimer: NodeJS.Timeout | undefined
  private readonly stateListeners = new Set<PetStateListener>()
  /** Session whose most recent meaningful event currently drives the global pet. */
  private displaySession: Session | undefined
  /**
   * Per-session activity, most recent last (Map insertion order). Bounded by
   * MAX_SESSION_BUBBLES so a burst of sessions cannot grow it without bound;
   * disposed sessions are removed by the 'session/disposed' listener.
   */
  private readonly sessionActivity = new Map<Session, SessionActivity>()

  constructor(ctx: Context, config: PetConfig = {}) {
    super(ctx, 'pet')
    this.persistDir = config.persistDir ?? petHomeDir()
    this.registry = config.registry
      ?? loadPetRegistry({
        packageRoot: petPackageRoot(import.meta.url),
        ...(config.pets === undefined ? {} : { extra: config.pets }),
      })
    if (this.registry.entries.length === 0) {
      throw new Error('[dsh-pet] no valid pet manifests found; nothing to render')
    }
    let persist = loadPetPersist(this.persistDir)
    if (this.registry.byId(persist.petId) === undefined) {
      // The selected pet no longer exists (removed or a fresh install with a
      // copied pet.json): fall back to the registry default.
      persist = { ...persist, petId: this.registry.defaultEntry().id }
    }
    const selected = this.registry.byId(persist.petId) ?? this.registry.defaultEntry()
    const ledgerConfig: LedgerConfig = {
      affinity: config.affinity,
      treats: config.treats,
      remarks: selected.remarks,
    }
    this.ledger = new PetLedger(persist, ledgerConfig)
    this.stateConfig = { ...defaultPetStateConfig, ...(config.state ?? {}) }
    this.machine = new PetStateMachine(this.stateConfig)
    this.enabled = config.enabled ?? true
    this.desktop = normalizePetDesktopSettings(config.desktop)

    this.syncActivity()
    ctx.effect(() => () => {
      // Notify active native streams before dropping listeners so plugin
      // reload/unload cannot leave a heartbeat-only connection behind.
      this.enabled = false
      this.clearPresentationTimers()
      this.clearCooldownTimers()
      this.clearWhisperTimer()
      this.publishState()
      this.stateListeners.clear()
    }, 'pet: state stream')
  }

  /** Whether the pet service consumes session activity while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** RPC: current pet state snapshot. */
  async state(): Promise<PetStateView> {
    return this.view()
  }

  /** Subscribe to the Host-owned snapshot used by browser polling and native SSE. */
  subscribeState(listener: PetStateListener): () => void {
    this.stateListeners.add(listener)
    listener(this.view())
    return () => { this.stateListeners.delete(listener) }
  }

  /** Current desktop lifecycle and surface preferences. */
  desktopSettings(): PetDesktopSettings {
    return { ...this.desktop, enabled: this.enabled && this.desktop.enabled }
  }

  /** Describe the registered pet namespace for the standalone settings card. */
  async settingsView(): Promise<PetSettingsView> {
    const settings = this.settingsProvider()
    const descriptor = settings.describe({ redactSecrets: true })
      .find(candidate => String(candidate.ns) === PET_SETTINGS_NAMESPACE)
    if (descriptor === undefined) throw new Error('pet-settings-unavailable')
    return {
      value: descriptor.value as PetSettingsSection,
      ...(descriptor.base === undefined ? {} : { base: descriptor.base as Partial<PetSettingsSection> }),
      ...(descriptor.user === undefined ? {} : { user: descriptor.user as Partial<PetSettingsSection> }),
      revision: descriptor.revision,
      writable: settings.writable !== false,
    }
  }

  /** Apply a revision-fenced settings mutation through the official Host seam. */
  async mutateSettings(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<PetSettingsView> {
    const settings = this.settingsProvider()
    await settings.mutate(
      PET_SETTINGS_NAMESPACE as SettingsNamespace,
      ops,
      expectedRevision,
    )
    return this.settingsView()
  }

  /** Current persisted display config (read-only view). */
  display(): PetDisplayConfig {
    return { ...this.ledger.snapshot.display }
  }

  /** RPC: the registry entries the browser half renders and selects from. */
  async pets(): Promise<PetDefinition[]> {
    return this.registry.entries.map(petEntryView)
  }

  /** The loaded registry (the asset routes serve its entries). */
  registrySnapshot(): PetRegistry {
    return this.registry
  }

  /** The selected pet's registry entry. */
  activeEntry(): NonNullable<PetRegistry['entries'][number]> {
    return this.registry.byId(this.selectedPetId()) ?? this.registry.defaultEntry()
  }

  /** Currently selected pet id (persisted). */
  selectedPetId(): string {
    return this.ledger.snapshot.petId
  }

  /** The display name of one pet (user rename or manifest displayName). */
  petName(petId: string = this.selectedPetId()): string {
    const stored = this.ledger.snapshot.names[petId]
    if (stored !== undefined && stored.trim() !== '') return stored
    return this.registry.byId(petId)?.displayName ?? DEFAULT_PET_NAME
  }

  /** RPC: switch the selected pet (persisted, settings document mirrored). */
  async setPetId(petId: string): Promise<{ ok: true; petId: string } | { ok: false; error: string }> {
    const entry = this.registry.byId(petId)
    if (entry === undefined) return { ok: false, error: 'unknown-pet' }
    this.ledger.setPetId(entry.id)
    this.ledger.setRemarks(entry.remarks)
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, petId: entry.id }
  }

  /** Start or stop the session-activity listeners that drive the pet. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.syncActivity()
    this.publishState()
  }

  private syncActivity(): void {
    if (this.disposeActivity !== undefined) {
      this.disposeActivity()
      this.disposeActivity = undefined
    }
    if (!this.enabled) return
    this.disposeActivity = (() => {
      const disposers = [
        this.ctx.on('session/event', (session: Session, event: SessionEvent) => {
          const runtime = this.activityOf(session).runtime
          // `activity/status` is an optional compatibility input. It is not
          // declared as a durable event type by this package because current
          // Harness installations publish the official session vocabulary.
          if ((event.type as string) === 'activity/status') {
            const payload = ((event as unknown as { data?: unknown }).data ?? {}) as ActivityStatusEventLike
            if (typeof payload.phase !== 'string' || !isActivityPhase(payload.phase)) return
            this.applyActivity(session, {
              phase: payload.phase,
              ...(typeof payload.line === 'string' ? { line: payload.line } : {}),
              ...(typeof payload.phrase === 'string' ? { phrase: payload.phrase } : {}),
            })
            // On a legacy-only stream the compatibility event owns turn
            // rewards. Once any official activity is observed, turn/end owns
            // them and a derived legacy `done` cannot double-count.
            if (payload.phase === 'done' && !runtime.officialEventsSeen) {
              this.rewardLegacyTurn()
            }
            return
          }

          const transition = projectOfficialEvent(event, runtime)
          if (transition === undefined) return
          runtime.officialEventsSeen = true
          this.applyActivity(session, transition.input, transition.whisper)
          if (transition.completedTurn !== undefined) {
            this.rewardTurn(String(session.id), transition.completedTurn)
          }
        }),
        this.ctx.on('session/disposed', (session: Session) => {
          this.clearPresentationTimer(session)
          this.ledger.forgetSession(String(session.id))
          this.sessionActivity.delete(session)
          if (session !== this.displaySession) {
            this.publishState()
            return
          }
          // The display session is gone: fall back to the most recent
          // remaining session's last input, or settle to idle when none.
          this.displaySession = undefined
          const remaining = [...this.sessionActivity.entries()].at(-1)
          if (remaining !== undefined) {
            const [nextSession, activity] = remaining
            this.displaySession = nextSession
            if (activity.lastInput !== undefined) this.machine.onActivityStatus(activity.lastInput)
            this.machine.onSessionActive()
          } else {
            this.machine.onSessionDisposed()
          }
          this.scheduleWhisperRefresh()
          this.publishState()
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    })()
  }

  /** Return the per-session activity record, creating it on first sight. */
  private activityOf(session: Session): SessionActivity {
    let activity = this.sessionActivity.get(session)
    if (activity === undefined) {
      activity = {
        runtime: emptyProjectionRuntime(),
        machine: new PetStateMachine(this.stateConfig),
      }
      this.sessionActivity.set(session, activity)
    }
    return activity
  }

  /**
   * Commit one activity: the session's own machine renders its bubble, and
   * the session becomes the host-global display session (most recent
   * meaningful event wins the sprite animation).
   */
  private applyActivity(session: Session, input: PetStateInput, whisper?: string): void {
    const activity = this.activityOf(session)
    activity.lastInput = input
    if (whisper !== undefined) {
      activity.whisper = { text: whisper, at: Date.now() }
    }
    activity.machine.onActivityStatus(input)
    activity.machine.onSessionActive()
    // Move to the tail so map order reads most-recent-last, then trim the
    // oldest session states beyond the bubble cap. The display session is
    // reassigned below, so trimming its stale predecessor is safe.
    this.sessionActivity.delete(session)
    this.sessionActivity.set(session, activity)
    while (this.sessionActivity.size > MAX_SESSION_BUBBLES) {
      const oldest = this.sessionActivity.keys().next().value
      if (oldest === undefined) break
      this.sessionActivity.delete(oldest)
      this.clearPresentationTimer(oldest)
    }
    this.displaySession = session
    this.machine.onActivityStatus(input)
    this.machine.onSessionActive()
    this.schedulePresentationRefresh(session, input.phase)
    this.scheduleWhisperRefresh()
    this.publishState()
  }

  /** RPC: pet or feed the pet. */
  async interact(kind: PetInteraction): Promise<PetInteractResult> {
    const nowMs = Date.now()
    const result = this.ledger.interact(kind, nowMs)
    if (this.ledger.takeDirty()) this.flush()
    this.scheduleCooldownRefresh(kind, nowMs)
    this.publishState()
    return {
      ...result,
      intent: createInteractionIntent(kind, result.reaction, nowMs, result.delta > 0),
    }
  }

  /** Update desktop lifecycle/surface preferences through the Host settings document. */
  async setDesktopSettings(
    patch: Partial<PetDesktopSettings>,
  ): Promise<{ ok: true; companion: PetDesktopSettings }> {
    const next = normalizePetDesktopSettings({ ...this.desktop, ...patch })
    const settingsPatch: Partial<PetSettingsSection> = {}
    if (patch.enabled !== undefined) settingsPatch.desktopEnabled = next.enabled
    if (patch.visible !== undefined) settingsPatch.desktopVisible = next.visible
    if (patch.alwaysOnTop !== undefined) settingsPatch.desktopAlwaysOnTop = next.alwaysOnTop
    if (patch.locked !== undefined) settingsPatch.desktopLocked = next.locked
    if (patch.scale !== undefined) settingsPatch.desktopScale = next.scale
    if (Object.keys(settingsPatch).length === 0) {
      return { ok: true, companion: this.desktopSettings() }
    }
    await this.settingsProvider().update(
      PET_SETTINGS_NAMESPACE as SettingsNamespace,
      settingsPatch,
    )
    const accepted = (await this.settingsView()).value
    this.desktop = normalizePetDesktopSettings({
      enabled: accepted.desktopEnabled,
      visible: accepted.desktopVisible,
      alwaysOnTop: accepted.desktopAlwaysOnTop,
      locked: accepted.desktopLocked,
      scale: accepted.desktopScale,
    })
    this.publishState()
    return { ok: true, companion: this.desktopSettings() }
  }

  /** RPC: show or hide the pet. */
  async setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }> {
    this.ledger.setDisplay({ ...this.ledger.snapshot.display, visible })
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: update display config (size / position). Values are clamped to whole pixels. */
  async setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }> {
    const next = { ...this.ledger.snapshot.display, ...patch }
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, next.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.bottom)))
    this.ledger.setDisplay(next)
    this.flush()
    this.syncSettingsFromPet()
    this.publishState()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: rename the selected pet (trimmed, 1–20 chars, per-pet storage). */
  async setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'name-empty' }
    if (trimmed.length > PET_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' }
    this.ledger.setPetName(this.selectedPetId(), trimmed)
    this.flush()
    this.publishState()
    return { ok: true, name: trimmed }
  }

  /**
   * Apply a committed settings section to the persisted selection and display
   * config. Called by the settings surface on every change; values are
   * clamped exactly like the setConfig RPC so both write paths converge.
   * @param section - the resolved settings section.
   */
  applySettingsSection(section: PetSettingsSection): void {
    const selected = typeof section.petId === 'string' ? this.registry.byId(section.petId) : undefined
    if (selected !== undefined) {
      this.ledger.setPetId(selected.id)
      this.ledger.setRemarks(selected.remarks)
    } else if (section.petId !== undefined) {
      // The stored selection names a pet the registry no longer has: keep the
      // current selection and repair the settings document.
      this.syncSettingsFromPet()
    }
    const next = { ...this.ledger.snapshot.display }
    next.visible = section.visible && (section.enabled ?? true)
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, section.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.bottom)))
    this.ledger.setDisplay(next)
    this.desktop = normalizePetDesktopSettings({
      enabled: section.desktopEnabled ?? DEFAULT_PET_DESKTOP_SETTINGS.enabled,
      visible: section.desktopVisible ?? DEFAULT_PET_DESKTOP_SETTINGS.visible,
      alwaysOnTop: section.desktopAlwaysOnTop ?? DEFAULT_PET_DESKTOP_SETTINGS.alwaysOnTop,
      locked: section.desktopLocked ?? DEFAULT_PET_DESKTOP_SETTINGS.locked,
      scale: section.desktopScale ?? DEFAULT_PET_DESKTOP_SETTINGS.scale,
    })
    this.flush()
    this.publishState()
  }

  /** Mirror the persisted display config into the settings document (best-effort). */
  private syncSettingsFromPet(): void {
    const settings = this.ctx.get('settings', false) as { update(ns: string, patch: object): Promise<void> } | undefined
    if (settings === undefined) return
    const snapshot = this.ledger.snapshot
    void settings.update(PET_SETTINGS_NAMESPACE, {
      visible: snapshot.display.visible,
      size: snapshot.display.size,
      right: snapshot.display.right,
      bottom: snapshot.display.bottom,
      petId: snapshot.petId,
    }).catch(() => {
      // A settings write failure must not break the pet's own persistence.
    })
  }

  /** Award the turn reward once per completed turn (idempotent per session + turn). */
  private rewardTurn(sessionId: string, turn: number): void {
    if (!this.ledger.rewardTurn(sessionId, turn, Date.now())) return
    this.flush()
    this.publishState()
  }

  /** Preserve turn rewards for installations that only emit legacy activity. */
  private rewardLegacyTurn(): void {
    if (!this.ledger.rewardLegacyTurn(Date.now())) return
    this.flush()
    this.publishState()
  }

  private view(): PetStateView {
    const snapshot = this.machine.render()
    const entry = this.activeEntry()
    // One bubble per concurrently active TOP-LEVEL session, most recent
    // first. Subagent children render no bubble of their own (their activity
    // already shows through the spawning conversation's bubble/display, and
    // the bubble buttons navigate to GUI sessions, which subagents are not).
    // Sessions whose own machine has settled (no bubble copy) drop out, so a
    // finished turn does not leave a stale bubble behind.
    const sessions: PetSessionView[] = []
    for (const [session, activity] of [...this.sessionActivity.entries()].reverse()) {
      if (sessions.length >= MAX_SESSION_BUBBLES) break
      if (session.header?.origin === 'subagent') continue
      const perSession = activity.machine.render()
      if (perSession.bubble === undefined) continue
      sessions.push({
        sessionId: String(session.id),
        animation: perSession.animation,
        bubble: perSession.bubble,
        phase: perSession.phase,
      })
    }
    // The display session's inner whisper rides the global view while fresh;
    // an expired whisper simply stops appearing (the client's 2s poll drops it).
    const displayActivity = this.displaySession === undefined
      ? undefined
      : this.sessionActivity.get(this.displaySession)
    const whisper = displayActivity?.whisper
    const freshWhisper = whisper !== undefined && Date.now() - whisper.at < WHISPER_TTL_MS
      ? whisper.text
      : undefined
    // Read-only: the ledger settles on economic events only, never on a read,
    // so polling the state cannot trigger pet.json writes.
    return {
      animation: snapshot.animation,
      ...(snapshot.bubble === undefined ? {} : { bubble: snapshot.bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
      sessions,
      ...(freshWhisper === undefined ? {} : { whisper: freshWhisper }),
      affinity: this.ledger.affinityView(Date.now()),
      display: { ...this.ledger.snapshot.display },
      pet: {
        id: entry.id,
        displayName: entry.displayName,
        description: entry.description,
      },
      name: this.petName(),
      treats: {
        stocked: this.ledger.snapshot.treats.treats,
        max: this.ledger.treatMax,
      },
      companion: this.desktopSettings(),
    }
  }

  private settingsProvider(): SettingsProvider {
    const settings = this.ctx.get('settings', false)
    if (settings === undefined) throw new Error('pet-settings-unavailable')
    return settings
  }

  /** Publish the time-based end of a completion pose to push-only consumers. */
  private schedulePresentationRefresh(session: Session, phase: PetStateInput['phase']): void {
    this.clearPresentationTimer(session)
    const duration = phase === 'done'
      ? this.stateConfig.celebrateMs
      : phase === 'failed'
        ? this.stateConfig.failureMs
        : undefined
    if (duration === undefined) return
    const timer = setTimeout(() => {
      if (this.presentationTimers.get(session) !== timer) return
      this.presentationTimers.delete(session)
      this.publishState()
    }, duration + 1)
    this.presentationTimers.set(session, timer)
    timer.unref?.()
  }

  private clearPresentationTimer(session: Session): void {
    const timer = this.presentationTimers.get(session)
    if (timer !== undefined) clearTimeout(timer)
    this.presentationTimers.delete(session)
  }

  private clearPresentationTimers(): void {
    for (const timer of this.presentationTimers.values()) clearTimeout(timer)
    this.presentationTimers.clear()
  }

  /** Publish when an interaction cooldown ends so push-only clients stay current. */
  private scheduleCooldownRefresh(kind: PetInteraction, nowMs: number): void {
    this.clearCooldownTimer(kind)
    const affinity = this.ledger.snapshot.affinity
    const lastAt = kind === 'pet' ? affinity.lastPetAt : affinity.lastFeedAt
    if (lastAt === 0) return
    const duration = kind === 'pet'
      ? this.ledger.affinity.petCooldownMs
      : this.ledger.affinity.feedCooldownMs
    const remainingMs = duration - (nowMs - lastAt)
    if (remainingMs <= 0) return
    const timer = setTimeout(() => {
      if (this.cooldownTimers.get(kind) !== timer) return
      this.cooldownTimers.delete(kind)
      this.publishState()
    }, remainingMs + 1)
    this.cooldownTimers.set(kind, timer)
    timer.unref?.()
  }

  private clearCooldownTimer(kind: PetInteraction): void {
    const timer = this.cooldownTimers.get(kind)
    if (timer !== undefined) clearTimeout(timer)
    this.cooldownTimers.delete(kind)
  }

  private clearCooldownTimers(): void {
    for (const timer of this.cooldownTimers.values()) clearTimeout(timer)
    this.cooldownTimers.clear()
  }

  /** Publish when the displayed whisper expires so SSE does not leave stale copy. */
  private scheduleWhisperRefresh(): void {
    this.clearWhisperTimer()
    const activity = this.displaySession === undefined
      ? undefined
      : this.sessionActivity.get(this.displaySession)
    const whisper = activity?.whisper
    if (whisper === undefined) return
    const remainingMs = WHISPER_TTL_MS - (Date.now() - whisper.at)
    if (remainingMs <= 0) return
    this.whisperTimer = setTimeout(() => {
      this.whisperTimer = undefined
      this.publishState()
    }, remainingMs + 1)
    this.whisperTimer.unref?.()
  }

  private clearWhisperTimer(): void {
    if (this.whisperTimer !== undefined) clearTimeout(this.whisperTimer)
    this.whisperTimer = undefined
  }

  private publishState(): void {
    if (this.stateListeners.size === 0) return
    const snapshot = this.view()
    for (const listener of [...this.stateListeners]) {
      try {
        listener(snapshot)
      } catch {
        // One closed native stream must not unwind Host session projection.
      }
    }
  }

  private flush(): void {
    try {
      savePetPersist(this.ledger.snapshot, this.persistDir)
    } catch {
      // Persistence is best-effort; the in-memory ledger keeps working.
    }
  }
}
