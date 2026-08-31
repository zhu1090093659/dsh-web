/**
 * Shared panel helpers: the active-dictionary pick (document-language based,
 * task-board precedent) bound to the dsh-ssh interpolator in locales.ts, plus
 * a small error-message extractor. All copy stays in the locale dictionaries.
 */
import { en, t, zh, type SshKey } from '../locales.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

/**
 * SDK translate seat wired by the browser apply() once ctx.locale is bound
 * (setRuntimeTranslate): reads the ACTIVE locale at call time, so plain-DOM
 * surfaces follow a runtime language switch. The document-language pick stays
 * as the unwired fallback (locale service absent, module-scope early callers).
 */
let runtimeT: ((key: SshKey, values?: TranslateValues) => string) | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: ((key: SshKey, values?: TranslateValues) => string) | undefined): void {
  runtimeT = t
}

/** Translate a key with optional {name} template params (current language). */
export function tt(key: SshKey, values?: TranslateValues): string {
  if (runtimeT !== undefined) return runtimeT(key, values)
  return t(dictionary(), key, values)
}

/** Human-readable error text from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * The terminal font stack used before issue #577, kept as the last resort
 * when neither the plugin setting nor a CSS custom property names a font.
 */
export const TERMINAL_FONT_FALLBACK = 'Menlo, Consolas, "Liberation Mono", monospace'

/**
 * Live source of the user's configured terminal font family: the client
 * entry binds the dsh-ssh settings namespace into one of these and hands it
 * to the panel, so a settings change re-applies without a remount.
 */
export interface TerminalFontSource {
  /** Current configured family, or undefined when unset / not yet loaded. */
  get(): string | undefined
  /** Subscribe to changes; the returned function unsubscribes. */
  subscribe(listener: () => void): () => void
}

/**
 * Resolve the xterm `fontFamily` (issue #577). xterm's DOM renderer takes
 * the font only from constructor/options, so a plain stylesheet rule cannot
 * retarget it — the value must be read back into the options. The chain,
 * first non-empty value wins:
 *   1. `override` — the `terminalFontFamily` plugin setting;
 *   2. `--dsh-ssh-terminal-font` — dedicated hook for skins and user CSS
 *      (e.g. a Nerd Font for powerline glyphs);
 *   3. `--ds-font-family-code` — the official code-font token several skins
 *      already remap;
 *   4. {@link TERMINAL_FONT_FALLBACK}.
 */
export function resolveTerminalFontFamily(override?: string): string {
  const trimmed = override?.trim()
  if (trimmed !== undefined && trimmed !== '') return trimmed
  if (typeof getComputedStyle === 'function' && typeof document !== 'undefined') {
    const target = document.body ?? document.documentElement
    const style = getComputedStyle(target)
    for (const name of ['--dsh-ssh-terminal-font', '--ds-font-family-code']) {
      const value = style.getPropertyValue(name).trim()
      if (value !== '') return value
    }
  }
  return TERMINAL_FONT_FALLBACK
}
