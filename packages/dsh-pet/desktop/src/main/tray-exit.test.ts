import { describe, expect, it, vi } from 'vitest'

import { disableDesktopPetAndQuit } from './tray-exit.ts'

describe('tray exit', () => {
  it('persists the disabled setting before quitting', async () => {
    const order: string[] = []
    const disable = vi.fn(async () => { order.push('disable') })
    const quit = vi.fn(() => { order.push('quit') })

    await expect(disableDesktopPetAndQuit(disable, quit)).resolves.toBe(true)
    expect(order).toEqual(['disable', 'quit'])
  })

  it('keeps the companion alive when Host settings cannot be updated', async () => {
    const quit = vi.fn()

    await expect(disableDesktopPetAndQuit(
      async () => { throw new Error('offline') },
      quit,
    )).resolves.toBe(false)
    expect(quit).not.toHaveBeenCalled()
  })
})
