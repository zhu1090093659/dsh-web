/**
 * Retry policy: failure detection, recoverability classification and retry
 * planning over a ConversationSnapshot. Pure and framework-free so both the
 * transcript UI and the supervisor share one decision source.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  hostRetryPending,
  interruptedAssistantInTurn,
  lastUserInTurn,
  maxTokensInTurn,
  turnErrorInTurn,
  turnHasToolActivity,
  userText,
} from './transcript.ts'

/** Additional retries after the first (failed) attempt, per the issue contract. */
export const MAX_EXTRA_RETRIES = 5

/** Exponential backoff delays for attempts 1..5 (1s, 2s, 4s, 8s, 16s). */
export const BACKOFF_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const

/** One terminal failure of a completed turn. */
export interface TurnFailure {
  kind: 'turn-error' | 'interrupted' | 'max-tokens'
  turn: number
  turnEndSeq: number
  message: string | null
  code: string | null
  hasTools: boolean
}

/** What re-running the failed turn needs: the original text and the fork anchor. */
export interface RetryPlan {
  /** Verbatim user text of the failed turn (text-only; images are never replayed). */
  text: string
  /**
   * Fork anchor: the latest completed turn/end before the failed turn. Null
   * when the failed turn was the first turn: the supervisor then falls back
   * to a fresh blank session in the same workspace.
   */
  forkAtSeq: number | null
  /** Seq of the user message that opened the failed turn. */
  messageSeq: number
}

export type RetryVerdict =
  | { action: 'none' }
  | { action: 'auto'; failure: TurnFailure; plan: RetryPlan }
  | { action: 'manual'; failure: TurnFailure }

/**
 * The terminal failure of the LAST completed turn, when one exists. Running
 * sessions never produce a failure: a turn that is still going is not failed.
 * @param snapshot - the live conversation snapshot.
 * @returns the failure descriptor, or null when the last turn did not fail.
 */
export function failureOfLastTurn(snapshot: ConversationSnapshot): TurnFailure | null {
  if (snapshot.running) return null
  let turn = -1
  let end = 0
  for (const [t, e] of snapshot.turnEnds) {
    if (t > turn) {
      turn = t
      end = e
    }
  }
  if (turn === -1) return null
  const error = turnErrorInTurn(snapshot, turn)
  if (error !== null) {
    return {
      kind: 'turn-error',
      turn,
      turnEndSeq: end,
      message: error.message,
      code: error.code ?? null,
      hasTools: turnHasToolActivity(snapshot, turn),
    }
  }
  if (maxTokensInTurn(snapshot, turn)) {
    return {
      kind: 'max-tokens',
      turn,
      turnEndSeq: end,
      message: null,
      code: 'turn-max-tokens',
      hasTools: turnHasToolActivity(snapshot, turn),
    }
  }
  if (interruptedAssistantInTurn(snapshot, turn) !== null) {
    return {
      kind: 'interrupted',
      turn,
      turnEndSeq: end,
      // host/agent-error is the durable outlet for live failures without a
      // turn position: non-null means the turn crashed, null means the user
      // stopped it on purpose.
      message: snapshot.lastAgentError,
      code: null,
      hasTools: turnHasToolActivity(snapshot, turn),
    }
  }
  return null
}

/**
 * Recoverable-error classification. Only model/API-level transient failures
 * count as auto-retryable: timeouts, network errors, server errors, rate
 * limits and empty responses. Auth failures, permission errors, invalid
 * arguments, quotas and cancellations are NEVER auto-retried.
 * @param code - machine-routing error code, when present.
 * @param message - human-readable failure text, when present.
 */
export function isRetryableError(code: string | null | undefined, message: string | null | undefined): boolean {
  const haystack = `${code ?? ''} ${message ?? ''}`
  if (!RETRYABLE_PATTERN.test(haystack)) return false
  if (NON_RETRYABLE_PATTERN.test(haystack)) return false
  return true
}

const RETRYABLE_PATTERN = /(timeout|timed[\s_-]?out|network|econn|eof|socket|fetch|connection|dns|enotfound|transport|rate[\s_-]?limit|429|5\d{2}|server|overloaded|unavailable|capacity|empty|no[\s_-]?response)/i
const NON_RETRYABLE_PATTERN = /(400|401|402|403|404|405|422|quota|auth|credential|api[\s_-]?key|permission|denied|forbidden|invalid|unsupported|not[\s_-]?found|cancel)/i

/**
 * Build the re-run plan for one failed turn: its original user text plus the
 * fork anchor that cuts history right before it, so a retry branch never
 * repeats the old message and the failed stream fragments never enter the
 * next model request.
 * @param snapshot - the live conversation snapshot.
 * @param turn - the failed turn number.
 * @returns the plan, or null when the turn has no safely-replayable user message.
 */
export function planForTurn(snapshot: ConversationSnapshot, turn: number): RetryPlan | null {
  const message = lastUserInTurn(snapshot, turn)
  if (message === null) return null
  const text = userText(message.content)
  if (text === null || text.trim() === '') return null
  let start = 0
  for (const [t, end] of snapshot.turnEnds) if (t < turn && end > start) start = end
  return {
    text,
    forkAtSeq: start === 0 ? null : start,
    messageSeq: message.seq,
  }
}

/**
 * Whether the failure qualifies for AUTOMATIC retry. Tool-involved turns are
 * manual-only (re-running them repeats side effects whose idempotency cannot
 * be confirmed); interrupted turns are auto only when the host reported a
 * crash (lastAgentError), never when the user stopped the turn on purpose;
 * output-token caps are never auto-retried.
 */
function isAutoRetryable(snapshot: ConversationSnapshot, failure: TurnFailure): boolean {
  if (failure.hasTools) return false
  switch (failure.kind) {
    case 'turn-error':
      return isRetryableError(failure.code, failure.message)
    case 'interrupted':
      return snapshot.lastAgentError !== null
    case 'max-tokens':
      return false
  }
}

/**
 * The full retry decision for the current state of a session. The host's own
 * pending llm/retry chain stands the supervisor down; everything else that is
 * failed but not auto-retryable lands on the manual path (transcript button).
 * @param snapshot - the live conversation snapshot.
 */
export function verdictFor(snapshot: ConversationSnapshot): RetryVerdict {
  if (snapshot.running || snapshot.removed) return { action: 'none' }
  const failure = failureOfLastTurn(snapshot)
  if (failure === null) return { action: 'none' }
  if (hostRetryPending(snapshot, failure.turn)) return { action: 'none' }
  if (isAutoRetryable(snapshot, failure)) {
    const plan = planForTurn(snapshot, failure.turn)
    if (plan !== null) return { action: 'auto', failure, plan }
  }
  return { action: 'manual', failure }
}
