/**
 * Agent tools for the task board: the DSH-native counterpart of the board UI.
 *
 * Every tool drives the same Host ledger the browser drives, so a task created
 * in the GUI is immediately operable from any session and vice versa. Domain
 * refusals come back as ok:false values the model can react to; the Host
 * ledger stays the only authority, so every gate the UI honors still holds
 * here (fail-closed pins, the permission confirmation gate, the subtask depth
 * limit, the running-task locks).
 *
 * Deliberately absent: confirm-permission. That gate exists so a HUMAN lifts an
 * above-default permission binding; a tool that could stamp it would make the
 * gate decorative. An agent that hits it must ask the user to confirm in the
 * board UI.
 *
 * @module dsh-task-board/host/agent-tools
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DEFAULT_SESSION_PERMISSION, requiresPermissionConfirmation } from '../core/handover.ts'
import { DEFAULT_SUBTASK_DEPTH, directSubtasks, taskDepth } from '../core/subtask.ts'
import {
  TASK_PERMISSIONS,
  type ExecutionRecord,
  type NewTaskInput,
  type ScheduleMode,
  type ScheduleRule,
  type TaskPermission,
  type TaskRecord,
  type TaskTag,
} from '../core/tasks.ts'
import type { SetSchedulePatch } from '../core/use-cases/task-schedule.ts'
import type { TaskUpdatePatch } from '../core/use-cases/task-update.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from '../protocol.ts'

/**
 * The narrow Host face the tools need. TaskBoardHostService satisfies it
 * structurally, so tests and a future host can drive the same surface.
 */
export interface TaskBoardToolHost {
  /** Current board snapshot (tasks + scheduler + power + deployment constants). */
  snapshot(): TaskBoardSnapshot
  /** Submit one confirmed Host action; returns the resulting snapshot. */
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot>
}

/** Registered tool names, in registration order. */
export const TASK_BOARD_TOOL_NAMES = [
  'task_board_list',
  'task_board_get',
  'task_board_create',
  'task_board_update',
  'task_board_set_parent',
  'task_board_run',
  'task_board_manage',
  'task_board_schedule',
] as const

/** Unconstrained JSON value the tools return (their output schema is the JSON node). */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

/** Model-facing JSON rendering shared by every tool. */
function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

/** Mark an already JSON-safe projection as the tool's canonical value. */
function json(value: unknown): Json {
  return value as Json
}

/** A domain refusal the model is expected to read and act on. */
function refused(code: string, message: string): Json {
  return json({ ok: false, code, message })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function has(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * The calling session id, for the execution audit trail (the same stamp the
 * browser asserts). Absent when a call has no agent behind it.
 */
export function callingSessionId(exec: { agent?: unknown }): string | undefined {
  const agent = exec.agent as { session?: { id?: unknown; header?: { id?: unknown } } } | undefined
  const id = agent?.session?.id ?? agent?.session?.header?.id
  return typeof id === 'string' && id !== '' ? id : undefined
}

function scheduleView(schedule: ScheduleRule): Record<string, unknown> {
  return {
    enabled: schedule.enabled,
    mode: schedule.mode,
    // A one-shot has no cron, and carries its planned instant instead.
    ...(schedule.cron === undefined ? {} : { cron: schedule.cron }),
    ...(schedule.at === undefined ? {} : { at: schedule.at }),
    // Absent means the rule follows the Host zone, which the board view reports.
    ...(schedule.timeZone === undefined ? {} : { timeZone: schedule.timeZone }),
    ...(schedule.nextRunAt === undefined ? {} : { nextRunAt: schedule.nextRunAt }),
    ...(schedule.lastTriggeredAt === undefined ? {} : { lastTriggeredAt: schedule.lastTriggeredAt }),
    // The run budget: what the scheduler has already opened, its cap (absent =
    // unlimited), and how the rule stopped or what it last skipped.
    runCount: schedule.runCount,
    ...(schedule.maxRuns === undefined ? {} : { maxRuns: schedule.maxRuns }),
    ...(schedule.endedAt === undefined ? {} : { endedAt: schedule.endedAt }),
    ...(schedule.endedReason === undefined ? {} : { endedReason: schedule.endedReason }),
    ...(schedule.skippedAt === undefined ? {} : { skippedAt: schedule.skippedAt }),
    ...(schedule.skippedReason === undefined ? {} : { skippedReason: schedule.skippedReason }),
  }
}

function tagView(tag: TaskTag): Record<string, unknown> {
  return { name: tag.name, ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }) }
}

function executionView(execution: ExecutionRecord): Record<string, unknown> {
  return {
    id: execution.id,
    ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
    startedAt: execution.startedAt,
    ...(execution.endedAt === undefined ? {} : { endedAt: execution.endedAt }),
    ...(execution.result === undefined ? {} : { result: execution.result }),
    ...(execution.error === undefined ? {} : { error: execution.error }),
    // The session that asked for the run (audit only; client-asserted by the
    // browser, the calling session here). On an external record it names the
    // outside agent instead, which is what distinguishes it in the history.
    ...(execution.initiatedBy === undefined ? {} : { initiatedBy: execution.initiatedBy }),
    // Set only by record-external-outcome: the Host observed no session for it.
    ...(execution.external === true ? { external: true } : {}),
    // Every Host run joins a run group (single-member for a new run, and
    // multi-member for a group the ledger stored before it stopped spreading one
    // run across a subtree); the field keeps its historical name.
    ...(execution.runGroupId === undefined ? {} : { cascade: true }),
    // A parent of a stored group has settled its own turn but still waits for
    // its members; that is not a stuck card and the model must not retry it.
    ...(execution.ownResult === undefined
      ? {}
      : { ownResult: execution.ownResult, awaitingSubtasks: execution.endedAt === undefined }),
  }
}

/**
 * One compact task row for the model: identity, column, lineage, execution
 * targets, schedule, and the latest run. The prompt body rides only
 * task_board_get, so a fifty-task list stays readable.
 */
function taskSummary(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  sessionDefault: TaskPermission | undefined,
): Record<string, unknown> {
  const latest = task.executions.at(-1)
  const subtaskCount = directSubtasks(tasks, task.id).length
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    description: task.description,
    ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    ...(subtaskCount === 0 ? {} : { subtaskCount }),
    ...(task.archivedAt === undefined ? {} : { archivedAt: task.archivedAt }),
    ...(task.tags === undefined ? {} : { tags: task.tags.map(tagView) }),
    ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
    ...(task.mode === undefined ? {} : { mode: task.mode }),
    ...(task.permission === undefined ? {} : { permission: task.permission }),
    ...(task.model === undefined ? {} : { model: task.model }),
    ...(task.reasoningEffort === undefined ? {} : { reasoningEffort: task.reasoningEffort }),
    ...(task.reuseSession === true ? { reuseSession: true } : {}),
    ...(task.teamRun === true ? { teamRun: true } : {}),
    ...(task.schedule === undefined ? {} : { schedule: scheduleView(task.schedule) }),
    ...(task.freeze === undefined ? {} : { continuationCard: true }),
    ...(task.permissionConfirmedAt === undefined ? {} : { permissionConfirmedAt: task.permissionConfirmedAt }),
    // Whether this card may run at all: an elevated binding still needs a
    // human confirmation, and only a human can give it.
    ...(requiresPermissionConfirmation(task, sessionDefault ?? DEFAULT_SESSION_PERMISSION)
      ? { permissionPending: true }
      : {}),
    executionCount: task.executions.length,
    ...(latest === undefined ? {} : { latestExecution: executionView(latest) }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

/** One task's full detail: content, lineage, schedule, and recent runs. */
function taskDetail(
  task: TaskRecord,
  tasks: readonly TaskRecord[],
  sessionDefault: TaskPermission | undefined,
): Record<string, unknown> {
  const parent = task.parentId === undefined ? undefined : tasks.find(item => item.id === task.parentId)
  return {
    ...taskSummary(task, tasks, sessionDefault),
    prompt: task.prompt,
    depth: taskDepth(tasks, task.id),
    ...(parent === undefined ? {} : { parent: { id: parent.id, title: parent.title, status: parent.status } }),
    ...(task.freeze === undefined
      ? {}
      : {
        freeze: {
          goal: task.freeze.goal,
          progress: task.freeze.progress,
          next: task.freeze.next,
          frozenAt: task.freeze.frozenAt,
          ...(task.freeze.frozenBy === undefined ? {} : { frozenBy: task.freeze.frozenBy }),
          ...(task.freeze.redacted === true ? { redacted: true } : {}),
        },
      }),
    ...(task.handover === undefined
      ? {}
      : {
        handover: {
          ...(task.handover.workspaceId === undefined ? {} : { workspaceId: task.handover.workspaceId }),
          ...(task.handover.mode === undefined ? {} : { mode: task.handover.mode }),
          ...(task.handover.permission === undefined ? {} : { permission: task.handover.permission }),
          references: task.handover.references,
          bundledAt: task.handover.bundledAt,
        },
      }),
    subtasks: directSubtasks(tasks, task.id).map(child => taskSummary(child, tasks, sessionDefault)),
    executions: task.executions.slice(-10).map(executionView),
  }
}

/** The executions a run opened: everything that was not in the ledger before. */
function openedExecutions(before: readonly ExecutionRecord[], after: readonly ExecutionRecord[]): ExecutionRecord[] {
  const known = new Set(before.map(execution => execution.id))
  return after.filter(execution => !known.has(execution.id))
}

/** Board summary attached to task_board_list. */
function boardView(snapshot: TaskBoardSnapshot, maxSubtaskDepth: number): Record<string, unknown> {
  const counts = { backlog: 0, todo: 0, running: 0, done: 0, failed: 0, archived: 0 }
  for (const task of snapshot.tasks) {
    if (task.archivedAt !== undefined) counts.archived += 1
    else counts[task.status] += 1
  }
  return {
    revision: snapshot.revision,
    timeZone: snapshot.scheduler.timeZone,
    ...(snapshot.scheduler.error === undefined ? {} : { schedulerError: snapshot.scheduler.error }),
    maxSubtaskDepth,
    sessionDefaultPermission: snapshot.sessionDefaultPermission ?? DEFAULT_SESSION_PERMISSION,
    runningSessions: snapshot.power.runningSessions,
    armedSchedules: snapshot.power.armedSchedules,
    counts,
  }
}

/**
 * Build every task-board tool bound to one Host service.
 * @param host - the Host ledger/service face (TaskBoardHostService).
 * @returns the tool definitions, in TASK_BOARD_TOOL_NAMES order.
 */
export function buildTaskBoardTools(host: TaskBoardToolHost): ToolDefinition[] {
  return [
    buildListTool(host),
    buildGetTool(host),
    buildCreateTool(host),
    buildUpdateTool(host),
    buildSetParentTool(host),
    buildRunTool(host),
    buildManageTool(host),
    buildScheduleTool(host),
  ]
}

function buildSetParentTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_set_parent',
    description: [
      'Attach an existing task under a parent (making it a subtask) or detach it back to the root board by setting its parentId.',
      'Pass an empty parentId to detach.',
      'The Host refuses the link when the parent is unknown or archived, when the moved task is one of its own descendants, when the resulting depth exceeds the deployment subtask limit (default one level, maximum three), or while the task has an unsettled execution (its link may still be a stored run group parent pointer).',
      'Running a task opens one run group over its subtree concurrently and leaves a subtask that already sits in the done column alone; a parent card settles only after its own turn and every direct subtask it opened have settled.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task whose parent link changes.' },
      parentId: { type: 'string', required: true, description: 'Parent task id, or an empty string to detach the task back to the root board.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      try {
        const snapshot = await host.apply(
          crypto.randomUUID(),
          { kind: 'set-parent', taskId: args.taskId, parentId: args.parentId === '' ? null : args.parentId },
          callingSessionId(exec),
        )
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildRunTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_run',
    description: [
      'Run a task on the board now, or re-run a settled one.',
      'Running a card opens ONE session for that card: no session is opened for its subtasks, and the card agent dispatches them itself with subagent. A card whose subtasks are still unfinished runs under the liangshen agent preset and is told which cards to pick up.',
      'Clicking a subtask runs that subtask as its own root, again without opening anything for its descendants.',
      'A card whose effective permission is above the deployment session default is refused with confirmation-required until a HUMAN confirms the binding in the board UI; this tool cannot confirm it.',
      'Executions consume real API quota. Sessions are created asynchronously, so read their ids and outcomes back with task_board_get.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task to run; only this card gets a session, its unfinished subtasks are dispatched by that session own agent.' },
      rerun: { type: 'boolean', description: 'Re-run a settled task: reset its column to todo before starting (default false).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const before = host.snapshot()
      try {
        const snapshot = await host.apply(
          crypto.randomUUID(),
          { kind: args.rerun === true ? 'rerun' : 'run', taskId: args.taskId },
          callingSessionId(exec),
        )
        const beforeById = new Map(before.tasks.map(task => [task.id, task]))
        const started = snapshot.tasks.flatMap(task => {
          const previous = beforeById.get(task.id)?.executions ?? []
          return openedExecutions(previous, task.executions).map(execution => ({
            taskId: task.id,
            title: task.title,
            executionId: execution.id,
            ...(execution.sessionId === undefined ? {} : { sessionId: execution.sessionId }),
          }))
        })
        const root = snapshot.tasks.find(task => task.id === args.taskId)
        return json({
          ok: true,
          started,
          ...(root === undefined ? {} : { task: taskSummary(root, snapshot.tasks, snapshot.sessionDefaultPermission) }),
          note: 'Executions run asynchronously; call task_board_get to read session ids and the settled outcome.',
        })
      } catch (error) {
        const message = messageOf(error)
        return refused(message.startsWith('confirmation-required') ? 'confirmation-required' : 'refused', message)
      }
    },
  })
}

function buildManageTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_manage',
    description: [
      'Move, archive, restore, delete, or settle one task board card.',
      'move-backlog, move-todo, move-running, move-done and move-failed are the manual column moves and cover every column; a card the runner is executing (one with an open execution) cannot be moved.',
      'A manual move writes the card column only and never fabricates an execution record, so the card reports a declaration rather than evidence of a run: done/failed declare work finished (or failed) outside a Host-run execution — human work, an external system, a decision made elsewhere — and running says the work is under way without a tracked session. Use task_board_run when the work should actually run in a session here.',
      'record-external-outcome is the record-backed version of move-done and move-failed: use it when YOU, or another agent outside this Host, actually finished or failed the card with your own model, so the terminal column and the run history both derive from one execution record. It takes result (succeeded or failed) and initiatedBy (who completed it, for example your own agent name) plus an optional summary, and it is refused while the card still has an open execution: the Host stays the only authority over a run it is executing. It cannot record running or cancelled — those remain Host-only. A parent card that dispatched its subtasks uses it once, at the end, to backfill every subtask card with the conclusion it reached; the Host records an inherited verdict on a subtask the parent never wrote back, so the write-back is what keeps each subtask conclusion its own.',
      'settle force-closes the open execution of a card the board can no longer observe (a stuck running card) and records it cancelled with the caller as the reason, so the card returns to the todo column and can be run again.',
      'archive takes the whole subtask tree off the board and is refused while any member has an unsettled execution; restore brings the task, its ancestors and its subtree back; delete removes one card and is refused while it still has subtasks (detach or delete them first) or while it runs.',
      'It cannot confirm a permission binding: the confirmation gate is a human act performed in the board UI.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task to act on.' },
      action: {
        type: 'string',
        required: true,
        enum: ['move-todo', 'move-backlog', 'move-running', 'move-done', 'move-failed', 'archive', 'restore', 'delete', 'settle', 'record-external-outcome'],
        description: 'The lifecycle operation to perform.',
      },
      // Only record-external-outcome reads these two; every other action
      // ignores them, so the model can pass them without a second tool call.
      result: {
        type: 'string',
        enum: ['succeeded', 'failed'],
        description: 'record-external-outcome only: the verdict the outside agent actually reached.',
      },
      initiatedBy: {
        type: 'string',
        description: 'record-external-outcome only: who finished the work outside this Host (for example your own agent name).',
      },
      summary: {
        type: 'string',
        description: 'record-external-outcome only: optional free-text note stored with the recorded outcome.',
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const initiator = callingSessionId(exec)
      if (args.action === 'record-external-outcome') {
        const result = args.result
        const by = typeof args.initiatedBy === 'string' ? args.initiatedBy.trim() : ''
        if (result !== 'succeeded' && result !== 'failed') {
          return refused('missing-result', 'record-external-outcome needs result=succeeded or result=failed')
        }
        if (by === '') {
          return refused('missing-initiator', 'record-external-outcome needs initiatedBy naming who completed the work outside this Host')
        }
        if (!host.snapshot().tasks.some(task => task.id === args.taskId)) {
          return refused('task-not-found', 'no task with id ' + args.taskId)
        }
        try {
          const snapshot = await host.apply(crypto.randomUUID(), {
            kind: 'record-external-outcome',
            taskId: args.taskId,
            result,
            initiatedBy: by,
            ...(typeof args.summary === 'string' && args.summary.trim() !== '' ? { summary: args.summary } : {}),
          }, initiator)
          const task = snapshot.tasks.find(item => item.id === args.taskId)
          return json({
            ok: true,
            action: args.action,
            ...(task === undefined ? {} : { task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission) }),
            note: 'The outcome is recorded as its own execution, so the terminal column and the run history agree. Read it back with task_board_get.',
          })
        } catch (error) {
          return refused('refused', messageOf(error))
        }
      }
      const actions: Record<string, TaskBoardAction> = {
        'move-todo': { kind: 'move', taskId: args.taskId, status: 'todo' },
        'move-backlog': { kind: 'move', taskId: args.taskId, status: 'backlog' },
        'move-running': { kind: 'move', taskId: args.taskId, status: 'running' },
        'move-done': { kind: 'move', taskId: args.taskId, status: 'done' },
        'move-failed': { kind: 'move', taskId: args.taskId, status: 'failed' },
        archive: { kind: 'archive', taskId: args.taskId },
        settle: { kind: 'settle', taskId: args.taskId },
        restore: { kind: 'restore', taskId: args.taskId },
        delete: { kind: 'delete', taskId: args.taskId },
      }
      const action = actions[args.action]
      if (action === undefined) return refused('unknown-action', 'unsupported action ' + args.action)
      if (!host.snapshot().tasks.some(task => task.id === args.taskId)) {
        return refused('task-not-found', 'no task with id ' + args.taskId)
      }
      try {
        const snapshot = await host.apply(crypto.randomUUID(), action, initiator)
        if (args.action === 'delete') return json({ ok: true, action: args.action, taskId: args.taskId })
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, action: args.action, task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildScheduleTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_schedule',
    description: [
      'Arm, change, or disarm a task scheduled runs. Two kinds of plan exist: a recurring 5-field cron rule (day-of-month and day-of-week follow Vixie semantics: both restricted means OR, otherwise AND), and a one-shot that runs once at a future instant.',
      'For a one-shot pass mode "once" with at (the planned instant, ms since epoch UTC). For a recurring rule pass mode "cron" (or omit mode) with a cron expression, optionally capped by maxRuns (a positive whole number of scheduled executions; omit for unlimited, pass 0 to clear a cap).',
      'The wall clock is read in the rule stored IANA time zone; omit timeZone to use the Host zone reported by task_board_list/task_board_get. DST gaps are skipped and an ambiguous fall-back time fires once, at the earlier instant.',
      'A due scheduled task runs exactly what a manual run of that card does: one session for the card, never one per subtask.',
      'The scheduler counts executions it actually starts; once a rule reaches its run budget it stops itself in the ledger, and a manual run never consumes the budget. A schedule whose tree contains an unconfirmed above-default permission is refused and does not consume the budget; the reason is reported in the list board summary as schedulerError.',
      'Missed occurrences during Host downtime are skipped, never queued (a one-shot whose instant passed while the Host was down is stopped as missed); a task that is already running skips its occurrence without consuming the budget.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'The task whose schedule changes.' },
      enabled: { type: 'boolean', description: 'Arm (true) or disarm (false) the schedule.' },
      mode: { type: 'string', enum: ['cron', 'once'], description: 'The kind of plan: "cron" for a recurring rule, "once" for a single future instant. Omit to keep the stored kind.' },
      cron: { type: 'string', description: '5-field cron expression of a recurring rule: minute hour day-of-month month day-of-week.' },
      at: { type: 'integer', description: 'Planned instant of a one-shot, in milliseconds since the Unix epoch (UTC). Must be in the future.' },
      timeZone: {
        type: 'string',
        description: 'IANA zone the wall clock is read in (for example Asia/Shanghai). Omit to keep the stored zone, or pass an empty string to clear it back to the Host zone.',
      },
      maxRuns: { type: 'integer', description: 'Maximum scheduled executions of a recurring rule (positive whole number). Omit to keep the stored cap; pass 0 to clear it back to unlimited.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      if (args.enabled === undefined && args.mode === undefined && args.cron === undefined && args.at === undefined
        && args.timeZone === undefined && args.maxRuns === undefined) {
        return refused('nothing-to-change', 'pass enabled, mode, cron, at, timeZone and/or maxRuns')
      }
      // A missing card must read as a missing card: the ledger reports an
      // unknown id through the same refusal as a malformed cron.
      if (!host.snapshot().tasks.some(task => task.id === args.taskId)) {
        return refused('task-not-found', 'no task with id ' + args.taskId)
      }
      const patch: SetSchedulePatch = {
        ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
        ...(args.mode === undefined ? {} : { mode: args.mode as ScheduleMode }),
        ...(args.cron === undefined ? {} : { cron: args.cron }),
        ...(args.at === undefined ? {} : { at: args.at }),
        // An empty string is the documented way to clear the stored zone, so
        // the model never has to emit an explicit null through JSON args.
        ...(args.timeZone === undefined ? {} : { timeZone: args.timeZone === '' ? null : args.timeZone }),
        // 0 is the documented way to clear a run cap back to unlimited.
        ...(args.maxRuns === undefined ? {} : { maxRuns: args.maxRuns <= 0 ? null : args.maxRuns }),
      }
      try {
        const snapshot = await host.apply(crypto.randomUUID(), { kind: 'set-schedule', taskId: args.taskId, patch }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({
          ok: true,
          schedule: task.schedule === undefined ? null : scheduleView(task.schedule),
          task: taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission),
        })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}


function buildListTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_list',
    description: [
      'List tasks on the DSH task board (the Host-authoritative ledger behind the Web GUI task board).',
      'Filters: status column, parentId (direct subtasks), rootsOnly, tag, free-text query, and archived inclusion.',
      'Returns each task id, title, column, parent/subtask link, execution targets, schedule and latest run outcome, plus the board summary (revision, time zone, subtask depth limit, session-default permission).',
      'Use task_board_get for one task in full, task_board_create to add work, and task_board_run to execute it.',
    ].join(' '),
    parameters: {
      status: { type: 'string', enum: ['backlog', 'todo', 'running', 'done', 'failed'], description: 'Only cards in this column.' },
      parentId: { type: 'string', description: 'Only the direct subtasks of this task id.' },
      rootsOnly: { type: 'boolean', description: 'Only tasks that have no parent (default false).' },
      includeArchived: { type: 'boolean', description: 'Include archived tasks (default false).' },
      tag: { type: 'string', description: 'Only tasks carrying this label name.' },
      query: { type: 'string', description: 'Case-insensitive match against title, description, prompt, and label names.' },
      limit: { type: 'integer', description: 'Maximum rows to return (default 50, maximum 200).' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      const snapshot = host.snapshot()
      const needle = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const limit = Math.min(Math.max(typeof args.limit === 'number' ? Math.trunc(args.limit) : 50, 1), 200)
      const matched = snapshot.tasks.filter(task => {
        if (args.includeArchived !== true && task.archivedAt !== undefined) return false
        if (args.status !== undefined && task.status !== args.status) return false
        if (args.parentId !== undefined && task.parentId !== args.parentId) return false
        if (args.rootsOnly === true && task.parentId !== undefined) return false
        if (args.tag !== undefined && !(task.tags ?? []).some(tag => tag.name === args.tag)) return false
        if (needle !== '') {
          const haystack = [task.title, task.description, task.prompt, ...(task.tags ?? []).map(tag => tag.name)].join('\n').toLowerCase()
          if (!haystack.includes(needle)) return false
        }
        return true
      })
      return json({
        ok: true,
        board: boardView(snapshot, snapshot.maxSubtaskDepth ?? DEFAULT_SUBTASK_DEPTH),
        total: matched.length,
        count: Math.min(matched.length, limit),
        tasks: matched.slice(0, limit).map(task => taskSummary(task, snapshot.tasks, snapshot.sessionDefaultPermission)),
      })
    },
  })
}

function buildGetTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_get',
    description: [
      'Read one task board card in full: prompt, description, labels, column, parent link, direct subtasks, execution targets, schedule, permission gate state, and the last ten execution attempts with their session ids and outcomes.',
      'Use it before running or editing a card, after a run to read the settled outcome, and to read each subtask card before dispatching it with subagent.',
      'A card written before team runs were retired may still report teamRun: true; the field is history and never changes how the Host runs the card.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task id, as reported by task_board_list or task_board_create.' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    isConcurrencySafe: () => true,
    async execute(args) {
      const snapshot = host.snapshot()
      const task = snapshot.tasks.find(item => item.id === args.taskId)
      if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
      return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
    },
  })
}

function buildCreateTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_create',
    description: [
      'Create a task on the DSH task board, or a subtask by passing parentId.',
      'A subtask inherits every execution target it does not override (workspace, agent preset, permission, model, reasoning effort) from its parent, and inherits the parent human permission confirmation together with an inherited binding.',
      'The deployment caps subtask depth (default one level, maximum three): a subtask of a subtask is refused unless the board is configured deeper.',
      'The task lands in the todo column and does NOT run; call task_board_run to execute it.',
    ].join(' '),
    parameters: {
      title: { type: 'string', required: true, description: 'Short display title (one line).' },
      description: { type: 'string', description: 'Longer human description shown in the detail view.' },
      prompt: { type: 'string', description: 'The instruction sent to the execution agent; the title is used when blank.' },
      parentId: { type: 'string', description: 'Parent task id, making this a subtask. Omit for a root task.' },
      workspaceId: { type: 'string', description: 'Workspace id the execution must run in; omit to inherit the workspace this session is in (root task) or the parent value (subtask).' },
      mode: { type: 'string', description: 'Agent preset id the execution session is composed from; omit to adopt the board new-card default, and the deployment default when none is configured.' },
      permission: { type: 'string', enum: [...TASK_PERMISSIONS], description: 'Permission preset for the execution session; omit to adopt the board new-card default. An omitted permission is never taken from a parent: the launch resolves the parent binding instead. A value above the session default needs a human confirmation in the board UI before the card can run.' },
      model: { type: 'string', description: 'Pinned model as provider/model (or a model id); omit to adopt the board new-card default, and the host default when none is configured.' },
      reasoningEffort: { type: 'string', description: 'Reasoning effort id for that model (an adapter-owned level such as "high"); omit to adopt the board new-card default for that model, and the model own default when none applies. Only an effort the target model declares is sent; an empty string clears it back to the default.' },
      reuseSession: { type: 'boolean', description: 'Continue later runs in the previous execution session instead of a fresh conversation.' },
      tags: {
        type: 'array',
        description: 'Labels: the name renders as a badge and drives the board filter; promptPrefix is injected ahead of the execution prompt on every run.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Label name (unique within the task, at most 32 characters).' },
            promptPrefix: { type: 'string', description: 'Optional prompt line injected before the task prompt (at most 200 characters).' },
          },
        },
      },
      schedule: {
        type: 'object',
        additionalProperties: false,
        description: 'Arm a schedule at creation time. Use mode "once" with at for a single future run, or mode "cron" (or omit mode) with a 5-field cron expression, optionally capped by maxRuns.',
        properties: {
          enabled: { type: 'boolean', required: true, description: 'Whether the schedule is armed.' },
          mode: { type: 'string', enum: ['cron', 'once'], description: 'The kind of plan: "cron" for a recurring rule, "once" for a single future instant.' },
          cron: { type: 'string', description: '5-field cron of a recurring rule: minute hour day-of-month month day-of-week.' },
          at: { type: 'integer', description: 'Planned instant of a one-shot, in milliseconds since the Unix epoch (UTC). Must be in the future.' },
          maxRuns: { type: 'integer', description: 'Maximum scheduled executions of a recurring rule (positive whole number); omit for unlimited.' },
        },
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      if (args.title.trim() === '') return refused('title-required', 'title must not be blank')
      const id = crypto.randomUUID()
      const tags = (args.tags ?? []).map(tag => ({
        name: tag.name,
        ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }),
      }))
      const input: NewTaskInput = {
        title: args.title,
        description: args.description ?? '',
        prompt: args.prompt ?? '',
        ...(args.parentId === undefined || args.parentId === '' ? {} : { parentId: args.parentId }),
        ...(args.workspaceId === undefined || args.workspaceId === '' ? {} : { workspaceId: args.workspaceId }),
        ...(args.mode === undefined || args.mode === '' ? {} : { mode: args.mode }),
        ...(args.permission === undefined ? {} : { permission: args.permission }),
        ...(args.model === undefined || args.model === '' ? {} : { model: args.model }),
        ...(args.reasoningEffort === undefined || args.reasoningEffort === '' ? {} : { reasoningEffort: args.reasoningEffort }),
        // This tool creates cards on behalf of a deployment that configured its
        // new-card defaults once: an omitted target adopts them instead of
        // leaving the card to resolve the host default at run time. Only the
        // targets the caller omitted are filled.
        applyCardDefaults: true,
        ...(args.reuseSession === true ? { reuseSession: true } : {}),
        ...(tags.length === 0 ? {} : { tags }),
        ...(args.schedule === undefined ? {} : {
          schedule: {
            enabled: args.schedule.enabled,
            ...(args.schedule.mode === undefined ? {} : { mode: args.schedule.mode as ScheduleMode }),
            ...(args.schedule.cron === undefined ? {} : { cron: args.schedule.cron }),
            ...(args.schedule.at === undefined ? {} : { at: args.schedule.at }),
            ...(args.schedule.maxRuns === undefined ? {} : { maxRuns: args.schedule.maxRuns }),
          },
        }),
      }
      try {
        const snapshot = await host.apply(crypto.randomUUID(), { kind: 'create', id, input }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === id)
        if (task === undefined) return refused('create-failed', 'the Host did not confirm the new task')
        return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

function buildUpdateTool(host: TaskBoardToolHost): ToolDefinition {
  return defineTool({
    name: 'task_board_update',
    description: [
      'Edit a task board card: title, description, prompt, labels, and the execution targets (workspace, agent preset, permission, model, reasoning effort, session reuse).',
      'Only the fields you pass change; pass an empty string to clear a target, or an empty labels array to clear the labels.',
      'Title, description and prompt freeze once the task has started executing; the execution targets stay editable because they only affect future runs.',
      'Changing the pinned permission re-arms the permission confirmation gate.',
    ].join(' '),
    parameters: {
      taskId: { type: 'string', required: true, description: 'Task id to edit.' },
      title: { type: 'string', description: 'New title (a blank title is refused by the Host).' },
      description: { type: 'string', description: 'New description.' },
      prompt: { type: 'string', description: 'New execution prompt.' },
      workspaceId: { type: 'string', description: 'New workspace id; an empty string clears it.' },
      mode: { type: 'string', description: 'New agent preset id; an empty string clears it.' },
      // `enum` with a clearing value would advertise the empty string as a
      // legal member of the enum. Some OpenAI-compatible gateways forward the
      // tool schema to Gemini, which rejects an empty enum member outright
      // ("cannot be empty") and fails the whole request - not just this tool -
      // even for a plain greeting, because the schema ships with every call
      // (issue #1748). Splitting the clear value into its own `const` branch
      // keeps both the real enum intact and the wire representation valid for
      // those gateways.
      permission: {
        oneOf: [
          { type: 'string', enum: [...TASK_PERMISSIONS] },
          { type: 'string', const: '' },
        ],
        description: 'New permission preset; an empty string clears it back to the session default.',
      },
      model: { type: 'string', description: 'New pinned model; an empty string clears it.' },
      reasoningEffort: { type: 'string', description: 'New reasoning effort id for the pinned model; an empty string clears it back to the model own default. Only an effort the target model declares is sent at run time.' },
      reuseSession: { type: 'boolean', description: 'Continue later runs in the previous execution session.' },
      tags: {
        type: 'array',
        description: 'Replacement label set; an empty array clears all labels.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', required: true, description: 'Label name.' },
            promptPrefix: { type: 'string', description: 'Optional prompt line injected before the task prompt.' },
          },
        },
      },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args, exec) {
      const patch: TaskUpdatePatch = {}
      if (has(args, 'title') && typeof args.title === 'string') patch.title = args.title
      if (has(args, 'description') && typeof args.description === 'string') patch.description = args.description
      if (has(args, 'prompt') && typeof args.prompt === 'string') patch.prompt = args.prompt
      if (has(args, 'workspaceId') && typeof args.workspaceId === 'string') patch.workspaceId = args.workspaceId
      if (has(args, 'mode') && typeof args.mode === 'string') patch.mode = args.mode
      if (has(args, 'model') && typeof args.model === 'string') patch.model = args.model
      // An empty effort is the wire's clearing value (back to the model's own default).
      if (has(args, 'reasoningEffort') && typeof args.reasoningEffort === 'string') {
        patch.reasoningEffort = args.reasoningEffort
      }
      // An empty permission is the wire's clearing value (back to the session default).
      if (has(args, 'permission') && typeof args.permission === 'string') {
        patch.permission = args.permission === '' ? undefined : args.permission
      }
      if (has(args, 'reuseSession')) patch.reuseSession = args.reuseSession === true
      if (has(args, 'tags')) {
        const tags = args.tags ?? []
        patch.tags = tags.length === 0
          ? null
          : tags.map(tag => ({
            name: tag.name,
            ...(tag.promptPrefix === undefined ? {} : { promptPrefix: tag.promptPrefix }),
          }))
      }
      if (Object.keys(patch).length === 0) return refused('nothing-to-change', 'pass at least one field to update')
      try {
        const snapshot = await host.apply(crypto.randomUUID(), { kind: 'update', taskId: args.taskId, patch }, callingSessionId(exec))
        const task = snapshot.tasks.find(item => item.id === args.taskId)
        if (task === undefined) return refused('task-not-found', 'no task with id ' + args.taskId)
        return json({ ok: true, task: taskDetail(task, snapshot.tasks, snapshot.sessionDefaultPermission) })
      } catch (error) {
        return refused('refused', messageOf(error))
      }
    },
  })
}

