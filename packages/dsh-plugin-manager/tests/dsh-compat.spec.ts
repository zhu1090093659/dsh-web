import { describe, expect, it } from 'vitest'
import { evaluateDshCompatibility } from '../src/host/dsh-compat.ts'

/**
 * The 29-segment declaration dsh-llm-verifier publishes under `engines.dsh`
 * (read from its manifest at 0.10.1). Each `^0.1.x` segment is a careful range
 * over that line, so the whole thing is a legal node-semver range rather than
 * a comparator set the old single-`>=` reader could evaluate.
 */
const LLM_VERIFIER_RANGE = '^0.1.1-rc.2 || ^0.1.2-alpha.1 || ^0.1.2-alpha.2 || ^0.1.2-alpha.3 || ^0.1.2-alpha.4'
  + ' || ^0.1.2-alpha.5 || ^0.1.2-rc.1 || ~0.1.2 || ^0.1.3 || ^0.1.4 || ^0.1.5-alpha.1 || ^0.1.5-rc.1'
  + ' || ~0.1.5 || ^0.1.6-alpha.1 || ^0.1.6-alpha.2 || ~0.1.6 || ^0.1.7-alpha.1 || ^0.1.7-alpha.2'
  + ' || ^0.1.7-rc.1 || ^0.1.7-rc.2 || ^0.2.0-rc.1 || ^0.2.0-rc.2 || ^0.2.1-alpha.1 || ^0.2.1-alpha.2'
  + ' || ^0.2.1-alpha.3 || ^0.2.1-alpha.4 || ^0.2.1-alpha.5 || ^0.2.1-rc.1 || ^0.2.1-rc.2'

/** The two-segment declaration dsh-context publishes under `engines.dsh`. */
const CONTEXT_RANGE = '>=0.1.7-rc.2 || >=0.2.0-rc.2'

describe('evaluateDshCompatibility', () => {
  it('operator: accepts the host a real 29-segment caret declaration covers', () => {
    // Given dsh-llm-verifier's published engines.dsh range
    // When the running host is 0.2.1-rc.2
    // Then the verdict is satisfied, exactly as the official boot gate decides it
    expect(evaluateDshCompatibility('0.2.1-rc.2', LLM_VERIFIER_RANGE)).toEqual({ verdict: 'satisfied' })
  })

  it('operator: rejects a host above every alternative of a real declaration', () => {
    // Given the same published range
    // When the host moved past its last alternative
    // Then both the next minor and a far-future release are reported as too low
    expect(evaluateDshCompatibility('0.3.0', LLM_VERIFIER_RANGE)).toEqual({ verdict: 'host-too-low' })
    expect(evaluateDshCompatibility('1.0.0', LLM_VERIFIER_RANGE)).toEqual({ verdict: 'host-too-low' })
  })

  it('operator: rejects a host below a real declaration whose alternatives all start higher', () => {
    // Given dsh-context's two-alternative range
    // When the host predates the first alternative
    // Then the verdict is unsatisfied
    expect(evaluateDshCompatibility('0.1.0-rc.8', CONTEXT_RANGE)).toEqual({ verdict: 'host-too-low' })
  })

  it('operator: accepts a host that only the later alternative of a declaration covers', () => {
    // Given dsh-context's two-alternative range
    // When the host satisfies both alternatives (0.2.1-rc.2) or only the open-ended second one (0.3.0)
    // Then the verdict is satisfied without needing an upper bound
    expect(evaluateDshCompatibility('0.2.1-rc.2', CONTEXT_RANGE)).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.3.0', CONTEXT_RANGE)).toEqual({ verdict: 'satisfied' })
  })

  it('operator: keeps the single-comparator floor behaviour the family declares', () => {
    // Given a family package's >=X.Y.Z[-pre] floor
    // When the host sits on the next prerelease line, meets it exactly, or sits below it
    // Then ordering across prerelease lines is unchanged from before the fix
    expect(evaluateDshCompatibility('0.1.1-rc.2', '>=0.1.0-rc.8')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.0-rc.8', '>=0.1.0-rc.8')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.0-rc.8', '>=0.1.1-rc.1')).toEqual({ verdict: 'host-too-low' })
    expect(evaluateDshCompatibility('0.1.0-rc.7', '>=0.1.0-rc.8')).toEqual({ verdict: 'host-too-low' })
  })

  it('operator: accepts the other legal range forms a manifest may declare', () => {
    // Given caret, tilde, x-range, multi-comparator and spaced-comparator forms
    // When the host falls inside each
    // Then every form decides instead of being declared unsupported
    expect(evaluateDshCompatibility('0.1.1-rc.2', '^0.1.0-rc.8')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '~0.1.0-rc.8')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.2.1-rc.2', '0.2.x')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '>=0.1.0-rc.8 <0.2.0')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '>= v0.1.0-rc.8')).toEqual({ verdict: 'satisfied' })
  })

  it('operator: reads a star range as the unconstrained range it is', () => {
    // Given a declaration that constrains nothing ('>= *' normalizes to '*')
    // When the host is any valid version
    // Then the verdict is satisfied; the official gate returns the same answer
    // (#754's fail-closed path is about declarations we cannot parse, not about
    // declarations that legitimately exclude nobody)
    expect(evaluateDshCompatibility('0.1.1-rc.2', '>= *')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '*')).toEqual({ verdict: 'satisfied' })
  })

  it('operator: reports an absent, unparsable or malformed declaration as unverifiable rather than too low', () => {
    // Given an empty declaration (validRange reports '*' for it), a range
    // node-semver rejects, or a host string that is not one version
    // When the verdict is requested
    // Then it is unverifiable, which the caller fails closed on without
    // claiming the host is below a minimum nothing was compared against
    // (issue #1899)
    expect(evaluateDshCompatibility('0.1.1-rc.2', '')).toEqual({ verdict: 'unverifiable' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '   ')).toEqual({ verdict: 'unverifiable' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', 'nonsense')).toEqual({ verdict: 'unverifiable' })
    expect(evaluateDshCompatibility('0.1.1-rc.2', '>=0.1.0-rc.8 || garbage')).toEqual({ verdict: 'unverifiable' })
    expect(evaluateDshCompatibility('nope', '>=0.1.0-rc.8')).toEqual({ verdict: 'unverifiable' })
    expect(evaluateDshCompatibility('0.1', '>=0.1.0-rc.8')).toEqual({ verdict: 'unverifiable' })
  })

  it('operator: keeps the three causes apart on the same host version', () => {
    // Given one readable host version
    // When it is compared against a satisfied declaration, an unsatisfied one,
    // and one that cannot be parsed
    // Then each cause reports its own verdict, so callers can tell "too old"
    // from "could not check" instead of folding both into "blocked" (#1899)
    expect(evaluateDshCompatibility('0.2.1-rc.2', '>=0.2.1-rc.2')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.2.1-rc.2', '>=0.3.0')).toEqual({ verdict: 'host-too-low' })
    expect(evaluateDshCompatibility('0.2.1-rc.2', 'nonsense')).toEqual({ verdict: 'unverifiable' })
  })
})

describe('evaluateDshCompatibility against the declarations this repository ships', () => {
  it('operator: accepts the host the family itself requires', () => {
    // Given this package's own declared floor (dsh.engines.dsh)
    // When the running host is exactly that cohort
    // Then the room's own requirement verifies, so the checker cannot block its own family
    expect(evaluateDshCompatibility('0.2.1-rc.2', '>=0.2.1-rc.2')).toEqual({ verdict: 'satisfied' })
    expect(evaluateDshCompatibility('0.2.1-rc.2', '>= 0.2.1-rc.2')).toEqual({ verdict: 'satisfied' })
  })
})
