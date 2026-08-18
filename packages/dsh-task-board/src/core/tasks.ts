/**
 * Task board domain model: task lifecycle statuses, the task record shape,
 * and the pure transition functions the controller and tests share.
 * Framework-free (no cordis, no runtime imports) so the state machine is
 * unit-testable in isolation.
 */

/** Task lifecycle status, one per kanban column. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

/**
 * One real execution attempt: the run's own id, the dsh session that ran it
 * (filled once the session is created), and the settled outcome once the
 * session's turn ended.
 */
export interface ExecutionRecord {
  /** Execution attempt id (uuid). */
  id: string
  /** The dsh session that ran this attempt; absent until creation resolves. */
  sessionId: string | undefined
  /** When the run started (ms epoch). */
  startedAt: number
  /** When the run settled; absent while still running. */
  endedAt: number | undefined
  /** Outcome once settled. */
  result: 'succeeded' | 'failed' | 'cancelled' | undefined
  /** Human failure text when the run failed (prompt rejection or agent error). */
  error: string | undefined
}

/**
 * A scheduled-run rule attached to a task. The Host scheduler triggers the
 * task when `nextRunAt` is due and persists the rule in the Host ledger.
 */
export interface ScheduleRule {
  /** Whether the schedule is armed. */
  enabled: boolean
  /** 5-field cron expression: `分 时 日 月 周`. */
  cron: string
  /** Next due instant (ms epoch); maintained by the scheduler/controller. */
  nextRunAt: number | undefined
  /** Instant of the latest scheduled trigger (ms epoch). */
  lastTriggeredAt: number | undefined
}

/** One task on the board. */
export interface TaskRecord {
  /** Stable task id (uuid). */
  id: string
  /** Short display title. */
  title: string
  /** Longer human description shown in the detail view. */
  description: string
  /** The prompt sent to dsh when this task is executed. */
  prompt: string
  /** Current column. */
  status: TaskStatus
  /** Creation instant (ms epoch). */
  createdAt: number
  /** Last mutation instant (ms epoch). */
  updatedAt: number
  /** Every execution attempt, most recent last. */
  executions: ExecutionRecord[]
  /** Optional scheduled-run rule (absent on tasks without a schedule). */
  schedule?: ScheduleRule
  /**
   * Workspace the execution must run in (a workspace-list id); absent means
   * the recent-workspace fallback at execution time.
   */
  workspaceId?: string
  /**
   * Agent preset the execution session must be composed from (an
   * `agentPreset.list` id); absent means the deployment default.
   */
  mode?: string
  /**
   * Permission preset applied to the execution session through the
   * `/permission <id>` slash command; absent leaves the session default.
   */
  permission?: TaskPermission
  /**
   * When the task was archived (ms epoch). Archived tasks keep their status
   * and execution history, leave the main board, and cannot run until restored;
   * absent means on-board.
   */
  archivedAt?: number
}

/** Statuses a settled task may be archived from. */
export const ARCHIVABLE_STATUSES: readonly TaskStatus[] = ['done', 'failed']


/** Permission presets a task may pin on its execution session (the `/permission <id>` ids). */
export const TASK_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const

/** One permission preset id. */
export type TaskPermission = typeof TASK_PERMISSIONS[number]

/** Whether an unknown value is a known permission preset id. */
export function isTaskPermission(value: unknown): value is TaskPermission {
  return typeof value === 'string' && (TASK_PERMISSIONS as readonly string[]).includes(value)
}

/** Input for creating a task. */
export interface NewTaskInput {
  title: string
  description: string
  prompt: string
  /** Workspace the execution must run in; empty/absent = the recent workspace. */
  workspaceId?: string
  /** Agent preset the execution session must be composed from; empty/absent = deployment default. */
  mode?: string
  /** Permission preset applied to the execution session; absent = session default. */
  permission?: TaskPermission
  /**
   * Optional scheduled-run rule requested at creation time (the new-task
   * dialog): an enable flag plus a 5-field cron expression. The create use
   * case arms it only when enabled and the expression is valid.
   */
  schedule?: { enabled: boolean; cron: string }
}

/** The five kanban columns, in display order. */
export const COLUMNS: readonly { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: '待规划' },
  { status: 'todo', label: '待办' },
  { status: 'running', label: '进行中' },
  { status: 'done', label: '已完成' },
  { status: 'failed', label: '已失败' },
]

/** Statuses a user may move a card to manually (execution states are owned by the runner). */
export const MANUAL_STATUSES: readonly TaskStatus[] = ['backlog', 'todo']

/** Statuses the runner may move a card to from 'running'. */
export const RUNNER_SETTLE_STATUSES: readonly TaskStatus[] = ['done', 'failed']

/** All valid statuses (closed union guard). */
export const ALL_STATUSES: readonly TaskStatus[] = [
  'backlog', 'todo', 'running', 'done', 'failed',
]

/** Brand an unknown string as a status; undefined when it is not one. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (ALL_STATUSES as readonly string[]).includes(value)
}

/** Whether a manual move target is allowed from the given status. */
export function canMoveManually(from: TaskStatus, to: TaskStatus): boolean {
  return from !== 'running' && (MANUAL_STATUSES as readonly TaskStatus[]).includes(to)
}

/** Normalize one optional execution-target string: trim; blank collapses to undefined. */
export function normalizeTargetId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** Create a task from user input. */
export function createTask(input: NewTaskInput, now: number, id: string): TaskRecord {
  return {
    id,
    title: input.title.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    status: 'todo',
    createdAt: now,
    updatedAt: now,
    executions: [],
    workspaceId: normalizeTargetId(input.workspaceId),
    mode: normalizeTargetId(input.mode),
    permission: isTaskPermission(input.permission) ? input.permission : undefined,
  }
}

/** Clone a task with an updated status and a fresh updatedAt. */
export function withStatus(task: TaskRecord, status: TaskStatus, now: number): TaskRecord {
  return { ...task, status, updatedAt: now }
}

/**
 * Merge a schedule patch into a task's schedule rule (creating it when
 * absent), with a fresh updatedAt. Keys present in the patch overwrite the
 * current value — including explicit `undefined`, which clears a field (used
 * to disarm `nextRunAt`); absent keys keep their current value.
 */
export function withSchedule(
  task: TaskRecord,
  patch: Partial<ScheduleRule>,
  now: number,
): TaskRecord {
  const current = task.schedule
  const schedule: ScheduleRule = {
    enabled: current?.enabled ?? false,
    cron: current?.cron ?? '',
    nextRunAt: current?.nextRunAt,
    lastTriggeredAt: current?.lastTriggeredAt,
  }
  if ('enabled' in patch) schedule.enabled = patch.enabled ?? false
  if ('cron' in patch) schedule.cron = patch.cron ?? ''
  if ('nextRunAt' in patch) schedule.nextRunAt = patch.nextRunAt
  if ('lastTriggeredAt' in patch) schedule.lastTriggeredAt = patch.lastTriggeredAt
  return { ...task, updatedAt: now, schedule }
}

/**
 * Open a fresh execution on a task: move it to 'running' and append a
 * running execution record. Returns the new task and the new execution.
 */
export function startExecution(
  task: TaskRecord,
  now: number,
  executionId: string,
): { task: TaskRecord; execution: ExecutionRecord } {
  const execution: ExecutionRecord = {
    id: executionId,
    sessionId: undefined,
    startedAt: now,
    endedAt: undefined,
    result: undefined,
    error: undefined,
  }
  return {
    task: { ...task, status: 'running', updatedAt: now, executions: [...task.executions, execution] },
    execution,
  }
}

/**
 * Settle a running execution: record the outcome and move the task into the
 * matching column. No-op (returns the input task) when the execution is not
 * the task's latest or is already settled.
 */
export function settleExecution(
  task: TaskRecord,
  executionId: string,
  outcome: 'succeeded' | 'failed' | 'cancelled',
  now: number,
  error: string | undefined,
): TaskRecord {
  const index = task.executions.findIndex(execution => execution.id === executionId)
  if (index === -1) return task
  const execution = task.executions[index]
  if (execution.endedAt !== undefined) return task
  const settled: ExecutionRecord = { ...execution, endedAt: now, result: outcome, error }
  const executions = [...task.executions]
  executions[index] = settled
  const status: TaskStatus = outcome === 'succeeded' ? 'done'
    : outcome === 'failed' ? 'failed'
      : task.status === 'running' ? 'todo' : task.status
  return { ...task, status, updatedAt: now, executions }
}

/** A settled-execution summary string for the detail view. */
export function executionLabel(execution: ExecutionRecord): string {
  if (execution.result === 'succeeded') return 'succeeded'
  if (execution.result === 'failed') return 'failed'
  if (execution.result === 'cancelled') return 'cancelled'
  return 'running'
}
