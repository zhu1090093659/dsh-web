import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { DEFAULT_RUN_LAUNCH_WIDTH, normalizeRunLaunchWidth } from './core/launch-width.ts'
import { DEFAULT_SPEND_BUDGET_TOKENS, spendCapMessage, spendCapReached } from './core/spend-budget.ts'
import { usedTokensToday } from './host-spend.ts'
import { DEFAULT_SESSION_POLL_SECONDS, normalizeSessionPollSeconds, sessionPollMs } from './core/poll-cadence.ts'
import { reusableSessionId } from './core/session-reuse.ts'
import { LaunchAdmissionQueue, type QueuedLaunch } from './host/launch-admission.ts'
import { HostTaskLedger, type OpenedRun, type OpenExecutionReference } from './host-ledger.ts'
import { HostExecutionRunner, SessionLaunchError, type GatewayPeer, type SessionCommandDispatcher, type SessionSummary, type TaskBoardWorkspaceRegistry } from './host-runner.ts'
import { LIANGSHEN_PRESET_ID } from './core/subtask.ts'
import { workspaceOwningSession } from './core/workspace-target.ts'
import { PowerInhibitor } from './power-inhibitor.ts'
import { TASK_BOARD_SCHEMA_VERSION, type TaskBoardAction, type TaskBoardEventPayload, type TaskBoardSnapshot } from './protocol.ts'
import { projectSnapshotForWire } from './core/wire-projection.ts'
import type { CardDefaults } from './core/card-defaults.ts'
import { TaskBoardExtensionRegistry } from './host/extension-registry.ts'
import type { TaskBoardExtension } from './core/extension.ts'
import { isTaskPermission, normalizeTargetId, type ExecutionOutcome, type ExecutionSummary, type ScheduleMode, type TaskRecord, type TaskStatus } from './core/tasks.ts'
import type { ModelCatalogView } from './core/model-catalog.ts'
import type { TaskPermission } from './core/handover.ts'
import type { TaskAttachment } from './core/attachment.ts'
import {
  publishedAttachmentLimits,
  verifyAttachments,
  type ModelInfoResolver,
  type TaskBoardAttachmentStore,
} from './host/attachments.ts'

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
 * Why a member of a run never started: the Host stopped while its launch was
 * still waiting for an admission slot. Recorded rather than left open, so the
 * card leaves the running column instead of waiting for the next Host start's
 * interrupted-start recovery.
 */
const ABANDONED_LAUNCH_REASON = 'host stopped before this execution started'

/**
 * Why a rework could not launch: it redoes work in the card's own
 * conversation, so a session the Host cannot continue means there is nothing to
 * send the reviewer's instructions into. Starting a fresh conversation instead
 * would hand those instructions to an agent that never saw the work.
 */
const REWORK_SESSION_REASON = 'rework: the card\'s previous execution session is not present and idle in the host session roster, so there is no conversation to send the rework instructions into'

/**
 * The host model catalog one run group freezes, read once for the whole group.
 *
 * The catalog decides whether a card's pinned reasoning level may be sent, and
 * it is read BEFORE the session is prompted. Admission delays the launch, so
 * reading it per execution would let a catalog change made while later members
 * wait reach some members of one run and not others. Reading it once per run
 * group — at the group's first admission, which is its root's — keeps the whole
 * group on one catalog and still freezes it before any member is prompted.
 */
interface FrozenRunCatalog {
  /** The host model catalog the group's routes and reasoning levels resolve against. */
  catalog: ModelCatalogView | undefined
}

/** Reads (or returns the already-read) catalog of one run group. */
type RunCatalogFreezer = () => Promise<FrozenRunCatalog>

/**
 * Provenance of one cron-triggered run: when the rule fired and the zone
 * its wall clock was read in. Passed into every launched prompt of that run so
 * a scheduled job knows its own clock rather than inferring one.
 */
export interface ScheduledRunContext {
  triggeredAt: number
  timeZone: string
  /** Whether this fire came from a recurring rule or a single planned instant. */
  mode: ScheduleMode
  /** Cron expression of a recurring rule; absent on a one-shot. */
  cron?: string
}

/**
 * Actions that can change the instant the schedule timer is armed at. Only
 * these re-arm the native timer; an unrelated card edit leaves the pending fire
 * untouched.
 *
 * The set is the write surface of a rule itself rather than a guess at the UI
 * flows that reach it: `create` and `import` land a card that already carries
 * an enabled rule (the new-task dialog and the one-time browser import),
 * `set-schedule` edits one, and `delete`/`archive` drop one. `update` is
 * deliberately absent — the update patch cannot carry a schedule — and neither
 * can the run, move, lineage, permission or label actions.
 */
const SCHEDULE_WRITE_ACTIONS: ReadonlySet<TaskBoardAction['kind']> = new Set(['create', 'import', 'set-schedule', 'delete', 'archive'])

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

/**
 * The new-card defaults a snapshot publishes, or undefined when this
 * deployment configures none. A target the board configures nothing for is
 * omitted instead of published blank, so the browser can tell "no default
 * model" from "a blank one" (only a hand-edited settings document can express
 * the latter).
 */
function cardDefaultsOf(defaults: CardDefaults): TaskBoardSnapshot['cardDefaults'] {
  const mode = normalizeTargetId(defaults.mode)
  const permission = normalizeTargetId(defaults.permission)
  const model = normalizeTargetId(defaults.model)
  const reasoningEffort = normalizeTargetId(defaults.reasoningEffort)
  const published: NonNullable<TaskBoardSnapshot['cardDefaults']> = {
    ...(mode === undefined ? {} : { mode }),
    // The snapshot publishes a permission the board's own vocabulary knows; an
    // out-of-domain value is ignored here exactly as the create path ignores it.
    ...(isTaskPermission(permission) ? { permission } : {}),
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  return Object.keys(published).length === 0 ? undefined : published
}

/**
 * Every action kind this board accepts, keyed by the kind itself.
 *
 * Written as a total record of `TaskBoardAction['kind']` on purpose: a new member
 * of that union does not compile until it is listed here, so the table cannot
 * drift behind the protocol. `apply()` validates against it because a caller
 * reaching the board through the in-process capability face forwards its action
 * object verbatim, with no envelope parser in front of it — the HTTP route was the
 * only entrance before that face existed, and its parser is what used to turn an
 * unknown kind into a refusal.
 */
const ACTION_KINDS: Readonly<Record<TaskBoardAction['kind'], true>> = {
  import: true,
  create: true,
  update: true,
  delete: true,
  move: true,
  archive: true,
  restore: true,
  settle: true,
  'record-external-outcome': true,
  'set-schedule': true,
  run: true,
  rerun: true,
  rework: true,
  'confirm-permission': true,
  'set-parent': true,
  'rename-tag': true,
  'delete-tag': true,
  'extension-action': true,
}

/**
 * The attachments an action carries, or undefined when it carries none.
 *
 * Only a create and an update can carry attachments: an import refuses them
 * outright, and every other action kind has no attachment surface at all.
 */
function attachmentsOfAction(action: Exclude<TaskBoardAction, { kind: 'extension-action' }>): TaskAttachment[] | undefined {
  if (action.kind === 'create') return action.input.attachments
  if (action.kind === 'update') return action.patch.attachments ?? undefined
  return undefined
}

export class TaskBoardHostService {
  readonly ledger: HostTaskLedger
  readonly runner: HostExecutionRunner
  readonly power: PowerInhibitor
  /** The official attachment storage, read live so a late mount is honoured. */
  private readonly attachmentStore: () => TaskBoardAttachmentStore | undefined
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
   * Admission control for the session-creating half of a run: one board action
   * opens a whole subtree, and this is what keeps the Host from asking DSH for
   * every member's session at once (see {@link LaunchAdmissionQueue}).
   */
  private readonly launches: LaunchAdmissionQueue
  /**
   * Consecutive unreadable-history polls per open execution (see
   * {@link noteUnreadableInspection}). Cleared as soon as an inspection
   * resolves, so a transient reader failure never fails a card.
   */
  private readonly unreadablePolls = new Map<string, number>()
  private preventIdleSleep = false
  /** Live reader of the host model catalog; frozen per run group. */
  private readonly modelCatalog: () => Promise<ModelCatalogView | undefined>
  private readonly timers: HostTimerFace
  /** Live reader of the deployment's new-card defaults (published and applied per create). */
  private readonly cardDefaults: () => CardDefaults
  /**
   * Live reader of the run-launch admission width: how many launches may be in
   * flight at once. Read at every admission, so a settings edit bounds the next
   * launch without remounting the row. Absent means the default.
   */
  private readonly runLaunchWidth: () => number
  /**
   * Live reader of the daily token cap; 0 means no gate. Read at each run
   * action, so closing or raising the cap binds the next action.
   */
  private readonly spendBudgetTokens: () => number
  /** Today's measured spend: absent measurement reads as "cannot see", never as zero. */
  private readonly spendUsedToday: (now: number) => number | undefined
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
     * The owner peer every gateway request the runner makes speaks for.
     * Production passes the peer bound to the plugin fiber (see
     * {@link createOwnerPeer}); absent is fine for tests and bare mounts,
     * where the runner binds one to a fresh root context.
     */
    ownerPeer?: GatewayPeer
    /**
     * Permission baseline of the confirmation gate: a fixed value, or a live
     * resolver the board re-reads so a Host Settings change needs no remount.
     */
    sessionDefaultPermission?: TaskPermission | (() => TaskPermission)
    maxSubtaskDepth?: number
    /**
     * Live reader of the deployment's new-card defaults (volatile config reads).
     * The board publishes them for the create dialog and re-reads them for every
     * create that opts in, so a settings edit reaches the next created card
     * without remounting the row. Absent means the deployment configures none.
     */
    cardDefaults?: () => CardDefaults
    timers?: HostTimerFace
    /**
     * The host model catalog the card routes and reasoning levels resolve
     * against, read live so a deployment that mounts the model service after the
     * board still gains it. Absent means "no capability evidence": a pinned
     * effort is then not sent at all.
     */
    modelCatalog?: () => Promise<ModelCatalogView | undefined>
    /**
     * Live admission width for run launches: the number of launches (one
     * session creation and its prompt each) that may be in flight at once. Read
     * per admission, so editing the setting bounds the next launch of a run that
     * is still queueing. Absent means the default width.
     */
    runLaunchWidth?: () => number
    /**
     * Live daily token cap (a volatile config read). 0 — the default, and what
     * every deployment that never configured one keeps — ends the gate before
     * anything is measured. A positive cap refuses a run whose day already spent
     * it, on both the action path and the cron path.
     */
    spendBudgetTokens?: () => number
    /**
     * Today's measured spend in tokens, or undefined when this deployment keeps
     * no readable usage ledger. Defaults to the family usage ledger reader.
     */
    spendUsedToday?: (now: number) => number | undefined
    /**
     * The official attachment storage, read at request time. Absent means the
     * deployment stores no attachments: every attachment action is then
     * refused and the board publishes no attachment limits.
     */
    attachments?: () => TaskBoardAttachmentStore | undefined
    /**
     * The model-info reader the image preflight uses. Absent means the
     * deployment serves no model information, and a route whose modalities are
     * unknown is allowed.
     */
    modelInfo?: () => ModelInfoResolver | undefined
    /**
     * Whether this deployment runs the legacy Agent Teams runtime. Read at
     * launch, only for a run the board is about to force under the dispatcher
     * preset: such a deployment cannot orchestrate, so the run fails closed on
     * the card instead of deadlocking in a session nobody answers (issue #2031).
     * Absent means "not proven legacy", which keeps the force exactly as it is.
     */
    legacyAgentTeams?: () => boolean
  } = {}) {
    this.ledger = options.ledger ?? new HostTaskLedger(undefined, undefined, {
      sessionDefaultPermission: options.sessionDefaultPermission,
      maxSubtaskDepth: options.maxSubtaskDepth,
      cardDefaults: options.cardDefaults,
      spendBudgetTokens: options.spendBudgetTokens,
      spendUsedToday: options.spendUsedToday,
    })
    this.attachmentStore = options.attachments ?? (() => undefined)
    this.runner = new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry, undefined, options.ownerPeer, {
      attachments: this.attachmentStore,
      llm: options.modelInfo,
      ...(options.legacyAgentTeams === undefined ? {} : { legacyAgentTeams: options.legacyAgentTeams }),
    })
    this.workspaceRegistry = options.workspaceRegistry
    this.timers = options.timers ?? PROCESS_TIMERS
    this.power = options.power ?? new PowerInhibitor()
    this.now = options.now ?? Date.now
    this.cardDefaults = options.cardDefaults ?? (() => ({}))
    this.runLaunchWidth = options.runLaunchWidth ?? (() => DEFAULT_RUN_LAUNCH_WIDTH)
    this.spendBudgetTokens = options.spendBudgetTokens ?? (() => DEFAULT_SPEND_BUDGET_TOKENS)
    this.spendUsedToday = options.spendUsedToday ?? (now => usedTokensToday(now))
    this.launches = new LaunchAdmissionQueue(() => normalizeRunLaunchWidth(this.runLaunchWidth()))
    this.modelCatalog = options.modelCatalog ?? (async () => undefined)
    this.extensions = new TaskBoardExtensionRegistry({
      ledger: this.ledger,
      // Capability writes go through the board's own action path, so every
      // board gate (content freeze, running lock, permission gate) still holds.
      apply: (action, initiator) => this.applyBoardAction(crypto.randomUUID(), action, initiator),
      // Delivery into a run the board already owns is the runner's session wire
      // call, never a second execution path.
      followUp: (sessionId, text) => this.runner.followUp(sessionId, text),
      // A rework is a run request like any other: it opens its execution through
      // the same action path, so the running lock, the permission confirmation,
      // the acceptance contract and the spend cap all apply to it.
      rework: (taskId, instructions, initiator) => {
        this.applyBoardAction(crypto.randomUUID(), { kind: 'rework', taskId, instructions }, initiator)
      },
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

  /**
   * The board's published snapshot.
   *
   * Every read path serializes this object — the HTTP `state` answer, the
   * `action` answer through {@link apply}, and the remote bridge's
   * `board.snapshot` — so a provider's integration credentials are stripped
   * once, here, instead of at each exit. The ledger keeps them verbatim for the
   * provider's own in-process read.
   */
  snapshot(): TaskBoardSnapshot {
    const state = this.ledger.state()
    const published = this.extensions.published()
    const cardDefaults = cardDefaultsOf(this.cardDefaults())
    return projectSnapshotForWire({
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: state.revision,
      tasks: state.tasks,
      scheduler: state.scheduler,
      power: this.power.snapshot(),
      sessionDefaultPermission: this.ledger.sessionDefaultPermission,
      maxSubtaskDepth: this.ledger.maxSubtaskDepth,
      // The new-card defaults are published live: the create dialog prefills
      // from them, and each creating session re-reads them for the create it
      // submits.
      ...(cardDefaults === undefined ? {} : { cardDefaults }),
      // The attachment limits travel with the snapshot so the browser can
      // refuse an oversized selection before it uploads anything.
      ...(this.attachmentStore() === undefined ? {} : { attachmentLimits: publishedAttachmentLimits(this.attachmentStore()) }),
      ...(Object.keys(published).length === 0 ? {} : { extensions: published }),
    })
  }

  /**
   * Admit one external provider. Idempotent by extension id; the returned
   * disposer releases it (its stored data stays).
   */
  registerExtension(extension: TaskBoardExtension): () => void {
    return this.extensions.registerExtension(extension)
  }

  /**
   * The host model catalog the settings card's model and reasoning-level
   * choices come from.
   * @returns the catalog, or an empty one when this deployment serves none.
   */
  async modelCatalogOptions(): Promise<{ catalog: ModelCatalogView }> {
    const catalog = await this.modelCatalog()
    return { catalog: catalog ?? { groups: [] } }
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

  /**
   * Apply an action whose attachments the Host proved against the official
   * storage first.
   *
   * This is the board's trust boundary for attachment metadata: the browser
   * asserts the size, the type and the digest of every object it uploaded, and
   * the Host reads the stored objects back (an image is compared, a file is
   * streamed and its digest recomputed) before the ledger commits the claim.
   * An attachment the storage cannot prove is refused, so a spoofed client
   * claim never becomes a stored fact.
   */
  async applyVerified(requestId: string, action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot> {
    if (!this.active) throw new Error('task board is disabled')
    // A provider action never carries attachments: it is routed through the
    // registry exactly like every other extension call.
    if (action.kind === 'extension-action') return await this.apply(requestId, action, initiator)
    await this.verifyActionAttachments(action)
    return projectSnapshotForWire(this.applyBoardAction(requestId, action, initiator, true))
  }

  /**
   * Prove every attachment of an action against the official storage.
   *
   * An action without attachments is untouched: the board keeps working in a
   * deployment that serves no attachment storage at all.
   */
  private async verifyActionAttachments(action: Exclude<TaskBoardAction, { kind: 'extension-action' }>): Promise<void> {
    const attachments = attachmentsOfAction(action)
    if (attachments === undefined || attachments.length === 0) return
    const store = this.attachmentStore()
    if (store === undefined) throw new Error('this deployment serves no attachment storage')
    // The failure keeps its CLASS: a storage that is unavailable must reach
    // the caller as "the storage is unavailable" (503), not as a generic
    // rejected action (400).
    await verifyAttachments(store, attachments)
  }

  apply(requestId: string, action: Extract<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): Promise<TaskBoardSnapshot>
  apply(requestId: string, action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string): TaskBoardSnapshot
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot>
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot> {
    if (!this.active) throw new Error('task board is disabled')
    // A caller that never met the HTTP envelope parser can name a kind this build
    // does not implement. It is refused here, in the board's own vocabulary: the
    // ledger has no case for it, and letting it through committed an unchanged
    // document under a fresh revision — which every connected client then reloads
    // a whole snapshot for.
    const kind = (action as { kind?: unknown } | null | undefined)?.kind
    if (typeof kind !== 'string' || !Object.hasOwn(ACTION_KINDS, kind)) {
      throw new Error(`unknown task board action kind: ${String(kind)}`)
    }
    // Provider actions never touch the ledger directly: the registry routes the
    // action to the owning extension, whose own capability calls come back
    // through applyBoardAction and every board gate below.
    if (action.kind === 'extension-action') {
      return this.handleExtensionAction(action)
    }
    // The answer to a write is a read like any other — it crosses the same wire
    // (the HTTP action route and the remote bridge's board.apply) — so it leaves
    // through the same projection as snapshot().
    return projectSnapshotForWire(this.applyBoardAction(requestId, action, initiator))
  }

  /**
   * Apply one board-owned action with every gate intact. Provider capability
   * calls and the same-origin wire both land here, so the two surfaces can
   * never disagree about a card.
   */
  private applyBoardAction(requestId: string, action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string, attachmentVerified = false): TaskBoardSnapshot {
    // Attachments reach the ledger only through the VERIFIED action path: the
    // in-process capability face, the agent tools and the legacy import never
    // carry them, and an action that does is refused here rather than
    // committed without the storage proof.
    if (!attachmentVerified && attachmentsOfAction(action) !== undefined) {
      throw new Error('attachments must be applied through the verified attachment action route')
    }
    const before = this.statusMap()
    if (action.kind === 'run' || action.kind === 'rerun' || action.kind === 'rework') this.assertSpendCap()
    const result = this.ledger.applyRequest(requestId, this.withInheritedWorkspace(action, initiator), initiator)
    if (result.runs !== undefined) this.dispatchRuns(result.runs)
    // A committed write that can move a rule moves the nearest trigger;
    // re-arm from the ledger so a created or edited schedule fires at its own
    // instant instead of waiting out whatever target was armed before it. The
    // re-arm is derived from the ledger, so a write that moved nothing leaves
    // the pending fire exactly as it was.
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

  /**
   * Refuse a run whose day already spent the cap.
   *
   * A cap of 0 — the shipped default — answers before the measurement is read:
   * no ledger file is opened and nothing is summed, which is what keeps a board
   * that never configured a cap identical to the one before it existed.
   *
   * The refusal is a thrown message rather than a code: the wire hands its text
   * to the caller as board-refused, exactly like every other refusal this board
   * makes.
   */
  private assertSpendCap(): void {
    const cap = this.spendBudgetTokens()
    if (!(cap > 0)) return
    const used = this.spendUsedToday(this.now())
    if (used === undefined || !spendCapReached(used, cap)) return
    throw new Error(spendCapMessage(used, cap))
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
    // Launches still waiting for a slot can never start now: settle them so
    // their cards leave the running column here, instead of waiting for the
    // next Host start's interrupted-start recovery. Launches already in flight
    // are left to finish — their session may already exist.
    const abandoned = this.launches.drain()
    if (abandoned.length > 0) {
      safeConsoleError(`[dsh-task-board] ${abandoned.length} run member(s) were still waiting for a launch slot when the Host stopped; each is settled as cancelled`)
    }
    this.extensions.dispose()
    this.clearScheduleTimer()
    this.clearPollBackoff()
    this.pollTimer?.()
    this.pollTimer = undefined
    this.power.dispose()
    this.ledger.dispose()
    this.listeners.clear()
  }

  private async launch(opened: OpenedRun, schedule?: ScheduledRunContext, freezeCatalog?: RunCatalogFreezer): Promise<void> {
    /** The session this launch attached to the execution, once it exists. */
    let attached: string | undefined
    try {
      // One run opens ONE session: the card's own. Its unfinished subtasks are
      // dispatched from inside that session, so a card that carries them is
      // forced under the dispatcher preset and told which cards to pick up. The
      // force is applied here, per execution; the card's stored `mode` is
      // never rewritten by it.
      const forcedPreset = this.ledger.hasOutstandingDescendants(opened.task.id) ? LIANGSHEN_PRESET_ID : undefined
      const descendants = forcedPreset === undefined ? [] : this.ledger.outstandingDescendants(opened.task.id)
      // The rework this execution carries, when it carries one: it decides both
      // the session this run continues in and the section the prompt states.
      const rework = opened.execution.rework
      // A forced preset is not the card's own composition, so continuing a
      // session composed from another preset would be refused anyway: mint a
      // fresh one and run the tree the way this execution requires. A rework
      // has no such freedom — its whole point is the conversation the reviewer
      // read — so it fails instead of quietly opening a new one.
      let reuseSessionId: string | undefined
      if (rework === undefined) {
        reuseSessionId = forcedPreset === undefined ? await this.reuseSessionFor(opened.task) : undefined
      } else {
        if (forcedPreset !== undefined) throw new Error(REWORK_SESSION_REASON)
        reuseSessionId = await this.reworkSessionFor(opened.task)
      }
      // A cron-triggered run additionally states its own firing instant and
      // rule zone, so a scheduled job can resolve "today" without guessing.
      const contextParts = {
        ...(descendants.length === 0 ? {} : {
          descendants: descendants.map(descendant => ({
            id: descendant.id,
            title: descendant.title,
            status: descendant.status,
          })),
        }),
        ...(schedule === undefined ? {} : { schedule }),
        ...(rework === undefined ? {} : { rework }),
      }
      const promptContext = Object.keys(contextParts).length === 0 ? undefined : contextParts
      // Freeze this run group's model catalog BEFORE the session is prompted: a
      // catalog change made while the run is in flight must not change which
      // reasoning level this execution is allowed to send.
      //
      // The read is the run GROUP's when the queue handed one down: admission
      // delays a member's launch, so a per-execution read would let a change
      // made while later members wait reach some members of one run and not
      // others. One group, one catalog — and still frozen before the group's
      // first session is prompted.
      const { catalog } = await (freezeCatalog ?? (() => this.readRunCatalog()))()
      const sessionId = await this.runner.launch(opened.task, {
        ...(reuseSessionId === undefined ? {} : { reuseSessionId }),
        ...(forcedPreset === undefined ? {} : { agentPreset: forcedPreset }),
        ...(promptContext === undefined ? {} : { promptContext }),
        // The same catalog snapshot the reasoning decision is resolved from.
        catalog,
        // Bind the session to the execution before the prompt is queued.
        onSession: (id) => {
          attached = id
          this.ledger.attachSession(opened.task.id, opened.execution.id, id)
        },
      })
      if (attached === undefined) this.ledger.attachSession(opened.task.id, opened.execution.id, sessionId)
    } catch (error) {
      const launchedSession = error instanceof SessionLaunchError ? error.sessionId : undefined
      if (launchedSession !== undefined) {
        this.ledger.attachSession(opened.task.id, opened.execution.id, launchedSession)
      }
      // A scheduled occurrence that failed before any session existed created
      // no real execution: refund the run it consumed and record why, so a
      // failed launch can never silently spend the user's run budget. A manual
      // run, and a launch that DID reach a session, are never refunded.
      if (schedule !== undefined && attached === undefined && launchedSession === undefined) {
        this.refundUnstartedSchedule(opened.task.id)
      }
      this.settleAndNotify(opened.task.id, opened.execution.id, 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Read the model catalog one run group freezes. The catalog is what decides
   * whether a card's pinned reasoning level may be sent to the session.
   */
  private async readRunCatalog(): Promise<FrozenRunCatalog> {
    return { catalog: await this.modelCatalog() }
  }

  /**
   * A {@link RunCatalogFreezer} that reads once and hands the SAME value to
   * every later caller of one run group. A read that fails is not cached: the
   * next member reads again, exactly as a per-execution read would have.
   */
  private catalogFreezerForRunGroup(): RunCatalogFreezer {
    let pending: Promise<FrozenRunCatalog> | undefined
    return () => {
      pending ??= this.readRunCatalog().catch((error: unknown) => {
        pending = undefined
        throw error
      })
      return pending
    }
  }

  /**
   * Give back the occurrence a launch consumed, for a launch that never reached
   * a session: a failed launch, or one the Host abandoned while it was still
   * waiting for an admission slot. A manual run, and a launch that DID reach a
   * session, are never refunded.
   */
  private refundUnstartedSchedule(taskId: string): void {
    this.ledger.refundScheduledOccurrence(taskId, this.now())
    // The refund runs after the fire already armed the next target, and a
    // refunded occurrence can restore one the fire had just cleared (a rule
    // that spent its last run). Re-arm so the restored occurrence is served
    // at its own instant rather than lost until some unrelated write.
    this.refreshSchedule()
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
   * @param force - continue the settled session regardless of the card's own
   *   opt-in (a rework), which the reuse rule accepts without waiving any of its
   *   evidence conditions.
   * @returns the session id to continue in, or undefined for a fresh session.
   */
  private async reuseSessionFor(task: TaskRecord, force?: boolean): Promise<string | undefined> {
    if (task.reuseSession !== true && force !== true) return undefined
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
    return reusableSessionId(
      task,
      new Set(running.items.filter(item => !item.running).map(item => item.sessionId)),
      force === true ? { force: true } : {},
    )
  }

  /**
   * The session a rework continues, or the refusal that says why it cannot.
   *
   * A rework exists for one conversation — the one the reviewer read before
   * sending the work back — so the evidence that this Host still reaches it is
   * required, exactly as it is for a card that opted into reuse. What a rework
   * does NOT get is the fresh-conversation fallback: launching there would hand
   * the reviewer's instructions to an agent that never saw the work, so the run
   * fails with a readable reason instead.
   * @param task - the card being reworked.
   * @returns the session id this rework continues in.
   */
  private async reworkSessionFor(task: TaskRecord): Promise<string> {
    const sessionId = await this.reuseSessionFor(task, true)
    if (sessionId === undefined) throw new Error(REWORK_SESSION_REASON)
    return sessionId
  }

  /** Reuse the session list this poll already fetched: one list RPC per tick, not 1 + E. */
  private async reconcileExecutions(
    sessions: readonly SessionSummary[],
    executions: readonly OpenExecutionReference[],
  ): Promise<void> {
    for (const execution of executions) {
      if (execution.sessionId === undefined) continue
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
        // The run's closing text rides whichever verdict it earned: a failed
        // execution still leaves what it managed to say.
        this.settleAndNotify(execution.taskId, execution.executionId, result.outcome, 'error' in result ? result.error : undefined, result.summary)
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
  private settleAndNotify(taskId: string, executionId: string, outcome: ExecutionOutcome, error?: string, summary?: ExecutionSummary): void {
    const before = this.ledger.getTask(taskId)
    if (before?.executions.find(entry => entry.id === executionId)?.endedAt !== undefined) {
      // Already settled: the ledger would no-op, and re-emitting would report
      // the same settlement twice.
      this.ledger.settle(taskId, executionId, outcome, error, summary)
      return
    }
    // One settlement can move more than the settled card: a run whose own card
    // is terminal also writes the inherited verdict onto the subtasks it never
    // dispatched. Compare the whole board so the provider events cover those too.
    const statuses = this.statusMap()
    this.ledger.settle(taskId, executionId, outcome, error, summary)
    this.emitStatusChanges(statuses)
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
      // The ledger owns both the budget gate and the next target: it refuses a
      // rule that already spent its runs and stops a one-shot as it fires.
      this.dispatchRuns(
        this.ledger.openScheduled(schedule.taskId, now),
        {
          triggeredAt: now,
          timeZone: schedule.timeZone,
          mode: schedule.mode,
          ...(schedule.cron === undefined ? {} : { cron: schedule.cron }),
        },
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
   * Launch the one run a run request opened. A run request names one card and
   * opens one execution for it; the card's own session dispatches its subtasks
   * as subagents, so nothing else is enqueued here.
   *
   * The launch still goes through the admission queue, which admits at most
   * `runLaunchWidth` launches at a time — that bound now applies across
   * concurrent runs rather than across the members of one run.
   */
  private dispatchRuns(runs: readonly OpenedRun[], schedule?: ScheduledRunContext): void {
    const root = runs[0]
    if (root === undefined) return
    this.scheduleLaunch(root, schedule, this.catalogFreezerForRunGroup())
  }

  private scheduleLaunch(opened: OpenedRun, schedule?: ScheduledRunContext, freezeCatalog?: RunCatalogFreezer): void {
    this.enqueueLaunch(opened, () => this.launch(opened, schedule, freezeCatalog).catch(error => {
      safeConsoleError('[dsh-task-board] execution launch settlement failed', error)
    }), schedule)
  }

  /**
   * Hand one launch to the admission queue, or abandon it on the spot when the
   * Host is already stopping: a queue entry created after {@link dispose} would
   * otherwise never be drained, and its card would sit in the running column
   * until the next Host start recovered it.
   */
  private enqueueLaunch(opened: OpenedRun, start: () => Promise<void>, schedule?: ScheduledRunContext): void {
    const launch: QueuedLaunch = {
      groupId: opened.execution.runGroupId ?? opened.task.id,
      start: async () => {
        // Waiting for a slot is time the execution can be settled in: a manual
        // settle, or a team run folded onto its Lead's verdict, can close a
        // member's execution before it ever started. Starting it then would
        // create a session no execution is watching, so a launch whose
        // execution is already closed is dropped instead.
        if (!this.isExecutionOpen(opened)) return
        await start()
      },
      abandon: () => this.abandonQueuedRun(opened, schedule),
    }
    if (this.disposed) {
      launch.abandon()
      return
    }
    this.launches.enqueue(launch)
  }

  /** Whether one opened execution is still open in the ledger. */
  private isExecutionOpen(opened: OpenedRun): boolean {
    const execution = this.ledger.getTask(opened.task.id)?.executions.find(entry => entry.id === opened.execution.id)
    return execution !== undefined && execution.endedAt === undefined
  }

  /**
   * Take one launch that never started out of the running column.
   *
   * Settled as CANCELLED, not failed: nothing about the run's work went wrong —
   * the Host stopped before the launch got a slot, which is exactly what the
   * next start's interrupted-start recovery records for an execution that never
   * reached a session. A scheduled occurrence that never reached a session is
   * refunded on the same terms as any other pre-session failure, so a run the
   * Host never started cannot silently spend the user's run budget.
   */
  private abandonQueuedRun(opened: OpenedRun, schedule?: ScheduledRunContext): void {
    if (schedule !== undefined) this.refundUnstartedSchedule(opened.task.id)
    this.settleAndNotify(opened.task.id, opened.execution.id, 'cancelled', ABANDONED_LAUNCH_REASON)
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
