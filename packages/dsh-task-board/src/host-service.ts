import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { nextRunAtMs } from './core/schedule.ts'
import type { TaskRecord } from './core/tasks.ts'
import { HostTaskLedger, type OpenedRun } from './host-ledger.ts'
import { HostExecutionRunner } from './host-runner.ts'
import { PowerInhibitor } from './power-inhibitor.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from './protocol.ts'

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
  private active = true
  private preventIdleSleep = false
  private readonly now: () => number

  constructor(api: ApiProxy, options: { ledger?: HostTaskLedger; power?: PowerInhibitor; now?: () => number } = {}) {
    this.ledger = options.ledger ?? new HostTaskLedger()
    this.runner = new HostExecutionRunner(api)
    this.power = options.power ?? new PowerInhibitor()
    this.now = options.now ?? Date.now
    this.ledger.subscribe(() => {
      this.syncPowerReasons()
      this.emit()
    })
    this.power.subscribe(() => { this.emit() })
  }

  start(): void {
    this.syncPowerReasons()
    void this.pollSessions()
    void this.tickSchedule(true)
    this.timers.push(setInterval(() => { void this.pollSessions() }, SESSION_POLL_MS))
    this.timers.push(setInterval(() => { void this.tickSchedule(false) }, SCHEDULE_TICK_MS))
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
      void this.pollSessions()
      void this.tickSchedule(true)
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  apply(requestId: string, action: TaskBoardAction): TaskBoardSnapshot {
    if (!this.active) throw new Error('task board is disabled')
    const result = this.ledger.applyRequest(requestId, action)
    if (result.run !== undefined) void this.launch(result.run)
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
    this.listeners.clear()
  }

  private async launch(opened: OpenedRun): Promise<void> {
    try {
      const sessionId = await this.runner.launch(opened.task)
      this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId)
    } catch (error) {
      this.ledger.settle(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.disposed || !this.active) return
    const running = await this.runner.listRunning()
    const previous = this.power.snapshot()
    this.power.updateReasons({
      runningSessions: running.known ? running.count : previous.runningSessions,
      armedSchedules: this.armedSchedules(),
      sessionStateKnown: running.known,
    })
    if (running.known) await this.reconcileExecutions()
    this.emit()
  }

  private async reconcileExecutions(): Promise<void> {
    for (const task of this.ledger.state().tasks) {
      if (task.status !== 'running') continue
      const execution = task.executions.at(-1)
      if (execution?.sessionId === undefined || execution.endedAt !== undefined) continue
      try {
        const result = await this.runner.inspect(execution.sessionId)
        if (result.outcome === 'pending') continue
        this.ledger.settle(task.id, execution.id, result.outcome, 'error' in result ? result.error : undefined)
      } catch {
        // A transient inspection failure never settles a running execution.
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
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled || schedule.nextRunAt === undefined || schedule.nextRunAt > now) continue
      const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
      const opened = this.ledger.openScheduled(task.id, next, now)
      if (opened !== undefined) void this.launch(opened)
    }
  }

  private armedSchedules(): number {
    return this.ledger.state().tasks.filter((task: TaskRecord) => task.schedule?.enabled === true).length
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
