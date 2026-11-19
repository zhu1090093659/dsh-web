/**
 * The log windows this extension publishes into the board snapshot.
 *
 * A card's log is a file on the remote host, never part of the card: the ledger
 * payload is bounded at 64 KiB and an agent's stream is unbounded, so the bytes
 * travel one way only — read by byte offset over the dshSsh face, and delivered
 * to the browser through the extension's published summary, which the board
 * hands the client mirror as-is.
 *
 * The browser has no other byte channel: a dispatched action answers a boolean,
 * so the log viewer decodes the windows below. Every window names the exact byte
 * interval its text covers, [baseOffset, endOffset), so a decoder appends it
 * without guessing, and a window that could not carry everything waiting is
 * marked truncated instead of dropping the rest: the next publish carries the
 * continuation, starting exactly where the previous one stopped.
 *
 * Windows are per card and in memory. Nothing here is ever written into a card's
 * payload.
 *
 * @module dsh-task-board-ssh/host/logs
 */

/** Largest window one card carries in a single publish, in bytes. */
export const LOG_WINDOW_BUDGET_BYTES = 8 * 1024

/** Largest window section one publish carries across all cards, in bytes. */
export const PUBLISH_LOG_BUDGET_BYTES = 32 * 1024

/**
 * Budget for the whole published summary, in bytes of its JSON serialization.
 *
 * The board validates a published summary with the same predicate it applies to
 * any extension payload, so the hard ceiling is TASK_BOARD_PAYLOAD_LIMIT_BYTES
 * (64 KiB). This budget stays well under it, which leaves room for the host
 * list, the defaults and the runs the same summary carries.
 */
export const PUBLISH_BODY_LIMIT_BYTES = 48 * 1024

/** One window a browser decodes at a known byte interval. */
export interface SshLogWindow {
  /** Run the text belongs to. */
  runId: string
  /** Byte offset of the first delivered byte. */
  baseOffset: number
  /** Byte offset just past the last delivered byte. */
  endOffset: number
  /** The delivered bytes, as text. */
  text: string
  /** Whether more bytes are waiting, which the next publish carries. */
  truncated?: boolean
}

/** What one card's window currently holds. */
interface WindowState {
  /** Run the window belongs to. */
  runId: string
  /** Byte offset of the first byte in the pending text. */
  base: number
  /** Byte offset just past the last byte in the pending text. */
  end: number
  /** Bytes read but not yet published. */
  text: string
  /** Whether unread bytes remain after the end. */
  truncated: boolean
  /** Offset the next read for this run starts at. */
  cursor: number
}

/** Byte length of a text. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * The longest prefix of a text that fits a byte budget, never splitting a
 * character (which would make the delivered byte count lie).
 * @param text - the text to cut.
 * @param budget - largest prefix, in UTF-8 bytes.
 * @returns the prefix and its byte length.
 */
export function takeWithinBudget(text: string, budget: number): { text: string; bytes: number } {
  const encoder = new TextEncoder()
  const total = encoder.encode(text).length
  if (total <= budget) return { text, bytes: total }
  let bytes = 0
  let index = 0
  for (const character of text) {
    const size = encoder.encode(character).length
    if (bytes + size > budget) break
    bytes += size
    index += character.length
  }
  return { text: text.slice(0, index), bytes }
}

/**
 * The part of a text that starts at one UTF-8 byte offset.
 * @param text - the whole text.
 * @param from - byte offset to start at.
 * @returns the remainder.
 */
export function sliceFromByte(text: string, from: number): string {
  if (from <= 0) return text
  const encoder = new TextEncoder()
  let bytes = 0
  let index = 0
  while (index < text.length) {
    const code = text.codePointAt(index) ?? 0
    const character = String.fromCodePoint(code)
    const size = encoder.encode(character).length
    if (bytes + size > from) break
    bytes += size
    index += character.length
  }
  return text.slice(index)
}

/** One publish's window section and the cards it delivered for. */
export interface SshLogDelivery {
  /** Windows keyed by card id, in the shape the client decodes. */
  logs: Record<string, SshLogWindow>
  /** Cards whose window this publish carried; they are cleared afterwards. */
  delivered: string[]
}

export class SshLogWindows {
  private readonly states = new Map<string, WindowState>()
  private readonly perCardBudget: number
  private readonly perPublishBudget: number

  constructor(perCardBudget = LOG_WINDOW_BUDGET_BYTES, perPublishBudget = PUBLISH_LOG_BUDGET_BYTES) {
    this.perCardBudget = Math.max(256, perCardBudget)
    this.perPublishBudget = Math.max(this.perCardBudget, perPublishBudget)
  }

  /** Forget every window (the extension stopped, or a host went away). */
  clear(): void {
    this.states.clear()
  }

  /**
   * Start following one run's log from an offset.
   *
   * Adopting a run this process already follows is a no-op, which is what keeps
   * a poll from resetting the offset the card's payload recorded: a Host that
   * comes back does not re-send bytes the browser already holds, and the
   * viewer's own replay is the way to ask for everything from zero.
   * @param taskId - card the run belongs to.
   * @param runId - run whose log is followed.
   * @param startOffset - first byte the next read asks for.
   */
  adopt(taskId: string, runId: string, startOffset: number): void {
    const existing = this.states.get(taskId)
    if (existing !== undefined && existing.runId === runId) return
    this.states.set(taskId, {
      runId,
      base: startOffset,
      end: startOffset,
      text: '',
      truncated: false,
      cursor: startOffset,
    })
  }

  /** The offset the next read for one card starts at, when it is followed. */
  cursor(taskId: string, runId: string): number | undefined {
    const state = this.states.get(taskId)
    return state !== undefined && state.runId === runId ? state.cursor : undefined
  }

  /**
   * Add the bytes read for one card to its pending window.
   * @param taskId - card the run belongs to.
   * @param runId - run whose log was read.
   * @param from - byte offset the read started at.
   * @param text - the bytes read, from the offset to the log's end.
   */
  push(taskId: string, runId: string, from: number, text: string): void {
    const current = this.states.get(taskId)
    if (current === undefined || current.runId !== runId) {
      this.states.set(taskId, { runId, base: from, end: from, text: '', truncated: false, cursor: from })
    }
    const state = this.states.get(taskId)
    if (state === undefined) return
    const remaining = this.perCardBudget - byteLength(state.text)
    if (remaining <= 0) {
      // The window is full and still waiting to be published: nothing is taken,
      // so the next read asks for exactly the same bytes again.
      state.cursor = from
      state.truncated = text !== ''
      return
    }
    const taken = takeWithinBudget(text, remaining)
    if (taken.text !== '') {
      state.text += taken.text
      state.end = state.base + byteLength(state.text)
    }
    state.cursor = from + taken.bytes
    // Anything the budget could not take is still on the host: the next read
    // starts exactly where this window stopped, so nothing is ever skipped.
    state.truncated = taken.bytes < byteLength(text)
  }

  /**
   * Replace one card's pending window with a replay from an offset.
   * @param taskId - card the run belongs to.
   * @param runId - run whose log was read.
   * @param from - byte offset the replay starts at (zero for a full replay).
   * @param text - the bytes read, from the offset to the log's end.
   */
  replay(taskId: string, runId: string, from: number, text: string): void {
    const taken = takeWithinBudget(text, this.perCardBudget)
    this.states.set(taskId, {
      runId,
      base: from,
      end: from + taken.bytes,
      text: taken.text,
      truncated: taken.bytes < byteLength(text),
      cursor: from + taken.bytes,
    })
  }

  /** How many cards hold an unpublished window. */
  pending(): number {
    let count = 0
    for (const state of this.states.values()) {
      if (state.text !== '' || state.truncated) count += 1
    }
    return count
  }

  /**
   * The windows one publish carries, bounded across cards.
   *
   * A card whose window does not fit this publish keeps it: the next publish
   * carries it instead of losing it, and the iteration order is stable, so a
   * backlog drains card by card.
   * @returns the window section and the cards it covered.
   */
  take(): SshLogDelivery {
    const logs: Record<string, SshLogWindow> = {}
    const delivered: string[] = []
    let used = 0
    for (const [taskId, state] of this.states) {
      if (state.text === '' && !state.truncated) continue
      const window: SshLogWindow = {
        runId: state.runId,
        baseOffset: state.base,
        endOffset: state.end,
        text: state.text,
        ...(state.truncated ? { truncated: true } : {}),
      }
      const size = byteLength(JSON.stringify({ [taskId]: window }))
      if (used + size > this.perPublishBudget && delivered.length > 0) continue
      logs[taskId] = window
      delivered.push(taskId)
      used += size
    }
    return { logs, delivered }
  }

  /**
   * Clear the windows one publish carried, so the next one carries only what
   * arrived since.
   * @param taskIds - cards the publish covered.
   */
  markDelivered(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      const state = this.states.get(taskId)
      if (state === undefined) continue
      state.base = state.end
      state.text = ''
      // Bytes still waiting past the delivered end keep the window open.
      state.truncated = state.cursor > state.end
    }
  }

  /** The window one card currently holds, without clearing it. */
  peek(taskId: string): SshLogWindow | undefined {
    const state = this.states.get(taskId)
    if (state === undefined) return undefined
    return {
      runId: state.runId,
      baseOffset: state.base,
      endOffset: state.end,
      text: state.text,
      ...(state.truncated ? { truncated: true } : {}),
    }
  }
}
