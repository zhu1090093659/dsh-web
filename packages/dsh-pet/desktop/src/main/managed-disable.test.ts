import { describe, expect, it, vi } from 'vitest'

import { disableManagedDesktopPets, type ManagedDesktopSettingsWriter } from './managed-disable.ts'

function writer(enabled = false): ManagedDesktopSettingsWriter {
  return {
    setCompanionSettings: vi.fn(async () => ({ enabled })),
    setCompanionSettingsForConnection: vi.fn(async () => ({ enabled })),
  }
}

describe('managed desktop disable', () => {
  it('uses the active connection for an unmanaged launch', async () => {
    const client = writer()

    await expect(disableManagedDesktopPets(client, [])).resolves.toBeUndefined()

    expect(client.setCompanionSettings).toHaveBeenCalledOnce()
    expect(client.setCompanionSettingsForConnection).not.toHaveBeenCalled()
  })

  it('disables every distinct Host while deduplicating plugin sources', async () => {
    const client = writer()
    const tokenA = 'a'.repeat(43)
    const tokenB = 'b'.repeat(43)

    await disableManagedDesktopPets(client, [
      { origin: 'http://127.0.0.1:3080', nativeToken: tokenA },
      { origin: 'http://127.0.0.1:3080', nativeToken: tokenA },
      { origin: 'http://127.0.0.1:4080', nativeToken: tokenB },
    ])

    expect(client.setCompanionSettingsForConnection).toHaveBeenCalledTimes(2)
    expect(client.setCompanionSettingsForConnection).toHaveBeenCalledWith(
      'http://127.0.0.1:3080',
      tokenA,
      { enabled: false },
    )
    expect(client.setCompanionSettingsForConnection).toHaveBeenCalledWith(
      'http://127.0.0.1:4080',
      tokenB,
      { enabled: false },
    )
  })

  it('fails closed before writing when any registration lacks credentials', async () => {
    const client = writer()

    await expect(disableManagedDesktopPets(client, [
      { origin: 'http://127.0.0.1:3080', nativeToken: 'a'.repeat(43) },
      { origin: 'http://127.0.0.1:4080' },
    ])).rejects.toThrow('missing authentication')
    expect(client.setCompanionSettingsForConnection).not.toHaveBeenCalled()
  })

  it('refuses to exit when a Host reports that it remains enabled', async () => {
    const client = writer(true)

    await expect(disableManagedDesktopPets(client, [
      { origin: 'http://127.0.0.1:3080', nativeToken: 'a'.repeat(43) },
    ])).rejects.toThrow('remained enabled')
  })
})
