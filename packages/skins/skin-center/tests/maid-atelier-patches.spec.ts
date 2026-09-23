/**
 * maid-atelier stylesheet guards (issue #1501).
 *
 * The skin shipped three Desktop-only rendering defects: the composer backing
 * layer painted above the typed text, the character stage relied on a negative
 * z-index plus paint containment that the Electron compositor dropped, and the
 * statistics strip sat outside the dock selectors so its text kept the tertiary
 * label colour. Each fix is a single declaration that an unrelated edit could
 * silently undo, so this spec pins the declarations and the precondition that
 * makes the stacking one work.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(new URL('../skins/maid-atelier/patches.css', import.meta.url), 'utf8')

/** The declaration block of the rule whose selector starts a line. */
function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('^' + escaped + ' \\{', 'm').exec(CSS)
  expect(match, 'rule not found: ' + selector).not.toBeNull()
  const start = CSS.indexOf('{', match!.index)
  return CSS.slice(start + 1, CSS.indexOf('}', start))
}

describe('maid-atelier composer backing', () => {
  it('keeps the backing layer under the card content', () => {
    const declarations = block('[data-composer-card]:after')
    expect(declarations).toContain('z-index: -1')
    expect(declarations).not.toContain('z-index: 0')
  })

  it('keeps the stacking context that makes -1 paint above the card background', () => {
    // Without isolation the negative-z layer would escape the card's stacking
    // context and could fall behind an ancestor background instead.
    expect(CSS).toMatch(/\[data-composer-card\],[\s\S]{0,80}?isolation: isolate/)
  })
})

describe('maid-atelier character stage', () => {
  it('does not depend on negative z-index or paint containment', () => {
    const declarations = block('[data-skin-chrome="character-stage"]')
    expect(declarations).toContain('z-index: 0')
    expect(declarations).not.toContain('z-index: -1')
    expect(declarations).not.toContain('contain:')
  })

  it('stays a non-interactive full-viewport layer', () => {
    const declarations = block('[data-skin-chrome="character-stage"]')
    expect(declarations).toContain('pointer-events: none')
    expect(declarations).toContain('position: fixed')
  })
})

describe('maid-atelier statistics strip', () => {
  it('colors the strip the composer dock selectors never reached', () => {
    expect(block('body:not([data-ds-dark-theme]) [data-composer-stats]')).toContain('color: #33415f')
    expect(block('body:not([data-ds-dark-theme]) [data-composer-stats] [class*="sep"]')).toContain('color: #7d8aa6')
    expect(block('body[data-ds-dark-theme] [data-composer-stats]')).toContain('color: #aebdde')
    expect(block('body[data-ds-dark-theme] [data-composer-stats] [class*="sep"]')).toContain('color: #aebdde80')
  })

  it('leaves the strip background to the layers beneath it', () => {
    // The official StatsPills root is background: transparent; a background
    // here would fight the skin's own composer layers.
    expect(block('body:not([data-ds-dark-theme]) [data-composer-stats]')).not.toContain('background')
  })
})
