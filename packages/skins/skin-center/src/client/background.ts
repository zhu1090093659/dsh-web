/**
 * Background-scrim handle for the skin center: binds the `skin-background`
 * settings namespace and applies the chosen occlusion to the page's backdrop.
 *
 * Application is a CSS variable on `document.body`
 * (--dsw-skin-scrim), which backdrop-painting skins (blue-fantasy /
 * whale-song) read inside their setBackdrop() so the veil stays in sync across
 * theme flips and try-on restores. The official stock look paints no backdrop,
 * so the variable is inert there — the value still persists so it is ready for
 * the next backdrop skin.
 *
 * Values are 0-100 (0 = no extra veil, 100 = fully obscured); they are written
 * through as a 0..1 alpha for the CSS variable. Dragging the control applies
 * instantly (live) and persists through the settings scope.
 */
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

/** The namespace string the Host registers (mirrors src/index.ts). */
export const SKIN_BACKGROUND_NS = 'skin-background'

/** Field of the background value inside the namespace section. */
export const OPACITY_FIELD = 'backgroundOpacity'

/** CSS custom property written to document.body and read by backdrop skins. */
export const SCRIM_VAR = '--dsw-skin-scrim'

/** Default occlusion (0 = no extra veil) when the section carries none. */
export const DEFAULT_OPACITY = 0

/** The face the skin-center card injects for the background control. */
export interface SkinBackgroundHandle {
  /** Current occlusion 0-100 (also the getSnapshot seat for useSyncExternalStore). */
  opacity(): number
  /** Observe a change in the applied value. */
  subscribe(listener: () => void): () => void
  /** Apply + persist a new occlusion. */
  set(opacity: number): void
}

/**
 * Own the skin-background scope: read the latest occlusion, apply it to the
 * body CSS variable instantly, and persist changes through the settings scope.
 */
export class BackgroundController implements SkinBackgroundHandle {
  private value = DEFAULT_OPACITY
  private readonly listeners = new Set<() => void>()
  private readonly scope: SettingsScope<{ backgroundOpacity?: number }>

  /**
   * @param scope - the bound skin-background settings scope.
   */
  constructor(scope: SettingsScope<{ backgroundOpacity?: number }>) {
    this.scope = scope
    this.value = this.read()
    this.apply()
    scope.subscribe(() => {
      this.value = this.read()
      this.apply()
      this.publish()
    })
  }

  opacity(): number { return this.value }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(opacity: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(opacity)))
    this.value = clamped
    this.apply()
    this.publish()
    // Persist: queue the write on the settings scope. Failures are silent —
    // the live value is already applied, and the write drains on reconnect.
    void this.scope.set(OPACITY_FIELD, clamped)
  }

  /** The effective section value, clamped 0-100, defaulting to 0. */
  private read(): number {
    const snapshot: SettingsScopeSnapshot<{ backgroundOpacity?: number }> = this.scope.getSnapshot()
    const raw = snapshot.value?.backgroundOpacity
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_OPACITY
    return Math.max(0, Math.min(100, raw))
  }

  /** Write the current occlusion onto the body CSS variable (0..1 alpha). */
  private apply(): void {
    document.body.style.setProperty(SCRIM_VAR, String(this.value / 100))
  }

  private publish(): void {
    for (const listener of this.listeners) listener()
  }
}
