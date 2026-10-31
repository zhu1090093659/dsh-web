/**
 * Board controller: the single owner of task-ledger state and view state.
 *
 * In production it projects the Host ledger and submits confirmed actions;
 * the legacy store seam remains for v1 migration tests. The board closes
 * only on explicit user navigation, never implicitly on session-list churn.
 * Framework-free (structural runtime faces) so the whole orchestration is
 * unit-testable with fakes.
 *
 * The per use-case domain transitions (create/update/delete/schedule) live in
 * dedicated modules under core/use-cases and are applied here; the controller
 * owns only the orchestration seam (state, persistence, notify, navigation).
 */
import type { TaskStore } from './store.ts'
import { hasOpenExecution, withStatus, type NewTaskInput, type TaskRecord, type TaskStatus } from './tasks.ts'
import type { TaskAttachment, TaskAttachmentKind } from './attachment.ts'
import { applyArchiveTask, applyRestoreTask } from './use-cases/task-archive.ts'
import { applyCreateTask } from './use-cases/task-create.ts'
import { applyDeleteTask } from './use-cases/task-delete.ts'
import { applyScheduleNextRun as applyScheduleRollForward, applySetSchedule, type SetSchedulePatch } from './use-cases/task-schedule.ts'
import { resolveHostTimeZone } from './schedule.ts'
import { applySetParent } from './use-cases/task-parent.ts'
import { applyDeleteTag, applyRenameTag } from './use-cases/task-tag.ts'
import { applyUpdateTask, type TaskUpdatePatch } from './use-cases/task-update.ts'
import { DEFAULT_SUBTASK_DEPTH } from './subtask.ts'
import type {
  TaskBoardAction,
  TaskBoardEventPayload,
  TaskBoardParseDraft,
  TaskBoardParseRequest,
  TaskBoardSnapshot,
} from '../protocol.ts'
import type {
  TaskBoardExtensionActionRequest,
  TaskBoardGroupingSelector,
  TaskBoardVisibilityPredicate,
} from './extension.ts'

export interface TaskBoardTransport {
  bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot>
  state(): Promise<TaskBoardSnapshot>
  /**
   * Submit one action; the optional initiator is the current DSH session id
   * (issue #6 audit origin), asserted by the client and recorded by the Host.
   */
  action(action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot>
  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void
  /**
   * One-shot model parse of pasted text (issue #1540). Optional: a deployment
   * that cannot parse simply omits it, and the form hides the section.
   */
  parseDraft?(request: TaskBoardParseRequest, signal?: AbortSignal): Promise<TaskBoardParseDraft>
  /**
   * Upload one file or image into the Host's attachment storage. Optional: a
   * deployment that serves no attachment storage omits it, and the form then
   * refuses to stage an attachment.
   */
  uploadAttachment?(file: File, kind: TaskAttachmentKind): Promise<TaskAttachment>
}

/**
 * The sessions face the controller needs for navigation awareness. The Client
 * Session Controller carries no global selection since 0.1.6-alpha.2, so the
 * wiring resolves the main-view Session once and exposes it as current().
 */
export interface SessionsControllerFace {
  /** The Session the main view currently shows, when any. */
  current(): string | undefined
  /** Navigate the main view to a Session. */
  open(id: string): void
  /** Subscribe to catalog changes; selection ownership rides the same snapshot. */
  subscribe(fn: () => void): () => void
}

function currentOf(sessions: SessionsControllerFace | undefined): string | undefined {
  return sessions?.current()
}

/** Stable id shared by the board's sidebar panel row and its main-slot page. */
export const TASK_BOARD_PANEL_ID = 'task-board'

/**
 * The layout's panel-navigation face. The board no longer owns the center
 * column at the DOM level: selecting the panel is the layout's business, and
 * this is the one call that asks for it (null returns to the conversation).
 * Optional, so a composition without the layout service keeps the board's
 * pure state transitions testable.
 */
export interface PanelNavigationFace {
  /** Select the board panel, or null to hand the column back to the conversation. */
  select(panelId: string | null): void
}

/** Controller dependencies (all swappable in tests). */
export interface ControllerDeps {
  store: TaskStore
  sessions: SessionsControllerFace
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** Id minting; defaults to a random-uuid. */
  uuid?: () => string
  /** Host-authoritative transport; absent keeps the legacy in-memory test path. */
  transport?: TaskBoardTransport
  /** Layout panel selection; absent keeps the board state-only (tests, shell-less hosts). */
  panel?: PanelNavigationFace
}

/**
 * Register one host directory as a DSH project (workspace). Wired by the
 * browser apply() to the runtime's workspace controller; without it the board
 * hides its "new project" action instead of offering a dead control (#1536).
 */
export type WorkspaceCreator = (path: string) => Promise<{ workspaceId: string }>

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

/** One model option the execution-target pickers offer. */
export interface ExecutionModelOption {
  id: string
  name?: string
  label?: string
  provider?: string
  /**
   * Reasoning metadata the adapter declares for this exact route. An effort
   * picker is offered only while `supported`, and its choices are `efforts` —
   * the ids the target model really accepts, so the UI never offers (or keeps)
   * a level the model would reject. Absent means the deployment published no
   * capability for this model; the card value is then left untouched.
   */
  reasoning?: {
    supported: boolean
    efforts?: readonly string[]
  }
}

/** The execution-target option sets the UI feeds into the controller. */
export interface ExecutionOptionsSnapshot {
  workspaces: readonly ExecutionWorkspaceOption[]
  presets: readonly ExecutionPresetOption[]
  models?: readonly ExecutionModelOption[]
}

/**
 * Host-owned state the browser mirrors. SSE frames carry the volatile subset
 * (revision/scheduler/power); a full snapshot also carries the deployment
 * constants the UI reads (session default permission, subtask depth).
 */
export type HostMirror = Pick<TaskBoardSnapshot, 'revision' | 'scheduler' | 'power' | 'sessionDefaultPermission' | 'maxSubtaskDepth' | 'goalRunEnabled' | 'cardDefaults' | 'extensions' | 'attachmentLimits'>

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
  /** Whether the board may offer "register a new project" (issue #1536). */
  canCreateWorkspace?: boolean
  /** Whether this deployment can parse pasted text into task fields (issue #1540). */
  canParseTask?: boolean
  transportError?: string
  host?: HostMirror
  /**
   * Provider card-visibility predicates, in registration order. A task shows
   * only while every predicate accepts it; providers hide their own off-board
   * cards here instead of the board hard-coding a provider rule. Optional so a
   * hand-built snapshot (tests, a shell-less composition) defaults to visible.
   */
  visibility?: readonly TaskBoardVisibilityPredicate[]
  /** Provider source-group selectors, in registration order; browser-only functions. */
  grouping?: readonly TaskBoardGroupingSelector[]
  /** Read-only summaries published by running extensions, keyed by extension id. */
  extensions?: Readonly<Record<string, unknown>>
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
  private executionOptions: ExecutionOptionsSnapshot = { workspaces: [], presets: [], models: [] }
  private workspaceCreator: WorkspaceCreator | undefined
  private listeners = new Set<() => void>()
  private disposers: Array<() => void> = []
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly pendingTaskIds = new Set<string>()
  private readonly taskQueues = new Map<string, Promise<void>>()
  private transportError: string | undefined
  private hostState: HostMirror | undefined
  /** Provider visibility predicates (immutable array; replaced on change). */
  private visibility: readonly TaskBoardVisibilityPredicate[] = []
  /** Provider source-group selectors (immutable array; replaced on change). */
  private grouping: readonly TaskBoardGroupingSelector[] = []
  private remoteSubscribed = false
  private remoteInitialization: Promise<boolean> | undefined

  /** @param deps - store and the sessions navigation face. */
  constructor(private readonly deps: ControllerDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.uuid = deps.uuid ?? randomUuid
  }

  // --- lifecycle -------------------------------------------------------------

  /** Load the persisted ledger and start the navigation/status subscriptions. */
  start(): void {
    this.tasks = this.deps.store.load()
    if (this.deps.transport !== undefined) void this.initializeRemote()
    // A sibling tab may have edited or deleted the ledger (same origin,
    // storage events). Reload on external change so a task deleted in
    // another tab stops firing here — and is never written back by this
    // tab's stale copy (scheduler roll-forward, execution settlement).
    const unsubscribeExternal = this.deps.transport === undefined ? this.deps.store.subscribeExternal?.(() => {
      this.tasks = this.deps.store.load()
      this.notify()
    }) : undefined
    if (unsubscribeExternal !== undefined) this.disposers.push(unsubscribeExternal)
    this.disposers.push(this.deps.sessions.subscribe(() => {
      this.onSessionsChanged()
    }))
    this.notify()
  }

  /** Stop all subscriptions and drop retained state (idempotent). */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.listeners.clear()
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
      ...(this.workspaceCreator === undefined ? {} : { canCreateWorkspace: true }),
      ...(typeof this.deps.transport?.parseDraft === 'function' ? { canParseTask: true } : {}),
      ...(this.transportError === undefined ? {} : { transportError: this.transportError }),
      ...(this.hostState === undefined ? {} : { host: this.hostState }),
      visibility: this.visibility,
      grouping: this.grouping,
      ...(this.hostState?.extensions === undefined ? {} : { extensions: this.hostState.extensions }),
    }
  }

  /**
   * Register one card-visibility predicate. The returned disposer removes it;
   * both changes notify subscribers so the board re-renders.
   */
  registerVisibility(predicate: TaskBoardVisibilityPredicate): () => void {
    this.visibility = [...this.visibility, predicate]
    this.notify()
    return () => {
      const next = this.visibility.filter(candidate => candidate !== predicate)
      if (next.length === this.visibility.length) return
      this.visibility = next
      this.notify()
    }
  }

  /** Register one source-group selector; registration order breaks ownership ties. */
  registerGrouping(selector: TaskBoardGroupingSelector): () => void {
    this.grouping = [...this.grouping, selector]
    this.notify()
    return () => {
      const next = this.grouping.filter(candidate => candidate !== selector)
      if (next.length === this.grouping.length) return
      this.grouping = next
      this.notify()
    }
  }

  /**
   * Deliver one provider action through the board's same-origin channel. A
   * board without a Host transport (the legacy in-memory path) refuses it.
   */
  async dispatchExtension(request: TaskBoardExtensionActionRequest): Promise<boolean> {
    if (this.deps.transport === undefined) return false
    const action: TaskBoardAction = {
      kind: 'extension-action',
      extensionId: request.extensionId,
      action: request.action,
      ...(request.taskId === undefined ? {} : { taskId: request.taskId }),
      ...(request.payload === undefined ? {} : { payload: request.payload }),
    }
    return await this.commitRemote(action, request.taskId)
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

  /**
   * Re-read the authoritative Host snapshot.
   *
   * The board's volatile deployment configuration — the new-card defaults among
   * it — is republished the moment the settings document is written, but the SSE
   * frame that republish emits carries the value as of BEFORE the write (the
   * loader hands the update to the fiber while the new document is not yet
   * visible to it), so a mirror that followed frames alone would stay one edit
   * behind and the create dialog would prefill from the previous defaults for
   * the rest of the session. The surface that owns the write asks for the
   * snapshot again instead of trusting the frame.
   */
  refreshHostState(): void {
    void this.refreshRemote()
  }

  // --- view state -------------------------------------------------------------

  /**
   * Show the board. The layout owns which panel the center column renders, so
   * the state flip and the panel selection travel together here; a composition
   * with no layout face (tests, a shell-less host) still flips the state.
   *
   * The selection is requested AFTER the snapshot flips so a subscriber
   * rendering against `boardOpen` never observes "open" while the shell still
   * shows the conversation.
   */
  openBoard(): void {
    if (this.boardOpen) return
    this.boardOpen = true
    this.notify()
    this.selectPanel(TASK_BOARD_PANEL_ID)
  }

  /**
   * Return the center column to the conversation. The layout's own selection is
   * the source of truth for what the column renders, so this asks for the
   * conversation explicitly rather than only clearing local state.
   */
  closeBoard(): void {
    this.boardOpen = false
    this.notify()
    this.selectPanel(null)
  }

  toggleBoard(): void {
    if (this.boardOpen) this.closeBoard()
    else this.openBoard()
  }

  /**
   * Reflect a panel selection that came from OUTSIDE this controller (the user
   * clicked another sidebar row, or the layout dropped the panel id). Keeps
   * `boardOpen` aligned with what the column actually shows without asking the
   * layout to select anything back.
   * @param panelId - the layout's current panel id, or null for the conversation.
   */
  syncPanelSelection(panelId: string | null): void {
    const open = panelId === TASK_BOARD_PANEL_ID
    if (open === this.boardOpen) return
    this.boardOpen = open
    this.notify()
  }

  /** Ask the layout to select a panel; a shell that serves no layout face is a no-op. */
  private selectPanel(panelId: string | null): void {
    try {
      this.deps.panel?.select(panelId)
    } catch {
      // The layout service throws by contract before its root entry mounts;
      // the state flip above already stands, and the next selection retries.
    }
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
    const { task, tasks } = applyCreateTask(this.tasks, input, this.now(), id, this.mirrorDepth(), undefined, this.hostState?.cardDefaults)
    if (task === undefined) return undefined
    this.tasks = [...tasks]
    this.persistAndNotify()
    return task
  }

  /** Create through the Host and expose the task only after confirmation. */
  async createTaskConfirmed(input: NewTaskInput): Promise<TaskRecord | undefined> {
    if (this.deps.transport === undefined) return this.createTask(input)
    const id = this.uuid()
    // The preview must obey the SAME lineage gate the Host will: a browser-side
    // default of one level would reject a legal subtask-of-subtask before the
    // request is ever sent.
    const preview = applyCreateTask(this.tasks, input, this.now(), id, this.mirrorDepth(), undefined, this.hostState?.cardDefaults).task
    if (preview === undefined) return undefined
    return await this.commitRemote({ kind: 'create', id, input }, id)
      ? this.tasks.find(task => task.id === id)
      : undefined
  }

  /**
   * Apply an editable-field patch (task content + execution targets).
   * Host-backed: the Host ledger owns the fail-closed checks (the content of
   * an executed task is read-only) and confirms the mutation, so the resolved
   * value reflects whether the Host accepted it; the legacy in-memory path
   * applies and persists synchronously.
   * @returns true when the patch was accepted by the authority.
   */
  async updateTask(id: string, patch: TaskUpdatePatch): Promise<boolean> {
    if (this.deps.transport !== undefined) {
      return await this.commitRemote({ kind: 'update', taskId: id, patch }, id)
    }
    this.tasks = [...applyUpdateTask(this.tasks, id, patch, this.now())]
    this.persistAndNotify()
    return true
  }

  /**
   * Replace (a part of) the picker option sets the UI feeds (workspace list
   * and agent-preset roster come from the runtime, not the ledger).
   */
  setExecutionOptions(patch: Partial<ExecutionOptionsSnapshot>): void {
    this.executionOptions = { ...this.executionOptions, ...patch }
    this.notify()
  }

  /** Wire (or clear) the runtime's project registration face (issue #1536). */
  setWorkspaceCreator(creator: WorkspaceCreator | undefined): void {
    this.workspaceCreator = creator
    this.notify()
  }

  /**
   * Register an existing host directory as a DSH project, exactly as the GUI's
   * own "add project" does; the runtime's failure message surfaces unchanged.
   */
  async createWorkspace(path: string): Promise<{ workspaceId: string }> {
    if (this.workspaceCreator === undefined) throw new Error('workspace creation is unavailable')
    return await this.workspaceCreator(path)
  }

  /** Whether this deployment can parse pasted text into task fields (issue #1540). */
  canParseTask(): boolean {
    return typeof this.deps.transport?.parseDraft === 'function'
  }

  /**
   * Parse pasted text into task fields through the Host. The transport already
   * phrases every failure for the user, so its message surfaces unchanged.
   */
  async parseTaskDraft(request: TaskBoardParseRequest, signal?: AbortSignal): Promise<TaskBoardParseDraft> {
    const transport = this.deps.transport
    const parse = transport?.parseDraft
    if (transport === undefined || parse === undefined) throw new Error('task parsing is unavailable')
    return await parse.call(transport, request, signal)
  }

  /**
   * Upload one attachment into the Host's attachment storage.
   *
   * The form calls this when the card is SAVED, never when a file is picked:
   * a staged file is a local preview until the card is really saved.
   * @param file - the picked file.
   * @param kind - whether the file is stored as an image or verbatim.
   * @returns the metadata the Host computed, or undefined when this
   *   deployment serves no attachment storage.
   */
  async uploadAttachment(file: File, kind: TaskAttachmentKind): Promise<TaskAttachment | undefined> {
    const transport = this.deps.transport
    const upload = transport?.uploadAttachment
    if (transport === undefined || upload === undefined) return undefined
    return await upload.call(transport, file, kind)
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
   * Archive a task from any status but `running`, whose lifecycle the runner
   * keeps exclusive ownership of until it settles.
   * @returns true when applied.
   */
  archiveTask(id: string): boolean {
    const { tasks, archived } = applyArchiveTask(this.tasks, id, this.now(), this.mirrorDepth())
    if (!archived) return false
    if (this.deps.transport !== undefined) {
      void this.commitRemote({ kind: 'archive', taskId: id }, id)
      return true
    }
    this.tasks = [...tasks]
    this.persistAndNotify()
    return true
  }

  /**
   * Attach an existing task under a parent (or detach it with a null parent)
   * through the Host. The lineage gate — parent exists and is on-board, no
   * cycle, depth within the deployment limit — belongs to the Host; a refusal
   * surfaces through the transport error like every other rejected action.
   * @returns true when the link was accepted by the authority.
   */
  async setParent(id: string, parentId: string | null): Promise<boolean> {
    if (this.deps.transport === undefined) {
      const result = applySetParent(this.tasks, id, parentId, this.now(), this.mirrorDepth())
      if (!result.applied) return false
      this.tasks = [...result.tasks]
      this.persistAndNotify()
      return true
    }
    return await this.commitRemote({ kind: 'set-parent', taskId: id, parentId }, id)
  }

  /** Restore an archived task back onto the board (same status column). */
  restoreTask(id: string): boolean {
    const { tasks, archived } = applyRestoreTask(this.tasks, id, this.now(), this.mirrorDepth())
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

  /**
   * Rename one label across the whole ledger; a name already in use merges the
   * two labels. Host-backed: the ledger owns the transition and confirms it, so
   * the board's label row reflects whether the Host accepted the edit.
   * @returns true when the edit was accepted by the authority.
   */
  async renameTag(from: string, to: string): Promise<boolean> {
    if (this.deps.transport !== undefined) {
      return await this.commitRemote({ kind: 'rename-tag', from, to })
    }
    const result = applyRenameTag(this.tasks, from, to, this.now())
    if (result.error !== undefined) return false
    if (result.changed) {
      this.tasks = [...result.tasks]
      this.persistAndNotify()
    }
    return true
  }

  /**
   * Remove one label from every task that carries it, board and archive alike —
   * the board's label row is drawn from the whole ledger, so a label left on an
   * archived card would come straight back.
   * @returns true when the edit was accepted by the authority.
   */
  async deleteTag(name: string): Promise<boolean> {
    if (this.deps.transport !== undefined) {
      return await this.commitRemote({ kind: 'delete-tag', name })
    }
    const result = applyDeleteTag(this.tasks, name, this.now())
    if (result.error !== undefined) return false
    if (result.changed) {
      this.tasks = [...result.tasks]
      this.persistAndNotify()
    }
    return true
  }

  // --- scheduling ---------------------------------------------------------------

  /**
   * Update a task's schedule rule. An unusable plan (blank or invalid cron, a
   * one-shot with no future instant, a non-positive run cap) is rejected
   * (returns false, state untouched). When the rule ends up enabled the next
   * run instant is computed immediately — a one-shot's next instant IS its
   * planned instant — and a disabled rule carries none. Delegates the domain
   * transition to the schedule use case.
   * @param id - the task to schedule.
   * @param patch - fields to change (absent fields keep their current value).
   * @returns true when applied, false when rejected (unknown task / unusable plan).
   */
  setSchedule(id: string, patch: SetSchedulePatch): boolean {
    // The Host zone is the fallback a rule with no stored zone follows: the
    // mirrored snapshot carries it, and a controller without a Host mirror
    // (pure client tests) falls back to the process zone.
    const hostTimeZone = this.hostState?.scheduler.timeZone ?? resolveHostTimeZone()
    const { tasks, applied } = applySetSchedule(this.tasks, id, patch, this.now(), hostTimeZone)
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
    this.closeBoard()
    this.deps.sessions.open(sessionId)
  }

  // --- execution ---------------------------------------------------------------

  /**
   * Request a Host execution for a task: the Host ledger owns the running
   * transition, the execution record, and the settlement. A second call
   * while the task is already running is ignored; without a Host transport
   * the run is refused (returns false).
   */
  async runTask(id: string): Promise<boolean> {
    const task = this.tasks.find(candidate => candidate.id === id)
    // Only an open execution blocks a second launch; the 'running' column is a
    // board statement and a card parked there by hand still runs on request.
    if (task === undefined || task.archivedAt !== undefined || hasOpenExecution(task)) return false
    if (this.deps.transport === undefined) return false
    return await this.commitRemote({ kind: 'run', taskId: id }, id, currentOf(this.deps.sessions))
  }

  /**
   * Confirm a card's above-default permission binding through the Host
   * (resolves the pending-confirmation transaction; no-op otherwise).
   */
  async confirmPermission(id: string): Promise<boolean> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined) return false
    if (this.deps.transport === undefined) {
      this.tasks = this.tasks.map(candidate => candidate.id === id
        ? { ...candidate, permissionConfirmedAt: this.now(), updatedAt: this.now() }
        : candidate)
      this.persistAndNotify()
      return true
    }
    return await this.commitRemote({ kind: 'confirm-permission', taskId: id }, id)
  }

  /** Re-run a settled task through the Host (the Host replans and executes). */
  async rerunTask(id: string): Promise<void> {
    const task = this.tasks.find(candidate => candidate.id === id)
    if (task === undefined || task.archivedAt !== undefined) return
    if (this.deps.transport === undefined) return
    await this.commitRemote({ kind: 'rerun', taskId: id }, id, currentOf(this.deps.sessions))
  }

  // --- internals ---------------------------------------------------------------

  /**
   * Session-list notifications fire for all kinds of incidental churn
   * (background navigation, the Host runner creating and selecting a fresh
   * execution session, settlement, other plugins), so closing on `current`
   * changes would evict the board without the user asking. The board closes
   * only on explicit user navigation: selecting another panel (the layout owns
   * selection, and `syncPanelSelection` follows it) or the board's own actions
   * (openSession / close). Keeping the hook preserves the subscription
   * contract for future listeners.
   */
  private onSessionsChanged(): void {
    // Intentionally empty: never close the board implicitly.
  }

  private persistAndNotify(): void {
    if (this.deps.transport === undefined) this.deps.store.save(this.tasks)
    this.notify()
  }

  private async commitRemote(action: TaskBoardAction, taskId?: string, initiator?: string): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    if (taskId === undefined) return await this.performRemote(action, initiator)
    const previous = this.taskQueues.get(taskId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => await this.performRemote(action, initiator))
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

  private async performRemote(action: TaskBoardAction, initiator?: string): Promise<boolean> {
    const transport = this.deps.transport
    if (transport === undefined) return true
    this.transportError = undefined
    this.notify()
    try {
      const accepted = this.acceptRemote(await transport.action(action, initiator))
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
      this.hostState = { ...this.hostState, revision: event.revision, scheduler: event.scheduler, power: event.power }
      this.notify()
      return
    }
    void this.refreshRemote()
  }

  /**
   * Deployment subtask depth limit the browser mirrors from the last Host
   * snapshot; the fallback is the deployment default for the legacy path (no
   * transport) and for the window before the first snapshot arrives.
   */
  private mirrorDepth(): number {
    return this.hostState?.maxSubtaskDepth ?? DEFAULT_SUBTASK_DEPTH
  }

  /**
   * Project a Host snapshot onto the browser's mirror. Every snapshot the
   * transport serves is a full document (bootstrap/state/action all answer
   * `TaskBoardHostService.snapshot()`), so the deployment constants the UI reads
   * — the session-default permission the confirmation banner compares against,
   * the subtask depth limit, the platform switches and the extensions a provider
   * published — are taken as published, carried over only where the snapshot
   * itself omits the key.
   */
  private mirrorOf(snapshot: TaskBoardSnapshot): HostMirror {
    const sessionDefaultPermission = snapshot.sessionDefaultPermission ?? this.hostState?.sessionDefaultPermission
    const maxSubtaskDepth = snapshot.maxSubtaskDepth ?? this.hostState?.maxSubtaskDepth
    const goalRunEnabled = snapshot.goalRunEnabled ?? this.hostState?.goalRunEnabled
    // The new-card defaults are NOT carried over: the Host publishes a target
    // nothing configures by omitting it (protocol.ts states that explicitly), so
    // an absent key means "this deployment configures none". Carrying the last
    // value over would keep a CLEARED default alive in the create dialog, which
    // is the mirror image of the staleness this key is re-read for.
    const cardDefaults = snapshot.cardDefaults
    const extensions = snapshot.extensions ?? this.hostState?.extensions
    // The attachment limits are carried over: a deployment that lowers them
    // must keep the browser's refusal in step until the next snapshot.
    const attachmentLimits = snapshot.attachmentLimits ?? this.hostState?.attachmentLimits
    return {
      revision: snapshot.revision,
      scheduler: snapshot.scheduler,
      power: snapshot.power,
      ...(sessionDefaultPermission === undefined ? {} : { sessionDefaultPermission }),
      ...(maxSubtaskDepth === undefined ? {} : { maxSubtaskDepth }),
      ...(goalRunEnabled === undefined ? {} : { goalRunEnabled }),
      ...(cardDefaults === undefined ? {} : { cardDefaults }),
      ...(extensions === undefined ? {} : { extensions }),
      ...(attachmentLimits === undefined ? {} : { attachmentLimits }),
    }
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
    this.hostState = this.mirrorOf(snapshot)
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
