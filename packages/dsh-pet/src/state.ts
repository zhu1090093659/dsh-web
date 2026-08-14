/**
 * Pet state machine — pure, clock-injected. Maps the DSH `activity/status`
 * phase vocabulary (session events) onto the 9-state Codex pet
 * animation contract, plus the session lifecycle transitions the web UI
 * exposes (turn end celebration, no-session idle).
 *
 * The machine is deliberately dumb: it holds the last input phase, the
 * animation decision, and a one-shot "celebration" window after `done` so the
 * pet visibly jumps before settling back to idle. Everything here is a pure
 * function of (input, nowMs); persistence and RPC live in the service.
 * @module @linxin666/dsh-pet/state
 */

/** The DSH `activity/status` phase vocabulary (wire contract of session events). */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'done'

/** The Codex-compatible 9-state animation contract (spritesheet rows). */
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

/** One input snapshot consumed by the machine. */
export interface PetStateInput {
  /** Current activity/status phase of the active session. */
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
  /** True when there is an active session (pet mounted). */
  sessionActive: boolean
}

/** Machine configuration. */
export interface PetStateConfig {
  /** Celebration window after `done` before settling to idle, ms (default 2400). */
  celebrateMs: number
}

export const defaultPetStateConfig: PetStateConfig = { celebrateMs: 2400 }

/**
 * Map one activity phase onto the animation contract.
 * - thinking / tool → `running` (focused work), with `running-right` as the
 *   side-alternating variant the client may use for tool activity.
 * - waiting → `waiting` (expectant pose, needs user input).
 * - done → `jumping` (celebration), then back to `idle` after the window.
 * - idle → `idle` (calm breathing loop).
 * `failed` has no DSH phase source yet; the machine keeps the mapping table
 * so a future error event can light it up.
 */
export function animationForPhase(phase: ActivityPhase): PetAnimation {
  switch (phase) {
    case 'thinking': return 'running'
    case 'tool': return 'running-right'
    case 'waiting': return 'waiting'
    case 'done': return 'jumping'
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
  }
  return rows[animation]
}

/**
 * PetStateMachine — one instance per host process. Holds only the latest
 * input snapshot and the celebration timing; no storage, no side effects.
 */
export class PetStateMachine {
  private phase: ActivityPhase = 'idle'
  private line: string | undefined
  private phrase: string | undefined
  private sessionActive = false
  private doneAt: number | undefined

  constructor(
    private readonly config: PetStateConfig = defaultPetStateConfig,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consume one `activity/status` session event. */
  onActivityStatus(input: PetStateInput): void {
    this.phase = input.phase
    this.line = input.line
    this.phrase = input.phrase
    if (input.phase === 'done') this.doneAt = this.now()
  }

  /** A session became the active one (or a fresh session started). */
  onSessionActive(): void {
    this.sessionActive = true
  }

  /** The active session was disposed (or none left). */
  onSessionDisposed(): void {
    this.sessionActive = false
    this.phase = 'idle'
    this.line = undefined
    this.phrase = undefined
    this.doneAt = undefined
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
    const bubble = this.phrase ?? this.line
    return {
      animation,
      ...(bubble === undefined ? {} : { bubble }),
      animationStartedAt: nowMs,
      phase: this.phase,
      sessionActive: this.sessionActive,
    }
  }
}
