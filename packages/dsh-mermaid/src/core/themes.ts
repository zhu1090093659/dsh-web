/**
 * Shared mermaid theme facts — pure data both halves consume (the host schema
 * and the client normalizer), so the browser bundle never touches the host
 * half's settings imports.
 * @module @linxin666/dsh-client-ui-mermaid/core/themes
 */

/**
 * The selectable mermaid themes. `auto` resolves against the interface
 * brightness in the browser; the rest are mermaid built-in theme names.
 * Stored as a free string (not a strict union): a theme removed from this
 * list in a later release must not invalidate a stored section — the client
 * normalizes unknown values back to `auto` (same rationale as pet's petId).
 */
export const MERMAID_THEMES = ['auto', 'default', 'dark', 'neutral', 'forest'] as const

/** One selectable theme. */
export type MermaidThemeSetting = (typeof MERMAID_THEMES)[number]

/** Theme names mermaid itself accepts (the built-in themes we expose). */
export type MermaidBuiltInTheme = Exclude<MermaidThemeSetting, 'auto'>

/** The built-in themes as a runtime set (lookup companion of MERMAID_THEMES). */
export const BUILTIN_THEMES = new Set<MermaidBuiltInTheme>(
  MERMAID_THEMES.filter((theme): theme is MermaidBuiltInTheme => theme !== 'auto'),
)

/**
 * Normalize a stored theme value: an unknown or missing value falls back to
 * `auto` (a theme removed from the choices must not break a stored section).
 * @param value - the stored theme value.
 * @returns a selectable theme.
 */
export function normalizeTheme(value: unknown): MermaidThemeSetting {
  return typeof value === 'string' && (value === 'auto' || BUILTIN_THEMES.has(value as MermaidBuiltInTheme))
    ? (value as MermaidThemeSetting)
    : 'auto'
}

/** The settings section document (also the browser half's read shape). */
export interface MermaidSettingsSection {
  enabled?: boolean
  theme?: string
}
