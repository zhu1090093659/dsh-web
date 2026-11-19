/**
 * The timer seat the run engine schedules through.
 *
 * The engine never reaches for a global timer directly: the host entry injects
 * this face, so the poll cadence is observable, cancellable and — in tests —
 * advanced by hand instead of waited on. A deployment with no opinion gets
 * {@link processTimers}, which unrefs both handles so a board that is polling
 * nothing keeps the process free to exit.
 *
 * @module dsh-task-board-ssh/host/timers
 */

/** The timer operations the engine needs, each returning its own canceller. */
export interface HostTimerFace {
  /** Run `callback` once after `delay` ms. */
  timeout(callback: () => void, delay: number): () => void
  /** Run `callback` every `delay` ms. */
  interval(callback: () => void, delay: number): () => void
}

/** The process timer face: what a real Host mount uses. */
export const processTimers: HostTimerFace = {
  timeout(callback, delay) {
    const handle = setTimeout(callback, delay)
    handle.unref?.()
    return () => { clearTimeout(handle) }
  },
  interval(callback, delay) {
    const handle = setInterval(callback, delay)
    handle.unref?.()
    return () => { clearInterval(handle) }
  },
}
