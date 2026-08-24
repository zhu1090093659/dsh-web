/**
 * Automatic token fallbacks (issue #506 follow-up): for every official
 * --dsw-* token a skin does NOT remap, derive a translucent tint of the
 * skin's own palette — the skin's main color, "blurred" over whatever sits
 * behind the surface. The official shell keeps adding surfaces (e.g. the
 * composer's --dsw-specific-input-major); without this, an uncovered
 * surface snaps back to the official default gray-blue and breaks the
 * skin's palette. The fallback keeps skins future-proof across official
 * upgrades: any new token simply inherits the skin's tint instead of the
 * stock look.
 *
 * Rules (fail-closed, conservative):
 *  - never touch the static palette (not in the registry at all);
 *  - never override a token the skin defines;
 *  - never derive when the skin defines no anchor for the group;
 *  - semantic / structural groups (buttons, states, masks, shadows,
 *    inverted/foreground labels, fonts, easing) are skipped: a tint there
 *    would break contrast or layout instead of filling a gap.
 *
 * The derivation is textual (color-mix with a var() reference), so it
 * resolves against the skin's own remap — including the dark-theme block —
 * and stays theme-aware with zero runtime logic.
 */

import { OFFICIAL_TOKENS } from './official-tokens.generated.ts'

interface FallbackGroup {
  /** Skip list wins over every group. */
  skip: RegExp
  /** Anchor preference: the first anchor the skin defines wins. */
  anchors: string[]
  /** Tint strength of the anchor color (100 = opaque anchor). */
  alpha: number
}

/** Matched in order; the first group whose pattern hits wins. */
const GROUPS: FallbackGroup[] = [
  {
    skip: /(^|-)(mask|shadow|button|state|brand|scrollbar|foreground|inverted|dimmed)(-|$)|-font-|linear-|ease|duration|transition/,
    anchors: [],
    alpha: 0,
  },
  { skip: /-bg-/, anchors: ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-base'], alpha: 65 },
  { skip: /-label-/, anchors: ['--dsw-alias-label-primary'], alpha: 70 },
  { skip: /-border-/, anchors: ['--dsw-alias-border-l2', '--dsw-alias-border-l1'], alpha: 55 },
  { skip: /-interactive-/, anchors: ['--dsw-alias-bg-layer-1'], alpha: 50 },
  { skip: /-specific-/, anchors: ['--dsw-alias-bg-layer-1', '--dsw-alias-bg-base'], alpha: 60 },
]

const EXCLUDED = /(^|-)(mask|shadow|button|state|brand|scrollbar|foreground|inverted|dimmed)(-|$)|-font-|linear-|ease|duration|transition/

function groupFor(token: string): FallbackGroup | null {
  if (EXCLUDED.test(token)) return null
  for (const group of GROUPS) {
    if (group.skip.test(token)) return group
  }
  return null
}

/**
 * Build fallback declarations for the official tokens the skin does not
 * define. Returns declaration strings ("--x: color-mix(...);" per token).
 */
export function deriveFallbackTokens(defined: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (const token of OFFICIAL_TOKENS) {
    if (defined.has(token)) continue
    const group = groupFor(token)
    if (group === null) continue
    const anchor = group.anchors.find((candidate) => defined.has(candidate))
    if (anchor === undefined) continue
    out.push(`${token}: color-mix(in srgb, var(${anchor}) ${group.alpha}%, transparent);`)
  }
  return out
}
/**
 * Primary-action completion (issue #506 follow-up): filled primary buttons
 * render from one matched set — button-primary-fill, button-primary-hover,
 * label-primary-foreground. The official theme itself wires
 * button-primary-fill to brand-primary, so a skin that remaps the brand
 * already colors the fill; hover and foreground do NOT follow the brand and
 * would snap to the shell's static values. To keep a partially-declared or
 * legacy (brand-primary + brand-primary-invert) skin coherent, the loader
 * completes the set here:
 *
 *  - fill: derive from brand-primary when the skin declares its brand but
 *    no explicit fill (the shell chain does this anyway; the derivation
 *    makes the intent explicit and keeps the textual derivation table
 *    self-contained);
 *  - hover / dimmed: blend the fill toward the surface (color-mix) — a
 *    direction-agnostic press/disabled tint that works in both themes;
 *  - foreground: inherit the skin's own brand-primary-invert ONLY when the
 *    skin declares both brand tokens (the legacy matched convention); the
 *    shell foreground stands in otherwise.
 *
 * Never overrides a token the skin defines, and never derives without an
 * anchor: a skin with no brand and no button tokens keeps the official
 * shell's own matched CTA.
 */

/** The primary-action token family (see ./token-audit.ts for the audit). */
export const PRIMARY_ACTION_FILL = '--dsw-alias-button-primary-fill'
export const PRIMARY_ACTION_HOVER = '--dsw-alias-button-primary-hover'
export const PRIMARY_ACTION_DIMMED = '--dsw-alias-button-primary-dimmed'
export const PRIMARY_ACTION_FOREGROUND = '--dsw-alias-label-primary-foreground'
export const PRIMARY_ACTION_BRAND = '--dsw-alias-brand-primary'
export const PRIMARY_ACTION_BRAND_INVERT = '--dsw-alias-brand-primary-invert'

/** Derive the primary-action tokens the skin did not define. */
export function derivePrimaryActionFallbacks(defined: ReadonlySet<string>): string[] {
  const out: string[] = []
  const hasBrand = defined.has(PRIMARY_ACTION_BRAND)
  const branded = hasBrand || defined.has(PRIMARY_ACTION_FILL)
  if (!hasBrand && !defined.has(PRIMARY_ACTION_FILL)) return out
  if (!defined.has(PRIMARY_ACTION_FILL) && hasBrand) {
    out.push(`${PRIMARY_ACTION_FILL}: var(${PRIMARY_ACTION_BRAND});`)
  }
  if (branded && !defined.has(PRIMARY_ACTION_HOVER)) {
    out.push(
      `${PRIMARY_ACTION_HOVER}: color-mix(in srgb, var(${PRIMARY_ACTION_FILL}) 82%, var(--dsw-alias-bg-layer-1));`,
    )
  }
  if (branded && !defined.has(PRIMARY_ACTION_DIMMED)) {
    out.push(
      `${PRIMARY_ACTION_DIMMED}: color-mix(in srgb, var(${PRIMARY_ACTION_FILL}) 60%, var(--dsw-alias-bg-layer-1));`,
    )
  }
  if (!defined.has(PRIMARY_ACTION_FOREGROUND) && hasBrand && defined.has(PRIMARY_ACTION_BRAND_INVERT)) {
    out.push(`${PRIMARY_ACTION_FOREGROUND}: var(${PRIMARY_ACTION_BRAND_INVERT});`)
  }
  return out
}
