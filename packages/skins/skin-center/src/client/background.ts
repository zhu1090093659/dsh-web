/**
 * Background-scrim handle for the skin center: applies the chosen occlusion
 * to the page's backdrop, plus an optional per-state Gaussian blur of that
 * backdrop.
 *
 * Occlusion is a CSS variable on `document.body` (--dsw-skin-scrim), which
 * backdrop-painting skins (blue-fantasy / whale-song) read inside their
 * setBackdrop() so the veil stays in sync across theme flips and try-on
 * restores. The official stock look paints no backdrop, so the variable is
 * inert there — the value still persists so it is ready for the next backdrop
 * skin.
 *
 * The Gaussian blur targets the same painted backdrop through a fixed child
 * of `document.body` using backdrop-filter: it samples the body's own
 * background painted behind it. Separate strengths apply to the empty
 * conversation and the conversation-with-content states, detected from the
 * shell's stable message-row class suffixes (hash prefix varies, suffix is
 * stable). When the active blur is 0 no element exists, so there is no GPU
 * cost. Blur never changes the occlusion behavior above.
 *
 * Occlusion values are 0-100 (0 = no extra veil, 100 = fully obscured); they
 * are written through as a 0..1 alpha for the CSS variable. Blur values are
 * 0-20 px. Dragging the controls applies instantly (live).
 *
 * Persistence (issue #996): the controller owns no settings scope — the
 * remote pairing channel fences settings.* as loopback-only, which is what
 * stranded remote clients on defaults. The caller hands in the initial
 * values and a `persist` callback (the v2 /active channel); later external
 * edits (the official settings page locally, the refetched state remotely)
 * arrive through `init()`.
 */
import {
  resolveSkinBackground,
  SKIN_BACKGROUND_DEFAULTS,
  type SkinBackgroundConfig,
} from '../core/background.ts'

/** The namespace string the Host registers (mirrors src/index.ts). */
export const SKIN_BACKGROUND_NS = 'skin-background'

/** Field of the background value inside the namespace section. */
export const OPACITY_FIELD = 'backgroundOpacity'

/** Field of the empty-conversation backdrop blur inside the namespace section. */
export const BLUR_EMPTY_FIELD = 'backgroundBlurEmpty'

/** Field of the with-content backdrop blur inside the namespace section. */
export const BLUR_CONTENT_FIELD = 'backgroundBlurContent'

/** Field of the composer card backdrop blur inside the namespace section. */
export const INPUT_CARD_BLUR_FIELD = 'inputCardBlur'

/** CSS custom property written to document.body and read by backdrop skins. */
export const SCRIM_VAR = '--dsw-skin-scrim'

/** Field of the message bubble opacity inside the namespace section. */
export const BUBBLE_OPACITY_FIELD = 'bubbleOpacity'

/** CSS custom property consumed by skins that expose translucent bubbles. */
export const BUBBLE_ALPHA_VAR = '--dsh-skin-bubble-alpha'

/** CSS custom property consumed by the shared composer neutralizer. */
export const INPUT_CARD_BLUR_VAR = '--dsh-input-card-blur'

/** Default occlusion (0 = no extra veil) when the section carries none. */
export const DEFAULT_OPACITY = SKIN_BACKGROUND_DEFAULTS.backgroundOpacity

/** Default message bubble opacity percentage. */
export const DEFAULT_BUBBLE_OPACITY = SKIN_BACKGROUND_DEFAULTS.bubbleOpacity

/** Default blur (0 = disabled) when the section carries none. */
export const DEFAULT_BLUR = SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty

/** The face the skin-center card injects for the background control. */
export interface SkinBackgroundHandle {
  /** Current master switch (true when the plugin is on). */
  enabled(): boolean
  /** Toggle + persist the master switch. */
  setEnabled(value: boolean): void
  /** Current occlusion 0-100 (also the getSnapshot seat for useSyncExternalStore). */
  opacity(): number
  /** Current empty-conversation backdrop blur 0-20 px. */
  blurEmpty(): number
  /** Current with-content backdrop blur 0-20 px. */
  blurContent(): number
  /** Current input-card backdrop blur 0-20 px. */
  inputCardBlur(): number
  /** Current message bubble opacity 0-100. */
  bubbleOpacity(): number
  /** Observe a change in the applied values. */
  subscribe(listener: () => void): () => void
  /** Apply + persist a new occlusion. */
  set(opacity: number): void
  /** Apply + persist a new empty-conversation backdrop blur (0-20 px). */
  setBlurEmpty(value: number): void
  /** Apply + persist a new with-content backdrop blur (0-20 px). */
  setBlurContent(value: number): void
  /** Apply + persist a new input-card backdrop blur (0-20 px). */
  setInputCardBlur(value: number): void
  /** Apply + persist a new message bubble opacity (0-100). */
  setBubbleOpacity(value: number): void
  /** Tear down the blur element and MutationObserver. */
  dispose(): void
}

/**
 * Selector for a conversation message row inside the shell's center column.
 * Official shell message rows carry `data-chat-anchor-key`; the
 * `data-pane="conversation"` attribute is stamped by the dsh-web-all compat
 * shim on the center column, where the _userRow / _compactionRow /
 * _contextRow / _turnErrorRow suffixes are CSS-module message-row classes
 * (hash prefix varies, suffix is stable).
 */
const CONVERSATION_CONTENT_SELECTOR = [
  '[data-chat-anchor-key]',
  '[data-pane="conversation"] [class*="_userRow"]',
  '[data-pane="conversation"] [class*="_compactionRow"]',
  '[data-pane="conversation"] [class*="_contextRow"]',
  '[data-pane="conversation"] [class*="_turnErrorRow"]',
].join(', ')

/**
 * Own the background preference set: apply the values to the body instantly
 * and persist user edits through the caller-provided channel.
 */
export class BackgroundController implements SkinBackgroundHandle {
  private enabledValue = SKIN_BACKGROUND_DEFAULTS.enabled
  private opacityValue = SKIN_BACKGROUND_DEFAULTS.backgroundOpacity
  private blurEmptyValue = SKIN_BACKGROUND_DEFAULTS.backgroundBlurEmpty
  private blurContentValue = SKIN_BACKGROUND_DEFAULTS.backgroundBlurContent
  private inputCardBlurValue = SKIN_BACKGROUND_DEFAULTS.inputCardBlur
  private bubbleOpacityValue = SKIN_BACKGROUND_DEFAULTS.bubbleOpacity
  private readonly listeners = new Set<() => void>()
  private readonly persist: (next: SkinBackgroundConfig) => void
  /** The fixed backdrop-filter element, present only while active blur > 0. */
  private blurElement: HTMLDivElement | null = null
  /** The body MutationObserver, installed lazily once a blur is active. */
  private observer: MutationObserver | null = null
  /** Pending requestAnimationFrame id for a coalesced recheck. */
  private rafId: number | null = null
  /** Guard: after dispose no scheduled work may reinstall anything. */
  private disposed = false

  /**
   * @param initial - values known at construction (the local settings scope
   *   snapshot on loopback); null starts from defaults until init() arrives.
   * @param persist - persistence channel for user edits (v2 /active POST).
   */
  constructor(initial: SkinBackgroundConfig | null, persist: (next: SkinBackgroundConfig) => void) {
    this.persist = persist
    if (initial !== null) this.assign(initial)
    this.applyOcclusion()
    this.applyInputCardBlur()
    this.applyBubbleOpacity()
    this.syncBlur()
  }

  /**
   * Replace the current values with externally sourced ones (the refetched
   * v2 state, or a live settings-scope publish). Never persists — the source
   * already owns the stored copy; the caller decides whether to forward the
   * change into the v2 store.
   */
  init(next: SkinBackgroundConfig | null): void {
    if (this.disposed) return
    this.assign(next ?? {})
    this.applyOcclusion()
    this.applyInputCardBlur()
    this.applyBubbleOpacity()
    this.syncBlur()
    this.publish()
  }

  /** The current values as a persistable config (every field concrete). */
  snapshot(): SkinBackgroundConfig {
    return {
      enabled: this.enabledValue,
      backgroundOpacity: this.opacityValue,
      backgroundBlurEmpty: this.blurEmptyValue,
      backgroundBlurContent: this.blurContentValue,
      inputCardBlur: this.inputCardBlurValue,
      bubbleOpacity: this.bubbleOpacityValue,
    }
  }

  enabled = (): boolean => this.enabledValue

  setEnabled(value: boolean): void {
    this.enabledValue = value
    this.applyOcclusion()
    this.applyInputCardBlur()
    this.applyBubbleOpacity()
    this.syncBlur()
    this.publish()
    this.persist(this.snapshot())
  }

  opacity = (): number => this.opacityValue

  blurEmpty = (): number => this.blurEmptyValue

  blurContent = (): number => this.blurContentValue

  inputCardBlur = (): number => this.inputCardBlurValue

  bubbleOpacity = (): number => this.bubbleOpacityValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(opacity: number): void {
    this.opacityValue = this.clampPercent(opacity)
    this.applyOcclusion()
    this.publish()
    this.persist(this.snapshot())
  }

  setBlurEmpty(value: number): void {
    this.blurEmptyValue = this.clampBlur(value)
    this.ensureObserver()
    this.syncBlur()
    this.publish()
    this.persist(this.snapshot())
  }

  setBlurContent(value: number): void {
    this.blurContentValue = this.clampBlur(value)
    this.ensureObserver()
    this.syncBlur()
    this.publish()
    this.persist(this.snapshot())
  }

  setInputCardBlur(value: number): void {
    this.inputCardBlurValue = this.clampBlur(value)
    this.applyInputCardBlur()
    this.publish()
    this.persist(this.snapshot())
  }

  setBubbleOpacity(value: number): void {
    this.bubbleOpacityValue = this.clampPercent(value)
    this.applyBubbleOpacity()
    this.publish()
    this.persist(this.snapshot())
  }

  dispose(): void {
    this.disposed = true
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.removeBlurElement()
    document.body.style.removeProperty(INPUT_CARD_BLUR_VAR)
    document.body.style.removeProperty(BUBBLE_ALPHA_VAR)
    if (this.observer !== null) {
      this.observer.disconnect()
      this.observer = null
    }
  }

  /** Copy one config into the live fields, defaults filling the gaps. */
  private assign(config: SkinBackgroundConfig): void {
    const resolved = resolveSkinBackground(config)
    this.enabledValue = resolved.enabled
    this.opacityValue = resolved.backgroundOpacity
    this.blurEmptyValue = resolved.backgroundBlurEmpty
    this.blurContentValue = resolved.backgroundBlurContent
    this.inputCardBlurValue = resolved.inputCardBlur
    this.bubbleOpacityValue = resolved.bubbleOpacity
  }

  private clampBlur(value: number): number {
    return Math.max(0, Math.min(20, Math.round(value)))
  }

  private clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)))
  }

  private applyInputCardBlur(): void {
    if (!this.enabledValue) {
      document.body.style.removeProperty(INPUT_CARD_BLUR_VAR)
      return
    }
    document.body.style.setProperty(INPUT_CARD_BLUR_VAR, this.inputCardBlurValue + 'px')
  }

  private applyBubbleOpacity(): void {
    if (!this.enabledValue) {
      document.body.style.removeProperty(BUBBLE_ALPHA_VAR)
      return
    }
    document.body.style.setProperty(BUBBLE_ALPHA_VAR, String(this.bubbleOpacityValue / 100))
  }

  /** Write the current occlusion onto the body CSS variable (0..1 alpha). */
  private applyOcclusion(): void {
    if (!this.enabledValue) {
      document.body.style.removeProperty(SCRIM_VAR)
      return
    }
    document.body.style.setProperty(SCRIM_VAR, String(this.opacityValue / 100))
  }

  /**
   * Apply the active blur: empty or with-content strength depending on the
   * conversation state. A value > 0 ensures the fixed blur element exists
   * with the matching backdrop-filter; 0 removes it.
   */
  private syncBlur(): void {
    if (this.disposed) return
    if (this.hasWallpaper()) {
      // The wallpaper module owns its own blur (wallpaperBlur); the skin-center
      // background blur layer must stay off while a wallpaper is mounted so
      // the two settings remain independent (#777 decouple).
      this.removeBlurElement()
      return
    }
    if (!this.enabledValue) {
      this.removeBlurElement()
      return
    }
    this.ensureObserver()
    const active = this.hasConversationContent() ? this.blurContentValue : this.blurEmptyValue
    if (active > 0) this.ensureBlurElement(active)
    else this.removeBlurElement()
  }

  /** True when the conversation pane hosts at least one message row. */
  private hasConversationContent(): boolean {
    return document.querySelector(CONVERSATION_CONTENT_SELECTOR) !== null
  }

  /** True while a Wallpaper Engine wallpaper is mounted. */
  private hasWallpaper(): boolean {
    return document.documentElement.hasAttribute('data-dsh-wallpaper-active')
  }

  /** Create (if needed) and size the fixed backdrop-filter element. */
  private ensureBlurElement(active: number): void {
    if (this.blurElement === null) {
      const element = document.createElement('div')
      element.style.position = 'fixed'
      element.style.inset = '0'
      element.style.zIndex = '-1'
      element.style.pointerEvents = 'none'
      element.setAttribute('aria-hidden', 'true')
      this.blurElement = element
      document.body.appendChild(element)
    }
    const blur = 'blur(' + active + 'px)'
    this.blurElement.style.backdropFilter = blur
    // Safari: the vendor-prefixed form is only reachable via setProperty.
    this.blurElement.style.setProperty('-webkit-backdrop-filter', blur)
  }

  /** Remove the fixed blur element, if present. */
  private removeBlurElement(): void {
    if (this.blurElement === null) return
    this.blurElement.remove()
    this.blurElement = null
  }

  /**
   * Install the MutationObserver on document.body only when either blur
   * field is active, so a fully-disabled blur never pays the observation
   * cost. Runs lazily on the first non-zero set.
   */
  private ensureObserver(): void {
    if (this.disposed || this.observer !== null) return
    if (this.blurEmptyValue <= 0 && this.blurContentValue <= 0) return
    this.observer = new MutationObserver(() => this.scheduleRecheck())
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    // Also react to the wallpaper marker so the background blur layer is
    // removed/restored exactly when a wallpaper mounts/unmounts.
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-dsh-wallpaper-active'],
    })
  }

  /** Coalesce burst mutations into one rAF-delayed recheck. */
  private scheduleRecheck(): void {
    if (this.disposed || this.rafId !== null) return
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null
      if (this.disposed) return
      this.syncBlur()
    })
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
