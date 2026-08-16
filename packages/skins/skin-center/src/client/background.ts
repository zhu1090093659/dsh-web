/**
 * Background-scrim handle for the skin center: binds the `skin-background`
 * settings namespace and applies the chosen occlusion to the page's backdrop,
 * plus an optional per-state Gaussian blur of that backdrop.
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
 * 0-20 px. Dragging the controls applies instantly (live) and persists
 * through the settings scope.
 */
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** The namespace string the Host registers (mirrors src/index.ts). */
export const SKIN_BACKGROUND_NS = 'skin-background'

/** Field of the background value inside the namespace section. */
export const OPACITY_FIELD = 'backgroundOpacity'

/** Field of the empty-conversation backdrop blur inside the namespace section. */
export const BLUR_EMPTY_FIELD = 'backgroundBlurEmpty'

/** Field of the with-content backdrop blur inside the namespace section. */
export const BLUR_CONTENT_FIELD = 'backgroundBlurContent'

/** CSS custom property written to document.body and read by backdrop skins. */
export const SCRIM_VAR = '--dsw-skin-scrim'

/** Default occlusion (0 = no extra veil) when the section carries none. */
export const DEFAULT_OPACITY = 0

/** Default blur (0 = disabled) when the section carries none. */
export const DEFAULT_BLUR = 0

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
  /** Observe a change in the applied values. */
  subscribe(listener: () => void): () => void
  /** Apply + persist a new occlusion. */
  set(opacity: number): void
  /** Apply + persist a new empty-conversation backdrop blur (0-20 px). */
  setBlurEmpty(value: number): void
  /** Apply + persist a new with-content backdrop blur (0-20 px). */
  setBlurContent(value: number): void
  /** Tear down the blur element and MutationObserver. */
  dispose(): void
}

/**
 * Selector for a conversation message row inside the shell's center column.
 * The `data-pane="conversation"` attribute is stamped by the dsh-web-ui-all
 * compat shim on the center column; the _userRow / _compactionRow /
 * _contextRow / _turnErrorRow suffixes are the official shell's CSS-module
 * hashed message-row classes (hash prefix varies, suffix is stable). Stable
 * like the repo's compat shim, not hash-dependent.
 */
const CONVERSATION_CONTENT_SELECTOR = [
  '[data-pane="conversation"] [class*="_userRow"]',
  '[data-pane="conversation"] [class*="_compactionRow"]',
  '[data-pane="conversation"] [class*="_contextRow"]',
  '[data-pane="conversation"] [class*="_turnErrorRow"]',
].join(', ')

/**
 * Own the skin-background scope: read the latest occlusion + blur strengths,
 * apply them to the body instantly, and persist changes through the settings
 * scope.
 */
export class BackgroundController implements SkinBackgroundHandle {
  private enabledValue = true
  private opacityValue = DEFAULT_OPACITY
  private blurEmptyValue = DEFAULT_BLUR
  private blurContentValue = DEFAULT_BLUR
  private readonly listeners = new Set<() => void>()
  private readonly scope: SettingsScope<{
    enabled?: boolean
    backgroundOpacity?: number
    backgroundBlurEmpty?: number
    backgroundBlurContent?: number
  }>
  /** The fixed backdrop-filter element, present only while active blur > 0. */
  private blurElement: HTMLDivElement | null = null
  /** The body MutationObserver, installed lazily once a blur is active. */
  private observer: MutationObserver | null = null
  /** Pending requestAnimationFrame id for a coalesced recheck. */
  private rafId: number | null = null
  /** Guard: after dispose no scheduled work may reinstall anything. */
  private disposed = false

  /**
   * @param scope - the bound skin-background settings scope.
   */
  constructor(scope: SettingsScope<{
    enabled?: boolean
    backgroundOpacity?: number
    backgroundBlurEmpty?: number
    backgroundBlurContent?: number
  }>) {
    this.scope = scope
    this.enabledValue = this.readEnabled()
    this.opacityValue = this.readOpacity()
    this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD)
    this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD)
    this.applyOcclusion()
    this.syncBlur()
    scope.subscribe(() => {
      this.enabledValue = this.readEnabled()
      this.opacityValue = this.readOpacity()
      this.blurEmptyValue = this.readBlur(BLUR_EMPTY_FIELD)
      this.blurContentValue = this.readBlur(BLUR_CONTENT_FIELD)
      this.applyOcclusion()
      this.syncBlur()
      this.publish()
    })
  }

  enabled(): boolean { return this.enabledValue }

  setEnabled(value: boolean): void {
    this.enabledValue = value
    this.applyOcclusion()
    this.syncBlur()
    this.publish()
    void this.scope.set('enabled', value)
  }

  opacity(): number { return this.opacityValue }

  blurEmpty(): number { return this.blurEmptyValue }

  blurContent(): number { return this.blurContentValue }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(opacity: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(opacity)))
    this.opacityValue = clamped
    this.applyOcclusion()
    this.publish()
    // Persist: queue the write on the settings scope. Failures are silent —
    // the live value is already applied, and the write drains on reconnect.
    void this.scope.set(OPACITY_FIELD, clamped)
  }

  setBlurEmpty(value: number): void {
    const clamped = this.clampBlur(value)
    this.blurEmptyValue = clamped
    this.ensureObserver()
    this.syncBlur()
    this.publish()
    void this.scope.set(BLUR_EMPTY_FIELD, clamped)
  }

  setBlurContent(value: number): void {
    const clamped = this.clampBlur(value)
    this.blurContentValue = clamped
    this.ensureObserver()
    this.syncBlur()
    this.publish()
    void this.scope.set(BLUR_CONTENT_FIELD, clamped)
  }

  dispose(): void {
    this.disposed = true
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.removeBlurElement()
    if (this.observer !== null) {
      this.observer.disconnect()
      this.observer = null
    }
  }

  /** The effective master-switch section value, defaulting to true when absent. */
  private readEnabled(): boolean {
    const snapshot: SettingsScopeSnapshot<{ enabled?: boolean }> = this.scope.getSnapshot()
    const raw = snapshot.value?.enabled
    return typeof raw !== 'boolean' ? true : raw
  }

  /** The effective occlusion section value, clamped 0-100, defaulting to 0. */
  private readOpacity(): number {
    const snapshot: SettingsScopeSnapshot<{ backgroundOpacity?: number }> = this.scope.getSnapshot()
    const raw = snapshot.value?.backgroundOpacity
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_OPACITY
    return Math.max(0, Math.min(100, raw))
  }

  /** The effective blur section value for one field, clamped 0-20, defaulting to 0. */
  private readBlur(field: 'backgroundBlurEmpty' | 'backgroundBlurContent'): number {
    const snapshot: SettingsScopeSnapshot<{
      backgroundBlurEmpty?: number
      backgroundBlurContent?: number
    }> = this.scope.getSnapshot()
    const raw = snapshot.value?.[field]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_BLUR
    return this.clampBlur(raw)
  }

  private clampBlur(value: number): number {
    return Math.max(0, Math.min(20, Math.round(value)))
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
