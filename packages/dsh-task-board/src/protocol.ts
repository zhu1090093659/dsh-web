import type { TaskUpdatePatch } from './core/use-cases/task-update.ts'
import { isTaskPermission, isTaskStatus, type NewTaskInput, type TaskPermission, type TaskRecord, type TaskStatus } from './core/tasks.ts'
import { parseLedger } from './core/store.ts'
import { sanitizeFreezeSnapshot, type FreezeSnapshot } from './core/freeze-snapshot.ts'
import { sanitizeHandover, type TaskHandoverInput } from './core/handover.ts'

/** Freeze payload carried by create/update actions after the gate (redacted in place). */
type FreezePayload = FreezeSnapshot & { redacted?: boolean; frozenBy?: string }

export const TASK_BOARD_SCHEMA_VERSION = 3 as const
/** Ledger documents written before v3; loaded once and migrated on startup. */
export const TASK_BOARD_LEGACY_SCHEMA_VERSION = 2 as const
export const TASK_BOARD_API_PREFIX = '/api/task-board'

export type PowerPhase = 'disabled' | 'idle' | 'acquiring' | 'active' | 'error' | 'unsupported'

export interface TaskBoardPowerSnapshot {
  platform: string
  phase: PowerPhase
  enabled: boolean
  runningSessions: number
  armedSchedules: number
  sessionStateKnown: boolean
  lastError?: string
}

export interface TaskBoardSchedulerSnapshot {
  timeZone: string
  /** Opaque identity of the current Host ledger generation. */
  ledgerId?: string
  lastTickAt?: number
  error?: string
}

export interface TaskBoardSnapshot {
  schemaVersion: typeof TASK_BOARD_SCHEMA_VERSION
  revision: number
  tasks: TaskRecord[]
  scheduler: TaskBoardSchedulerSnapshot
  power: TaskBoardPowerSnapshot
  /** Session-default permission the confirmation gate compares against. */
  sessionDefaultPermission?: TaskPermission
}

/** SSE event frame: revision/scheduler/power only, never the task list. */
export interface TaskBoardEventPayload {
  revision: number
  scheduler: TaskBoardSchedulerSnapshot
  power: TaskBoardPowerSnapshot
}

export type TaskBoardAction =
  | { kind: 'import'; sourceId: string; tasks: TaskRecord[] }
  | { kind: 'create'; id: string; input: NewTaskInput }
  | { kind: 'update'; taskId: string; patch: TaskUpdatePatch }
  | { kind: 'delete'; taskId: string }
  | { kind: 'move'; taskId: string; status: TaskStatus }
  | { kind: 'archive'; taskId: string }
  | { kind: 'restore'; taskId: string }
  | { kind: 'set-schedule'; taskId: string; patch: { enabled?: boolean; cron?: string } }
  | { kind: 'run'; taskId: string }
  | { kind: 'rerun'; taskId: string }
  | { kind: 'confirm-permission'; taskId: string }

export interface TaskBoardActionEnvelope {
  requestId: string
  action: TaskBoardAction
  /**
   * Session id of the DSH session issuing the action, for the execution audit
   * trail (issue #6). Client-asserted, not a trust boundary; parsed only as a
   * bounded non-empty string and recorded on opened executions / freeze stamps.
   */
  initiator?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

const FORBIDDEN_IMPORT_FIELDS = new Set(['args', 'command', 'executable', 'powershell', 'shell'])

function hasForbiddenImportField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenImportField)
  const row = record(value)
  if (row === undefined) return false
  return Object.entries(row).some(([key, nested]) => FORBIDDEN_IMPORT_FIELDS.has(key.toLowerCase()) || hasForbiddenImportField(nested))
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function validImportedKnownFields(value: Record<string, unknown>): boolean {
  if (value.schedule !== undefined) {
    const schedule = record(value.schedule)
    if (schedule === undefined || typeof schedule.enabled !== 'boolean' || typeof schedule.cron !== 'string') return false
    if (!optionalFiniteNumber(schedule.nextRunAt) || !optionalFiniteNumber(schedule.lastTriggeredAt)) return false
  }
  if (value.executions !== undefined) {
    if (!Array.isArray(value.executions)) return false
    for (const item of value.executions) {
      const execution = record(item)
      if (execution === undefined || typeof execution.id !== 'string' || !optionalString(execution.sessionId)) return false
      if (typeof execution.startedAt !== 'number' || !Number.isFinite(execution.startedAt)) return false
      if (!optionalFiniteNumber(execution.endedAt) || !optionalString(execution.error)) return false
      if (execution.result !== undefined && !['succeeded', 'failed', 'cancelled'].includes(String(execution.result))) return false
      if (execution.initiatedBy !== undefined && typeof execution.initiatedBy !== 'string') return false
      if (execution.frozenBy !== undefined && typeof execution.frozenBy !== 'string') return false
      if (execution.frozenAt !== undefined && typeof execution.frozenAt !== 'number') return false
    }
  }
  return true
}

function importedTask(value: unknown): TaskRecord | undefined {
  const input = record(value)
  if (input === undefined || hasForbiddenImportField(input) || !validImportedKnownFields(input)) return undefined
  const task = parseLedger(JSON.stringify([value]))[0]
  if (task === undefined) return undefined
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    prompt: task.prompt,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    executions: task.executions.map(execution => ({
      id: execution.id,
      sessionId: execution.sessionId,
      startedAt: execution.startedAt,
      endedAt: execution.endedAt,
      result: execution.result,
      error: execution.error,
      ...(execution.initiatedBy === undefined ? {} : { initiatedBy: execution.initiatedBy }),
      ...(execution.frozenAt === undefined ? {} : { frozenAt: execution.frozenAt }),
      ...(execution.frozenBy === undefined ? {} : { frozenBy: execution.frozenBy }),
    })),
    ...(task.schedule === undefined ? {} : {
      schedule: {
        enabled: task.schedule.enabled,
        cron: task.schedule.cron,
        nextRunAt: task.schedule.nextRunAt,
        lastTriggeredAt: task.schedule.lastTriggeredAt,
      },
    }),
    ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
    ...(task.mode === undefined ? {} : { mode: task.mode }),
    ...(task.permission === undefined ? {} : { permission: task.permission }),
    ...(task.archivedAt === undefined ? {} : { archivedAt: task.archivedAt }),
    ...(task.freeze === undefined ? {} : { freeze: task.freeze }),
    ...(task.handover === undefined ? {} : { handover: task.handover }),
    // 安全门（对抗场景 b）：import 不是人工确认动作，确认戳一律剥除——
    // 高于会话默认权限的绑定经 import 进入后必须重新武装 confirm-permission 门。
  }
}

/**
 * Gate a freeze payload from the wire: same T2 security gates as the parser
 * (slash-command taint rejects, sensitive patterns redact in place, 8 KiB
 * per-field cap). Returns the sanitized payload, or undefined when rejected.
 */
function freezePayload(value: unknown): FreezePayload | undefined {
  const result = sanitizeFreezeSnapshot(value, ['redacted', 'frozenBy'])
  if (!result.ok) return undefined
  const frozenBy = result.extras.frozenBy
  if (frozenBy !== undefined && (typeof frozenBy !== 'string' || frozenBy === '')) return undefined
  return {
    ...result.snapshot,
    ...(result.redacted || result.extras.redacted === true ? { redacted: true } : {}),
    ...(frozenBy === undefined ? {} : { frozenBy }),
  }
}

/**
 * Gate a handover bundle from the wire: exact keys, bounded string targets,
 * a known permission, and a bounded references list. Returns the sanitized
 * bundle, or undefined when rejected.
 */
function handoverPayload(value: unknown): TaskHandoverInput | undefined {
  return sanitizeHandover(value)
}

function createInput(value: unknown): value is NewTaskInput {
  const input = record(value)
  if (input === undefined || !exactKeys(input, ['title', 'description', 'prompt', 'workspaceId', 'mode', 'permission', 'schedule', 'freeze', 'handover'])) return false
  if (typeof input.title !== 'string' || typeof input.description !== 'string' || typeof input.prompt !== 'string') return false
  if (!optionalString(input.workspaceId) || !optionalString(input.mode)) return false
  if (input.permission !== undefined && !isTaskPermission(input.permission)) return false
  if (input.freeze !== undefined && freezePayload(input.freeze) === undefined) return false
  if (input.handover !== undefined && handoverPayload(input.handover) === undefined) return false
  if (input.schedule !== undefined) {
    const schedule = record(input.schedule)
    if (schedule === undefined || !exactKeys(schedule, ['enabled', 'cron'])) return false
    if (typeof schedule.enabled !== 'boolean' || typeof schedule.cron !== 'string') return false
  }
  return true
}

function updatePatch(value: unknown): boolean {
  const patch = record(value)
  if (patch === undefined || !exactKeys(patch, ['title', 'description', 'prompt', 'workspaceId', 'mode', 'permission', 'freeze', 'handover'])) return false
  for (const key of ['title', 'description', 'prompt', 'workspaceId', 'mode'] as const) {
    if (!optionalString(patch[key])) return false
  }
  if (patch.permission !== undefined && !isTaskPermission(patch.permission)) return false
  // null clears the snapshot; an object must pass the freeze gate.
  if (patch.freeze !== undefined && patch.freeze !== null && freezePayload(patch.freeze) === undefined) return false
  // Same convention for the handover bundle.
  return patch.handover === undefined || patch.handover === null || handoverPayload(patch.handover) !== undefined
}

function schedulePatch(value: unknown): boolean {
  const patch = record(value)
  return patch !== undefined
    && exactKeys(patch, ['enabled', 'cron'])
    && (patch.enabled === undefined || typeof patch.enabled === 'boolean')
    && (patch.cron === undefined || typeof patch.cron === 'string')
}

export function parseActionEnvelope(value: unknown): TaskBoardActionEnvelope | undefined {
  const parsed = parseEnvelopeAction(value)
  if (parsed === undefined) return undefined
  // Attach the audit-only initiator stamp (already validated above) to every accepted action.
  const initiator = initiatorOf(value)
  return initiator === undefined ? parsed : { ...parsed, initiator }
}

function initiatorOf(value: unknown): string | undefined {
  const envelope = record(value)
  const id = envelope?.initiator
  return typeof id === 'string' && id.trim() !== '' && id.length <= 256 ? id : undefined
}

function parseEnvelopeAction(value: unknown): TaskBoardActionEnvelope | undefined {
  const envelope = record(value)
  if (envelope === undefined || !exactKeys(envelope, ['requestId', 'action', 'initiator'])) return undefined
  if (typeof envelope.requestId !== 'string' || envelope.requestId.trim() === '' || envelope.requestId.length > 256) return undefined
  if (envelope.initiator !== undefined && initiatorOf(value) === undefined) return undefined
  const action = record(envelope.action)
  if (action === undefined || typeof action.kind !== 'string') return undefined
  const taskId = typeof action.taskId === 'string' && action.taskId !== '' ? action.taskId : undefined
  switch (action.kind) {
    case 'import':
      if (!exactKeys(action, ['kind', 'sourceId', 'tasks'])) return undefined
      if (typeof action.sourceId !== 'string' || action.sourceId === '' || !Array.isArray(action.tasks)) return undefined
      {
        const tasks = action.tasks.map(importedTask)
        return tasks.every((task): task is TaskRecord => task !== undefined)
          ? { requestId: envelope.requestId, action: { kind: 'import', sourceId: action.sourceId, tasks } }
          : undefined
      }
    case 'create': {
      if (!exactKeys(action, ['kind', 'id', 'input'])) return undefined
      if (typeof action.id !== 'string' || action.id === '' || !createInput(action.input)) return undefined
      const input = action.input as NewTaskInput
      const freeze = input.freeze === undefined ? undefined : freezePayload(input.freeze)
      const handover = input.handover === undefined ? undefined : handoverPayload(input.handover)
      const sanitized = freeze === undefined && handover === undefined ? input : { ...input, ...(freeze === undefined ? {} : { freeze }), ...(handover === undefined ? {} : { handover }) }
      return { requestId: envelope.requestId, action: { kind: 'create', id: action.id as string, input: sanitized } }
    }
    case 'update': {
      if (!exactKeys(action, ['kind', 'taskId', 'patch'])) return undefined
      if (taskId === undefined || !updatePatch(action.patch)) return undefined
      const patch = action.patch as TaskUpdatePatch
      const freeze = patch.freeze === undefined || patch.freeze === null ? patch.freeze : freezePayload(patch.freeze)
      const handover = patch.handover === undefined || patch.handover === null ? patch.handover : handoverPayload(patch.handover)
      const sanitized = ('freeze' in patch && freeze !== patch.freeze) || ('handover' in patch && handover !== patch.handover)
        ? { ...patch, ...(freeze === patch.freeze ? {} : { freeze }), ...(handover === patch.handover ? {} : { handover }) }
        : patch
      return { requestId: envelope.requestId, action: { kind: 'update', taskId, patch: sanitized } }
    }
    case 'set-schedule':
      if (!exactKeys(action, ['kind', 'taskId', 'patch'])) return undefined
      return taskId !== undefined && schedulePatch(action.patch)
        ? { requestId: envelope.requestId, action: action as unknown as Extract<TaskBoardAction, { kind: 'set-schedule' }> }
        : undefined
    case 'move':
      if (!exactKeys(action, ['kind', 'taskId', 'status'])) return undefined
      return taskId !== undefined && isTaskStatus(action.status)
        ? { requestId: envelope.requestId, action: action as unknown as Extract<TaskBoardAction, { kind: 'move' }> }
        : undefined
    case 'confirm-permission':
    case 'delete':
    case 'archive':
    case 'restore':
    case 'run':
    case 'rerun':
      if (!exactKeys(action, ['kind', 'taskId'])) return undefined
      return taskId === undefined ? undefined : { requestId: envelope.requestId, action: action as TaskBoardAction }
    default:
      return undefined
  }
}
