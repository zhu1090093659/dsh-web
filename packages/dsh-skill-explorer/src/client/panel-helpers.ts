/**
 * Shared panel helpers: the active-dictionary pick (document-language based)
 * and the tiny {name} interpolator. All copy stays in locales.ts.
 */
import { en, zh, type SkillExplorerKey } from './locales.ts'

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
let runtimeT: ((key: SkillExplorerKey, values?: TranslateValues) => string) | undefined

/** Wire the SDK translate seat; pass undefined to restore the document-language pick. */
export function setRuntimeTranslate(t: ((key: SkillExplorerKey, values?: TranslateValues) => string) | undefined): void {
  runtimeT = t
}

/** Translate a key with optional {name} template params (current language). */
export function tt(key: SkillExplorerKey, values?: TranslateValues): string {
  if (runtimeT !== undefined) return runtimeT(key, values)
  let text: string = dictionary()[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

