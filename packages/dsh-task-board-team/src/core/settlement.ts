/**
 * The settlement one finished execution reports to the hub.
 *
 * The board owns the execution verdict and the hub owns the collaboration
 * status, so this module is the whole mapping between them: a succeeded
 * execution verdict becomes `succeeded` (the hub moves the issue to `in_review`), and
 * every other outcome — including a cancelled run — becomes `failed`, because a
 * card the Host stopped never earned a human review. The summary is clipped to
 * the character cap the protocol fixes (section 13), which mirrors the board's
 * own execution-summary limit.
 *
 * @module dsh-task-board-team/core/settlement
 */
import { EXECUTION_SUMMARY_LIMIT } from './hub-protocol.ts'
import type { ExecutionOutcome, TaskRecord } from './task-record.ts'

/** The body one settlement write-back sends. */
export interface SettleRequestBody {
  outcome: 'succeeded' | 'failed'
  summary: string
  error?: string
  /**
   * The attempt this settlement belongs to.
   *
   * The hub keeps it optional, but a lease that expired while the run was still
   * going is only accepted when the attempt matches: presenting it is what lets a
   * long execution report its own result instead of having it refused as stale.
   */
  execution_attempt_id?: string
  /**
   * What the Host itself verified, in the shape the frozen settlement sample
   * shows. It is the local evidence a reviewer reads next to the outcome.
   */
  verification_evidence?: Record<string, unknown>
}

/**
 * Map one execution outcome onto the hub's settlement vocabulary.
 * @param outcome - the board's own verdict.
 * @returns `succeeded` only for a passed run.
 */
export function settleOutcome(outcome: ExecutionOutcome): 'succeeded' | 'failed' {
  return outcome === 'succeeded' ? 'succeeded' : 'failed'
}

/**
 * Clip one summary to the protocol's character cap.
 * @param text - the text to clip.
 * @returns text of at most {@link EXECUTION_SUMMARY_LIMIT} characters.
 */
export function clipSummary(text: string): string {
  if (text.length <= EXECUTION_SUMMARY_LIMIT) return text
  return text.slice(0, EXECUTION_SUMMARY_LIMIT - 3) + '...'
}

/**
 * Build the settlement body for one settled execution.
 *
 * The summary names the run and what it produced, so a reviewer reading the hub
 * sees which attempt this was without opening the Host: the card title, the
 * attempt id and, on a failure, the recorded reason.
 * @param input - the settlement event and the card it belongs to.
 * @returns the body to post.
 */
export function buildSettleRequest(input: {
  task: TaskRecord
  executionId: string
  outcome: ExecutionOutcome
  error?: string
  /** Attempt the card was claimed under, when the payload still records one. */
  attemptId?: string
}): SettleRequestBody {
  const outcome = settleOutcome(input.outcome)
  const lines = [
    `${input.task.title} — ${outcome === 'succeeded' ? 'execution succeeded' : 'execution failed'}`,
    `attempt: ${input.executionId}`,
  ]
  if (input.error !== undefined && input.error.trim() !== '') lines.push(`reason: ${input.error.trim()}`)
  const body: SettleRequestBody = { outcome, summary: clipSummary(lines.join('\n')) }
  if (input.error !== undefined && input.error.trim() !== '') body.error = clipSummary(input.error.trim())
  if (input.attemptId !== undefined) body.execution_attempt_id = input.attemptId
  body.verification_evidence = { execution_id: input.executionId, outcome }
  return body
}