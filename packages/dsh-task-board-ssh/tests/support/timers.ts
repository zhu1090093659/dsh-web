/**
 * A timer seat a spec advances by hand.
 *
 * The engine schedules its poll cadence through the injected face, so a spec
 * moves time instead of waiting for it: every timer that comes due inside the
 * advance runs, in due order, and an interval re-arms from the instant it fired.
 */
import type { HostTimerFace } from '../../src/host/timers.ts'

/** The manual seat, plus the two things a spec needs to drive it. */
export interface ManualTimers {
  /** The face the engine schedules through. */
  face: HostTimerFace
  /** Move time forward by `ms`, running every timer that comes due. */
  advance(ms: number): void
  /** How many timers are still armed. */
  armed(): number
  /** Drop every armed timer. */
  dispose(): void
}

/** One armed timer. */
interface ArmedTimer {
  dueAt: number
  /** Repetition in ms, for an interval. */
  every?: number
  callback: () => void
}

/**
 * Build the manual seat.
 * @param start - the instant the seat starts at (ms epoch).
 * @returns the seat.
 */
export function createManualTimers(start = 0): ManualTimers {
  let now = start
  let sequence = 0
  const armed = new Map<number, ArmedTimer>()

  const face: HostTimerFace = {
    timeout(callback, delay) {
      sequence += 1
      const id = sequence
      armed.set(id, { dueAt: now + Math.max(0, delay), callback })
      return () => { armed.delete(id) }
    },
    interval(callback, delay) {
      sequence += 1
      const id = sequence
      const every = Math.max(1, delay)
      armed.set(id, { dueAt: now + every, every, callback })
      return () => { armed.delete(id) }
    },
  }

  return {
    face,
    advance(ms) {
      const target = now + Math.max(0, ms)
      for (;;) {
        let nextId: number | undefined
        let next: ArmedTimer | undefined
        for (const [id, timer] of armed) {
          if (timer.dueAt > target) continue
          if (next === undefined || timer.dueAt < next.dueAt) {
            nextId = id
            next = timer
          }
        }
        if (next === undefined || nextId === undefined) break
        now = next.dueAt
        if (next.every === undefined) armed.delete(nextId)
        else next.dueAt = now + next.every
        next.callback()
      }
      now = target
    },
    armed: () => armed.size,
    dispose: () => { armed.clear() },
  }
}

/** Let every queued promise callback settle, without touching the clock. */
export async function flush(turns = 60): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}
