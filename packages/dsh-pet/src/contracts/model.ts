/** Stable, renderer-neutral model and asset boundary. */

import type { PetExpression, PetMotion } from '../core/intent.ts'

export const PET_MODEL_SCHEMA_VERSION = 1 as const

export type PetModelSourceKind = 'builtin' | 'local' | 'imported' | 'extension'

export interface PetModelDescriptor {
  schemaVersion: typeof PET_MODEL_SCHEMA_VERSION
  id: string
  displayName: string
  description?: string
  rendererId: string
  format: string
  entry: string
  source: {
    kind: PetModelSourceKind
    providerId?: string
  }
  capabilities: {
    motions: PetMotion[]
    expressions: PetExpression[]
    lookAt: boolean
    lipSync: boolean
    hitAreas: string[]
  }
  bindings: {
    motions: Partial<Record<PetMotion, string | string[]>>
    expressions: Partial<Record<PetExpression, string>>
  }
  fallback: {
    motion: PetMotion
    expression: PetExpression
  }
  license?: {
    name?: string
    url?: string
    author?: string
  }
}

export interface PetAssetRef {
  modelId: string
  path: string
}

/** Renderers receive assets through this boundary and never read the filesystem. */
export interface PetAssetResolver {
  fetch(asset: PetAssetRef, signal?: AbortSignal): Promise<ArrayBuffer>
  createObjectUrl?(asset: PetAssetRef, signal?: AbortSignal): Promise<string>
  revokeObjectUrl?(url: string): void
}
