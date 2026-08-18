import { createRoot, type Root } from 'react-dom/client'

import {
  PET_RENDERER_API_VERSION,
  type PetAssetResolver,
  type PetModelDescriptor,
  type PetRenderer,
  type PetRendererCreateContext,
  type PetRendererDescriptor,
  type PetRendererProvider,
  type PetRenderQuality,
  type PetRenderSize,
  type PetRenderSurface,
} from '../../../../src/contracts/renderer.ts'
import type { PetIntent } from '../../../../src/core/intent.ts'
import { SpritePet, type SpritePetModel } from '../SpritePet.tsx'
import {
  animationForPetIntent,
  TRACKS,
  type SpriteAnimation,
} from '../sprite-animation.ts'

export const SPRITE_RENDERER_DESCRIPTOR: PetRendererDescriptor = Object.freeze({
  apiVersion: PET_RENDERER_API_VERSION,
  id: 'builtin:sprite2d',
  displayName: 'Sprite 2D',
  kind: 'sprite2d',
  version: '1.0.0',
  capabilities: Object.freeze({
    expressions: false,
    motions: true,
    lookAt: false,
    lipSync: false,
    hitAreas: true,
    transparentBackground: true,
  }),
  supportedModelFormats: Object.freeze(['petdex-v1', 'petdex-v2', 'dsh-pet-model-v1']),
})

function isSpriteAnimation(value: string): value is SpriteAnimation {
  return Object.hasOwn(TRACKS, value)
}

function animationForModelIntent(intent: PetIntent, model: PetModelDescriptor | undefined): SpriteAnimation {
  const binding = model?.bindings.motions[intent.motion]
  const first = Array.isArray(binding) ? binding[0] : binding
  return first !== undefined && isSpriteAnimation(first)
    ? first
    : animationForPetIntent(intent)
}

class SpriteRenderer implements PetRenderer {
  readonly descriptor = SPRITE_RENDERER_DESCRIPTOR
  readonly #context: PetRendererCreateContext
  #root?: Root
  #surface?: PetRenderSurface
  #modelDescriptor?: PetModelDescriptor
  #model?: SpritePetModel
  #intent?: PetIntent
  #releaseModelUrl?: () => void
  #quality: PetRenderQuality = 'balanced'
  #visible = true

  constructor(context: PetRendererCreateContext) {
    this.#context = context
  }

  async mount(surface: PetRenderSurface): Promise<void> {
    if (this.#root !== undefined) throw new Error('Sprite renderer is already mounted')
    if (this.#context.signal.aborted) throw new Error('Sprite renderer creation was cancelled')
    this.#surface = surface
    this.#root = createRoot(surface.element)
    this.#render()
  }

  async loadModel(model: PetModelDescriptor, assets: PetAssetResolver): Promise<void> {
    this.#releaseModelUrl?.()
    this.#releaseModelUrl = undefined
    const asset = { modelId: model.id, path: model.entry }
    let assetUrl: string
    if (assets.createObjectUrl !== undefined) {
      assetUrl = await assets.createObjectUrl(asset, this.#context.signal)
      this.#releaseModelUrl = () => assets.revokeObjectUrl?.(assetUrl)
    } else {
      const bytes = await assets.fetch(asset, this.#context.signal)
      assetUrl = URL.createObjectURL(new Blob([bytes]))
      this.#releaseModelUrl = () => URL.revokeObjectURL(assetUrl)
    }
    this.#modelDescriptor = model
    this.#model = {
      id: model.id,
      spriteVersion: model.format === 'petdex-v2' ? 2 : 1,
      assetUrl,
    }
    this.#render()
    this.#context.emit('ready', { rendererId: this.descriptor.id, modelId: model.id })
  }

  applyIntent(intent: PetIntent): void {
    this.#intent = intent
    this.#render()
  }

  resize(size: PetRenderSize): void {
    if (this.#surface === undefined) return
    this.#surface.element.dataset.renderSize = `${String(size.width)}x${String(size.height)}@${String(size.devicePixelRatio)}`
  }

  setVisible(visible: boolean): void {
    if (this.#visible === visible) return
    this.#visible = visible
    if (this.#surface !== undefined) this.#surface.element.style.visibility = visible ? 'visible' : 'hidden'
    this.#render()
  }

  setQuality(quality: PetRenderQuality): void {
    this.#quality = quality
    if (this.#surface !== undefined) this.#surface.element.dataset.renderQuality = quality
  }

  dispose(): void {
    this.#releaseModelUrl?.()
    this.#releaseModelUrl = undefined
    this.#root?.unmount()
    this.#root = undefined
    this.#surface = undefined
    this.#model = undefined
    this.#modelDescriptor = undefined
    this.#intent = undefined
  }

  #render(): void {
    const animation = this.#intent === undefined
      ? 'idle'
      : animationForModelIntent(this.#intent, this.#modelDescriptor)
    this.#root?.render(
      <SpritePet
        animation={animation}
        visible={this.#visible}
        intentId={this.#intent?.id}
        model={this.#model}
      />,
    )
    if (this.#surface !== undefined) {
      this.#surface.element.dataset.renderQuality = this.#quality
      this.#surface.element.style.visibility = this.#visible ? 'visible' : 'hidden'
    }
  }
}

export const spriteRendererProvider: PetRendererProvider = Object.freeze({
  descriptor: SPRITE_RENDERER_DESCRIPTOR,
  create: async (context: PetRendererCreateContext) => new SpriteRenderer(context),
})
