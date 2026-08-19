import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { nextRunAtMs } from './core/schedule.ts'
import type { TaskRecord } from './core/tasks.ts'
import { HostTaskLedger, type OpenedRun } from './host-ledger.ts'
import { HostExecutionRunner, SessionLaunchError, type SessionCommandDispatcher, type SessionSummary } from './host-runner.ts'
import { PowerInhibitor } from './power-inhibitor.ts'
import type { TaskBoardAction, TaskBoardEventPayload, TaskBoardSnapshot } from './protocol.ts'

const SESSION_POLL_MS = 5_000
const SCHEDULE_TICK_MS = 30_000
const RESUME_GAP_MS = SCHEDULE_TICK_MS + 15_000

export class TaskBoardHostService {
  readonly ledger: HostTaskLedger
  readonly runner: HostExecutionRunner
  readonly power: PowerInhibitor
  private readonly listeners = new Set<() => void>()
  private timers: Array<ReturnType<typeof setInterval>> = []
  private lastScheduleTick: number | undefined
  private disposed = false
  private pollInFlight = false
  private tickInFlight = false
  private active = true
  private preventIdleSleep = false
  private lastPowerJson = ''
  private readonly now: () => number

  constructor(api: ApiProxy, options: {
    ledger?: HostTaskLedger
    power?: PowerInhibitor
    now?: () => number
    commandDispatcher?: SessionCommandDispatcher
  } = {}) {
    this.ledger = options.ledger ?? new HostTaskLedger()
    this.runner = new HostExecutionRunner(api, options.commandDispatcher)
    this.power = options.power ?? new PowerInhibitor()
    this.now = options.now ?? Date.now
    this.ledger.subscribe(() => {
      this.syncPowerReasons()
      this.emit()
    })
    this.power.subscribe(() => {
      // updateReasons emits on every poll tick even when nothing changed;
      // gate on the actual snapshot so the 5 s heartbeat does not push an
      // empty SSE frame per tab forever.
      const json = JSON.stringify(this.power.snapshot())
      if (json === this.lastPowerJson) return
      this.lastPowerJson = json
      this.emit()
    })
  }

  start(): void {
    if (this.disposed || this.timers.length > 0) return
    this.syncPowerReasons()
    this.timers.push(setInterval(() => { this.schedulePoll() }, SESSION_POLL_MS))
    this.timers.push(setInterval(() => { this.scheduleTick(false) }, SCHEDULE_TICK_MS))
    this.schedulePoll()
    this.scheduleTick(true)
  }

  setConfiguration(active: boolean, preventIdleSleep: boolean): void {
    const resumed = !this.active && active
    this.active = active
    this.preventIdleSleep = preventIdleSleep
    if (resumed) {
      const current = this.power.snapshot()
      this.power.updateReasons({
        runningSessions: current.runningSessions,
        armedSchedules: this.armedSchedules(),
        sessionStateKnown: false,
      })
    }
    this.power.setEnabled(active && preventIdleSleep)
    if (resumed) {
      this.schedulePoll()
      this.scheduleTick(true)
    }
    this.emit()
  }

  snapshot(): TaskBoardSnapshot {
    const state = this.ledger.state()
    return {
      schemaVersion: 2,
      revision: state.revision,
      tasks: state.tasks,
      scheduler: state.scheduler,
      power: this.power.snapshot(),
    }
  }

  /** SSE frame payload; deliberately skips the tasks deep-clone of {@link snapshot}. */
  eventPayload(): TaskBoardEventPayload {
    const { revision, scheduler } = this.ledger.summary()
    return { revision, scheduler, power: this.power.snapshot() }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  apply(requestId: string, action: TaskBoardAction): TaskBoardSnapshot {
    if (!this.active) throw new Error('task board is disabled')
    const result = this.ledger.applyRequest(requestId, action)
    if (result.run !== undefined) this.scheduleLaunch(result.run)
    return {
      schemaVersion: 2,
      revision: result.state.revision,
      tasks: result.state.tasks,
      scheduler: result.state.scheduler,
      power: this.power.snapshot(),
    }
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.splice(0)) clearInterval(timer)
    this.power.dispose()
    this.ledger.dispose()
    this.listeners.clear()
  }

  private async launch(opened: OpenedRun): Promise<void> {
    try {
      const sessionId = await this.runner.launch(opened.task)
      this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId)
    } catch (error) {
      if (error instanceof SessionLaunchError) {
        this.ledger.attachSession(opened.task.id, opened.execution.id, error.sessionId)
      }
      this.ledger.settle(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.disposed) return
    if (!this.active && !this.hasOpenExecutions()) return
    const running = await this.runner.listRunning()
    const previous = this.power.snapshot()
    this.power.updateReasons({
      runningSessions: running.known ? running.count : previous.runningSessions,
      armedSchedules: this.armedSchedules(),
      sessionStateKnown: running.known,
    })
    // No unconditional emit here: real changes already emit through the
    // ledger subscription (settles) and the gated power listener above.
    if (running.known) await this.reconcileExecutions(running.items)
  }

  /** Reuse the session list this poll already fetched: one list RPC per tick, not 1 + E. */
  private async reconcileExecutions(sessions: readonly SessionSummary[]): Promise<void> {
    for (const task of this.ledger.state().tasks) {
      for (const execution of task.executions) {
        if (execution.sessionId === undefined || execution.endedAt !== undefined) continue
        try {
          const result = await this.runner.inspect(execution.sessionId, execution.startedAt, sessions)
          if (result.outcome === 'pending') continue
          this.ledger.settle(task.id, execution.id, result.outcome, 'error' in result ? result.error : undefined)
        } catch {
          // A transient inspection failure never settles a running execution.
        }
      }
    }
  }

  private async tickSchedule(first: boolean): Promise<void> {
    if (this.disposed || !this.active) return
    const now = this.now()
    const recovered = first || (this.lastScheduleTick !== undefined && now - this.lastScheduleTick > RESUME_GAP_MS)
    this.lastScheduleTick = now
    this.ledger.setScheduler({ lastTickAt: now })
    if (recovered) {
      this.ledger.skipMissed(now)
      return
    }
    for (const task of this.ledger.state().tasks) {
      if (task.archivedAt !== undefined) continue
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) continue
      const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
      const opened = this.ledger.openScheduled(task.id, next, now)
      if (opened !== undefined) this.scheduleLaunch(opened)
    }
  }

  private armedSchedules(): number {
    return this.ledger.state().tasks.filter((task: TaskRecord) => task.archivedAt === undefined && task.schedule?.enabled === true).length
  }

  private hasOpenExecutions(): boolean {
    return this.ledger.state().tasks.some(task => task.executions.some(execution => execution.endedAt === undefined))
  }

  private scheduleLaunch(opened: OpenedRun): void {
    void this.launch(opened).catch(error => {
      console.error('[dsh-task-board] execution launch settlement failed', error)
    })
  }

  private schedulePoll(): void {
    if (this.pollInFlight || this.disposed) return
    this.pollInFlight = true
    void this.pollSessions().catch(error => {
      console.error('[dsh-task-board] session polling failed', error)
    }).finally(() => { this.pollInFlight = false })
  }

  private scheduleTick(first: boolean): void {
    if (this.tickInFlight || this.disposed) return
    this.tickInFlight = true
    void this.tickSchedule(first).catch(error => {
      console.error('[dsh-task-board] scheduler tick failed', error)
    }).finally(() => { this.tickInFlight = false })
  }

  private syncPowerReasons(): void {
    const current = this.power.snapshot()
    this.power.updateReasons({
      runningSessions: current.runningSessions,
      armedSchedules: this.armedSchedules(),
      sessionStateKnown: current.sessionStateKnown,
    })
    this.power.setEnabled(this.active && this.preventIdleSleep)
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
