import { describe, expect, it } from 'vitest'
import { PHASE_SEQUENCES, sequenceFor } from './sequences.ts'
import type { ActivityPhase } from '../state.ts'

const PHASES: ActivityPhase[] = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed']

/** The canonical animation the host state machine maps each phase onto. */
const CANONICAL: Record<ActivityPhase, string> = {
  idle: 'idle',
  waiting: 'waiting',
  thinking: 'running',
  tool: 'running-right',
  review: 'review',
  done: 'jumping',
  failed: 'failed',
}

describe('phase rotation sequences', () => {
  it('defines a sequence for every activity phase', () => {
    for (const phase of PHASES) {
      expect(PHASE_SEQUENCES[phase]).toBeDefined()
    }
  })

  it('gives every phase at least 5 items', () => {
    for (const phase of PHASES) {
      expect(PHASE_SEQUENCES[phase].length).toBeGreaterThanOrEqual(5)
    }
  })

  it('starts each sequence on the phase canonical animation', () => {
    for (const phase of PHASES) {
      expect(PHASE_SEQUENCES[phase][0]).toBe(CANONICAL[phase])
    }
  })

  it('falls back to a single-item sequence for an unknown phase', () => {
    expect(sequenceFor('bogus' as ActivityPhase, 'waving')).toEqual(['waving'])
  })
})
