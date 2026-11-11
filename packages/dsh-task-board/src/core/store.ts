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
import { isValidCron, isValidTimeZone } from './schedule.ts'
import { SCHEDULE_STOP_REASONS, isTaskPermission, isTaskStatus, normalizeExecutionRework, normalizeTags, normalizeTargetId, type ScheduleRule, type ScheduleStopReason, type TaskFreeze, type TaskRecord, type TaskPermission, type TaskStatus } from './tasks.ts'
import { isExecutionOutcome } from './subtask.ts'
import { normalizeExecutionSummary } from './execution-summary.ts'
import type { TaskHandover } from './handover.ts'
import { sanitizeFreezeSnapshot } from './freeze-snapshot.ts'
import { sanitizeHandover } from './handover.ts'
import { normalizeTaskIntegrations } from './extension.ts'
import { normalizeAttachments } from './attachment.ts'

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
  if (record.parentId !== undefined && typeof record.parentId !== 'string') return false
  if (record.workspaceId !== undefined && typeof record.workspaceId !== 'string') return false
  if (record.mode !== undefined && typeof record.mode !== 'string') return false
  if (record.reasoningEffort !== undefined && typeof record.reasoningEffort !== 'string') return false
  if (record.permission !== undefined && typeof record.permission !== 'string') return false
  if (record.integrations !== undefined && (typeof record.integrations !== 'object' || record.integrations === null || Array.isArray(record.integrations))) return false
  if (record.hidden !== undefined && typeof record.hidden !== 'boolean') return false
  if (record.attachments !== undefined && !Array.isArray(record.attachments)) return false
  if (record.reuseSession !== undefined && typeof record.reuseSession !== 'boolean') return false
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
    if (entry.initiatedBy !== undefined && typeof entry.initiatedBy !== 'string') return false
    if (entry.frozenBy !== undefined && typeof entry.frozenBy !== 'string') return false
    if (entry.frozenAt !== undefined && typeof entry.frozenAt !== 'number') return false
    // An external-outcome marker is optional in BOTH directions: a ledger
    // written before the field existed carries none, and a non-boolean value
    // is dropped by the repair below rather than trusted as provenance.
    if (entry.external !== undefined && typeof entry.external !== 'boolean') return false
  }
  return true
}

/**
 * Drop the fields of retired features from one loaded row.
 *
 * A ledger written by an older build may still carry them: `goalRun` and
 * `skipVerification` on a card, and the acceptance block on an execution. They
 * are removed field by field rather than rejected — an old row always loads,
 * every other field is untouched, and the next commit persists the row without
 * them, so a removed option never survives a load and no new value is ever
 * written for it.
 * @param value - the parsed row (a card or one execution record).
 * @returns a copy without the retired fields.
 */
function withoutRetiredFields<T extends object>(value: T): T {
  const kept = { ...value } as Record<string, unknown>
  delete kept.goalRun
  delete kept.skipVerification
  delete kept.verification
  return kept as T
}

/** A task record is structurally valid if it round-trips through the UI. */
export function isTaskRecord(value: unknown): value is TaskRecord {
  return isTaskRecordShape(value) && isTaskStatus(value.status)
}

/** Normalize an unknown persisted status back into the closed status union. */
function normalizeStatus(status: unknown): TaskStatus {
  return isTaskStatus(status) ? status : 'todo'
}

/** A persisted ms timestamp, kept only when it is a usable finite number. */
function optionalInstant(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A persisted positive-integer run cap, or undefined for unlimited/repair. */
function optionalRunCap(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined
}

/** A persisted stop reason, kept only when it names a reason this build knows. */
function optionalStopReason(value: unknown): ScheduleStopReason | undefined {
  return typeof value === 'string' && SCHEDULE_STOP_REASONS.includes(value as ScheduleStopReason)
    ? value as ScheduleStopReason
    : undefined
}

/**
 * Repair a persisted schedule rule. Both modes are repaired field by field and
 * a rule that carries no usable plan is dropped (the task row survives):
 * a recurring rule without a well-formed 5-field cron, or a one-shot without a
 * finite planned instant. A rule written before `mode` existed is a cron rule.
 */
function normalizeSchedule(schedule: unknown): ScheduleRule | undefined {
  if (typeof schedule !== 'object' || schedule === null) return undefined
  const rule = schedule as Record<string, unknown>
  // A stored zone survives only when this runtime can resolve it; an unusable
  // name is dropped (the rule then follows the Host zone) instead of being
  // kept to fail every later resolve.
  const timeZone = typeof rule.timeZone === 'string' && isValidTimeZone(rule.timeZone) ? rule.timeZone : undefined
  const runCountValue = rule.runCount
  const runCount = typeof runCountValue === 'number' && Number.isInteger(runCountValue) && runCountValue >= 0
    ? runCountValue
    : 0
  const endedAt = optionalInstant(rule.endedAt)
  const endedReason = optionalStopReason(rule.endedReason)
  const skippedAt = optionalInstant(rule.skippedAt)
  const skippedReason = optionalStopReason(rule.skippedReason)
  const common = {
    enabled: rule.enabled === true,
    ...(timeZone === undefined ? {} : { timeZone }),
    nextRunAt: optionalInstant(rule.nextRunAt),
    lastTriggeredAt: optionalInstant(rule.lastTriggeredAt),
    runCount,
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(endedReason === undefined ? {} : { endedReason }),
    ...(skippedAt === undefined ? {} : { skippedAt }),
    ...(skippedReason === undefined ? {} : { skippedReason }),
  }
  if (rule.mode === 'once') {
    const at = optionalInstant(rule.at)
    // A one-shot with no instant can never fire; drop it rather than keep a
    // rule the scheduler would have to interpret.
    if (at === undefined) return undefined
    return { ...common, mode: 'once', at }
  }
  // Reject (drop) a schedule whose cron is not a well-formed 5-field
  // expression: a malformed rule would otherwise linger as a never-firing
  // schedule instead of being dropped for later repair.
  if (typeof rule.cron !== 'string') return undefined
  if (rule.cron.trim() === '' || !isValidCron(rule.cron)) return undefined
  const maxRuns = optionalRunCap(rule.maxRuns)
  return {
    ...common,
    mode: 'cron',
    cron: rule.cron,
    ...(maxRuns === undefined ? {} : { maxRuns }),
  }
}

/**
 * Repair a persisted freeze snapshot: shape + gate re-check (slash taint,
 * redaction idempotence, byte cap); a malformed or tainted snapshot is
 * dropped (undefined) rather than dropping the whole task row, mirroring
 * the schedule repair policy.
 */
function normalizeFreeze(value: unknown): TaskFreeze | undefined {
  const result = sanitizeFreezeSnapshot(value, ['frozenAt', 'redacted', 'frozenBy'])
  if (!result.ok) return undefined
  const frozenAt = result.extras.frozenAt
  if (typeof frozenAt !== 'number' || !Number.isFinite(frozenAt)) return undefined
  if (result.extras.redacted !== undefined && result.extras.redacted !== true) return undefined
  const frozenBy = result.extras.frozenBy
  if (frozenBy !== undefined && (typeof frozenBy !== 'string' || frozenBy === '')) return undefined
  return {
    goal: result.snapshot.goal,
    progress: result.snapshot.progress,
    next: result.snapshot.next,
    frozenAt,
    ...(result.redacted || result.extras.redacted === true ? { redacted: true } : {}),
    ...(frozenBy === undefined ? {} : { frozenBy }),
  }
}

/**
 * Repair a persisted handover bundle: shape re-check through the same gate
 * as the wire path; a malformed bundle is dropped rather than dropping the
 * task row (mirroring the schedule/freeze repair policy).
 */
function normalizeHandover(value: unknown): TaskHandover | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { bundledAt, ...rest } = value as Record<string, unknown> & { bundledAt: unknown }
  const bundle = sanitizeHandover(rest)
  if (bundle === undefined) return undefined
  if (typeof bundledAt !== 'number' || !Number.isFinite(bundledAt)) return undefined
  return { ...bundle, bundledAt }
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
    const task: TaskRecord = withoutRetiredFields({ ...row, status: normalizeStatus(row.status) })
    task.schedule = normalizeSchedule(row.schedule)
    // The lineage link is repaired like every other optional field: a blank or
    // non-string parent id clears the link instead of dropping the row. Whether
    // the link is structurally sound (parent exists, no cycle) is decided where
    // the whole list is known (HostTaskLedger.parseHostTasks).
    task.parentId = normalizeTargetId(row.parentId)
    // Cascade bookkeeping on execution records is repaired field by field too,
    // so a hand-edited ledger degrades a run group instead of the whole task.
    task.executions = task.executions.map(execution => ({
      ...withoutRetiredFields(execution),
      runGroupId: normalizeTargetId(execution.runGroupId),
      ownResult: isExecutionOutcome(execution.ownResult) ? execution.ownResult : undefined,
      ownError: typeof execution.ownError === 'string' ? execution.ownError : undefined,
      // A summary a reader does not recognize (an older document has none) is
      // simply absent; a malformed one is dropped without costing the run.
      summary: normalizeExecutionSummary(execution.summary),
      // A malformed rework block is dropped on the same terms: the run itself
      // is what the history is for, and only its instructions are unrecoverable.
      rework: normalizeExecutionRework(execution.rework),
      external: execution.external === true ? true : undefined,
    }))
    // Execution targets are normalized like the schedule: blank strings
    // clear the pin and unknown permission strings from a future version
    // fall back to the session default instead of dropping the row.
    task.workspaceId = normalizeTargetId(row.workspaceId)
    task.mode = normalizeTargetId(row.mode)
    // The effort is repaired like the other execution-target strings: blank text
    // from a hand-edited document clears the pin instead of dropping the row,
    // and the card then runs at its model's own default level.
    task.reasoningEffort = normalizeTargetId(row.reasoningEffort)
    task.archivedAt = typeof row.archivedAt === 'number' && Number.isFinite(row.archivedAt) ? row.archivedAt : undefined
    task.permission = isTaskPermission(row.permission) ? row.permission as TaskPermission : undefined
    task.reuseSession = row.reuseSession === true ? true : undefined
    task.freeze = normalizeFreeze(row.freeze)
    task.handover = normalizeHandover(row.handover)
    // Tags are repaired field by field like the schedule: a malformed entry is
    // dropped, and a list that repairs to nothing clears the field instead of
    // dropping the task row.
    task.tags = normalizeTags(row.tags)
    task.permissionConfirmedAt = typeof row.permissionConfirmedAt === 'number' && Number.isFinite(row.permissionConfirmedAt) ? row.permissionConfirmedAt : undefined
    task.integrations = normalizeTaskIntegrations(row.integrations)
    // Attachments are repaired field by field like the tags: a malformed entry
    // is dropped, and a list that repairs to nothing clears the field instead
    // of dropping the task row.
    task.attachments = normalizeAttachments(row.attachments)
    task.hidden = row.hidden === true ? true : undefined
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
