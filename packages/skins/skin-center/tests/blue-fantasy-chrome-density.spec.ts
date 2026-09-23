/**
 * Blue Fantasy chrome density (issue #1579): the top bar and the right
 * sidebar must read the same fill the left pane reads, so the three columns
 * share one density at every Wallpaper-scrim value. Pinning the chrome at a
 * fixed 0.75 only matched the left pane at scrim 0.5 and broke the "one
 * surface" rule the chrome block itself states.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const DIR = resolve(__dirname, '../skins/blue-fantasy')
const SKIN = readFileSync(resolve(DIR, 'skin.css'), 'utf8')
const PATCHES = readFileSync(resolve(DIR, 'patches.css'), 'utf8')

/** The chrome section of patches.css, bounded by its own section banners. */
function chromeSection(): string {
  const start = PATCHES.indexOf('/* --- chrome: the top bar and the right sidebar')
  const end = PATCHES.indexOf('/* --- tool-call rows', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return PATCHES.slice(start, end)
}

/** The section with its comments removed: only declarations are asserted. */
const CHROME = chromeSection().replace(/\/\*[\s\S]*?\*\//g, '')

describe('blue-fantasy chrome density (issue #1579)', () => {
  it('defines the left pane fill as a scrim-tracking token', () => {
    expect(SKIN).toContain('--dsw-specific-sidebar-fill: rgba(242, 245, 250, calc(1 - var(--dsw-skin-scrim, 0) * .5))')
    expect(SKIN).toContain('--dsw-specific-sidebar-fill: rgba(29, 37, 57, calc(1 - var(--dsw-skin-scrim, 0) * .45))')
  })

  it('gives the top bar and right sidebar the same scrim-tracking token', () => {
    // Light and dark each carry exactly one chrome fill rule, and both must
    // read the token; a pinned colour makes the columns drift apart at every
    // scrim value except the one the pin happens to equal.
    const fills = CHROME.match(/background: var\(--dsw-specific-sidebar-fill\);/g) ?? []
    expect(fills).toHaveLength(2)
  })

  it('never re-pins the chrome to the old fixed fill', () => {
    expect(CHROME).not.toContain('rgba(242, 245, 250, 0.75)')
    expect(CHROME).not.toContain('rgba(16, 22, 42, 0.75)')
    // Nor any other hard-coded chrome fill.
    expect(CHROME).not.toMatch(/background:\s*rgba\(/)
  })

  it('keeps the chrome off the bubble opacity slider', () => {
    // The original decision still holds: the frame must not follow
    // --dsh-skin-bubble-alpha. Only the scrim token is allowed here.
    expect(CHROME).not.toContain('--dsh-skin-bubble-alpha')
  })
})
