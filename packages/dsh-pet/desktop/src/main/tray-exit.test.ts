import { describe, expect, it, vi } from 'vitest'

import { disableDesktopPetAndQuit } from './tray-exit.ts'

describe('tray exit', () => {
  it('persists the disabled setting before quitting', async () => {
    const order: string[] = []
    const disable = vi.fn(async () => { order.push('disable') })
    const quit = vi.fn(() => { order.push('quit') })

    await expect(disableDesktopPetAndQuit(disable, () => {
      quit()
      return true
    })).resolves.toBe('quitting')
    expect(order).toEqual(['disable', 'quit'])
  })

  it('reports a quit cancelled by a replacement managed registration', async () => {
    await expect(disableDesktopPetAndQuit(
      async () => undefined,
      async () => false,
    )).resolves.toBe('cancelled')
  })

  it('keeps the companion alive when Host settings cannot be updated', async () => {
    const quit = vi.fn(() => true)

    await expect(disableDesktopPetAndQuit(
      async () => { throw new Error('offline') },
      quit,
    )).resolves.toBe('disable-failed')
    expect(quit).not.toHaveBeenCalled()
  })
})
