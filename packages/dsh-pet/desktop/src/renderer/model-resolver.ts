import type { PetAssetResolver } from '../../../src/contracts/model.ts'
import type { PetResolvedModel } from '../../../src/renderers/runtime.ts'
import type { PetModelSummary } from '../shared/desktop-api.ts'
import builtinSpriteUrl from '../../../assets/whale/spritesheet.webp'

export const BUILTIN_SPRITE_RENDERER_ID = 'builtin:sprite2d'
export const BUILTIN_WHALE_MODEL_ID = 'builtin:whale'

/** Resolve one transport model without exposing a filesystem path to Renderer code. */
export function resolveDesktopModel(model: PetModelSummary): PetResolvedModel {
  const assetUrl = model.assetUrl ?? builtinSpriteUrl
  const assets: PetAssetResolver = {
    fetch: async (asset, signal) => {
      if (asset.modelId !== model.id || asset.path !== model.entry) {
        throw new Error(`Unknown pet model asset: ${asset.modelId}/${asset.path}`)
      }
      const response = await fetch(assetUrl, { signal })
      if (!response.ok) throw new Error(`Pet model asset request failed: ${response.status}`)
      return await response.arrayBuffer()
    },
    createObjectUrl: async (asset) => {
      if (asset.modelId !== model.id || asset.path !== model.entry) {
        throw new Error(`Unknown pet model asset: ${asset.modelId}/${asset.path}`)
      }
      return assetUrl
    },
    // The catalog, custom scheme, or Vite owns these URLs.
    revokeObjectUrl: () => {},
  }
  return { descriptor: model, assets }
}

export function builtinWhaleModel(models: readonly PetModelSummary[]): PetModelSummary {
  const whale = models.find(model => model.id === BUILTIN_WHALE_MODEL_ID)
  if (whale === undefined) throw new Error('Built-in whale model is unavailable')
  return whale
}
