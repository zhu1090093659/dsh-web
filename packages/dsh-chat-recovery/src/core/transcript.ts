/**
 * Pure transcript helpers over the client ConversationSnapshot. Both halves
 * of the plugin compile this module; it imports only types from the official
 * NPM SDK and never touches a DSH source checkout.
 */
import type {
  AssistantMessageNode,
  ConversationSnapshot,
  TurnErrorNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-client-connection/client'

/**
 * The last completed user message of a session, plus everything the edit
 * flow needs to re-submit it from the position BEFORE that message.
 */
export interface EditTarget {
  /** Verbatim joined text of the message (all blocks are text blocks). */
  text: string
  /** Seq of the user message being edited. */
  seq: number
  /** The turn that contains the message (its turn/end exists and is > seq). */
  turn: number
  /** Seq of that turn's turn/end event. */
  turnEndSeq: number
  /**
   * Fork anchor: the latest completed turn/end strictly before the message.
   * Forking at this anchor yields a child whose history ends before the
   * message, so the edited branch never duplicates it. Null when the message
   * opens the first turn (no earlier turn/end exists): the edit flow then
   * falls back to a fresh blank session in the same workspace instead.
   */
  forkAtSeq: number | null
}

/**
 * Extract verbatim text from a user message. Returns null unless EVERY block
 * is a text block: image/attachment messages cannot be safely copied into a
 * re-submitted prompt and are therefore not editable.
 * @param content - the durable user message blocks.
 * @returns the joined text, or null when any block is non-text.
 */
export function userText(content: readonly ContentBlock[]): string | null {
  if (content.length === 0) return null
  let text = ''
  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') return null
    text += block.text
  }
  return text
}

/**
 * Resolve the edit target: the LAST user message, provided the session is not
 * running/removed and the message's turn has ended. Steering, context and
 * system nodes are never considered.
 * @param snapshot - the live conversation snapshot.
 * @returns the edit target, or null when nothing is editable right now.
 */
export function lastCompletedUserTarget(snapshot: ConversationSnapshot): EditTarget | null {
  if (snapshot.running || snapshot.removed) return null
  let last: UserMessageNode | null = null
  for (const node of snapshot.nodes) if (node.kind === 'user') last = node
  if (last === null) return null
  // The containing turn: the smallest completed turn whose turn/end sits
  // after the message (there is exactly one for a message inside a completed
  // turn; later turns would have their own user messages, so last stays last).
  let turn = -1
  let turnEndSeq = -1
  for (const [t, end] of snapshot.turnEnds) {
    if (end > last.seq && (turn === -1 || t < turn)) {
      turn = t
      turnEndSeq = end
    }
  }
  if (turn === -1) return null
  // Attachment messages (any non-text block) cannot be safely copied into a
  // re-submitted prompt, so they are not editable.
  const text = userText(last.content)
  if (text === null) return null
  // Fork anchor: the latest completed turn/end strictly before the message.
  let forkAtSeq: number | null = null
  for (const [, end] of snapshot.turnEnds) {
    if (end < last.seq && (forkAtSeq === null || end > forkAtSeq)) forkAtSeq = end
  }
  return {
    text,
    seq: last.seq,
    turn,
    turnEndSeq,
    forkAtSeq,
  }
}

/**
 * The seq of the event right before the given turn started: the latest
 * turn/end of any earlier turn, or 0 for the first turn.
 * @param snapshot - the live conversation snapshot.
 * @param turn - the turn number.
 * @returns the boundary seq (exclusive start of the turn).
 */
export function turnStartSeq(snapshot: ConversationSnapshot, turn: number): number {
  let start = 0
  for (const [t, end] of snapshot.turnEnds) if (t < turn && end > start) start = end
  return start
}

/**
 * The last user message inside one turn (the turn opener).
 * @param snapshot - the live conversation snapshot.
 * @param turn - the turn number.
 * @returns the message node, or null when the turn has none in-window.
 */
export function lastUserInTurn(snapshot: ConversationSnapshot, turn: number): UserMessageNode | null {
  const end = snapshot.turnEnds.get(turn)
  if (end === undefined) return null
  const start = turnStartSeq(snapshot, turn)
  let found: UserMessageNode | null = null
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' && node.seq > start && node.seq <= end) found = node
  }
  return found
}

/**
 * Whether the turn ran any tool call or slash command. Re-running such a turn
 * would repeat side effects, so the retry policy treats tool-involved turns
 * as manual-only (never auto-retried).
 * @param snapshot - the live conversation snapshot.
 * @param turn - the turn number.
 */
export function turnHasToolActivity(snapshot: ConversationSnapshot, turn: number): boolean {
  const end = snapshot.turnEnds.get(turn) ?? Number.POSITIVE_INFINITY
  const start = turnStartSeq(snapshot, turn)
  for (const node of snapshot.nodes) {
    if ((node.kind === 'tool-result' || node.kind === 'command') && node.seq > start && node.seq <= end) return true
  }
  return snapshot.runningCalls.some((call) => call.turn === turn)
}

/** The interruption-frozen assistant partial of one turn, when present. */
export function interruptedAssistantInTurn(snapshot: ConversationSnapshot, turn: number): AssistantMessageNode | null {
  for (const node of snapshot.nodes) {
    if (node.kind === 'assistant' && node.turn === turn && node.interrupted === true) return node
  }
  return null
}

/** The durable terminal error node of one turn, when present. */
export function turnErrorInTurn(snapshot: ConversationSnapshot, turn: number): TurnErrorNode | null {
  for (const node of snapshot.nodes) {
    if (node.kind === 'turn-error' && node.turn === turn) return node
  }
  return null
}

/** Whether the turn hit the per-request output-token cap. */
export function maxTokensInTurn(snapshot: ConversationSnapshot, turn: number): boolean {
  return snapshot.nodes.some((node) => node.kind === 'turn-max-tokens' && node.turn === turn)
}

/**
 * Whether the HOST already owns a pending retry for this turn (llm/retry
 * chain scheduled or started). While the host is retrying, the client
 * supervisor must stand down: acting would double the retry traffic.
 */
export function hostRetryPending(snapshot: ConversationSnapshot, turn: number): boolean {
  return snapshot.nodes.some(
    (node) => node.kind === 'model-retry' && node.turn === turn && (node.retryState === 'scheduled' || node.retryState === 'started'),
  )
}

/** Whether the turn settled with a finalized (messageId-bearing) assistant message. */
export function assistantFinalizedInTurn(snapshot: ConversationSnapshot, turn: number): boolean {
  return snapshot.nodes.some(
    (node) => node.kind === 'assistant' && node.turn === turn && node.interrupted !== true && node.messageId !== undefined,
  )
}

/** Count of durable user messages in the window (duplicate-message guard). */
export function userNodeCount(snapshot: ConversationSnapshot): number {
  let count = 0
  for (const node of snapshot.nodes) if (node.kind === 'user') count += 1
  return count
}

/**
 * User messages with seq at or below the given boundary (the history prefix a
 * fork keeps). Used to compute how many user messages a retry child is
 * EXPECTED to carry: prefix count plus the one replayed message.
 */
export function userNodeCountBefore(snapshot: ConversationSnapshot, boundarySeq: number): number {
  let count = 0
  for (const node of snapshot.nodes) if (node.kind === 'user' && node.seq <= boundarySeq) count += 1
  return count
}

/** The latest completed turn number, or null when none exists in-window. */
export function lastTurnOf(snapshot: ConversationSnapshot): number | null {
  let max = -1
  for (const turn of snapshot.turnEnds.keys()) if (turn > max) max = turn
  return max === -1 ? null : max
}
