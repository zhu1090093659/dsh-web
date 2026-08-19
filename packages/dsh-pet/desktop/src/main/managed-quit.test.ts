import { afterEach, describe, expect, it, vi } from 'vitest'

import { createManagedQuitGate, quitSingleInstance } from './managed-quit.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('managed desktop quit gate', () => {
  it('lets a rapid replacement registration cancel the pending exit', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const gate = createManagedQuitGate(quit, 250)

    const result = gate.schedule()
    vi.advanceTimersByTime(200)
    gate.cancel()
    vi.advanceTimersByTime(100)

    expect(quit).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
  })

  it('coalesces repeated requests and exits once after the grace period', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const gate = createManagedQuitGate(quit, 250)

    const first = gate.schedule()
    const second = gate.schedule()
    expect(second).toBe(first)
    vi.advanceTimersByTime(250)

    expect(quit).toHaveBeenCalledTimes(1)
    await expect(first).resolves.toBe(true)
  })

  it('disposes a pending exit during application teardown', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const gate = createManagedQuitGate(quit, 250)

    const result = gate.schedule()
    gate.dispose()
    vi.runAllTimers()

    expect(quit).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
  })

  it('rechecks the registration condition when the grace period expires', async () => {
    vi.useFakeTimers()
    const quit = vi.fn()
    const canQuit = vi.fn(() => false)
    const gate = createManagedQuitGate(quit, 250, canQuit)

    const result = gate.schedule()
    vi.advanceTimersByTime(250)

    expect(canQuit).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(false)
  })

  it('releases the single-instance lock before quitting', () => {
    const order: string[] = []

    quitSingleInstance({
      releaseSingleInstanceLock: () => { order.push('release') },
      quit: () => { order.push('quit') },
    })

    expect(order).toEqual(['release', 'quit'])
  })
})
