import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { nextRunAtMs } from './core/schedule.ts'
import { reusableSessionId } from './core/session-reuse.ts'
import { HostTaskLedger, type OpenedRun, type OpenExecutionReference } from './host-ledger.ts'
import { HostExecutionRunner, SessionLaunchError, promptText, type SessionCommandDispatcher, type SessionSummary, type TaskBoardWorkspaceRegistry } from './host-runner.ts'
import { teammateName } from './core/subtask.ts'
import { PowerInhibitor } from './power-inhibitor.ts'
import { TASK_BOARD_SCHEMA_VERSION, type TaskBoardAction, type TaskBoardEventPayload, type TaskBoardSnapshot } from './protocol.ts'
import type { TaskPermission } from './core/handover.ts'

/** One teammate the Host asks the Agent Teams service to spawn for a team run. */
export interface TeamSpawnInput {
  /** Session id of the run's Team Lead (the root task's execution session). */
  leadSessionId: string
  /** Immutable lower-kebab-case teammate name, unique inside the Team. */
  name: string
  /** Short description of the delegated responsibility. */
  description: string
  /** The subtask's execution prompt. */
  prompt: string
}

/** Result of one teammate spawn attempt. */
export interface TeamSpawnResult {
  /** The teammate's session id when it reached the active edge. */
  sessionId?: string
  /** Why the spawn failed: a thrown call, or a member that settled as failed. */
  error?: string
}

/**
 * The Agent Teams capability the Host needs for team-mode runs. The plugin
 * builds it from the optional `agentTeams` service; it is absent when this
 * deployment does not serve that service, in which case a team run is refused
 * instead of silently degrading into a plain cascade.
 */
export interface TaskBoardTeamDispatcher {
  spawn(input: TeamSpawnInput): Promise<TeamSpawnResult>
}

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
  /**
   * Ids the last roster poll saw as present and idle; undefined while the
   * roster is unknown. Session reuse (issue #1419) requires this positive
   * evidence, so a launch before the first successful poll mints a fresh
   * conversation instead of prompting into a session it cannot see.
   */
  private idleSessionIds: ReadonlySet<string> | undefined
  private preventIdleSleep = false
  private readonly team: TaskBoardTeamDispatcher | undefined
  private lastPowerJson = ''
  private readonly now: () => number

  constructor(gateway: TypertGateway, options: {
    ledger?: HostTaskLedger
    power?: PowerInhibitor
    now?: () => number
    commandDispatcher?: SessionCommandDispatcher
    workspaceRegistry?: TaskBoardWorkspaceRegistry
    sessionDefaultPermission?: TaskPermission
    maxSubtaskDepth?: number
    team?: TaskBoardTeamDispatcher
  } = {}) {
    this.ledger = options.ledger ?? new HostTaskLedger(undefined, undefined, {
      sessionDefaultPermission: options.sessionDefaultPermission,
      maxSubtaskDepth: options.maxSubtaskDepth,
    })
    this.runner = new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry)
    this.team = options.team
    this.power = options.power ?? new PowerInhibitor()
    this.now = options.now ?? Date.now
    installStreamErrorGuards()
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
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: state.revision,
      tasks: state.tasks,
      scheduler: state.scheduler,
      power: this.power.snapshot(),
      sessionDefaultPermission: this.ledger.sessionDefaultPermission,
      maxSubtaskDepth: this.ledger.maxSubtaskDepth,
      teamRunAvailable: this.team !== undefined,
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

  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot {
    if (!this.active) throw new Error('task board is disabled')
    // Fail closed before the ledger opens anything: a card opted into team
    // execution cannot run in a deployment that serves no Agent Teams service,
    // and silently degrading it to a plain cascade would misreport the work.
    if (this.team === undefined && (action.kind === 'run' || action.kind === 'rerun')) {
      const task = this.ledger.state().tasks.find(item => item.id === action.taskId)
      if (task?.teamRun === true) throw new Error('Agent Teams is unavailable in this deployment')
    }
    const result = this.ledger.applyRequest(requestId, action, initiator)
    if (result.runs !== undefined) this.dispatchRuns(result.runs)
    return {
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
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

  private async launch(opened: OpenedRun, others: readonly OpenedRun[] = []): Promise<void> {
    try {
      // A team run always mints a fresh Lead session: teammates are immutable
      // children of that session, so reusing an older one would collide on
      // their names and orphan the previous team.
      const team = opened.task.teamRun === true
      const reuseSessionId = team ? undefined : reusableSessionId(opened.task, this.idleSessionIds)
      // Both modes tell the launched agent what else this run opens; only a team
      // run names teammates, because only then does this session own them.
      const promptContext = others.length === 0 ? undefined : {
        peers: others.map(other => ({
          id: other.task.id,
          title: other.task.title,
          ...(team ? { name: teammateName(other.task.title, other.execution.runGroupId ?? other.task.id, other.task.id) } : {}),
        })),
        ...(team ? { team: true } : {}),
      }
      const sessionId = await this.runner.launch(opened.task, {
        ...(reuseSessionId === undefined ? {} : { reuseSessionId }),
        ...(promptContext === undefined ? {} : { promptContext }),
      })
      this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId)
      if (team) for (const teammate of others) this.scheduleTeammate(teammate, sessionId)
    } catch (error) {
      if (error instanceof SessionLaunchError) {
        this.ledger.attachSession(opened.task.id, opened.execution.id, error.sessionId)
      }
      this.ledger.settle(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private scheduleTeammate(opened: OpenedRun, leadSessionId: string): void {
    void this.spawnTeammate(opened, leadSessionId).catch(error => {
      safeConsoleError('[dsh-task-board] teammate spawn settlement failed', error)
    })
  }

  /**
   * Spawn one teammate inside the Lead session and attach the teammate's
   * session to the subtask execution, so the existing session monitor settles
   * it from the teammate's own turn like any other execution. A spawn that
   * fails settles the subtask as failed immediately, which then folds into the
   * Lead's cascade verdict.
   */
  private async spawnTeammate(opened: OpenedRun, leadSessionId: string): Promise<void> {
    const team = this.team
    if (team === undefined) {
      this.ledger.settle(opened.task.id, opened.execution.id, 'failed', 'Agent Teams is unavailable in this deployment')
      return
    }
    try {
      const member = await team.spawn({
        leadSessionId,
        name: teammateName(opened.task.title, opened.execution.runGroupId ?? opened.task.id, opened.task.id),
        description: opened.task.title,
        prompt: promptText(opened.task),
      })
      if (member.sessionId === undefined || member.sessionId === '') {
        this.ledger.settle(opened.task.id, opened.execution.id, 'failed', member.error ?? 'teammate provisioning failed')
        return
      }
      this.ledger.attachSession(opened.task.id, opened.execution.id, member.sessionId)
    } catch (error) {
      this.ledger.settle(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  private async pollSessions(): Promise<void> {
    if (this.disposed) return
    if (!this.active && this.ledger.runtimeView().openExecutions.length === 0) return
    const running = await this.runner.listRunning()
    const previous = this.power.snapshot()
    if (!running.known) {
      this.idleSessionIds = undefined
      this.power.updateReasons({
        runningSessions: previous.runningSessions,
        armedSchedules: this.ledger.armedScheduleCount(),
        sessionStateKnown: false,
      })
      return
    }
    this.idleSessionIds = new Set(running.items.filter(item => !item.running).map(item => item.sessionId))
    // Read after the RPC so executions attached while it was in flight are
    // included in this pass, matching the former full-state snapshot timing.
    const runtime = this.ledger.runtimeView()
    this.power.updateReasons({
      runningSessions: running.count,
      armedSchedules: runtime.armedSchedules,
      sessionStateKnown: true,
    })
    // No unconditional emit here: real changes already emit through the
    // ledger subscription (settles) and the gated power listener above.
    await this.reconcileExecutions(running.items, runtime.openExecutions)
  }

  /** Reuse the session list this poll already fetched: one list RPC per tick, not 1 + E. */
  private async reconcileExecutions(
    sessions: readonly SessionSummary[],
    executions: readonly OpenExecutionReference[],
  ): Promise<void> {
    for (const execution of executions) {
      if (execution.sessionId === undefined) continue
      try {
        const result = await this.runner.inspect(execution.sessionId, execution.startedAt, sessions)
        if (result.outcome === 'pending') continue
        this.ledger.settle(execution.taskId, execution.executionId, result.outcome, 'error' in result ? result.error : undefined)
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
    for (const schedule of this.ledger.dueSchedules(now)) {
      const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
      this.dispatchRuns(this.ledger.openScheduled(schedule.taskId, next, now))
    }
  }

  private armedSchedules(): number {
    return this.ledger.armedScheduleCount()
  }

  /**
   * Launch one run set. The root goes first and receives the run shape in its
   * prompt (which members this run opens, and how they run); every plain-cascade
   * member then launches on its own so one refused participant cannot hold the
   * others back. A team run's members are spawned inside the root's Lead
   * session instead, once that session exists.
   */
  private dispatchRuns(runs: readonly OpenedRun[]): void {
    if (runs.length === 0) return
    const root = runs.find(run => run.dispatch !== 'teammate') ?? runs[0]
    const others = runs.filter(run => run !== root)
    this.scheduleLaunch(root, others)
    for (const run of others) {
      if (run.dispatch !== 'teammate') this.scheduleLaunch(run)
    }
  }

  private scheduleLaunch(opened: OpenedRun, others: readonly OpenedRun[] = []): void {
    void this.launch(opened, others).catch(error => {
      safeConsoleError('[dsh-task-board] execution launch settlement failed', error)
    })
  }

  private schedulePoll(): void {
    if (this.pollInFlight || this.disposed) return
    this.pollInFlight = true
    void this.pollSessions().catch(error => {
      safeConsoleError('[dsh-task-board] session polling failed', error)
    }).finally(() => { this.pollInFlight = false })
  }

  private scheduleTick(first: boolean): void {
    if (this.tickInFlight || this.disposed) return
    this.tickInFlight = true
    void this.tickSchedule(first).catch(error => {
      safeConsoleError('[dsh-task-board] scheduler tick failed', error)
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

/**
 * Install stream error listeners on process.stderr and process.stdout so that
 * transient write failures (e.g. ENOSPC when the disk is full, or EPIPE on a
 * closed pipe) never emit unhandled 'error' events that kill the Node.js host process.
 */
export function installStreamErrorGuards(): void {
  for (const stream of [process.stderr, process.stdout]) {
    if (stream && typeof stream.on === 'function') {
      const hasErrorListener = typeof stream.listenerCount === 'function' && stream.listenerCount('error') > 0
      if (!hasErrorListener) {
        stream.on('error', () => {
          // Swallow write stream errors to keep the host process alive
        })
      }
    }
  }
}

/**
 * Defensively log to console.error without letting stderr write failures
 * (e.g. ENOSPC from SyncWriteStream on redirected logs) crash the host process.
 */
export function safeConsoleError(message: string, ...args: unknown[]): void {
  try {
    console.error(message, ...args)
  } catch {
    // Best-effort stderr write; ignore write errors when stderr stream fails
  }
}
