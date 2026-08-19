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
  previewUrl: string | null
}

/** The persisted wallpaper section shape. */
interface WallpaperSection {
  enabled?: boolean
  selection?: string
  mode?: 'live' | 'frame'
  pauseOnHidden?: boolean
  dim?: number
  wallpaperBlur?: number
  weLibraryDirs?: string[]
}

/** The face the skin-center card injects for the wallpaper feature. */
export interface WallpaperHandle {
  enabled(): boolean
  /** The persisted selection id ('' = none). */
  selection(): string
  mode(): 'live' | 'frame'
  dim(): number
  wallpaperBlur(): number
  pauseOnHidden(): boolean
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
  setDim(value: number): void
  setBlur(value: number): void
  setPauseOnHidden(value: boolean): void
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
function styleCover(element: HTMLElement): void {
  element.style.width = '100%'
  element.style.height = '100%'
  element.style.objectFit = 'cover'
  element.style.border = '0'
  element.style.display = 'block'
}

/** Max static-frame capture edge (the backdrop never needs more pixels). */
const FRAME_MAX_EDGE = 1920

/**
 * Own the skin-wallpaper scope: keep the mounted layers in sync with the
 * persisted selection and the card-driven descriptor resolution.
 */
export class WallpaperController implements WallpaperHandle {
  private enabledValue = true
  private selectionValue = ''
  private modeValue: 'live' | 'frame' = 'live'
  private pauseOnHiddenValue = true
  private dimValue = 25
  private blurValue = 0
  private dirsValue: string[] = []
  private readonly listeners = new Set<() => void>()
  private readonly scope: SettingsScope<WallpaperSection>

  /** The descriptor of the applied selection, resolved by the card. */
  private applied: WallpaperDescriptor | null = null
  /** The try-on descriptor while a preview is up. */
  private previewing: WallpaperDescriptor | null = null

  private mediaLayer: HTMLDivElement | null = null
  private scrimLayer: HTMLDivElement | null = null
  private videoElement: HTMLVideoElement | null = null
  private rootNeutralizer: HTMLStyleElement | null = null
  private disposed = false

  constructor(scope: SettingsScope<WallpaperSection>) {
    this.scope = scope
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
    document.addEventListener('visibilitychange', this.onVisibility)
    if (this.enabledValue && this.selectionValue) {
      this.fetchAndSync()
    }
  }

  private fetchAndSync(): void {
    if (!this.selectionValue) return
    const targetId = this.selectionValue
    fetch('/api/skin-center/we/inventory')
      .then(async (response) => {
        if (this.disposed || !response.ok) return
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean
          wallpapers?: WallpaperDescriptor[]
        } | null
        if (payload?.ok === true && Array.isArray(payload.wallpapers)) {
          const item = payload.wallpapers.find((w) => w.id === targetId)
          if (item && this.selectionValue === targetId) {
            this.applied = {
              id: item.id,
              title: item.title,
              type: item.type,
              videoUrl: item.videoUrl,
              webUrl: item.webUrl,
              frameUrl: item.frameUrl,
              previewUrl: item.previewUrl,
            }
            this.render()
            this.publish()
          }
        }
      })
      .catch(() => {
        // Fail-silent on network errors
      })
  }

  enabled(): boolean { return this.enabledValue }
  selection(): string { return this.selectionValue }
  mode(): 'live' | 'frame' { return this.modeValue }
  dim(): number { return this.dimValue }
  wallpaperBlur(): number { return this.blurValue }
  pauseOnHidden(): boolean { return this.pauseOnHiddenValue }
  dirs(): string[] { return this.dirsValue }

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

  activeId(): string | null {
    const current = this.previewing ?? this.applied
    return this.mediaLayer !== null && current !== null ? current.id : null
  }
  trying(): boolean { return this.previewing !== null }

  subscribe(listener: () => void): () => void {
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
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.teardownLayers()
  }

  // --- internals -----------------------------------------------------------

  private readAll(): void {
    const snapshot: SettingsScopeSnapshot<WallpaperSection> = this.scope.getSnapshot()
    const value = snapshot.value ?? {}
    this.enabledValue = typeof value.enabled === 'boolean' ? value.enabled : true
    this.selectionValue = typeof value.selection === 'string' ? value.selection : ''
    this.modeValue = value.mode === 'frame' ? 'frame' : 'live'
    this.pauseOnHiddenValue = typeof value.pauseOnHidden === 'boolean' ? value.pauseOnHidden : true
    this.dimValue = typeof value.dim === 'number' && Number.isFinite(value.dim) ? clamp(value.dim, 0, 90) : 25
    this.blurValue = typeof value.wallpaperBlur === 'number' && Number.isFinite(value.wallpaperBlur)
      ? clamp(value.wallpaperBlur, 0, 60)
      : 0
    this.dirsValue = Array.isArray(value.weLibraryDirs)
      ? value.weLibraryDirs.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      : []
  }

  private readonly onVisibility = (): void => {
    if (this.videoElement === null || !this.pauseOnHiddenValue) return
    if (document.hidden) {
      this.videoElement.pause()
    } else {
      // jsdom (and older engines) return undefined, real browsers a promise.
      void this.videoElement.play()?.catch(() => { /* autoplay policy */ })
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
    // The stock shell paints an opaque background on the app root, which
    // fully covers the negative-z wallpaper layers (issue #505). Neutralize
    // it while a wallpaper is mounted — the same contract the v2 skin CSS
    // pipeline appends for every skin (`[id="root"] { background:
    // transparent }`). The id selector outranks the shell's class rule, and
    // the token itself is left untouched so every other --dsw-alias-bg-base
    // consumer keeps its color.
    if (this.rootNeutralizer === null) {
      this.rootNeutralizer = document.createElement('style')
      this.rootNeutralizer.dataset.dshWallpaperRoot = ''
      this.rootNeutralizer.textContent = `
        [id="root"] { background: transparent; }
        html[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active],
        html[data-dsh-skin][data-dsh-wallpaper-active] body,
        html[data-dsh-skin] body[data-dsh-wallpaper-active],
        body[data-dsh-wallpaper-active][data-ds-dark-theme],
        html[data-dsh-wallpaper-active] #root,
        html[data-dsh-wallpaper-active] [id="root"] {
          background-color: transparent !important;
        }
      `
      document.head.appendChild(this.rootNeutralizer)
    }
    document.body.dataset.dshWallpaperActive = 'true'
    document.documentElement.dataset.dshWallpaperActive = 'true'
    if (this.mediaLayer === null) {
      this.mediaLayer = document.createElement('div')
      styleLayer(this.mediaLayer, -3)
      document.body.appendChild(this.mediaLayer)
    }
    if (this.scrimLayer === null) {
      this.scrimLayer = document.createElement('div')
      styleLayer(this.scrimLayer, -2)
      document.body.appendChild(this.scrimLayer)
    }
    const mediaKey = descriptor.id + ':' + this.modeValue
    if (this.mediaLayer.dataset.mediaKey !== mediaKey) {
      this.mediaLayer.dataset.mediaKey = mediaKey
      this.mediaLayer.replaceChildren()
      this.videoElement = null
      const child = this.buildMedia(descriptor)
      if (child !== null) this.mediaLayer.appendChild(child)
    }
    // Blur the wallpaper itself (the -1 backdrop-filter element stays the
    // skin-center blur control's business and blurs everything behind).
    const blur = this.blurValue > 0 ? 'blur(' + String(this.blurValue) + 'px)' : ''
    this.mediaLayer.style.filter = blur
    this.mediaLayer.style.transform = this.blurValue > 0 ? 'scale(1.05)' : ''
    this.scrimLayer.style.background = 'rgba(0, 0, 0, ' + String(this.dimValue / 100) + ')'
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
        const iframe = document.createElement('iframe')
        iframe.src = descriptor.webUrl
        // Web wallpapers are the user's own installed local content (the
        // same trust Wallpaper Engine extends to them); scripts + same-origin
        // are required for textures/canvas/WebGL. Navigation, popups and
        // downloads stay blocked.
        iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
        iframe.setAttribute('tabindex', '-1')
        styleCover(iframe)
        return iframe
      }
      return this.buildImage(descriptor.previewUrl)
    }
    if (descriptor.type === 'scene') {
      // The host frame decode can still fail (422): fall back to the preview
      // image instead of leaving a blank layer (#521).
      return this.buildImage(descriptor.frameUrl ?? descriptor.previewUrl, descriptor.previewUrl)
    }
    return this.buildImage(descriptor.previewUrl)
  }

  private buildVideo(url: string): HTMLVideoElement {
    const video = document.createElement('video')
    video.src = url
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-hidden', 'true')
    styleCover(video)
    this.videoElement = video
    // jsdom (and older engines) return undefined, real browsers a promise.
    void video.play()?.catch(() => { /* autoplay policy: stays paused */ })
    return video
  }

  /** Static-frame mode for video: capture the first frame into an image. */
  private buildVideoFrame(url: string, previewUrl: string | null): HTMLElement {
    const image = document.createElement('img')
    styleCover(image)
    if (previewUrl !== null) image.src = previewUrl
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    video.addEventListener('loadeddata', () => {
      try {
        const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas')
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
    const image = document.createElement('img')
    image.src = url
    image.alt = ''
    if (fallbackUrl !== null && fallbackUrl !== url) {
      image.addEventListener('error', () => {
        image.src = fallbackUrl
      }, { once: true })
    }
    styleCover(image)
    return image
  }

  private teardownLayers(): void {
    delete document.body.dataset.dshWallpaperActive
    delete document.documentElement.dataset.dshWallpaperActive
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
