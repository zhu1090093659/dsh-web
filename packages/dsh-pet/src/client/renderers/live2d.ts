/**
 * Live2D renderer (pet-center M3, issue #623) — mounts a Cubism model into
 * the center-owned container through the lazy vendor stack. The mount call
 * itself is synchronous per the renderer contract: the boot (core script →
 * vendor script → pixi → model) continues asynchronously and reports fatal
 * failures through the handle's error sink, so the React bridge can render
 * localized guidance. Disposing mid-boot is race-safe.
 *
 * Interaction model: the center chrome owns the affinity economy (its click
 * handler fires the pet interaction exactly like sprite2d); this renderer's
 * 'tap' affordance only drives the model's hit-area motion feedback. The
 * contract's interact write-back stays available for future standalone
 * mounts and is intentionally not invoked here.
 *
 * Motion mapping: manifests map ActivityPhases to motion GROUP names; every
 * unmapped phase (and any mapped-but-absent group) falls back to the idle
 * group — official sample models only ship Idle/TapBody, so the fallback is
 * mandatory. Groups with multiple motions pick a random entry, and a tap
 * that hits a declared hit area plays the conventional 'TapBody' group,
 * returning to the phase's group when the tap motion finishes.
 * @module @linxin666/dsh-pet/client/renderers/live2d
 */

import type { ActivityPhase } from '../../state.ts'
import {
  PET_RENDERER_API_VERSION,
  type PetRenderer,
  type PetRendererContext,
  type PetRendererHandle,
} from '../../contracts/renderer.ts'
import {
  ensureCubismCore,
  ensureLive2dVendor,
  type Live2dVendor,
  type Live2dVendorApp,
  type Live2dVendorModel,
} from './live2d/runtime.ts'

/** Renderer config: the client-visible live2d block (fail-closed validated). */
export interface PetLive2dConfig {
  modelUrl: string
  scale?: number
  translate?: { x?: number; y?: number }
  motions: Partial<Record<ActivityPhase, string>> & { idle: string }
  expressions?: Partial<Record<ActivityPhase, string>>
  hitAreas?: string[]
}

/** Fatal mount failure codes the bridge localizes. */
export type Live2dErrorCode = 'core-missing' | 'vendor-missing' | 'load-failed'

/** The live2d activation handle: contract dispose plus tap + error sink. */
export interface Live2dRendererHandle extends PetRendererHandle {
  /** Forward a chrome tap in container coordinates; plays the hit motion. */
  tap(x: number, y: number): void
  /** Subscribe to fatal mount errors (at most one fires per activation). */
  onError(listener: (code: Live2dErrorCode) => void): void
}

/** The de-facto tap-motion group of Cubism sample models. */
const TAP_GROUP = 'TapBody'

/**
 * Keep one screen-appropriate atlas LOD instead of asking Pixi for the
 * engine's default full mip chain. A user model can legitimately carry an
 * 8192px texture while the pet itself is only a few hundred pixels tall;
 * `single-auto` preserves the source for larger renders and generates one
 * downsampled atlas only when the effective on-screen scale warrants it.
 */
const TEXTURE_OPTIONS = { lod: 'single-auto' } as const
/** Recursively release the activation without invalidating shared texture caches. */
const DESTROY_OPTIONS = { children: true } as const
/** Remove only this activation's canvas; `true` would release Pixi globals. */
const RENDERER_DESTROY_OPTIONS = { removeView: true } as const

let vendorConfigured = false

/** Configure pixi extensions + the Cubism SDK once per page. */
function configureOnce(vendor: Live2dVendor): void {
  if (vendorConfigured) return
  vendorConfigured = true
  vendor.extensions.add(vendor.Live2DPlugin)
  vendor.configureCubismSDK({ memorySizeMB: 32 })
}

/** Reset module state (tests). */
export function resetLive2dRenderer(): void {
  vendorConfigured = false
}

/** Fail-closed config validation (contract: unknown manifest block in). */
function validateLive2dConfig(config: unknown): PetLive2dConfig {
  if (typeof config !== 'object' || config === null) throw new Error('live2d config is not an object')
  const source = config as Record<string, unknown>
  if (typeof source.modelUrl !== 'string' || source.modelUrl === '') throw new Error('live2d config modelUrl is required')
  const motions = source.motions
  if (typeof motions !== 'object' || motions === null || typeof (motions as Record<string, unknown>).idle !== 'string') {
    throw new Error('live2d config motions.idle is required')
  }
  return config as PetLive2dConfig
}

/** The live2d renderer implementation. */
export const live2dRenderer: PetRenderer<PetLive2dConfig> = {
  id: 'live2d',
  apiVersion: PET_RENDERER_API_VERSION,
  validateConfig: validateLive2dConfig,
  mount(ctx: PetRendererContext, config: PetLive2dConfig): Live2dRendererHandle {
    let disposed = false
    let app: Live2dVendorApp | undefined
    let model: Live2dVendorModel | undefined
    let modelAttached = false
    let errorListener: ((code: Live2dErrorCode) => void) | undefined
    let unsubscribe: (() => void) | undefined
    /** The motion group the current phase maps to (resume target after taps). */
    let phaseGroup: string = config.motions.idle
    let tapPlaying = false

    /** Release every resource currently owned by this activation exactly once. */
    const destroyResources = (): void => {
      unsubscribe?.()
      unsubscribe = undefined
      const currentApp = app
      const currentModel = model
      const modelOwnedByApp = currentApp !== undefined && modelAttached
      app = undefined
      model = undefined
      modelAttached = false
      try {
        if (currentModel !== undefined && !modelOwnedByApp) currentModel.destroy(DESTROY_OPTIONS)
      } finally {
        currentApp?.destroy(RENDERER_DESTROY_OPTIONS, DESTROY_OPTIONS)
      }
    }

    const playGroup = (group: string): void => {
      if (model === undefined) return
      const groups = model.internalModel.settings.motions ?? {}
      const count = Array.isArray(groups[group]) ? groups[group]!.length : 0
      if (count === 0) {
        // A mapped-but-absent group falls back to idle (never blank motion).
        if (group !== config.motions.idle) playGroup(config.motions.idle)
        return
      }
      const index = count > 1 ? Math.floor(Math.random() * count) : 0
      void model.motion(group, index)
    }

    const applyPhase = (phase: ActivityPhase): void => {
      phaseGroup = config.motions[phase] ?? config.motions.idle
      playGroup(phaseGroup)
      const expression = config.expressions?.[phase]
      if (expression !== undefined && model !== undefined) void model.expression(expression)
    }

    const boot = async (): Promise<void> => {
      if (!await ensureCubismCore()) {
        if (!disposed) errorListener?.('core-missing')
        return
      }
      const vendor = await ensureLive2dVendor()
      if (vendor === undefined) {
        if (!disposed) errorListener?.('vendor-missing')
        return
      }
      configureOnce(vendor)
      const pixiApp = new vendor.Application()
      try {
        await pixiApp.init({
          width: Math.max(1, ctx.container.clientWidth || 160),
          height: Math.max(1, ctx.container.clientHeight || 174),
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          preference: 'webgl',
        })
      } catch (error) {
        // init() can fail after allocating a partial renderer; cleanup is
        // best-effort because Pixi may not consider that partial app ready.
        try { pixiApp.destroy(RENDERER_DESTROY_OPTIONS, DESTROY_OPTIONS) } catch {}
        throw error
      }
      if (disposed) {
        pixiApp.destroy(RENDERER_DESTROY_OPTIONS, DESTROY_OPTIONS)
        return
      }
      app = pixiApp
      pixiApp.canvas.style.display = 'block'
      pixiApp.canvas.style.width = '100%'
      pixiApp.canvas.style.height = '100%'
      ctx.container.appendChild(pixiApp.canvas)
      // Keep a model that rejects during setup off Ticker.shared; from()
      // does not expose that partial instance to callers for disposal.
      const loaded = await vendor.Live2DModel.from(config.modelUrl, {
        autoUpdate: false,
        autoHitTest: false,
        autoFocus: false,
        textureOptions: TEXTURE_OPTIONS,
      })
      model = loaded
      if (disposed) {
        destroyResources()
        return
      }
      // Auto-fit the model into the container; the manifest scale multiplies
      // the fit and translate offsets from the center anchor.
      const fit = Math.min(
        pixiApp.renderer.width / Math.max(1, loaded.width),
        pixiApp.renderer.height / Math.max(1, loaded.height),
      ) * 0.92
      loaded.scale.set(fit * (config.scale ?? 1))
      loaded.anchor.set(0.5)
      loaded.position.set(
        pixiApp.renderer.width / 2 + (config.translate?.x ?? 0),
        pixiApp.renderer.height / 2 + (config.translate?.y ?? 0),
      )
      pixiApp.stage.addChild(loaded)
      modelAttached = true
      loaded.automator.autoUpdate = true
      // Resume the phase group once a tap motion finishes playing.
      loaded.on('motionFinish', () => {
        if (tapPlaying) {
          tapPlaying = false
          playGroup(phaseGroup)
        }
      })
      applyPhase(ctx.phase.get())
      unsubscribe = ctx.phase.subscribe(applyPhase)
    }

    void boot().catch(() => {
      try {
        destroyResources()
      } finally {
        if (!disposed) errorListener?.('load-failed')
      }
    })

    return {
      dispose() {
        if (disposed) return
        disposed = true
        destroyResources()
      },
      tap(x: number, y: number) {
        const current = model
        if (disposed || current === undefined) return
        const hits = current.hitTest(x, y)
        const allowed = config.hitAreas
        const hit = allowed === undefined ? hits.length > 0 : hits.some(name => allowed.includes(name))
        if (!hit) return
        const groups = current.internalModel.settings.motions ?? {}
        const group = groups[TAP_GROUP]
        if (!Array.isArray(group) || group.length === 0) return
        tapPlaying = true
        const index = group.length > 1 ? Math.floor(Math.random() * group.length) : 0
        void current.motion(TAP_GROUP, index)
      },
      onError(listener: (code: Live2dErrorCode) => void) {
        errorListener = listener
      },
    }
  },
}
