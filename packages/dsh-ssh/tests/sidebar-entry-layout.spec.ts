import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/panel/panel.module.css', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/client/sidebar-entry.ts', import.meta.url), 'utf8')

describe('SSH sidebar entry layout (#872)', () => {
  it('uses an explicit navigation icon box and visible 18px glyph', () => {
    expect(source).toContain('width="18" height="18"')
    expect(css).toMatch(/\.entryIcon\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s)
    expect(css).toMatch(/\.entryIcon svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s)
    expect(css).toMatch(/\.entry:hover\s*\{[^}]*var\(--dsw-alias-interactive-bg-hover\)/s)
    expect(css).toMatch(/\.entry\[data-active\]\s*\{[^}]*var\(--dsw-alias-interactive-bg-active\)/s)
  })

  it('centers a fixed-size target in the collapsed sidebar rail', () => {
    expect(css).toContain(':global([data-sidebar-collapsed]) .entry')
    expect(css).toContain(':global([data-dsh-frame][data-sidebar-collapsed]) .entry')
    const collapsed = css.match(/:global\([^)]*\[data-sidebar-collapsed\][^)]*\) \.entry\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(collapsed).toContain('width: 36px')
    expect(collapsed).toContain('min-height: 36px')
    expect(collapsed).toContain('margin: 0 auto 12px')
    expect(collapsed).toContain('border-radius: 50%')
  })

  it('shares the 8px icon/label gap of the sibling sidebar entry rows', () => {
    // The SSH row is injected between the task-board and skill-explorer rows,
    // which both use an 8px gap against the same 24px icon box. A wider gap
    // here nudged only this row's label 2px right of its neighbours.
    const entry = css.match(/^\.entry\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(entry).toContain('gap: 8px')
    expect(entry).not.toMatch(/gap:\s*(?!8px)\d+px/)
  })
})
