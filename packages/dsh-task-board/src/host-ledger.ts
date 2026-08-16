import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { nextRunAtMs } from './core/schedule.ts'
import { parseLedger } from './core/store.ts'
import { canMoveManually, settleExecution, startExecution, withStatus, type ExecutionRecord, type TaskRecord } from './core/tasks.ts'
import { applyArchiveTask, applyRestoreTask } from './core/use-cases/task-archive.ts'
import { applyCreateTask } from './core/use-cases/task-create.ts'
import { applyDeleteTask } from './core/use-cases/task-delete.ts'
import { applySetSchedule, applyScheduleNextRun } from './core/use-cases/task-schedule.ts'
import { applyUpdateTask } from './core/use-cases/task-update.ts'
import { TASK_BOARD_SCHEMA_VERSION, type TaskBoardAction, type TaskBoardSchedulerSnapshot } from './protocol.ts'

interface PersistedScheduler extends TaskBoardSchedulerSnapshot {
  importedSources?: string[]
}

interface LedgerDocument {
  schemaVersion: typeof TASK_BOARD_SCHEMA_VERSION
  revision: number
  tasks: TaskRecord[]
  scheduler: PersistedScheduler
}

export interface LedgerState {
  revision: number
  tasks: TaskRecord[]
  scheduler: TaskBoardSchedulerSnapshot
}

export interface OpenedRun {
  task: TaskRecord
  execution: ExecutionRecord
}

const MAX_REQUEST_CACHE = 256

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
}

function cloneTasks(tasks: readonly TaskRecord[]): TaskRecord[] {
  return JSON.parse(JSON.stringify(tasks)) as TaskRecord[]
}

function betterExecution(a: ExecutionRecord, b: ExecutionRecord): ExecutionRecord {
  if (a.endedAt === undefined && b.endedAt !== undefined) return b
  if (b.endedAt === undefined && a.endedAt !== undefined) return a
  return (b.endedAt ?? b.startedAt) >= (a.endedAt ?? a.startedAt) ? b : a
}

function mergeTask(a: TaskRecord, b: TaskRecord): TaskRecord {
  const newer = b.updatedAt >= a.updatedAt ? b : a
  const byId = new Map<string, ExecutionRecord>()
  for (const entry of [...a.executions, ...b.executions]) {
    const previous = byId.get(entry.id)
    byId.set(entry.id, previous === undefined ? entry : betterExecution(previous, entry))
  }
  return { ...newer, executions: [...byId.values()].sort((x, y) => x.startedAt - y.startedAt) }
}

function parseHostTasks(values: readonly unknown[], now: number): TaskRecord[] {
  const rawById = new Map<string, Record<string, unknown>>()
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue
    const raw = value as Record<string, unknown>
    if (typeof raw.id === 'string') rawById.set(raw.id, raw)
  }
  return parseLedger(JSON.stringify(values)).map(task => {
    const rawSchedule = rawById.get(task.id)?.schedule
    if (typeof rawSchedule !== 'object' || rawSchedule === null) return task
    const schedule = rawSchedule as Record<string, unknown>
    if (typeof schedule.cron !== 'string' || isValidSchedule(schedule.cron, now)) return task
    return {
      ...task,
      schedule: {
        enabled: false,
        cron: schedule.cron,
        nextRunAt: undefined,
        lastTriggeredAt: typeof schedule.lastTriggeredAt === 'number' && Number.isFinite(schedule.lastTriggeredAt)
          ? schedule.lastTriggeredAt
          : undefined,
      },
    }
  })
}

export class HostTaskLedger {
  private document: LedgerDocument
  private readonly listeners = new Set<() => void>()
  private readonly requestCache = new Map<string, LedgerState>()
  readonly file: string

  constructor(dir: string = join(dshHome(), 'task-board'), private readonly now: () => number = Date.now) {
    this.file = join(dir, 'ledger-v2.json')
    this.document = this.load(dir)
    this.repairSchedules(true)
    this.reconcileInterruptedStarts()
  }

  state(): LedgerState {
    const { importedSources: _imports, ...scheduler } = this.document.scheduler
    return { revision: this.document.revision, tasks: cloneTasks(this.document.tasks), scheduler: { ...scheduler } }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  applyRequest(requestId: string, action: TaskBoardAction): { state: LedgerState; run?: OpenedRun } {
    const cached = this.requestCache.get(requestId)
    if (cached !== undefined) return { state: cached }
    const result = this.apply(action)
    this.requestCache.set(requestId, result.state)
    while (this.requestCache.size > MAX_REQUEST_CACHE) this.requestCache.delete(this.requestCache.keys().next().value as string)
    return result
  }

  openScheduled(taskId: string, nextRunAt: number | undefined, triggeredAt: number): OpenedRun | undefined {
    const task = this.document.tasks.find(item => item.id === taskId)
    if (task === undefined) return undefined
    if (task.status === 'running') {
      this.document.tasks = [...applyScheduleNextRun(this.document.tasks, taskId, nextRunAt, task.schedule?.lastTriggeredAt, triggeredAt)]
      this.commit()
      return undefined
    }
    const opened = startExecution(task, triggeredAt, crypto.randomUUID())
    this.document.tasks = this.document.tasks.map(item => item.id === taskId ? opened.task : item)
    this.document.tasks = [...applyScheduleNextRun(this.document.tasks, taskId, nextRunAt, triggeredAt, triggeredAt)]
    this.commit()
    return opened
  }

  skipMissed(now: number): void {
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) return task
      changed = true
      return { ...task, schedule: { ...schedule, nextRunAt: nextRunAtMs(schedule.cron, now) }, updatedAt: now }
    })
    if (changed) this.commit()
  }

  setScheduler(patch: Partial<TaskBoardSchedulerSnapshot>): void {
    this.document.scheduler = { ...this.document.scheduler, ...patch }
    this.commit(false)
  }

  attachSession(taskId: string, executionId: string, sessionId: string): void {
    const now = this.now()
    this.document.tasks = this.document.tasks.map(task => task.id !== taskId ? task : {
      ...task,
      updatedAt: now,
      executions: task.executions.map(entry => entry.id === executionId ? { ...entry, sessionId } : entry),
    })
    this.commit()
  }

  settle(taskId: string, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', error?: string): void {
    this.document.tasks = this.document.tasks.map(task => task.id === taskId
      ? settleExecution(task, executionId, outcome, this.now(), error)
      : task)
    this.commit()
  }

  private apply(action: TaskBoardAction): { state: LedgerState; run?: OpenedRun } {
    const now = this.now()
    let run: OpenedRun | undefined
    switch (action.kind) {
      case 'import': {
        const sources = new Set(this.document.scheduler.importedSources ?? [])
        if (sources.has(action.sourceId)) return { state: this.state() }
        const invalidScheduleIds = action.tasks
          .filter(task => task.schedule !== undefined && !isValidSchedule(task.schedule.cron, now))
          .map(task => task.id)
        const incoming = parseHostTasks(action.tasks, now)
        const merged = new Map(this.document.tasks.map(task => [task.id, task]))
        for (const task of incoming) merged.set(task.id, merged.has(task.id) ? mergeTask(merged.get(task.id)!, task) : task)
        this.document.tasks = [...merged.values()]
        this.document.scheduler.importedSources = [...sources, action.sourceId]
        this.document.scheduler.error = invalidScheduleIds.length === 0
          ? undefined
          : `invalid cron disabled for task(s): ${invalidScheduleIds.join(', ')}`
        this.repairSchedules(true, false)
        this.reconcileInterruptedStarts(false)
        break
      }
      case 'create': {
        if (this.document.tasks.some(task => task.id === action.id)) throw new Error('task id already exists')
        if (action.input.schedule?.enabled === true && nextRunAtMs(action.input.schedule.cron, now) === undefined) {
          throw new Error('invalid schedule')
        }
        const result = applyCreateTask(this.document.tasks, action.input, now, action.id)
        if (result.task === undefined) throw new Error('invalid task')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'update':
        if (!this.document.tasks.some(task => task.id === action.taskId)) throw new Error('task not found')
        this.document.tasks = [...applyUpdateTask(this.document.tasks, action.taskId, action.patch, now)]
        break
      case 'delete':
        if (!this.document.tasks.some(task => task.id === action.taskId)) throw new Error('task not found')
        this.document.tasks = [...applyDeleteTask(this.document.tasks, undefined, action.taskId).tasks]
        break
      case 'move': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (!canMoveManually(task.status, action.status)) throw new Error('invalid manual status')
        this.document.tasks = this.document.tasks.map(item => item.id === action.taskId ? withStatus(item, action.status, now) : item)
        break
      }
      case 'archive': {
        const result = applyArchiveTask(this.document.tasks, action.taskId, now)
        if (!result.archived) throw new Error('task cannot be archived')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'restore': {
        const result = applyRestoreTask(this.document.tasks, action.taskId, now)
        if (!result.archived) throw new Error('task is not archived')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'set-schedule': {
        const result = applySetSchedule(this.document.tasks, action.taskId, action.patch, now)
        if (!result.applied) throw new Error('invalid schedule')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'rerun':
      case 'run': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined || task.status === 'running') throw new Error('task is already running or missing')
        const base = action.kind === 'rerun' ? withStatus(task, 'todo', now) : task
        run = startExecution(base, now, crypto.randomUUID())
        this.document.tasks = this.document.tasks.map(item => item.id === task.id ? run!.task : item)
        break
      }
    }
    this.commit()
    return { state: this.state(), ...(run === undefined ? {} : { run }) }
  }

  private repairSchedules(skipPast: boolean, persist = true): void {
    const now = this.now()
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled) return task
      if (!skipPast && schedule.nextRunAt !== undefined) return task
      const next = nextRunAtMs(schedule.cron, now)
      if (next === undefined) {
        changed = true
        this.document.scheduler.error = `invalid cron disabled for task: ${task.id}`
        return { ...task, schedule: { ...schedule, enabled: false, nextRunAt: undefined }, updatedAt: now }
      }
      if (schedule.nextRunAt === next) return task
      changed = true
      return { ...task, schedule: { ...schedule, nextRunAt: next }, updatedAt: now }
    })
    if (changed && persist) this.commit()
  }

  private reconcileInterruptedStarts(persist = true): void {
    const now = this.now()
    let changed = false
    this.document.tasks = this.document.tasks.map(task => {
      if (task.status !== 'running') return task
      const execution = task.executions.at(-1)
      if (execution === undefined || execution.endedAt !== undefined || execution.sessionId !== undefined) return task
      changed = true
      return settleExecution(task, execution.id, 'cancelled', now, 'host restarted before the execution session was recorded')
    })
    if (changed && persist) this.commit()
  }

  private load(dir: string): LedgerDocument {
    const existed = existsSync(this.file)
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<LedgerDocument>
      if (parsed.schemaVersion !== TASK_BOARD_SCHEMA_VERSION || !Array.isArray(parsed.tasks)) throw new Error('unsupported ledger schema')
      const tasks = parseHostTasks(parsed.tasks, this.now())
      const invalidScheduleIds = (parsed.tasks as unknown[]).flatMap(value => {
        if (typeof value !== 'object' || value === null) return []
        const row = value as { id?: unknown; schedule?: unknown }
        if (typeof row.schedule !== 'object' || row.schedule === null) return []
        const cron = (row.schedule as { cron?: unknown }).cron
        return typeof cron !== 'string' || !isValidSchedule(cron, this.now())
          ? [typeof row.id === 'string' ? row.id : 'unknown']
          : []
      })
      return {
        schemaVersion: TASK_BOARD_SCHEMA_VERSION,
        revision: Number.isInteger(parsed.revision) ? parsed.revision as number : 0,
        tasks,
        scheduler: {
          timeZone: timeZone(),
          ...(typeof parsed.scheduler?.lastTickAt === 'number' ? { lastTickAt: parsed.scheduler.lastTickAt } : {}),
          ...(typeof parsed.scheduler?.error === 'string' ? { error: parsed.scheduler.error } : {}),
          ...(invalidScheduleIds.length > 0 ? { error: `invalid cron disabled for task(s): ${invalidScheduleIds.join(', ')}` } : {}),
          ...(Array.isArray(parsed.scheduler?.importedSources) ? { importedSources: parsed.scheduler.importedSources.filter(x => typeof x === 'string') } : {}),
        },
      }
    } catch (error) {
      if (existed) renameSync(this.file, `${this.file}.corrupt-${this.now()}`)
      mkdirSync(dir, { recursive: true })
      return {
        schemaVersion: TASK_BOARD_SCHEMA_VERSION,
        revision: 0,
        tasks: [],
        scheduler: { timeZone: timeZone(), ...(existed ? { error: `corrupt ledger was quarantined: ${error instanceof Error ? error.message : String(error)}` } : {}) },
      }
    }
  }

  private commit(bumpRevision = true): void {
    if (bumpRevision) this.document.revision += 1
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(this.document, null, 2), { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch { /* Windows ACLs own access */ }
    renameSync(tmp, this.file)
    for (const listener of [...this.listeners]) listener()
  }
}

function isValidSchedule(cron: string, now: number): boolean {
  return nextRunAtMs(cron, now) !== undefined
}
