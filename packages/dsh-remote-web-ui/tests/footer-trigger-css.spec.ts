/**
 * Sidebar footer action triggers (#1035): the update and remote-access
 * buttons sit side by side in the same seat, so their shapes must belong to
 * one rounding family — the rail circle (50%) and the wide full-row pill
 * (999px). A regression to a small fixed radius on the wide variant
 * reintroduces the circle-vs-rectangle mismatch every skin inherits.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/remote.module.css', import.meta.url), 'utf8')

/** Extract one rule block body by its full selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css)
  if (match === null) throw new Error(selector + ' rule not found in remote.module.css')
  return match[1] ?? ''
}

describe('sidebar footer trigger shape family', () => {
  it('keeps the rail trigger a circle', () => {
    expect(ruleBody('.trigger')).toContain('border-radius: 50%')
  })

  it('keeps the wide trigger fully rounded (pill), not a fixed-radius rectangle', () => {
    const wide = ruleBody(".trigger[data-wide='wide']")
    expect(wide).toContain('border-radius: 999px')
    expect(/border-radius:\s*8px/.test(wide)).toBe(false)
  })
})
