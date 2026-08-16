import type { TaskUpdatePatch } from './core/use-cases/task-update.ts'
import { isTaskPermission, isTaskStatus, type NewTaskInput, type TaskRecord, type TaskStatus } from './core/tasks.ts'
import { isTaskRecord } from './core/store.ts'

export const TASK_BOARD_SCHEMA_VERSION = 2 as const
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
  lastTickAt?: number
  error?: string
}

export interface TaskBoardSnapshot {
  schemaVersion: typeof TASK_BOARD_SCHEMA_VERSION
  revision: number
  tasks: TaskRecord[]
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

export interface TaskBoardActionEnvelope {
  requestId: string
  action: TaskBoardAction
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

function strictTask(value: unknown): value is TaskRecord {
  const task = record(value)
  if (task === undefined || !isTaskRecord(task)) return false
  if (!exactKeys(task, [
    'id', 'title', 'description', 'prompt', 'status', 'createdAt', 'updatedAt',
    'executions', 'schedule', 'workspaceId', 'mode', 'permission', 'archivedAt',
  ])) return false
  if (!task.executions.every(value => {
    const execution = record(value)
    return execution !== undefined && exactKeys(execution, ['id', 'sessionId', 'startedAt', 'endedAt', 'result', 'error'])
  })) return false
  if (task.schedule !== undefined) {
    const schedule = record(task.schedule)
    if (schedule === undefined || !exactKeys(schedule, ['enabled', 'cron', 'nextRunAt', 'lastTriggeredAt'])) return false
    if (typeof schedule.enabled !== 'boolean' || typeof schedule.cron !== 'string') return false
    if (schedule.nextRunAt !== undefined && (typeof schedule.nextRunAt !== 'number' || !Number.isFinite(schedule.nextRunAt))) return false
    if (schedule.lastTriggeredAt !== undefined && (typeof schedule.lastTriggeredAt !== 'number' || !Number.isFinite(schedule.lastTriggeredAt))) return false
  }
  return true
}

function createInput(value: unknown): value is NewTaskInput {
  const input = record(value)
  if (input === undefined || !exactKeys(input, ['title', 'description', 'prompt', 'workspaceId', 'mode', 'permission', 'schedule'])) return false
  if (typeof input.title !== 'string' || typeof input.description !== 'string' || typeof input.prompt !== 'string') return false
  if (!optionalString(input.workspaceId) || !optionalString(input.mode)) return false
  if (input.permission !== undefined && !isTaskPermission(input.permission)) return false
  if (input.schedule !== undefined) {
    const schedule = record(input.schedule)
    if (schedule === undefined || !exactKeys(schedule, ['enabled', 'cron'])) return false
    if (typeof schedule.enabled !== 'boolean' || typeof schedule.cron !== 'string') return false
  }
  return true
}

function updatePatch(value: unknown): boolean {
  const patch = record(value)
  if (patch === undefined || !exactKeys(patch, ['title', 'description', 'prompt', 'workspaceId', 'mode', 'permission'])) return false
  for (const key of ['title', 'description', 'prompt', 'workspaceId', 'mode'] as const) {
    if (!optionalString(patch[key])) return false
  }
  return patch.permission === undefined || isTaskPermission(patch.permission)
}

function schedulePatch(value: unknown): boolean {
  const patch = record(value)
  return patch !== undefined
    && exactKeys(patch, ['enabled', 'cron'])
    && (patch.enabled === undefined || typeof patch.enabled === 'boolean')
    && (patch.cron === undefined || typeof patch.cron === 'string')
}

export function parseActionEnvelope(value: unknown): TaskBoardActionEnvelope | undefined {
  const envelope = record(value)
  if (envelope === undefined || !exactKeys(envelope, ['requestId', 'action'])) return undefined
  if (typeof envelope.requestId !== 'string' || envelope.requestId.trim() === '') return undefined
  const action = record(envelope.action)
  if (action === undefined || typeof action.kind !== 'string') return undefined
  const taskId = typeof action.taskId === 'string' && action.taskId !== '' ? action.taskId : undefined
  switch (action.kind) {
    case 'import':
      if (!exactKeys(action, ['kind', 'sourceId', 'tasks'])) return undefined
      return typeof action.sourceId === 'string' && action.sourceId !== '' && Array.isArray(action.tasks) && action.tasks.every(strictTask)
        ? { requestId: envelope.requestId, action: action as unknown as Extract<TaskBoardAction, { kind: 'import' }> }
        : undefined
    case 'create':
      if (!exactKeys(action, ['kind', 'id', 'input'])) return undefined
      return typeof action.id === 'string' && action.id !== '' && createInput(action.input)
        ? { requestId: envelope.requestId, action: action as unknown as Extract<TaskBoardAction, { kind: 'create' }> }
        : undefined
    case 'update':
      if (!exactKeys(action, ['kind', 'taskId', 'patch'])) return undefined
      return taskId !== undefined && updatePatch(action.patch)
        ? { requestId: envelope.requestId, action: action as unknown as Extract<TaskBoardAction, { kind: 'update' }> }
        : undefined
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
