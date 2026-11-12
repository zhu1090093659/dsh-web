/**
 * Host-side extension registry: the one place that admits external providers,
 * negotiates the contract version, gates them on the board's own enable state,
 * fans board events out to them, and routes dispatched provider actions back.
 *
 * Failure policy (mirrors the board's plugin philosophy): a provider that
 * throws, mis-declares its version, or disables itself degrades only its own
 * surface. The board keeps serving; the registry records what it refused.
 *
 * @module dsh-task-board/host/extension-registry
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { HostTaskLedger } from '../host-ledger.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from '../protocol.ts'
import { canEditTaskContent } from '../core/use-cases/task-update.ts'
import {
  TASK_BOARD_API_VERSION,
  TASK_BOARD_MESSAGE_MAX_LENGTH,
  isTaskBoardExtensionPayload,
  taskBoardPayloadBytes,
  type TaskBoardCreateOptions,
  type TaskBoardEventFace,
  type TaskBoardExecutionSettledEvent,
  type TaskBoardExtension,
  type TaskBoardExtensionActionRequest,
  type TaskBoardExtensionHost,
  type TaskBoardExtensionPayload,
  type TaskBoardIntegrationFace,
  type TaskBoardLinkedTask,
  type TaskBoardSessionsFace,
  type TaskBoardStatusChangedEvent,
  type TaskBoardTaskDraft,
  type TaskBoardTaskDeletedEvent,
  type TaskBoardTasksFace,
} from '../core/extension.ts'
import { isTaskStatus, type TaskRecord, type TaskStatus } from '../core/tasks.ts'

/** Diagnosable refusal raised by the registry and the capability face. */
export class TaskBoardExtensionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`task-board extension [${code}]: ${message}`)
    this.name = 'TaskBoardExtensionError'
    this.code = code
  }
}

/** Logging seat the registry uses; a deployment may supply its own. */
export interface TaskBoardExtensionLogger {
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
}

/** The deployment's model-visible tool registry, resolved lazily. */
export interface TaskBoardExtensionToolRegistry {
  register(definition: ToolDefinition): () => void
}

/** Applies one board action with every board gate intact (never an extension action). */
export type TaskBoardActionApplier = (action: Exclude<TaskBoardAction, { kind: 'extension-action' }>, initiator?: string) => TaskBoardSnapshot

/** Delivers one follow-up message into an existing execution session. */
export type TaskBoardFollowUpDelivery = (sessionId: string, text: string) => Promise<void>

/** Applies one rework request through the board's own run path. */
export type TaskBoardReworkApplier = (taskId: string, instructions: string, initiator?: string) => void

/** Registry dependencies. */
export interface TaskBoardExtensionRegistryOptions {
  ledger: HostTaskLedger
  /** Apply an action through the board service (gates, run dispatch, schedule). */
  apply?: TaskBoardActionApplier
  /**
   * Queue one follow-up message into a session. Absent means this deployment
   * serves no session delivery, which the capability face refuses visibly.
   */
  followUp?: TaskBoardFollowUpDelivery
  /**
   * Apply one rework run request (through the same gates a run takes). Absent
   * means this deployment serves no rework, which the face refuses visibly.
   */
  rework?: TaskBoardReworkApplier
  /** Resolve the deployment's tool registry; absent loses the tool surface only. */
  toolRegistry?: () => TaskBoardExtensionToolRegistry | undefined
  now?: () => number
  uuid?: () => string
  logger?: TaskBoardExtensionLogger
}

/** Event subscription callback, erased because one entry owns three families. */
type RegistryEventCallback = (event: unknown) => void

/** One registered provider. */
interface RegistryEntry {
  readonly extension: TaskBoardExtension
  /** Whether provider-side work is currently started (board x extension gate). */
  active: boolean
  /** Live event subscriptions, one set per event family. */
  readonly subscriptions: Record<keyof TaskBoardEventFace, Set<RegistryEventCallback>>
  /** Tool definitions the provider registered, with their live disposers. */
  tools: Array<{ definition: ToolDefinition; dispose?: () => void }>
  published?: TaskBoardExtensionPayload
}

const DEFAULT_LOGGER: TaskBoardExtensionLogger = {
  warn(message: string, ...rest: unknown[]): void {
    try { console.warn(message, ...rest) } catch { /* best-effort */ }
  },
  error(message: string, ...rest: unknown[]): void {
    try { console.error(message, ...rest) } catch { /* best-effort */ }
  },
}

/**
 * Whether a tool registration was refused because the deployment's fiber is
 * already unloading, rather than because the registry rejected the definition.
 * cordis reports that refusal as `INACTIVE_EFFECT` on the thrown error, and it
 * is the expected answer to any registration a shutdown path makes too late: the
 * teardown releases those tools moments later, so a refusal reports nothing.
 * Detected by the documented error code, which keeps the board free of any
 * runtime dependency on the host framework.
 *
 * @param error - the refusal the tool registry raised.
 * @returns true when the host context is already disposing.
 */
function isInactiveContext(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'INACTIVE_EFFECT'
}

function emptySubscriptions(): Record<keyof TaskBoardEventFace, Set<RegistryEventCallback>> {
  return {
    onStatusChanged: new Set(),
    onExecutionSettled: new Set(),
    onTaskDeleted: new Set(),
  }
}

/**
 * Shallow-merge one provider payload, dropping keys explicitly cleared with
 * undefined so a provider can remove a field without replacing the entry.
 */
function mergePayload(
  current: TaskBoardExtensionPayload | undefined,
  patch: TaskBoardExtensionPayload,
): TaskBoardExtensionPayload {
  const next: TaskBoardExtensionPayload = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

/** Whether a stored integration entry is a usable extension payload. */
function readPayload(value: unknown): TaskBoardExtensionPayload | undefined {
  return isTaskBoardExtensionPayload(value) ? value : undefined
}

/** One-line text of a delivery failure, for a diagnosable refusal. */
function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Validate one free text a provider pushes into an execution. Blank text would
 * queue an empty turn, and an unbounded one would let a single provider call
 * inject an arbitrarily large instruction, so both are refused here rather
 * than at the gateway.
 */
function extensionText(value: string, what: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') throw new TaskBoardExtensionError('invalid-text', `a ${what} must be a non-blank string`)
  if (text.length > TASK_BOARD_MESSAGE_MAX_LENGTH) {
    throw new TaskBoardExtensionError('invalid-text', `a ${what} is limited to ${TASK_BOARD_MESSAGE_MAX_LENGTH} characters`)
  }
  return text
}

/**
 * The session a follow-up message goes to, or the refusal that says why there
 * is none. The open execution owns the answer while one is running: delivering
 * into the previous conversation instead would answer a question the current
 * run never asked.
 */
function followUpTarget(task: TaskRecord): { sessionId: string } | { refusal: string; message: string } {
  if (task.executions.length === 0) {
    return { refusal: 'not-executed', message: `task ${task.id} has never executed, so it has no session to deliver to` }
  }
  const open = [...task.executions].reverse().find(record => record.endedAt === undefined)
  if (open !== undefined) {
    return open.sessionId === undefined
      ? { refusal: 'session-unreachable', message: `the current execution of task ${task.id} has not attached a session yet` }
      : { sessionId: open.sessionId }
  }
  const settled = [...task.executions].reverse().find(record => record.sessionId !== undefined)
  return settled?.sessionId === undefined
    ? { refusal: 'session-unreachable', message: `task ${task.id} records no execution session to deliver to` }
    : { sessionId: settled.sessionId }
}

export class TaskBoardExtensionRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  private readonly ledger: HostTaskLedger
  private readonly applyAction: TaskBoardActionApplier | undefined
  private readonly followUpDelivery: TaskBoardFollowUpDelivery | undefined
  private readonly reworkApply: TaskBoardReworkApplier | undefined
  private readonly now: () => number
  private readonly uuid: () => string
  private readonly logger: TaskBoardExtensionLogger
  private toolResolver: (() => TaskBoardExtensionToolRegistry | undefined) | undefined
  /** Board master switch (enabled config); providers start only while it is on. */
  private boardEnabled = true
  private disposed = false

  constructor(options: TaskBoardExtensionRegistryOptions) {
    this.ledger = options.ledger
    this.applyAction = options.apply
    this.followUpDelivery = options.followUp
    this.reworkApply = options.rework
    this.now = options.now ?? Date.now
    this.uuid = options.uuid ?? (() => crypto.randomUUID())
    this.logger = options.logger ?? DEFAULT_LOGGER
    this.toolResolver = options.toolRegistry
  }

  /**
   * Pin (or replace) the deployment's tool registry. A registry that appears
   * after a provider started is picked up here, which is what keeps the tool
   * surface alive across the board's own late service resolution.
   */
  setToolRegistry(resolver: (() => TaskBoardExtensionToolRegistry | undefined) | undefined): void {
    this.toolResolver = resolver
    // The resolver may now name a different registry (the deployment replaced
    // its tool provider fiber): release what the previous one held and let
    // syncTools adopt the current one.
    for (const entry of this.entries.values()) {
      this.disposeTools(entry)
      this.syncTools(entry)
    }
  }

  /** Apply the board's master switch; providers start and stop with it. */
  setEnabled(enabled: boolean): void {
    this.boardEnabled = enabled
    for (const entry of this.entries.values()) this.reconcile(entry)
  }

  /** Whether the board currently runs a given extension (board x extension). */
  isActive(extensionId: string): boolean {
    return this.entries.get(extensionId)?.active === true
  }

  /**
   * Admit one provider. Idempotent by id: a second registration of the same id
   * is a no-op that returns the same release handle. A contract-version
   * mismatch is refused visibly (logged and thrown) without disturbing the
   * board or any other provider.
   * @param extension - the provider to admit.
   * @returns a disposer releasing the registration (idempotent).
   */
  registerExtension(extension: TaskBoardExtension): () => void {
    if (this.disposed) throw new TaskBoardExtensionError('registry-disposed', 'the board is shutting down')
    const existing = this.entries.get(extension.id)
    if (existing !== undefined) {
      if (existing.extension !== extension) {
        this.logger.warn(`[dsh-task-board] extension "${extension.id}" is already registered; the second registration is ignored`)
      }
      return () => { this.unregister(extension.id) }
    }
    if (extension.apiVersion !== TASK_BOARD_API_VERSION) {
      const message = `extension "${extension.id}" declares apiVersion ${String(extension.apiVersion)} but this board serves ${TASK_BOARD_API_VERSION}`
      this.logger.error('[dsh-task-board] ' + message)
      throw new TaskBoardExtensionError('api-version-mismatch', message)
    }
    const entry: RegistryEntry = { extension, active: false, subscriptions: emptySubscriptions(), tools: [] }
    this.entries.set(extension.id, entry)
    this.reconcile(entry)
    return () => { this.unregister(extension.id) }
  }

  /** Remove one provider; its provider-side work stops and its payload stays stored. */
  unregister(extensionId: string): void {
    const entry = this.entries.get(extensionId)
    if (entry === undefined) return
    this.stopEntry(entry)
    this.entries.delete(extensionId)
  }

  /**
   * Route one dispatched provider action. Refuses visibly when the extension is
   * unknown, currently gated off, or does not implement the action.
   */
  async handleAction(request: TaskBoardExtensionActionRequest): Promise<unknown> {
    const entry = this.entries.get(request.extensionId)
    if (entry === undefined) {
      throw new TaskBoardExtensionError('unknown-extension', `no extension "${request.extensionId}" is registered`)
    }
    if (!entry.active) {
      throw new TaskBoardExtensionError('extension-disabled', `extension "${request.extensionId}" is not enabled`)
    }
    const handler = entry.extension.handleAction
    if (typeof handler !== 'function') {
      throw new TaskBoardExtensionError('unsupported-action', `extension "${request.extensionId}" handles no actions`)
    }
    return await handler.call(entry.extension, request)
  }

  /** Published summaries of currently running providers, keyed by extension id. */
  published(): Record<string, TaskBoardExtensionPayload> {
    const result: Record<string, TaskBoardExtensionPayload> = {}
    for (const [id, entry] of this.entries) {
      if (entry.active && entry.published !== undefined) result[id] = entry.published
    }
    return result
  }

  /** Fan a status change out to every running provider, isolated per callback. */
  emitStatusChanged(event: TaskBoardStatusChangedEvent): void {
    this.emit('onStatusChanged', event)
  }

  /** Fan an execution settlement out to every running provider. */
  emitExecutionSettled(event: TaskBoardExecutionSettledEvent): void {
    this.emit('onExecutionSettled', event)
  }

  /** Fan a task deletion out to every running provider. */
  emitTaskDeleted(event: TaskBoardTaskDeletedEvent): void {
    this.emit('onTaskDeleted', event)
  }

  /** Stop every provider and release the registry (idempotent). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) this.stopEntry(entry)
    this.entries.clear()
  }

  // --- internals ---------------------------------------------------------------

  private emit(kind: keyof TaskBoardEventFace, payload: unknown): void {
    if (this.disposed) return
    for (const entry of this.entries.values()) {
      if (!entry.active) continue
      for (const callback of [...entry.subscriptions[kind]]) {
        try {
          callback(payload)
        } catch (error) {
          this.logger.error(`[dsh-task-board] extension "${entry.extension.id}" ${kind} callback failed`, error)
        }
      }
    }
  }

  /** Start or stop one entry against the current board + extension gate. */
  private reconcile(entry: RegistryEntry): void {
    if (this.disposed) return
    const wanted = this.boardEnabled && (entry.extension.enabled?.() ?? true)
    if (wanted === entry.active) {
      if (wanted) this.syncTools(entry)
      return
    }
    if (wanted) this.startEntry(entry)
    else this.stopEntry(entry)
  }

  private startEntry(entry: RegistryEntry): void {
    entry.active = true
    try {
      entry.extension.start?.(this.capabilities(entry))
    } catch (error) {
      this.logger.error(`[dsh-task-board] extension "${entry.extension.id}" start() failed`, error)
    }
    this.syncTools(entry)
  }

  private stopEntry(entry: RegistryEntry): void {
    if (entry.active) {
      entry.active = false
      for (const kind of Object.keys(entry.subscriptions) as Array<keyof TaskBoardEventFace>) {
        entry.subscriptions[kind].clear()
      }
      try {
        entry.extension.stop?.()
      } catch (error) {
        this.logger.error(`[dsh-task-board] extension "${entry.extension.id}" stop() failed`, error)
      }
    }
    this.disposeTools(entry)
    // A stopped provider re-registers its tools from start(); keeping the old
    // definitions would double-register them on the next enable.
    entry.tools.length = 0
  }

  /** (Re)register every buffered tool against the current tool registry. */
  private syncTools(entry: RegistryEntry): void {
    if (!entry.active) return
    const registry = this.toolResolver?.()
    for (const tool of entry.tools) {
      if (registry === undefined) {
        tool.dispose = undefined
        continue
      }
      if (tool.dispose !== undefined) continue
      try {
        tool.dispose = registry.register(tool.definition)
      } catch (error) {
        tool.dispose = undefined
        // A refusal from a host that is already unloading is the expected answer
        // to a registration the teardown made too late, not a fault of the tool
        // definition; only a real refusal of the definition is reported.
        if (isInactiveContext(error)) return
        this.logger.error(`[dsh-task-board] extension "${entry.extension.id}" tool "${tool.definition.name}" registration failed`, error)
      }
    }
  }

  private disposeTools(entry: RegistryEntry): void {
    for (const tool of entry.tools) {
      const dispose = tool.dispose
      tool.dispose = undefined
      if (dispose === undefined) continue
      try { dispose() } catch (error) { this.logger.error('[dsh-task-board] tool disposer failed', error) }
    }
  }

  private assertActive(entry: RegistryEntry, what: string): void {
    if (this.disposed) throw new TaskBoardExtensionError('registry-disposed', 'the board is shutting down')
    if (!entry.active) throw new TaskBoardExtensionError('extension-disabled', `extension "${entry.extension.id}" cannot ${what} while disabled`)
  }

  /** Build the per-extension capability face. */
  private capabilities(entry: RegistryEntry): TaskBoardExtensionHost {
    const id = entry.extension.id
    const assertActive = (what: string): void => { this.assertActive(entry, what) }
    const subscribe = (kind: keyof TaskBoardEventFace, callback: RegistryEventCallback): (() => void) => {
      assertActive('subscribe')
      entry.subscriptions[kind].add(callback)
      return () => { entry.subscriptions[kind].delete(callback) }
    }
    const tasks: TaskBoardTasksFace = {
      list: () => this.ledger.allTasks(),
      get: taskId => this.ledger.getTask(taskId),
      create: (draft, options) => this.createTask(entry, draft, options),
      patchContent: (taskId, patch) => this.patchContent(entry, taskId, patch),
      setStatus: (taskId, status, initiator) => this.setStatus(entry, taskId, status, initiator),
      linked: () => this.linkedTasks(entry),
      rework: (taskId, instructions, initiator) => { this.rework(entry, taskId, instructions, initiator) },
    }
    const sessions: TaskBoardSessionsFace = {
      followUp: async (taskId, text) => { await this.followUp(entry, taskId, text) },
    }
    const integration: TaskBoardIntegrationFace = {
      read: (taskId) => {
        assertActive('read')
        return readPayload(this.ledger.getTask(taskId)?.integrations?.[id])
      },
      write: (taskId, payload) => { this.writeIntegration(entry, taskId, payload) },
    }
    const events: TaskBoardEventFace = {
      onStatusChanged: (callback) => subscribe('onStatusChanged', callback as RegistryEventCallback),
      onExecutionSettled: (callback) => subscribe('onExecutionSettled', callback as RegistryEventCallback),
      onTaskDeleted: (callback) => subscribe('onTaskDeleted', callback as RegistryEventCallback),
    }
    return {
      tasks,
      sessions,
      integration,
      events,
      publish: (summary) => { this.publish(entry, summary) },
      registerTool: (definition) => { assertActive('register a tool'); return this.registerTool(entry, definition) },
    }
  }

  private createTask(entry: RegistryEntry, draft: TaskBoardTaskDraft, options?: TaskBoardCreateOptions): TaskRecord {
    this.assertActive(entry, 'create a task')
    if (this.applyAction === undefined) throw new TaskBoardExtensionError('unavailable', 'this deployment serves no action applier')
    if (draft.status !== undefined && !isTaskStatus(draft.status)) throw new TaskBoardExtensionError('invalid-status', 'unknown task status')
    const payload = options?.payload
    if (payload !== undefined && !isTaskBoardExtensionPayload(payload)) {
      throw new TaskBoardExtensionError('invalid-payload', 'create payload must be a pure JSON object within the size limit')
    }
    const recordId = this.uuid()
    const snapshot = this.applyAction({
      kind: 'create',
      id: recordId,
      input: {
        title: draft.title,
        description: draft.description,
        prompt: draft.prompt,
        ...(draft.status === undefined ? {} : { status: draft.status }),
        ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
        ...(draft.workspaceId === undefined ? {} : { workspaceId: draft.workspaceId }),
        // Execution targets travel to the board's own creation path verbatim:
        // what the caller sent wins there, the parent's pins fill the rest, and
        // the board's new-card defaults stay out of it (this face never opts
        // into them). Validating preset or route existence is the RUN's job, so
        // an unknown value fails closed at launch instead of being judged here.
        ...(draft.mode === undefined ? {} : { mode: draft.mode }),
        ...(draft.model === undefined ? {} : { model: draft.model }),
        ...(draft.reasoningEffort === undefined ? {} : { reasoningEffort: draft.reasoningEffort }),
        ...(payload === undefined ? {} : { integrations: { [entry.extension.id]: payload } }),
        ...(options?.hidden === true ? { hidden: true } : {}),
      },
    })
    const task = snapshot.tasks.find(item => item.id === recordId)
    if (task === undefined) throw new TaskBoardExtensionError('create-refused', 'the board refused the task')
    return task
  }

  private patchContent(entry: RegistryEntry, taskId: string, patch: { title?: string; description?: string; prompt?: string }): void {
    this.assertActive(entry, 'patch content')
    if (this.applyAction === undefined) throw new TaskBoardExtensionError('unavailable', 'this deployment serves no action applier')
    const task = this.requireTask(taskId)
    // The board's own content authority: an executed (or archived) card keeps
    // the title/description/prompt that were actually planned and run.
    if (!canEditTaskContent(task)) throw new TaskBoardExtensionError('content-frozen', `task ${taskId} has started executing; its content is read-only`)
    const keys = (['title', 'description', 'prompt'] as const).filter(field => patch[field] !== undefined)
    if (keys.length === 0) return
    this.applyAction({ kind: 'update', taskId, patch: { ...patch } })
  }

  private setStatus(entry: RegistryEntry, taskId: string, status: TaskStatus, initiator?: string): void {
    this.assertActive(entry, 'set a status')
    if (this.applyAction === undefined) throw new TaskBoardExtensionError('unavailable', 'this deployment serves no action applier')
    if (!isTaskStatus(status)) throw new TaskBoardExtensionError('invalid-status', 'unknown task status')
    // The board's existing move gates (running lock, archived lock, manual
    // column set) decide; a refusal surfaces unchanged.
    this.applyAction({ kind: 'move', taskId, status }, initiator)
  }

  /**
   * Queue one follow-up message into the session of a card's current or most
   * recent execution.
   *
   * A running card is the point of the capability, so an open execution is not
   * a refusal: the message is queued behind the turn that is already going. What
   * IS refused is a card with no conversation to deliver into, and a session
   * this Host no longer reaches — the delivery refuses, and that refusal must
   * reach the provider as such instead of looking like a silent success.
   */
  private async followUp(entry: RegistryEntry, taskId: string, text: string): Promise<void> {
    this.assertActive(entry, 'deliver a follow-up message')
    const task = this.requireTask(taskId)
    const message = extensionText(text, 'follow-up message')
    if (task.archivedAt !== undefined) {
      throw new TaskBoardExtensionError('task-archived', `task ${taskId} is archived; an archived card's execution is closed`)
    }
    const target = followUpTarget(task)
    if ('refusal' in target) throw new TaskBoardExtensionError(target.refusal, target.message)
    if (this.followUpDelivery === undefined) {
      throw new TaskBoardExtensionError('unavailable', 'this deployment serves no session delivery')
    }
    try {
      await this.followUpDelivery(target.sessionId, message)
    } catch (error) {
      throw new TaskBoardExtensionError(
        'session-unreachable',
        `session ${target.sessionId} of task ${taskId} did not accept the message: ${failureText(error)}`,
      )
    }
  }

  /**
   * Re-run an executed card in its own session with rework instructions.
   *
   * The registry decides only what it can read from the ledger — the card
   * exists, is not archived, is not running, and has a conversation to continue
   * — and then hands the request to the board's own run path, so the running
   * lock, the permission confirmation, the acceptance contract and the spend cap
   * keep judging it. A board refusal surfaces unchanged, exactly as it does for
   * {@link setStatus}, because those are the board's own words.
   */
  private rework(entry: RegistryEntry, taskId: string, instructions: string, initiator?: string): void {
    this.assertActive(entry, 'rework a task')
    if (this.reworkApply === undefined) throw new TaskBoardExtensionError('unavailable', 'this deployment serves no rework applier')
    const task = this.requireTask(taskId)
    const text = extensionText(instructions, 'rework instructions')
    if (task.archivedAt !== undefined) {
      throw new TaskBoardExtensionError('task-archived', `task ${taskId} is archived; an archived card is read-only`)
    }
    if (task.executions.some(record => record.endedAt === undefined)) {
      throw new TaskBoardExtensionError('running', `task ${taskId} is still running; a card is reworked once its run settles`)
    }
    if (task.executions.length === 0) {
      throw new TaskBoardExtensionError('not-executed', `task ${taskId} has never executed, so there is no run to rework`)
    }
    if (!task.executions.some(record => record.sessionId !== undefined)) {
      throw new TaskBoardExtensionError('session-unreachable', `task ${taskId} records no execution session to continue`)
    }
    this.reworkApply(taskId, text, initiator)
  }

  /** One task by id, or the refusal that names the unknown id. */
  private requireTask(taskId: string): TaskRecord {
    const task = this.ledger.getTask(taskId)
    if (task === undefined) throw new TaskBoardExtensionError('task-not-found', `no task with id ${taskId}`)
    return task
  }

  private linkedTasks(entry: RegistryEntry): readonly TaskBoardLinkedTask[] {
    const id = entry.extension.id
    const result: TaskBoardLinkedTask[] = []
    for (const task of this.ledger.allTasks()) {
      const payload = readPayload(task.integrations?.[id])
      if (payload === undefined) continue
      result.push({ task, payload })
    }
    return result
  }

  private writeIntegration(entry: RegistryEntry, taskId: string, payload: TaskBoardExtensionPayload): void {
    this.assertActive(entry, 'write integration data')
    if (!isTaskBoardExtensionPayload(payload)) {
      throw new TaskBoardExtensionError('invalid-payload', 'integration payload must be a pure JSON object within the size limit')
    }
    const task = this.requireTask(taskId)
    const id = entry.extension.id
    const next = mergePayload(readPayload(task.integrations?.[id]), payload)
    if (!isTaskBoardExtensionPayload(next)) {
      throw new TaskBoardExtensionError('invalid-payload', `merged integration payload for ${id} exceeds ${taskBoardPayloadBytes(next) ?? '?'} bytes`)
    }
    this.ledger.saveTaskRecord({
      ...task,
      updatedAt: this.now(),
      integrations: { ...task.integrations, [id]: next },
    })
  }

  private publish(entry: RegistryEntry, summary: TaskBoardExtensionPayload): void {
    this.assertActive(entry, 'publish a summary')
    if (!isTaskBoardExtensionPayload(summary)) {
      throw new TaskBoardExtensionError('invalid-payload', 'published summary must be a pure JSON object within the size limit')
    }
    entry.published = summary
  }

  private registerTool(entry: RegistryEntry, definition: ToolDefinition): () => void {
    const tool: { definition: ToolDefinition; dispose?: () => void } = { definition }
    entry.tools.push(tool)
    this.syncTools(entry)
    return () => {
      const index = entry.tools.indexOf(tool)
      if (index === -1) return
      entry.tools.splice(index, 1)
      const dispose = tool.dispose
      tool.dispose = undefined
      if (dispose !== undefined) {
        try { dispose() } catch (error) { this.logger.error('[dsh-task-board] tool disposer failed', error) }
      }
    }
  }
}
