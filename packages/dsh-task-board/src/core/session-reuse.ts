/**
 * Session-reuse rule (issue #1419): decides which task runs continue in the
 * previous execution's conversation. Pure, so the fail-closed conditions stay
 * unit-testable without a gateway.
 */
import type { ExecutionRecord, TaskRecord } from './tasks.ts'

/**
 * Pick the session a new execution of this task may continue in, or undefined
 * to mint a fresh conversation. Reuse requires ALL of:
 * - the task opted in (`reuseSession === true`);
 * - the task's newest SETTLED execution carries a session id (issue #1587: the
 *   launch path calls this after `startExecution` appended this run's own open
 *   record, so reading the array tail always found an unsettled row and reuse
 *   never happened);
 * - the roster is known and that session is present and idle.
 *
 * An unknown roster (session/list unavailable) never reuses: minting a fresh
 * conversation is always safe, prompting into a session we cannot see is not.
 * @param task - the task about to run.
 * @param idleSessionIds - ids the last roster saw as present and not running;
 *   undefined when that roster is unknown.
 * @returns the session id to continue in, or undefined for a fresh session.
 */
export function reusableSessionId(
  task: TaskRecord,
  idleSessionIds: ReadonlySet<string> | undefined,
): string | undefined {
  if (task.reuseSession !== true || idleSessionIds === undefined) return undefined
  let last: ExecutionRecord | undefined
  for (let index = task.executions.length - 1; index >= 0; index -= 1) {
    const candidate = task.executions[index]
    if (candidate.sessionId !== undefined && candidate.endedAt !== undefined) {
      last = candidate
      break
    }
  }
  if (last === undefined || last.sessionId === undefined) return undefined
  return idleSessionIds.has(last.sessionId) ? last.sessionId : undefined
}
