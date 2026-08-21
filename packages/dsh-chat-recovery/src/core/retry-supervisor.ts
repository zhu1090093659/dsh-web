/**
 * Retry supervisor: a framework-free state machine that re-runs a failed
 * turn by forking one child session from the history prefix BEFORE the
 * failed turn and replaying the original user text there.
 *
 * Why fork: the host has no in-place "retry turn" RPC, so re-prompting the
 * source session would append a duplicate user message and the failed
 * turn's stream fragments would stay in the next request's history. Forking
 * from the prefix before the failed turn guarantees the original session
 * stays untouched.
 *
 * One child per cycle (issues #797, #880): the first attempt forks the
 * child; every later attempt of the same cycle — and any retry re-armed
 * inside that child — continues IN the child instead of forking another
 * session, so one failed turn never spawns more than one extra session.
 * The child therefore accumulates one replayed message per attempt, which
 * is the retry history the user sees; the source stays pristine.
 *
 * The supervisor only watches the CURRENT session; the client wiring feeds it
 * through review() on every session/list change and cancels on navigation,
 * user input, or the UI cancel button.
 */
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantFinalizedInTurn, lastTurnOf, userNodeCount, userNodeCountBefore } from './transcript.ts'
import {
  BACKOFF_DELAYS_MS,
  failureOfLastTurn,
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

export interface RetrySupervisorOptions {
  /** Fork-per-attempt automation is opt-in because every attempt creates a visible session. */
  autoRetry?: boolean
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
  /** Last failure explicitly handled per session; the same turn must never auto-arm twice. */
  private readonly suppressedFailureEnds = new Map<SessionId, number>()
  /** Monotonic owner for an in-flight fork/prompt continuation. */
  private operationGeneration = 0
  private attemptInFlight = false
  private disposed = false
  /** Last completed event inherited by the current retry child before its replayed turn. */
  private attemptStartEndSeq = 0
  /**
   * The retry child created by the current (or most recent) cycle. Later
   * attempts of the same cycle, and retries re-armed inside that child,
   * continue in this session instead of forking another one.
   */
  private cycleTargetId: SessionId | null = null

  constructor(
    private readonly ports: RetryPorts,
    private readonly options: RetrySupervisorOptions = {},
  ) {}

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
    if (this.disposed) return
    const current = this.ports.currentId()
    switch (this.state.phase) {
      case 'idle': {
        if (current === undefined) return
        const snapshot = this.ports.snapshot(current)
        if (snapshot === undefined) return
        const verdict = verdictFor(snapshot)
        if (verdict.action === 'auto' && this.options.autoRetry === true) {
          const suppressedEnd = this.suppressedFailureEnds.get(current) ?? -1
          if (verdict.failure.turnEndSeq <= suppressedEnd) return
          this.suppressedFailureEnds.delete(current)
          this.startAuto(current, verdict.plan)
        }
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
      case 'cancelled': {
        if (current === undefined) return
        const snapshot = this.ports.snapshot(current)
        if (snapshot === undefined) return
        const target = this.state.targetId
        if (target !== null && current === target) {
          // Cancelling the supervisor cannot abort a prompt already accepted by
          // the host. Keep this target quarantined until that replayed turn has
          // settled, then suppress its failure before returning to idle.
          if (snapshot.running || latestTurnEnd(snapshot) <= this.attemptStartEndSeq) return
          this.suppressFailure(snapshot)
        }
        this.reset()
        return
      }
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
    if (this.disposed) return
    if (this.state.phase === 'waiting' || this.state.phase === 'running') return
    const snapshot = this.ports.snapshot(sourceId)
    if (snapshot === undefined) return
    const verdict = verdictFor(snapshot)
    if (verdict.action === 'none') return
    const plan = verdict.action === 'auto' ? verdict.plan : planForTurn(snapshot, verdict.failure.turn)
    if (plan === null) return
    this.invalidateAttempt()
    this.resolveCycleTarget(sourceId)
    this.plan = plan
    this.userBaseline = userNodeCount(snapshot)
    this.publish({ phase: 'waiting', kind: 'manual', attempt: 0, maxAttempts: 1, delayMs: 0, sourceId, targetId: null, reason: null })
    void this.runAttempt()
  }

  /** User-initiated cancel: no further attempts, ever (until a new failure arms one). */
  cancel(): void {
    if (this.disposed) return
    this.invalidateAttempt()
    this.clearTimer()
    if (this.state.phase === 'idle' || this.state.phase === 'cancelled') return
    const source = this.state.sourceId
    if (source !== null) {
      const end = this.suppressFailure(this.ports.snapshot(source))
      if (end !== undefined) this.settledEndSeq = end
    }
    const target = this.state.targetId
    if (target !== null) this.suppressFailure(this.ports.snapshot(target))
    this.publish({ phase: 'cancelled', delayMs: null, reason: null })
  }

  /** UI "retry now": skip the remaining backoff wait. */
  retryNow(): void {
    if (this.disposed || this.state.phase !== 'waiting' || this.attemptInFlight) return
    this.clearTimer()
    void this.runAttempt()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.invalidateAttempt()
    this.clearTimer()
    this.listeners.clear()
  }

  /**
   * A new cycle reuses the previous cycle's retry child only when its source
   * IS that child (the user retried inside it); any other source means a
   * different failed turn and needs a fresh child.
   */
  private resolveCycleTarget(sourceId: SessionId): void {
    if (this.cycleTargetId !== null && sourceId !== this.cycleTargetId) this.cycleTargetId = null
  }

  private startAuto(sourceId: SessionId, plan: RetryPlan): void {
    this.invalidateAttempt()
    this.resolveCycleTarget(sourceId)
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
    if (this.disposed) return
    // A session event may settle the running child before prompt() returns.
    // Transfer ownership to the next timer now so that the late prompt result
    // cannot overwrite or block the next attempt.
    this.invalidateAttempt()
    this.clearTimer()
    const attempt = this.state.attempt + 1
    const delay = this.state.kind === 'manual'
      ? 0
      : BACKOFF_DELAYS_MS[Math.min(attempt - 1, BACKOFF_DELAYS_MS.length - 1)]
    this.publish({ phase: 'waiting', attempt, delayMs: delay })
    const generation = this.operationGeneration
    this.timer = this.ports.schedule(() => {
      if (this.disposed || generation !== this.operationGeneration) return
      this.timer = null
      void this.runAttempt()
    }, delay)
  }

  private async runAttempt(): Promise<void> {
    if (this.disposed || this.state.phase !== 'waiting' || this.attemptInFlight) return
    const generation = ++this.operationGeneration
    this.attemptInFlight = true
    const sourceId = this.state.sourceId
    const plan = this.plan
    if (sourceId === null || plan === null) {
      this.reset()
      return
    }
    const reused = this.cycleTargetId !== null
    let targetId: SessionId
    try {
      if (reused) {
        // A later attempt of the same cycle — or a retry re-armed inside the
        // cycle's child — continues in that child instead of forking another
        // session: one failed turn must never spawn more than one extra
        // session (issues #797, #880).
        targetId = this.cycleTargetId as SessionId
      } else {
        targetId = plan.forkAtSeq === null
          ? await this.ports.connectBlank(this.ports.cwdOf(sourceId))
          : await this.ports.fork({ sessionId: sourceId, atSeq: plan.forkAtSeq, increaseTitle: false })
        this.cycleTargetId = targetId
      }
    } catch (error) {
      if (!this.ownsAttempt(generation)) return
      this.finish('failed', messageOf(error))
      return
    }
    // Cancel raced a slow fork: do not open or prompt a cancelled cycle.
    if (!this.ownsAttempt(generation) || this.state.phase !== 'waiting') return
    // A fresh child carries the source's history prefix (user messages at or
    // before the fork anchor) plus exactly one replayed message. A reused
    // child already carries one replayed message per finished attempt and is
    // about to gain one more. Takeover detection compares against this
    // expected count, never an absolute one.
    const sourceSnapshot = this.ports.snapshot(sourceId)
    const childSnapshot = reused ? this.ports.snapshot(targetId) : undefined
    this.expectedUserCount = reused
      ? (childSnapshot === undefined ? 0 : userNodeCount(childSnapshot)) + 1
      : plan.forkAtSeq === null
        ? 1
        : (sourceSnapshot === undefined ? 0 : userNodeCountBefore(sourceSnapshot, plan.forkAtSeq)) + 1
    this.attemptStartEndSeq = latestTurnEnd(this.ports.snapshot(targetId))
    if (this.attemptStartEndSeq === 0) this.attemptStartEndSeq = plan.forkAtSeq ?? 0
    this.publish({ phase: 'running', targetId })
    if (!this.ownsRunningAttempt(generation, targetId)) return
    this.ports.open(targetId)
    if (!this.ownsRunningAttempt(generation, targetId)) return
    let outcome: PromptOutcome
    try {
      outcome = await this.ports.prompt(targetId, plan.text)
    } catch (error) {
      if (!this.ownsAttempt(generation)) return
      this.finish('failed', messageOf(error))
      return
    }
    if (!this.ownsRunningAttempt(generation, targetId)) {
      if (this.ownsAttempt(generation)) this.attemptInFlight = false
      return
    }
    this.attemptInFlight = false
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
    this.invalidateAttempt()
    this.clearTimer()
    if (phase !== 'done' && this.state.sourceId !== null) {
      const end = this.suppressFailure(this.ports.snapshot(this.state.sourceId))
      if (end !== undefined) this.settledEndSeq = end
    }
    this.publish({ phase, delayMs: null, targetId: null, ...(reason === null ? {} : { reason }) })
    if (phase !== 'done' && this.state.sourceId !== null) {
      // Return the user to the original failed turn instead of leaving them
      // on a dead intermediate child.
      this.ports.open(this.state.sourceId)
    }
  }

  private reset(): void {
    this.invalidateAttempt()
    this.clearTimer()
    this.plan = null
    this.settledEndSeq = 0
    this.attemptStartEndSeq = 0
    this.publish({ ...IDLE })
  }

  /** Invalidate every late continuation owned by the previous attempt/cycle. */
  private invalidateAttempt(): void {
    this.operationGeneration += 1
    this.attemptInFlight = false
  }

  private ownsAttempt(generation: number): boolean {
    return !this.disposed && generation === this.operationGeneration
  }

  private ownsRunningAttempt(generation: number, targetId: SessionId): boolean {
    return this.ownsAttempt(generation) && this.state.phase === 'running' && this.state.targetId === targetId
  }

  /** Record one terminal failure so ordinary subscription churn cannot re-arm it. */
  private suppressFailure(snapshot: ConversationSnapshot | undefined): number | undefined {
    if (snapshot === undefined) return undefined
    const failure = failureOfLastTurn(snapshot)
    if (failure === null) return undefined
    const previous = this.suppressedFailureEnds.get(snapshot.sessionId) ?? -1
    if (failure.turnEndSeq > previous) this.suppressedFailureEnds.set(snapshot.sessionId, failure.turnEndSeq)
    return failure.turnEndSeq
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

/** Highest completed turn/end seq in one snapshot (0 for blank/unavailable). */
function latestTurnEnd(snapshot: ConversationSnapshot | undefined): number {
  if (snapshot === undefined) return 0
  let latest = 0
  for (const end of snapshot.turnEnds.values()) if (end > latest) latest = end
  return latest
}
