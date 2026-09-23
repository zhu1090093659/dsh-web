/**
 * Wide sidebar foot row: on the desktop column the update and remote-access
 * triggers share the Settings trigger's line instead of stacking above it, so
 * the trigger's empty right half carries them, while the usage glance card
 * keeps a full row of its own. The rules are scoped off the collapsed frame —
 * the rail must keep the shell's stacked foot, where the circles stack by
 * design — and a regression to the unscoped form either breaks the rail or
 * leaves the actions on a line of their own.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/remote.module.css', import.meta.url), 'utf8')

/** Extract one rule block body by its full selector. */
function ruleBody(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(selector + ' rule not found in remote.module.css')
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

/** Every wide-foot rule is scoped to the uncollapsed frame. */
const WIDE = ":global([data-dsh-frame]:not([data-sidebar-collapsed])) "

describe('wide sidebar foot row', () => {
  it('user gets the settings trigger and the footer actions on one line', () => {
    // Given the wide foot container
    const foot = ruleBody(WIDE + "[class*='footArea']")
    // When the wide layout applies
    // Then it lays the foot out as a wrapping row
    expect(foot).toContain('flex-direction: row')
    expect(foot).toContain('flex-wrap: wrap')

    // And the settings trigger opens the row while the actions take its tail
    const settings = ruleBody(WIDE + "[class*='settingsArea']")
    expect(settings).toContain('flex: 1 1 auto')
    expect(settings).toContain('order: 1')
    const actions = ruleBody(WIDE + "[class*='footerActions']")
    expect(actions).toContain('flex: none')
    expect(actions).toContain('order: 2')
  })

  it('user keeps every other foot child on a full row of its own', () => {
    // Given a foot child that is neither the settings trigger nor the actions
    const other = ruleBody(WIDE + "[class*='footArea'] > :not([class*='settingsArea']):not([class*='footerActions'])")
    // When the row wraps
    // Then the child claims the whole line
    expect(other).toContain('flex: 1 1 100%')
  })

  it('user in the collapsed rail keeps the shell stacked foot', () => {
    // Given the frame's collapsed-frame rail marker
    // When the wide rules are read
    // Then each one is scoped off the collapsed frame
    for (const selector of ["[class*='footArea']", "[class*='settingsArea']", "[class*='footerActions']"]) {
      expect(() => ruleBody(WIDE + selector)).not.toThrow()
    }
  })
})
