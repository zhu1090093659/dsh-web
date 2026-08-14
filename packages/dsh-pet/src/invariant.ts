/**
 * Package invariants — cheap structural checks run at import time on the
 * host side. Mirrors the pattern used by other dsh plugin packages.
 * @module @linxin666/dsh-pet/invariant
 */

import { AFFINITY_MAX, AFFINITY_RANKS, defaultAffinityConfig } from './affinity.ts'
import { animationForPhase } from './state.ts'
import type { ActivityPhase } from './state.ts'

/** Assert a condition; throws a descriptive Error when violated. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[dsh-pet] ${message}`)
  }
}

/** Run every package invariant once; throws on the first violation. */
export function runPetInvariants(): void {
  invariant(AFFINITY_MAX > 0, 'AFFINITY_MAX must be positive')
  invariant(
    AFFINITY_RANKS.length > 0 && AFFINITY_RANKS[0]!.min === 0,
    'AFFINITY_RANKS must start at 0',
  )
  invariant(defaultAffinityConfig.turnReward > 0, 'turnReward must be positive')
  invariant(defaultAffinityConfig.feedCooldownMs > defaultAffinityConfig.petCooldownMs,
    'feed cooldown must exceed pet cooldown')

  // Every activity phase must map onto a known animation track.
  const phases: readonly ActivityPhase[] = ['idle', 'waiting', 'thinking', 'tool', 'done']
  for (const phase of phases) {
    invariant(
      ['idle', 'running', 'running-right', 'waiting', 'jumping'].includes(animationForPhase(phase)),
      `phase ${phase} maps outside the animation contract`,
    )
  }
}

// Run once on import (host half only; cheap and side-effect free).
runPetInvariants()
