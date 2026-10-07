/**
 * The acceptance state predicates settlement reads: which executions owe a
 * pass record at all, and which of them owe one while the judge never ran once.
 *
 * These are pure functions over a persisted block, so the tests below build the
 * block directly instead of driving a Host: what is under test is the decision,
 * not the poll loop.
 */
import { describe, expect, it } from 'vitest'
import {
  resolveContract,
  verificationNeverInvoked,
  verificationRequired,
  type ExecutionVerification,
  type ModelCatalogView,
  type VerificationAttempt,
} from '../src/core/verification.ts'

/** The host catalog the contract below resolves against. */
function catalog(): ModelCatalogView {
  return {
    default: { provider: 'deepseek-official', model: 'deepseek-flash' },
    groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash' }] }],
  }
}

/** One recorded acceptance attempt in the given stage. */
function attempt(stage: VerificationAttempt['stage']): VerificationAttempt {
  return {
    index: 1,
    at: 1_700_000_000_000,
    stage,
    passed: false,
    score: stage === 'quality' ? 0.2 : 0,
    baseline: 0,
    criteria: [],
    findings: [],
    usage: { calls: stage === 'quality' ? 6 : 1, inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
    evidence: { chars: 100, omittedCharacters: 0, entries: 4, hash: 'h' },
    route: { provider: 'deepseek-official', model: 'deepseek-flash' },
    channel: 'explicit-tag',
    rounds: stage === 'quality' ? 2 : 0,
    ...(stage === 'quality' ? {} : { error: 'judge route timed out' }),
  }
}

/** A persisted acceptance block in the shape settlement reads. */
function block(overrides: Partial<ExecutionVerification>): ExecutionVerification {
  return {
    contract: resolveContract({ enabled: true, model: '', reasoningEffort: '' }, catalog()),
    attempts: [],
    applicability: 'enforced',
    ...overrides,
  }
}

describe('acceptance state predicates at settlement', () => {
  it('user whose goal execution recorded no acceptance attempt sees the never-invoked shape', () => {
    // Given an enforced execution whose gate never opened
    const verification = block({})

    // When the settlement predicates read it
    const required = verificationRequired(verification)
    const neverInvoked = verificationNeverInvoked(verification)

    // Then a pass record is owed AND the absence of records is recognised as
    // "the judge never ran", not as a failed verdict.
    expect(required).toBe(true)
    expect(neverInvoked).toBe(true)
  })

  it('user whose judge answered and rejected the work does not see the never-invoked shape', () => {
    // Given an enforced execution holding a quality verdict that did not pass
    const verification = block({ attempts: [attempt('quality')] })

    // When the predicate reads it
    const neverInvoked = verificationNeverInvoked(verification)

    // Then the judge ran and judged: this is a delivery verdict, not a missing
    // completion call.
    expect(neverInvoked).toBe(false)
  })

  it('user whose judge route only produced anomalies does not see the never-invoked shape', () => {
    // Given the #1828 shape: the gate opened and every attempt timed out
    const verification = block({ attempts: [attempt('exception'), attempt('exception')] })

    // When the predicate reads it
    const neverInvoked = verificationNeverInvoked(verification)

    // Then the judge was reached, so the failure is about the acceptance
    // environment and not about an absent completion call.
    expect(neverInvoked).toBe(false)
  })

  it('user whose execution the time budget ended before a verdict does not see the never-invoked shape', () => {
    // Given an enforced execution whose budget stop is on record
    const verification = block({ attempts: [attempt('budget')] })

    // When the predicate reads it
    const neverInvoked = verificationNeverInvoked(verification)

    // Then the acceptance was entered and consumed, which is a fact about the
    // run even though no verdict was reached.
    expect(neverInvoked).toBe(false)
  })

  it('user whose run is not acceptance-gated is never reported as never invoked', () => {
    // Given the four shapes that settle on their own verdict
    const notEnforced = (['disabled', 'skipped', 'goal-unavailable', 'team-member'] as const)
      .map(applicability => verificationNeverInvoked(block({ applicability })))

    // When the predicate reads each of them
    // Then none claims a missing completion call, because none ever owed one.
    expect(notEnforced).toEqual([false, false, false, false])
  })

  it('user whose cycle the gate already closed is never reported as never invoked', () => {
    // Given an enforced execution with no attempts and a recorded closed reason
    const verification = block({ failedReason: 'goal 验收第 2 次仍未通过', failedAt: 1_700_000_000_100 })

    // When the predicate reads it
    const neverInvoked = verificationNeverInvoked(verification)

    // Then the recorded reason owns the settlement, so the never-invoked copy
    // cannot replace a verdict that was already reached.
    expect(neverInvoked).toBe(false)
  })

  it('user whose execution predates the acceptance block is not reported as never invoked', () => {
    // Given an open execution carrying no acceptance block at all
    const absent: ExecutionVerification | undefined = undefined

    // When the predicates read it
    const required = verificationRequired(absent)
    const neverInvoked = verificationNeverInvoked(absent)

    // Then nothing is retroactively enforced and nothing is accused.
    expect(required).toBe(false)
    expect(neverInvoked).toBe(false)
  })
})
