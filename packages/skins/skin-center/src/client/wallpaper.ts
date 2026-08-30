/**
 * Wallpaper layer controller for the skin center: renders the applied
 * Wallpaper Engine wallpaper behind the GUI and persists the selection
 * through the 'skin-wallpaper' settings namespace.
 *
 * Layers (fixed children of document.body, painted only while a wallpaper
 * is active):
 *   - media layer  z-index:-3  video / iframe / static frame image
 *   - scrim layer  z-index:-2  the dim veil (settings 'dim')
 * The skin-center backdrop blur element (z-index:-1, background.ts) sits
 * above both, so its backdrop-filter blurs the wallpaper together with the
 * skin backdrop. The 'wallpaperBlur' setting instead blurs the wallpaper
 * itself via a filter on the media layer.
 *
 * Mutual exclusion with skin backdrop art is paint-order only: the opaque
 * media layer covers the body's background, no skin writes are touched, and
 * unmounting restores the previous view for free.
 *
 * Render modes: 'live' mounts video/web directly; 'frame' pins a static
 * image (video: first frame captured to a canvas; scene: the host-decoded
 * PNG; web: the preview image) for a zero-animation-cost backdrop. When
 * 'pauseOnHidden' is set the video pauses while the window is hidden.
 * @module @linxin666/dsh-client-ui-skin-center/wallpaper
 */
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { setSceneBackdropActive } from './runtime/backdrop-scene.ts'

/** The namespace string the Host registers (mirrors src/index.ts). */
export const SKIN_WALLPAPER_NS = 'skin-wallpaper'

/** One wallpaper's render contract, as delivered by the inventory route. */
export interface WallpaperDescriptor {
  id: string
  title: string
  /** 'image' is the macOS Desktop Pictures kind: a static host-converted JPEG. */
  type: 'video' | 'web' | 'scene' | 'application' | 'image'
  videoUrl: string | null
  webUrl: string | null
  frameUrl: string | null
  sceneUrl?: string | null
  /** Result of the lazy scene probe; retained for diagnostics and probe de-duping. */
  sceneCompatibility?: 'full' | 'partial' | 'static-only'
  unsupportedFeatures?: string[]
  /** Fullscreen authored layer placed beneath the live player when needed. */
  sceneBaseUrl?: string | null
  /** Hide the player only when an unsupported script makes a later opaque layer invalid. */
  preferSceneBase?: boolean
  /** Decoded fullscreen artwork discovered from the scene manifest. */
  previewUrl: string | null
}

/** The persisted wallpaper section shape. */
interface WallpaperSection {
  enabled?: boolean
  selection?: string
  mode?: 'live' | 'frame'
  fit?: 'cover' | 'contain' | 'fill'
  pauseOnHidden?: boolean
  dim?: number
  wallpaperBlur?: number
  /** Opacity of the wallpaper media layer itself, 0-100 percent. */
  wallpaperOpacity?: number
  /** Audible video wallpaper playback (default off = muted, #580). */
  sound?: boolean
  /** Wallpaper audio volume 0-100 (default 100). */
  volume?: number
  weLibraryDirs?: string[]
}

/** The face the skin-center card injects for the wallpaper feature. */
export interface WallpaperHandle {
  enabled(): boolean
  /** The persisted selection id ('' = none). */
  selection(): string
  mode(): 'live' | 'frame'
  fit(): 'cover' | 'contain' | 'fill'
  dim(): number
  wallpaperBlur(): number
  /** Opacity of the wallpaper media layer itself, 0-100. */
  wallpaperOpacity(): number
  pauseOnHidden(): boolean
  /** Audible playback for video wallpapers (default false = muted). */
  sound(): boolean
  /** Wallpaper audio volume 0-100. */
  volume(): number
  /** Manual library folders (settings field weLibraryDirs). */
  dirs(): string[]
  /** Add a manual library folder (trimmed, deduped) and persist. */
  addDir(dir: string): void
  /** Remove a manual library folder and persist. */
  removeDir(dir: string): void
  /**
   * Open the host's native directory picker (the SDK's loopback-only
   * host.pickDirectory: Finder on macOS, Explorer on Windows). Resolves to
   * the chosen absolute path, or null when the user cancelled. Rejects when
   * the native capability is unavailable (e.g. a paired remote client), in
   * which case the manual input remains the fallback. Optional: faces
   * without host access omit it and the panel hides the browse button.
   */
  pickDir?(): Promise<string | null>
  /** The currently mounted wallpaper id (try-on included), or null. */
  activeId(): string | null
  /** True while a try-on mount is up. */
  trying(): boolean
  subscribe(listener: () => void): () => void
  setEnabled(value: boolean): void
  setMode(mode: 'live' | 'frame'): void
  setFit(fit: 'cover' | 'contain' | 'fill'): void
  setDim(value: number): void
  setBlur(value: number): void
  setOpacity(value: number): void
  setPauseOnHidden(value: boolean): void
  setSound(value: boolean): void
  setVolume(value: number): void
  /** Persist + render a selection. */
  applySelection(descriptor: WallpaperDescriptor): void
  /** Unmount + clear the persisted selection. */
  clearSelection(): void
  /**
   * Reconcile the mounted layer with the persisted selection: the card
   * resolves the selection id against the inventory and calls this with the
   * descriptor (or null when the wallpaper is gone / none selected).
   */
  sync(descriptor: WallpaperDescriptor | null): void
  /** Mount a temporary preview (the applied selection is kept, not lost). */
  tryOn(descriptor: WallpaperDescriptor): void
  /** Drop the try-on mount and restore the applied selection, if any. */
  exitTryOn(): void
  /** Reconcile a live scene player after an external theme/compositor change. */
  recoverScenePlayer(): void
  dispose(): void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)))

/** Style one fixed, non-interactive, under-everything wallpaper layer. */
function styleLayer(element: HTMLElement, zIndex: number, layer: 'media' | 'scrim'): void {
  element.dataset.dshWallpaperLayer = layer
  element.style.position = 'fixed'
  element.style.inset = '0'
  element.style.zIndex = String(zIndex)
  element.style.pointerEvents = 'none'
  element.style.overflow = 'hidden'
  element.setAttribute('aria-hidden', 'true')
}

/** Style a full-bleed cover child (video / img / iframe). */
function styleCover(element: HTMLElement, fit: 'cover' | 'contain' | 'fill' = 'cover'): void {
  element.style.width = '100%'
  element.style.height = '100%'
  element.style.objectFit = fit
  element.style.border = '0'
  element.style.display = 'block'
}

/** Max static-frame capture edge (the backdrop never needs more pixels). */
const FRAME_MAX_EDGE = 1920

const MIN_VIEWPORT_SURFACE_HEIGHT = 0.9
const MAX_SURFACE_OVERLAY_Z_INDEX = 100

/** Any nontransparent background blocks some of the wallpaper. */
function hasVisibleBackground(color: string): boolean {
  const normalized = color.trim().toLowerCase()
  if (normalized === '' || normalized === 'transparent') return false
  const match = normalized.match(/^[a-z-]+\((.*)\)$/)
  if (match === null) return true
  const args = match[1]
  const slash = args.lastIndexOf('/')
  if (slash >= 0) return hasVisibleAlpha(args.slice(slash + 1))
  const channels = args.split(',')
  return channels.length === 4 ? hasVisibleAlpha(channels[3] ?? '') : true
}

function hasVisibleAlpha(value: string): boolean {
  const alpha = Number.parseFloat(value)
  return Number.isFinite(alpha) && alpha > 0
}

/** Exclude owned layers plus modal/plugin/sidebar/details surfaces that must retain their paint. */
function isExcludedWallpaperSurface(el: HTMLElement, zIndex: string): boolean {
  const semanticOverlay = typeof el.closest === 'function'
    && el.closest(
      '[data-dsh-wallpaper-layer], dialog, [role="dialog"], [aria-modal="true"], [data-shell-overlay], [data-slot="shell.overlay"], [data-dsh-plugin], [data-slot="sidebar"], [data-dsh-surface="sidebar"], [data-slot="sidebar.workspaces"], [data-pane="sidebar"], aside, [data-slot="details"], [data-dsh-surface="details"], [data-pane="details"], [class*="detailsCol"], .aionui-root, [data-aionui-explorer-col], [data-aionui-preview-col], [data-dsh-better-sidebar], [data-dsh-panel-host]',
    ) !== null
  if (semanticOverlay) return true
  const numericZIndex = Number.parseFloat(zIndex)
  return Number.isFinite(numericZIndex) && numericZIndex > MAX_SURFACE_OVERLAY_Z_INDEX
}

/**
 * Default shell-surface detector for WE wallpaper neutralization (#712). A
 * target must cover most of the visible viewport and paint a nontransparent
 * background. It deliberately avoids equality against a theme token because
 * real shell surfaces can resolve a different or partially transparent color.
 * Modal and plugin overlays stay out of scope even when they fill the viewport.
 */
export function defaultWallpaperSurface(el: HTMLElement, doc: Document): boolean {
  const win = doc.defaultView
  if (win === null) return false
  let rectHeight = 0
  let viewportHeight = 0
  let background = ''
  let zIndex = ''
  try {
    rectHeight = el.getBoundingClientRect().height
    viewportHeight = doc.documentElement.clientHeight || win.innerHeight || 0
    const cs = win.getComputedStyle(el)
    background = cs.backgroundColor
    zIndex = cs.zIndex
  } catch {
    return false
  }
  // Only a rendered surface can obscure the wallpaper. In particular, avoid
  // tagging a hidden subtree before it has a real layout box. Upstream #712:
  // color-independent (any visible background) + min viewport coverage, so a
  // full-height shell surface no longer misses the mark on a token mismatch.
  const fillsViewport = viewportHeight > 0
    && rectHeight >= viewportHeight * MIN_VIEWPORT_SURFACE_HEIGHT
  return fillsViewport
    && hasVisibleBackground(background)
    && !isExcludedWallpaperSurface(el, zIndex)
}

/**
 * Workspace-list end-fade detector (#734): a gradient-background element inside
 * the sidebar workspaces slot. The official `data-slot="sidebar.workspaces"`
 * anchor is stable; the fade element only carries hashed CSS-module classes, so
 * this selects it by computed style instead of class names.
 */
export function defaultWorkspaceFade(el: HTMLElement, doc: Document): boolean {
  const win = doc.defaultView
  if (win === null) return false
  try {
    return win.getComputedStyle(el).backgroundImage.includes('gradient')
  } catch {
    return false
  }
}

export interface WallpaperControllerOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
  doc?: Document
  /** Override the full-viewport-surface detector (tests); defaults to the
   * computed-style heuristic in defaultWallpaperSurface. */
  declareSurface?: (el: HTMLElement, doc: Document) => boolean
  /** Override the sidebar workspaces end-fade detector (tests); defaults to
   * defaultWorkspaceFade. */
  declareWorkspaceFade?: (el: HTMLElement, doc: Document) => boolean
  /** Trailing debounce for the surface re-scan (ms). Coalesces burst DOM
   * mutations (chat streaming) into one settled sweep; tests pass 0 to flush
   * right after rAF. Defaults to 150. */
  surfaceTrailMs?: number
  /** Override the light/dark theme detector (tests); defaults to
   * body[data-ds-dark-theme] presence. */
  themeGet?: () => 'light' | 'dark'
}

/**
 * Own the skin-wallpaper scope: keep the mounted layers in sync with the
 * persisted selection and the card-driven descriptor resolution.
 */
export class WallpaperController implements WallpaperHandle {
  private enabledValue = true
  private selectionValue = ''
  private modeValue: 'live' | 'frame' = 'live'
  private fitValue: 'cover' | 'contain' | 'fill' = 'cover'
  private pauseOnHiddenValue = true
  private soundValue = false
  private volumeValue = 100
  private dimValue = 25
  private blurValue = 0
  private opacityValue = 100
  private dirsValue: string[] = []
  private readonly listeners = new Set<() => void>()
  private readonly scope: SettingsScope<WallpaperSection>
  private readonly unsubscribe: () => void
  private readonly options: WallpaperControllerOptions
  private readonly doc: Document

  /** The descriptor of the applied selection, resolved by the card. */
  private applied: WallpaperDescriptor | null = null
  /** The try-on descriptor while a preview is up. */
  private previewing: WallpaperDescriptor | null = null

  private mediaLayer: HTMLDivElement | null = null
  private scrimLayer: HTMLDivElement | null = null
  private videoElement: HTMLVideoElement | null = null
  private rootNeutralizer: HTMLStyleElement | null = null
  /** Re-asserts the wallpaper layers if the shell tears the body subtree down. */
  private mountObserver: MutationObserver | null = null
  /** Re-tags full-viewport surfaces after navigation rebuilds #root (#805). */
  private surfaceObserver: MutationObserver | null = null
  /** Shell surfaces tagged with data-dsh-wallpaper-surface during this mount. */
  private taggedSurfaces = new Set<HTMLElement>()
  private disposed = false
  /** In-flight scene probes by wallpaper id; overlapping entry points
   *  (applySelection / tryOn / sync / fetchAndSync) must not re-read the
   *  same packed scene concurrently. */
  private probePending = new Map<string, Promise<void>>()
  /** Detached frame-capture video; released on error/abort/loadeddata and on
   *  teardown so it never keeps buffering the source file. */
  private captureVideo: HTMLVideoElement | null = null
  /** Guard flag: suppresses readAll during applyThemeDefaults scope writes
   *  to prevent mid-write listener cascades from resetting values. */
  private seeding = false

  constructor(scope: SettingsScope<WallpaperSection>, options: WallpaperControllerOptions = {}) {
    this.scope = scope
    this.options = options
    this.doc = options.doc ?? document
    this.readAll()
    this.unsubscribe = scope.subscribe(() => {
      if (this.disposed || this.seeding) return
      this.readAll()
      if (this.enabledValue && this.selectionValue && (!this.applied || this.applied.id !== this.selectionValue)) {
        this.fetchAndSync()
      } else {
        this.render()
        this.publish()
      }
    })
    // Pause-on-hidden wiring lives for the controller's whole life; it only
    // ever acts while a video is mounted.
    this.doc.addEventListener('visibilitychange', this.onVisibility)
    this.doc.defaultView?.addEventListener('message', this.onSceneMessage)
    // Audible autoplay stays blocked until the first user gesture; retry
    // play() on that gesture so an unmuted live wallpaper starts (#580).
    this.doc.addEventListener('pointerdown', this.onFirstGesture)
    this.doc.addEventListener('keydown', this.onFirstGesture)
    // Some DSH navigation (e.g. switching conversations) tears down the body
    // subtree, which removes the wallpaper layers while the selection is
    // still active. Re-mount them so the wallpaper does not disappear (#805).
    const win = this.doc.defaultView
    if (win !== null && typeof win.MutationObserver === 'function') {
      this.mountObserver = new win.MutationObserver(() => {
        if (this.disposed) return
        if ((this.previewing ?? this.applied) === null) return
        if (this.mediaLayer === null || !this.mediaLayer.isConnected) {
          this.render()
        }
      })
      this.mountObserver.observe(this.doc.body, { childList: true })
    }
    // Theme-aware defaults (#1051): when the scope has no explicit dim or
    // opacity (both sit at schema defaults), seed values tuned for the
    // current light/dark theme so text is readable out of the box.
    this.applyThemeDefaults()
    if (this.enabledValue && this.selectionValue) {
      this.fetchAndSync()
    }
  }

  private fetchAndSync(): void {
    if (!this.selectionValue || !this.doc) return
    const targetId = this.selectionValue
    const fetchFn = this.options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(this.doc.defaultView ?? globalThis) : undefined)
    if (!fetchFn) return
    const apiBase = this.options.apiBase ?? '/api/skin-center/we'
    fetchFn(`${apiBase}/inventory`)
      .then(async (response) => {
        if (this.disposed || !response.ok) return
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean
          wallpapers?: WallpaperDescriptor[]
        } | null
        if (payload?.ok === true && Array.isArray(payload.wallpapers)) {
          const item = payload.wallpapers.find((w) => w.id === targetId)
          if (item && this.selectionValue === targetId) {
            this.applied = item
            this.render()
            this.publish()
            this.probeSceneCapabilitiesIfNeeded(item)
          }
        }
      })
      .catch(() => {
        // Fail-silent on network errors
      })
  }

  /**
   * Lazily probe a scene's video/WebGL capabilities: the inventory never
   * reads packed scene payloads, so only the wallpaper the user actually
   * selects (apply, try-on or boot sync) asks the probe route. The response
   * is merged into every slot (previewing and applied) that holds the id.
   */
  private probeSceneCapabilitiesIfNeeded(descriptor: WallpaperDescriptor): void {
    if (this.disposed || descriptor.type !== 'scene' || descriptor.videoUrl !== null || descriptor.sceneUrl != null || descriptor.sceneCompatibility !== undefined) return
    const targetId = descriptor.id
    if (this.probePending.has(targetId)) return
    const fetchFn = this.options.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(this.doc.defaultView ?? globalThis) : undefined)
    if (!fetchFn) return
    const apiBase = this.options.apiBase ?? '/api/skin-center/we'
    const pending = fetchFn(apiBase + '/scene-probe?id=' + encodeURIComponent(targetId))
      .then(async (response) => {
        if (this.disposed || !response.ok) return
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean
          videoUrl?: string | null
          sceneUrl?: string | null
          compatibility?: 'full' | 'partial' | 'static-only'
          unsupportedFeatures?: string[]
        } | null
        if (!payload || payload.ok !== true) return
        let sceneBaseUrl: string | null = null
        let preferSceneBase = false
        if (payload.sceneUrl && payload.compatibility === 'partial'
          && payload.unsupportedFeatures?.includes('embedded-script') === true) {
          try {
            const manifestResponse = await fetchFn(payload.sceneUrl.replace('/scene-runtime/', '/scene-manifest/'))
            const manifestPayload = manifestResponse.ok
              ? await manifestResponse.json().catch(() => null) as {
                ok?: boolean
                manifest?: {
                  width?: number
                  height?: number
                  timeSchedule?: unknown
                  layers?: Array<{ x?: number; y?: number; w?: number; h?: number; texUrl?: string; videoUrl?: string }>
                }
              } | null
              : null
            const manifest = manifestPayload?.ok === true ? manifestPayload.manifest : undefined
            // The renderer implements author-configured real-time switching;
            // do not replace that live player with one static base merely because
            // unrelated embedded scripts remain unsupported.
            if (manifest && manifest.timeSchedule === undefined && typeof manifest.width === 'number' && typeof manifest.height === 'number') {
              // Video-backed layers serve MP4 bytes: a CSS background cannot
              // paint them, so only still-image layers qualify as the base.
              const fullscreenIndex = manifest.layers?.findIndex(layer =>
                typeof layer.texUrl === 'string'
                && typeof layer.videoUrl !== 'string'
                && Math.abs((layer.w ?? 0) - manifest.width!) <= 1
                && Math.abs((layer.h ?? 0) - manifest.height!) <= 1
                && Math.abs((layer.x ?? 0) - manifest.width! / 2) <= 1
                && Math.abs((layer.y ?? 0) - manifest.height! / 2) <= 1
              ) ?? -1
              if (fullscreenIndex >= 0) {
                sceneBaseUrl = manifest.layers?.[fullscreenIndex]?.texUrl ?? null
                // A later oversized layer is generally a script-controlled
                // project/compose surface. It can cover the real artwork when
                // its script is unsupported; ordinary multi-layer scenes keep
                // the live player visible.
                preferSceneBase = manifest.layers?.slice(fullscreenIndex + 1).some(layer =>
                  (layer.w ?? 0) > manifest.width! * 1.25
                  || (layer.h ?? 0) > manifest.height! * 1.25
                ) === true
              }
            }
          } catch {
            // Keep the regular scene frame/player fallback.
          }
        }
        if (this.disposed) return
        // Compatibility metadata is retained for diagnostics and probe de-duping.
        // Partial scenes still use their actual scene runtime: unsupported scripts
        // may omit individual effects, but the decoded Wallpaper Engine layers and
        // supported particles must remain dynamic rather than becoming a cover.
        // Merge the capabilities into every slot holding the id: a probe
        // issued by try-on may land while sync/apply has already installed
        // the same wallpaper as applied, and exiting the try-on must not
        // fall back to a static frame without capabilities.
        let changed = false
        if (this.previewing?.id === targetId) {
          const merged: WallpaperDescriptor = {
            ...this.previewing,
            videoUrl: payload.videoUrl ?? this.previewing.videoUrl,
            sceneUrl: payload.sceneUrl ?? this.previewing.sceneUrl,
            sceneCompatibility: payload.compatibility,
            unsupportedFeatures: payload.unsupportedFeatures,
            sceneBaseUrl: sceneBaseUrl ?? this.previewing.sceneBaseUrl,
            preferSceneBase,
          }
          if (merged.videoUrl !== this.previewing.videoUrl
            || merged.sceneUrl !== this.previewing.sceneUrl
            || merged.sceneCompatibility !== this.previewing.sceneCompatibility
            || merged.sceneBaseUrl !== this.previewing.sceneBaseUrl
            || merged.preferSceneBase !== this.previewing.preferSceneBase) {
            this.previewing = merged
            changed = true
          }
        }
        if (this.applied?.id === targetId) {
          const merged: WallpaperDescriptor = {
            ...this.applied,
            videoUrl: payload.videoUrl ?? this.applied.videoUrl,
            sceneUrl: payload.sceneUrl ?? this.applied.sceneUrl,
            sceneCompatibility: payload.compatibility,
            unsupportedFeatures: payload.unsupportedFeatures,
            sceneBaseUrl: sceneBaseUrl ?? this.applied.sceneBaseUrl,
            preferSceneBase,
          }
          if (merged.videoUrl !== this.applied.videoUrl
            || merged.sceneUrl !== this.applied.sceneUrl
            || merged.sceneCompatibility !== this.applied.sceneCompatibility
            || merged.sceneBaseUrl !== this.applied.sceneBaseUrl
            || merged.preferSceneBase !== this.applied.preferSceneBase) {
            this.applied = merged
            changed = true
          }
        }
        if (!changed) return
        this.render()
        this.publish()
      })
      .catch(() => {
        // Fail-silent on network errors
      })
      .finally(() => {
        this.probePending.delete(targetId)
      })
    this.probePending.set(targetId, pending)
  }

  enabled = (): boolean => this.enabledValue
  selection = (): string => this.selectionValue
  mode = (): 'live' | 'frame' => this.modeValue
  fit = (): 'cover' | 'contain' | 'fill' => this.fitValue
  dim = (): number => this.dimValue
  wallpaperBlur = (): number => this.blurValue
  wallpaperOpacity = (): number => this.opacityValue
  pauseOnHidden = (): boolean => this.pauseOnHiddenValue
  sound = (): boolean => this.soundValue
  volume = (): number => this.volumeValue
  dirs = (): string[] => this.dirsValue

  addDir(dir: string): void {
    const trimmed = dir.trim()
    if (trimmed === '' || this.dirsValue.includes(trimmed)) return
    this.dirsValue = [...this.dirsValue, trimmed]
    this.publish()
    void this.scope.set('weLibraryDirs', this.dirsValue)
  }

  removeDir(dir: string): void {
    const next = this.dirsValue.filter(d => d !== dir)
    if (next.length === this.dirsValue.length) return
    this.dirsValue = next
    this.publish()
    void this.scope.set('weLibraryDirs', this.dirsValue)
  }

  private failedIds = new Set<string>()

  isDisplaying = (): boolean => {
    const id = this.activeId()
    return this.enabledValue && id !== null && !this.failedIds.has(id)
  }

  activeId = (): string | null => {
    const current = this.previewing ?? this.applied
    return this.mediaLayer !== null && current !== null ? current.id : null
  }
  trying = (): boolean => this.previewing !== null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setEnabled(value: boolean): void {
    this.enabledValue = value
    this.render()
    this.publish()
    void this.scope.set('enabled', value)
  }

  setMode(mode: 'live' | 'frame'): void {
    this.modeValue = mode
    this.render()
    this.publish()
    void this.scope.set('mode', mode)
  }

  setFit(fit: 'cover' | 'contain' | 'fill'): void {
    this.fitValue = fit
    this.render()
    this.publish()
    void this.scope.set('fit', fit)
  }

  setDim(value: number): void {
    this.dimValue = clamp(value, 0, 90)
    this.render()
    this.publish()
    void this.scope.set('dim', this.dimValue)
  }

  setBlur(value: number): void {
    this.blurValue = clamp(value, 0, 60)
    this.render()
    this.publish()
    void this.scope.set('wallpaperBlur', this.blurValue)
  }

  setOpacity(value: number): void {
    this.opacityValue = clamp(value, 0, 100)
    this.render()
    this.publish()
    void this.scope.set('wallpaperOpacity', this.opacityValue)
  }

  setPauseOnHidden(value: boolean): void {
    this.pauseOnHiddenValue = value
    this.publish()
    void this.scope.set('pauseOnHidden', value)
  }

  setSound(value: boolean): void {
    this.soundValue = value
    this.applySound()
    this.publish()
    void this.scope.set('sound', value)
  }

  setVolume(value: number): void {
    this.volumeValue = clamp(value, 0, 100)
    this.applySound()
    this.publish()
    void this.scope.set('volume', this.volumeValue)
  }

  applySelection(descriptor: WallpaperDescriptor): void {
    this.failedIds.delete(descriptor.id)
    this.applied = descriptor
    this.previewing = null
    this.selectionValue = descriptor.id
    this.render()
    this.publish()
    void this.scope.set('selection', descriptor.id)
    this.probeSceneCapabilitiesIfNeeded(descriptor)
  }

  clearSelection(): void {
    this.applied = null
    this.previewing = null
    this.selectionValue = ''
    this.render()
    this.publish()
    void this.scope.set('selection', '')
  }

  sync(descriptor: WallpaperDescriptor | null): void {
    // Inventory descriptors intentionally omit lazily probed scene capabilities.
    // Reopening Skin Center refreshes that inventory, so replacing an already
    // enriched descriptor verbatim would drop sceneUrl/videoUrl, rebuild the
    // media as a static frame, then probe and rebuild the live player again.
    // Preserve capabilities for the same id while still accepting every other
    // refreshed field from inventory.
    if (descriptor !== null && this.applied?.id === descriptor.id) {
      descriptor = {
        ...descriptor,
        videoUrl: descriptor.videoUrl ?? this.applied.videoUrl,
        sceneUrl: descriptor.sceneUrl ?? this.applied.sceneUrl,
        sceneCompatibility: descriptor.sceneCompatibility ?? this.applied.sceneCompatibility,
        unsupportedFeatures: descriptor.unsupportedFeatures ?? this.applied.unsupportedFeatures,
        sceneBaseUrl: descriptor.sceneBaseUrl ?? this.applied.sceneBaseUrl,
        preferSceneBase: descriptor.preferSceneBase ?? this.applied.preferSceneBase,
      }
    }
    this.applied = descriptor
    this.render()
    if (descriptor !== null) this.probeSceneCapabilitiesIfNeeded(descriptor)
  }

  tryOn(descriptor: WallpaperDescriptor): void {
    this.failedIds.delete(descriptor.id)
    this.previewing = descriptor
    this.render()
    this.publish()
    this.probeSceneCapabilitiesIfNeeded(descriptor)
  }

  exitTryOn(): void {
    if (this.previewing === null) return
    this.previewing = null
    this.render()
    this.publish()
  }

  recoverScenePlayer(): void {
    const scenePlayer = this.mediaLayer?.firstElementChild ?? null
    if (!(scenePlayer instanceof HTMLIFrameElement) || scenePlayer.dataset.dshScenePlayer !== '') return
    try {
      // The sandboxed player has an opaque origin, so a same-origin target
      // would never match it; '*' delivers to the single identified window.
      scenePlayer.contentWindow?.postMessage({ type: 'dsh-recover-renderer' }, '*')
    } catch {
      // A failed recovery message is harmless; the next render keeps the current frame.
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.mountObserver?.disconnect()
    this.mountObserver = null
    this.doc.removeEventListener('visibilitychange', this.onVisibility)
    this.doc.defaultView?.removeEventListener('message', this.onSceneMessage)
    this.doc.removeEventListener('pointerdown', this.onFirstGesture)
    this.doc.removeEventListener('keydown', this.onFirstGesture)
    this.teardownLayers()
  }

  // --- internals -----------------------------------------------------------

  /**
   * Seed dim and opacity with theme-tuned values when neither has been
   * explicitly set (both are at schema defaults: dim=25, opacity=100).
   * This runs once at construction so a fresh wallpaper install gets
   * readable defaults for the active theme. Users who have already
   * adjusted either slider keep their values (#1051).
   */
  private applyThemeDefaults(): void {
    const snapshot = this.scope.getSnapshot()
    const value = snapshot.value ?? {}
    // Detect whether dim and opacity have never been written to the scope.
    // A value of undefined means the field was never persisted; any number
    // (even the schema default 25 for dim) means the user or a prior seed
    // already set it, so we must not overwrite.
    if (value.dim !== undefined || value.wallpaperOpacity !== undefined) return
    // The scope may not yet be writable during early initialization.
    if (snapshot.writable === false) return
    const theme = this.options.themeGet !== undefined
      ? this.options.themeGet()
      : (this.doc.body?.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light')
    if (theme === 'light') {
      this.dimValue = 0
      this.opacityValue = 40
    } else {
      this.dimValue = 40
      this.opacityValue = 100
    }
    this.seeding = true
    try {
      void this.scope.set('dim', this.dimValue)
      void this.scope.set('wallpaperOpacity', this.opacityValue)
    } catch { /* scope not ready — values stay local until next readAll */ }
    this.seeding = false
  }

  private readAll(): void {
    const snapshot: SettingsScopeSnapshot<WallpaperSection> = this.scope.getSnapshot()
    const value = snapshot.value ?? {}
    this.enabledValue = typeof value.enabled === 'boolean' ? value.enabled : true
    this.selectionValue = typeof value.selection === 'string' ? value.selection : ''
    this.modeValue = value.mode === 'frame' ? 'frame' : 'live'
    const rawFit = value.fit
    this.fitValue = rawFit === 'contain' || rawFit === 'fill' ? rawFit : 'cover'
    this.pauseOnHiddenValue = typeof value.pauseOnHidden === 'boolean' ? value.pauseOnHidden : true
    this.soundValue = typeof value.sound === 'boolean' ? value.sound : false
    this.volumeValue = typeof value.volume === 'number' && Number.isFinite(value.volume)
      ? clamp(value.volume, 0, 100)
      : 100
    this.dimValue = typeof value.dim === 'number' && Number.isFinite(value.dim) ? clamp(value.dim, 0, 90) : 25
    this.blurValue = typeof value.wallpaperBlur === 'number' && Number.isFinite(value.wallpaperBlur)
      ? clamp(value.wallpaperBlur, 0, 60)
      : 0
    this.opacityValue = typeof value.wallpaperOpacity === 'number' && Number.isFinite(value.wallpaperOpacity)
      ? clamp(value.wallpaperOpacity, 0, 100)
      : 100
    this.dirsValue = Array.isArray(value.weLibraryDirs)
      ? value.weLibraryDirs.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      : []
  }

  /** Resume a policy-blocked video on the first user gesture (#580). */
  private readonly onFirstGesture = (): void => {
    if (this.videoElement === null || !this.videoElement.paused) return
    // jsdom (and older engines) return undefined, real browsers a promise.
    void this.videoElement.play()?.catch(() => { /* still blocked: retry on the next gesture */ })
  }

  private readonly onSceneMessage = (event: MessageEvent): void => {
    const scenePlayer = this.mediaLayer?.firstElementChild ?? null
    if (!(scenePlayer instanceof HTMLIFrameElement) || scenePlayer.dataset.dshScenePlayer !== '') return
    // The player is sandboxed without allow-same-origin, so its opaque origin
    // arrives as Origin "null"; only the identity of the sender (this exact
    // iframe window) proves the message came from the mounted player.
    if (event.source !== scenePlayer.contentWindow) return
    const message = event.data as { type?: unknown } | null
    if (message?.type !== 'dsh-scene-needs-reload') return
    // Context restoration invalidates every WebGL object. Reloading only the
    // isolated renderer keeps the wallpaper selection and shell state intact.
    scenePlayer.src = scenePlayer.src
  }

  private readonly onVisibility = (): void => {
    if (!this.pauseOnHiddenValue) return
    if (this.videoElement !== null) {
      if (this.doc.hidden) {
        this.videoElement.pause()
      } else {
        // jsdom (and older engines) return undefined, real browsers a promise.
        void this.videoElement.play()?.catch(() => { /* autoplay policy */ })
      }
    }
    const scenePlayer = this.mediaLayer?.firstElementChild ?? null
    if (scenePlayer instanceof HTMLIFrameElement && scenePlayer.dataset.dshScenePlayer === '') {
      try {
        // '*' reaches the opaque-origin sandboxed player (see applyFit).
        scenePlayer.contentWindow?.postMessage({ type: 'dsh-set-pause', paused: this.doc.hidden }, '*')
      } catch {
        // ignore
      }
    }
  }

  /** Reconcile the DOM with (enabled, previewing ?? applied, mode, dim, blur). */
  private render(): void {
    if (this.disposed) return
    const current = this.enabledValue ? (this.previewing ?? this.applied) : null
    if (current === null) {
      this.teardownLayers()
      return
    }
    this.ensureLayers(current)
  }

  private ensureLayers(descriptor: WallpaperDescriptor): void {
    // The stock shell paints opaque backgrounds on the app root and on the
    // composer seat, which fully cover the negative-z wallpaper layers
    // (issue #505, #632). Neutralize them ONLY while the own marker
    // data-dsh-wallpaper-active is present, so no skin or plugin style is
    // affected outside a mounted wallpaper (#506). The app-root rules mirror
    // the contract the v2 skin CSS pipeline appends for every skin
    // (`[id="root"] { background: transparent }`); the id/attribute selectors
    // outrank the shell's class rules, and the --dsw-alias-bg-base token
    // itself is left untouched for every other consumer.
    if (this.rootNeutralizer === null) {
      this.rootNeutralizer = this.doc.createElement('style')
      this.rootNeutralizer.dataset.dshWallpaperRoot = ''
      this.rootNeutralizer.textContent = `
        [id="root"] { background: transparent; }
        /* Wallpaper opacity backdrop (#1051): light-mode fades to white,
           dark-mode fades to black.  :has() tracks theme switches live. */
        html[data-dsh-wallpaper-active] {
          background-color: white !important;
          background-image: none !important;
        }
        html[data-dsh-wallpaper-active]:has(body[data-ds-dark-theme]) {
          background-color: black !important;
        }
        body[data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active] body,
        html[data-dsh-skin] body[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active][data-ds-dark-theme],
        html[data-dsh-wallpaper-active] [id="root"] {
          background-color: transparent !important;
          background-image: none !important;
        }
        /* Seat-wide skin pseudos would blur the whole footer. The shared dock
           row owns the compact rounded transcript mask instead (#777/#978). */
        html[data-dsh-wallpaper-active] [data-composer-seat]::before {
          background: none !important;
          backdrop-filter: none !important;
        }
        /* Full-viewport shell surfaces (AppFrame frame, conversation root,
           details root) paint the opaque app base background via hashed
           CSS-module classes. While a WE wallpaper is mounted the controller
           tags them with the own marker data-dsh-wallpaper-surface
           (markWallpaperSurfaces), and this rule neutralizes them with no
           class-name dependency (issue #734). */
        html[data-dsh-wallpaper-active] [data-dsh-wallpaper-surface] {
          background-color: transparent !important;
          background-image: none !important;
        }
      `
      this.doc.head.appendChild(this.rootNeutralizer)
    }
    this.doc.body.dataset.dshWallpaperActive = 'true'
    this.doc.documentElement.dataset.dshWallpaperActive = 'true'
    // Report the wallpaper into the unified "backdrop visible" marker so the
    // shared composer-seat neutralizer applies here too (issue #777).
    setSceneBackdropActive(this.doc, 'wallpaper', true)
    this.markSurfaces()
    this.ensureSurfaceObserver()
    // Connect-aware: navigation (e.g. switching conversations) can tear the
    // wallpaper layers out of the body subtree while the references survive.
    // Re-append the surviving layer instead of recreating it, so the media
    // child and its mediaKey survive and the video is not rebuilt / restarted
    // (#805). Only build a fresh layer when there is none at all.
    if (this.mediaLayer !== null && !this.mediaLayer.isConnected) {
      this.doc.body.appendChild(this.mediaLayer)
    }
    if (this.mediaLayer === null) {
      this.mediaLayer = this.doc.createElement('div')
      styleLayer(this.mediaLayer, -3, 'media')
      this.doc.body.appendChild(this.mediaLayer)
    }
    if (this.scrimLayer !== null && !this.scrimLayer.isConnected) {
      this.doc.body.appendChild(this.scrimLayer)
    }
    if (this.scrimLayer === null) {
      this.scrimLayer = this.doc.createElement('div')
      styleLayer(this.scrimLayer, -2, 'scrim')
      this.doc.body.appendChild(this.scrimLayer)
    }
    // Keep the inventory preview painted beneath live scene iframes. A WebGL
    // context can be temporarily lost (or its canvas can clear before the
    // isolated player reloads); without this backing frame the transparent
    // iframe exposes only the shell gradient and looks like the wallpaper was
    // removed. Video/web wallpapers paint their own opaque media, so they do
    // not need a duplicate backdrop.
    const sceneBackdrop = descriptor.type === 'scene'
      ? (descriptor.sceneBaseUrl ?? descriptor.frameUrl ?? descriptor.previewUrl)
      : null
    this.mediaLayer.style.backgroundImage = sceneBackdrop === null ? '' : `url(${JSON.stringify(sceneBackdrop)})`
    this.mediaLayer.style.backgroundPosition = sceneBackdrop === null ? '' : 'center'
    this.mediaLayer.style.backgroundRepeat = sceneBackdrop === null ? '' : 'no-repeat'
    this.mediaLayer.style.backgroundSize = sceneBackdrop === null
      ? ''
      : (this.fitValue === 'fill' ? '100% 100%' : this.fitValue)
    // Capabilities (videoUrl/sceneUrl) participate in the key: the lazy
    // scene probe merges them into the same descriptor id after the first
    // render, and the static frame must be rebuilt as live media.
    const mediaKey = descriptor.id + ':' + this.modeValue
      + ':' + (descriptor.videoUrl ?? '') + ':' + (descriptor.sceneUrl ?? '')
      + ':' + (descriptor.sceneCompatibility ?? '')
      + ':' + (descriptor.unsupportedFeatures?.join(',') ?? '')
      + ':' + (descriptor.sceneBaseUrl ?? '') + ':' + String(descriptor.preferSceneBase ?? false)
    if (this.mediaLayer.dataset.mediaKey !== mediaKey) {
      this.mediaLayer.dataset.mediaKey = mediaKey
      // A media transition (frame->live, mode switch) abandons the current
      // capture: release its src before replacing, otherwise the detached
      // video keeps buffering until teardown or the next capture.
      this.releaseCaptureVideo()
      this.mediaLayer.replaceChildren()
      this.videoElement = null
      const child = this.buildMedia(descriptor)
      if (child !== null) {
        this.mediaLayer.appendChild(child)
        // The initial play() in buildVideo ran while the element was detached
        // and may have been rejected; retry once mounted so large files start
        // streaming without a user gesture (#805 loading).
        if (child instanceof HTMLVideoElement && child.paused) {
          void child.play()?.catch(() => { /* retried on first gesture */ })
        }
      }
    } else {
      // Kept the surviving layer (mediaKey matched): some browsers pause a
      // <video> when it is torn out of the DOM, and the rebuild path above is
      // skipped, so its play retry never ran — resume playback explicitly.
      // Using the window-local constructor: jsdom (and isolated test envs)
      // may not surface the global HTMLVideoElement binding in every context.
      const child = this.mediaLayer.firstElementChild
      const VideoCtor = this.doc.defaultView?.HTMLVideoElement
      if (VideoCtor !== undefined && child instanceof VideoCtor && child.paused) {
        void child.play()?.catch(() => { /* autoplay policy: stays paused until gesture */ })
      }
    }
    // Sizing mode changes apply in place: rebuilding would restart video
    // playback and re-parse the scene on every click (#717 follow-up).
    this.applyFit()
    // Blur the wallpaper itself (the -1 backdrop-filter element stays the
    // skin-center blur control's business and blurs everything behind).
    const blur = this.blurValue > 0 ? 'blur(' + String(this.blurValue) + 'px)' : ''
    this.mediaLayer.style.filter = blur
    this.mediaLayer.style.transform = this.blurValue > 0 ? 'scale(1.05)' : ''
    // Wallpaper opacity (#1051): the html element's neutralizer background is
    // now black (not transparent) so reducing opacity fades toward black.
    this.mediaLayer.style.opacity = this.opacityValue < 100 ? String(this.opacityValue / 100) : ''
    this.scrimLayer.style.background = 'rgba(0, 0, 0, ' + String(this.dimValue / 100) + ')'
  }

  /** Push the current sizing mode onto the mounted media element. */
  private applyFit(): void {
    const child = this.mediaLayer?.firstElementChild ?? null
    if (child instanceof HTMLElement) {
      styleCover(child, this.fitValue)
    }
    if (child instanceof HTMLIFrameElement && child.dataset.dshScenePlayer === '') {
      try {
        // The player frame is sandboxed without allow-same-origin, so its
        // origin is opaque and a real-origin targetOrigin would drop the
        // message; '*' delivers to the identified contentWindow.
        child.contentWindow?.postMessage({ type: 'dsh-set-fit', fit: this.fitValue }, '*')
      } catch {
        // ignore: the player also receives the fit on its own load handler
      }
    }
  }

  /** Build the cover child for one descriptor + mode; null when unrenderable. */
  private buildMedia(descriptor: WallpaperDescriptor): HTMLElement | null {
    if (descriptor.type === 'video') {
      if (this.modeValue === 'live' && descriptor.videoUrl !== null) {
        return this.buildVideo(descriptor.videoUrl)
      }
      if (descriptor.videoUrl !== null) {
        return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl)
      }
      return this.buildImage(descriptor.previewUrl)
    }
    if (descriptor.type === 'web') {
      if (this.modeValue === 'live' && descriptor.webUrl !== null) {
        const iframe = this.doc.createElement('iframe')
        iframe.src = descriptor.webUrl
        // Web wallpapers are third-party HTML downloaded from the Workshop /
        // user directories and run with the host same-origin, so they must be
        // isolated: allow-scripts only gives an opaque origin (no parent DOM,
        // no host storage, no same-origin /api access). Script-only sandboxing
        // keeps textures/canvas/WebGL working; localStorage / cookies degrade.
        iframe.setAttribute('sandbox', 'allow-scripts')
        iframe.setAttribute('tabindex', '-1')
        styleCover(iframe, this.fitValue)
        return iframe
      }
      return this.buildImage(descriptor.previewUrl)
    }
    if (descriptor.type === 'scene') {
      if (this.modeValue === 'live' && descriptor.videoUrl !== null) {
        return this.buildVideo(descriptor.videoUrl, descriptor.frameUrl, descriptor.previewUrl)
      }
      if (this.modeValue === 'live' && descriptor.sceneUrl) {
        const iframe = this.doc.createElement('iframe')
        iframe.src = descriptor.sceneUrl
        // The scene player renders third-party scene data; same isolation as
        // web wallpapers (opaque origin, steering via postMessage).
        iframe.setAttribute('sandbox', 'allow-scripts')
        iframe.setAttribute('tabindex', '-1')
        iframe.dataset.dshScenePlayer = ''
        if (descriptor.preferSceneBase === true && descriptor.sceneBaseUrl) iframe.style.opacity = '0'
        styleCover(iframe, this.fitValue)
        iframe.addEventListener('load', () => {
          try {
            iframe.contentWindow?.postMessage({ type: 'dsh-set-fit', fit: this.fitValue }, '*')
          } catch {
            // ignore
          }
        })
        return iframe
      }
      if (this.modeValue === 'frame' && descriptor.videoUrl !== null && descriptor.frameUrl === null) {
        return this.buildVideoFrame(descriptor.videoUrl, descriptor.previewUrl)
      }
      // The host frame decode yields the native full-resolution texture (1080p/4K);
      // fall back to the preview image if the scene frame decode fails (422) (#521).
      return this.buildImage(descriptor.frameUrl ?? descriptor.previewUrl, descriptor.previewUrl)
    }
    return this.buildImage(descriptor.previewUrl)
  }

  /** Push the persisted sound/volume settings onto the mounted video. */
  private applySound(): void {
    if (this.videoElement === null) return
    this.videoElement.muted = !this.soundValue
    this.videoElement.volume = this.volumeValue / 100
  }

  private buildVideo(url: string, frameUrl: string | null = null, previewUrl: string | null = null): HTMLVideoElement {
    const video = this.doc.createElement('video')
    video.src = url
    video.muted = !this.soundValue
    video.volume = this.volumeValue / 100
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    // Large local files may have the moov atom at the end: preload auto makes
    // Chromium fetch metadata eagerly instead of waiting for a gesture.
    video.preload = 'auto'
    video.setAttribute('aria-hidden', 'true')
    styleCover(video, this.fitValue)
    this.videoElement = video
    if (frameUrl !== null || previewUrl !== null) {
      video.addEventListener('error', () => {
        const nextUrl = frameUrl ?? previewUrl
        const nextFallback = frameUrl !== null ? previewUrl : null
        const img = this.buildImage(nextUrl, nextFallback)
        if (img && video.parentElement) {
          video.parentElement.replaceChild(img, video)
        } else {
          const currentId = this.previewing?.id ?? this.applied?.id
          if (currentId) {
            this.failedIds.add(currentId)
            this.render()
            this.publish()
          }
        }
      }, { once: true })
    } else {
      video.addEventListener('error', () => {
        const currentId = this.previewing?.id ?? this.applied?.id
        if (currentId) {
          this.failedIds.add(currentId)
          this.render()
          this.publish()
        }
      }, { once: true })
    }
    // jsdom (and older engines) return undefined, real browsers a promise.
    void video.play()?.catch(() => { /* autoplay policy: stays paused */ })
    return video
  }

  /** Static-frame mode for video: capture the first frame into an image. */
  private buildVideoFrame(url: string, previewUrl: string | null): HTMLElement {
    const image = this.doc.createElement('img')
    styleCover(image, this.fitValue)
    if (previewUrl !== null) image.src = previewUrl
    const video = this.doc.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    // The capture video is owned by the controller: it is released on
    // error/abort, on a successful capture, and on teardown, so a decode
    // failure or an early mode switch cannot leave it buffering detached.
    this.releaseCaptureVideo()
    this.captureVideo = video
    const release = (): void => {
      video.removeAttribute('src')
      video.load()
    }
    video.addEventListener('error', release, { once: true })
    video.addEventListener('abort', release, { once: true })
    video.addEventListener('loadeddata', () => {
      try {
        const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
        const canvas = this.doc.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        const context = canvas.getContext('2d')
        if (context !== null) {
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          image.src = canvas.toDataURL('image/jpeg', 0.85)
        }
      } catch {
        // Capture failed (codec/format): the preview image stays.
      } finally {
        // Stop buffering whether the capture succeeded or not (a missing 2d
        // context or a decode failure must not leave the hidden video
        // streaming the file).
        release()
      }
    }, { once: true })
    return image
  }

  private releaseCaptureVideo(): void {
    if (this.captureVideo === null) return
    this.captureVideo.removeAttribute('src')
    this.captureVideo.load()
    this.captureVideo = null
  }

  private buildImage(url: string | null, fallbackUrl: string | null = null): HTMLElement | null {
    if (url === null) return null
    const image = this.doc.createElement('img')
    image.src = url
    image.alt = ''
    image.addEventListener('error', () => {
      if (fallbackUrl !== null && fallbackUrl !== url && image.src !== fallbackUrl) {
        image.src = fallbackUrl
        return
      }
      const currentId = this.previewing?.id ?? this.applied?.id
      if (currentId) {
        this.failedIds.add(currentId)
        this.render()
        this.publish()
      }
    })
    styleCover(image, this.fitValue)
    return image
  }

  /** Tag the official shell full-viewport background surfaces (AppFrame
   * frame, conversation root, details root) and the sidebar workspace-list
   * end fade with the own marker data-dsh-wallpaper-surface so the
   * neutralizer can target them without hashed class names (#734). Idempotent
   * across renders within one mount; untagged on teardown. */
  private markSurfaces(): void {
    const root = this.doc.getElementById('root')
    if (root !== null) {
      const custom = this.options.declareSurface
      // Upstream #712 detector is color-independent (any visible background +
      // min viewport coverage), so no per-sweep token resolution is needed.
      // Custom detectors keep their own (el, doc) signature.
      const isSurface = custom !== undefined
        ? (el: HTMLElement): boolean => custom(el, this.doc)
        : (el: HTMLElement): boolean => defaultWallpaperSurface(el, this.doc)
      const stack: Element[] = [root]
      while (stack.length > 0) {
        const node = stack.pop()
        if (node === undefined) continue
        if (node instanceof HTMLElement && !node.hasAttribute('data-dsh-wallpaper-surface') && isSurface(node)) {
          node.setAttribute('data-dsh-wallpaper-surface', '')
          this.taggedSurfaces.add(node)
        }
        for (const child of Array.from(node.children)) stack.push(child)
      }
    }
    this.markWorkspaceFades()
  }

  /** Tag the sidebar workspaces list-end fade with the same own marker (#734). */
  private markWorkspaceFades(): void {
    const slot = this.doc.querySelector('[data-slot="sidebar.workspaces"]')
    if (slot === null) return
    const isFade = this.options.declareWorkspaceFade ?? defaultWorkspaceFade
    const stack: Element[] = [slot]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === undefined) continue
      if (node instanceof HTMLElement && !node.hasAttribute('data-dsh-wallpaper-surface') && isFade(node, this.doc)) {
        node.setAttribute('data-dsh-wallpaper-surface', '')
        this.taggedSurfaces.add(node)
      }
      for (const child of Array.from(node.children)) stack.push(child)
    }
  }

  /**
   * Watch document.body (subtree) while a wallpaper is active and re-tag only
   * the surfaces affected by each mutation. Navigation rebuilds #root by
   * replacing its children, so the added subtrees are scanned instead of the
   * whole tree; removed nodes are untagged immediately. This avoids repeated
   * full-tree scans and forced layout during chat streaming (#review).
   */
  private ensureSurfaceObserver(): void {
    if (this.disposed || this.surfaceObserver !== null) return
    const win = this.doc.defaultView
    if (win === null || typeof win.MutationObserver !== 'function') return
    this.surfaceObserver = new win.MutationObserver((records) => this.handleSurfaceMutations(records))
    this.surfaceObserver.observe(this.doc.body, { childList: true, subtree: true })
  }

  /** Incrementally tag added subtrees and untag removed subtrees. */
  private handleSurfaceMutations(records: MutationRecord[]): void {
    if (this.disposed || (this.previewing ?? this.applied) === null) return
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) this.tagAddedSubtree(node)
      }
      for (const node of record.removedNodes) {
        if (node instanceof HTMLElement) this.untagRemovedSubtree(node)
      }
    }
  }

  /** Tag newly added elements that qualify as full-viewport surfaces or workspace fades. */
  private tagAddedSubtree(root: HTMLElement): void {
    const isSurface = this.options.declareSurface !== undefined
      ? (el: HTMLElement): boolean => this.options.declareSurface!(el, this.doc)
      : (el: HTMLElement): boolean => defaultWallpaperSurface(el, this.doc)
    const isFade = this.options.declareWorkspaceFade ?? defaultWorkspaceFade
    const stack: HTMLElement[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === undefined) continue
      if (!node.hasAttribute('data-dsh-wallpaper-surface')) {
        const inWallpaperLayer = node.closest('[data-dsh-wallpaper-layer]') !== null
        const inWorkspaces = node.closest('[data-slot="sidebar.workspaces"]') !== null
        if (!inWallpaperLayer && (isSurface(node) || (inWorkspaces && isFade(node, this.doc)))) {
          node.setAttribute('data-dsh-wallpaper-surface', '')
          this.taggedSurfaces.add(node)
        }
      }
      for (const child of Array.from(node.children)) {
        if (child instanceof HTMLElement) stack.push(child)
      }
    }
  }

  /** Remove tags from a removed subtree and drop its references. */
  private untagRemovedSubtree(root: HTMLElement): void {
    const stack: HTMLElement[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === undefined) continue
      if (node.hasAttribute('data-dsh-wallpaper-surface')) {
        node.removeAttribute('data-dsh-wallpaper-surface')
        this.taggedSurfaces.delete(node)
      }
      for (const child of Array.from(node.children)) {
        if (child instanceof HTMLElement) stack.push(child)
      }
    }
  }

  private untagSurfaces(): void {
    for (const el of Array.from(this.taggedSurfaces)) el.removeAttribute('data-dsh-wallpaper-surface')
    this.taggedSurfaces.clear()
  }

  private teardownLayers(): void {
    this.releaseCaptureVideo()
    this.surfaceObserver?.disconnect()
    this.surfaceObserver = null
    this.untagSurfaces()
    delete this.doc.body.dataset.dshWallpaperActive
    delete this.doc.documentElement.dataset.dshWallpaperActive
    setSceneBackdropActive(this.doc, 'wallpaper', false)
    if (this.rootNeutralizer !== null) {
      this.rootNeutralizer.remove()
      this.rootNeutralizer = null
    }
    if (this.videoElement !== null) {
      this.videoElement.pause()
      this.videoElement = null
    }
    if (this.mediaLayer !== null) {
      this.mediaLayer.remove()
      this.mediaLayer = null
    }
    if (this.scrimLayer !== null) {
      this.scrimLayer.remove()
      this.scrimLayer = null
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Resolve a persisted selection id against an inventory list: exact id first, then the imported copy. */
export function resolveSelection(wallpapers: WallpaperDescriptor[], selection: string): WallpaperDescriptor | undefined {
  return wallpapers.find(w => w.id === selection)
    ?? wallpapers.find(w => w.id === 'imported/' + selection)
}

/**
 * Restore the persisted wallpaper selection at boot: resolve it against the
 * host inventory and mount it, without waiting for the skin-center panel to
 * open — the panel's mount effect is the only other sync() caller, so a page
 * load with a persisted selection otherwise renders nothing until the card
 * is opened. Best-effort and idempotent: the first non-empty selection wins;
 * the panel re-resolves on open if the inventory is still in flight or fails.
 */
export function installBootRestore(wallpaper: WallpaperHandle): void {
  let synced = false
  const restore = (): void => {
    if (synced) return
    const selected = wallpaper.selection()
    if (selected === '') return
    synced = true
    void (async () => {
      try {
        const response = await fetch('/api/skin-center/we/inventory')
        if (!response.ok) return
        const payload = await response.json().catch(() => null) as { ok?: boolean; wallpapers?: WallpaperDescriptor[] } | null
        if (payload?.ok !== true || !Array.isArray(payload.wallpapers)) return
        const match = resolveSelection(payload.wallpapers, selected)
        if (match !== undefined) wallpaper.sync(match)
      } catch {
        // Best-effort: the panel re-resolves on open.
      }
    })()
  }
  restore()
  wallpaper.subscribe(restore)
}
