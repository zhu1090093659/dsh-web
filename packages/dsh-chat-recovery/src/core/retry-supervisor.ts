/**
 * Retry supervisor: a framework-free state machine that re-runs a failed
 * turn by forking a child session from the history prefix BEFORE the failed
 * turn and prompting the original user text once per attempt.
 *
 * Why fork-per-attempt: the host has no in-place "retry turn" RPC. Re-prompting
 * the same session would append a duplicate user message on every attempt, and
 * the failed turn's stream fragments would stay in the next request's history.
 * Forking from the prefix before the failed turn guarantees that (a) no session
 * ever accumulates a duplicate user message, (b) failed fragments never enter
 * the next model request, and (c) the original session stays untouched.
 *
 * The supervisor only watches the CURRENT session; the client wiring feeds it
 * through review() on every session/list change and cancels on navigation,
 * user input, or the UI cancel button.
 */
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantFinalizedInTurn, lastTurnOf, userNodeCount, userNodeCountBefore } from './transcript.ts'
import {
  BACKOFF_DELAYS_MS,
  isRetryableError,
  MAX_EXTRA_RETRIES,
  planForTurn,
  type RetryPlan,
  verdictFor,
} from './retry-policy.ts'

export type SupervisorPhase =
  | 'idle'
  | 'waiting'
  | 'running'
  | 'cancelled'
  | 'exhausted'
  | 'failed'
  | 'done'

export interface RetryState {
  phase: SupervisorPhase
  /** auto = supervisor-driven, manual = user pressed the transcript button. */
  kind: 'auto' | 'manual' | null
  /** 1-based number of the attempt that is waiting or running right now. */
  attempt: number
  maxAttempts: number
  /** Backoff delay of the current wait, in ms (0 for manual retries). */
  delayMs: number | null
  /** The session the failed turn lives in. */
  sourceId: SessionId | null
  /** The child currently re-running the turn (null while waiting). */
  targetId: SessionId | null
  /** Final failure reason (failed/exhausted states). */
  reason: string | null
}

export interface PromptOutcome {
  ok: boolean
  code?: string
  message?: string
}

/** Everything the supervisor needs from the runtime; the client wiring fills it. */
export interface RetryPorts {
  currentId(): SessionId | undefined
  snapshot(id: SessionId): ConversationSnapshot | undefined
  cwdOf(id: SessionId): string | undefined
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId>
  /** Connect (or create) a blank session in the same workspace as the source. */
  connectBlank(cwd: string | undefined): Promise<SessionId>
  open(id: SessionId): void
  prompt(id: SessionId, text: string): Promise<PromptOutcome>
  schedule(fn: () => void, ms: number): () => void
}

const IDLE: RetryState = {
  phase: 'idle',
  kind: null,
  attempt: 0,
  maxAttempts: MAX_EXTRA_RETRIES,
  delayMs: null,
  sourceId: null,
  targetId: null,
  reason: null,
}

export class RetrySupervisor {
  private state: RetryState = { ...IDLE }
  private readonly listeners = new Set<() => void>()
  private timer: (() => void) | null = null
  private plan: RetryPlan | null = null
  /** User messages counted on the source when the cycle started (takeover guard). */
  private userBaseline = 0
  /** User messages the retry child is EXPECTED to carry (prefix + the replayed one). */
  private expectedUserCount = 0
  /** Last turn/end seq seen when the cycle reached a terminal phase (reset guard). */
  private settledEndSeq = 0

  constructor(private readonly ports: RetryPorts) {}

  getSnapshot = (): RetryState => this.state

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /**
   * The client wiring calls this on every sessions.list or session-snapshot
   * change. Idle: arm auto-retry when the current session's last turn failed
   * recoverably. Waiting: cancel when the user navigated away or took over.
   * Running: settle the child — success, next attempt, or final failure.
   */
  review(): void {
    const current = this.ports.currentId()
    switch (this.state.phase) {
      case 'idle': {
        if (current === undefined) return
        const snapshot = this.ports.snapshot(current)
        if (snapshot === undefined) return
        const verdict = verdictFor(snapshot)
        if (verdict.action === 'auto') this.startAuto(current, verdict.plan)
        return
      }
      case 'waiting': {
        const source = this.state.sourceId
        if (source === null || current !== source) {
          this.cancel()
          return
        }
        const snapshot = this.ports.snapshot(source)
        if (snapshot !== undefined && (snapshot.running || userNodeCount(snapshot) > this.userBaseline)) {
          this.cancel()
        }
        return
      }
      case 'running': {
        const target = this.state.targetId
        if (target === null || current !== target) {
          this.cancel()
          return
        }
        const snapshot = this.ports.snapshot(target)
        if (snapshot === undefined || snapshot.running) return
        // The user sent their own message into the retry child (beyond the
        // history prefix plus the replayed message): stand down.
        if (userNodeCount(snapshot) > this.expectedUserCount) {
          this.cancel()
          return
        }
        const verdict = verdictFor(snapshot)
        if (verdict.action === 'none') {
          const turn = lastTurnOf(snapshot)
          if (turn !== null && assistantFinalizedInTurn(snapshot, turn)) {
            this.settledEndSeq = snapshot.turnEnds.get(turn) ?? this.settledEndSeq
            this.finish('done')
          }
          return
        }
        if (verdict.action === 'auto') {
          if (this.state.attempt >= this.state.maxAttempts) {
            this.settledEndSeq = verdict.failure.turnEndSeq
            this.finish('exhausted', verdict.failure.message ?? '')
          } else {
            this.scheduleNext()
          }
          return
        }
        // The user pressed Stop inside the retry child (interrupted without a
        // host crash): that is a cancel, not a retryable failure.
        if (verdict.failure.kind === 'interrupted' && verdict.failure.message === null) {
          this.cancel()
          return
        }
        this.settledEndSeq = verdict.failure.turnEndSeq
        this.finish('failed', verdict.failure.message ?? '')
        return
      }
      case 'cancelled':
      case 'exhausted':
      case 'failed':
      case 'done': {
        // Reset to idle once the session moved on to a new turn, so the next
        // failure can arm a fresh cycle.
        if (current === undefined) return
        const snapshot = this.ports.snapshot(current)
        if (snapshot === undefined) return
        if (snapshot.running) {
          this.reset()
          return
        }
        let latestEnd = 0
        for (const end of snapshot.turnEnds.values()) if (end > latestEnd) latestEnd = end
        if (latestEnd > this.settledEndSeq) this.reset()
        return
      }
    }
  }

  /** Manual one-shot retry from the transcript button (never auto-repeats). */
  manualRetry(sourceId: SessionId): void {
    if (this.state.phase === 'waiting' || this.state.phase === 'running') return
    const snapshot = this.ports.snapshot(sourceId)
    if (snapshot === undefined) return
    const verdict = verdictFor(snapshot)
    if (verdict.action === 'none') return
    const plan = verdict.action === 'auto' ? verdict.plan : planForTurn(snapshot, verdict.failure.turn)
    if (plan === null) return
    this.plan = plan
    this.userBaseline = userNodeCount(snapshot)
    this.publish({ phase: 'waiting', kind: 'manual', attempt: 0, maxAttempts: 1, delayMs: 0, sourceId, targetId: null, reason: null })
    void this.runAttempt()
  }

  /** User-initiated cancel: no further attempts, ever (until a new failure arms one). */
  cancel(): void {
    this.clearTimer()
    if (this.state.phase === 'idle' || this.state.phase === 'cancelled') return
    this.publish({ phase: 'cancelled', delayMs: null, reason: null })
  }

  /** UI "retry now": skip the remaining backoff wait. */
  retryNow(): void {
    if (this.state.phase !== 'waiting') return
    this.clearTimer()
    void this.runAttempt()
  }

  dispose(): void {
    this.clearTimer()
    this.listeners.clear()
  }

  private startAuto(sourceId: SessionId, plan: RetryPlan): void {
    const snapshot = this.ports.snapshot(sourceId)
    this.plan = plan
    this.userBaseline = snapshot === undefined ? 0 : userNodeCount(snapshot)
    this.publish({
      phase: 'waiting',
      kind: 'auto',
      attempt: 0,
      maxAttempts: MAX_EXTRA_RETRIES,
      delayMs: BACKOFF_DELAYS_MS[0],
      sourceId,
      targetId: null,
      reason: null,
    })
    this.scheduleNext()
  }

  private scheduleNext(): void {
    this.clearTimer()
    const attempt = this.state.attempt + 1
    const delay = this.state.kind === 'manual'
      ? 0
      : BACKOFF_DELAYS_MS[Math.min(attempt - 1, BACKOFF_DELAYS_MS.length - 1)]
    this.publish({ phase: 'waiting', attempt, delayMs: delay })
    this.timer = this.ports.schedule(() => {
      this.timer = null
      void this.runAttempt()
    }, delay)
  }

  private async runAttempt(): Promise<void> {
    if (this.state.phase !== 'waiting') return
    const sourceId = this.state.sourceId
    const plan = this.plan
    if (sourceId === null || plan === null) {
      this.reset()
      return
    }
    let targetId: SessionId
    try {
      targetId = plan.forkAtSeq === null
        ? await this.ports.connectBlank(this.ports.cwdOf(sourceId))
        : await this.ports.fork({ sessionId: sourceId, atSeq: plan.forkAtSeq, increaseTitle: false })
    } catch (error) {
      this.finish('failed', messageOf(error))
      return
    }
    // Cancel raced a slow fork: do not open or prompt a cancelled cycle.
    if (this.state.phase !== 'waiting') return
    // The child carries the source's history prefix (user messages at or
    // before the fork anchor) plus exactly one replayed message. Takeover
    // detection compares against this expected count, never an absolute one.
    const sourceSnapshot = this.ports.snapshot(sourceId)
    this.expectedUserCount = plan.forkAtSeq === null
      ? 1
      : (sourceSnapshot === undefined ? 0 : userNodeCountBefore(sourceSnapshot, plan.forkAtSeq)) + 1
    this.ports.open(targetId)
    this.publish({ phase: 'running', targetId })
    const outcome = await this.ports.prompt(targetId, plan.text)
    if (!outcome.ok) {
      const reason = `${outcome.code ?? 'error'}: ${outcome.message ?? ''}`
      if (this.state.kind === 'auto' && isRetryableError(outcome.code, outcome.message) && this.state.attempt < this.state.maxAttempts) {
        this.scheduleNext()
      } else {
        this.finish(this.state.attempt >= this.state.maxAttempts ? 'exhausted' : 'failed', reason)
      }
      return
    }
    // The client wiring now watches the child (it became current) and settles
    // the attempt through review().
  }

  private finish(phase: 'done' | 'exhausted' | 'failed', reason: string | null = null): void {
    this.clearTimer()
    this.publish({ phase, delayMs: null, targetId: null, ...(reason === null ? {} : { reason }) })
    if (phase !== 'done' && this.state.sourceId !== null) {
      // Return the user to the original failed turn instead of leaving them
      // on a dead intermediate child.
      this.ports.open(this.state.sourceId)
    }
  }

  private reset(): void {
    this.clearTimer()
    this.plan = null
    this.settledEndSeq = 0
    this.publish({ ...IDLE })
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timer()
      this.timer = null
    }
  }

  private publish(patch: Partial<RetryState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
