/**
 * The run log surface: a fixed-height, keyboard-reachable scroller that mounts
 * only the rows in view.
 *
 * The window comes from {@link visibleLogWindow}'s arithmetic, so a scroll costs
 * one state update and a few dozen rows, never a re-layout of the whole log.
 * While the run is live the surface follows the tail; scrolling up stops
 * following — a reader is never yanked away from what they are reading — and a
 * control returns them to the newest line.
 *
 * The scroller owns its height in pixels rather than measuring one, so the
 * window is a function of the scroll offset alone: no layout read on the scroll
 * path, no resize observer, and a geometry the tests state exactly.
 *
 * @module dsh-task-board-ssh/client/ssh/log-view
 */
import { type UIEvent, useCallback, useEffect, useRef, useState } from 'react'
import { visibleLogWindow, type SshLogBuffer } from './log-buffer.ts'
import css from '../ssh.module.css'

/** Height of one log row in pixels; every row is one line of monospace text. */
export const LOG_ROW_HEIGHT = 18

/** How many rows the scroller shows at once. */
export const LOG_VISIBLE_ROWS = 12

/** Height of the scroller in pixels, derived from the two constants above. */
export const LOG_VIEWPORT_HEIGHT = LOG_ROW_HEIGHT * LOG_VISIBLE_ROWS

/** Rows mounted above and below the visible band. */
const LOG_OVERSCAN = 8

/** Copy the log surface needs, localized by the caller. */
export interface SshLogLabels {
  /** Shown while nothing has been received. */
  empty: string
  /** Shown when bytes before the first line are known to be missing. */
  truncated: string
  /** Control that returns the scroller to the newest line. */
  latest: string
  /** Accessible name of the scroller itself. */
  name: string
}

/** Props of the log surface. */
export interface SshLogViewProps {
  /** The buffer the parent owns for this panel. */
  buffer: SshLogBuffer
  /** Bumped whenever the buffer changed; it is what makes the view re-render. */
  version: number
  /** Whether the run is still producing output, so the tail follows. */
  live: boolean
  /** Localized copy. */
  labels: SshLogLabels
}

/**
 * Render the run log.
 * @param props - the buffer, its revision, and the copy it reads.
 * @returns the scroller, its notices and the return-to-tail control.
 */
export function SshLogView({ buffer, live, labels, version }: SshLogViewProps) {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [following, setFollowing] = useState(true)
  const snapshot = buffer.snapshot()
  const count = snapshot.count
  const maxScroll = Math.max(0, count * LOG_ROW_HEIGHT - LOG_VIEWPORT_HEIGHT)
  const window = visibleLogWindow(count, {
    scrollTop: following ? maxScroll : scrollTop,
    height: LOG_VIEWPORT_HEIGHT,
    rowHeight: LOG_ROW_HEIGHT,
    overscan: LOG_OVERSCAN,
  })

  // A live run keeps its newest line in view without moving a reader who
  // scrolled away from it.
  useEffect(() => {
    if (!following) return
    const element = scroller.current
    if (element === null) return
    element.scrollTop = maxScroll
    setScrollTop(maxScroll)
  }, [version, following, maxScroll])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const top = event.currentTarget.scrollTop
    setScrollTop(top)
    setFollowing(maxScroll - top <= LOG_ROW_HEIGHT)
  }, [maxScroll])

  const jumpToLatest = useCallback(() => { setFollowing(true) }, [])

  return (
    <div className={css.log} data-dsh-part="log">
      <div
        ref={scroller}
        className={css.logScroller}
        style={{ height: `${LOG_VIEWPORT_HEIGHT}px` }}
        tabIndex={0}
        role="group"
        aria-label={labels.name}
        aria-live="off"
        onScroll={onScroll}
      >
        {count === 0 ? (
          <p className={css.logEmpty}>{labels.empty}</p>
        ) : (
          <div className={css.logSurface} style={{ height: `${window.totalHeight}px` }}>
            <div className={css.logBlock} style={{ transform: `translateY(${window.offsetY}px)` }}>
              {Array.from({ length: window.end - window.start }, (_unused, offset) => {
                const index = window.start + offset
                return (
                  <div key={index} className={css.logRow} style={{ height: `${LOG_ROW_HEIGHT}px` }}>
                    {buffer.lineAt(index)}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {(snapshot.truncated || (!following && live)) && (
        <div className={css.logNotices}>
          {snapshot.truncated && <p className={css.logNotice}>{labels.truncated}</p>}
          {!following && live && (
            <button type="button" className={css.linkButton} onClick={jumpToLatest}>
              {labels.latest}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
