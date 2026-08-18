/** Stable renderer and model boundary shared by every presentation host. */

import type { PetDisposable } from './disposable.ts'
import type {
  PetIntent,
  PetIntentSpeech,
} from '../core/intent.ts'
import type { PetAssetResolver, PetModelDescriptor } from './model.ts'
import type { PetErrorCode } from '../errors.ts'

export { PET_MODEL_SCHEMA_VERSION } from './model.ts'
export type {
  PetAssetRef,
  PetAssetResolver,
  PetModelDescriptor,
  PetModelSourceKind,
} from './model.ts'

export const PET_RENDERER_API_VERSION = 1 as const

export type PetRendererKind = 'sprite2d' | 'live2d' | 'model3d'
export type PetRenderQuality = 'low' | 'balanced' | 'high'

export interface PetRendererCapabilities {
  expressions: boolean
  motions: boolean
  lookAt: boolean
  lipSync: boolean
  hitAreas: boolean
  transparentBackground: boolean
}

export interface PetRendererDescriptor {
  apiVersion: typeof PET_RENDERER_API_VERSION
  id: string
  displayName: string
  kind: PetRendererKind
  version: string
  capabilities: PetRendererCapabilities
  supportedModelFormats: readonly string[]
}

export interface PetRenderSurface {
  element: HTMLElement
  width: number
  height: number
  devicePixelRatio: number
}

export interface PetRenderSize {
  width: number
  height: number
  devicePixelRatio: number
}

export interface PetRendererEvents {
  ready: { rendererId: string, modelId: string }
  motionComplete: { intentId: string }
  hit: { area?: string, x: number, y: number }
  error: { code: PetErrorCode, recoverable: boolean, message: string }
  contextLost: Record<never, never>
}

export interface PetRendererCreateContext {
  signal: AbortSignal
  emit<K extends keyof PetRendererEvents>(type: K, event: PetRendererEvents[K]): void
}

export interface PetRenderer {
  readonly descriptor: PetRendererDescriptor
  mount(surface: PetRenderSurface): Promise<void>
  loadModel(model: PetModelDescriptor, assets: PetAssetResolver): Promise<void>
  applyIntent(intent: PetIntent): void | Promise<void>
  applySpeech?(speech: PetIntentSpeech): void | Promise<void>
  resize(size: PetRenderSize): void
  setVisible(visible: boolean): void
  setQuality(quality: PetRenderQuality): void
  dispose(): void | Promise<void>
}

export interface PetRendererProvider {
  readonly descriptor: PetRendererDescriptor
  create(context: PetRendererCreateContext): Promise<PetRenderer>
}

export interface PetRendererRegistryContract {
  register(provider: PetRendererProvider): PetDisposable
  get(id: string): PetRendererProvider | undefined
  list(): readonly PetRendererDescriptor[]
  supports(rendererId: string, model: PetModelDescriptor): boolean
}
