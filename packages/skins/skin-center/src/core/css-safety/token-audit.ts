/**
 * Primary-action token contract audit (issue #506 follow-up).
 *
 * The official shell renders filled primary buttons from one matched set:
 * --dsw-alias-button-primary-fill (fill), --dsw-alias-button-primary-hover
 * (hover) and --dsw-alias-label-primary-foreground (text on the fill). The
 * skin-center loader completes partially-declared sets from skin anchors
 * (see ./fallback.ts derivePrimaryActionFallbacks), so the worst outcome is
 * a legible button; this audit is the author-facing, progressive check that
 * warns when a skin's declarations leave a gap the loader has to fill, and
 * when the fill/foreground pair fails a WCAG 3:1 UI-contrast gate.
 *
 * Rules (conservative, warning-only — never fatal):
 *  - a skin declaring none of the primary-action family (brand, button-*,
 *    foreground) is a deliberate shell-CTA skin and stays silent;
 *  - completeness: fill is satisfied by button-primary-fill OR
 *    brand-primary; hover by button-primary-hover OR the fill anchor;
 *    foreground by label-primary-foreground OR the matched pair
 *    brand-primary + brand-primary-invert (the legacy convention);
 *  - contrast: resolved per theme (light / dark), values resolved through
 *    the skin's own token maps plus the official static palette; unresolvable
 *    values skip the check. The shell defaults stand in when the skin omits
 *    the token (light: #0f1115 on #ffffff, dark: #f9fafb on #0f1115 — the
 *    official theme's own pair, always legible).
 *
 * @module @linxin666/dsh-client-ui-skin-center/css-safety/token-audit
 */

export interface TokenAuditStylesheet {
  filename: string
  css: string
}

export interface TokenAuditResult {
  warnings: string[]
}

export const PRIMARY_ACTION_FILL = '--dsw-alias-button-primary-fill'
export const PRIMARY_ACTION_HOVER = '--dsw-alias-button-primary-hover'
export const PRIMARY_ACTION_DIMMED = '--dsw-alias-button-primary-dimmed'
export const PRIMARY_ACTION_FOREGROUND = '--dsw-alias-label-primary-foreground'
export const BRAND_PRIMARY = '--dsw-alias-brand-primary'
export const BRAND_PRIMARY_INVERT = '--dsw-alias-brand-primary-invert'

/** WCAG contrast floor for UI components (large text / non-text parts). */
export const PRIMARY_ACTION_CONTRAST_WARNING = 3

/** Shell fill/foreground defaults per theme (both resolve to the official
 * theme's own matched CTA: #0f1115 on #ffffff light, #f9fafb on #0f1115 dark). */
const SHELL_CTA: Record<Theme, { fill: string; foreground: string }> = {
  light: { fill: '#0f1115', foreground: '#ffffff' },
  dark: { fill: '#f9fafb', foreground: '#0f1115' },
}

/**
 * Official static palette values referenced through var() by skinned tokens
 * (the subset the built-in skins actually use; mirrors the official
 * dsh-client-ui-theme static table). If a value ever drifts, contrast
 * resolution degrades to "skip", never to a wrong verdict.
 */
const STATIC_PALETTE: Record<string, string> = {
  '--dsw-static-amber-400': '#f7ad31',
  '--dsw-static-amber-500': '#f59e0b',
  '--dsw-static-blue-100': '#dbeafe',
  '--dsw-static-blue-300': '#93c5fd',
  '--dsw-static-blue-400': '#60a5fa',
  '--dsw-static-blue-450': '#4d93f8',
  '--dsw-static-blue-500': '#3b82f6',
  '--dsw-static-blue-600': '#2563eb',
  '--dsw-static-blue-800': '#1e40af',
  '--dsw-static-green-400': '#4ed17e',
  '--dsw-static-green-500': '#22c55e',
  '--dsw-static-neutral-bluish-00': '#fff',
  '--dsw-static-neutral-bluish-1000': '#0f1115',
  '--dsw-static-neutral-bluish-200': '#e1e5ee',
  '--dsw-static-neutral-bluish-300': '#cfd3d6',
  '--dsw-static-neutral-bluish-400': '#adb2b8',
  '--dsw-static-neutral-bluish-500': '#979da6',
  '--dsw-static-neutral-bluish-600': '#81858c',
  '--dsw-static-neutral-bluish-700': '#61666b',
  '--dsw-static-neutral-bluish-750': '#43454a',
  '--dsw-static-neutral-bluish-800': '#353638',
  '--dsw-static-neutral-bluish-950': '#151517',
}

type Theme = 'light' | 'dark'

interface ParsedTokens {
  defined: Set<string>
  byTheme: Record<Theme, Map<string, string>>
}

/** Index of the brace that closes the one opened at `open`. */
function matchClose(css: string, open: number): number {
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** Recursive scan: map every custom-property declaration to a theme bucket. */
function parseDefinitions(css: string): ParsedTokens {
  const defined = new Set<string>()
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  const source = withoutComments(css)

  const visit = (start: number, parentDark: boolean): void => {
    let i = start
    for (;;) {
      const open = source.indexOf('{', i)
      if (open === -1) return
      const close = matchClose(source, open)
      const head = source.slice(i, open)
      const atRule = head.trimStart().startsWith('@')
      const darkHere = parentDark
        || /data-ds-dark-theme/.test(head)
        || /prefers-color-scheme\s*:\s*dark/i.test(head)
      if (atRule) {
        visit(open + 1, darkHere)
        i = close === -1 ? source.length : close + 1
      } else {
        const end = close === -1 ? source.length : close
        const body = source.slice(open + 1, end)
        const target = darkHere ? dark : light
        for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
          const name = match[1]
          const value = match[2]
          if (name === undefined || value === undefined) continue
          defined.add(name)
          target.set(name, value.trim())
        }
        i = end + 1
      }
    }
  }
  visit(0, false)
  return { defined, byTheme: { light, dark } }
}

function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Normalize #rgb / #rrggbb / #rrggbbaa to #rrggbb (alpha ignored). */
function normalizeHex(v: string): string | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(v)
  if (m === null) return null
  const h = m[1] ?? ''
  if (h.length === 3) return '#' + h.split('').map((c) => c + c).join('')
  if (h.length >= 6) return '#' + h.slice(0, 6)
  return null
}

/** Resolve one declaration value to a #rrggbb color (one theme map). */
function resolveColor(value: string, theme: Theme, parsed: ParsedTokens, depth = 0): string | null {
  const v = value.trim()
  const hex = normalizeHex(v)
  if (hex !== null) return hex
  const viaVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\s*\)$/.exec(v)
  if (viaVar === null || depth >= 4) return null
  const name = viaVar[1]
  if (name !== undefined && STATIC_PALETTE[name] !== undefined) return STATIC_PALETTE[name]
  const own = name !== undefined ? parsed.byTheme[theme].get(name) ?? parsed.byTheme[theme === 'light' ? 'dark' : 'light'].get(name) : undefined
  if (own !== undefined) return resolveColor(own, theme, parsed, depth + 1)
  const fallback = viaVar[2]
  return fallback !== undefined ? resolveColor(fallback, theme, parsed, depth + 1) : null
}

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) return null
  const h = m[1] ?? ''
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** WCAG 2.x relative luminance of a #rrggbb/#rgb color. */
function luminance(hex: string): number | null {
  const rgb = rgbOf(hex)
  if (rgb === null) return null
  const [r, g, b] = rgb
  const linear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

/** WCAG contrast ratio between two colors (foreground over background). */
function contrastRatio(fg: string, bg: string): number | null {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  if (l1 === null || l2 === null) return null
  const high = Math.max(l1, l2)
  const low = Math.min(l1, l2)
  return (high + 0.05) / (low + 0.05)
}

function anchorDefined(defined: ReadonlySet<string>): boolean {
  return [...ANCHOR_TOKENS].some((token) => defined.has(token))
}

const ANCHOR_TOKENS = [
  PRIMARY_ACTION_FILL,
  PRIMARY_ACTION_HOVER,
  PRIMARY_ACTION_DIMMED,
  PRIMARY_ACTION_FOREGROUND,
  BRAND_PRIMARY,
  BRAND_PRIMARY_INVERT,
]

/**
 * Audit one skin's stylesheets (in application order) against the
 * primary-action token contract. Warning-only: the loader's completion
 * rules keep every outcome legible, so this never fails a skin.
 */
export function auditTokenContract(stylesheets: readonly TokenAuditStylesheet[]): TokenAuditResult {
  const warnings: string[] = []
  if (stylesheets.length === 0) return { warnings }
  const parsed = mergeTokens(stylesheets)
  const { defined, byTheme } = parsed
  if (!anchorDefined(defined)) return { warnings }

  const fillDefined = defined.has(PRIMARY_ACTION_FILL) || defined.has(BRAND_PRIMARY)
  const hoverDefined = defined.has(PRIMARY_ACTION_HOVER) || fillDefined
  const foregroundDefined = defined.has(PRIMARY_ACTION_FOREGROUND)
    || (defined.has(BRAND_PRIMARY) && defined.has(BRAND_PRIMARY_INVERT))
  if (!fillDefined) {
    warnings.push('primary action contract: "button-primary-fill" is not defined and "brand-primary" is not an anchor; buttons render the official shell CTA — define button-primary-fill (with button-primary-hover and label-primary-foreground) to adopt the skin palette')
  }
  if (!hoverDefined) {
    warnings.push('primary action contract: "button-primary-hover" is not defined; the loader derives it from the button fill (color-mix toward the surface) — define it explicitly for the exact hover look')
  }
  if (!foregroundDefined) {
    warnings.push('primary action contract: "label-primary-foreground" is not defined; the loader keeps the official shell foreground (#fff light / #0f1115 dark) — pair it with the fill, or declare the matched pair brand-primary + brand-primary-invert (legacy convention)')
  }

  for (const theme of ['light', 'dark'] as const) {
    const map = byTheme[theme]
    const fill = map.get(PRIMARY_ACTION_FILL) ?? map.get(BRAND_PRIMARY) ?? SHELL_CTA[theme].fill
    const brandInvert = map.get(BRAND_PRIMARY_INVERT)
    const foreground = map.get(PRIMARY_ACTION_FOREGROUND)
      ?? (map.get(BRAND_PRIMARY) !== undefined && brandInvert !== undefined ? brandInvert : SHELL_CTA[theme].foreground)
    const fillResolved = resolveColor(fill, theme, parsed)
    const foregroundResolved = resolveColor(foreground, theme, parsed)
    if (fillResolved === null || foregroundResolved === null) {
      // Unresolvable var chains skip the ratio check rather than guess.
      continue
    }
    const ratio = contrastRatio(foregroundResolved, fillResolved)
    if (ratio !== null && ratio < PRIMARY_ACTION_CONTRAST_WARNING) {
      warnings.push(
        `primary action contrast: ${foregroundResolved} on ${fillResolved} is ${ratio.toFixed(2)}:1 (${theme} theme) — below the ${PRIMARY_ACTION_CONTRAST_WARNING}:1 UI gate; pick a foreground that pairs with the fill`,
      )
    }
  }
  return { warnings }
}

function mergeTokens(stylesheets: readonly TokenAuditStylesheet[]): ParsedTokens {
  const defined = new Set<string>()
  const light = new Map<string, string>()
  const dark = new Map<string, string>()
  for (const sheet of stylesheets) {
    const parsed = parseDefinitions(sheet.css)
    for (const name of parsed.defined) defined.add(name)
    for (const [name, value] of parsed.byTheme.light) light.set(name, value)
    for (const [name, value] of parsed.byTheme.dark) dark.set(name, value)
  }
  return { defined, byTheme: { light, dark } }
}
