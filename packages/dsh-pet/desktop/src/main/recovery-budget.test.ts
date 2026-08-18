import { describe, expect, it } from 'vitest'

import { RecoveryBudget } from './recovery-budget.ts'

describe('automatic recovery budget', () => {
  it('allows one immediate renderer reload without permitting a crash loop', () => {
    const budget = new RecoveryBudget(1, 60_000)

    expect(budget.allow(1_000)).toBe(true)
    expect(budget.allow(1_001)).toBe(false)
    expect(budget.allow(60_999)).toBe(false)
    expect(budget.allow(61_000)).toBe(true)
  })
})
