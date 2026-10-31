/**
 * The task board's external provider extension contract.
 *
 * This module is the single source of truth for how another plugin adds a
 * provider surface to the task board: the cordis service name both halves
 * publish, the API version they negotiate, the child seats a provider renders
 * into, the host capability face a provider implements against, and the client
 * capability face the board's browser half provides. It is framework-free and
 * shared by the host and browser programs; the only imported SDK type is
 * type-only, so the browser bundle never pulls a value out of an SDK package.
 *
 * @module dsh-task-board/core/extension
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TaskBoardAction, TaskBoardSnapshot, TaskBoardVerificationOptions } from '../protocol.ts'
import type { ExecutionOutcome, TaskRecord, TaskStatus } from './tasks.ts'

/** Cordis service name the host and browser halves each publish. */
export const TASK_BOARD_SERVICE_NAME = 'taskBoard'

/**
 * Contract version of {@link TASK_BOARD_SERVICE_NAME}. A provider declares the
 * version it was built against; the board refuses (visibly) any other version
 * instead of guessing at a stale shape.
 */
export const TASK_BOARD_API_VERSION = 1

/** Child seat a provider registers its task-detail section into. */
export const TASK_BOARD_DETAIL_SECTION = 'task-board.detail.section'
/** Child seat a provider registers its settings section into. */
export const TASK_BOARD_SETTINGS_SECTION = 'task-board.settings.section'
/** Child seat a provider registers its card decoration into. */
export const TASK_BOARD_CARD_DECORATION = 'task-board.card.decoration'

/** Every child seat the board declares for extensions, in render order. */
export const TASK_BOARD_EXTENSION_SEATS: readonly string[] = [
  TASK_BOARD_DETAIL_SECTION,
  TASK_BOARD_SETTINGS_SECTION,
  TASK_BOARD_CARD_DECORATION,
]

/**
 * Largest accepted extension payload, in bytes of its JSON serialization. One
 * integration entry — and one action payload — may carry schema the board does
 * not interpret, but never enough of it to bloat the ledger or the action
 * channel.
 */
export const TASK_BOARD_PAYLOAD_LIMIT_BYTES = 64 * 1024

/**
 * Largest accepted free text a provider pushes into an execution, in
 * characters: one follow-up message, or one set of rework instructions. Both
 * reach a model as user input, so the bound keeps a single provider call from
 * becoming an unbounded context injection.
 */
export const TASK_BOARD_MESSAGE_MAX_LENGTH = 4_000

/** Depth beyond which a payload is refused instead of walked. */
const PAYLOAD_DEPTH_LIMIT = 64

/** One opaque provider payload the board stores and forwards without interpreting. */
export type TaskBoardExtensionPayload = Record<string, unknown>

/** Whether a value is a plain JSON value (no undefined, function, symbol, bigint or cycle). */
function isJsonValue(value: unknown, depth: number): boolean {
  if (depth > PAYLOAD_DEPTH_LIMIT) return false
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    // A provider's in-memory metadata legitimately clears a field by setting it
    // to undefined; JSON serialization drops such a key, so the persisted
    // payload is still pure JSON.
    case 'undefined':
      return true
    case 'object':
      break
    default:
      return false
  }
  if (Array.isArray(value)) return value.every(item => isJsonValue(item, depth + 1))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(value as Record<string, unknown>).every(item => isJsonValue(item, depth + 1))
}

/**
 * Validate one extension payload: a pure JSON object whose serialization fits
 * {@link TASK_BOARD_PAYLOAD_LIMIT_BYTES}. Arrays, primitives and non-plain
 * objects are refused; the board never interprets the keys.
 * @param value - candidate payload.
 * @returns whether the value is an acceptable opaque payload.
 */
export function isTaskBoardExtensionPayload(value: unknown): value is TaskBoardExtensionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if (!isJsonValue(value, 0)) return false
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= TASK_BOARD_PAYLOAD_LIMIT_BYTES
  } catch {
    return false
  }
}

/** Byte length of a value's JSON serialization, or undefined when it does not serialize. */
export function taskBoardPayloadBytes(value: unknown): number | undefined {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return undefined
  }
}

/**
 * Normalize a task's whole integrations container: a plain JSON object whose
 * values are each an opaque provider payload within the size limit. A malformed
 * container normalizes to undefined (the field is dropped), and one malformed
 * entry is dropped alone so a single bad provider can never take a card — or
 * another provider's data — with it.
 * @param value - candidate container from the wire, the ledger, or a create input.
 * @returns the cleaned container, or undefined when nothing usable remains.
 */
export function normalizeTaskIntegrations(value: unknown): Record<string, TaskBoardExtensionPayload> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const result: Record<string, TaskBoardExtensionPayload> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === '') continue
    if (!isTaskBoardExtensionPayload(entry)) continue
    result[key] = entry
  }
  return Object.keys(result).length === 0 ? undefined : result
}

/** One action a provider dispatches over the board's same-origin channel. */
export interface TaskBoardExtensionActionRequest {
  /** Id of the extension the action belongs to. */
  extensionId: string
  /** Provider-owned action name, routed back to that extension's handleAction. */
  action: string
  /** Task the action targets, when it targets one. */
  taskId?: string
  /** Opaque provider payload, bounded like every other extension payload. */
  payload?: TaskBoardExtensionPayload
}

/**
 * Deliver one extension action through the board's same-origin action channel.
 * The extension never opens an HTTP surface of its own.
 */
export type TaskBoardExtensionDispatch = (request: TaskBoardExtensionActionRequest) => Promise<boolean>

/** Draft one provider creates a task from. */
export interface TaskBoardTaskDraft {
  title: string
  description: string
  prompt: string
  /** Column the created card opens in; absent means the board default (todo). */
  status?: TaskStatus
  /** Parent card id, when the provider materializes a subtask. */
  parentId?: string
  /**
   * Workspace the execution must run in. Absent leaves the board's own
   * inheritance rules in charge (the creating session's workspace for a root
   * card, else the recent workspace at execution time), so a provider that has
   * no reason to know better pins nothing.
   */
  workspaceId?: string
  /**
   * Agent preset the created card pins as its execution composition. Absent
   * pins nothing and leaves the board's own resolution in charge. The value is
   * forwarded to the board's creation path unchanged, so a preset this
   * deployment does not register fails the RUN closed, exactly as it does for a
   * card created anywhere else.
   */
  mode?: string
  /**
   * Model the created card pins, in `provider/model` form — the same field
   * `task_board_create` takes. Resolved against the host catalog at launch, so
   * an unknown route is a run-time answer, not a creation-time one.
   */
  model?: string
  /**
   * Reasoning level for the pinned {@link model}. It travels with the model it
   * was chosen for: the board never applies a level to a route that does not
   * declare it.
   */
  reasoningEffort?: string
}

/** Options of {@link TaskBoardTasksFace.create}. */
export interface TaskBoardCreateOptions {
  /** Opaque payload stored under the creating extension's id. */
  payload?: TaskBoardExtensionPayload
  /** Create the card off-board: it exists in the ledger but is never shown on the board. */
  hidden?: boolean
}

/** One task linked to an extension, with that extension's own payload. */
export interface TaskBoardLinkedTask {
  task: TaskRecord
  payload: TaskBoardExtensionPayload
}

/** Task reads and writes the board grants an extension. */
export interface TaskBoardTasksFace {
  /** Every task in the ledger, most recent mutation last. */
  list(): readonly TaskRecord[]
  /** One task by id, or undefined. */
  get(taskId: string): TaskRecord | undefined
  /**
   * Create a task through the board's own creation gate; the payload lands
   * under the creating extension's id. Throws on a refused draft.
   */
  create(draft: TaskBoardTaskDraft, options?: TaskBoardCreateOptions): TaskRecord
  /**
   * Patch a task's content. Reuses the board's own content gate: a task that
   * has started executing keeps its recorded title/description/prompt.
   * Throws when the card is frozen.
   */
  patchContent(taskId: string, patch: { title?: string; description?: string; prompt?: string }): void
  /**
   * Move a task through the board's existing status gates (running lock,
   * permission confirmation gate). Throws on refusal.
   */
  setStatus(taskId: string, status: TaskStatus, initiator?: string): void
  /** Every task carrying this extension's payload. */
  linked(): readonly TaskBoardLinkedTask[]
  /**
   * Run a card that already executed again — in its ORIGINAL session — with
   * `instructions` carried as this run's additional input, which is how a
   * reviewer sends work back rather than asking for a fresh attempt. The
   * instructions are recorded on the execution the request opens, so the run
   * history says why that run exists.
   *
   * The request passes through every run gate the board already has — the
   * running lock, the permission confirmation, the acceptance contract and the
   * spend cap — and it never rewrites the card: an executed card's frozen
   * title, description and prompt stay exactly what ran (see
   * {@link TaskBoardTasksFace.patchContent}). A card that never executed, or
   * whose session cannot be continued, is refused instead of quietly starting a
   * conversation the caller never saw.
   *
   * Optional, like {@link TaskBoardExtensionHost.sessions}: the contract
   * version stays 1, so a provider checks the face before using it.
   */
  rework?(taskId: string, instructions: string, initiator?: string): void
}

/**
 * Execution-session face: what a provider delivers INTO a run the board
 * already executed or is executing now.
 */
export interface TaskBoardSessionsFace {
  /**
   * Queue one follow-up user message into the session of the card's current
   * execution, or of its most recent one when no execution is open.
   *
   * The message is an ordinary user turn queued behind whatever that session is
   * doing; it re-asserts nothing, so the execution's permission, model and
   * preset stay the ones the run froze. A card that never executed, an archived
   * card, and a session the host no longer reaches are refused.
   */
  followUp(taskId: string, text: string): Promise<void>
}

/** Storage face for one extension's own payload on a task. */
export interface TaskBoardIntegrationFace {
  /** Read this extension's payload, or undefined when the task carries none. */
  read(taskId: string): TaskBoardExtensionPayload | undefined
  /**
   * Shallow-merge this extension's payload into the task: the given keys
   * replace the stored ones, and a key explicitly set to undefined clears it.
   * The board stores the result opaquely; a non-JSON or oversized payload is
   * refused.
   */
  write(taskId: string, payload: TaskBoardExtensionPayload): void
}

/** Status-change notification. */
export interface TaskBoardStatusChangedEvent {
  taskId: string
  status: TaskStatus
  previous: TaskStatus
  initiator?: string
}

/** Execution-settlement notification. */
export interface TaskBoardExecutionSettledEvent {
  taskId: string
  executionId: string
  outcome: ExecutionOutcome
  error?: string
}

/** Task-deletion notification. */
export interface TaskBoardTaskDeletedEvent {
  taskId: string
}

/**
 * Event subscriptions an extension registers for. Every callback runs isolated:
 * a throw is logged and never interrupts the board's own execution path.
 */
export interface TaskBoardEventFace {
  onStatusChanged(callback: (event: TaskBoardStatusChangedEvent) => void): () => void
  onExecutionSettled(callback: (event: TaskBoardExecutionSettledEvent) => void): () => void
  onTaskDeleted(callback: (event: TaskBoardTaskDeletedEvent) => void): () => void
}

/**
 * Host capability face handed to one extension while it is started. The face
 * lives for the extension's enabled lifetime; the board revokes it by calling
 * the extension's stop().
 */
export interface TaskBoardExtensionHost {
  tasks: TaskBoardTasksFace
  /**
   * Delivery into a card's execution session. Optional in the contract on
   * purpose: the API version stays 1, so a provider built against this revision
   * probes the face and keeps working against a board that serves none.
   */
  sessions?: TaskBoardSessionsFace
  integration: TaskBoardIntegrationFace
  events: TaskBoardEventFace
  /**
   * Publish this extension's read-only summary; it lands in the snapshot's
   * extensions[id] for the extension's browser half to render.
   */
  publish(summary: TaskBoardExtensionPayload): void
  /** Register one model-visible tool; the returned disposer unregisters it. */
  registerTool(definition: ToolDefinition): () => void
}

/** One external provider contributed to the task board. */
export interface TaskBoardExtension {
  /** Stable extension id; also the key of this extension's integration payload. */
  readonly id: string
  /** Contract version this extension was built against. */
  readonly apiVersion: number
  /** Volatile per-extension switch; absent means enabled. Read at use time. */
  enabled?(): boolean
  /** Acquire the capability face and start any provider-side work. */
  start?(host: TaskBoardExtensionHost): void
  /** Release provider-side work. Never clears stored data. */
  stop?(): void
  /** Route one dispatched action; the returned value goes back to the dispatcher. */
  handleAction?(request: TaskBoardExtensionActionRequest): unknown | Promise<unknown>
}

/** Board mirror an extension's browser half observes. */
export interface TaskBoardClientMirror {
  /** Whether the board's master switch currently runs the extension faces. */
  enabled: boolean
  /** Tasks the board currently holds. */
  tasks: readonly TaskRecord[]
  /** Published extension summaries, keyed by extension id (opaque to the board). */
  extensions: Readonly<Record<string, unknown>>
}

/** Whether a task should be shown on the board; false hides it. */
export type TaskBoardVisibilityPredicate = (task: TaskRecord) => boolean

/** Generic source bucket a provider assigns to one card. */
export interface TaskBoardSourceGroup {
  /** Stable, provider-namespaced identity used for ordering and fold persistence. */
  id: string
  /** Full human-readable source label, such as an owner/repository pair. */
  label: string
}

/** Return a card's source group, or undefined when this provider does not own it. */
export type TaskBoardGroupingSelector = (task: TaskRecord) => TaskBoardSourceGroup | undefined

/**
 * Client capability face the board's browser half provides. A provider's
 * browser half resolves it from the shared cordis service name; it never
 * value-imports the board package.
 */
export interface TaskBoardClientFace {
  /** Deliver one action through the board's same-origin action channel. */
  dispatch(request: TaskBoardExtensionActionRequest): Promise<boolean>
  /** Register one card visibility predicate; the returned disposer removes it. */
  registerVisibility(predicate: TaskBoardVisibilityPredicate): () => void
  /**
   * Register one source-group selector; the first selector returning a group
   * wins. Optional so an older board can serve the same API version.
   */
  registerGrouping?(selector: TaskBoardGroupingSelector): () => void
  /** Subscribe to the board mirror. */
  subscribe(callback: (mirror: TaskBoardClientMirror) => void): () => void
  /** Read the current board mirror. */
  snapshot(): TaskBoardClientMirror
}

/** Owner props of the task-detail seat. */
export interface TaskBoardDetailSectionProps {
  task: TaskRecord
  dispatch: TaskBoardExtensionDispatch
}

/** Owner props of the settings seat. */
export interface TaskBoardSettingsSectionProps {
  dispatch: TaskBoardExtensionDispatch
}

/** Owner props of the card-decoration seat. */
export interface TaskBoardCardDecorationProps {
  task: TaskRecord
}

/**
 * Host-half service face published under {@link TASK_BOARD_SERVICE_NAME}. A
 * provider package's host half resolves this from the shared cordis service
 * and registers its extension; the board's ledger never crosses this boundary.
 */
export interface TaskBoardHostFace {
  /**
   * Admit one provider extension. Idempotent by extension id; the returned
   * disposer releases it without clearing stored data.
   */
  registerExtension(extension: TaskBoardExtension): () => void
  /** Whether the board currently runs a given extension (board x extension). */
  isExtensionEnabled(extensionId: string): boolean
  /**
   * The whole ledger as the board builds it, tasks included.
   *
   * Part of the read/write face an IN-PROCESS consumer drives the board through
   * (the remote bridge plugin forwarding it to a paired phone); a browser half
   * reads the same document over the board's own HTTP surface. Forwards
   * {@link ../host-service.ts | TaskBoardHostService.snapshot}, so nothing is
   * interpreted between the ledger and the caller.
   */
  snapshot(): TaskBoardSnapshot
  /**
   * Apply one action through every gate the board already has — the running
   * lock, the permission confirmation, the subtask depth, the schedule budget —
   * and answer the resulting snapshot.
   *
   * The `requestId` is the ledger's own idempotency key, so a caller that
   * retries one envelope does not apply it twice. Refusals are the ledger's:
   * they throw with the Host's own text, which is why this face adds no code
   * table of its own.
   */
  apply(requestId: string, action: TaskBoardAction, initiator?: string): TaskBoardSnapshot | Promise<TaskBoardSnapshot>
  /**
   * Follow the board's change notifications. The listener receives no payload —
   * a consumer that needs the state reads {@link snapshot} — and the returned
   * disposer unsubscribes.
   */
  subscribe(listener: () => void): () => void
  /**
   * The acceptance settings, the contract they resolve to right now, and the
   * model catalog the choices come from. The same document the board's own
   * `/verification` route serves.
   */
  verificationOptions(): Promise<TaskBoardVerificationOptions>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The board's extension service. The host half publishes
     * {@link TaskBoardHostFace}; the browser half publishes
     * {@link TaskBoardClientFace} under the same name. The two halves never run
     * in one process, so the browser half resolves its face through
     * {@link resolveTaskBoardClientFace} and this shared declaration names the
     * host face that registration-side consumers type against.
     */
    taskBoard: TaskBoardHostFace
  }
}

/** The narrow context seat {@link resolveTaskBoardClientFace} needs. */
export interface TaskBoardClientContextSeat {
  get(name: string): unknown
}

/**
 * Resolve the browser half's client capability face by service name. Returns
 * undefined when the board is not loaded or the service is not served, so a
 * provider's browser half can degrade instead of throwing.
 * @param ctx - client context.
 * @returns the client face, or undefined.
 */
export function resolveTaskBoardClientFace(ctx: TaskBoardClientContextSeat): TaskBoardClientFace | undefined {
  try {
    const face = ctx.get(TASK_BOARD_SERVICE_NAME) as TaskBoardClientFace | undefined
    return face !== undefined && typeof (face as { dispatch?: unknown }).dispatch === 'function' ? face : undefined
  } catch {
    return undefined
  }
}
