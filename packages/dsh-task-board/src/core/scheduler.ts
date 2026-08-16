/**
 * Browser-side scheduler: the heartbeat behind scheduled task runs.
 *
 * The board is a pure client plugin with no server channel, so "定时任务"
 * lives in the tab: a timer ticks every minute (plus immediately on tab
 * visibility recovery) and triggers any task whose `schedule.nextRunAt` is
 * due, rolling the schedule forward to the next cron match before triggering
 * so the same tick never double-fires. Missed runs are skipped, never queued:
 * a task still running at its due instant is skipped by the controller's
 * runTask guard and simply waits for the next cron match.
 *
 * A deleted task can never fire again from a stale in-memory copy: every
 * tick first re-reads the persisted ledger through the optional `refresh`
 * hook (the controller reloads its store), so the fire decision and the
 * subsequent roll-forward both run on the freshest persisted truth.
 *
 * The ticker is controlled: `start` arms a single interval guarded by an
 * idempotence check (a second start while running is a no-op, so wiring can
 * never leak a duplicate timer), and `stop`/`dispose` clear the timer and
 * drop the environment listeners. The board unmount path calls stop/dispose,
 * so no interval or listener outlives the board.
 *
 * Framework-free: all runtime access flows through the injected deps
 * (structural faces), so tests drive ticks directly without timers.
 */
import { nextRunAtMs } from './schedule.ts'
import type { TaskRecord } from './tasks.ts'

/** Everything the scheduler needs from its host (the board controller). */
export interface SchedulerDeps {
  /** Read the current task ledger (the controller snapshot). */
  tasks(): readonly TaskRecord[]
  /**
   * Re-sync the task ledger from its persisted source before the tick decides
   * what is due. The wiring passes the controller's store reload so a task
   * deleted elsewhere can never be fired from a stale in-memory copy.
   * Optional: absent in pure in-memory harnesses.
   */
  refresh?: () => void
  /** Clock; defaults to Date.now in the controller wiring. */
  now(): number
  /** Trigger one task's real execution (the controller's runTask); resolves
   *  true when the run was accepted, false when rejected (e.g. the task is
   *  already running). */
  runTask(id: string): Promise<boolean>
  /** Persist a rolled-forward schedule (next due + this trigger instant). */
  applySchedule(id: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): void
  /** Tick cadence; defaults to 60_000 ms. */
  tickMs?: number
  /**
   * Gate: while false the tick no-ops (e.g. the session list baseline has not
   * arrived on page load, so executions would fail). Defaults to always ready.
   */
  ready?: () => boolean
  /** Environment listeners for tab-visibility recovery (browser only). */
  environment?: {
    addEventListener(type: 'visibilitychange', listener: () => void): void
    removeEventListener(type: 'visibilitychange', listener: () => void): void
  }
}

/**
 * The schedule heartbeat (see module doc). `tick` is public so tests and
 * callers can drive a check without waiting for the interval.
 */
export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | undefined
  private environmentListener: (() => void) | undefined
  private disposed = false
  private started = false

  /** @param deps - tasks/clock/trigger/apply faces (see {@link SchedulerDeps}). */
  constructor(private readonly deps: SchedulerDeps) {}

  /**
   * Start ticking: one immediate check (catch-up after reload) + the interval.
   * Single-instance: a second start while already armed is a no-op, so a
   * re-entrant mount can never stack a duplicate timer.
   */
  start(): void {
    if (this.disposed) return
    if (this.started) return
    this.started = true
    // Immediate catch-up tick: schedules whose due instant passed while the
    // tab was closed are triggered as soon as the runtime is ready.
    this.tick()
    this.timer = setInterval(() => { this.tick() }, this.deps.tickMs ?? 60_000)
    if (this.deps.environment !== undefined) {
      this.environmentListener = () => { this.tick() }
      this.deps.environment.addEventListener('visibilitychange', this.environmentListener)
    }
  }

  /**
   * Stop ticking and drop listeners (idempotent). Preferred shutdown verb for
   * callers that treat the scheduler as a controlled ticker; `dispose` is an
   * alias.
   */
  stop(): void {
    this.dispose()
  }

  /** Stop ticking and drop listeners (idempotent). */
  dispose(): void {
    if (this.disposed && this.timer === undefined && this.environmentListener === undefined) return
    this.disposed = true
    this.started = false
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    if (this.environmentListener !== undefined && this.deps.environment !== undefined) {
      this.deps.environment.removeEventListener('visibilitychange', this.environmentListener)
      this.environmentListener = undefined
    }
  }

  /**
   * Check every enabled schedule and trigger the due ones. Idempotent per
   * task per tick: the schedule is rolled forward only after runTask accepts
   * the run, so a rejected run keeps its due slot and is retried on the next
   * tick instead of being silently dropped.
   */
  async tick(): Promise<void> {
    if (this.disposed) return
    if (this.deps.ready !== undefined && !this.deps.ready()) return
    // Freshest persisted truth before any fire decision: a task deleted in
    // another tab (or a stale in-memory copy) must never be triggered.
    this.deps.refresh?.()
    const now = this.deps.now()
    for (const task of this.deps.tasks()) {
      const schedule = task.schedule
      if (schedule === undefined || !schedule.enabled) continue
      if (schedule.nextRunAt === undefined) {
        // Missing next-run instant (repaired/legacy data): recompute from the
        // cron expression and wait; an unparseable expression is skipped.
        const repaired = nextRunAtMs(schedule.cron, now)
        if (repaired === undefined) continue
        this.deps.applySchedule(task.id, repaired, undefined)
        continue
      }
      if (schedule.nextRunAt > now) continue
      // Advance from the due instant (not this tick's wall-clock) and only
      // after the run is accepted: a rejected run keeps its due slot.
      const next = nextRunAtMs(schedule.cron, schedule.nextRunAt)
      const accepted = await this.deps.runTask(task.id)
      if (accepted) this.deps.applySchedule(task.id, next, now)
    }
  }
}

