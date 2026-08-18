/**
 * Pet state machine — pure, clock-injected. Maps official DSH session activity
 * and the legacy `activity/status` vocabulary onto the 9-state Codex pet
 * animation contract, plus turn-end celebration and no-session idle.
 *
 * The machine is deliberately dumb: it holds the last input phase, the
 * animation decision, and a one-shot "celebration" window after `done` so the
 * pet visibly jumps before settling back to idle. Everything here is a pure
 * function of (input, nowMs); persistence and RPC live in the service.
 * @module @linxin666/dsh-pet/state
 */

/** Activity phases understood by the pet host. */
export type ActivityPhase = 'idle' | 'waiting' | 'thinking' | 'tool' | 'review' | 'done' | 'failed'

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
  /** Current activity phase of the active session. */
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
  /** Failure display window before settling to idle, ms (default 2400). */
  failureMs: number
}

export const defaultPetStateConfig: PetStateConfig = { celebrateMs: 2400, failureMs: 2400 }

/**
 * Map one activity phase onto the animation contract.
 * - thinking → `running` and tool → `running-right` (focused work).
 * - review → `review` while answer text is streaming.
 * - waiting → `waiting` (expectant pose, needs user input).
 * - done → `jumping` (celebration), then back to `idle` after the window.
 * - failed → `failed` briefly, then back to `idle`.
 * - idle → `idle` (calm breathing loop).
 */
export function animationForPhase(phase: ActivityPhase): PetAnimation {
  switch (phase) {
    case 'thinking': return 'running'
    case 'tool': return 'running-right'
    case 'review': return 'review'
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
  }
  return rows[animation]
}

/**
 * PetStateMachine — one instance per host process. Holds only the latest
 * input snapshot and terminal-state timing; no storage, no side effects.
 */
export class PetStateMachine {
  private phase: ActivityPhase = 'idle'
  private line: string | undefined
  private phrase: string | undefined
  private sessionActive = false
  private doneAt: number | undefined
  private failedAt: number | undefined
  private readonly config: PetStateConfig

  constructor(
    config: Partial<PetStateConfig> = defaultPetStateConfig,
    private readonly now: () => number = Date.now,
  ) {
    this.config = { ...defaultPetStateConfig, ...config }
  }

  /** Consume one projected activity update. */
  onActivityStatus(input: PetStateInput): void {
    this.phase = input.phase
    this.line = input.line
    this.phrase = input.phrase
    this.doneAt = input.phase === 'done' ? this.now() : undefined
    this.failedAt = input.phase === 'failed' ? this.now() : undefined
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
    this.failedAt = undefined
  }

  /** Render the current animation decision. */
  render(): PetStateSnapshot {
    const nowMs = this.now()
    let animation = animationForPhase(this.phase)
    const doneSettled = this.phase === 'done'
      && this.doneAt !== undefined
      && nowMs - this.doneAt >= this.config.celebrateMs
    const failedSettled = this.phase === 'failed'
      && this.failedAt !== undefined
      && nowMs - this.failedAt >= this.config.failureMs
    if (doneSettled || failedSettled) animation = 'idle'
    // Settled sessions never bubble: idle (e.g. an aborted/stopped turn),
    // completed celebration expiry, and failed display expiry all fall silent.
    const settled = this.phase === 'idle' || doneSettled || failedSettled
    const bubble = settled ? undefined : this.phrase ?? this.line
    return {
      animation,
      ...(bubble === undefined ? {} : { bubble }),
      animationStartedAt: nowMs,
      phase: this.phase,
      sessionActive: this.sessionActive,
    }
  }
}
