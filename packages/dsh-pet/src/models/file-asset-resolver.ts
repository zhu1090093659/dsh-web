import { readFile } from 'node:fs/promises'

import type { PetAssetRef, PetAssetResolver } from '../contracts/model.ts'
import type { PetModelCatalog } from './catalog.ts'

/** Host-side resolver; Renderer instances still receive bytes, never paths. */
export class FilePetAssetResolver implements PetAssetResolver {
  constructor(private readonly catalog: PetModelCatalog) {}

  async fetch(asset: PetAssetRef, signal?: AbortSignal): Promise<ArrayBuffer> {
    signal?.throwIfAborted()
    const path = await this.catalog.assetPath(asset.modelId, asset.path)
    if (path === undefined) throw new Error(`Unknown pet model asset: ${asset.modelId}/${asset.path}`)
    const bytes = await readFile(path, { signal })
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
}
