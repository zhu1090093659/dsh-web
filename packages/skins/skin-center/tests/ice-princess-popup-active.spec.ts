/**
 * ice-princess composer popup guard (issue #1520).
 *
 * The skin pins the composer's tool keys with an `!important` background. The
 * original selector was the bare `[data-composer-card] button`, which also
 * matched the suggestion rows that ui-input-trigger's MenuView and
 * ui-commands' PopupSelectView render as `<button role="option">` (and
 * `role="menuitem"` elsewhere). Those rows carry their highlight as
 * `background: var(--dsw-alias-interactive-bg-hover)` with no `!important`,
 * so the tool-key fill silently won and the ArrowUp/ArrowDown selection became
 * indistinguishable from an idle row — only the `:hover` branch stayed
 * visible. The declarations below are individually taut, so a later edit could
 * undo the fix without touching the shape of the file; this spec pins the
 * selector narrowing, the semantic fallback, and the contrast the fallback
 * owes the reader.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transformSkinCss } from '../src/core/css-safety/transform.ts'

const CSS = readFileSync(new URL('../skins/ice-princess/patches.css', import.meta.url), 'utf8')

/** Menu card surface the suggestion rows float on (skin.css --dsw-specific-menu). */
const MENU_SURFACE = '#0f1a33'
/** What the rows used to inherit from the un-narrowed tool-key rule. */
const TOOL_KEY_FILL = '#17264a'
/** Keyboard/pointer highlight the fallback paints. */
const ACTIVE_FILL = '#2a5ea8'

function channel(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (match === null) throw new Error('not a 6-digit hex colour: ' + hex)
  return 0.2126 * channel(parseInt(match[1]!, 16))
    + 0.7152 * channel(parseInt(match[2]!, 16))
    + 0.0722 * channel(parseInt(match[3]!, 16))
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('ice-princess composer tool keys', () => {
  it('never styles every composer button through the bare element selector', () => {
    // The regression itself: this rule is what swallowed the popup rows.
    expect(CSS).not.toMatch(/^\[data-composer-card\] button \{/m)
    expect(CSS).not.toMatch(/^\[data-composer-card\] button:hover:not\(:disabled\) \{/m)
    expect(CSS).not.toMatch(/^\[data-composer-card\] button:disabled \{/m)
  })

  it('keeps the tool-key fill behind a role-aware :not() chain', () => {
    expect(CSS).toMatch(
      /\[data-composer-card\] button:not\(\[role='menuitem'\]\):not\(\[role='option'\]\) \{\s*\n\s*background-color: #17264ae6 !important;/,
    )
    expect(CSS).toMatch(
      /\[data-composer-card\] button:not\(\[role='menuitem'\]\):not\(\[role='option'\]\):hover:not\(:disabled\) \{\s*\n\s*background-color: #4e93e838 !important;/,
    )
    expect(CSS).toMatch(
      /\[data-composer-card\] button:not\(\[role='menuitem'\]\):not\(\[role='option'\]\):disabled \{\s*\n\s*background-color: #17264a73 !important;/,
    )
  })
})

describe('ice-princess composer suggestion highlight', () => {
  it('restores the selected row from ARIA state alone', () => {
    // Built rather than written out so the pinned colour and the contrast
    // assertions above can never drift apart.
    const activeRule = new RegExp(
      "\\[data-composer-card\\] \\[role='option'\\]\\[aria-selected='true'\\],"
      + "\\s*\\n\\[data-composer-card\\] \\[role='menuitem'\\]\\[aria-selected='true'\\] \\{"
      + "\\s*\\n\\s*background-color: " + ACTIVE_FILL + " !important;",
    )
    expect(CSS).toMatch(activeRule)
  })

  it('beats the tool-key fill it used to inherit', () => {
    expect(contrast(ACTIVE_FILL, TOOL_KEY_FILL)).toBeGreaterThanOrEqual(2.2)
  })

  it('reads as a distinct row on the menu surface', () => {
    expect(contrast(ACTIVE_FILL, MENU_SURFACE)).toBeGreaterThanOrEqual(2.5)
  })

  it('survives the serve-time scoping transform, prefixed to the skin root', () => {
    // The market and the Skin Center serve the TRANSFORMED stylesheet, so the
    // fix is only real if the scoping pass keeps both the narrowed tool-key
    // rule and the ARIA fallback under html[data-dsh-skin].
    const { code } = transformSkinCss(CSS, { skinId: 'ice-princess', filename: 'patches.css' })
    // Every rule is scoped under the skin root; quote style and spacing are the
    // transform's business, so the assertions tolerate both.
    expect(code).toMatch(/html\[data-dsh-skin="ice-princess"\]/)
    expect(code).toMatch(
      /\[data-composer-card\] button:not\(\[role=?['"]?menuitem['"]?\]\):not\(\[role=?['"]?option['"]?\]\)/,
    )
    expect(code).toMatch(
      /\[data-composer-card\] \[role=?['"]?option['"]?\][\s\S]{0,40}\[aria-selected=?['"]?true['"]?\]/,
    )
    expect(code).toMatch(/#2a5ea8/i)
    // The un-narrowed selector must not come back through the pipeline.
    expect(code).not.toMatch(/\[data-composer-card\] button\s*\{/)
  })
})
