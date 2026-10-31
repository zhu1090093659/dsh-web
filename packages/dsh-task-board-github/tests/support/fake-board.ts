/**
 * A contract-level stand-in for the task board's host half.
 *
 * The extension may not import the board package, so its tests drive the same
 * capability face the board hands it, over an in-memory record store. The gates
 * the board owns are mirrored here exactly as the board documents them:
 *
 * - a provider starts only while the board's master switch AND its own
 *   `enabled()` are on (`reconcile`, the board registry's own rule);
 * - content is frozen once a card has an execution, or is archived;
 * - integration payloads are pure JSON within the board's size limit, and a
 *   merge clears a key written as `undefined`;
 * - a failing event callback is isolated and never interrupts the board.
 *
 * The board's own suite proves the same gates against the real registry with a
 * fake provider (`packages/dsh-task-board/tests/extension-fake-provider.spec.ts`);
 * this stand-in is what lets the extension's suite stay inside its own package.
 *
 * @module tests/support/fake-board
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type {
  TaskBoardEventFace,
  TaskBoardExecutionSettledEvent,
  TaskBoardExtension,
  TaskBoardExtensionHost,
  TaskBoardExtensionPayload,
  TaskBoardHostFace,
  TaskBoardLinkedTask,
  TaskBoardStatusChangedEvent,
  TaskBoardTaskDeletedEvent,
} from '../../src/core/contract.ts'
import type { HostTimerFace } from '../../src/core/timers.ts'
import type { ExecutionRecord, TaskRecord, TaskStatus } from '../../src/core/task-record.ts'

/** Largest accepted extension payload, mirroring the board's contract. */
const PAYLOAD_LIMIT_BYTES = 64 * 1024

/** Whether a value is a plain JSON value. */
function isJsonValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'object':
      break
    default:
      return false
  }
  if (Array.isArray(value)) return value.every(isJsonValue)
  return Object.values(value as Record<string, unknown>).every(isJsonValue)
}

/** Mirror the board's payload gate: plain JSON object within the size limit. */
export function isAcceptablePayload(value: unknown): value is TaskBoardExtensionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!isJsonValue(value)) return false
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= PAYLOAD_LIMIT_BYTES
  } catch {
    return false
  }
}

/** One admitted provider, tracked the way the board tracks it. */
interface Admitted {
  readonly extension: TaskBoardExtension
  active: boolean
  readonly subscriptions: Record<keyof TaskBoardEventFace, Set<(event: never) => void>>
  readonly tools: string[]
}

/** An in-memory board host for one extension id. */
export class FakeBoard {
  /** Cards by id, most recent mutation last (insertion order is enough here). */
  readonly records = new Map<string, TaskRecord>()
  /** The board's master switch. */
  boardEnabled = true
  /** Summaries published by running providers, keyed by extension id. */
  readonly published: Record<string, TaskBoardExtensionPayload> = {}
  /** Every status change the board emitted. */
  readonly statusChanges: TaskBoardStatusChangedEvent[] = []
  /** Every settlement the board emitted. */
  readonly settlements: TaskBoardExecutionSettledEvent[] = []
  /** Every deletion the board emitted. */
  readonly deletions: TaskBoardTaskDeletedEvent[] = []
  /** Fail one provider payload write to exercise transactional retry paths. */
  failNextIntegrationWrite = false
  /** Names of every tool currently registered by a running provider. */
  readonly toolNames: string[] = []
  /** Ids of every tool the board ever registered, in order. */
  readonly toolRegistrations: string[] = []

  private readonly admitted: Admitted[] = []
  private readonly now: () => number
  private sequence = 0

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => 1_000)
  }

  /** Seed one card directly, the way an import or an earlier session would. */
  seed(record: Partial<TaskRecord> & { id: string }): TaskRecord {
    const task: TaskRecord = {
      title: 'Seeded',
      description: '',
      prompt: 'p',
      status: 'todo',
      createdAt: this.now(),
      updatedAt: this.now(),
      executions: [],
      ...record,
    }
    this.records.set(task.id, task)
    return task
  }

  /**
   * Admit one provider under the board's own gate.
   * @param extension - the provider to admit.
   * @returns a disposer releasing the registration.
   */
  admit(extension: TaskBoardExtension): () => void {
    const entry: Admitted = {
      extension,
      active: false,
      subscriptions: { onStatusChanged: new Set(), onExecutionSettled: new Set(), onTaskDeleted: new Set() },
      tools: [],
    }
    this.admitted.push(entry)
    this.reconcile()
    return () => {
      this.stop(entry)
      this.admitted.splice(this.admitted.indexOf(entry), 1)
    }
  }

  /** Re-apply the board's gate to every admitted provider (its own sweep). */
  reconcile(): void {
    for (const entry of this.admitted) {
      const wanted = this.boardEnabled && (entry.extension.enabled?.() ?? true)
      if (wanted === entry.active) continue
      if (wanted) this.start(entry)
      else this.stop(entry)
    }
  }

  /** Whether the board currently runs a given provider. */
  isActive(extensionId: string): boolean {
    return this.admitted.some(entry => entry.extension.id === extensionId && entry.active)
  }

  /**
   * The board's registration surface, exactly as a provider receives it. The
   * gate, the capability face and the teardown are the ones {@link admit}
   * already implements, so a test that publishes this face through a real
   * cordis context exercises the same board the extension meets in production.
   * @returns the host capability face.
   */
  hostFace(): TaskBoardHostFace {
    return {
      registerExtension: extension => this.admit(extension),
      isExtensionEnabled: extensionId => this.isActive(extensionId),
    }
  }

  /** Emit one status change to every running provider. */
  emitStatusChanged(event: TaskBoardStatusChangedEvent): void {
    this.statusChanges.push(event)
    this.emit('onStatusChanged', event)
  }

  /** Emit one execution settlement to every running provider. */
  emitExecutionSettled(event: TaskBoardExecutionSettledEvent): void {
    this.settlements.push(event)
    this.emit('onExecutionSettled', event)
  }

  /** Emit one deletion to every running provider. */
  emitTaskDeleted(event: TaskBoardTaskDeletedEvent): void {
    this.deletions.push(event)
    this.emit('onTaskDeleted', event)
  }

  /** Stop every running provider and drop every registration. */
  dispose(): void {
    for (const entry of [...this.admitted]) this.stop(entry)
    this.admitted.length = 0
  }

  // --- internals -------------------------------------------------------------

  private start(entry: Admitted): void {
    entry.active = true
    entry.extension.start?.(this.capabilities(entry))
  }

  private stop(entry: Admitted): void {
    if (entry.active) {
      entry.active = false
      for (const kind of Object.keys(entry.subscriptions) as Array<keyof TaskBoardEventFace>) {
        entry.subscriptions[kind].clear()
      }
      try {
        entry.extension.stop?.()
      } catch {
        // A provider that throws on stop degrades only itself.
      }
    }
    for (const name of entry.tools.splice(0)) {
      const index = this.toolNames.indexOf(name)
      if (index !== -1) this.toolNames.splice(index, 1)
    }
    delete this.published[entry.extension.id]
  }

  private emit(kind: keyof TaskBoardEventFace, payload: unknown): void {
    for (const entry of this.admitted) {
      if (!entry.active) continue
      for (const callback of [...entry.subscriptions[kind]]) {
        try {
          ;(callback as (event: unknown) => void)(payload)
        } catch {
          // Every callback runs isolated, exactly as the board documents.
        }
      }
    }
  }

  private capabilities(entry: Admitted): TaskBoardExtensionHost {
    const id = entry.extension.id
    const subscribe = (kind: keyof TaskBoardEventFace, callback: (event: never) => void): (() => void) => {
      if (!entry.active) throw new Error(`extension "${id}" cannot subscribe while disabled`)
      entry.subscriptions[kind].add(callback)
      return () => { entry.subscriptions[kind].delete(callback) }
    }
    return {
      tasks: {
        list: () => [...this.records.values()],
        get: taskId => this.records.get(taskId),
        create: (draft, options) => this.createTask(id, draft, options),
        patchContent: (taskId, patch) => { this.patchContent(taskId, patch) },
        setStatus: (taskId, status, initiator) => { this.setStatus(taskId, status, initiator) },
        linked: () => this.linked(id),
      },
      integration: {
        read: taskId => {
          if (!entry.active) throw new Error(`extension "${id}" cannot read while disabled`)
          const value = this.records.get(taskId)?.integrations?.[id]
          return isAcceptablePayload(value) ? value : undefined
        },
        write: (taskId, payload) => { this.writeIntegration(id, taskId, payload) },
      },
      events: {
        onStatusChanged: callback => subscribe('onStatusChanged', callback as (event: never) => void),
        onExecutionSettled: callback => subscribe('onExecutionSettled', callback as (event: never) => void),
        onTaskDeleted: callback => subscribe('onTaskDeleted', callback as (event: never) => void),
      },
      publish: summary => {
        if (!entry.active) throw new Error(`extension "${id}" cannot publish while disabled`)
        if (!isAcceptablePayload(summary)) throw new Error('published summary must be a pure JSON object within the size limit')
        this.published[id] = summary
      },
      registerTool: definition => this.registerTool(entry, definition),
    }
  }

  private createTask(
    extensionId: string,
    draft: { title: string; description: string; prompt: string; status?: TaskStatus; parentId?: string; workspaceId?: string },
    options?: { payload?: TaskBoardExtensionPayload; hidden?: boolean },
  ): TaskRecord {
    const task: TaskRecord = {
      id: `task-${String(++this.sequence)}`,
      title: draft.title,
      description: draft.description,
      prompt: draft.prompt,
      status: draft.status ?? 'todo',
      createdAt: this.now(),
      updatedAt: this.now(),
      executions: [],
      ...(draft.parentId === undefined ? {} : { parentId: draft.parentId }),
      ...(draft.workspaceId === undefined ? {} : { workspaceId: draft.workspaceId }),
      ...(options?.hidden === true ? { hidden: true } : {}),
      ...(options?.payload === undefined ? {} : { integrations: { [extensionId]: options.payload } }),
    }
    this.records.set(task.id, task)
    return task
  }

  private patchContent(taskId: string, patch: { title?: string; description?: string; prompt?: string }): void {
    const task = this.records.get(taskId)
    if (task === undefined) throw new Error(`no task with id ${taskId}`)
    if (task.executions.length > 0 || task.archivedAt !== undefined) {
      throw new Error(`task ${taskId} has started executing; its content is read-only`)
    }
    this.records.set(taskId, { ...task, ...patch })
  }

  private setStatus(taskId: string, status: TaskStatus, initiator?: string): void {
    const task = this.records.get(taskId)
    if (task === undefined) throw new Error(`no task with id ${taskId}`)
    const previous = task.status
    this.records.set(taskId, { ...task, status, updatedAt: this.now() })
    this.emitStatusChanged({ taskId, status, previous, ...(initiator === undefined ? {} : { initiator }) })
  }

  private linked(extensionId: string): readonly TaskBoardLinkedTask[] {
    const result: TaskBoardLinkedTask[] = []
    for (const task of this.records.values()) {
      const payload = task.integrations?.[extensionId]
      if (!isAcceptablePayload(payload)) continue
      result.push({ task, payload })
    }
    return result
  }

  private writeIntegration(extensionId: string, taskId: string, payload: TaskBoardExtensionPayload): void {
    if (this.failNextIntegrationWrite) {
      this.failNextIntegrationWrite = false
      throw new Error('injected integration write failure')
    }
    if (!isAcceptablePayload(payload)) throw new Error('integration payload must be a pure JSON object within the size limit')
    const task = this.records.get(taskId)
    if (task === undefined) throw new Error(`no task with id ${taskId}`)
    const current = this.records.get(taskId)?.integrations?.[extensionId]
    const next: TaskBoardExtensionPayload = isAcceptablePayload(current) ? { ...current } : {}
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) delete next[key]
      else next[key] = value
    }
    if (!isAcceptablePayload(next)) throw new Error('merged integration payload exceeds the size limit')
    this.records.set(taskId, { ...task, integrations: { ...(task.integrations ?? {}), [extensionId]: next } })
  }

  private registerTool(entry: Admitted, definition: ToolDefinition): () => void {
    if (!entry.active) throw new Error(`extension "${entry.extension.id}" cannot register a tool while disabled`)
    entry.tools.push(definition.name)
    this.toolNames.push(definition.name)
    this.toolRegistrations.push(definition.name)
    return () => {
      const entryIndex = entry.tools.indexOf(definition.name)
      if (entryIndex !== -1) entry.tools.splice(entryIndex, 1)
      const liveIndex = this.toolNames.indexOf(definition.name)
      if (liveIndex !== -1) this.toolNames.splice(liveIndex, 1)
    }
  }
}

/** One local card record with no executions and no integrations. */
export function plainTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    title: 'Task',
    description: '',
    prompt: 'p',
    status: 'todo',
    createdAt: 1_000,
    updatedAt: 1_000,
    executions: [],
    ...overrides,
  }
}

/** Attach one synthesized execution to a card, so the content gate engages. */
export function withExecution(task: TaskRecord, execution: ExecutionRecord): TaskRecord {
  return { ...task, executions: [...task.executions, execution] }
}

/** A timer face that records what the provider armed instead of scheduling it. */
export interface RecordingTimers {
  /** The face a provider schedules through. */
  timers: HostTimerFace
  /** Every timer the provider armed, in order. */
  armed: Array<{ kind: 'interval' | 'timeout'; delay: number }>
  /** How many armed timers were released. */
  cancelledCount(): number
}

/**
 * Build a timer face that records instead of scheduling, so a test can prove
 * polling was armed — or never armed at all.
 * @returns the face, what it armed, and how many cancellations it saw.
 */
export function recordingTimers(): RecordingTimers {
  const armed: Array<{ kind: 'interval' | 'timeout'; delay: number }> = []
  let cancelled = 0
  return {
    armed,
    cancelledCount: () => cancelled,
    timers: {
      timeout: (_callback: () => void, delay: number) => {
        armed.push({ kind: 'timeout', delay })
        return () => { cancelled += 1 }
      },
      interval: (_callback: () => void, delay: number) => {
        armed.push({ kind: 'interval', delay })
        return () => { cancelled += 1 }
      },
    },
  }
}
