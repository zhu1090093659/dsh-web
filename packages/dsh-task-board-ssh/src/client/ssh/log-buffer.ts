/**
 * The run log: byte-offset increments in, one bounded window of rows out.
 *
 * The provider publishes log INCREMENTS, not documents: each window carries
 * `[baseOffset, endOffset)` and the bytes it read since the previous window. This
 * module turns that stream into lines without ever re-walking text it has
 * already seen — an append splits only the incoming chunk and the partial line
 * it continues — and hands the renderer a fixed-height window of that line
 * store, so a hundred thousand lines cost a hundred thousand short strings and
 * a few dozen DOM rows instead of a hundred thousand nodes.
 *
 * Two rules keep the stream honest:
 *
 * - a window whose `endOffset` is not past what was consumed is a duplicate and
 *   changes nothing;
 * - a window that does not continue at the consumed offset left bytes unseen
 *   (the provider restarted its read above zero), so the buffer keeps what it
 *   has, flags the gap, and appends after it. Nothing already shown is dropped;
 *   the notice under the log says earlier output is missing.
 *
 * Virtualization by fixed row height is the mechanism chosen here: log rows are
 * monospace and never wrap, so a row's height is a constant and the window is
 * arithmetic rather than measurement — no layout read on scroll, no observer,
 * and a deterministic window the tests can state exactly.
 *
 * @module dsh-task-board-ssh/client/ssh/log-buffer
 */

/** One increment of a run's remote stdout, as the provider publishes it. */
export interface SshLogFrame {
  /** Run the bytes belong to; a different run resets the buffer. */
  runId?: string
  /** Byte offset of `text`'s first byte in the remote file. */
  baseOffset: number
  /** Byte offset just past `text`'s last byte. */
  endOffset: number
  /** The bytes themselves, verbatim. */
  text: string
  /** Whether the provider itself skipped bytes before `baseOffset`. */
  truncated?: boolean
}

/** What a renderer reads out of the buffer. */
export interface SshLogSnapshot {
  /** Run the lines belong to, absent while the buffer is empty. */
  runId?: string
  /** How many rows the buffer holds. */
  count: number
  /** Whether bytes before the first line are known to be missing. */
  truncated: boolean
  /** Byte offset of the first byte held. */
  start: number
  /** Byte offset just past the last byte consumed. */
  end: number
}

/** Geometry of the log viewport. */
export interface LogViewport {
  /** Current vertical scroll offset of the scroller, in pixels. */
  scrollTop: number
  /** Visible height of the scroller, in pixels. */
  height: number
  /** Height of every row, in pixels. */
  rowHeight: number
  /** Rows rendered above and below the visible band. */
  overscan: number
}

/** The rows a renderer actually mounts. */
export interface LogWindow {
  /** First mounted row index. */
  start: number
  /** One past the last mounted row index. */
  end: number
  /** Vertical offset of the mounted block inside the scroll surface. */
  offsetY: number
  /** Full height of the scroll surface, so the scrollbar reflects every line. */
  totalHeight: number
  /** How many rows exist in total. */
  total: number
}

/**
 * Accumulates log increments into lines.
 *
 * One instance belongs to one open detail panel; closing the panel drops it,
 * which is what makes reopening replay from the first byte — the buffer asks
 * the provider for that replay and renders whatever windows arrive.
 */
export class SshLogBuffer {
  private run: string | undefined
  private startOffset = 0
  private endOffset = 0
  private rows: string[] = []
  private tail: string | undefined
  private gap = false

  /** How many rows the buffer holds, partial trailing line included. */
  get count(): number {
    return this.tail === undefined ? this.rows.length : this.rows.length + 1
  }

  /**
   * Apply one published increment.
   * @param frame - the increment; duplicates and replays are tolerated.
   * @returns true when the visible content changed.
   */
  append(frame: SshLogFrame): boolean {
    if (frame.runId !== undefined && this.run !== undefined && frame.runId !== this.run) {
      this.reset(frame.runId)
    } else if (frame.runId !== undefined && this.run === undefined) {
      this.run = frame.runId
    }
    if (frame.text.length === 0) return false
    if (frame.endOffset <= this.endOffset) return false
    if (this.count === 0 && frame.baseOffset > 0) this.gap = true
    else if (this.endOffset > 0 && frame.baseOffset > this.endOffset) this.gap = true
    if (frame.truncated === true) this.gap = true
    this.startOffset = this.count === 0 ? frame.baseOffset : Math.min(this.startOffset, frame.baseOffset)
    this.endOffset = frame.endOffset
    const combined = (this.tail ?? '') + frame.text
    let from = 0
    for (;;) {
      const newline = combined.indexOf('\n', from)
      if (newline === -1) break
      this.rows.push(combined.slice(from, newline))
      from = newline + 1
    }
    this.tail = from < combined.length ? combined.slice(from) : undefined
    return true
  }

  /**
   * Read one row.
   * @param index - zero-based row index below {@link count}.
   * @returns the row text; the empty string outside the buffer.
   */
  lineAt(index: number): string {
    if (index < this.rows.length) return this.rows[index] as string
    if (index === this.rows.length && this.tail !== undefined) return this.tail
    return ''
  }

  /**
   * Copy every row out; for tests and small surfaces, never for a live render.
   * @returns the rows, oldest first.
   */
  toLines(): string[] {
    return this.tail === undefined ? [...this.rows] : [...this.rows, this.tail]
  }

  /** Drop every line; a later replay starts from the first byte again. */
  reset(runId?: string): void {
    this.run = runId
    this.startOffset = 0
    this.endOffset = 0
    this.rows = []
    this.tail = undefined
    this.gap = false
  }

  /** Read the buffer's account of itself. */
  snapshot(): SshLogSnapshot {
    const snapshot: SshLogSnapshot = {
      count: this.count,
      truncated: this.gap,
      start: this.startOffset,
      end: this.endOffset,
    }
    if (this.run !== undefined) snapshot.runId = this.run
    return snapshot
  }
}

/**
 * Compute the rows to mount for one scroll position.
 *
 * Pure arithmetic over a fixed row height: the tests state the window for a
 * given geometry exactly, and the component never reads layout to decide what
 * to render.
 * @param total - how many rows exist.
 * @param viewport - scroller geometry and overscan.
 * @returns the mounted block and the scroll surface it sits in.
 */
export function visibleLogWindow(total: number, viewport: LogViewport): LogWindow {
  const rowHeight = viewport.rowHeight > 0 ? viewport.rowHeight : 1
  const overscan = viewport.overscan > 0 ? viewport.overscan : 0
  const totalHeight = total * rowHeight
  if (total <= 0) return { start: 0, end: 0, offsetY: 0, totalHeight, total }
  const maxScroll = Math.max(0, totalHeight - Math.max(0, viewport.height))
  const scrollTop = Math.min(Math.max(0, viewport.scrollTop), maxScroll)
  const first = Math.floor(scrollTop / rowHeight)
  const visible = Math.max(1, Math.ceil(Math.max(0, viewport.height) / rowHeight))
  const start = Math.max(0, Math.min(total - 1, first - overscan))
  const end = Math.min(total, first + visible + overscan)
  return { start, end, offsetY: start * rowHeight, totalHeight, total }
}
