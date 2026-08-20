/**
 * Board controller: the single owner of task-ledger state and view state.
 *
 * In production it projects the Host ledger and submits confirmed actions;
 * the legacy store/execution seams remain for v1 migration tests. It also
 * closes the board whenever the user navigates to a session.
 * Framework-free (structural runtime faces) so the whole orchestration is
 * unit-testable with fakes.
 *
 * The per use-case domain transitions (create/update/delete/schedule) live in
 * dedicated modules under core/use-cases and are applied here; the controller
 * owns only the orchestration seam (state, persistence, notify, execution,
 * navigation, reconciliation).
 */
import type { ExecutionEvent, ExecutionService } from './execution.ts'
import type { TaskStore } from './store.ts'
import {
  settleExecution, startExecution, withStatus,
  type NewTaskInput, type TaskRecord, type TaskStatus,
} from './tasks.ts'
import { applyArchiveTask, applyRestoreTask } from './use-cases/task-archive.ts'
import { applyCreateTask } from './use-cases/task-create.ts'
import { applyDeleteTask } from './use-cases/task-delete.ts'
import { applyScheduleNextRun as applyScheduleRollForward, applySetSchedule } from './use-cases/task-schedule.ts'
import { applyUpdateTask, type TaskUpdatePatch } from './use-cases/task-update.ts'
import type { TaskBoardAction, TaskBoardEventPayload, TaskBoardSnapshot } from '../protocol.ts'

export interface TaskBoardTransport {
  bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot>
  state(): Promise<TaskBoardSnapshot>
  action(action: TaskBoardAction): Promise<TaskBoardSnapshot>
  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void
}

/** The sessions face the controller needs for navigation awareness. */
export interface SessionsControllerFace {
  list: {
    getSnapshot(): { current: string | undefined }
    subscribe(fn: () => void): () => void
  }
  /** Select a session as current (navigates the conversation view). */
  open(id: string): void
}

/** Controller dependencies (all swappable in tests). */
export interface ControllerDeps {
  store: TaskStore
  /** Legacy browser execution seam used only by isolated v1 tests. */
  exec?: ExecutionService
  sessions: SessionsControllerFace
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** Id minting; defaults to a random-uuid. */
  uuid?: () => string
  /** Debounce (ms) for session-list-changed reconciles; defaults to 350. */
  reconcileDebounceMs?: number
  /** Host-authoritative transport; absent keeps the legacy in-memory test path. */
  transport?: TaskBoardTransport
}

/** One workspace option the execution-target pickers offer. */
export interface ExecutionWorkspaceOption {
  workspaceId: string
  /** Display label (workspace title; the wiring falls back to the path). */
  title: string
}

/** One agent-preset option the execution-target pickers offer. */
export interface ExecutionPresetOption {
  id: string
  name?: string
  description?: string
  /** Why this preset cannot compose a session; the pickers disable it. */
  broken?: string
  isDefault: boolean
}

/** The execution-target option sets the UI feeds into the controller. */
export interface ExecutionOptionsSnapshot {
  workspaces: readonly ExecutionWorkspaceOption[]
  presets: readonly ExecutionPresetOption[]
}

/** Immutable controller snapshot for UI subscriptions. */
export interface ControllerSnapshot {
  tasks: readonly TaskRecord[]
  boardOpen: boolean
  /** True when the board shows the archive view instead of the columns. */
  archiveView: boolean
  selectedTaskId: string | undefined
  /** Picker option sets (workspace list + agent-preset roster). */
  executionOptions: ExecutionOptionsSnapshot
  pendingTaskIds: readonly string[]
  transportError?: string
  host?: Pick<TaskBoardSnapshot, 'revision' | 'scheduler' | 'power'>
}

/** The selected task (resolved from the ledger), or undefined. */
export function selectedTaskOf(snapshot: ControllerSnapshot): TaskRecord | undefined {
  if (snapshot.selectedTaskId === undefined) return undefined
  return snapshot.tasks.find(task => task.id === snapshot.selectedTaskId)
}

function randomUuid(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (randomUUID !== undefined) {
    return randomUUID.call(globalThis.crypto!)
  }
  const bytes = globalThis.crypto?.getRandomValues(new Uint8Array(16))
  if (bytes === undefined) {
    // Non-secure fallback (tests, odd environments).
    return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Read the current selection off a session-list snapshot (structural). */
function currentOf(sessions: SessionsControllerFace): string | undefined {
  return sessions.list.getSnapshot().current
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Board controller (see module doc). All mutations bump the snapshot and
 * persist through the store; UI and DOM mounts subscribe and re-render.
 */
export class BoardController {
  private tasks: TaskRecord[] = []
  private boardOpen = false
  private archiveView = false
  private selectedTaskId: string | undefined
  private executionOptions: ExecutionOptionsSnapshot = { workspaces: [], presets: [] }
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly pendingTaskIds = new Set<string>()
  private readonly taskQueues = new Map<string, Promise<void>>()
  private transportError: string | undefined
  private hostState: Pick<TaskBoardSnapshot, 'revision' | 'scheduler' | 'power'> | undefined
  private remoteSubscribed = false
  private remoteInitialization: Promise<boolean> | undefined

  /** @param deps - store, execution service, and the sessions navigation face. */
  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.uuid = deps.uuid ?? randomUuid
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    if (this.deps.transport !== undefined) {
      void this.initializeRemote()
    } else {
      void this.reconcileRunningTasks()
    }
    // A sibling tab may have edited or deleted the ledger (same origin,
    // storage events). Reload on external change so a task deleted in
    // another tab stops firing here — and is never written back by this
    // tab's stale copy (scheduler roll-forward, execution settlement).
    const unsubscribeExternal = this.deps.transport === undefined ? this.deps.store.subscribeExternal?.(() => {
      this.tasks = this.deps.store.load()
      this.notify()
    }) : undefined
    if (unsubscribeExternal !== undefined) this.disposers.push(unsubscribeExternal)
    this.disposers.push(this.deps.sessions.list.subscribe(() => {
      this.onSessionsChanged()
    }))
    this.notify()
  }

  /** Stop all subscriptions and drop retained state (idempotent). */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.listeners.clear()
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer)
    this.reconcileTimer = undefined
  }

  // --- snapshot / subscription ------------------------------------------------

  getSnapshot(): ControllerSnapshot {
    return {
      tasks: this.tasks,
      boardOpen: this.boardOpen,
      archiveView: this.archiveView,
      selectedTaskId: this.selectedTaskId,
      executionOptions: this.executionOptions,
      pendingTaskIds: [...this.pendingTaskIds],
      ...(this.transportError === undefined ? {} : { transportError: this.transportError }),
      ...(this.hostState === undefined ? {} : { host: this.hostState }),
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  /** Whether production mutations are confirmed by the Host transport. */
  isHostBacked(): boolean {
    return this.deps.transport !== undefined
  }

  /** Retry initial migration/state synchronization after an explicit Host error. */
  async retryHostSync(): Promise<boolean> {
    return await this.initializeRemote()
  }

  // --- view state -------------------------------------------------------------

  openBoard(): void {
    if (this.boardOpen) return
    // Baseline the selection the board opened against: the board stays open
    // until the user navigates (selection changes), never on mere status
    // updates of the already-selected session.
    this.lastCurrent = currentOf(this.deps.sessions)
    this.boardOpen = true
    this.notify()
  }

  closeBoard(): void {
    if (!this.boardOpen) return
    this.boardOpen = false
    this.notify()
  }

  toggleBoard(): void {
    if (this.boardOpen) this.closeBoard()
    else this.openBoard()
  }

  /**
   * Switch between the kanban columns and the archive view. Leaving the
   * archive view with an archived task still selected closes the selection —
   * the detail overlay must not linger over a task that is off-board.
   */
  toggleArchiveView(): void {
    this.archiveView = !this.archiveView
    if (!this.archiveView && this.selectedTaskId !== undefined) {
      const selected = this.tasks.find(task => task.id === this.selectedTaskId)
      if (selected?.archivedAt !== undefined) this.selectedTaskId = undefined
    }
    this.notify()
  }

  openTask(id: string): void {
    if (this.tasks.some(task => task.id === id)) {
      this.selectedTaskId = id
      this.notify()
    }
  }

  closeTask(): void {
    if (this.selectedTaskId === undefined) return
    this.selectedTaskId = undefined
    this.notify()
  }

  // --- task mutations (use-case transitions in core/use-cases) -----------------

  createTask(input: NewTaskInput): TaskRecord | undefined {
    const id = this.uuid()
    const { task, tasks } = applyCreateTask(this.tasks, input, this.now(), id)
    if (task === undefined) return undefined
    this.tasks = [...tasks]
    this.persistAndNotify()
    return task
  }

  /** Create through the Host and expose the task only after confirmation. */
  async createTaskConfirmed(input: NewTaskInput): Promise<TaskRecord | undefined> {
    if (this.deps.transport === undefined) return this.createTask(input)
    const id = this.uuid()
    const preview = applyCreateTask(this.tasks, input, this.now(), id).task
    if (preview === undefined) return undefined
    return await this.commitRemote({ kind: 'create', id, input }, id)
      ? this.tasks.find(task => task.id === id)
      : undefined
  }

  updateTask(id: string, patch: TaskUpdatePatch): void {
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'update', taskId: id, patch }, id)
      return
    }
    this.tasks = [...applyUpdateTask(this.tasks, id, patch, this.now())]
    this.persistAndNotify()
  }

  /**
   * Replace (a part of) the picker option sets the UI feeds (workspace list
   * and agent-preset roster come from the runtime, not the ledger).
   */
  setExecutionOptions(patch: Partial<ExecutionOptionsSnapshot>): void {
    this.executionOptions = { ...this.executionOptions, ...patch }
    this.notify()
  }

  moveTask(id: string, status: TaskStatus): void {
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'move', taskId: id, status }, id)
      return
    }
    this.tasks = this.tasks.map(task => task.id === id ? withStatus(task, status, this.now()) : task)
    this.persistAndNotify()
  }

  deleteTask(id: string): void {
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'delete', taskId: id }, id)
      return
    }
    const { tasks, selectionCleared } = applyDeleteTask(this.tasks, this.selectedTaskId, id)
    this.tasks = [...tasks]
    if (selectionCleared) this.selectedTaskId = undefined
    this.persistAndNotify()
  }

  /**
   * Archive a settled task (done/failed). Running or on-board-unsettled
   * tasks are refused so the runner keeps exclusive ownership of their
   * lifecycle.
   * @returns true when applied.
   */
  archiveTask(id: string): boolean {
    const { tasks, archived } = applyArchiveTask(this.tasks, id, this.now())
    if (!archived) return false
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'archive', taskId: id }, id)
      return true
    }
    this.tasks = [...tasks]
    this.persistAndNotify()
    return true
  }

  /** Restore an archived task back onto the board (same status column). */
  restoreTask(id: string): boolean {
    const { tasks, archived } = applyRestoreTask(this.tasks, id, this.now())
    if (!archived) return false
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'restore', taskId: id }, id).then(restored => {
        if (restored && this.selectedTaskId === id) this.closeTask()
      })
      return true
    }
    this.tasks = [...tasks]
    if (this.selectedTaskId === id) this.selectedTaskId = undefined
    this.persistAndNotify()
    return true
  }

  // --- scheduling ---------------------------------------------------------------

  /**
   * Update a task's schedule rule. A blank or invalid cron expression is
   * rejected (returns false, state untouched). When the rule ends up enabled
   * the next run instant is computed immediately; a disabled rule carries no
   * next-run instant. Delegates the domain transition to the schedule use case.
   * @param id - the task to schedule.
   * @param patch - fields to change (absent fields keep their current value).
   * @returns true when applied, false when rejected (invalid cron / unknown task).
   */
  setSchedule(id: string, patch: { enabled?: boolean; cron?: string }): boolean {
    const { tasks, applied } = applySetSchedule(this.tasks, id, patch, this.now())
    if (!applied) return false
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'set-schedule', taskId: id, patch }, id)
      return true
    }
    this.tasks = [...tasks]
    this.persistAndNotify()
    return true
  }

  /**
   * Legacy pure-controller seam retained for migration-focused tests. The
   * production browser never rolls schedules; the Host ledger owns them.
   */
  applyScheduleNextRun(id: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): void {
    const next = applyScheduleRollForward(this.tasks, id, nextRunAt, lastTriggeredAt, this.now())
    this.tasks = [...next]
    this.persistAndNotify()
  }

  /**
   * Reload the legacy v1 store without notifying subscribers. Production v2
   * reads Host snapshots instead; this remains only for isolated legacy tests.
   */
  reloadFromStore(): void {
    this.tasks = this.deps.store.load()
  }

  /**
   * Jump to an execution's session transcript. Selecting the session changes
   * `current`, which closes the board (the conversation view takes over).
   * @param sessionId - the execution session to open.
   */
  openSession(sessionId: string): void {
    this.deps.sessions.open(sessionId)
  }

  // --- execution ---------------------------------------------------------------

  /**
   * Execute a task for real: move it to 'running', open an execution record,
   * and hand off to the ExecutionService. A second call while the task is
   * already running is ignored.
   */
  async runTask(id: string): Promise<boolean> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined || task.archivedAt !== undefined || task.status === 'running') return false
    if (this.deps.transport !== undefined) {
      return await this.commitRemote({ kind: 'run', taskId: id }, id)
    }
    const { task: next, execution } = startExecution(task, this.now(), this.uuid())
    this.tasks = this.tasks.map(candidate => candidate.id === id ? next : candidate)
    this.persistAndNotify()
    // This page owns the settlement of its own launches: the live watch
    // (ExecutionService.run) settles on the turn boundary, and list
    // reconciliation must not pre-empt it with a session that has not
    // started a turn yet (its list row is idle, not completed).
    this.activeExecutionIds.add(execution.id)
    if (this.deps.exec === undefined) throw new Error('legacy execution service is unavailable')
    await this.deps.exec.run(next, execution, (event) => { this.handleExecutionEvent(event) })
    return true
  }

  /** Re-run a settled task: move it back to 'todo' first, then execute. */
  async rerunTask(id: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined || task.archivedAt !== undefined) return
    if (this.deps.transport !== undefined) {
      await this.commitRemote({ kind: 'rerun', taskId: id }, id)
      return
    }
    if (task.status !== 'running') {
      this.tasks = this.tasks.map(candidate => candidate.id === id ? withStatus(candidate, 'todo', this.now()) : candidate)
      this.persistAndNotify()
    }
    await this.runTask(id)
  }

  private handleExecutionEvent(event: ExecutionEvent): void {
    if (event.kind === 'started') {
      this.tasks = this.tasks.map(task => task.id === event.taskId
        ? attachSessionId(task, event.executionId, event.sessionId, this.now())
        : task)
      this.persistAndNotify()
      return
    }
    this.activeExecutionIds.delete(event.executionId)
    this.tasks = this.tasks.map(task => task.id === event.taskId
      ? settleExecution(task, event.executionId, event.outcome, this.now(), event.error)
      : task)
    this.persistAndNotify()
  }

  // --- internals ---------------------------------------------------------------

  /** Reconcile running tasks and close the board when the user navigates. */
  private onSessionsChanged(): void {
    // Background/leftover executions settle through the session list (their
    // conversation snapshots stay cold until opened). Coalesce the burst of
    // list notifications into one reconcile pass instead of fanning out a
    // history read per notification; see scheduleReconcile.
    if (this.deps.transport === undefined) this.scheduleReconcile()
    if (!this.boardOpen) return
    const current = currentOf(this.deps.sessions)
    if (current !== this.lastCurrent) this.closeBoard()
    this.lastCurrent = current
  }

  private lastCurrent: string | undefined = undefined

  /** Execution ids launched on this page; they settle via their live watch, never list reconciliation. */
  private readonly activeExecutionIds = new Set<string>()

  /** Debounce timer for {@link reconcileRunningTasks}. */
  private reconcileTimer: ReturnType<typeof setTimeout> | undefined = undefined

  /** Whether a reconcile pass is underway (single-flight guard). */
  private reconcileInFlight = false

  /**
   * Debounce + single-flight trigger for the running-task reconciliation.
   * Session-list notifications arrive in bursts (one per session status
   * change); both guards together keep a burst from reading the history API
   * once per running task.
   */
  private scheduleReconcile(): void {
    if (this.reconcileTimer !== undefined) return
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined
      void this.reconcileRunningTasks()
    }, this.deps.reconcileDebounceMs ?? 350)
  }

  /** Settle tasks left 'running' whose sessions already finished. */
  private async reconcileRunningTasks(): Promise<void> {
    if (this.deps.exec === undefined) return
    if (this.reconcileInFlight) {
      // A session change arrived while a pass was in flight. The in-flight
      // pass already captured the task list it iterates and will not revisit
      // this task, so dropping the notification would leave it stuck
      // 'running'. Re-arm the debounce so the change is reconciled once the
      // current pass settles.
      this.scheduleReconcile()
      return
    }
    this.reconcileInFlight = true
    try {
      type Settled = Extract<ExecutionEvent, { kind: 'settled' }>
      const events: Array<{ taskId: string; event: Settled }> = []
      for (const task of this.tasks) {
        if (task.status !== 'running') continue
        const execution = task.executions[task.executions.length - 1]
        // Runs launched on this page settle through their live watch (turn
        // boundary); reconciliation exists for background/leftover runs.
        if (execution !== undefined && this.activeExecutionIds.has(execution.id)) continue
        const event = await this.deps.exec.reconcile(task)
        if (event !== undefined && event.kind === 'settled') events.push({ taskId: task.id, event })
      }
      if (events.length === 0) return
      let changed = false
      for (const { taskId, event } of events) {
        // The reconcile call above awaited: a sibling tab may have rewritten
        // the ledger (storage event reload) meanwhile. Re-read the freshest
        // record now so the stale task captured before the await can never
        // overwrite fields the sibling wrote.
        const task = this.tasks.find(candidate => candidate.id === taskId)
        if (task === undefined) continue
        const next = settleExecution(task, event.executionId, event.outcome, this.now(), event.error)
        if (next === task) continue
        this.tasks = this.tasks.map(candidate => candidate.id === taskId ? next : candidate)
        changed = true
      }
      if (changed) this.persistAndNotify()
    } finally {
      this.reconcileInFlight = false
    }
  }

  private persistAndNotify(): void {
    if (this.deps.transport === undefined) this.deps.store.save(this.tasks)
    this.notify()
  }

  private async commitRemote(action: TaskBoardAction, taskId?: string): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    if (taskId === undefined) return await this.performRemote(action)
    const previous = this.taskQueues.get(taskId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => await this.performRemote(action))
    const tail = operation.then(() => {}, () => {})
    this.taskQueues.set(taskId, tail)
    this.pendingTaskIds.add(taskId)
    this.notify()
    try {
      return await operation
    } finally {
      if (this.taskQueues.get(taskId) === tail) {
        this.taskQueues.delete(taskId)
        this.pendingTaskIds.delete(taskId)
        this.notify()
      }
    }
  }

  private async performRemote(action: TaskBoardAction): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    this.transportError = undefined
    this.notify()
    try {
      const accepted = this.acceptRemote(await transport.action(action))
      return accepted || await this.refreshRemote()
    } catch (error) {
      await this.refreshRemote(messageOf(error))
      return false
    }
  }

  private async initializeRemote(): Promise<boolean> {
    if (this.remoteInitialization !== undefined) return await this.remoteInitialization
    const initialization = this.doInitializeRemote()
    this.remoteInitialization = initialization
    try {
      return await initialization
    } finally {
      if (this.remoteInitialization === initialization) this.remoteInitialization = undefined
    }
  }

  private async doInitializeRemote(): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    try {
      this.acceptRemote(await transport.bootstrap(this.tasks))
      if (!this.remoteSubscribed) {
        this.remoteSubscribed = true
        this.disposers.push(transport.subscribe((event) => { this.onRemoteEvent(event) }))
      }
      return true
    } catch (error) {
      this.transportError = messageOf(error)
      this.notify()
      return false
    }
  }

  /**
   * SSE frames carry revision/scheduler/power. When the revision matches the
   * one already applied, apply the frame's scheduler/power in place and skip
   * the full /state fetch; otherwise the 5 s heartbeat would re-clone and
   * re-serialize the whole ledger per tab even while nothing changes.
   */
  private onRemoteEvent(event: TaskBoardEventPayload | undefined): void {
    if (event !== undefined && this.hostState !== undefined && event.revision === this.hostState.revision
      && typeof event.scheduler === 'object' && event.scheduler !== null
      && typeof event.power === 'object' && event.power !== null) {
      this.hostState = { revision: event.revision, scheduler: event.scheduler, power: event.power }
      this.notify()
      return
    }
    void this.refreshRemote()
  }

  private async refreshRemote(preserveError?: string): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    try {
      this.acceptRemote(await transport.state())
      if (preserveError !== undefined) {
        this.transportError = preserveError
        this.notify()
      }
      return true
    } catch (error) {
      this.transportError = preserveError ?? messageOf(error)
      this.notify()
      return false
    }
  }

  private acceptRemote(snapshot: TaskBoardSnapshot): boolean {
    const currentLedgerId = this.hostState?.scheduler.ledgerId
    const nextLedgerId = snapshot.scheduler.ledgerId
    const sameGeneration = currentLedgerId === nextLedgerId
    if (sameGeneration && this.hostState !== undefined && snapshot.revision < this.hostState.revision) return false
    this.tasks = [...snapshot.tasks]
    this.hostState = { revision: snapshot.revision, scheduler: snapshot.scheduler, power: snapshot.power }
    this.transportError = undefined
    if (this.selectedTaskId !== undefined && !this.tasks.some(task => task.id === this.selectedTaskId)) {
      this.selectedTaskId = undefined
    }
    if (!this.archiveView && this.selectedTaskId !== undefined
      && this.tasks.find(task => task.id === this.selectedTaskId)?.archivedAt !== undefined) {
      this.selectedTaskId = undefined
    }
    this.notify()
    return true
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** Record which session ran an execution (once the execution service reports it). */
function attachSessionId(
  task: TaskRecord,
  executionId: string,
  sessionId: string,
  now: number,
): TaskRecord {
  return {
    ...task,
    updatedAt: now,
    executions: task.executions.map(execution =>
      execution.id === executionId ? { ...execution, sessionId } : execution),
  }
}
