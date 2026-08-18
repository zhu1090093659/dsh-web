/** Deterministic primary-task selection for multi-session pet snapshots. */

import type { PetTaskSnapshot } from './protocol.ts'

/** External hints that can raise a task without mutating its snapshot. */
export interface PrimaryTaskSelection {
  nowMs: number
  pinnedTaskId?: string
  focusedTaskId?: string
  /** Registry-owned hint for the most recently updated active task. */
  recentTaskId?: string
  /** How long a failed task receives urgent priority. */
  failedPriorityMs?: number
}

const DEFAULT_FAILED_PRIORITY_MS = 30_000

function byRecentActivity(left: PetTaskSnapshot, right: PetTaskSnapshot): number {
  return right.updatedAt - left.updatedAt
    || left.startedAt - right.startedAt
    || left.taskId.localeCompare(right.taskId)
}

function mostRecent(tasks: PetTaskSnapshot[]): PetTaskSnapshot | undefined {
  return [...tasks].sort(byRecentActivity)[0]
}

function isActive(task: PetTaskSnapshot): boolean {
  return !['idle', 'done', 'failed'].includes(task.phase)
}

/**
 * Choose the task the companion should foreground. Priority is waiting for
 * user, a fresh failure, an explicit pin, foreground focus, recent active
 * work, recent completion, then an idle task. Ties are stable by task ID.
 */
export function selectPrimaryTask(
  tasks: PetTaskSnapshot[],
  options: PrimaryTaskSelection,
): PetTaskSnapshot | undefined {
  if (tasks.length === 0) return undefined

  const waitingInput = mostRecent(tasks.filter(task => task.phase === 'waiting_input'))
  if (waitingInput !== undefined) return waitingInput

  const blocked = mostRecent(tasks.filter(task => task.phase === 'blocked'))
  if (blocked !== undefined) return blocked

  const failedPriorityMs = options.failedPriorityMs ?? DEFAULT_FAILED_PRIORITY_MS
  const failed = mostRecent(tasks.filter(task => (
    task.phase === 'failed' && options.nowMs - task.updatedAt <= failedPriorityMs
  )))
  if (failed !== undefined) return failed

  const pinned = options.pinnedTaskId === undefined
    ? undefined
    : tasks.find(task => task.taskId === options.pinnedTaskId)
  if (pinned !== undefined) return pinned

  const focused = options.focusedTaskId === undefined
    ? undefined
    : tasks.find(task => task.taskId === options.focusedTaskId)
  if (focused !== undefined) return focused

  const recent = options.recentTaskId === undefined
    ? undefined
    : tasks.find(task => task.taskId === options.recentTaskId && isActive(task))
  if (recent !== undefined) return recent

  const active = mostRecent(tasks.filter(isActive))
  if (active !== undefined) return active

  const completed = mostRecent(tasks.filter(task => task.phase === 'done'))
  if (completed !== undefined) return completed

  return mostRecent(tasks)
}
