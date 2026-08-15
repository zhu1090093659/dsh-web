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

/** Translate a key with optional {name} template params (current language). */
export function tt(key: SkillExplorerKey, values?: TranslateValues): string {
  let text: string = dictionary()[key] ?? key
  if (values !== undefined) {
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

/** Human-readable error text from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
