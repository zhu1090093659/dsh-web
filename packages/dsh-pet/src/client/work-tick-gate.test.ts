/**
 * Work-tick gate tests: the window follows the configured cadence (clamped to
 * the manifest bounds), one adjudication is admitted per window, and entering
 * work mode re-arms the gate.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TICK_MS, createWorkTickGate, workTickWindowMs } from './work-tick-gate.ts'

describe('workTickWindowMs', () => {
  it('follows the configured cadence', () => {
    expect(workTickWindowMs(2_000)).toBe(2_000)
    expect(workTickWindowMs(10_000)).toBe(10_000)
    expect(workTickWindowMs(60_000)).toBe(60_000)
  })

  it('clamps to the manifest bounds and defaults when absent', () => {
    expect(workTickWindowMs(500)).toBe(1_000)
    expect(workTickWindowMs(120_000)).toBe(60_000)
    expect(workTickWindowMs(undefined)).toBe(DEFAULT_WORK_TICK_MS)
    expect(workTickWindowMs(Number.NaN)).toBe(DEFAULT_WORK_TICK_MS)
  })
})

describe('createWorkTickGate', () => {
  it('admits one adjudication per configured window', () => {
    let now = 1_000_000
    const gate = createWorkTickGate(() => now)
    expect(gate.allow(2_000)).toBe(true)
    now += 1_999
    expect(gate.allow(2_000)).toBe(false)
    now += 1
    expect(gate.allow(2_000)).toBe(true)
  })

  it('does not downgrade a pet whose cadence is shorter than the default', () => {
    let now = 1_000_000
    const gate = createWorkTickGate(() => now)
    expect(gate.allow(2_000)).toBe(true)
    for (let tick = 0; tick < 5; tick++) {
      now += 2_000
      expect(gate.allow(2_000)).toBe(true)
    }
  })

  it('arms immediately after a reset (work mode entry)', () => {
    let now = 1_000_000
    const gate = createWorkTickGate(() => now)
    expect(gate.allow(10_000)).toBe(true)
    expect(gate.allow(10_000)).toBe(false)
    gate.reset()
    expect(gate.allow(10_000)).toBe(true)
  })
})
