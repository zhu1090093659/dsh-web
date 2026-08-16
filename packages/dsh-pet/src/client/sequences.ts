/**
 * Per-phase animation rotation. Instead of looping one track per phase, the
 * pet plays a rotating sequence of tracks, so a long phase (thinking,
 * waiting, ...) stays lively. Each item plays for the full duration of its
 * own track (as served in the pet definition), then the sequence advances;
 * the whole sequence loops. Host logic is untouched: the host still reports
 * the canonical animation for the phase, and this client side decides which
 * track is actually displayed.
 * @module @linxin666/dsh-pet/client/sequences
 */

import type { ActivityPhase, PetAnimation } from '../state.ts'

/**
 * One rotation sequence per activity phase. Every sequence has at least 5
 * items and starts with the phase's canonical animation, so the pet's first
 * impression matches the host's mapping.
 */
export const PHASE_SEQUENCES: Record<ActivityPhase, readonly PetAnimation[]> = {
  idle: ['idle', 'waving', 'idle', 'waiting', 'idle', 'idle'],
  waiting: ['waiting', 'idle', 'waving', 'waiting', 'idle', 'waiting'],
  thinking: ['running', 'running-right', 'running', 'running-left', 'running', 'waiting', 'running'],
  tool: ['running-right', 'running', 'running-left', 'running', 'running-right', 'running'],
  review: ['review', 'waiting', 'review', 'running', 'review', 'idle'],
  done: ['jumping', 'waving', 'jumping', 'waving', 'jumping', 'idle'],
  failed: ['failed', 'waiting', 'failed', 'idle', 'waiting', 'failed'],
}

/** The rotation sequence for one phase; unknown phases fall back to one item. */
export function sequenceFor(phase: ActivityPhase, fallback: PetAnimation = 'idle'): readonly PetAnimation[] {
  return PHASE_SEQUENCES[phase] ?? [fallback]
}
