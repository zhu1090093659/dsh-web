import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { PET_MODEL_SCHEMA_VERSION } from '../contracts/model.ts'
import {
  modelDescriptorToManifest,
  parsePetDexManifest,
  parsePetModelDescriptor,
  parsePetModelManifest,
  petDexToModelDescriptor,
} from './descriptor.ts'

describe('Pet Model Descriptor V1', () => {
  it('adapts frozen PetDex V1 and V2 without changing their files', async () => {
    const fixtureRoot = new URL('../../tests/fixtures/', import.meta.url)
    const v1 = parsePetDexManifest(JSON.parse(await readFile(new URL('petdex-v1/pet.json', fixtureRoot), 'utf8')))
    const v2 = parsePetDexManifest(JSON.parse(await readFile(new URL('petdex-v2/pet.json', fixtureRoot), 'utf8')))

    expect(petDexToModelDescriptor(v1)).toMatchObject({
      schemaVersion: 1,
      id: 'local:fixture-v1',
      rendererId: 'builtin:sprite2d',
      format: 'petdex-v1',
      entry: 'spritesheet.webp',
    })
    expect(petDexToModelDescriptor(v2, 'imported')).toMatchObject({
      id: 'imported:fixture-v2',
      format: 'petdex-v2',
    })
  })

  it('round-trips one declarative pet-model.json manifest and runtime source', () => {
    const descriptor = petDexToModelDescriptor({
      id: 'lian',
      displayName: '小狮子',
      description: 'Test',
      spritesheetPath: 'spritesheet.webp',
      spriteVersionNumber: 2,
    })
    const manifest = modelDescriptorToManifest(descriptor, 'lian')

    expect(parsePetModelManifest(manifest)).toEqual(manifest)
    expect(parsePetModelDescriptor({ ...manifest, id: 'local:lian', source: { kind: 'local' } })).toEqual({
      ...manifest,
      id: 'local:lian',
      source: { kind: 'local' },
    })
  })

  it('rejects executable, remote, escaping, and unversioned model entries', () => {
    const safe = modelDescriptorToManifest(petDexToModelDescriptor({
      id: 'safe', displayName: 'Safe', description: '', spritesheetPath: 'sprite.webp', spriteVersionNumber: 1,
    }), 'safe')

    expect(() => parsePetModelManifest({ ...safe, entry: '../pet.js' })).toThrow('entry')
    expect(() => parsePetModelManifest({ ...safe, entry: 'https://example.com/model.webp' })).toThrow('entry')
    expect(() => parsePetModelManifest({ ...safe, entry: 'run.ps1' })).toThrow('仅允许')
    expect(() => parsePetModelManifest({ ...safe, schemaVersion: 2 })).toThrow('schemaVersion')
    expect(PET_MODEL_SCHEMA_VERSION).toBe(1)
  })
})
