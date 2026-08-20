/**
 * Phase stream — bridges the polled host snapshots onto the renderer
 * contract's { get, subscribe } shape (pet-center M2 P4, issue #623). The
 * existing poll loop pushes each snapshot's ActivityPhase; subscribers are
 * dispatched on CHANGE only (phase transitions are sparse — done/failed hold
 * a timed window before falling back to idle — and renderers like Live2D pay
 * per transition, not per tick).
 * @module @linxin666/dsh-pet/client/phase-stream
 */

import type { ActivityPhase } from '../state.ts'

/** The renderer-facing phase stream. */
export interface PhaseStream {
  /** The latest pushed phase. */
  get(): ActivityPhase
  /** Subscribe to phase changes; returns the unsubscribe. */
  subscribe(listener: (phase: ActivityPhase) => void): () => void
  /** Feed a fresh snapshot phase; no-op when unchanged. */
  push(phase: ActivityPhase): void
}

/** Create the stream (one per pet entry lifetime, owned by the plugin body). */
export function createPhaseStream(initial: ActivityPhase = 'idle'): PhaseStream {
  let current = initial
  const listeners = new Set<(phase: ActivityPhase) => void>()
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    push(phase) {
      if (phase === current) return
      current = phase
      for (const listener of [...listeners]) listener(phase)
    },
  }
}
