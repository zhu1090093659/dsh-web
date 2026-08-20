/**
 * Renderer contract — the seam between the pet center and its renderers
 * (issue #623, milestone M2 P4). Renderers never see the DSH session, the
 * registry, or the network: they receive exactly three capabilities — an
 * asset base URL, the ActivityPhase stream, and the interaction write-back —
 * inside a center-owned container. Every mount is a fresh activation whose
 * cleanups must be idempotent.
 *
 * This contract only serves real consumers: sprite2d (existing) and live2d
 * (M3). Speculative capabilities join only when a renderer actually needs
 * them.
 * @module @linxin666/dsh-pet/contracts/renderer
 */

import type { ActivityPhase } from '../state.ts'

/** Contract version renderers declare against (independent of the manifest). */
export const PET_RENDERER_API_VERSION = 'x-org.linxin666.pet-center/v1alpha1'

/** What the pet center hands a renderer on mount. */
export interface PetRendererContext {
  /** The selected pet's id. */
  readonly petId: string
  /** Same-origin URL prefix of this pet's assets ('/pet/<id>'). */
  readonly assetBase: string
  /** Center-owned mount root; renderers must not attach to document.body. */
  readonly container: HTMLElement
  /** The ActivityPhase stream (pet-center owned; renderers subscribe). */
  readonly phase: {
    get(): ActivityPhase
    subscribe(listener: (phase: ActivityPhase) => void): () => void
  }
  /** The single interaction write-back into the affinity economy. */
  readonly interact: (kind: 'tap') => void
  /** Register an activation-scoped cleanup; run on dispose, idempotently. */
  onCleanup(fn: () => void): void
}

/** A mounted renderer activation. */
export interface PetRendererHandle {
  /** Tear the activation down; may be called 0/1/N times. */
  dispose(): void
}

/**
 * One renderer implementation. validateConfig is fail-closed over the
 * renderer-specific manifest block (schema v2 'sprite2d'/'live2d' blocks).
 */
export interface PetRenderer<Config = unknown> {
  readonly id: string
  readonly apiVersion: string
  validateConfig(config: unknown): Config
  mount(ctx: PetRendererContext, config: Config): PetRendererHandle
}
