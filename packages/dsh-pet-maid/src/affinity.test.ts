import { describe, expect, it } from 'vitest'
import {
  AFFINITY_MAX,
  AFFINITY_RANKS,
  applyInteraction,
  applyTurnReward,
  defaultAffinityConfig,
  emptyAffinity,
  rankOf,
} from './affinity.ts'

describe('applyInteraction', () => {
  it('accepts the first pet and grants the pet reward', () => {
    const now = 1_000_000
    const outcome = applyInteraction(emptyAffinity(), 'pet', now)
    expect(outcome.accepted).toBe(true)
    expect(outcome.delta).toBe(defaultAffinityConfig.petReward)
    expect(outcome.affinity.points).toBe(defaultAffinityConfig.petReward)
    expect(outcome.affinity.pets).toBe(1)
    expect(outcome.affinity.lastPetAt).toBe(now)
  })

  it('rejects a pet inside the cooldown without mutating state', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'pet', now)
    const second = applyInteraction(first.affinity, 'pet', now + defaultAffinityConfig.petCooldownMs - 1)
    expect(second.accepted).toBe(false)
    expect(second.delta).toBe(0)
    expect(second.affinity).toBe(first.affinity) // same reference: no mutation
    expect(second.affinity.pets).toBe(1)
  })

  it('accepts a pet again after the cooldown elapsed', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'pet', now)
    const second = applyInteraction(first.affinity, 'pet', now + defaultAffinityConfig.petCooldownMs)
    expect(second.accepted).toBe(true)
    expect(second.affinity.pets).toBe(2)
  })

  it('rejects a feed inside the cooldown without spending anything', () => {
    const now = 1_000_000
    const first = applyInteraction(emptyAffinity(), 'feed', now)
    const second = applyInteraction(first.affinity, 'feed', now + defaultAffinityConfig.feedCooldownMs - 1)
    expect(second.accepted).toBe(false)
    expect(second.delta).toBe(0)
    expect(second.affinity).toBe(first.affinity)
    expect(second.affinity.feeds).toBe(1)
  })

  it('clamps points at AFFINITY_MAX', () => {
    const state = { ...emptyAffinity(), points: AFFINITY_MAX - 1 }
    const outcome = applyInteraction(state, 'pet', 1_000_000)
    expect(outcome.affinity.points).toBe(AFFINITY_MAX)
  })
})

describe('applyTurnReward', () => {
  it('increments turns and points', () => {
    const next = applyTurnReward(emptyAffinity())
    expect(next.turns).toBe(1)
    expect(next.points).toBe(defaultAffinityConfig.turnReward)
  })
})

describe('rankOf', () => {
  it('maps point totals onto the rank ladder', () => {
    for (const rank of AFFINITY_RANKS) {
      expect(rankOf(rank.min).name).toBe(rank.name)
    }
    expect(rankOf(AFFINITY_MAX).name).toBe(AFFINITY_RANKS[AFFINITY_RANKS.length - 1]!.name)
    expect(rankOf(-1).name).toBe(AFFINITY_RANKS[0]!.name)
  })
})
