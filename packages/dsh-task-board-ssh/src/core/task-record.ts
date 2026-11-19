/**
 * Structural view of the task-board vocabulary this extension reads.
 *
 * The extension is a separate bundle and may not import the board's internals,
 * so it restates the record shape the provider contract hands it. These are
 * read-only structural declarations: the board's own values satisfy them and
 * nothing here is constructed by the board. The single source of truth for the
 * contract remains the board's `src/core/extension.ts`.
 *
 * @module dsh-task-board-ssh/core/task-record
 */

/** Column a card occupies. */
export type TaskStatus = 'backlog' | 'todo' | 'running' | 'done' | 'failed'

/** Settlement of one local execution. */
export type ExecutionOutcome = 'succeeded' | 'failed' | 'cancelled'

/** One execution of a card, as a provider reads it. */
export interface ExecutionRecord {
  /** Stable execution id. */
  id: string
  /** Session the execution runs in, once one was opened. */
  sessionId?: string
  /** Instant the execution started (ms epoch). */
  startedAt: number
  /** Instant the execution settled (ms epoch). */
  settledAt?: number
  /** Settlement, absent while the execution is still running. */
  result?: ExecutionOutcome
}

/** One card, as a provider reads it through the capability face. */
export interface TaskRecord {
  /** Stable card id. */
  id: string
  /** Card title. */
  title: string
  /** Card description. */
  description: string
  /** Prompt one execution sends to the agent. */
  prompt: string
  /** Column the card occupies. */
  status: TaskStatus
  /** Instant the card was created (ms epoch). */
  createdAt: number
  /** Instant the card was last written (ms epoch). */
  updatedAt: number
  /** Parent card id, when this card is a subtask. */
  parentId?: string
  /** Workspace the execution must run in, when the card pins one. */
  workspaceId?: string
  /** Qualified provider/model the card pins for its execution, when it pins one. */
  model?: string
  /** True for a card the board keeps off the board view. */
  hidden?: boolean
  /** Instant the card was archived (ms epoch), absent while it is live. */
  archivedAt?: number
  /** Every execution this card has had, oldest first. */
  executions: ExecutionRecord[]
  /** The board's native tags. */
  tags?: ReadonlyArray<{ name: string }>
  /** Opaque provider payloads, keyed by extension id. */
  integrations?: Record<string, unknown>
}
