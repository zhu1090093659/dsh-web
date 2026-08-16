/**
 * Stacking contract regression guard (issue #234 follow-up): the panel
 * columns stack above the shell overlay layer (issue #195), and the frame
 * chrome (floating expand button, collapse chevron) must stay at or above
 * the column layer — the chrome overlaps the column tracks, so lowering it
 * below the columns buries it under the opaque panels and kills hit-testing.
 * Full-screen overlay drawers cover the panels by rendering at the ROOT
 * stacking context (z 100~1000), not by the panel side lowering its z-index.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/client/styles/tokens.module.css'), 'utf8')

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  if (match === null) throw new Error('selector not found in tokens.module.css: ' + selector)
  return match[1] ?? ''
}

describe('panel stacking contract', () => {
  it('keeps the columns above the shell overlay layer', () => {
    const cols = css.match(/:global\(\.aionui-preview-col\),\s*\n:global\(\.aionui-explorer-col\)\s*\{([^}]*)\}/)
    expect(cols).not.toBeNull()
    expect(cols?.[1]).toContain('z-index: 30')
  })

  it('keeps the floating expand button above the columns', () => {
    expect(block(':global(.aionui-floating-expand)')).toContain('z-index: 100')
  })

  it('keeps the collapse chevron at the column layer', () => {
    expect(block(':global(.aionui-collapse-chevron)')).toContain('z-index: 30')
  })

  it('makes the columns pointer-transparent while a panel drag is in flight', () => {
    expect(css).toContain('[data-aionui-dragging] .aionui-preview-col')
    expect(css).toContain('[data-aionui-dragging] .aionui-explorer-col')
    expect(css).toContain('pointer-events: none')
  })

  it('centers the handle visual lines on the column border', () => {
    expect(css).toContain('left: 50%')
    expect(css).toContain('transform: translateX(-50%)')
  })
})
