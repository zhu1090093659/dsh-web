import {
  PET_RENDERER_API_VERSION,
  type PetModelDescriptor,
  type PetRendererCreateContext,
  type PetRendererDescriptor,
  type PetRendererProvider,
  type PetRendererRegistryContract,
} from '../contracts/renderer.ts'
import type { PetDisposable } from '../contracts/disposable.ts'

const rendererIdPattern = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/

function validatedDescriptor(descriptor: PetRendererDescriptor): PetRendererDescriptor {
  if (descriptor.apiVersion !== PET_RENDERER_API_VERSION) {
    throw new Error(`Unsupported renderer API version: ${String(descriptor.apiVersion)}`)
  }
  if (!rendererIdPattern.test(descriptor.id)) {
    throw new Error(`Invalid renderer id: ${descriptor.id}`)
  }
  if (descriptor.displayName.trim() === '' || descriptor.version.trim() === '') {
    throw new Error(`Renderer ${descriptor.id} must declare a display name and version`)
  }
  if (descriptor.supportedModelFormats.length === 0) {
    throw new Error(`Renderer ${descriptor.id} must support at least one model format`)
  }
  if (descriptor.supportedModelFormats.some(format => format.trim() === '')) {
    throw new Error(`Renderer ${descriptor.id} contains an empty model format`)
  }
  return Object.freeze({
    ...descriptor,
    capabilities: Object.freeze({ ...descriptor.capabilities }),
    supportedModelFormats: Object.freeze([...new Set(descriptor.supportedModelFormats)]),
  })
}

/** Explicit allow-list registry. It never discovers or imports providers itself. */
export class PetRendererRegistry implements PetRendererRegistryContract {
  readonly #providers = new Map<string, PetRendererProvider>()

  register(provider: PetRendererProvider): PetDisposable {
    const descriptor = validatedDescriptor(provider.descriptor)
    if (this.#providers.has(descriptor.id)) {
      throw new Error(`Renderer already registered: ${descriptor.id}`)
    }
    const registered: PetRendererProvider = Object.freeze({
      descriptor,
      create: (context: PetRendererCreateContext) => provider.create(context),
    })
    this.#providers.set(descriptor.id, registered)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.#providers.get(descriptor.id) === registered) {
          this.#providers.delete(descriptor.id)
        }
      },
    }
  }

  get(id: string): PetRendererProvider | undefined {
    return this.#providers.get(id)
  }

  list(): readonly PetRendererDescriptor[] {
    return Object.freeze([...this.#providers.values()].map(provider => provider.descriptor))
  }

  supports(rendererId: string, model: PetModelDescriptor): boolean {
    const provider = this.#providers.get(rendererId)
    return provider !== undefined
      && model.rendererId === rendererId
      && provider.descriptor.supportedModelFormats.includes(model.format)
  }
}
