/**
 * Archive/restore task use case: move a task off the main board and back,
 * whatever its status but `running`. The task keeps its status, execution history, and
 * transcript references, while archiving disarms any schedule so it cannot
 * create more execution records until the user restores and re-enables it.
 */
import type { TaskRecord } from '../tasks.ts'
import { ARCHIVABLE_STATUSES } from '../tasks.ts'

/** Result of an archive transition. */
export interface ArchiveTaskResult {
  /** The next ledger. */
  tasks: readonly TaskRecord[]
  /** Whether the archive was applied (false = unknown task / not archivable). */
  archived: boolean
}

/**
 * Archive one task: only a `running` task stays on the board (its runner
 * still owns its lifecycle until the execution settles); every other status
 * can be archived. Archiving disarms a schedule; already-archived tasks are
 * a no-op.
 */
export function applyArchiveTask(
  tasks: readonly TaskRecord[],
  id: string,
  now: number,
): ArchiveTaskResult {
  let applied = false
  const next = tasks.map(task => {
    if (task.id !== id || task.archivedAt !== undefined) return task
    if (!(ARCHIVABLE_STATUSES as readonly string[]).includes(task.status)) return task
    applied = true
    const schedule = task.schedule === undefined
      ? undefined
      : { ...task.schedule, enabled: false, nextRunAt: undefined }
    return {
      ...task,
      ...(schedule === undefined ? {} : { schedule }),
      archivedAt: now,
      updatedAt: now,
    }
  })
  return { tasks: next, archived: applied }
}

/** Restore one task back onto the main board (clears the archive marker). */
export function applyRestoreTask(tasks: readonly TaskRecord[], id: string, now: number): ArchiveTaskResult {
  let applied = false
  const next = tasks.map(task => {
    if (task.id !== id || task.archivedAt === undefined) return task
    applied = true
    const { archivedAt: _archived, ...rest } = task
    return { ...rest, updatedAt: now }
  })
  return { tasks: next, archived: applied }
}
