import type { PetIntent } from '../core/intent.ts'
import type {
  PetAssetResolver,
  PetModelDescriptor,
  PetRenderer,
  PetRendererEvents,
  PetRendererRegistryContract,
  PetRenderQuality,
  PetRenderSize,
  PetRenderSurface,
} from '../contracts/renderer.ts'
import { PET_ERROR_CODES, type PetErrorCode } from '../errors.ts'

export interface PetResolvedModel {
  descriptor: PetModelDescriptor
  assets: PetAssetResolver
}

export interface PetRendererSelection extends PetResolvedModel {
  rendererId: string
}

export interface PetRendererRuntimeOptions {
  resolveModel(modelId: string): Promise<PetResolvedModel | undefined> | PetResolvedModel | undefined
  fallbackSelections?(failed: PetRendererSelection): Promise<readonly PetRendererSelection[]> | readonly PetRendererSelection[]
  onEvent?<K extends keyof PetRendererEvents>(type: K, event: PetRendererEvents[K]): void
}

interface ActiveRenderer {
  renderer: PetRenderer
  controller: AbortController
  selection: PetRendererSelection
  token: object
  contextRecoveryQueued: boolean
  lastSpeechId?: string
}

/** Owns exactly one renderer instance and serializes every model/renderer switch. */
export class PetRendererRuntime {
  readonly #registry: PetRendererRegistryContract
  readonly #surface: PetRenderSurface
  readonly #options: PetRendererRuntimeOptions
  #active?: ActiveRenderer
  #selectedModelId?: string
  #selectedRendererId?: string
  #intent?: PetIntent
  #visible = true
  #quality: PetRenderQuality = 'balanced'
  #size: PetRenderSize
  #queue: Promise<void> = Promise.resolve()
  #disposed = false
  #contextRecoveryKey?: string
  #contextRecoveryAttempts = 0

  constructor(
    registry: PetRendererRegistryContract,
    surface: PetRenderSurface,
    options: PetRendererRuntimeOptions,
  ) {
    this.#registry = registry
    this.#surface = surface
    this.#options = options
    this.#size = {
      width: surface.width,
      height: surface.height,
      devicePixelRatio: surface.devicePixelRatio,
    }
  }

  get descriptor() {
    return this.#active?.renderer.descriptor
  }

  selectRenderer(rendererId: string): Promise<void> {
    this.#selectedRendererId = rendererId
    this.#resetContextRecovery()
    return this.#enqueueReconcile()
  }

  selectModel(modelId: string): Promise<void> {
    this.#selectedModelId = modelId
    this.#resetContextRecovery()
    return this.#enqueueReconcile()
  }

  async applyIntent(intent: PetIntent): Promise<void> {
    this.#intent = intent
    const active = this.#active
    if (active === undefined) return
    await active.renderer.applyIntent(intent)
    if (intent.speech !== undefined
      && intent.speech.id !== active.lastSpeechId
      && active.renderer.applySpeech !== undefined) {
      await active.renderer.applySpeech(intent.speech)
      active.lastSpeechId = intent.speech.id
    }
  }

  setVisible(visible: boolean): void {
    this.#visible = visible
    this.#active?.renderer.setVisible(visible)
  }

  setQuality(quality: PetRenderQuality): void {
    this.#quality = quality
    this.#active?.renderer.setQuality(quality)
  }

  resize(size: PetRenderSize): void {
    this.#size = { ...size }
    this.#active?.renderer.resize(this.#size)
  }

  dispose(): Promise<void> {
    this.#disposed = true
    const operation = this.#queue.then(() => this.#disposeActive())
    this.#queue = operation.catch(() => {})
    return operation
  }

  #enqueueReconcile(): Promise<void> {
    if (this.#disposed) return Promise.reject(new Error('Renderer runtime is disposed'))
    const operation = this.#queue.then(() => this.#reconcile())
    // A failed selection must not poison later recovery attempts.
    this.#queue = operation.catch(() => {})
    return operation
  }

  async #reconcile(): Promise<void> {
    const modelId = this.#selectedModelId
    if (modelId === undefined) return
    const resolved = await this.#options.resolveModel(modelId)
    if (resolved === undefined) throw new Error(`Unknown pet model: ${modelId}`)
    const target: PetRendererSelection = {
      rendererId: this.#selectedRendererId ?? resolved.descriptor.rendererId,
      ...resolved,
    }
    const fallbacks = await this.#options.fallbackSelections?.(target) ?? []
    const selections = [target, ...fallbacks].filter((selection, index, all) =>
      all.findIndex(candidate => candidate.rendererId === selection.rendererId
        && candidate.descriptor.id === selection.descriptor.id) === index)

    await this.#disposeActive()
    const errors: unknown[] = []
    for (const selection of selections) {
      try {
        this.#active = await this.#create(selection)
        return
      } catch (error) {
        errors.push(error)
        this.#emitError(PET_ERROR_CODES.rendererLoadFailed, error)
      }
    }
    this.#emitError(PET_ERROR_CODES.rendererNotFound, new Error(`No renderer could load model ${modelId}`), false)
    throw new AggregateError(errors, `No renderer could load model ${modelId}`)
  }

  async #create(selection: PetRendererSelection): Promise<ActiveRenderer> {
    const provider = this.#registry.get(selection.rendererId)
    if (provider === undefined) throw new Error(`Unknown renderer: ${selection.rendererId}`)
    if (!this.#registry.supports(selection.rendererId, selection.descriptor)) {
      throw new Error(`Renderer ${selection.rendererId} does not support ${selection.descriptor.format}`)
    }
    const controller = new AbortController()
    const token = {}
    let renderer: PetRenderer | undefined
    try {
      renderer = await provider.create({
        signal: controller.signal,
        emit: (type, event) => this.#handleProviderEvent(token, type, event),
      })
      if (renderer.descriptor.id !== provider.descriptor.id) {
        throw new Error(`Renderer instance id mismatch: ${renderer.descriptor.id}`)
      }
      await renderer.mount(this.#surface)
      await renderer.loadModel(selection.descriptor, selection.assets)
      renderer.resize(this.#size)
      renderer.setQuality(this.#quality)
      renderer.setVisible(this.#visible)
      const active: ActiveRenderer = {
        renderer,
        controller,
        selection,
        token,
        contextRecoveryQueued: false,
      }
      if (this.#intent !== undefined) {
        await renderer.applyIntent(this.#intent)
        if (this.#intent.speech !== undefined && renderer.applySpeech !== undefined) {
          await renderer.applySpeech(this.#intent.speech)
          active.lastSpeechId = this.#intent.speech.id
        }
      }
      return active
    } catch (error) {
      controller.abort()
      if (renderer !== undefined) await renderer.dispose()
      throw error
    }
  }

  async #disposeActive(): Promise<void> {
    const active = this.#active
    this.#active = undefined
    if (active === undefined) return
    active.controller.abort()
    await active.renderer.dispose()
  }

  #handleProviderEvent<K extends keyof PetRendererEvents>(
    token: object,
    type: K,
    event: PetRendererEvents[K],
  ): void {
    this.#options.onEvent?.(type, event)
    if (type !== 'contextLost' || this.#disposed) return
    const active = this.#active
    if (active === undefined || active.token !== token || active.contextRecoveryQueued) return
    active.contextRecoveryQueued = true
    const key = `${active.selection.rendererId}\0${active.selection.descriptor.id}`
    if (this.#contextRecoveryKey !== key) {
      this.#contextRecoveryKey = key
      this.#contextRecoveryAttempts = 0
    }
    this.#contextRecoveryAttempts += 1
    const retrySameSelection = this.#contextRecoveryAttempts === 1
    this.#emitError(
      PET_ERROR_CODES.rendererContextLost,
      new Error(`Renderer context lost: ${active.selection.rendererId}`),
    )
    const operation = this.#queue.then(() => this.#recoverContext(active, retrySameSelection))
    this.#queue = operation.catch(() => {})
    void operation.catch(error => {
      this.#emitError(PET_ERROR_CODES.rendererLoadFailed, error, false)
    })
  }

  async #recoverContext(failed: ActiveRenderer, retrySameSelection: boolean): Promise<void> {
    if (this.#disposed || this.#active !== failed) return
    const fallbacks = await this.#options.fallbackSelections?.(failed.selection) ?? []
    const selections = [
      ...(retrySameSelection ? [failed.selection] : []),
      ...fallbacks,
    ].filter((selection, index, all) => all.findIndex(candidate => (
      candidate.rendererId === selection.rendererId
      && candidate.descriptor.id === selection.descriptor.id
    )) === index)
    await this.#disposeActive()
    const errors: unknown[] = []
    for (const selection of selections) {
      try {
        this.#active = await this.#create(selection)
        return
      } catch (error) {
        errors.push(error)
        this.#emitError(PET_ERROR_CODES.rendererLoadFailed, error)
      }
    }
    throw new AggregateError(errors, 'Renderer context recovery failed')
  }

  #resetContextRecovery(): void {
    this.#contextRecoveryKey = undefined
    this.#contextRecoveryAttempts = 0
  }

  #emitError(code: PetErrorCode, error: unknown, recoverable = true): void {
    this.#options.onEvent?.('error', {
      code,
      recoverable,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
