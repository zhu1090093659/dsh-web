/** Package invariants: shared assertion helpers for the codex-board plugin. */

/** Assert a condition; throws a descriptive Error when it fails. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
