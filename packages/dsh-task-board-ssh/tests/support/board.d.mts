/**
 * What this harness asks of the board, in the terms the specs use.
 *
 * A narrow, structural description of the production classes in
 * `packages/dsh-task-board/src` that `board.mjs` loads: enough to create and
 * read cards, apply one board action and watch what the provider registered,
 * and nothing more. Keeping the description here is what lets the specs be fully
 * typed without the board joining this package's type program (see board.mjs).
 */

/** The fixed clock the board and every fake read. */
export declare const NOW: number

/** The workspace the harness's board serves. */
export declare const WORKSPACE_ID: string

/** One prompt a local run queued into a session. */
export interface DeliveredPrompt {
  /** Session the board opened. */
  sessionId: string
  /** Text it queued. */
  text: string
  /** Mode the prompt was sent with. */
  mode: string
}

/** One execution record, as the board stores it. */
export interface RawExecution {
  /** Execution id. */
  id: string
  /** Verdict, once the execution settled. */
  result?: string
  /** Text the settling party recorded. */
  error?: string
  /** Party that opened or settled it. */
  initiatedBy?: string
  /** True for a record written from outside a Host session. */
  external?: boolean
  /** Settlement instant. */
  endedAt?: number
  /** Session the execution ran in, when one was opened. */
  sessionId?: string
}

/** One card, as far as this harness reads it. */
export interface CardView {
  /** Card id. */
  id: string
  /** Column the card occupies. */
  status: string
  /** Prompt the card runs. */
  prompt: string
  /** Created instant. */
  createdAt: number
  /** Opaque provider payloads, keyed by extension id. */
  integrations?: Record<string, unknown>
  /** Every execution the card has had. */
  executions?: unknown[]
}

/** The deployment's tool registry, as the board drives it. */
export interface ToolRegistrySeat {
  /** Register one tool definition; the returned disposer releases it. */
  register(definition: { name: string }): () => void
}

/** The extension registry the board publishes, as a spec configures it. */
export interface ExtensionRegistrySeat {
  /** Pin the deployment's tool registry, so provider tools really register. */
  setToolRegistry(resolver: (() => ToolRegistrySeat | undefined) | undefined): void
  /** Whether one extension is currently running (board x extension). */
  isActive(extensionId: string): boolean
}

/** The board the specs drive. */
export interface BoardHarness {
  /** The production Host service. */
  board: {
    /** Submit one action through every board gate. */
    apply(requestId: string, action: unknown, initiator?: string): unknown
    /** Admit one provider extension; the returned disposer releases it. */
    registerExtension(extension: { id: string; apiVersion: number }): () => void
    /** Release the board. */
    dispose(): void
    /** The extension registry. */
    extensions: ExtensionRegistrySeat
  }
  /** The production ledger. */
  ledger: {
    /** One card by id. */
    getTask(taskId: string): CardView | undefined
    /** Every card, oldest first. */
    allTasks(): readonly CardView[]
  }
  /** Prompts the board queued into local sessions. */
  prompts: DeliveredPrompt[]
  /** Create one card with a deterministic id. */
  createCard(id: string, input: Record<string, unknown>): CardView
  /** Apply one board action through the board's own gates. */
  apply(action: Record<string, unknown>, initiator?: string): unknown
  /** One card as the ledger stores it. */
  task(taskId: string): CardView | undefined
  /** Every card the ledger holds. */
  tasks(): readonly CardView[]
  /** Close the board and remove its scratch ledger directory. */
  dispose(): void
}

/** How the board's session gateway behaves. */
export interface BoardOptions {
  /**
   * Whether this deployment really starts local sessions. A spec proving that a
   * direct run creates none turns this off, and any gateway call then fails the
   * test instead of passing quietly.
   */
  sessions?: boolean
}

/**
 * Build the real board.
 * @param options - which gateway this deployment serves.
 * @returns the board harness.
 */
export declare function createBoard(options?: BoardOptions): BoardHarness

/**
 * The execution records of one card, as the board stores them.
 * @param task - the card to read.
 * @returns its records, oldest first.
 */
export declare function executionsOf(task: CardView | undefined): RawExecution[]
