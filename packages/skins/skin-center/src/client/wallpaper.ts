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
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** The namespace string the Host registers (mirrors src/index.ts). */
export const SKIN_WALLPAPER_NS = 'skin-wallpaper'

/** One wallpaper's render contract, as delivered by the inventory route. */
export interface WallpaperDescriptor {
  id: string
  title: string
  type: 'video' | 'web' | 'scene' | 'application'
  videoUrl: string | null
  webUrl: string | null
  frameUrl: string | null
  sceneUrl?: string | null
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
  dispose(): void
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)))

/** Style one fixed, non-interactive, under-everything layer. */
function styleLayer(element: HTMLElement, zIndex: number): void {
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

/**
 * Default full-viewport-surface detector for WE wallpaper neutralization
 * (#734): an element is a shell surface when it is exactly the viewport
 * height (100% / 100vh) AND its computed background-color equals the resolved
 * --dsw-alias-bg-base color. That matches the official shell frame/root
 * containers (AppFrame, conversation root, details root) which paint the app
 * base background at full height and only carry hashed CSS-module classes, so
 * this selector-free check never depends on class names. Returns false when
 * the token cannot be resolved.
 */
export function defaultWallpaperSurface(el: HTMLElement, doc: Document): boolean {
  const win = doc.defaultView
  if (win === null) return false
  let height = ''
  let background = ''
  try {
    const cs = win.getComputedStyle(el)
    height = cs.height
    background = cs.backgroundColor
  } catch {
    return false
  }
  if (height !== '100%' && height !== '100vh') return false
  const base = resolveCssColor(doc, '--dsw-alias-bg-base')
  return base !== null && background === base
}

/** Resolve a color custom property to its computed CSS color, if any. */
function resolveCssColor(doc: Document, name: string): string | null {
  const win = doc.defaultView
  if (win === null || doc.documentElement === null) return null
  const raw = win.getComputedStyle(doc.documentElement).getPropertyValue(name).trim()
  if (raw === '') return null
  const probe = doc.createElement('div')
  probe.style.setProperty('background-color', raw)
  doc.documentElement.appendChild(probe)
  try {
    return win.getComputedStyle(probe).backgroundColor
  } catch {
    return null
  } finally {
    probe.remove()
  }
}

export interface WallpaperControllerOptions {
  apiBase?: string
  fetchImpl?: typeof fetch
  doc?: Document
  /** Override the full-viewport-surface detector (tests); defaults to the
   * computed-style heuristic in defaultWallpaperSurface. */
  declareSurface?: (el: HTMLElement, doc: Document) => boolean
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
  private dirsValue: string[] = []
  private readonly listeners = new Set<() => void>()
  private readonly scope: SettingsScope<WallpaperSection>
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
  /** Shell surfaces tagged with data-dsh-wallpaper-surface during this mount. */
  private taggedSurfaces: HTMLElement[] = []
  private disposed = false

  constructor(scope: SettingsScope<WallpaperSection>, options: WallpaperControllerOptions = {}) {
    this.scope = scope
    this.options = options
    this.doc = options.doc ?? document
    this.readAll()
    scope.subscribe(() => {
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
    // Audible autoplay stays blocked until the first user gesture; retry
    // play() on that gesture so an unmuted live wallpaper starts (#580).
    this.doc.addEventListener('pointerdown', this.onFirstGesture)
    this.doc.addEventListener('keydown', this.onFirstGesture)
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
          }
        }
      })
      .catch(() => {
        // Fail-silent on network errors
      })
  }

  enabled = (): boolean => this.enabledValue
  selection = (): string => this.selectionValue
  mode = (): 'live' | 'frame' => this.modeValue
  fit = (): 'cover' | 'contain' | 'fill' => this.fitValue
  dim = (): number => this.dimValue
  wallpaperBlur = (): number => this.blurValue
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
    this.applied = descriptor
    this.previewing = null
    this.selectionValue = descriptor.id
    this.render()
    this.publish()
    void this.scope.set('selection', descriptor.id)
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
    this.applied = descriptor
    this.render()
  }

  tryOn(descriptor: WallpaperDescriptor): void {
    this.previewing = descriptor
    this.render()
    this.publish()
  }

  exitTryOn(): void {
    if (this.previewing === null) return
    this.previewing = null
    this.render()
    this.publish()
  }

  dispose(): void {
    this.disposed = true
    this.doc.removeEventListener('visibilitychange', this.onVisibility)
    this.doc.removeEventListener('pointerdown', this.onFirstGesture)
    this.doc.removeEventListener('keydown', this.onFirstGesture)
    this.teardownLayers()
  }

  // --- internals -----------------------------------------------------------

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
        scenePlayer.contentWindow?.postMessage({ type: 'dsh-set-pause', paused: this.doc.hidden }, window.location.origin)
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
        html[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active] body,
        html[data-dsh-skin] body[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active][data-ds-dark-theme],
        html[data-dsh-wallpaper-active] [id="root"] {
          background-color: transparent !important;
          background-image: none !important;
        }
        /* The composer seat paints an opaque base fade under the input card
           (rc.8: a linear gradient to --dsw-alias-bg-base, z-index 7).
           Remove it while the WE wallpaper is mounted so the backdrop shows
           behind the input area (issue #734). It is anchored on the stable
           semantic attribute data-composer-seat that the official shell
           outputs, so it does not depend on hashed class names. */
        html[data-dsh-wallpaper-active] [data-composer-seat] {
          background: none !important;
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
    this.markSurfaces()
    if (this.mediaLayer === null) {
      this.mediaLayer = this.doc.createElement('div')
      styleLayer(this.mediaLayer, -3)
      this.doc.body.appendChild(this.mediaLayer)
    }
    if (this.scrimLayer === null) {
      this.scrimLayer = this.doc.createElement('div')
      styleLayer(this.scrimLayer, -2)
      this.doc.body.appendChild(this.scrimLayer)
    }
    const mediaKey = descriptor.id + ':' + this.modeValue
    if (this.mediaLayer.dataset.mediaKey !== mediaKey) {
      this.mediaLayer.dataset.mediaKey = mediaKey
      this.mediaLayer.replaceChildren()
      this.videoElement = null
      const child = this.buildMedia(descriptor)
      if (child !== null) this.mediaLayer.appendChild(child)
    }
    // Sizing mode changes apply in place: rebuilding would restart video
    // playback and re-parse the scene on every click (#717 follow-up).
    this.applyFit()
    // Blur the wallpaper itself (the -1 backdrop-filter element stays the
    // skin-center blur control's business and blurs everything behind).
    const blur = this.blurValue > 0 ? 'blur(' + String(this.blurValue) + 'px)' : ''
    this.mediaLayer.style.filter = blur
    this.mediaLayer.style.transform = this.blurValue > 0 ? 'scale(1.05)' : ''
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
        child.contentWindow?.postMessage({ type: 'dsh-set-fit', fit: this.fitValue }, window.location.origin)
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
        // Web wallpapers are the user's own installed local content (the
        // same trust Wallpaper Engine extends to them); scripts + same-origin
        // are required for textures/canvas/WebGL. Navigation, popups and
        // downloads stay blocked.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
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
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        iframe.setAttribute('tabindex', '-1')
        iframe.dataset.dshScenePlayer = ''
        styleCover(iframe, this.fitValue)
        iframe.addEventListener('load', () => {
          try {
            iframe.contentWindow?.postMessage({ type: 'dsh-set-fit', fit: this.fitValue }, window.location.origin)
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
    video.addEventListener('loadeddata', () => {
      try {
        const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
        const canvas = this.doc.createElement('canvas')
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
        const context = canvas.getContext('2d')
        if (context === null) return
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        image.src = canvas.toDataURL('image/jpeg', 0.85)
        // Stop buffering: the capture is done, the hidden video must not
        // keep streaming the file.
        video.removeAttribute('src')
        video.load()
      } catch {
        // Capture failed (codec/format): the preview image stays.
      }
    }, { once: true })
    return image
  }

  private buildImage(url: string | null, fallbackUrl: string | null = null): HTMLElement | null {
    if (url === null) return null
    const image = this.doc.createElement('img')
    image.src = url
    image.alt = ''
    if (fallbackUrl !== null && fallbackUrl !== url) {
      image.addEventListener('error', () => {
        if (image.src !== fallbackUrl) {
          image.src = fallbackUrl
        }
      }, { once: true })
    }
    styleCover(image, this.fitValue)
    return image
  }

  /** Tag the official shell full-viewport background surfaces (AppFrame
   * frame, conversation root, details root) with the own marker
   * data-dsh-wallpaper-surface so the neutralizer can target them without
   * hashed class names (#734). Idempotent across renders within one mount;
   * untagged on teardown. */
  private markSurfaces(): void {
    const root = this.doc.getElementById('root')
    if (root === null) return
    const isSurface = this.options.declareSurface ?? defaultWallpaperSurface
    const stack: Element[] = [root]
    while (stack.length > 0) {
      const node = stack.pop()
      if (node === undefined) continue
      if (node instanceof HTMLElement && !node.hasAttribute('data-dsh-wallpaper-surface') && isSurface(node, this.doc)) {
        node.setAttribute('data-dsh-wallpaper-surface', '')
        this.taggedSurfaces.push(node)
      }
      for (const child of Array.from(node.children)) stack.push(child)
    }
  }

  private untagSurfaces(): void {
    for (const el of this.taggedSurfaces) el.removeAttribute('data-dsh-wallpaper-surface')
    this.taggedSurfaces = []
  }

  private teardownLayers(): void {
    this.untagSurfaces()
    delete this.doc.body.dataset.dshWallpaperActive
    delete this.doc.documentElement.dataset.dshWallpaperActive
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
