import { describe, expect, it } from 'vitest'

import { BUILTIN_WHALE_MODEL } from '../../../src/models/builtin-whale.ts'
import { builtinWhaleModel, resolveDesktopModel } from './model-resolver.ts'

describe('desktop model resolver', () => {
  it('keeps the canonical descriptor and resolves only its declared entry', async () => {
    const model = { ...structuredClone(BUILTIN_WHALE_MODEL), assetUrl: 'dsh-pet-model://asset/whale/spritesheet.webp' }
    const resolved = resolveDesktopModel(model)

    expect(resolved.descriptor).toBe(model)
    await expect(resolved.assets.createObjectUrl?.({ modelId: model.id, path: model.entry })).resolves.toBe(model.assetUrl)
    await expect(resolved.assets.createObjectUrl?.({ modelId: model.id, path: '../secret' })).rejects.toThrow('Unknown')
  })

  it('requires the catalog-provided built-in fallback', () => {
    expect(builtinWhaleModel([structuredClone(BUILTIN_WHALE_MODEL)]).id).toBe('builtin:whale')
    expect(() => builtinWhaleModel([])).toThrow('unavailable')
  })
})
