/**
 * Poll-loop guard shared by the plugin family's Host halves (git-graph,
 * task-board): one bounded refresh loop that never overlaps itself,
 * backs off on consecutive failures, and stops at a global deadline. Pure
 * logic with injectable timers, so consumers test it without wall clocks.
 */

/** Timer injection seam; defaults to the global setTimeout/clearTimeout pair. */
export interface PollTimers {
  /** Schedule fn(ms). */
  set: (fn: () => void, ms: number) => unknown
  /** Cancel a scheduled handle. */
  clear: (handle: unknown) => void
}

const DEFAULT_TIMERS: PollTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

export interface PollGuardOptions {
  /** Base interval between runs. */
  intervalMs: number
  /** Runs stop entirely once this much wall time passed since start(). */
  deadlineMs: number
  /** Cap for the failure backoff; each consecutive failure doubles the delay up to this. */
  maxBackoffMs: number
  /** Optional timer seam for tests. */
  timers?: PollTimers
  /** Invoked once when the deadline fires; no run starts afterwards. */
  onDeadline?: () => void
  /** Invoked after a run settles with the consecutive-failure count. */
  onSettled?: (consecutiveFailures: number) => void
  /** The task each tick runs; a rejection counts as a failure. */
  onRun: () => Promise<void>
}

/**
 * Owns one bounded poll loop.
 *
 * Guarantees: at most one task runs at a time (a scheduled tick whose turn
 * arrives while a run is in flight is dropped); consecutive failures double
 * the delay up to maxBackoffMs and reset on the first success; the loop
 * stops forever at deadlineMs and cancels its timer.
 */
export class PollGuard {
  private readonly options: Required<PollGuardOptions>
  private handle: unknown
  private running = false
  private startedAt = 0
  private stopped = false
  private failures = 0

  /** @param options - loop bounds; interval/deadline/backoff/onRun are required, the rest optional. */
  constructor(options: PollGuardOptions) {
    this.options = {
      timers: DEFAULT_TIMERS,
      onDeadline: () => {},
      onSettled: () => {},
      ...options,
    }
  }

  /** Start the loop. Safe to call once; later calls are ignored. */
  start(): void {
    if (this.startedAt !== 0) return
    this.startedAt = Date.now()
    this.schedule(this.options.intervalMs)
  }

  /** Stop the loop permanently and drop any pending tick. */
  stop(): void {
    this.stopped = true
    this.options.timers.clear(this.handle)
    this.handle = undefined
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return
    this.handle = this.options.timers.set(() => { void this.tick() }, delayMs)
  }

  private delay(): number {
    const backoff = this.options.intervalMs * 2 ** Math.min(this.failures, 8)
    return Math.min(backoff, this.options.maxBackoffMs)
  }

  private async tick(): Promise<void> {
    if (this.stopped) return
    if (this.running) return // Anti-overlap: drop ticks that arrive mid-run.
    if (Date.now() - this.startedAt >= this.options.deadlineMs) {
      this.stopped = true
      this.options.onDeadline()
      return
    }
    this.running = true
    try {
      await this.options.onRun()
      this.failures = 0
    } catch {
      this.failures += 1
    } finally {
      this.running = false
      this.options.onSettled(this.failures)
      this.schedule(this.delay())
    }
  }
}
