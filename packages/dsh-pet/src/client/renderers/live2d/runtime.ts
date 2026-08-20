/**
 * Live2D runtime loading (pet-center M3) — the two scripts a live2d mount
 * needs, fetched lazily through the plugin's own runtime route: the
 * user-supplied Cubism Core (proprietary; the plugin never bundles or
 * downloads it — issue #623 M1 §0) and the plugin-shipped MIT vendor bundle
 * (pixi.js + untitled-pixi-live2d-engine). Each loads at most once per page;
 * concurrent mounts share the in-flight promise, and a failure is cached as
 * 'absent' so a broken install stops retrying the network every mount.
 *
 * The vendor surface below is the structural slice the renderer consumes;
 * the real objects come from 'window.__dshPetLive2d' (lib/live2d-vendor.js),
 * so this module never imports pixi — the client bundle stays lean.
 * @module @linxin666/dsh-pet/client/renderers/live2d/runtime
 */

/** Runtime file URLs the host serves ('/api/pet/runtime/<name>', M3-2). */
const CORE_URL = '/api/pet/runtime/live2dcubismcore.min.js'
const VENDOR_URL = '/api/pet/runtime/live2d-vendor.js'

/** The pixi Application slice the renderer uses. */
export interface Live2dVendorApp {
  canvas: HTMLCanvasElement
  stage: { addChild(child: unknown): unknown }
  renderer: {
    readonly width: number
    readonly height: number
    resize(width: number, height: number): void
  }
  init(options: Record<string, unknown>): Promise<void>
  destroy(rendererOptions?: boolean | { removeView?: boolean; releaseGlobalResources?: boolean }, options?: Record<string, unknown>): void
}

/** The Live2DModel slice the renderer uses. */
export interface Live2dVendorModel {
  automator: { autoUpdate: boolean }
  anchor: { set(x: number, y?: number): void }
  position: { set(x: number, y: number): void }
  scale: { set(x: number, y?: number): void }
  readonly width: number
  readonly height: number
  internalModel: {
    settings: {
      motions?: Record<string, unknown[]>
      hitAreas?: readonly { Name?: string }[]
    }
  }
  motion(group: string, index?: number): Promise<unknown>
  expression(name?: string): unknown
  hitTest(x: number, y: number): string[]
  on(event: string, fn: () => void): unknown
  destroy(options?: { children?: boolean; texture?: boolean; baseTexture?: boolean }): void
}

/** The vendor bundle global (window.__dshPetLive2d). */
export interface Live2dVendor {
  Application: new () => Live2dVendorApp
  extensions: { add(...items: unknown[]): void }
  Live2DPlugin: unknown
  configureCubismSDK(options: Record<string, unknown>): void
  Live2DModel: { from(source: string, options?: Record<string, unknown>): Promise<Live2dVendorModel> }
}

declare global {
  interface Window {
    Live2DCubismCore?: unknown
    __dshPetLive2d?: Live2dVendor
  }
}

/** Injects one classic script tag; resolves on load, rejects on error. */
type ScriptInjector = (src: string) => Promise<void>

const defaultInjector: ScriptInjector = (src) => new Promise<void>((resolve, reject) => {
  const tag = document.createElement('script')
  tag.src = src
  tag.onload = () => resolve()
  tag.onerror = () => reject(new Error('script failed to load: ' + src))
  document.head.appendChild(tag)
})

/** Test seam: swap the network for a stub injector. */
export interface Live2dRuntimeProbe {
  inject?: ScriptInjector
}

let corePromise: Promise<boolean> | undefined
let vendorPromise: Promise<Live2dVendor | undefined> | undefined

/**
 * Ensure the Cubism Core global exists, injecting the runtime-route script
 * once when absent. Resolves false when the user has not installed the core
 * (a normal state — the renderer turns it into install guidance).
 */
export function ensureCubismCore(probe: Live2dRuntimeProbe = {}): Promise<boolean> {
  if (typeof window !== 'undefined' && window.Live2DCubismCore !== undefined) return Promise.resolve(true)
  if (probe.inject !== undefined) {
    return probe.inject(CORE_URL)
      .then(() => typeof window !== 'undefined' && window.Live2DCubismCore !== undefined)
      .catch(() => false)
  }
  corePromise ??= defaultInjector(CORE_URL)
    .then(() => typeof window !== 'undefined' && window.Live2DCubismCore !== undefined)
    .catch(() => false)
  return corePromise
}

/** Ensure the plugin vendor bundle global exists (same caching discipline). */
export function ensureLive2dVendor(probe: Live2dRuntimeProbe = {}): Promise<Live2dVendor | undefined> {
  if (typeof window !== 'undefined' && window.__dshPetLive2d !== undefined) return Promise.resolve(window.__dshPetLive2d)
  if (probe.inject !== undefined) {
    return probe.inject(VENDOR_URL)
      .then(() => typeof window !== 'undefined' ? window.__dshPetLive2d : undefined)
      .catch(() => undefined)
  }
  vendorPromise ??= defaultInjector(VENDOR_URL)
    .then(() => typeof window !== 'undefined' ? window.__dshPetLive2d : undefined)
    .catch(() => undefined)
  return vendorPromise
}

/** Reset the cached script promises (tests). */
export function resetLive2dRuntime(): void {
  corePromise = undefined
  vendorPromise = undefined
}
