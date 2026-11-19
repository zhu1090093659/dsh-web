/**
 * Same-shape restatement of the two contracts this extension sits between.
 *
 * The board owns the provider contract (`packages/dsh-task-board/src/core/extension.ts`)
 * and `dsh-ssh` owns its host service; this package may not import either
 * package's internals, so every type and constant it consumes is restated here
 * with an identical shape and resolved at runtime through the shared cordis
 * service name. Nothing in this module is a value import of a board or ssh
 * package: the declarations are erased and each service lookup is a plain
 * property read.
 *
 * Both seams are incremental members under an unchanged API version, following
 * the precedent the board set with `tasks.rework` and `sessions.followUp`:
 * `launch?.intercept(handler)` on the host face and `dshSsh`'s `exec`/`upload`/
 * `download` forwards. A deployment that serves neither keeps working, because
 * every new member is optional and probed before use.
 *
 * @module dsh-task-board-ssh/core/contract
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ExecutionOutcome, TaskRecord, TaskStatus } from './task-record.ts'

/** Cordis service name the board's host and browser halves each publish. */
export const TASK_BOARD_SERVICE_NAME = 'taskBoard'

/** Board contract version this extension was built against. */
export const TASK_BOARD_API_VERSION = 1

/** Child seat a provider registers its task-detail section into. */
export const TASK_BOARD_DETAIL_SECTION = 'task-board.detail.section'
/** Child seat a provider registers its settings section into. */
export const TASK_BOARD_SETTINGS_SECTION = 'task-board.settings.section'
/** Child seat a provider registers its card decoration into. */
export const TASK_BOARD_CARD_DECORATION = 'task-board.card.decoration'

/** Largest accepted extension payload, in bytes of its JSON serialization. */
export const TASK_BOARD_PAYLOAD_LIMIT_BYTES = 64 * 1024

/** Largest accepted free text a provider pushes into an execution, in characters. */
export const TASK_BOARD_MESSAGE_MAX_LENGTH = 4_000

/** One opaque provider payload the board stores without interpreting. */
export type TaskBoardExtensionPayload = Record<string, unknown>

/** One action the browser half dispatches over the board's same-origin channel. */
export interface TaskBoardExtensionActionRequest {
  /** Id of the extension the action belongs to. */
  extensionId: string
  /** Provider-owned action name, routed back to this extension's handleAction. */
  action: string
  /** Task the action targets, when it targets one. */
  taskId?: string
  /** Opaque provider payload, bounded like every other extension payload. */
  payload?: TaskBoardExtensionPayload
}

/** Deliver one extension action through the board's same-origin action channel. */
export type TaskBoardExtensionDispatch = (request: TaskBoardExtensionActionRequest) => Promise<boolean>

/** Draft one provider creates a task from. */
export interface TaskBoardTaskDraft {
  /** Card title. */
  title: string
  /** Card description. */
  description: string
  /** Prompt an execution sends to the agent. */
  prompt: string
  /** Column the created card opens in; absent means the board default. */
  status?: TaskStatus
  /** Parent card id, when the provider materializes a subtask. */
  parentId?: string
  /** Workspace the execution must run in; absent leaves the board's rules in charge. */
  workspaceId?: string
  /** Agent preset the card pins as its execution composition. */
  mode?: string
  /** Model the card pins, in `provider/model` form. */
  model?: string
  /** Reasoning level for the pinned model. */
  reasoningEffort?: string
}

/** Options of {@link TaskBoardTasksFace.create}. */
export interface TaskBoardCreateOptions {
  /** Opaque payload stored under the creating extension's id. */
  payload?: TaskBoardExtensionPayload
  /** Create the card off-board: it exists in the ledger but is never shown. */
  hidden?: boolean
}

/** One task linked to an extension, with that extension's own payload. */
export interface TaskBoardLinkedTask {
  /** The card as the board stores it. */
  task: TaskRecord
  /** This extension's payload on that card. */
  payload: TaskBoardExtensionPayload
}

/** Task reads and writes the board grants an extension. */
export interface TaskBoardTasksFace {
  /** Every task in the ledger. */
  list(): readonly TaskRecord[]
  /** One task by id, or undefined. */
  get(taskId: string): TaskRecord | undefined
  /** Create a task through the board's own creation gate. Throws on refusal. */
  create(draft: TaskBoardTaskDraft, options?: TaskBoardCreateOptions): TaskRecord
  /** Patch a task's content through the board's content gate. Throws when frozen. */
  patchContent(taskId: string, patch: { title?: string; description?: string; prompt?: string }): void
  /** Move a task through the board's status gates. Throws on refusal. */
  setStatus(taskId: string, status: TaskStatus, initiator?: string): void
  /** Every task carrying this extension's payload. */
  linked(): readonly TaskBoardLinkedTask[]
  /** Run an already executed card again in its original session. */
  rework?(taskId: string, instructions: string, initiator?: string): void
}

/** Execution-session face: what a provider delivers INTO a board run. */
export interface TaskBoardSessionsFace {
  /** Queue one follow-up user message into the session of the card's latest execution. */
  followUp(taskId: string, text: string): Promise<void>
}

/** Storage face for one extension's own payload on a task. */
export interface TaskBoardIntegrationFace {
  /** Read this extension's payload, or undefined when the task carries none. */
  read(taskId: string): TaskBoardExtensionPayload | undefined
  /** Shallow-merge this extension's payload into the task. */
  write(taskId: string, payload: TaskBoardExtensionPayload): void
}

/** Status-change notification. */
export interface TaskBoardStatusChangedEvent {
  /** Card whose column changed. */
  taskId: string
  /** Column the card moved to. */
  status: TaskStatus
  /** Column the card came from. */
  previous: TaskStatus
  /** Party that initiated the move, when one was recorded. */
  initiator?: string
}

/** Execution-settlement notification. */
export interface TaskBoardExecutionSettledEvent {
  /** Card whose execution settled. */
  taskId: string
  /** Execution that settled. */
  executionId: string
  /** How it settled. */
  outcome: ExecutionOutcome
  /** Failure text, when the board recorded one. */
  error?: string
}

/** Task-deletion notification. */
export interface TaskBoardTaskDeletedEvent {
  /** Card that was deleted. */
  taskId: string
}

/** Event subscriptions an extension registers for; every callback runs isolated. */
export interface TaskBoardEventFace {
  /** Subscribe to column changes. */
  onStatusChanged(callback: (event: TaskBoardStatusChangedEvent) => void): () => void
  /** Subscribe to local execution settlement. */
  onExecutionSettled(callback: (event: TaskBoardExecutionSettledEvent) => void): () => void
  /** Subscribe to card deletion. */
  onTaskDeleted(callback: (event: TaskBoardTaskDeletedEvent) => void): () => void
}

/**
 * What asked for a card to run. The runner consults the launch handlers once,
 * at the single launch entry, before any session exists.
 */
export type TaskBoardLaunchTrigger = 'manual' | 'rerun' | 'schedule' | 'tool'

/** Context a launch handler receives alongside the card. */
export interface TaskBoardLaunchContext {
  /** Which path started this launch. */
  trigger: TaskBoardLaunchTrigger
}

/**
 * What a launch handler decides for one card.
 *
 * `local` keeps the board's own execution and injects `promptPreamble` ahead of
 * the prompt (proxy mode); `external` creates no session and no execution
 * record, moves the card to the running column, and leaves the outcome to the
 * provider through the existing external-outcome action.
 */
export type TaskBoardLaunchDecision =
  | { kind: 'local'; promptPreamble?: string }
  | { kind: 'external' }

/**
 * One launch interception. Synchronous by contract: the runner may not await a
 * network round trip between "the user pressed run" and "a session exists", and
 * a throwing handler is isolated and treated as `undefined`.
 */
export type TaskBoardLaunchHandler = (
  task: TaskRecord,
  context: TaskBoardLaunchContext,
) => TaskBoardLaunchDecision | undefined

/** Launch interception surface added to the host face under API version 1. */
export interface TaskBoardLaunchFace {
  /** Register one handler; the returned disposer removes it. */
  intercept(handler: TaskBoardLaunchHandler): () => void
}

/** Host capability face handed to one extension while it is started. */
export interface TaskBoardExtensionHost {
  /** Task reads and writes. */
  tasks: TaskBoardTasksFace
  /** Delivery into a card's execution session, when the board serves it. */
  sessions?: TaskBoardSessionsFace
  /** Opaque payload storage for this extension. */
  integration: TaskBoardIntegrationFace
  /** Board notifications. */
  events: TaskBoardEventFace
  /** Launch interception, when the board serves it. */
  launch?: TaskBoardLaunchFace
  /** Publish this extension's read-only summary into the board snapshot. */
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
  /** Published extension summaries, keyed by extension id. */
  extensions: Readonly<Record<string, unknown>>
}

/** Whether a task should be shown on the board; false hides it. */
export type TaskBoardVisibilityPredicate = (task: TaskRecord) => boolean

/** Generic source bucket a provider assigns to one card. */
export interface TaskBoardSourceGroup {
  /** Stable, provider-namespaced identity used for ordering and fold persistence. */
  id: string
  /** Full human-readable source label. */
  label: string
}

/** Client capability face the board's browser half provides. */
export interface TaskBoardClientFace {
  /** Deliver one action through the board's same-origin action channel. */
  dispatch(request: TaskBoardExtensionActionRequest): Promise<boolean>
  /** Register one card visibility predicate; the returned disposer removes it. */
  registerVisibility(predicate: TaskBoardVisibilityPredicate): () => void
  /** Register one source-group selector, when the board serves one. */
  registerGrouping?(selector: (task: TaskRecord) => TaskBoardSourceGroup | undefined): () => void
  /** Subscribe to the board mirror. */
  subscribe(callback: (mirror: TaskBoardClientMirror) => void): () => void
  /** Read the current board mirror. */
  snapshot(): TaskBoardClientMirror
}

/**
 * Host-half service face published under {@link TASK_BOARD_SERVICE_NAME}. This
 * extension's host half resolves it from the shared cordis service and
 * registers its extension; the board's ledger never crosses this boundary.
 */
export interface TaskBoardHostFace {
  /** Admit one provider extension; the returned disposer releases it. */
  registerExtension(extension: TaskBoardExtension): () => void
  /** Whether the board currently runs a given extension (board x extension). */
  isExtensionEnabled(extensionId: string): boolean
  /** The whole ledger as the board builds it, tasks included. */
  snapshot(): unknown
}

/** Cordis service name the `dsh-ssh` host half publishes the face under. */
export const DSH_SSH_SERVICE = 'dshSsh'

/** Version of the `dsh-ssh` contract; this package restates the number it was built against. */
export const DSH_SSH_API_VERSION = 1

/** Authentication flavors a `dsh-ssh` host entry may carry. */
export type DshSshAuthKind = 'key' | 'password' | 'agent'

/**
 * One host as `dsh-ssh` reports it. The fields are the ones its own host
 * summary already publishes, minus the `proxyCommand` text: a ProxyCommand is a
 * shell line the host process executes with its own privileges, so no consumer
 * receives it. Passwords, key passphrases and private-key paths are absent as
 * well, which is what makes this face safe to read from a card, a log line or a
 * model payload.
 */
export interface DshSshHost {
  /** Stable, user-chosen identifier every operation addresses. */
  alias: string
  /** Hostname or IP of the target. */
  host: string
  /** SSH port. */
  port: number
  /** Login user. */
  user: string
  /** Authentication flavor the stored entry uses. */
  auth: DshSshAuthKind
  /** Whether the configured private-key file exists on this machine (key auth only). */
  keyReady: boolean
  /** Jump chain: local aliases connected through in order. */
  proxyJump: string[]
  /** Free-form note. */
  description?: string
  /** Deployment environment label. */
  environment?: string
  /** Free-form tags. */
  tags: string[]
  /** Physical location note. */
  location?: string
  /** Whether this host's sessions forward the local ssh-agent. */
  forwardAgent: boolean
  /** Creation timestamp (ms). */
  createdAt: number
  /** Last-change timestamp (ms). */
  updatedAt: number
}

/** Ceiling and cancellation for one remote command. */
export interface DshSshExecOptions {
  /** Wall-clock ceiling for the remote command; the engine default applies when absent. */
  timeoutMs?: number
  /** Aborting closes the remote channel and settles the call as a cancelled command. */
  signal?: AbortSignal
}

/** One finished remote command. */
export interface DshSshExecResult {
  /** Whether the command exited zero. */
  success: boolean
  /** Remote exit code, or null when the channel died without one. */
  exitCode: number | null
  /** Whether the ceiling stopped the run. */
  timedOut: boolean
  /** Captured standard output, verbatim. */
  stdout: string
  /** Captured standard error, verbatim. */
  stderr: string
  /** Round trip in milliseconds. */
  durationMs: number
  /** Connection error message when the command never ran. */
  error?: string
}

/** Outcome of one upload. */
export interface DshSshUploadResult {
  /** Bytes written. */
  bytes: number
  /** Files written (one for a single-file upload). */
  files: number
}

/** Outcome of one download. */
export interface DshSshDownloadResult {
  /** Bytes written locally. */
  bytes: number
}

/**
 * The face a sibling plugin receives under the `dshSsh` service name: a thin
 * forwarder over one `SshEngine`, so a consumer shares the host store and the
 * connection pool the user already operates. No streaming member exists on
 * purpose: a log that must replay after the local host was offline is a remote
 * file read by byte offset, so polling `exec` with `tail` is the whole
 * transport.
 */
export interface DshSshService {
  /** Contract version this face implements. */
  readonly apiVersion: typeof DSH_SSH_API_VERSION
  /** The host inventory the plugin's own surfaces read. */
  readonly hosts: {
    /** Every configured host, secret-free, in store order. */
    list(): DshSshHost[]
    /** One host by alias, or undefined when the alias is not configured. */
    find(alias: string): DshSshHost | undefined
  }
  /**
   * Run one command on a host through the shared pool.
   * @param alias - configured host alias.
   * @param command - command line handed to the remote shell.
   * @param options - ceiling and cancellation.
   * @returns the finished command.
   */
  exec(alias: string, command: string, options?: DshSshExecOptions): Promise<DshSshExecResult>
  /**
   * Upload one local file to an absolute remote path.
   * @param alias - configured host alias.
   * @param localPath - file on this machine (a directory is not part of this face).
   * @param remotePath - absolute destination path on the host.
   * @returns bytes and files written.
   */
  upload(alias: string, localPath: string, remotePath: string): Promise<DshSshUploadResult>
  /**
   * Download one remote file to a local path.
   * @param alias - configured host alias.
   * @param remotePath - file on the host.
   * @param localPath - destination path on this machine.
   * @returns bytes written.
   */
  download(alias: string, remotePath: string, localPath: string): Promise<DshSshDownloadResult>
}

/** The narrow context seat both resolvers need. */
export interface ServiceLookupSeat {
  /** Read one service by name. */
  get(name: string): unknown
}

/**
 * Resolve the browser half's client capability face by service name. Returns
 * undefined when the board is not loaded, so a provider's browser half can
 * degrade instead of throwing.
 * @param ctx - client context.
 * @returns the client face, or undefined.
 */
export function resolveTaskBoardClientFace(ctx: ServiceLookupSeat): TaskBoardClientFace | undefined {
  try {
    const face = ctx.get(TASK_BOARD_SERVICE_NAME) as TaskBoardClientFace | undefined
    return face !== undefined && typeof (face as { dispatch?: unknown }).dispatch === 'function' ? face : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve `dsh-ssh`'s forwarder, refusing a version this extension was not
 * built against instead of guessing at a stale shape.
 * @param ctx - host context.
 * @returns the service, or undefined when absent or at another version.
 */
export function resolveDshSshService(ctx: ServiceLookupSeat): DshSshService | undefined {
  try {
    const face = ctx.get(DSH_SSH_SERVICE) as DshSshService | undefined
    if (face === undefined) return undefined
    const version = (face as { apiVersion?: unknown }).apiVersion
    if (version !== undefined && version !== DSH_SSH_API_VERSION) return undefined
    return face
  } catch {
    return undefined
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The board's extension service (host face). */
    taskBoard: TaskBoardHostFace
    /** `dsh-ssh`'s host forwarder. */
    dshSsh: DshSshService
  }
}