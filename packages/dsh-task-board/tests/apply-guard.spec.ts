/**
 * Apply guard tests: the task-board client bundle must mount exactly once per
 * page lifetime, even when the module factory runs more than once (duplicated
 * client injection). The full apply() is not exercised here because it wires
 * DOM mounting, React portals, and the runtime context; the guard itself is
 * the unit under test, and apply() early-returns on a losing claim.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { claimTaskboardApply, releaseTaskboardApply } from '../src/client/apply-guard.ts'

describe('claimTaskboardApply', () => {
  beforeEach(() => {
    globalThis.__dshTaskboardApplied = undefined
  })

  it('grants the first claim', () => {
    expect(claimTaskboardApply()).toBe(true)
  })

  it('rejects later claims in the same page lifetime', () => {
    expect(claimTaskboardApply()).toBe(true)
    expect(claimTaskboardApply()).toBe(false)
    expect(claimTaskboardApply()).toBe(false)
  })

  it('keeps rejecting across independent module instances', () => {
    // Simulates two factory runs: each run is a separate module instance,
    // but they share one globalThis flag.
    expect(claimTaskboardApply()).toBe(true)
    expect(claimTaskboardApply()).toBe(false)
    expect(globalThis.__dshTaskboardApplied).toBe(true)
  })

  it('grants again after the claim is released (fiber unload / hot-reload)', () => {
    expect(claimTaskboardApply()).toBe(true)
    releaseTaskboardApply()
    expect(claimTaskboardApply()).toBe(true)
  })

  it('grants again after a full page reload (flag cleared)', () => {
    expect(claimTaskboardApply()).toBe(true)
    globalThis.__dshTaskboardApplied = undefined
    expect(claimTaskboardApply()).toBe(true)
  })
})
