/**
 * Family section nav icon CSS guards: the DSH settings shell hard-codes nav
 * icons by section id (only models / agent-presets / plugins get dedicated
 * icons; everything else falls back to the gear). The group styles swap the
 * gear for per-section masks on the shell's stable class suffixes, gated on
 * exactly eight nav cells (all four family sections installed) so a partial
 * install never shows a wrong icon.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/client/web-ui-settings.module.css', 'utf8')

describe('family section nav icons', () => {
  it('hides the shell gear for the last four nav cells', () => {
    for (const n of [5, 6, 7, 8]) {
      expect(css).toContain('[class*="_navCell"]:nth-child(' + n + ') > [class*="_navIcon"]')
    }
    const hideRule = css.split('> [class*="_navIcon"] {')[1]?.split('}')[0] ?? ''
    expect(hideRule).toContain('display: none')
  })

  it('gates the override on exactly eight nav cells', () => {
    expect(css).toContain('[class*="_navList"]:has(> [class*="_navCell"]:nth-child(8)):not(:has(> [class*="_navCell"]:nth-child(9)))')
  })

  it('paints one currentColor mask per family section', () => {
    expect(css.split('background: currentColor').length - 1).toBe(4)
    // Four unprefixed mask declarations (the -webkit-mask copies carry the
    // same URL for Safari and are not counted here).
    expect(css.split('  mask: url("data:image/svg+xml').length - 1).toBe(4)
    expect(css).toContain('-webkit-mask')
  })
})
