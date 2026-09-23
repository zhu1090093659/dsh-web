/**
 * Lever decisions, without a browser: the state the arm shows and the preset a
 * push-up restores. The host only accepts a preset switch while a session is
 * blank, so the blank flag is part of the decision rather than a view filter.
 * test-standards-allow: pure core logic unit tests with synthetic domain facts
 */

import { describe, expect, it } from 'vitest'

import { LIANGSHEN_PRESET_ID, isActionable, leverState, restoreTarget, type LeverFacts } from '../src/core/lever.ts'

const base: LeverFacts = {
  blank: true,
  agentPreset: 'standard',
  available: ['standard', 'liangshen', 'master'],
  fallback: 'standard',
}

describe('leverState', () => {
  it('reports off while another preset is current on a blank session', () => {
    expect(leverState(base)).toBe('off')
  })

  it('reports on when the session already runs the LiangShen preset', () => {
    expect(leverState({ ...base, agentPreset: LIANGSHEN_PRESET_ID })).toBe('on')
  })

  it('reports locked once the session has started', () => {
    expect(leverState({ ...base, blank: false })).toBe('locked')
    // Locked outranks the preset match: the mode cannot be switched back either.
    expect(leverState({ ...base, blank: false, agentPreset: LIANGSHEN_PRESET_ID })).toBe('locked')
  })

  it('reports missing when the deployment supplies no LiangShen preset', () => {
    expect(leverState({ ...base, available: ['standard'], agentPreset: undefined })).toBe('missing')
  })
})

describe('isActionable', () => {
  it('allows only the two switchable states', () => {
    expect(isActionable('on')).toBe(true)
    expect(isActionable('off')).toBe(true)
    expect(isActionable('locked')).toBe(false)
    expect(isActionable('missing')).toBe(false)
  })
})

describe('restoreTarget', () => {
  it('prefers the preset the user was on before the pull', () => {
    expect(restoreTarget({ ...base, previous: 'master' })).toBe('master')
  })

  it('falls back to the deployment default when nothing was remembered', () => {
    expect(restoreTarget(base)).toBe('standard')
  })

  it('never restores the LiangShen preset itself', () => {
    expect(restoreTarget({ ...base, previous: LIANGSHEN_PRESET_ID })).toBe('standard')
    expect(restoreTarget({ ...base, fallback: LIANGSHEN_PRESET_ID, previous: LIANGSHEN_PRESET_ID })).toBe('standard')
  })

  it('user with a liangshen deployment default restores the first available non-liangshen preset', () => {
    // Given a deployment whose default preset is LiangShen and nothing remembered
    const facts: LeverFacts = { ...base, fallback: LIANGSHEN_PRESET_ID, previous: undefined }

    // When the restore target is computed
    const target = restoreTarget(facts)

    // Then the first available preset that is not LiangShen wins
    expect(target).toBe('standard')
  })

  it('user who remembered a preset gets it back even when the deployment default is liangshen', () => {
    // Given a remembered preset and a LiangShen deployment default
    const facts: LeverFacts = { ...base, fallback: LIANGSHEN_PRESET_ID, previous: 'master' }

    // When the restore target is computed
    const target = restoreTarget(facts)

    // Then the remembered preset is restored
    expect(target).toBe('master')
  })

  it('skips a remembered preset the roster no longer supplies', () => {
    expect(restoreTarget({ ...base, previous: 'retired' })).toBe('standard')
    expect(restoreTarget({ ...base, available: [LIANGSHEN_PRESET_ID], previous: 'retired', fallback: 'also-retired' })).toBeUndefined()
  })

  it('returns nothing when the roster supplies only the LiangShen preset', () => {
    expect(restoreTarget({ ...base, available: [LIANGSHEN_PRESET_ID], previous: undefined, fallback: undefined })).toBeUndefined()
  })
})
