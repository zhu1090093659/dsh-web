/**
 * Sidebar footer action seat placement: the pairing trigger shares
 * `sidebar.footer.action` with the update trigger.
 *
 * The shell lays that seat out as a left-aligned row, so a position in flow
 * alone leaves this trigger at the row's leading edge — which is what it used to
 * do. It now sits on the seat's trailing edge, and the narrow rail keeps leading
 * its centered column. This is a presentation contract, so the assertion reads
 * the stylesheet instead of mounting the component and measuring a layout the
 * suite has no viewport for.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/panel.module.css', import.meta.url), 'utf8')

/** Extract one rule block body by its full selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+$\{\}()|[\]\\]/g, '\\$&')
  const match = new RegExp(escaped + '\\s*\\{([^}]*)\\}').exec(css)
  if (match === null) throw new Error(selector + ' rule not found in panel.module.css')
  return match[1] ?? ''
}

describe('sidebar footer seat placement', () => {
  it('operator: the wide seat puts the trigger on its trailing edge, the rail stack keeps leading', () => {
    // Given the trigger's base rule, which the 56px rail column reads
    const base = ruleBody('.trigger')
    // Then the rail keeps leading its centered stack...
    expect(base).toContain('order: -1')
    // ...and it takes no auto inline margin, which would pull the icon off that
    // column's axis
    expect(base).not.toContain('margin-inline-start')

    // Given the rule the wide seat reads
    const wide = ruleBody(".trigger[data-wide='wide']")
    // When the seat lays its occupants out as a row
    // Then the trigger is ordered after the seat's other occupants...
    expect(wide).toContain('order: 1')
    // ...and absorbs the free space in front of itself, so it lands on the
    // trailing edge instead of directly after the previous occupant
    expect(wide).toContain('margin-inline-start: auto')
  })
})
