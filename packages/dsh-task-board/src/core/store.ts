/**
 * Legacy v1 browser persistence and the store seam used by pure client tests.
 *
 * Production v2 state is Host-authoritative. This backend is retained only to
 * read `dsh.taskBoard.v1` for one-time import; the old value is never removed,
 * so it remains a read-only rollback copy after migration.
 *
 * The seam keeps the backend swappable (e.g. an IndexedDB or a host-file
 * channel later); tests run against the in-memory backend and a jsdom
 * localStorage backend.
 */
import { isValidCron } from './schedule.ts'
import { isTaskPermission, isTaskStatus, normalizeTargetId, type ScheduleRule, type TaskRecord, type TaskPermission, type TaskStatus } from './tasks.ts'

/** Persistence seam for the task ledger. */
export interface TaskStore {
  /** Read the persisted ledger (empty when nothing is stored yet). */
  load(): TaskRecord[]
  /** Persist the whole ledger (replaces the stored document). */
  save(tasks: readonly TaskRecord[]): void
  /** Drop the persisted ledger (leaves the in-memory state alone). */
  clear(): void
  /**
   * Subscribe to ledger changes written by ANOTHER tab of the same origin
   * (browser storage events). The board controller reloads the ledger on
   * such a change, so a task deleted in one tab cannot keep firing (or be
   * written back) from the stale in-memory copy of another tab. No-op when
   * the backend has no cross-instance channel (in-memory store).
   */
  subscribeExternal?(listener: () => void): () => void
}

/** Storage key for the task ledger document. */
export const DEFAULT_STORAGE_KEY = 'dsh.taskBoard.v1'

/** Structural shape of the storage event fired in sibling tabs (DOM-free). */
export interface StorageChangeEvent {
  key: string | null
}

/** The event-target face the store needs for cross-tab notifications. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: StorageChangeEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageChangeEvent) => void): void
}

/**
 * Structural row check with the status left unvalidated (see {@link parseLedger}).
 * The `schedule` field is deliberately NOT checked here: a malformed schedule
 * never drops the task row — {@link normalizeSchedule} repairs or drops the
 * schedule alone.
 */
function isTaskRecordShape(value: unknown): value is Omit<TaskRecord, 'status'> & { status: unknown } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id === '') return false
  if (typeof record.title !== 'string') return false
  if (typeof record.description !== 'string') return false
  if (typeof record.prompt !== 'string') return false
  if (typeof record.createdAt !== 'number') return false
  if (typeof record.updatedAt !== 'number') return false
  if (record.workspaceId !== undefined && typeof record.workspaceId !== 'string') return false
  if (record.mode !== undefined && typeof record.mode !== 'string') return false
  if (record.permission !== undefined && typeof record.permission !== 'string') return false
  if (!Array.isArray(record.executions)) return false
  for (const execution of record.executions) {
    if (typeof execution !== 'object' || execution === null) return false
    const entry = execution as Record<string, unknown>
    if (typeof entry.id !== 'string') return false
    if (entry.sessionId !== undefined && typeof entry.sessionId !== 'string') return false
    if (typeof entry.startedAt !== 'number') return false
    if (entry.endedAt !== undefined && typeof entry.endedAt !== 'number') return false
    if (entry.result !== undefined && entry.result !== 'succeeded' && entry.result !== 'failed' && entry.result !== 'cancelled') return false
    if (entry.error !== undefined && typeof entry.error !== 'string') return false
  }
  return true
}

/** A task record is structurally valid if it round-trips through the UI. */
export function isTaskRecord(value: unknown): value is TaskRecord {
  return isTaskRecordShape(value) && isTaskStatus(value.status)
}

/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status: unknown): TaskStatus {
  return isTaskStatus(status) ? status : 'todo'
}

/**
 * Repair a persisted schedule rule: drop rules without a usable cron string,
 * coerce booleans/numbers, and leave `nextRunAt`/`lastTriggeredAt` undefined
 * when missing (a fresh recompute or the next tick fixes them).
 */
function normalizeSchedule(schedule: unknown): ScheduleRule | undefined {
  if (typeof schedule !== 'object' || schedule === null) return undefined
  const rule = schedule as Record<string, unknown>
  // Reject (drop) a schedule whose cron is not a well-formed 5-field
  // expression: a malformed rule would otherwise linger as a never-firing
  // schedule instead of being dropped for later repair.
  if (typeof rule.cron !== 'string') return undefined
  if (rule.cron.trim() === '' || !isValidCron(rule.cron)) return undefined
  return {
    enabled: rule.enabled === true,
    cron: rule.cron,
    nextRunAt: typeof rule.nextRunAt === 'number' ? rule.nextRunAt : undefined,
    lastTriggeredAt: typeof rule.lastTriggeredAt === 'number' ? rule.lastTriggeredAt : undefined,
  }
}

/** Parse + validate a persisted ledger document; invalid rows are dropped. */
export function parseLedger(raw: string | null): TaskRecord[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error('[dsh-task-board] persisted task ledger is not valid JSON; starting empty', error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error('[dsh-task-board] persisted task ledger is not an array; starting empty')
    return []
  }
  const tasks: TaskRecord[] = []
  for (const row of parsed) {
    // Status is normalized (an unknown status from a future version lands in
    // todo instead of dropping the row); the schedule is repaired field by
    // field; every other field must be valid.
    if (!isTaskRecordShape(row)) {
      console.warn('[dsh-task-board] dropping invalid task row from persisted ledger', row)
      continue
    }
    // Always (re)assign the schedule: a repair that returns undefined must
    // clear a malformed persisted rule rather than leave it in the row.
    const task: TaskRecord = { ...row, status: normalizeStatus(row.status) }
    task.schedule = normalizeSchedule(row.schedule)
    // Execution targets are normalized like the schedule: blank strings
    // clear the pin and unknown permission strings from a future version
    // fall back to the session default instead of dropping the row.
    task.workspaceId = normalizeTargetId(row.workspaceId)
    task.mode = normalizeTargetId(row.mode)
    task.archivedAt = typeof row.archivedAt === 'number' && Number.isFinite(row.archivedAt) ? row.archivedAt : undefined
    task.permission = isTaskPermission(row.permission) ? row.permission as TaskPermission : undefined
    tasks.push(task)
  }
  return tasks
}

/** localStorage-backed store (the browser backend). */
export class LocalStorageTaskStore implements TaskStore {
  /**
   * @param key - storage key for the ledger document.
   * @param storage - storage backend (defaults to the global localStorage; tests inject fakes).
   * @param events - storage-event target for cross-tab notifications (defaults
   *   to the browser global; undefined in non-browser runtimes, where the
   *   subscription becomes a no-op).
   */
  constructor(
    private readonly key: string = DEFAULT_STORAGE_KEY,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = globalThis.localStorage,
    private readonly events: StorageEvents | undefined = typeof (globalThis as { addEventListener?: unknown }).addEventListener === 'function'
      ? (globalThis as unknown as StorageEvents)
      : undefined,
  ) {}

  load(): TaskRecord[] {
    if (this.storage === undefined) return []
    try {
      return parseLedger(this.storage.getItem(this.key))
    } catch (error) {
      // Storage read failures (private mode, quota) degrade to an empty ledger,
      // never break the board.
      console.error('[dsh-task-board] task ledger read failed; starting empty', error)
      return []
    }
  }

  save(tasks: readonly TaskRecord[]): void {
    if (this.storage === undefined) return
    try {
      this.storage.setItem(this.key, JSON.stringify(tasks))
    } catch (error) {
      // Write failures only skip persistence; in-memory state stays live.
      console.error('[dsh-task-board] task ledger write failed (persistence skipped)', error)
    }
  }

  clear(): void {
    if (this.storage === undefined) return
    try {
      this.storage.removeItem(this.key)
    } catch (error) {
      console.error('[dsh-task-board] task ledger clear failed', error)
    }
  }

  /**
   * Cross-tab change subscription (see {@link TaskStore.subscribeExternal}).
   * The browser fires the storage event in every OTHER tab of the same origin
   * when one tab writes; a null key means the whole storage was cleared. Both
   * cases reload the ledger here; unrelated keys are ignored.
   */
  subscribeExternal(listener: () => void): () => void {
    if (this.events === undefined) return () => {}
    const onStorage = (event: StorageChangeEvent): void => {
      if (event.key !== null && event.key !== this.key) return
      listener()
    }
    this.events.addEventListener('storage', onStorage)
    return () => { this.events?.removeEventListener('storage', onStorage) }
  }
}

/** In-memory backend (tests, and a fallback when storage is unavailable). */
export class InMemoryTaskStore implements TaskStore {
  private ledger: TaskRecord[] = []

  load(): TaskRecord[] {
    return this.ledger.map(task => ({ ...task, executions: [...task.executions] }))
  }

  save(tasks: readonly TaskRecord[]): void {
    this.ledger = tasks.map(task => ({ ...task, executions: [...task.executions] }))
  }

  clear(): void {
    this.ledger = []
  }
}
