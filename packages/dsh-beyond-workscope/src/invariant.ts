/** Invariant assertion (dev discipline, same shape as the sibling packages). */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[dsh-beyond-workscope] ${message}`)
}
