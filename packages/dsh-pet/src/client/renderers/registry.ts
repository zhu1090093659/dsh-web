/**
 * Renderer registry — dispatches a manifest's renderer kind to its
 * implementation (pet-center M2 P4, issue #623). Unknown kinds never blank
 * the pet: a fallback card names the problem and reports the kinds this
 * build actually supports.
 * @module @linxin666/dsh-pet/client/renderers/registry
 */

import type { PetRenderer, PetRendererContext, PetRendererHandle } from '../../contracts/renderer.ts'

/** Renderer dispatch table. */
export class RendererRegistry {
  private readonly renderers = new Map<string, PetRenderer>()

  /** Register one renderer implementation (id wins on re-register). */
  register(renderer: PetRenderer): void {
    this.renderers.set(renderer.id, renderer)
  }

  /** Whether a renderer kind is available in this build. */
  has(id: string): boolean {
    return this.renderers.has(id)
  }

  /** The registered renderer kinds (for diagnostics). */
  kinds(): string[] {
    return [...this.renderers.keys()].sort()
  }

  /** Remove every registration (tests; the client index registers once). */
  clear(): void {
    this.renderers.clear()
  }

  /**
   * Mount a renderer for one activation. An unknown kind renders a clear
   * diagnostic card into the container instead of failing silently.
   */
  mount(kind: string, ctx: PetRendererContext, config: unknown): PetRendererHandle {
    const renderer = this.renderers.get(kind)
    if (renderer === undefined) {
      const note = document.createElement('div')
      note.dataset.dshPetRendererFallback = kind
      note.textContent = 'Pet renderer "' + kind + '" is not available in this build (supported: ' + this.kinds().join(', ') + ').'
      ctx.container.appendChild(note)
      ctx.onCleanup(() => note.remove())
      return { dispose: () => note.remove() }
    }
    return renderer.mount(ctx, renderer.validateConfig(config))
  }
}

/**
 * The plugin-wide renderer registry. The client entry registers the
 * built-in renderers at apply time; the renderer switch and the live2d
 * bridge dispatch through this instance.
 */
export const defaultPetRendererRegistry = new RendererRegistry()
