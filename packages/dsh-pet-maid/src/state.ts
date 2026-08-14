/**
 * Maid-pet state machine — pure, clock-injected. Maps the pet's working-phase
 * vocabulary (derived by the service from core session events) onto the
 * 9-row Codex pet animation contract plus the Clawd-style poses the maid
 * theme adds (thinking / sleeping / attention), tracks the concurrent session
 * count that drives the 4-level working tier, and handles the session
 * lifecycle transitions the web UI exposes (turn end celebration, no-session
 * idle).
 *
 * The machine is deliberately dumb: it holds the last input phase, the
 * animation decision, the active-session count, and a one-shot "celebration"
 * window after `done` so the pet visibly jumps before settling back to idle.
 * Everything here is a pure function of (input, nowMs); persistence and RPC
 * live in the service.
 * @module @linxin666/dsh-pet-maid/state
 */

/** The pet's working-phase vocabulary (derived from core session events by the service). */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'done' | 'failed'

/** The Codex-compatible 9-row animation contract plus the Clawd-style poses.
 *  `thinking` / `sleeping` / `attention` alias existing atlas rows (review /
 *  idle / jumping) and are distinguished for presentation: thinking renders
 *  the calm review pose, sleeping holds a static frame, attention loops the
 *  jumping track. */
export type PetAnimation =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'
  | 'thinking'
  | 'sleeping'
  | 'attention'

/** One input snapshot consumed by the machine. */
export interface PetStateInput {
  /** Current working phase of the active session. */
  phase: ActivityPhase
  /** Human-readable status line (plain text). */
  line?: string
  /** Playful phrase from the activity tracker, when any. */
  phrase?: string
}

/** Animation decision plus the copy the pet should show. */
export interface PetStateSnapshot {
  /** Which animation track to play. */
  animation: PetAnimation
  /** Optional status bubble copy (line or phrase), shown while active. */
  bubble?: string
  /** Wall-clock ms this animation started (client can sync loops). */
  animationStartedAt: number
  /** Raw phase, for debugging and client-side rendering decisions. */
  phase: ActivityPhase
  /** True when there is at least one live session (pet mounted). */
  sessionActive: boolean
  /** Concurrent live sessions driving the working tier. */
  activeSessions: number
  /** Working tier 1-4 while working (0 outside working phases). */
  workingTier: number
}

/** Machine configuration. */
export interface PetStateConfig {
  /** Celebration window after `done` before settling to idle, ms (default 2400). */
  celebrateMs: number
}

export const defaultPetStateConfig: PetStateConfig = { celebrateMs: 2400 }

/** Working tier cap (Clawd-style: 1..4 by concurrent sessions). */
export const WORKING_TIER_MAX = 4

/**
 * Map one activity phase onto the animation contract.
 * - thinking → `thinking` (calm review pose).
 * - tool → `running` (focused work), with `running-right` as the
 *   side-alternating variant the client may use for tool activity.
 * - waiting → `waiting` (expectant pose, needs user input).
 * - done → `jumping` (celebration), then back to `idle` after the window.
 * - failed → `failed` (error pose).
 * - idle → `idle` (calm breathing loop).
 */
export function animationForPhase(phase: ActivityPhase): PetAnimation {
  switch (phase) {
    case 'thinking': return 'thinking'
    case 'tool': return 'running'
    case 'waiting': return 'waiting'
    case 'done': return 'jumping'
    case 'failed': return 'failed'
    case 'idle': return 'idle'
  }
}

/** The spritesheet row index for one animation track. */
export function rowOf(animation: PetAnimation): number {
  const rows: Record<PetAnimation, number> = {
    'idle': 0,
    'running-right': 1,
    'running-left': 2,
    'waving': 3,
    'jumping': 4,
    'failed': 5,
    'waiting': 6,
    'running': 7,
    'review': 8,
    // Clawd-style poses alias existing atlas rows.
    'thinking': 8,
    'sleeping': 0,
    'attention': 4,
  }
  return rows[animation]
}

/** Working tier for a live-session count, capped at WORKING_TIER_MAX. */
export function workingTierOf(activeSessions: number): number {
  return Math.max(1, Math.min(WORKING_TIER_MAX, activeSessions))
}

/**
 * PetStateMachine — one instance per host process. Holds only the latest
 * input snapshot, the active-session count, and the celebration timing; no
 * storage, no side effects.
 */
export class PetStateMachine {
  private phase: ActivityPhase = 'idle'
  private line: string | undefined
  private phrase: string | undefined
  private sessionActive = false
  private activeSessions = 0
  private doneAt: number | undefined

  constructor(
    private readonly config: PetStateConfig = defaultPetStateConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consume one phase snapshot (fed by the service from session events). */
  onActivityStatus(input: PetStateInput): void {
    this.phase = input.phase
    this.line = input.line
    this.phrase = input.phrase
    if (input.phase === 'done') this.doneAt = this.now()
  }

  /** A session was created (starts counting concurrent sessions). */
  onSessionCreated(): void {
    this.sessionActive = true
    this.activeSessions += 1
  }

  /** A session was disposed (stops counting; the last one idles the pet). */
  onSessionDisposed(): void {
    this.activeSessions = Math.max(0, this.activeSessions - 1)
    if (this.activeSessions === 0) {
      this.sessionActive = false
      this.phase = 'idle'
      this.line = undefined
      this.phrase = undefined
      this.doneAt = undefined
    }
  }

  /** The active session turned (used when no session/created was observed). */
  onSessionActive(): void {
    this.sessionActive = true
  }

  /** Render the current animation decision. */
  render(): PetStateSnapshot {
    const nowMs = this.now()
    let animation = animationForPhase(this.phase)
    // Celebration window: after `done`, jump for celebrateMs then settle idle.
    if (this.phase === 'done' && this.doneAt !== undefined) {
      if (nowMs - this.doneAt < this.config.celebrateMs) {
        animation = 'jumping'
      } else {
        animation = 'idle'
      }
    }
    const working = this.phase === 'tool' || this.phase === 'thinking'
    const tier = working ? workingTierOf(this.activeSessions) : 0
    const bubble = this.phrase ?? this.line
    return {
      animation,
      ...(bubble === undefined ? {} : { bubble }),
      animationStartedAt: nowMs,
      phase: this.phase,
      sessionActive: this.sessionActive,
      activeSessions: this.activeSessions,
      workingTier: tier,
    }
  }
}
