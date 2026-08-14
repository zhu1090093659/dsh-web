/**
 * Pet host service — the `pet.*` RPC domain. Owns the state machine wiring
 * (projects official session events and accepts legacy `activity/status`), the
 * affinity ledger, and the persisted display config. The API gateway maps
 * this service's methods onto `pet.state` / `pet.interact` /
 * `pet.setVisible` / `pet.setConfig` for browser consumers.
 * @module @linxin666/dsh-pet/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  applyInteraction,
  applyTurnReward,
  defaultAffinityConfig,
  rankOf,
  type AffinityConfig,
  type AffinityState,
  type PetInteraction,
} from './affinity.ts'
import {
  loadPetPersist,
  petHomeDir,
  savePetPersist,
  DISPLAY_SIZE_MAX,
  DISPLAY_SIZE_MIN,
  DISPLAY_INSET_MAX,
  PET_NAME_MAX_LENGTH,
  type PetDisplayConfig,
  type PetPersist,
} from './persist.ts'
import {
  defaultTreatConfig,
  settleTreatGrants,
  consumeTreat,
  type TreatConfig,
} from './treats.ts'
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
}

/**
 * The pet's settings-namespace section: the display fields and name the web
 * settings surface edits. `right`/`bottom` are also updated by drag
 * interactions, which keep the settings document in sync through the service.
 */
export interface PetSettingsSection {
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
  /** User-customizable pet display name. */
  name: string
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
  affinity: {
    points: number
    rank: string
    rankEmoji: string
    pets: number
    feeds: number
    turns: number
    /** True while the pet interaction is inside its cooldown. */
    petCooldown: boolean
    /** True while the feed is inside its cooldown. */
    feedCooldown: boolean
  }
  /** Display configuration. */
  display: PetDisplayConfig
  /** User-customizable pet display name. */
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
export interface PetInteractResult {
  /** Reaction copy bubble. */
  reaction: string
  /** Points gained (0 when inside the cooldown). */
  delta: number
  /** Full affinity snapshot (same shape as state view). */
  affinity: PetStateView['affinity']
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pet: PetService
  }
}

/** Runtime shape of the optional legacy activity event. */
interface ActivityStatusEventLike {
  phase?: string
  line?: string
  phrase?: string
}

/** Per-session facts needed to project the official event stream. */
interface SessionActivityRuntime {
  activeTools: Set<string>
  officialEventsSeen: boolean
  stepHadFailure: boolean
}

/** One official event projection, optionally carrying a completed turn reward. */
interface PetActivityTransition {
  input: PetStateInput
  completedTurn?: number
}

/** Keep tool names readable inside the compact status bubble. */
function displayToolName(name: string): string {
  const compact = name.replace(/\s+/g, ' ').trim() || '工具'
  return compact.length <= 24 ? compact : `${compact.slice(0, 21)}...`
}

/** Whether a legacy phase is part of the pet's supported vocabulary. */
function isActivityPhase(phase: string): phase is PetStateInput['phase'] {
  return ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'].includes(phase)
}

/**
 * Project the durable DSH session vocabulary into the pet's visual phases.
 * Unknown and log-only events do not disturb the last meaningful activity.
 */
function projectOfficialEvent(
  event: SessionEvent,
  runtime: SessionActivityRuntime,
): PetActivityTransition | undefined {
  switch (event.type) {
    case 'turn/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: '准备开始' } }
    case 'step/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: '等待模型响应' } }
    case 'assistant/chunk': {
      const { chunk } = event.data
      if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
        return { input: { phase: 'thinking', line: '正在思考' } }
      }
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        return { input: { phase: 'review', line: '整理回复中' } }
      }
      return undefined
    }
    case 'assistant/message':
      return { input: { phase: 'review', line: '整理回复中' } }
    case 'tool/call':
      runtime.activeTools.add(String(event.data.callId))
      return {
        input: {
          phase: 'tool',
          line: `正在使用 ${displayToolName(event.data.name)}`,
        },
      }
    case 'tool/result': {
      const block = event.data.message.content[0]
      runtime.activeTools.delete(String(event.data.message.source.callId))
      runtime.stepHadFailure ||= event.data.error !== undefined || block.isError === true
      if (runtime.activeTools.size > 0) {
        return {
          input: {
            phase: 'tool',
            line: `还有 ${runtime.activeTools.size} 个工具运行中`,
          },
        }
      }
      return runtime.stepHadFailure
        ? { input: { phase: 'failed', line: '工具执行失败' } }
        : { input: { phase: 'thinking', line: '处理工具结果' } }
    }
    case 'turn/end': {
      runtime.activeTools.clear()
      switch (event.data.reason.kind) {
        case 'completed':
          return {
            input: { phase: 'done', line: '完成啦' },
            completedTurn: event.data.turn,
          }
        case 'error':
          return { input: { phase: 'failed', line: '执行失败' } }
        case 'max-tokens':
          return { input: { phase: 'failed', line: '达到输出上限' } }
        case 'interrupted':
          return { input: { phase: 'failed', line: '执行意外中断' } }
        case 'blocked':
          return { input: { phase: 'waiting', line: '等待继续' } }
        case 'aborted':
          return { input: { phase: 'idle', line: '已停止' } }
        default:
          // TurnEndReasonMap is merge-extensible; a newer ending must not
          // leave the pet showing stale in-progress work.
          return { input: { phase: 'idle' } }
      }
    }
    default:
      return undefined
  }
}

/**
 * Cordis service exposing the pet RPC domain. Lazy: nothing is scanned or
 * written until a query or interaction arrives; event listeners update only
 * in-memory state, and persistence happens on interaction/config changes
 * plus every completed turn.
 */
export class PetService extends Service {
  static inject: string[] = []

  private readonly machine: PetStateMachine
  private readonly affinityConfig: AffinityConfig
  private readonly treatConfig: TreatConfig
  private readonly persistDir: string
  private persist: PetPersist
  /** Completed turns already rewarded, per session (turn numbers are per-session). */
  private rewardedTurns = new Map<string, number>()
  private enabled: boolean
  private disposeActivity: (() => void) | undefined
  /** Session whose most recent meaningful event currently drives the global pet. */
  private displaySession: Session | undefined
  private readonly sessionActivity = new WeakMap<Session, SessionActivityRuntime>()
  private lastLegacyTurnRewardAt = 0

  constructor(ctx: Context, config: PetConfig = {}) {
    super(ctx, 'pet')
    this.persistDir = config.persistDir ?? petHomeDir()
    this.affinityConfig = { ...defaultAffinityConfig, ...(config.affinity ?? {}) }
    this.treatConfig = { ...defaultTreatConfig, ...(config.treats ?? {}) }
    this.machine = new PetStateMachine({
      ...defaultPetStateConfig,
      ...(config.state ?? {}),
    })
    this.persist = loadPetPersist(this.persistDir)
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
    return { ...this.persist.display }
  }

  /** Current persisted pet name (read-only view). */
  petName(): string {
    return this.persist.name
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
  private activityRuntime(session: Session): SessionActivityRuntime {
    let runtime = this.sessionActivity.get(session)
    if (runtime === undefined) {
      runtime = {
        activeTools: new Set(),
        officialEventsSeen: false,
        stepHadFailure: false,
      }
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
    // Feeding consumes a treat: settle the economy first (work + time
    // output since the last settlement), then gate on the feed cooldown
    // BEFORE spending stock — a feed inside the cooldown must not burn a
    // treat for nothing.
    if (kind === 'feed') this.settleTreats(nowMs)
    const outcome = applyInteraction(this.persist.affinity, kind, nowMs, this.affinityConfig)
    if (kind === 'feed' && !outcome.accepted) {
      return { reaction: outcome.reaction, delta: 0, affinity: this.affinityView(this.persist.affinity) }
    }
    if (kind === 'feed') {
      const consume = consumeTreat(this.persist.treats)
      if (!consume.ok) {
        const affinity = this.affinityView(this.persist.affinity)
        return {
          reaction: '没有小鱼干了，多陪鲸鱼娘工作一会儿吧～',
          delta: 0,
          affinity,
        }
      }
      this.persist = { ...this.persist, treats: consume.ledger }
    }
    if (outcome.accepted) {
      this.persist = { ...this.persist, affinity: outcome.affinity }
      this.flush()
    }
    const affinity = this.affinityView(outcome.affinity)
    return { reaction: outcome.reaction, delta: outcome.delta, affinity }
  }

  /** RPC: show or hide the pet. */
  async setVisible(visible: boolean): Promise<{ ok: true; display: PetDisplayConfig }> {
    this.persist = { ...this.persist, display: { ...this.persist.display, visible } }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.persist.display }
  }

  /** RPC: update display config (size / position). Values are clamped to whole pixels. */
  async setConfig(patch: Partial<PetDisplayConfig>): Promise<{ ok: true; display: PetDisplayConfig }> {
    const next = { ...this.persist.display, ...patch }
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, next.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, next.bottom)))
    this.persist = { ...this.persist, display: next }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, display: this.persist.display }
  }

  /** RPC: rename the pet (trimmed, 1–20 chars). */
  async setName(name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'name-empty' }
    if (trimmed.length > PET_NAME_MAX_LENGTH) return { ok: false, error: 'name-too-long' }
    this.persist = { ...this.persist, name: trimmed }
    this.flush()
    this.syncSettingsFromPet()
    return { ok: true, name: trimmed }
  }

  /**
   * Apply a committed settings section to the persisted display config. Called
   * by the settings surface on every change; values are clamped exactly like
   * the setConfig RPC so both write paths converge.
   * @param section - the resolved settings section.
   */
  applySettingsSection(section: PetSettingsSection): void {
    const next = { ...this.persist.display }
    next.visible = section.visible && (section.enabled ?? true)
    next.size = Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, section.size)))
    next.right = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.right)))
    next.bottom = Math.round(Math.min(DISPLAY_INSET_MAX, Math.max(0, section.bottom)))
    this.persist = { ...this.persist, display: next, name: section.name.trim() }
    this.flush()
  }

  /** Mirror the persisted display config into the settings document (best-effort). */
  private syncSettingsFromPet(): void {
    const settings = this.ctx.get('settings', false) as { update(ns: string, patch: object): Promise<void> } | undefined
    if (settings === undefined) return
    void settings.update(PET_SETTINGS_NAMESPACE, {
      visible: this.persist.display.visible,
      size: this.persist.display.size,
      right: this.persist.display.right,
      bottom: this.persist.display.bottom,
      name: this.persist.name,
    }).catch(() => {
      // A settings write failure must not break the pet's own persistence.
    })
  }

  /** Award the turn reward once per completed turn (idempotent per session + turn). */
  private rewardTurn(sessionId: string, turn: number): void {
    const last = this.rewardedTurns.get(sessionId) ?? 0
    if (turn <= last) return
    this.rewardedTurns.set(sessionId, turn)
    this.applyTurnReward()
  }

  /** Preserve turn rewards for installations that only emit legacy activity. */
  private rewardLegacyTurn(): void {
    const nowMs = Date.now()
    // A legacy `done` snapshot may repeat during the celebration window.
    if (nowMs - this.lastLegacyTurnRewardAt < 5_000) return
    this.lastLegacyTurnRewardAt = nowMs
    this.applyTurnReward()
  }

  /** Persist one accepted completed-turn reward. */
  private applyTurnReward(): void {
    this.persist = { ...this.persist, affinity: applyTurnReward(this.persist.affinity, this.affinityConfig) }
    this.flush()
  }

  /**
   * Settle the treat economy (work + time output since the last settlement)
   * and persist whenever the ledger changed. A zero-gain first settlement
   * still starts the time clock (anchor write), which is what lets the
   * 30-minute time output ever accrue.
   */
  private settleTreats(nowMs: number): void {
    const settlement = settleTreatGrants(
      this.persist.treats,
      this.persist.affinity.turns,
      nowMs,
      this.treatConfig,
    )
    if (settlement.ledger !== this.persist.treats) {
      this.persist = { ...this.persist, treats: settlement.ledger }
      this.flush()
    }
  }

  private view(): PetStateView {
    const snapshot = this.machine.render()
    // Time-output treats accrue while the host is idle too; settle on read.
    this.settleTreats(Date.now())
    return {
      animation: snapshot.animation,
      ...(snapshot.bubble === undefined ? {} : { bubble: snapshot.bubble }),
      phase: snapshot.phase,
      sessionActive: snapshot.sessionActive,
      affinity: this.affinityView(this.persist.affinity),
      display: { ...this.persist.display },
      name: this.persist.name,
      treats: {
        stocked: this.persist.treats.treats,
        max: this.treatConfig.maxTreats,
      },
    }
  }

  private affinityView(affinity: AffinityState): PetStateView['affinity'] {
    const nowMs = Date.now()
    const rank = rankOf(affinity.points)
    return {
      points: affinity.points,
      rank: rank.name,
      rankEmoji: rank.emoji,
      pets: affinity.pets,
      feeds: affinity.feeds,
      turns: affinity.turns,
      petCooldown: nowMs - affinity.lastPetAt < this.affinityConfig.petCooldownMs,
      feedCooldown: nowMs - affinity.lastFeedAt < this.affinityConfig.feedCooldownMs,
    }
  }

  private flush(): void {
    try {
      savePetPersist(this.persist, this.persistDir)
    } catch {
      // Persistence is best-effort; the in-memory ledger keeps working.
    }
  }
}
