/**
 * Session-reuse rule (issue #1419): decides which task runs continue in the
 * previous execution's conversation. Pure, so the fail-closed conditions stay
 * unit-testable without a gateway.
 */
import type { ExecutionRecord, TaskRecord } from './tasks.ts'

/** Everything the reuse rule reads beyond the card's own execution history. */
export interface ReuseOptions {
  /**
   * Continue the settled session regardless of the card's own `reuseSession`
   * opt-in. A rework is exactly that case: the reviewer read the previous run's
   * session and sent it back. The force waives the opt-in, never the evidence.
   */
  force?: boolean
  /**
   * The Workspace registry's global archive set (issue #2068).
   *
   * A Session in that set can never run a turn: the Host's archived-session
   * gate rejects its first step before any model request is issued, so a
   * launch that prompts into one settles as the opaque failure `agent turn
   * ended without completing: blocked`. A card that keeps one conversation may
   * still lose it to a bulk archive of the sidebar, and every later scheduled
   * run would fail there, so reuse has to step aside instead of dying.
   *
   * Absent means this deployment's registry face cannot report an archive set.
   * That is unknown evidence, never proof that nothing is archived: the rule
   * then keeps its pre-archive-set behavior instead of inventing a refusal,
   * because a registry face without the getter serves no archive action for the
   * board to defend against.
   */
  archivedSessionIds?: ReadonlySet<string>
}

/**
 * The session the newest settled execution ran in, or undefined when no
 * execution carries one.
 *
 * The launch path calls the reuse rule after `startExecution` appended this
 * run's own open record, so the array tail is always an unsettled row at that
 * point and the scan has to skip it (issue #1587).
 * @param task - the task whose history is read.
 * @returns the newest settled session id, if any.
 */
export function newestSettledSessionId(task: TaskRecord): string | undefined {
  for (let index = task.executions.length - 1; index >= 0; index -= 1) {
    const candidate: ExecutionRecord | undefined = task.executions[index]
    if (candidate !== undefined && candidate.sessionId !== undefined && candidate.endedAt !== undefined) return candidate.sessionId
  }
  return undefined
}

/**
 * Pick the session a new execution of this task may continue in, or undefined
 * to mint a fresh conversation. Reuse requires ALL of:
 * - the task opted in (`reuseSession === true`) unless the caller forces it;
 * - the task's newest settled execution carries a session id (issue #1587);
 * - the roster is known and that session is present and idle;
 * - that session is not archived, when the deployment reports an archive set
 *   (issue #2068).
 *
 * An unknown roster (session/list unavailable) never reuses: minting a fresh
 * conversation is always safe, prompting into a session we cannot see is not.
 * An archived session is refused for the same reason — the Host will not run a
 * turn in it, so continuing there can only fail the run that tried.
 * @param task - the task about to run.
 * @param idleSessionIds - ids the last roster saw as present and not running;
 *   undefined when that roster is unknown.
 * @param options - force and the archive set; see {@link ReuseOptions}.
 * @returns the session id to continue in, or undefined for a fresh session.
 */
export function reusableSessionId(
  task: TaskRecord,
  idleSessionIds: ReadonlySet<string> | undefined,
  options: ReuseOptions = {},
): string | undefined {
  if (options.force !== true && task.reuseSession !== true) return undefined
  if (idleSessionIds === undefined) return undefined
  const newest = newestSettledSessionId(task)
  if (newest === undefined) return undefined
  if (options.archivedSessionIds?.has(newest) === true) return undefined
  return idleSessionIds.has(newest) ? newest : undefined
}
