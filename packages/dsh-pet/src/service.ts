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
import type { AffinityConfig, PetAffinityView, PetInteraction } from './affinity.ts'
import { announcementFresh, parseAnnouncement, type PetAnnouncement } from './announce.ts'
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
} from './persist.ts'
import {
  DEFAULT_DECORATION_ID,
  decorationView,
  loadPetRegistry,
  petEntryView,
  petPackageRoot,
  type PetDefinition,
  type PetManifest,
  type PetRegistry,
  type PetRegistryDiagnostic,
} from './registry.ts'
import { WHISPER_TTL_MS, type VoicePackOverrides, type VoicePoolsProvider } from './chatter.ts'
import { mergeVoicePacks } from './voice-pack.ts'
import type { DecorationView } from './contracts/status-decoration.ts'
import {
  defaultPetStateConfig,
  PetStateMachine,
  type PetStateConfig,
  type PetStateInput,
  type PetStateSnapshot,
} from './state.ts'
import {
  applyGameplayEffects,
  drawLotteryTier,
  initialGameplayState,
  rollTouchBranch,
  rollWorkOutcome,
  settleGameplay,
  type PetGameplayManifest,
  type PetGameplayState,
} from './gameplay.ts'

/** The unified gameplay currency: the shared treat (小鱼干) ledger. */
const GAMEPLAY_TREATS_CURRENCY = 'treats'

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
  /** Status-decoration master switch (pet-center M5, #567); defaults to on. */
  decorationEnabled?: boolean
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
  /**
   * Status-decoration master switch (pet-center M5, #567). Defaults to on;
   * the settings surface mirrors this field and can turn it off.
   */
  decorationEnabled?: boolean
}

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
  /** This session's fresh inner whisper (碎碎念), when one is within its TTL. */
  whisper?: string
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
   * Per-session bubbles for every concurrently active TOP-LEVEL session:
   * the GUI's current session first when reported, the rest most recently
   * active first; optional so older hosts without the multi-session view
   * stay consumable. The single 'bubble' above mirrors the display session.
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
  /**
   * The active status decoration (pet-center M5, #567), when the master
   * switch is on and the default decoration entry exists. Absent means the
   * browser half renders no ornament.
   */
  decoration?: DecorationView
  /**
   * The selected pet's gameplay view (miku-pet generalization), present
   * when the pet declares a gameplay block. Read-only projection: polling
   * settles the view in memory but never writes pet.json.
   */
  gameplay?: PetGameplayStateView
  /**
   * The freshest plugin-authored announcement (dsh-usage linkage), within
   * its TTL; absent when none is fresh. Rendered as a dedicated styled
   * bubble above the session stack.
   */
  announcement?: PetAnnouncement
}

/** Result of `pet.interact`. */
export type PetInteractResult = LedgerInteractionResult

/** The gameplay slice of the state view (dynamic state only; defs ride the pet definition). */
export interface PetGameplayStateView {
  /** Stat values rounded for display. */
  stats: Record<string, number>
  mode: 'work' | 'sleep' | null
}

/** Result of the gameplay verbs (touch / setMode / workTick / buy). */
export interface PetGameplayVerbResult {
  ok: boolean
  error?: string
  /** Touch: whether a branch hit, plus its presentation. */
  hit?: boolean
  state?: string
  stateMs?: number
  phrase?: string
  /** Work tick outcome. */
  outcome?: 'success' | 'fail'
  /** Shop purchase: the drawn prize, when the item was a lottery. */
  prize?: { amount: number; currency: string }
  view?: PetGameplayStateView
}

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
  /** Status-decoration master switch (M5, #567); mirrored from settings. */
  private decorationEnabled: boolean
  /** The freshest plugin-authored announcement (dsh-usage linkage). */
  private announcement: PetAnnouncement | undefined
  private disposeActivity: (() => void) | undefined
  /** Session whose most recent meaningful event currently drives the global pet. */
  private displaySession: Session | undefined
  /**
   * Effective voice-pack overrides for the currently selected pet (M4,
   * #677). Cached per pet id; the registry is an immutable snapshot, so the
   * global pack and each entry's pack cannot change behind the cache.
   */
  private voiceCache: { petId: string; overrides: VoicePackOverrides } | undefined
  /**
   * Per-session activity, most recent last (Map insertion order). Bounded by
   * MAX_SESSION_BUBBLES so a burst of sessions cannot grow it without bound;
   * disposed sessions are removed by the 'session/disposed' listener.
   */
  private readonly sessionActivity = new Map<Session, SessionActivity>()
  /**
   * Sessions whose reward source is the official event stream. This metadata
   * outlives transient visual resets so a derived legacy `done` cannot reward
   * the same turn again after the pet is disabled and re-enabled.
   */
  private readonly officialEventSessions = new WeakSet<Session>()

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
    const voiceRemarks = mergeVoicePacks(this.registry.globalVoice, selected.voice)?.remarks
    const ledgerConfig: LedgerConfig = {
      affinity: config.affinity,
      treats: config.treats,
      remarks: selected.remarks,
      voiceRemarks,
    }
    this.ledger = new PetLedger(persist, ledgerConfig)
    this.stateConfig = { ...defaultPetStateConfig, ...(config.state ?? {}) }
    this.machine = new PetStateMachine(this.stateConfig)
    this.enabled = config.enabled ?? true
    this.decorationEnabled = config.decorationEnabled ?? true

    this.syncActivity()
  }

  /**
   * The draw-time voice-pool provider handed to every projection runtime.
   * It re-resolves when the selected pet changes, so live engines re-voice
   * on the next draw without being rebuilt (M4, #677).
   */
  private voicePools(): VoicePoolsProvider {
    return () => {
      const entry = this.activeEntry()
      if (this.voiceCache !== undefined && this.voiceCache.petId === entry.id) {
        return this.voiceCache.overrides
      }
      const overrides = mergeVoicePacks(this.registry.globalVoice, entry.voice)?.overrides ?? {}
      this.voiceCache = { petId: entry.id, overrides }
      return overrides
    }
  }

  /** Whether the pet service consumes session activity while enabled. */
  isEnabled(): boolean {
    return this.enabled
  }

  /** RPC: current pet state snapshot. */
  async state(currentSessionId?: string): Promise<PetStateView> {
    return this.view(currentSessionId)
  }

  /**
   * RPC: one plugin-authored announcement bubble (dsh-usage linkage). The
   * payload is validated into a bounded PetAnnouncement; a malformed one is
   * dropped silently — a sibling plugin's bug must never surface as pet
   * breakage. The announcement is in-memory only.
   */
  announce(input: unknown): { ok: boolean } {
    const parsed = parseAnnouncement(input, Date.now())
    if (parsed === undefined) return { ok: false }
    this.announcement = parsed
    return { ok: true }
  }

  /** Current persisted display config (read-only view). */
  display(): PetDisplayConfig {
    return { ...this.ledger.snapshot.display }
  }

  /** RPC: the registry entries the browser half renders and selects from. */
  async pets(): Promise<PetDefinition[]> {
    return this.registry.entries.map(entry => petEntryView(entry, this.registry.globalVoice))
  }

  /** The loaded registry (the asset routes serve its entries). */
  registrySnapshot(): PetRegistry {
    return this.registry
  }

  /** RPC: structured registry diagnostics (pet-center M2, issue #623). */
  async diagnostics(): Promise<{ diagnostics: PetRegistryDiagnostic[] }> {
    return { diagnostics: this.registry.diagnostics }
  }

  /**
   * The active status decoration view (M5, #567): the default 'whale' entry
   * (user directories override built-ins by id), gated by the master switch.
   */
  private activeDecoration(): DecorationView | undefined {
    if (!this.decorationEnabled) return undefined
    const entry = this.registry.decorationById?.(DEFAULT_DECORATION_ID)
    return entry === undefined ? undefined : decorationView(entry)
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
    const voiceRemarks = mergeVoicePacks(this.registry.globalVoice, entry.voice)?.remarks
    this.ledger.setRemarks(entry.remarks, voiceRemarks)
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, petId: entry.id }
  }

  /** Start or stop the session-activity listeners that drive the pet. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.syncActivity()
    if (!enabled) this.resetActivity()
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
          this.officialEventSessions.add(session)
          this.applyActivity(session, transition.input, transition.whisper)
          if (transition.completedTurn !== undefined) {
            this.rewardTurn(String(session.id), transition.completedTurn)
          }
        }),
        this.ctx.on('session/disposed', (session: Session) => {
          this.ledger.forgetSession(String(session.id))
          this.officialEventSessions.delete(session)
          this.sessionActivity.delete(session)
          if (session !== this.displaySession) return
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
        }),
      ]
      return () => { for (const dispose of disposers) dispose() }
    })()
  }

  /** Drop transient activity because terminal events missed while disabled cannot be replayed safely. */
  private resetActivity(): void {
    this.displaySession = undefined
    this.sessionActivity.clear()
    this.machine.onSessionDisposed()
  }

  /** Return the per-session activity record, creating it on first sight. */
  private activityOf(session: Session): SessionActivity {
    let activity = this.sessionActivity.get(session)
    if (activity === undefined) {
      const runtime = emptyProjectionRuntime(this.voicePools())
      runtime.officialEventsSeen = this.officialEventSessions.has(session)
      activity = {
        runtime,
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
    if (whisper !== undefined) activity.whisper = { text: whisper, at: Date.now() }
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
    }
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

  /* ---------------------------------------------------------------- *
   * Gameplay verbs (miku-pet generalization). The manifest block lives
   * on the registry entry; dynamic state persists per pet id. Verbs
   * settle and persist; the state view projects without writing.
   * ---------------------------------------------------------------- */

  /** The active pet's gameplay block, if it declares one. */
  private gameplayDef(): PetGameplayManifest | undefined {
    return this.activeEntry().gameplay
  }

  /** The persisted (or fresh) gameplay state of the selected pet. */
  private gameplayState(def: PetGameplayManifest, now: number): { petId: string; state: PetGameplayState } {
    const petId = this.selectedPetId()
    const stored = this.ledger.snapshot.gameplay[petId]
    return {
      petId,
      state: stored === undefined
        ? initialGameplayState(def, now)
        : { stats: { ...stored.stats }, currencies: { ...stored.currencies }, mode: stored.mode, settledAt: stored.settledAt },
    }
  }

  /** Display view of one gameplay state (rounded stats; treats ride the shared treat ledger). */
  private gameplayViewOf(state: PetGameplayState): PetGameplayStateView {
    const stats: Record<string, number> = {}
    for (const [name, value] of Object.entries(state.stats)) stats[name] = Math.round(value)
    return { stats, mode: state.mode }
  }

  /**
   * Move gameplay 'treats' currency (the unified post-wallet currency) from
   * the engine's settle work area into the shared treat ledger, capped by
   * the stock cap. The engine keeps its generic currency record for settle
   * math; this drain is the only bridge to the wallet-free economy.
   */
  private drainGameplayTreats(state: PetGameplayState): void {
    const pending = Math.floor(state.currencies[GAMEPLAY_TREATS_CURRENCY] ?? 0)
    delete state.currencies[GAMEPLAY_TREATS_CURRENCY]
    if (pending > 0) this.ledger.grantTreats(pending)
  }

  /** Persist the mutated gameplay state of one verb call. */
  private commitGameplay(petId: string, state: PetGameplayState): void {
    this.ledger.setGameplay(petId, state)
    if (this.ledger.takeDirty()) this.flush()
  }

  /**
   * RPC: a touch on the pet. 'zone' names a touch zone (roll a branch);
   * omitted means a plain click while a touch animation holds (clickBoost).
   */
  async gameplayTouch(zone?: string): Promise<PetGameplayVerbResult> {
    const def = this.gameplayDef()
    if (def === undefined) return { ok: false, error: 'no-gameplay' }
    const now = Date.now()
    const { petId, state } = this.gameplayState(def, now)
    settleGameplay(state, def, now, { sessionActive: this.machine.render().sessionActive })
    if (zone === undefined) {
      const boost = def.touch?.clickBoost
      if (boost === undefined) return { ok: false, error: 'no-touch' }
      const amount = boost.min + Math.floor(Math.random() * (boost.max - boost.min + 1))
      if (amount > 0) applyGameplayEffects(state, def, [{ stat: boost.stat, amount }])
      this.drainGameplayTreats(state)
      this.commitGameplay(petId, state)
      return { ok: true, hit: false, view: this.gameplayViewOf(state) }
    }
    const target = def.touch?.zones.find(entry => entry.name === zone)
    if (target === undefined) return { ok: false, error: 'unknown-zone' }
    const branch = rollTouchBranch(target, Math.random)
    if (branch === undefined) {
      this.drainGameplayTreats(state)
      this.commitGameplay(petId, state)
      return { ok: true, hit: false, view: this.gameplayViewOf(state) }
    }
    if (branch.effects !== undefined) applyGameplayEffects(state, def, branch.effects)
    const phrase = branch.phrases !== undefined && branch.phrases.length > 0
      ? branch.phrases[Math.floor(Math.random() * branch.phrases.length)]
      : undefined
    this.drainGameplayTreats(state)
    this.commitGameplay(petId, state)
    return {
      ok: true,
      hit: true,
      ...(branch.state === undefined ? {} : { state: branch.state }),
      ...(branch.stateMs === undefined ? {} : { stateMs: branch.stateMs }),
      ...(phrase === undefined ? {} : { phrase }),
      view: this.gameplayViewOf(state),
    }
  }

  /** RPC: enter or leave a gameplay mode ('work' | 'sleep' | null). */
  async gameplaySetMode(mode: 'work' | 'sleep' | null): Promise<PetGameplayVerbResult> {
    const def = this.gameplayDef()
    if (def === undefined) return { ok: false, error: 'no-gameplay' }
    if (mode === 'work' && def.work === undefined) return { ok: false, error: 'no-work' }
    if (mode === 'sleep' && def.sleep === undefined) return { ok: false, error: 'no-sleep' }
    const now = Date.now()
    const { petId, state } = this.gameplayState(def, now)
    settleGameplay(state, def, now, { sessionActive: this.machine.render().sessionActive })
    state.mode = mode
    this.drainGameplayTreats(state)
    this.commitGameplay(petId, state)
    return { ok: true, view: this.gameplayViewOf(state) }
  }

  /** RPC: one work-round adjudication (only while the work mode holds). */
  async gameplayWorkTick(): Promise<PetGameplayVerbResult> {
    const def = this.gameplayDef()
    if (def?.work === undefined) return { ok: false, error: 'no-work' }
    const now = Date.now()
    const { petId, state } = this.gameplayState(def, now)
    if (state.mode !== 'work') return { ok: false, error: 'not-working' }
    settleGameplay(state, def, now, { sessionActive: this.machine.render().sessionActive })
    const outcome = rollWorkOutcome(def.work, Math.random)
    const effects = outcome === 'success' ? def.work.success?.effects : def.work.fail?.effects
    if (effects !== undefined) applyGameplayEffects(state, def, effects)
    this.drainGameplayTreats(state)
    this.commitGameplay(petId, state)
    return { ok: true, outcome, view: this.gameplayViewOf(state) }
  }

  /** RPC: buy one shop item (effects, currency swap, or a lottery draw). */
  async gameplayBuy(itemId: string): Promise<PetGameplayVerbResult> {
    const def = this.gameplayDef()
    if (def === undefined) return { ok: false, error: 'no-gameplay' }
    const item = def.shop?.items.find(entry => entry.id === itemId)
    if (item === undefined) return { ok: false, error: 'unknown-item' }
    const now = Date.now()
    const { petId, state } = this.gameplayState(def, now)
    settleGameplay(state, def, now, { sessionActive: this.machine.render().sessionActive })
    // The unified currency is the shared treat ledger (wallet removed): shop
    // prices and prizes ride the same balance the panel shows and feeding
    // consumes, capped by the stock cap.
    const treats = item.currency === GAMEPLAY_TREATS_CURRENCY
    const balance = treats ? this.ledger.snapshot.treats.treats : (state.currencies[item.currency] ?? 0)
    if (balance < item.price) {
      return { ok: false, error: 'insufficient-funds', view: this.gameplayViewOf(state) }
    }
    if (treats) this.ledger.spendTreats(item.price)
    else state.currencies[item.currency] = balance - item.price
    if (item.effects !== undefined) applyGameplayEffects(state, def, item.effects)
    let prize: PetGameplayVerbResult['prize']
    if (item.lottery !== undefined) {
      if (item.lottery.effects !== undefined) applyGameplayEffects(state, def, item.lottery.effects)
      const tier = drawLotteryTier(item.lottery, Math.random)
      const prizeCurrency = tier.currency ?? item.lottery.currency ?? item.currency
      if (prizeCurrency === GAMEPLAY_TREATS_CURRENCY) this.ledger.grantTreats(tier.prize)
      else state.currencies[prizeCurrency] = (state.currencies[prizeCurrency] ?? 0) + tier.prize
      prize = { amount: tier.prize, currency: prizeCurrency }
    }
    this.drainGameplayTreats(state)
    this.commitGameplay(petId, state)
    return { ok: true, ...(prize === undefined ? {} : { prize }), view: this.gameplayViewOf(state) }
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
    this.decorationEnabled = section.decorationEnabled ?? true
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

  private view(currentSessionId?: string): PetStateView {
    const snapshot = this.machine.render()
    const entry = this.activeEntry()
    // One bubble per concurrently active TOP-LEVEL session. The GUI's current
    // session leads the stack when reported (the browser half passes its
    // session list's 'current'); everything else keeps the most recent
    // meaningful event order. Subagent children render no bubble of their own
    // (their activity already shows through the spawning conversation's
    // bubble/display, and the bubble buttons navigate to GUI sessions, which
    // subagents are not). Sessions whose own machine has settled (no bubble
    // copy) drop out, so a finished turn does not leave a stale bubble behind.
    const sessions: PetSessionView[] = []
    for (const [session, activity] of [...this.sessionActivity.entries()].reverse()) {
      if (sessions.length >= MAX_SESSION_BUBBLES) break
      if (session.header?.origin === 'subagent') continue
      const perSession = activity.machine.render()
      if (perSession.bubble === undefined) continue
      // Each session's whisper rides its own bubble while fresh; an expired
      // whisper simply stops appearing (the client's 2 s poll drops it).
      const whisper = activity.whisper
      const freshWhisper = whisper !== undefined && Date.now() - whisper.at < WHISPER_TTL_MS
        ? whisper.text
        : undefined
      sessions.push({
        sessionId: String(session.id),
        animation: perSession.animation,
        bubble: perSession.bubble,
        phase: perSession.phase,
        ...(freshWhisper === undefined ? {} : { whisper: freshWhisper }),
      })
    }
    // The browser half reports the session the user is currently on; that
    // session's bubble leads the stack (its whisper then speaks on the
    // collapsed single bubble). An unreported or absent session keeps the
    // legacy most-recent-first order.
    if (currentSessionId !== undefined) {
      const index = sessions.findIndex(session => session.sessionId === currentSessionId)
      if (index > 0) sessions.unshift(sessions.splice(index, 1)[0]!)
    }
    const decoration = this.activeDecoration()
    // Gameplay view: a read-only projection. The settle runs on a copy, so
    // polling never writes pet.json (verbs settle and persist).
    const gameplayDef = this.gameplayDef()
    let gameplay: PetGameplayStateView | undefined
    if (gameplayDef !== undefined) {
      const { state } = this.gameplayState(gameplayDef, Date.now())
      settleGameplay(state, gameplayDef, Date.now(), { sessionActive: snapshot.sessionActive })
      gameplay = this.gameplayViewOf(state)
    }
    // Read-only: the ledger settles on economic events only, never on a read,
    // so polling the state cannot trigger pet.json writes.
    // An expired announcement simply stops appearing (the client's 2 s poll
    // drops it); no timer owns its removal.
    const announcement = this.announcement !== undefined && announcementFresh(this.announcement, Date.now())
      ? this.announcement
      : undefined
    return {
      animation: snapshot.animation,
      ...(snapshot.bubble === undefined ? {} : { bubble: snapshot.bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
      sessions,
      ...(decoration === undefined ? {} : { decoration }),
      ...(announcement === undefined ? {} : { announcement }),
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
      ...(gameplay === undefined ? {} : { gameplay }),
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
