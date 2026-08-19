/**
 * Invariant helpers for the page-annotate plugin. Assertions throw
 * InvariantError with a stable message; the host and client halves share
 * the shape so callers can catch uniformly.
 * @module @linxin666/dsh-page-annotate/invariant
 */

/** Error thrown by `invariant` when the condition fails. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvariantError'
  }
}

/** Assert a condition; throw InvariantError with `message` otherwise. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message)
}
