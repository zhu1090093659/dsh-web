import { describe, expect, it } from 'vitest'
import { inject, makePetSettingsSchema } from './index.ts'

it('keeps the pet core loadable without a WebServer', () => {
  expect(inject).toEqual([])
})

describe('makePetSettingsSchema', () => {
  it('resolves the selected pet and display defaults from an empty section', () => {
    const schema = makePetSettingsSchema('whale-girl')
    expect(schema({})).toMatchObject({
      petId: 'whale-girl',
      visible: true,
      size: 160,
      right: 24,
      bottom: 20,
      enabled: true,
      desktopEnabled: false,
      desktopVisible: true,
      desktopAlwaysOnTop: true,
      desktopLocked: false,
      desktopScale: 1,
    })
  })

  it('accepts any petId string so a removed pet cannot brick the namespace', () => {
    // The service clamps the value against the registry; the schema must
    // never reject a stale stored selection outright.
    const schema = makePetSettingsSchema('whale-girl')
    expect(schema({ petId: 'dragon' }).petId).toBe('dragon')
  })
})
