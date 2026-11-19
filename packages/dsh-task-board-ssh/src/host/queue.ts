/**
 * Per-host admission: the concurrency ceiling and the first-in-first-out queue.
 *
 * The queue is not stored anywhere of its own — it is the ordered set of cards
 * whose payload carries a queued run, which is what makes it survive a restart
 * for free: the same cards, read in the same order, produce the same queue.
 * Order is the instant each run was requested, with the run id as the tie-break
 * so two runs requested in the same millisecond still have one order.
 *
 * @module dsh-task-board-ssh/host/queue
 */

/** One run waiting for a slot on its host. */
export interface SshQueueEntry {
  /** Card waiting for the slot. */
  taskId: string
  /** Run the card waits on. */
  runId: string
  /** Instant the run was requested (ms epoch). */
  startedAt: number
}

/** What one admission pass decided. */
export interface SshAdmission {
  /** Runs that may start now, in queue order. */
  start: SshQueueEntry[]
  /** Runs left waiting, in the order they will be reached. */
  waiting: SshQueueEntry[]
}

/** Default ceiling of concurrent runs on one host. */
export const DEFAULT_PER_HOST_CAP = 2

/** Lowest accepted ceiling; one run at a time is the smallest queue worth naming. */
export const PER_HOST_CAP_MIN = 1

/** Highest accepted ceiling per host. */
export const PER_HOST_CAP_MAX = 16

/**
 * Clamp a configured ceiling into the accepted range.
 * @param value - configured value; anything unusable falls back to the default.
 * @returns an integer between {@link PER_HOST_CAP_MIN} and {@link PER_HOST_CAP_MAX}.
 */
export function normalizePerHostCap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PER_HOST_CAP
  return Math.min(PER_HOST_CAP_MAX, Math.max(PER_HOST_CAP_MIN, Math.trunc(value)))
}

/**
 * Order a host's queue the way it will be served.
 * @param entries - every queued run of one host.
 * @returns the same entries, oldest first.
 */
export function orderQueue(entries: readonly SshQueueEntry[]): SshQueueEntry[] {
  return [...entries].sort((left, right) => {
    if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt
    return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0
  })
}

/**
 * Decide which queued runs may start now.
 * @param entries - every queued run of one host, in any order.
 * @param running - how many runs of that host already hold a slot.
 * @param cap - the host's ceiling.
 * @returns the runs to start now and the ones still waiting.
 */
export function admitRuns(entries: readonly SshQueueEntry[], running: number, cap: number): SshAdmission {
  const ordered = orderQueue(entries)
  const free = Math.max(0, normalizePerHostCap(cap) - Math.max(0, Math.trunc(running)))
  return { start: ordered.slice(0, free), waiting: ordered.slice(free) }
}
