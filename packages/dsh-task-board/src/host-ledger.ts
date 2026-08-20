import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { isValidCron, nextRunAtMs } from './core/schedule.ts'
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

interface PersistedRequest {
  requestId: string
  fingerprint: string
}

interface LedgerDocument {
  schemaVersion: typeof TASK_BOARD_SCHEMA_VERSION
  revision: number
  tasks: TaskRecord[]
  scheduler: PersistedScheduler
  recentRequests: PersistedRequest[]
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

interface CachedRequest {
  fingerprint: string
}

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
}

function cloneTasks(tasks: readonly TaskRecord[]): TaskRecord[] {
  return JSON.parse(JSON.stringify(tasks)) as TaskRecord[]
}

function hasOpenExecution(task: TaskRecord): boolean {
  return task.executions.some(execution => execution.endedAt === undefined)
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

const PROCESS_PROBE_TIMEOUT_MS = 3000

let ownStartTime: number | undefined
let ownStartTimeResolved = false

/**
 * Best-effort start time (Unix epoch ms) of a live process. Used to prove
 * whether the ledger lock really belongs to the PID recorded in it, so a
 * crash leftover whose PID was reused by an unrelated process (issue #786)
 * is detected as stale instead of blocking startup forever. Returns
 * undefined when the platform probe is unavailable; callers fail closed.
 */
function processStartTimeMs(pid: number): number | undefined {
  if (process.platform === 'win32') {
    const probe = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        '[DateTimeOffset]::FromFileTime((Get-Process -Id ' + String(pid) + ' -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToFileTime()).ToUnixTimeMilliseconds()'],
      { timeout: PROCESS_PROBE_TIMEOUT_MS, windowsHide: true },
    )
    if (probe.status !== 0 || probe.stdout.length === 0) return undefined
    const started = Number(probe.stdout.toString('utf8').trim())
    return Number.isFinite(started) ? started : undefined
  }
  // POSIX: ps lstart with a forced English locale, falling back to the
  // elapsed-seconds column when lstart cannot be parsed.
  const env = { ...process.env, LC_ALL: 'C' }
  const probe = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { timeout: PROCESS_PROBE_TIMEOUT_MS, env })
  if (probe.status === 0 && probe.stdout.length > 0) {
    const started = Date.parse(probe.stdout.toString('utf8').trim())
    if (Number.isFinite(started)) return started
  }
  const elapsed = spawnSync('ps', ['-o', 'etimes=', '-p', String(pid)], { timeout: PROCESS_PROBE_TIMEOUT_MS, env })
  if (elapsed.status !== 0 || elapsed.stdout.length === 0) return undefined
  const seconds = Number(elapsed.stdout.toString('utf8').trim())
  if (!Number.isFinite(seconds)) return undefined
  return Date.now() - seconds * 1000
}

function ownProcessStartTimeMs(): number | undefined {
  if (!ownStartTimeResolved) {
    ownStartTimeResolved = true
    ownStartTime = processStartTimeMs(process.pid)
  }
  return ownStartTime
}

function betterExecution(a: ExecutionRecord, b: ExecutionRecord): ExecutionRecord {
  if (a.endedAt === undefined && b.endedAt !== undefined) return b
  if (b.endedAt === undefined && a.endedAt !== undefined) return a
  return (b.endedAt ?? b.startedAt) >= (a.endedAt ?? a.startedAt) ? b : a
}

function mergeTask(a: TaskRecord, b: TaskRecord): TaskRecord {
  // Existing Host state wins ties so an equally old browser backup cannot
  // roll authoritative fields back during multi-browser v1 migration.
  const newer = b.updatedAt > a.updatedAt ? b : a
  const byId = new Map<string, ExecutionRecord>()
  for (const entry of [...a.executions, ...b.executions]) {
    const previous = byId.get(entry.id)
    byId.set(entry.id, previous === undefined ? entry : betterExecution(previous, entry))
  }
  return { ...newer, executions: [...byId.values()].sort((x, y) => x.startedAt - y.startedAt) }
}

function parseHostTasks(values: readonly unknown[]): TaskRecord[] {
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
    if (typeof schedule.cron !== 'string' || isValidCron(schedule.cron)) return task
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
  private readonly requestCache = new Map<string, CachedRequest>()
  private readonly lockToken = crypto.randomUUID()
  private lockFd: number | undefined
  readonly file: string
  readonly lockFile: string
  /** Small sidecar for the 30 s scheduler heartbeat (lastTickAt only). */
  readonly schedulerFile: string

  constructor(dir: string = join(dshHome(), 'task-board'), private readonly now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'ledger-v2.json')
    this.lockFile = join(dir, 'ledger-v2.lock')
    this.schedulerFile = join(dir, 'scheduler-v2.json')
    this.lockFd = this.acquireLock()
    try {
      this.document = this.load(dir)
      for (const request of this.document.recentRequests) {
        this.requestCache.set(request.requestId, { fingerprint: request.fingerprint })
      }
      this.repairSchedules(true)
      this.reconcileInterruptedStarts()
      // Persist a freshly generated ledger identity and any recovery error
      // immediately, even when there are no tasks to trigger a later action.
      this.commit(false)
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  /** Revision + scheduler without any task cloning; feeds the SSE event frame. */
  summary(): { revision: number; scheduler: TaskBoardSchedulerSnapshot } {
    const { importedSources: _imports, ...scheduler } = this.document.scheduler
    return { revision: this.document.revision, scheduler: { ...scheduler } }
  }

  state(): LedgerState {
    const { revision, scheduler } = this.summary()
    return { revision, tasks: cloneTasks(this.document.tasks), scheduler }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    const fd = this.lockFd
    if (fd === undefined) return
    this.lockFd = undefined
    closeSync(fd)
    try {
      const owner = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { token?: unknown }
      if (owner.token === this.lockToken) unlinkSync(this.lockFile)
    } catch {
      // A missing or externally replaced lock must not be removed blindly.
    }
  }

  applyRequest(requestId: string, action: TaskBoardAction): { state: LedgerState; run?: OpenedRun } {
    const fingerprint = createHash('sha256').update(JSON.stringify(action)).digest('hex')
    const cached = this.requestCache.get(requestId)
    if (cached !== undefined) {
      if (cached.fingerprint !== fingerprint) throw new Error('request id was reused with a different action')
      return { state: this.state() }
    }

    // Add the fingerprint before apply(): successful actions persist it in the
    // same atomic ledger write as their state transition.
    this.requestCache.set(requestId, { fingerprint })
    while (this.requestCache.size > MAX_REQUEST_CACHE) this.requestCache.delete(this.requestCache.keys().next().value as string)
    this.syncRecentRequests()
    try {
      return this.apply(action)
    } catch (error) {
      this.requestCache.delete(requestId)
      this.syncRecentRequests()
      throw error
    }
  }

  openScheduled(taskId: string, nextRunAt: number | undefined, triggeredAt: number): OpenedRun | undefined {
    const task = this.document.tasks.find(item => item.id === taskId)
    if (task === undefined || task.archivedAt !== undefined) return undefined
    if (task.status === 'running' || hasOpenExecution(task)) {
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
    // The 30 s heartbeat only moves lastTickAt; rewriting the whole ledger
    // for it made idle idle cost O(ledger bytes) every tick. Persist it to a
    // tiny sidecar instead; any other patch still goes through the full
    // atomic commit.
    if (patch.lastTickAt !== undefined && Object.keys(patch).every(key => key === 'lastTickAt')) {
      this.writeSchedulerSidecar()
      return
    }
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
          .filter(task => task.schedule !== undefined && !isValidCron(task.schedule.cron))
          .map(task => task.id)
        const incoming = parseHostTasks(action.tasks)
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
        if (action.input.schedule?.enabled === true && (!isValidCron(action.input.schedule.cron) || nextRunAtMs(action.input.schedule.cron, now) === undefined)) {
          throw new Error('invalid schedule')
        }
        const result = applyCreateTask(this.document.tasks, action.input, now, action.id)
        if (result.task === undefined) throw new Error('invalid task')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'update': {
        const task = this.document.tasks.find(task => task.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        this.document.tasks = [...applyUpdateTask(this.document.tasks, action.taskId, action.patch, now)]
        break
      }
      case 'delete':
        {
          const task = this.document.tasks.find(task => task.id === action.taskId)
          if (task === undefined) throw new Error('task not found')
          if (task.status === 'running' || hasOpenExecution(task)) throw new Error('running task cannot be deleted')
        }
        this.document.tasks = [...applyDeleteTask(this.document.tasks, undefined, action.taskId).tasks]
        break
      case 'move': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task === undefined) throw new Error('task not found')
        if (task.archivedAt !== undefined) throw new Error('archived task is read-only')
        if (task.status === 'running' || hasOpenExecution(task)) throw new Error('running task cannot be moved')
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
        const task = this.document.tasks.find(task => task.id === action.taskId)
        if (task?.archivedAt !== undefined) throw new Error('archived task is read-only')
        const result = applySetSchedule(this.document.tasks, action.taskId, action.patch, now)
        if (!result.applied) throw new Error('invalid schedule')
        this.document.tasks = [...result.tasks]
        break
      }
      case 'rerun':
      case 'run': {
        const task = this.document.tasks.find(item => item.id === action.taskId)
        if (task?.archivedAt !== undefined) throw new Error('archived task is read-only')
        if (task === undefined || task.status === 'running' || hasOpenExecution(task)) throw new Error('task is already running or missing')
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
      const tasks = parseHostTasks(parsed.tasks)
      const invalidScheduleIds = (parsed.tasks as unknown[]).flatMap(value => {
        if (typeof value !== 'object' || value === null) return []
        const row = value as { id?: unknown; schedule?: unknown }
        if (typeof row.schedule !== 'object' || row.schedule === null) return []
        const cron = (row.schedule as { cron?: unknown }).cron
        return typeof cron !== 'string' || !isValidCron(cron)
          ? [typeof row.id === 'string' ? row.id : 'unknown']
          : []
      })
      const documentLastTickAt = typeof parsed.scheduler?.lastTickAt === 'number' ? parsed.scheduler.lastTickAt : undefined
      const sidecarLastTickAt = this.readSchedulerSidecar()
      // A sidecar write can be newer than the last full commit (crash between
      // the two); lastTickAt only ever moves forward, so take the greater.
      const lastTickAt = sidecarLastTickAt === undefined || (documentLastTickAt !== undefined && documentLastTickAt >= sidecarLastTickAt)
        ? documentLastTickAt
        : sidecarLastTickAt
      return {
        schemaVersion: TASK_BOARD_SCHEMA_VERSION,
        revision: Number.isSafeInteger(parsed.revision) && (parsed.revision as number) >= 0 ? parsed.revision as number : 0,
        tasks,
        scheduler: {
          timeZone: timeZone(),
          ledgerId: typeof parsed.scheduler?.ledgerId === 'string' && parsed.scheduler.ledgerId !== '' ? parsed.scheduler.ledgerId : crypto.randomUUID(),
          ...(lastTickAt === undefined ? {} : { lastTickAt }),
          ...(typeof parsed.scheduler?.error === 'string' ? { error: parsed.scheduler.error } : {}),
          ...(invalidScheduleIds.length > 0 ? { error: `invalid cron disabled for task(s): ${invalidScheduleIds.join(', ')}` } : {}),
          ...(Array.isArray(parsed.scheduler?.importedSources) ? { importedSources: parsed.scheduler.importedSources.filter(x => typeof x === 'string') } : {}),
        },
        recentRequests: Array.isArray(parsed.recentRequests)
          ? parsed.recentRequests.flatMap((entry) => {
              if (typeof entry !== 'object' || entry === null) return []
              const request = entry as { requestId?: unknown; fingerprint?: unknown }
              return typeof request.requestId === 'string' && request.requestId !== '' && typeof request.fingerprint === 'string'
                ? [{ requestId: request.requestId, fingerprint: request.fingerprint }]
                : []
            }).slice(-MAX_REQUEST_CACHE)
          : [],
      }
    } catch (error) {
      if (existed) renameSync(this.file, `${this.file}.corrupt-${this.now()}-${process.pid}-${crypto.randomUUID()}`)
      mkdirSync(dir, { recursive: true })
      return {
        schemaVersion: TASK_BOARD_SCHEMA_VERSION,
        revision: 0,
        tasks: [],
        scheduler: { timeZone: timeZone(), ledgerId: crypto.randomUUID(), ...(existed ? { error: `corrupt ledger was quarantined: ${error instanceof Error ? error.message : String(error)}` } : {}) },
        recentRequests: [],
      }
    }
  }

  private syncRecentRequests(): void {
    this.document.recentRequests = [...this.requestCache].map(([requestId, request]) => ({
      requestId,
      fingerprint: request.fingerprint,
    }))
  }

  private readSchedulerSidecar(): number | undefined {
    try {
      const parsed = JSON.parse(readFileSync(this.schedulerFile, 'utf8')) as { lastTickAt?: unknown }
      return typeof parsed.lastTickAt === 'number' && Number.isFinite(parsed.lastTickAt) ? parsed.lastTickAt : undefined
    } catch {
      return undefined
    }
  }

  /** Atomic write of the scheduler heartbeat sidecar (0600, tmp + rename + fsync). */
  private writeSchedulerSidecar(): void {
    const payload = JSON.stringify({ lastTickAt: this.document.scheduler.lastTickAt })
    mkdirSync(dirname(this.schedulerFile), { recursive: true })
    const tmp = `${this.schedulerFile}.tmp-${process.pid}`
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, payload, { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try { chmodSync(tmp, 0o600) } catch { /* Windows ACLs own access */ }
      renameSync(tmp, this.schedulerFile)
      try {
        const dirFd = openSync(dirname(this.schedulerFile), 'r')
        try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      } catch {
        // Windows does not permit fsync on a directory handle; rename remains atomic.
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(tmp) } catch { /* best-effort temporary cleanup */ }
      throw error
    }
    this.notify()
  }

  private commit(bumpRevision = true): void {
    if (bumpRevision) this.document.revision += 1
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}`
    let fd: number | undefined
    try {
      fd = openSync(tmp, 'w', 0o600)
      writeFileSync(fd, JSON.stringify(this.document, null, 2), { encoding: 'utf8' })
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
      try { chmodSync(tmp, 0o600) } catch { /* Windows ACLs own access */ }
      renameSync(tmp, this.file)
      try {
        const dirFd = openSync(dirname(this.file), 'r')
        try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
      } catch {
        // Windows does not permit fsync on a directory handle; rename remains atomic.
      }
    } catch (error) {
      if (fd !== undefined) closeSync(fd)
      try { unlinkSync(tmp) } catch { /* best-effort temporary cleanup */ }
      throw error
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private acquireLock(): number {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = openSync(this.lockFile, 'wx', 0o600)
        writeFileSync(fd, JSON.stringify({ pid: process.pid, token: this.lockToken, startedAt: ownProcessStartTimeMs() }), { encoding: 'utf8' })
        fsyncSync(fd)
        try { chmodSync(this.lockFile, 0o600) } catch { /* Windows ACLs own access */ }
        return fd
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw error
        let pid: number | undefined
        let ownerStartedAt: number | undefined
        try {
          const owner = JSON.parse(readFileSync(this.lockFile, 'utf8')) as { pid?: unknown; startedAt?: unknown }
          if (typeof owner.pid === 'number') pid = owner.pid
          if (typeof owner.startedAt === 'number') ownerStartedAt = owner.startedAt
        } catch {
          throw new Error(`task-board ledger lock is unreadable: ${this.lockFile}`)
        }
        if (pid !== undefined && processIsAlive(pid)) {
          const actualStartedAt = pid === process.pid ? ownProcessStartTimeMs() : processStartTimeMs(pid)
          // A reused PID is exposed when the live process identity no longer
          // matches the recorded one: either the recorded start time differs,
          // or (legacy locks without one) the lock file predates the live
          // process and therefore cannot have been written by it. Takeover is
          // safe in both cases — the original owner is gone.
          const staleReuse = actualStartedAt !== undefined && (
            ownerStartedAt !== undefined
              ? actualStartedAt !== ownerStartedAt
              : (() => {
                try { return statSync(this.lockFile).mtimeMs < actualStartedAt } catch { return true }
              })()
          )
          if (!staleReuse) {
            const confirmedOwner = ownerStartedAt !== undefined && actualStartedAt === ownerStartedAt
            const hint = confirmedOwner
              ? ''
              : `; if this PID was reused after a crash and no other DSH host is running, remove ${this.lockFile} manually and retry`
            throw new Error(`task-board ledger is already owned by process ${pid}${hint}`)
          }
        }
        try { unlinkSync(this.lockFile) } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError
        }
      }
    }
    throw new Error(`task-board ledger lock could not be acquired: ${this.lockFile}`)
  }
}
