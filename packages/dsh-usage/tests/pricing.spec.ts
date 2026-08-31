import { describe, expect, it } from 'vitest'
import { deepseekModelSpend, deepseekPeriodAt } from '../src/core/pricing.ts'
import { emptyTotals } from '../src/core/types.ts'

/**
 * Fixed instants picked against the published window definition (Beijing
 * Monday-Friday 09:00-12:00 and 14:00-18:00). 2026-08-28 is a Friday,
 * 2026-08-29 a Saturday, 2026-08-31 a Monday; Beijing = UTC+8 year-round.
 */
const FRI_10_00_BJ = Date.UTC(2026, 7, 28, 2, 0) // Friday 10:00 Beijing -> peak
const FRI_12_30_BJ = Date.UTC(2026, 7, 28, 4, 30) // Friday 12:30 Beijing -> off-peak
const FRI_13_00_BJ = Date.UTC(2026, 7, 28, 5, 0) // Friday 13:00 Beijing -> off-peak
const FRI_20_00_BJ = Date.UTC(2026, 7, 28, 12, 0) // Friday 20:00 Beijing -> off-peak
const SAT_10_00_BJ = Date.UTC(2026, 7, 29, 2, 0) // Saturday -> off-peak
const MON_09_00_BJ = Date.UTC(2026, 7, 31, 1, 0) // Monday 09:00 Beijing -> peak start

describe('deepseekPeriodAt', () => {
  it('flags the morning and afternoon weekday windows as peak, ending at the window close', () => {
    expect(deepseekPeriodAt(FRI_10_00_BJ)).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 4, 0) })
    expect(deepseekPeriodAt(Date.UTC(2026, 7, 28, 7, 30))).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 10, 0) })
  })

  it('treats the lunch gap, evening, and weekends as off-peak', () => {
    expect(deepseekPeriodAt(FRI_12_30_BJ).peak).toBe(false)
    expect(deepseekPeriodAt(FRI_13_00_BJ)).toEqual({ peak: false, boundaryMs: Date.UTC(2026, 7, 28, 6, 0) })
    expect(deepseekPeriodAt(FRI_20_00_BJ).peak).toBe(false)
    expect(deepseekPeriodAt(SAT_10_00_BJ).peak).toBe(false)
  })

  it('points the next boundary at the next window start across the weekend', () => {
    expect(deepseekPeriodAt(FRI_20_00_BJ).boundaryMs).toBe(MON_09_00_BJ)
    expect(deepseekPeriodAt(SAT_10_00_BJ).boundaryMs).toBe(MON_09_00_BJ)
    // Friday 08:30 Beijing: same-morning window start.
    expect(deepseekPeriodAt(Date.UTC(2026, 7, 28, 0, 30))).toEqual({ peak: false, boundaryMs: Date.UTC(2026, 7, 28, 1, 0) })
    // Monday 09:00 sharp opens the peak.
    expect(deepseekPeriodAt(MON_09_00_BJ).peak).toBe(true)
  })

  it('lands the peak boundary exactly on the closing minute, sub-second precision included', () => {
    const almostNoon = Date.UTC(2026, 7, 28, 3, 59, 59, 500)
    expect(deepseekPeriodAt(almostNoon)).toEqual({ peak: true, boundaryMs: Date.UTC(2026, 7, 28, 4, 0, 0, 0) })
  })
})

describe('deepseekModelSpend', () => {
  it('prices uncached input, cache hits, and output at the published per-million rows', () => {
    // flash off-peak: miss 1.5, hit 0.05, output 4.5 per million.
    expect(deepseekModelSpend('deepseek-v4-flash', { ...emptyTotals(), inputTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(1.5, 6)
    expect(deepseekModelSpend('deepseek-v4-flash', { ...emptyTotals(), cacheReadTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(0.05, 6)
    expect(deepseekModelSpend('deepseek-v4-flash', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ)).toBeCloseTo(4.5, 6)
  })

  it('doubles every row during the peak period and halves it off-peak', () => {
    const totals = { ...emptyTotals(), inputTokens: 100_000, cacheReadTokens: 200_000, outputTokens: 50_000 }
    const offPeak = (100_000 * 1.5 + 200_000 * 0.05 + 50_000 * 4.5) / 1_000_000
    expect(deepseekModelSpend('deepseek-v4-flash-vision-exp', totals, FRI_12_30_BJ)).toBeCloseTo(offPeak, 6)
    expect(deepseekModelSpend('deepseek-v4-flash-vision-exp', totals, FRI_10_00_BJ)).toBeCloseTo(offPeak * 2, 6)
  })

  it('uses the pro row for v4-pro ids and prices cache writes as uncached input', () => {
    expect(deepseekModelSpend('deepseek-v4-pro', { ...emptyTotals(), inputTokens: 1_000_000 }, FRI_10_00_BJ)).toBeCloseTo(9.0, 6)
    expect(deepseekModelSpend('deepseek-v4-pro', { ...emptyTotals(), cacheWriteTokens: 1_000_000 }, FRI_10_00_BJ)).toBeCloseTo(9.0, 6)
  })

  it('falls back to the flash-class row for unknown model ids', () => {
    expect(deepseekModelSpend('deepseek-chat', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ))
      .toBe(deepseekModelSpend('deepseek-v4-flash', { ...emptyTotals(), outputTokens: 1_000_000 }, FRI_12_30_BJ))
  })
})
