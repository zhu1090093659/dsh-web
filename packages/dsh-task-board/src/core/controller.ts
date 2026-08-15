/**
 * Board controller: the single owner of task-ledger state and view state.
 *
 * It keeps the ledger in memory, persists every mutation through the
 * {@link TaskStore}, drives real executions through the
 * {@link ExecutionService}, and closes the board view whenever the user
 * navigates to a session (the sessions-list `current` selection changes).
 * Framework-free (structural runtime faces) so the whole orchestration is
 * unit-testable with fakes.
 *
 * The per use-case domain transitions (create/update/delete/schedule) live in
 * dedicated modules under core/use-cases and are applied here; the controller
 * owns only the orchestration seam (state, persistence, notify, execution,
 * navigation, reconciliation).
 */
import { ExecutionService, type ExecutionEvent } from './execution.ts'
import type { TaskStore } from './store.ts'
import {
  settleExecution, startExecution, withStatus,
  type NewTaskInput, type TaskRecord, type TaskStatus,
} from './tasks.ts'
import { applyCreateTask } from './use-cases/task-create.ts'
import { applyDeleteTask } from './use-cases/task-delete.ts'
import { applyScheduleNextRun as applyScheduleRollForward, applySetSchedule } from './use-cases/task-schedule.ts'
import { applyUpdateTask, type TaskUpdatePatch } from './use-cases/task-update.ts'

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
  exec: ExecutionService
  sessions: SessionsControllerFace
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** Id minting; defaults to a random-uuid. */
  uuid?: () => string
  /** Debounce (ms) for session-list-changed reconciles; defaults to 350. */
  reconcileDebounceMs?: number
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
  selectedTaskId: string | undefined
  /** Picker option sets (workspace list + agent-preset roster). */
  executionOptions: ExecutionOptionsSnapshot
}

/** The selected task (resolved from the ledger), or undefined. */
export function selectedTaskOf(snapshot: ControllerSnapshot): TaskRecord | undefined {
  if (snapshot.selectedTaskId === undefined) return undefined
  return snapshot.tasks.find(task => task.id === snapshot.selectedTaskId)
}

function randomUuid(): string {
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

/**
 * Board controller (see module doc). All mutations bump the snapshot and
 * persist through the store; UI and DOM mounts subscribe and re-render.
 */
export class BoardController {
  private tasks: TaskRecord[] = []
  private boardOpen = false
  private selectedTaskId: string | undefined
  private executionOptions: ExecutionOptionsSnapshot = { workspaces: [], presets: [] }
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private readonly now: () => number
  private readonly uuid: () => string

  /** @param deps - store, execution service, and the sessions navigation face. */
  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.uuid = deps.uuid ?? randomUuid
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    void this.reconcileRunningTasks()
    // A sibling tab may have edited or deleted the ledger (same origin,
    // storage events). Reload on external change so a task deleted in
    // another tab stops firing here — and is never written back by this
    // tab's stale copy (scheduler roll-forward, execution settlement).
    const unsubscribeExternal = this.deps.store.subscribeExternal?.(() => {
      this.tasks = this.deps.store.load()
      this.notify()
    })
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
      selectedTaskId: this.selectedTaskId,
      executionOptions: this.executionOptions,
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
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
    const { task, tasks } = applyCreateTask(this.tasks, input, this.now(), this.uuid())
    if (task === undefined) return undefined
    this.tasks = [...tasks]
    this.persistAndNotify()
    return task
  }

  updateTask(id: string, patch: TaskUpdatePatch): void {
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
    this.tasks = this.tasks.map(task => task.id === id ? withStatus(task, status, this.now()) : task)
    this.persistAndNotify()
  }

  deleteTask(id: string): void {
    const { tasks, selectionCleared } = applyDeleteTask(this.tasks, this.selectedTaskId, id)
    this.tasks = [...tasks]
    if (selectionCleared) this.selectedTaskId = undefined
    this.persistAndNotify()
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
    this.tasks = [...tasks]
    this.persistAndNotify()
    return true
  }

  /**
   * Roll a task's schedule forward (scheduler callback): persist the next due
   * instant and the trigger instant of this run. No-op when the task has no
   * schedule rule (it was deleted mid-tick, for example).
   */
  applyScheduleNextRun(id: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): void {
    const next = applyScheduleRollForward(this.tasks, id, nextRunAt, lastTriggeredAt, this.now())
    this.tasks = [...next]
    this.persistAndNotify()
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
    if (task === undefined || task.status === 'running') return false
    const { task: next, execution } = startExecution(task, this.now(), this.uuid())
    this.tasks = this.tasks.map(candidate => candidate.id === id ? next : candidate)
    this.persistAndNotify()
    // This page owns the settlement of its own launches: the live watch
    // (ExecutionService.run) settles on the turn boundary, and list
    // reconciliation must not pre-empt it with a session that has not
    // started a turn yet (its list row is idle, not completed).
    this.activeExecutionIds.add(execution.id)
    await this.deps.exec.run(next, execution, (event) => { this.handleExecutionEvent(event) })
    return true
  }

  /** Re-run a settled task: move it back to 'todo' first, then execute. */
  async rerunTask(id: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return
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
    this.scheduleReconcile()
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
    if (this.reconcileInFlight) return
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
    this.deps.store.save(this.tasks)
    this.notify()
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

