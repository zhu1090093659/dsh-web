/**
 * Pet host service — the `pet.*` RPC domain. A composition facade: it wires
 * the pure event projection (`event-projection`) onto the state machine,
 * delegates the affinity economy to the ledger (`ledger`), and routes
 * persistence through `persist`. The API gateway maps these methods onto
 * `pet.state` / `pet.pets` / `pet.interact` / `pet.setVisible` /
 * `pet.setConfig` / `pet.setName` / `pet.setPet` for browser consumers.
 * @module @linxin666/dsh-pet/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { AffinityConfig, PetAffinityView, PetInteraction } from './affinity.ts'
import type { TreatConfig } from './treats.ts'
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
  type PetSkin,
} from './persist.ts'
import {
  loadPetRegistry,
  petEntryView,
  petPackageRoot,
  type PetDefinition,
  type PetManifest,
  type PetRegistry,
} from './registry.ts'
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
  /** Selected skin variant when the pet provides one. */
  skin?: PetSkin
  /** Master switch for the plugin (browser half + host routes). */
  enabled?: boolean
}

/** Settings namespace of the pet capability. Spelled here rather than imported: the browser half spells the same value. */
export const PET_SETTINGS_NAMESPACE = 'pet'

/** Snapshot returned by `pet.state`. */
export interface PetStateView {
  animation: PetStateSnapshot['animation']
  bubble?: string
  phase: PetStateSnapshot['phase']
  sessionActive: boolean
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
}

/** Result of `pet.interact`. */
export type PetInteractResult = LedgerInteractionResult

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
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
  private readonly ledger: PetLedger
  private readonly registry: PetRegistry
  private readonly persistDir: string
  private enabled: boolean
  private disposeActivity: (() => void) | undefined
  /** Session whose most recent meaningful event currently drives the global pet. */
  private displaySession: Session | undefined
  private readonly sessionActivity = new WeakMap<Session, ProjectionRuntime>()

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
    const ledgerConfig: LedgerConfig = { affinity: config.affinity, treats: config.treats }
    this.ledger = new PetLedger(persist, ledgerConfig)
    this.machine = new PetStateMachine({
      ...defaultPetStateConfig,
      ...(config.state ?? {}),
    })
    this.enabled = config.enabled ?? true

    this.syncActivity()
  }

  /** Whether the pet service consumes session activity while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** RPC: current pet state snapshot. */
  async state(): Promise<PetStateView> {
    return this.view()
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
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, petId: entry.id }
  }

  /** Start or stop the session-activity listeners that drive the pet. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.syncActivity()
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
          const runtime = this.activityRuntime(session)
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
          this.applyActivity(session, transition.input)
          if (transition.completedTurn !== undefined) {
            this.rewardTurn(String(session.id), transition.completedTurn)
          }
        }),
        this.ctx.on('session/disposed', (session: Session) => {
          if (session !== this.displaySession) return
          this.displaySession = undefined
          this.machine.onSessionDisposed()
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    })()
  }

  /** Return the projection state associated with one live session. */
  private activityRuntime(session: Session): ProjectionRuntime {
    let runtime = this.sessionActivity.get(session)
    if (runtime === undefined) {
      runtime = emptyProjectionRuntime()
      this.sessionActivity.set(session, runtime)
    }
    return runtime
  }

  /** Commit one activity as the host-global pet's most recent display state. */
  private applyActivity(session: Session, input: PetStateInput): void {
    this.displaySession = session
    this.machine.onActivityStatus(input)
    this.machine.onSessionActive()
  }

  /** RPC: pet or feed the pet. */
  async interact(kind: PetInteraction): Promise<PetInteractResult> {
    const nowMs = Date.now()
    const result = this.ledger.interact(kind, nowMs)
    if (this.ledger.takeDirty()) this.flush()
    return result
  }

  /** RPC: show or hide the pet. */
  async setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }> {
    this.ledger.setDisplay({ ...this.ledger.snapshot.display, visible })
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: update display config (size / position). Values are clamped to whole pixels. */
  async setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }> {
    const next = { ...this.ledger.snapshot.display, ...patch }
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, next.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.bottom)))
    next.skin = next.skin === 'original' ? 'original' : 'refined'
    this.ledger.setDisplay(next)
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.ledger.snapshot.display }
  }

  /** RPC: rename the selected pet (trimmed, 1–20 chars, per-pet storage). */
  async setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'name-empty' }
    if (trimmed.length > PET_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' }
    this.ledger.setPetName(this.selectedPetId(), trimmed)
    this.flush()
    return { ok: true, name: trimmed }
  }

  /**
   * Apply a committed settings section to the persisted selection and display
   * config. Called by the settings surface on every change; values are
   * clamped exactly like the setConfig RPC so both write paths converge.
   * @param section - the resolved settings section.
   */
  applySettingsSection(section: PetSettingsSection): void {
    if (typeof section.petId === 'string' && this.registry.byId(section.petId) !== undefined) {
      this.ledger.setPetId(section.petId)
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
    next.skin = section.skin === 'original' ? 'original' : 'refined'
    this.ledger.setDisplay(next)
    this.flush()
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
      skin: snapshot.display.skin,
      petId: snapshot.petId,
    }).catch(() => {
      // A settings write failure must not break the pet's own persistence.
    })
  }

  /** Award the turn reward once per completed turn (idempotent per session + turn). */
  private rewardTurn(sessionId: string, turn: number): void {
    if (this.ledger.rewardTurn(sessionId, turn, Date.now())) this.flush()
  }

  /** Preserve turn rewards for installations that only emit legacy activity. */
  private rewardLegacyTurn(): void {
    if (this.ledger.rewardLegacyTurn(Date.now())) this.flush()
  }

  private view(): PetStateView {
    const snapshot = this.machine.render()
    const entry = this.activeEntry()
    // Read-only: the ledger settles on economic events only, never on a read,
    // so polling the state cannot trigger pet.json writes.
    return {
      animation: snapshot.animation,
      ...(snapshot.bubble === undefined ? {} : { bubble: snapshot.bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
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
