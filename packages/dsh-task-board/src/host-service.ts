import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { nextRunAtMs } from './core/schedule.ts'
import { DEFAULT_SESSION_POLL_SECONDS, normalizeSessionPollSeconds, sessionPollMs } from './core/poll-cadence.ts'
import { reusableSessionId } from './core/session-reuse.ts'
import { HostTaskLedger, type OpenedRun, type OpenExecutionReference } from './host-ledger.ts'
import { HostExecutionRunner, SessionLaunchError, promptText, type SessionCommandDispatcher, type SessionSummary, type TaskBoardWorkspaceRegistry } from './host-runner.ts'
import { teammateName } from './core/subtask.ts'
import { workspaceOwningSession } from './core/workspace-target.ts'
import { PowerInhibitor } from './power-inhibitor.ts'
import { TASK_BOARD_SCHEMA_VERSION, type TaskBoardAction, type TaskBoardEventPayload, type TaskBoardSnapshot } from './protocol.ts'
import { TaskBoardExtensionRegistry } from './host/extension-registry.ts'
import type { TaskBoardExtension } from './core/extension.ts'
import type { ExecutionOutcome, TaskRecord, TaskStatus } from './core/tasks.ts'
import { passedAttempt, resolveContract, verificationNeverInvoked, verificationRequired, type ExecutionVerification, type ModelCatalogView, type VerificationContract, type VerificationSettings } from './core/verification.ts'
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

/** Ceiling for the roster-poll failure backoff: a broken session tree is retried at most once a minute. */
const POLL_FAILURE_MAX_BACKOFF_MS = 60_000
/**
 * How late an armed schedule fire may be before it counts as a resume rather
 * than a normal occurrence. The schedule timer is armed AT the next due
 * instant, so landing this far past its target means the Host was suspended,
 * the process throttled, or the wall clock jumped forward — the same condition
 * the old fixed 30 s heartbeat detected through its own gap threshold.
 */
const RECOVERY_TOLERANCE_MS = 60_000
/** Largest delay a Node timer represents without clamping; longer targets re-arm in segments. */
const MAX_TIMER_DELAY_MS = 2_147_483_647
/**
 * Consecutive polls that may report one execution's session history as
 * unreadable before it is reported failed. The roster poll runs every 5 s, so
 * this is two minutes of a session that is NOT running: no turn is executing
 * there and its history cannot be read, which means no verdict will ever
 * arrive. Reporting that as a failure keeps a card — and every ancestor of it —
 * out of the running column, which nothing else can rescue.
 */
const UNREADABLE_SETTLE_POLLS = 24

/**
 * Why an enforced goal execution settled failed while its acceptance DID run:
 * attempts were recorded and none of them passed. The judge answered about the
 * work and the work did not pass.
 */
export const NO_MATCHING_PASS_VERIFICATION_REASON = 'goal 验收：本次执行没有匹配的验收通过记录（验收未运行、未通过或报告来自其他执行），按未验收判失败。'
/**
 * Why an enforced goal execution settled failed with ZERO acceptance records:
 * the gate was never opened, so the judge never ran and nothing was ever judged
 * (issue #1837). The root cause is a session that declared completion in prose
 * instead of calling `update_goal(action: complete)` — a tool-adherence problem,
 * NOT a quality verdict on the delivery — so this reason says so and keeps the
 * two investigation directions apart.
 */
export const NEVER_INVOKED_VERIFICATION_REASON = 'goal 验收未触发：本次执行没有任何验收记录，验收门从未打开——执行会话没有调用 update_goal(action: complete) 来完成目标（常见于只在回复里宣告完成）。这不是质量判负：交付从未被裁判评估。'

/**
 * Provenance of one cron-triggered cascade: when the rule fired and the zone
 * its wall clock was read in. Passed into every launched prompt of that run so
 * a scheduled job knows its own clock rather than inferring one.
 */
export interface ScheduledRunContext {
  triggeredAt: number
  timeZone: string
  cron: string
}

/**
 * Actions that can move an armed trigger. Only these re-arm the native timer;
 * an unrelated card edit leaves the pending fire untouched.
 */
const SCHEDULE_WRITE_ACTIONS: ReadonlySet<TaskBoardAction['kind']> = new Set(['set-schedule', 'delete', 'archive'])

/**
 * The native timer face the Host arms through. The cordis `timer` service
 * (dsh-base's own `cordis-plugin-timer` row) provides it: its handles are
 * registered on the owning fiber, so unloading the board clears every armed
 * timer without this service tracking handles by hand. A composition that
 * serves no timer service falls back to the process globals.
 */
export interface HostTimerFace {
  timeout(callback: () => void, delay: number): () => void
  interval(callback: () => void, delay: number): () => void
}

/** Process-global fallback used when the deployment serves no cordis timer service. */
const PROCESS_TIMERS: HostTimerFace = {
  timeout(callback: () => void, delay: number): () => void {
    const handle = setTimeout(callback, delay)
    return () => { clearTimeout(handle) }
  },
  interval(callback: () => void, delay: number): () => void {
    const handle = setInterval(callback, delay)
    return () => { clearInterval(handle) }
  },
}

export class TaskBoardHostService {
  readonly ledger: HostTaskLedger
  readonly runner: HostExecutionRunner
  readonly power: PowerInhibitor
  private readonly listeners = new Set<() => void>()
  /** The one recurring timer: the session-roster poll. */
  private pollTimer: (() => void) | undefined
  /** Cadence of the roster poll, in seconds (a settings field; see the config schema). */
  private sessionPollSeconds = DEFAULT_SESSION_POLL_SECONDS
  /** Pending delay that follows a failed poll pass, if one is armed. */
  private pollBackoffTimer: (() => void) | undefined
  /** Consecutive failed poll passes; doubles the next retry delay. */
  private consecutivePollFailures = 0
  /** The armed schedule timer, if a trigger is pending. */
  private scheduleTimer: (() => void) | undefined
  /** The instant the armed schedule timer targets (ms epoch), for resume detection. */
  private scheduleTarget: number | undefined
  private disposed = false
  private pollInFlight = false
  private active = true
  /**
   * Consecutive unreadable-history polls per open execution (see
   * {@link noteUnreadableInspection}). Cleared as soon as an inspection
   * resolves, so a transient reader failure never fails a card.
   */
  private readonly unreadablePolls = new Map<string, number>()
  private preventIdleSleep = false
  private readonly verificationSettings: () => VerificationSettings
  private readonly verificationCatalog: () => Promise<ModelCatalogView | undefined>
  private readonly team: TaskBoardTeamDispatcher | undefined
  private readonly timers: HostTimerFace
  private lastPowerJson = ''
  private readonly now: () => number
  /** The deployment's workspaces, consulted to resolve a card that pins none. */
  private readonly workspaceRegistry: TaskBoardWorkspaceRegistry | undefined
  /**
   * External provider extensions. The board owns task lifecycle and execution;
   * a provider observes them through the registry's capability face and never
   * reaches into the ledger itself.
   */
  readonly extensions: TaskBoardExtensionRegistry

  constructor(gateway: TypertGateway, options: {
    ledger?: HostTaskLedger
    power?: PowerInhibitor
    now?: () => number
    commandDispatcher?: SessionCommandDispatcher
    workspaceRegistry?: TaskBoardWorkspaceRegistry
    /**
     * Permission baseline of the confirmation gate: a fixed value, or a live
     * resolver the board re-reads so a Host Settings change needs no remount.
     */
    sessionDefaultPermission?: TaskPermission | (() => TaskPermission)
    maxSubtaskDepth?: number
    team?: TaskBoardTeamDispatcher
    timers?: HostTimerFace
    /**
     * Live acceptance settings (volatile config reads). Absent keeps goal
     * acceptance OFF for every execution this service opens, which is what a
     * programmatic mount without the settings domain gets.
     */
    verificationSettings?: () => VerificationSettings
    /** The host model catalog the acceptance contract resolves its route from. */
    verificationCatalog?: () => Promise<ModelCatalogView | undefined>
  } = {}) {
    this.ledger = options.ledger ?? new HostTaskLedger(undefined, undefined, {
      sessionDefaultPermission: options.sessionDefaultPermission,
      maxSubtaskDepth: options.maxSubtaskDepth,
    })
    this.runner = new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry)
    this.workspaceRegistry = options.workspaceRegistry
    this.team = options.team
    this.timers = options.timers ?? PROCESS_TIMERS
    this.power = options.power ?? new PowerInhibitor()
    this.now = options.now ?? Date.now
    this.verificationSettings = options.verificationSettings ?? (() => ({ enabled: false, model: '', reasoningEffort: '' }))
    this.verificationCatalog = options.verificationCatalog ?? (async () => undefined)
    this.extensions = new TaskBoardExtensionRegistry({
      ledger: this.ledger,
      // Capability writes go through the board's own action path, so every
      // board gate (content freeze, running lock, permission gate) still holds.
      apply: (action, initiator) => this.applyBoardAction(crypto.randomUUID(), action, initiator),
      now: this.now,
    })
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
    if (this.disposed || this.pollTimer !== undefined) return
    this.syncPowerReasons()
    this.pollTimer = this.timers.interval(() => { this.schedulePoll() }, sessionPollMs(this.sessionPollSeconds))
    this.schedulePoll()
    // Boot is a recovery point: an occurrence armed while the Host was down is
    // not replayed, and each schedule rolls to its next future target. A
    // schedule the Board should have served while running is then armed
    // normally by the timer below.
    this.recoverSchedule()
  }

  /**
   * Apply the live configuration. The roster cadence is re-read on every
   * commit, so a settings edit takes effect without a restart; the poll is
   * scheduled at the new cadence immediately rather than waiting out the old
   * interval.
   * @param active - the board's master switch.
   * @param preventIdleSleep - whether the board holds an idle-sleep assertion.
   * @param sessionPollSeconds - roster-poll cadence in seconds (clamped).
   */
  setConfiguration(active: boolean, preventIdleSleep: boolean, sessionPollSeconds?: number): void {
    const resumed = !this.active && active
    this.active = active
    this.preventIdleSleep = preventIdleSleep
    const cadence = normalizeSessionPollSeconds(sessionPollSeconds)
    const retimed = this.pollTimer !== undefined && cadence !== this.sessionPollSeconds
    this.sessionPollSeconds = cadence
    if (retimed) {
      // The recurring timer was armed at the old cadence: replace it and take
      // the next pass now, so the new interval starts from this commit.
      this.pollTimer?.()
      this.pollTimer = this.timers.interval(() => { this.schedulePoll() }, sessionPollMs(this.sessionPollSeconds))
      this.clearPollBackoff()
      this.schedulePoll()
    }
    if (resumed) {
      const current = this.power.snapshot()
      this.power.updateReasons({
        runningSessions: current.runningSessions,
        armedSchedules: this.armedSchedules(),
        sessionStateKnown: false,
      })
    }
    this.power.setEnabled(active && preventIdleSleep)
    // Providers follow the board's master switch: the registry stops their
    // provider-side work and hides their seats without clearing any data.
    this.extensions.setEnabled(active)
    if (resumed) {
      this.schedulePoll()
      this.recoverSchedule()
    } else if (!active) {
      // A disabled board holds no timer: its schedules must not fire while the
      // master switch is off.
      this.clearScheduleTimer()
    }
    this.emit()
  }

  snapshot(): TaskBoardSnapshot {
    const state = this.ledger.state()
    const published = this.extensions.published()
    return {
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: state.revision,
      tasks: state.tasks,
      scheduler: state.scheduler,
      power: this.power.snapshot(),
      sessionDefaultPermission: this.ledger.sessionDefaultPermission,
      maxSubtaskDepth: this.ledger.maxSubtaskDepth,
      teamRunAvailable: this.team !== undefined,
      ...(Object.keys(published).length === 0 ? {} : { extensions: published }),
    }
  }

  /**
   * Admit one external provider. Idempotent by extension id; the returned
   * disposer releases it (its stored data stays).
   */
  registerExtension(extension: TaskBoardExtension): () => void {
    return this.extensions.registerExtension(extension)
  }

  /**
   * The acceptance configuration the settings card displays: the live settings,
   * the contract they resolve to, and the host catalog the choices come from.
   *
   * The card shows the RESOLVED route, not the raw configuration, so "inherit
   * host" reads as the concrete model and reasoning level the next execution
   * will actually freeze, including any recorded effort fallback.
   * @returns the resolved acceptance options.
   */
  async verificationOptions(): Promise<{
    settings: VerificationSettings
    contract: VerificationContract
    catalog: ModelCatalogView
  }> {
    const settings = this.verificationSettings()
    const catalog = await this.verificationCatalog()
    return {
      settings,
      contract: resolveContract(settings, catalog),
      catalog: catalog ?? { groups: [] },
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

  /**
   * Give a root card created without a workspace pin the workspace its creator
   * is in.
   *
   * An agent's `task_board_create` arrives with the calling session, and the
   * GUI submits the session the main view shows, so the card lands where the
   * work was asked for instead of where the Host process happens to run. A card
   * that names a workspace keeps it, and a subtask keeps inheriting its lineage
   * (the runner walks the ancestor chain for that).
   *
   * The initiator is client-asserted, so it only chooses among workspaces the
   * deployment already knows: it can neither register one nor reach outside the
   * list the user sees.
   * @param action - the action about to be applied.
   * @param initiator - the session that issued the action, when one was asserted.
   * @returns the action, with an inherited workspace on a root creation.
   */
  private withInheritedWorkspace(action: TaskBoardAction, initiator?: string): TaskBoardAction {
    if (action.kind !== 'create' || initiator === undefined || initiator === '') return action
    const input = action.input
    // A subtask inherits its lineage instead, and an explicit pin is the user's.
    if ((input.parentId ?? '').trim() !== '') return action
    if ((input.workspaceId ?? '').trim() !== '') return action
    const workspaceId = workspaceOwningSession(this.workspaceRegistry?.list() ?? [], initiator)
    if (workspaceId === undefined) return action
    return { ...action, input: { ...input, workspaceId } }
  }

  apply(requestId: string, action: Extract<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): Promise<TaskBoardSnapshot>
  apply(requestId: string, action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): TaskBoardSnapshot
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot>
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot> {
    if (!this.active) throw new Error('task board is disabled')
    // Provider actions never touch the ledger directly: the registry routes the
    // action to the owning extension, whose own capability calls come back
    // through applyBoardAction and every board gate below.
    if (action.kind === 'extension-action') {
      return this.handleExtensionAction(action)
    }
    return this.applyBoardAction(requestId, action, initiator)
  }

  /**
   * Apply one board-owned action with every gate intact. Provider capability
   * calls and the same-origin wire both land here, so the two surfaces can
   * never disagree about a card.
   */
  private applyBoardAction(requestId: string, action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): TaskBoardSnapshot {
    const before = this.statusMap()
    // Fail closed before the ledger opens anything: a card opted into team
    // execution cannot run in a deployment that serves no Agent Teams service,
    // and silently degrading it to a plain cascade would misreport the work.
    if (this.team === undefined && (action.kind === 'run' || action.kind === 'rerun')) {
      const task = this.ledger.state().tasks.find(item => item.id === action.taskId)
      if (task?.teamRun === true) throw new Error('Agent Teams is unavailable in this deployment')
    }
    const result = this.ledger.applyRequest(requestId, this.withInheritedWorkspace(action, initiator), initiator)
    if (result.runs !== undefined) this.dispatchRuns(result.runs)
    // A committed schedule write (create / update / toggle / delete) moves the
    // nearest trigger; re-arm on every action so a newly enabled schedule fires
    // at its own instant without waiting for the previous target to elapse.
    if (SCHEDULE_WRITE_ACTIONS.has(action.kind)) this.refreshSchedule()
    this.emitStatusChanges(before, initiator)
    if (action.kind === 'delete') this.extensions.emitTaskDeleted({ taskId: action.taskId })
    return {
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: result.state.revision,
      tasks: result.state.tasks,
      scheduler: result.state.scheduler,
      power: this.power.snapshot(),
    }
  }

  /** Route one provider action and answer the resulting board snapshot. */
  private async handleExtensionAction(action: Extract<TaskBoardAction, { kind: 'extension-action' }>): Promise<TaskBoardSnapshot> {
    await this.extensions.handleAction({
      extensionId: action.extensionId,
      action: action.action,
      ...(action.taskId === undefined ? {} : { taskId: action.taskId }),
      ...(action.payload === undefined ? {} : { payload: action.payload }),
    })
    return this.snapshot()
  }

  /** Current task id -> status map, for change detection around a mutation. */
  private statusMap(): Map<string, TaskStatus> {
    return new Map(this.ledger.allTasks().map(task => [task.id, task.status]))
  }

  /** Emit a status change for every task whose column moved, isolated per callback. */
  private emitStatusChanges(before: Map<string, TaskStatus>, initiator?: string): void {
    for (const task of this.ledger.allTasks()) {
      const previous = before.get(task.id)
      if (previous === undefined || previous === task.status) continue
      this.extensions.emitStatusChanged({
        taskId: task.id,
        status: task.status,
        previous,
        ...(initiator === undefined || initiator === '' ? {} : { initiator }),
      })
    }
  }

  dispose(): void {
    this.disposed = true
    this.extensions.dispose()
    this.clearScheduleTimer()
    this.clearPollBackoff()
    this.pollTimer?.()
    this.pollTimer = undefined
    this.power.dispose()
    this.ledger.dispose()
    this.listeners.clear()
  }

  private async launch(opened: OpenedRun, others: readonly OpenedRun[] = [], schedule?: ScheduledRunContext): Promise<void> {
    try {
      // A team run always mints a fresh Lead session: teammates are immutable
      // children of that session, so reusing an older one would collide on
      // their names and orphan the previous team.
      const team = opened.task.teamRun === true
      const reuseSessionId = team ? undefined : await this.reuseSessionFor(opened.task)
      // Both modes tell the launched agent what else this run opens; only a team
      // run names teammates, because only then does this session own them.
      const peers = others.length === 0 ? undefined : others.map(other => ({
        id: other.task.id,
        title: other.task.title,
        ...(team ? { name: teammateName(other.task.title, other.execution.runGroupId ?? other.task.id, other.task.id) } : {}),
      }))
      // A cron-triggered run additionally states its own firing instant and
      // rule zone, so a scheduled job can resolve "today" without guessing.
      const promptContext = peers === undefined && schedule === undefined ? undefined : {
        ...(peers === undefined ? {} : { peers }),
        ...(team ? { team: true } : {}),
        ...(schedule === undefined ? {} : { schedule }),
      }
      // Freeze this execution's acceptance contract BEFORE the session is
      // prompted: a settings change made while the run is in flight must not
      // retrofit the rule that will judge it. A card that opted out resolves the
      // same contract from an OFF switch: the board-wide switch decides the
      // default, the card decides this execution, and both are read here.
      const settings = this.verificationSettings()
      // The card's opt-out is a DISTINCT reason, not the board switch: the
      // report must be able to say which of the two turned the gate off.
      const skippedBy: ExecutionVerification['applicability'] = opened.task.skipVerification === true ? 'skipped' : 'disabled'
      const contract = resolveContract(
        { ...settings, enabled: settings.enabled && opened.task.skipVerification !== true },
        await this.verificationCatalog(),
      )
      const initial: ExecutionVerification = {
        contract,
        attempts: [],
        applicability: team ? 'team-member' : !contract.enabled ? skippedBy : 'goal-unavailable',
      }
      this.ledger.setVerification(opened.task.id, opened.execution.id, initial)
      let attached: string | undefined
      const sessionId = await this.runner.launch(opened.task, {
        ...(reuseSessionId === undefined ? {} : { reuseSessionId }),
        ...(promptContext === undefined ? {} : { promptContext }),
        // Bind the session to the execution before the prompt is queued, so the
        // completion gate can never observe the agent without its binding.
        onSession: (id) => {
          attached = id
          this.ledger.attachSession(opened.task.id, opened.execution.id, id)
        },
        onGoalArmed: (armed) => {
          this.setApplicability(opened.task.id, opened.execution.id, team
            ? 'team-member'
            : !contract.enabled ? skippedBy : armed ? 'enforced' : 'goal-unavailable')
        },
      })
      if (attached === undefined) this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId)
      if (team) for (const teammate of others) this.scheduleTeammate(teammate, sessionId)
    } catch (error) {
      if (error instanceof SessionLaunchError) {
        this.ledger.attachSession(opened.task.id, opened.execution.id, error.sessionId)
      }
      this.settleAndNotify(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
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
      this.settleAndNotify(opened.task.id, opened.execution.id, 'failed', 'Agent Teams is unavailable in this deployment')
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
        this.settleAndNotify(opened.task.id, opened.execution.id, 'failed', member.error ?? 'teammate provisioning failed')
        return
      }
      this.ledger.attachSession(opened.task.id, opened.execution.id, member.sessionId)
    } catch (error) {
      this.settleAndNotify(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * One roster pass, and whether it could read the session tree.
   *
   * The board reads the DSH session roster only while it has something the
   * roster can decide: an execution to inspect, or a card parked in the running
   * column whose verdict may arrive from a settle this process never saw. That
   * gate is what removes the cost the reporter measured — `session/list`
   * rebuilds every persisted session row (string conversion, object allocation,
   * a stat per record), and an idle board with no tasks was paying it every few
   * seconds forever.
   * @returns whether the roster was readable (an idle pass counts as readable).
   */
  private async pollSessions(): Promise<boolean> {
    if (this.disposed) return true
    const runtime = this.ledger.runtimeView()
    if (!this.active) {
      // A disabled board still settles the runs it opened before it was
      // switched off, and re-reads the roster while a card sits in the running
      // column. With neither, the poll is a no-op.
      if (runtime.openExecutions.length === 0 && runtime.armedSchedules === 0) return true
    } else if (!runtime.needsSessionState) {
      // Idle board: nothing to reconcile and nothing to count. Keep the last
      // power reading (a stale count only delays the release of the idle-sleep
      // assertion, never starts one) and stand down.
      return true
    }
    const running = await this.runner.listRunning()
    const previous = this.power.snapshot()
    if (!running.known) {
      this.power.updateReasons({
        runningSessions: previous.runningSessions,
        armedSchedules: runtime.armedSchedules,
        sessionStateKnown: false,
      })
      return false
    }
    // Fold whatever the board can already decide before spending inspection
    // RPCs: a team run whose Lead recorded its verdict, and any lineage whose
    // members are all settled. Idempotent, so an already folded board is free.
    const foldedBefore = this.statusMap()
    this.ledger.finalizeReadyRuns()
    this.emitStatusChanges(foldedBefore)
    // Read after the RPC so executions attached while it was in flight are
    // included in this pass, matching the former full-state snapshot timing.
    const current = this.ledger.runtimeView()
    this.power.updateReasons({
      runningSessions: running.count,
      armedSchedules: current.armedSchedules,
      sessionStateKnown: true,
    })
    // No unconditional emit here: real changes already emit through the
    // ledger subscription (settles) and the gated power listener above.
    await this.reconcileExecutions(running.items, current.openExecutions)
    return true
  }

  /**
   * The session a run may continue in, for a card that opted into reuse
   * (issue #1419). Reuse requires positive evidence that the previous session
   * is present and idle, and that evidence must be read for THIS launch: an
   * idle board no longer polls, so a roster cached from an earlier pass could
   * be hours old — either refusing a session that has been idle all along, or
   * prompting into one that started running since. A card that did not opt in
   * reads no roster at all, and a read that fails mints a fresh conversation
   * exactly as an unknown roster always did.
   * @param task - the task about to run.
   * @returns the session id to continue in, or undefined for a fresh session.
   */
  private async reuseSessionFor(task: TaskRecord): Promise<string | undefined> {
    if (task.reuseSession !== true) return undefined
    let running: Awaited<ReturnType<HostExecutionRunner['listRunning']>>
    try {
      running = await this.runner.listRunning()
    } catch (error) {
      // A read that failed is an unknown roster, and an unknown roster never
      // reuses; the launch itself must not fail over the reuse probe.
      this.notePollFailure()
      safeConsoleError('[dsh-task-board] session roster read for session reuse failed; starting a fresh session', error)
      return undefined
    }
    if (!running.known) return undefined
    return reusableSessionId(task, new Set(running.items.filter(item => !item.running).map(item => item.sessionId)))
  }

  /** Reuse the session list this poll already fetched: one list RPC per tick, not 1 + E. */
  private async reconcileExecutions(
    sessions: readonly SessionSummary[],
    executions: readonly OpenExecutionReference[],
  ): Promise<void> {
    for (const execution of executions) {
      if (execution.sessionId === undefined) continue
      const record = this.ledger.getTask(execution.taskId)?.executions.find(entry => entry.id === execution.executionId)
      const verification = record?.verification
      // A cycle the gate already closed is decided here, without another
      // inspection: the goal may still be active (or un-blockable) exactly
      // because the acceptance failed, and the card must not stay in the
      // running column waiting for a verdict that is already recorded.
      if (verification?.failedReason !== undefined) {
        this.settleAndNotify(execution.taskId, execution.executionId, 'failed', verification.failedReason)
        continue
      }
      try {
        // A team member's turn is read even while the roster calls its session
        // running: a durable teammate never goes idle for good.
        const result = await this.runner.inspect(execution.sessionId, execution.startedAt, sessions, {
          whileRunning: execution.teamMember,
        })
        if (result.outcome === 'pending') {
          if (result.unreadable === true) this.noteUnreadableInspection(execution, result.reason)
          else this.unreadablePolls.delete(execution.executionId)
          continue
        }
        this.unreadablePolls.delete(execution.executionId)
        // Forced acceptance: the old fallback paths — a completed turn, a
        // paused goal, an unreadable projection, a manual settle — must never
        // be mistaken for a verified success. Only a matching pass record
        // settles this execution as succeeded.
        if (result.outcome === 'succeeded' && verificationRequired(verification) && passedAttempt(verification) === undefined) {
          // Two different failures share this branch, and they send the reader
          // in opposite directions: attempts on record mean the judge ran and
          // the work did not pass, while zero attempts mean the gate never
          // opened at all (issue #1837) — the session narrated completion
          // instead of calling `update_goal(action: complete)`.
          this.settleAndNotify(
            execution.taskId,
            execution.executionId,
            'failed',
            verificationNeverInvoked(verification)
              ? NEVER_INVOKED_VERIFICATION_REASON
              : NO_MATCHING_PASS_VERIFICATION_REASON,
          )
          continue
        }
        this.settleAndNotify(execution.taskId, execution.executionId, result.outcome, 'error' in result ? result.error : undefined)
      } catch {
        // A transient inspection failure never settles a running execution.
      }
    }
    const open = new Set(executions.map(execution => execution.executionId))
    for (const executionId of [...this.unreadablePolls.keys()]) {
      if (!open.has(executionId)) this.unreadablePolls.delete(executionId)
    }
  }

  /**
   * Count one poll whose session history could not be read. A reader failure is
   * not progress: the session is not running (the runner only reads history for
   * one that is idle), so nothing will ever change that verdict. After
   * {@link UNREADABLE_SETTLE_POLLS} consecutive polls the execution is reported
   * failed with the recorded reason, instead of holding its card — and every
   * ancestor of it — in the running column with no way out. The first poll of
   * each streak is logged, so the Host log names the session.
   */
  private settleAndNotify(taskId: string, executionId: string, outcome: ExecutionOutcome, error?: string): void {
    const before = this.ledger.getTask(taskId)
    if (before?.executions.find(entry => entry.id === executionId)?.endedAt !== undefined) {
      // Already settled: the ledger would no-op, and re-emitting would report
      // the same settlement twice.
      this.ledger.settle(taskId, executionId, outcome, error)
      return
    }
    const previousStatus = before?.status
    this.ledger.settle(taskId, executionId, outcome, error)
    const task = this.ledger.getTask(taskId)
    if (task !== undefined && previousStatus !== undefined && previousStatus !== task.status) {
      this.extensions.emitStatusChanged({ taskId, status: task.status, previous: previousStatus })
    }
    this.extensions.emitExecutionSettled({
      taskId,
      executionId,
      outcome,
      ...(error === undefined ? {} : { error }),
    })
  }

  private noteUnreadableInspection(execution: OpenExecutionReference, reason: string | undefined): void {
    const polls = (this.unreadablePolls.get(execution.executionId) ?? 0) + 1
    this.unreadablePolls.set(execution.executionId, polls)
    const detail = reason ?? 'no reason reported'
    if (polls === 1) {
      safeConsoleError('[dsh-task-board] execution session ' + (execution.sessionId ?? 'unknown')
        + ' history is unreadable; it stays pending for up to ' + UNREADABLE_SETTLE_POLLS + ' polls: ' + detail)
    }
    if (polls < UNREADABLE_SETTLE_POLLS) return
    this.unreadablePolls.delete(execution.executionId)
    this.settleAndNotify(
      execution.taskId,
      execution.executionId,
      'failed',
      'execution session history is unreadable (' + UNREADABLE_SETTLE_POLLS + ' consecutive polls); the outcome cannot be determined: ' + detail,
    )
  }

  /** Drop the armed schedule timer and forget its target. */
  private clearScheduleTimer(): void {
    this.scheduleTimer?.()
    this.scheduleTimer = undefined
    this.scheduleTarget = undefined
  }

  /**
   * Boot / resume recovery: skip every occurrence that came due while the
   * board was not running and roll each schedule to its next future target,
   * then arm the timer for the nearest one. Rendering the occurrence is
   * deliberately not attempted: the ACL of a card that fired hours ago is
   * stale, and the board's own recovery contract is "missed triggers are
   * skipped, never replayed".
   */
  private recoverSchedule(): void {
    if (this.disposed) return
    this.clearScheduleTimer()
    const now = this.now()
    this.ledger.setScheduler({ lastTickAt: now })
    this.ledger.skipMissed(now)
    this.armSchedule()
  }

  /**
   * Arm the native timer at the nearest armed future trigger. One timer serves
   * every schedule: the ledger's next target is the only instant the Host has
   * to wake for. A target beyond the platform's timer ceiling re-arms in
   * segments, and a target already past (the wall clock jumped, or the process
   * was suspended) is handled immediately as a recovery.
   */
  private armSchedule(): void {
    if (this.disposed || !this.active) return
    this.clearScheduleTimer()
    const target = this.ledger.nextArmedRunAt(this.now())
    if (target === undefined) return
    this.scheduleTarget = target
    const delay = Math.max(0, Math.min(target - this.now(), MAX_TIMER_DELAY_MS))
    this.scheduleTimer = this.timers.timeout(() => {
      this.scheduleTimer = undefined
      this.onScheduleFire(target)
    }, delay)
  }

  /**
   * One armed target became due. A fire landing well past its target is a
   * resume (suspend, throttle, forward clock jump) rather than a normal
   * occurrence, so it takes the recovery path instead of launching a run for a
   * long-stale instant.
   */
  private onScheduleFire(target: number): void {
    if (this.disposed || !this.active) return
    const now = this.now()
    this.scheduleTarget = undefined
    this.ledger.setScheduler({ lastTickAt: now })
    if (now - target > RECOVERY_TOLERANCE_MS) {
      this.recoverSchedule()
      return
    }
    const before = this.statusMap()
    for (const schedule of this.ledger.dueSchedules(now)) {
      const next = nextRunAtMs(schedule.cron, schedule.nextRunAt, schedule.timeZone)
      this.dispatchRuns(
        this.ledger.openScheduled(schedule.taskId, next, now),
        { triggeredAt: now, timeZone: schedule.timeZone, cron: schedule.cron },
      )
    }
    this.emitStatusChanges(before)
    // The launched run (or the rolled-forward target) moved every due schedule,
    // so the next nearest target has to be recomputed from the ledger.
    this.armSchedule()
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
  private dispatchRuns(runs: readonly OpenedRun[], schedule?: ScheduledRunContext): void {
    if (runs.length === 0) return
    const root = runs.find(run => run.dispatch !== 'teammate') ?? runs[0]
    const others = runs.filter(run => run !== root)
    this.scheduleLaunch(root, others, schedule)
    for (const run of others) {
      if (run.dispatch !== 'teammate') this.scheduleLaunch(run, [], schedule)
    }
  }

  /**
   * Move one execution's applicability without touching its frozen contract or
   * its recorded attempts (used when the run's goal form becomes known).
   */
  private setApplicability(taskId: string, executionId: string, applicability: ExecutionVerification['applicability']): void {
    const verification = this.ledger.getTask(taskId)?.executions.find(entry => entry.id === executionId)?.verification
    if (verification === undefined || verification.applicability === applicability) return
    this.ledger.setVerification(taskId, executionId, { ...verification, applicability })
  }

  private scheduleLaunch(opened: OpenedRun, others: readonly OpenedRun[] = [], schedule?: ScheduledRunContext): void {
    void this.launch(opened, others, schedule).catch(error => {
      safeConsoleError('[dsh-task-board] execution launch settlement failed', error)
    })
  }

  private schedulePoll(): void {
    if (this.pollInFlight || this.disposed) return
    this.pollInFlight = true
    void this.pollSessions().then((rosterReadable) => {
      // A pass that could not read the roster is a failure even though it
      // resolved: the board knows no more about its sessions than before.
      if (rosterReadable) this.consecutivePollFailures = 0
      else this.notePollFailure()
    }).catch(error => {
      this.notePollFailure()
      safeConsoleError('[dsh-task-board] session polling failed', error)
    }).finally(() => { this.pollInFlight = false })
  }

  /**
   * Count one failed pass and arm the retry that follows it.
   *
   * A session tree that is down is retried on a doubling delay instead of
   * hammering it on the fixed cadence: the heartbeat would otherwise repeat
   * every failure — and every retry inside {@link HostExecutionRunner.listRunning}
   * — at exactly the interval the reporter measured.
   */
  private notePollFailure(): void {
    this.consecutivePollFailures += 1
    this.armPollBackoff()
  }

  /** Arm the retry that follows a failed pass, doubling up to the ceiling. */
  private armPollBackoff(): void {
    if (this.disposed) return
    this.pollBackoffTimer?.()
    const delay = Math.min(sessionPollMs(this.sessionPollSeconds) * 2 ** Math.min(this.consecutivePollFailures, 8), POLL_FAILURE_MAX_BACKOFF_MS)
    this.pollBackoffTimer = this.timers.timeout(() => {
      this.pollBackoffTimer = undefined
      this.schedulePoll()
    }, delay)
  }

  /** Drop a pending retry; the next regular tick takes over. */
  private clearPollBackoff(): void {
    this.pollBackoffTimer?.()
    this.pollBackoffTimer = undefined
  }

  /**
   * Re-arm from the ledger's current targets. Callers that just changed a
   * schedule (the host routes, the agent tools) invoke this after the write
   * commits, so a new or edited trigger arms without waiting for the next fire.
   */
  refreshSchedule(): void {
    if (this.disposed) return
    if (!this.active) {
      this.clearScheduleTimer()
      return
    }
    this.armSchedule()
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
