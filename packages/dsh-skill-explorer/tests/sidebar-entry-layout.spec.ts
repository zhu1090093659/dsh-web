// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skill-panel.module.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/client/sidebar-entry.ts', import.meta.url), 'utf8')

describe('skill-explorer sidebar entry layout', () => {
  it('user sees the entry row box match the shell panel rows', () => {
    // Given the skill-explorer entry row stylesheet and its glyph markup
    const entry = css.match(/(?:^|\n)\.entry\s*\{([^}]*)\}/s)?.[1] ?? ''

    // When the row renders beside an official panel row
    // Then its box, type, ink and glyph are the shell panel row's own values
    expect(source).toContain('width="16" height="16"')
    expect(entry).toContain('min-height: 36px')
    expect(entry).toContain('padding: 7px 8px')
    expect(entry).toContain('margin: 0 2px')
    expect(entry).toContain('border-radius: 12px')
    expect(entry).toContain('font-size: 14px')
    expect(entry).toContain('line-height: 22px')
    expect(entry).toContain('var(--dsw-alias-label-primary)')
    expect(css).toMatch(/\.entryIcon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s)
    expect(css).toMatch(/\.entryIcon svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s)
    expect(css).toMatch(/\.entry:hover\s*\{[^}]*var\(--dsw-alias-interactive-bg-hover\)/s)
  })

  it('user collapsing the sidebar sees the row become a shell-shaped rail target (#1112)', () => {
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
