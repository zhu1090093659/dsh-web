import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/board.module.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/client/sidebar-entry.ts', import.meta.url), 'utf8')

// Every injected sidebar row must reproduce the shell's own panel-row box
// (SidebarRoot .panelRow): 2px inset, 12px radius, 8px content padding, 36px
// row, 14/22 type, primary ink, and a 16px glyph box. The three rows of this
// repository (task board, ssh, skill explorer) are checked against the same
// list so a drift in any one of them fails here.
const siblingRows = [
  new URL('../../dsh-ssh/src/client/panel/panel.module.css', import.meta.url),
  new URL('../../dsh-skill-explorer/src/client/skill-panel.module.css', import.meta.url),
]

/** The declarations of one class rule, or '' when the rule is absent. */
function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return source.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? ''
}

describe('task-board sidebar entry layout', () => {
  it('user sees the entry row box match the shell panel rows', () => {
    // Given the entry row stylesheet and its glyph markup
    const entry = rule(css, '.entry')

    // When the row renders beside an official panel row
    // Then its box, type and ink are the shell panel row's own values
    expect(source).toContain('width="16" height="16"')
    expect(entry).toContain('min-height: 36px')
    expect(entry).toContain('padding: 7px 8px')
    expect(entry).toContain('margin: 0 2px')
    expect(entry).toContain('border-radius: 12px')
    expect(entry).toContain('font-size: 14px')
    expect(entry).toContain('line-height: 22px')
    expect(entry).toContain('var(--dsw-alias-label-primary)')
    expect(rule(css, '.entryIcon')).toMatch(/width:\s*16px;[^}]*height:\s*16px;/s)
    expect(rule(css, '.entryIcon svg')).toMatch(/width:\s*16px;[^}]*height:\s*16px;/s)
    expect(rule(css, '.entry:hover')).toContain('var(--dsw-alias-interactive-bg-hover)')
    expect(rule(css, '.entry[data-active]')).toContain('var(--dsw-alias-interactive-bg-active)')
  })

  it('user sees every sibling entry row share one geometry baseline (#1535)', () => {
    // Given the four injected entry rows of this repository
    // When each row's box and glyph rules are compared
    // Then all of them carry the same baseline declarations
    for (const url of siblingRows) {
      const sibling = readFileSync(url, 'utf8')
      const path = url.pathname.split('/packages/')[1] ?? url.pathname
      const entry = rule(sibling, '.entry')
      for (const declaration of ['min-height: 36px', 'padding: 7px 8px', 'margin: 0 2px', 'border-radius: 12px', 'font-size: 14px', 'line-height: 22px', 'gap: 8px']) {
        expect(entry, `${path}: ${declaration}`).toContain(declaration)
      }
      expect(rule(sibling, '.entryIcon'), `${path}: .entryIcon`).toMatch(/width:\s*16px;[^}]*height:\s*16px;/s)
      expect(rule(sibling, '.entryIcon svg'), `${path}: .entryIcon svg`).toMatch(/width:\s*16px;[^}]*height:\s*16px;/s)
    }
  })

  it('user collapsing the sidebar sees the row become a shell-shaped rail target', () => {
    // Given the collapsed rail styles
    // When the rail rules apply
    // Then the target is a centered 36px box with the panel rows' rounding
    expect(css).toContain(':global([data-sidebar-collapsed]) .entry')
    expect(css).toContain(':global([data-dsh-frame][data-sidebar-collapsed]) .entry')
    const collapsed = css.match(/:global\([^)]*\[data-sidebar-collapsed\][^)]*\) \.entry\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(collapsed).toContain('width: 36px')
    expect(collapsed).toContain('height: 36px')
    expect(collapsed).toContain('margin: 0 auto 12px')
    expect(collapsed).toContain('border-radius: 12px')
    const collapsedIcon = css.match(/:global\([^)]*\[data-sidebar-collapsed\][^)]*\) \.entryIcon svg\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(collapsedIcon).toContain('width: 18px')
    expect(collapsedIcon).toContain('height: 18px')
  })
})
