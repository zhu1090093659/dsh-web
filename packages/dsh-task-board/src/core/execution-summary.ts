/**
 * What one execution left behind: the text of its last assistant message,
 * recorded on the execution record next to the verdict it belongs to.
 *
 * A settled execution used to carry only a verdict, so a parent card could see
 * that a subtask succeeded without ever seeing what it produced, and had to
 * guess or redo the work. The card's own content cannot answer that: card
 * content is the plan and freezes at the first execution
 * (`canEditTaskContent`), so the closing words of a run are recorded on the
 * execution record instead.
 *
 * Pure (no cordis, no runtime imports) so the settlement path is unit-testable
 * without a session, and so a text-less run degrades to "no field" rather than
 * to an empty string.
 */
import { EXECUTION_SUMMARY_LIMIT, type ExecutionSummary } from './tasks.ts'

/** Structural view of one session event, as both readers expose it. */
export interface SummaryEvent {
  type?: unknown
  seq?: unknown
  time?: unknown
  data?: unknown
}

/** One rendered content block of an assistant message, or '' when it has no prose. */
function blockProse(block: unknown): string {
  if (typeof block !== 'object' || block === null) return ''
  const row = block as Record<string, unknown>
  // Only prose: reasoning and tool traffic are the acceptance evidence's job,
  // and a summary that opened with a tool call would bury the conclusion.
  return row.type === 'text' && typeof row.text === 'string' ? row.text : ''
}

/** The assistant's own prose of one message: its text blocks joined and trimmed. */
function messageProse(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map(blockProse).filter(part => part !== '').join('\n').trim()
}

/**
 * Bound one summary, keeping its tail: the closing paragraphs carry the
 * conclusion a reader is after, and the omitted opening is announced instead of
 * silently dropped. Mirrors the evidence reader's tail bound.
 */
export function truncateExecutionSummary(text: string, limit = EXECUTION_SUMMARY_LIMIT): string {
  if (text.length <= limit) return text
  const notice = '[truncated ' + String(text.length - limit) + ' chars] '
  return notice.length >= limit ? text.slice(-limit) : notice + text.slice(-(limit - notice.length))
}

/**
 * The summary one execution's own events support.
 *
 * Only events at or after `startedAt` belong to this run: a reused session
 * carries the history of earlier executions, which must not be reported as this
 * one's output. The last assistant message WITH prose wins — a trailing
 * tool-call or reasoning-only message has nothing to leave behind, so the reader
 * walks back to the last one that speaks.
 * @param events - the session events the inspection already read.
 * @param startedAt - the execution's start instant (ms epoch); 0 means "all".
 * @returns the bounded summary with the seq it came from, or undefined when the
 * run left no usable text.
 */
export function executionSummaryOf(events: readonly SummaryEvent[], startedAt: number): ExecutionSummary | undefined {
  const own = events
    .filter(event => typeof event.time !== 'number' || startedAt <= 0 || event.time >= startedAt)
    .filter(event => event.type === 'assistant/message' && typeof event.seq === 'number')
    .sort((a, b) => (a.seq as number) - (b.seq as number))
  for (let index = own.length - 1; index >= 0; index -= 1) {
    const event = own[index]
    const data = typeof event.data === 'object' && event.data !== null ? event.data as Record<string, unknown> : {}
    const message = typeof data.message === 'object' && data.message !== null ? data.message as Record<string, unknown> : {}
    const text = messageProse(message.content)
    if (text === '') continue
    return { text: truncateExecutionSummary(text), seq: event.seq as number }
  }
  return undefined
}

/**
 * Repair one persisted or reported summary.
 *
 * A summary is informational, so an unreadable one is dropped on its own rather
 * than costing the execution (or the task row) it hangs on. A hand-edited
 * overlong text is bounded on the way in, so no reader ever holds more than the
 * limit.
 */
export function normalizeExecutionSummary(value: unknown): ExecutionSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const row = value as Record<string, unknown>
  if (typeof row.text !== 'string') return undefined
  if (row.seq !== undefined && (typeof row.seq !== 'number' || !Number.isFinite(row.seq))) return undefined
  const text = row.text.trim()
  if (text === '') return undefined
  return { text: truncateExecutionSummary(text), ...(row.seq === undefined ? {} : { seq: row.seq }) }
}
