/**
 * Constrained-layout guard: the board must preserve readable columns and let
 * the board scroll horizontally instead of compressing cards into slivers.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/board.module.css', import.meta.url), 'utf8')

describe('board responsive css', () => {
  it('keeps the columns container horizontally scrollable', () => {
    const columnsBlock = css.match(/\.columns\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(columnsBlock).toContain('overflow-x: auto')
    expect(columnsBlock).toContain('overflow-y: hidden')
  })

  it('preserves a readable minimum width for every rendered column', () => {
    const columnsBlock = css.match(/\.columns\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(columnsBlock).toContain('grid-auto-flow: column')
    expect(columnsBlock).toContain('grid-auto-columns: minmax(220px, 1fr)')
  })

  it('renders a visible horizontal scrollbar affordance', () => {
    expect(css).toMatch(/\.columns::\-webkit-scrollbar\s*\{[^}]*height:\s*10px/s)
    expect(css).toMatch(/\.columns::\-webkit-scrollbar-track\s*\{[^}]*background:/s)
    expect(css).toMatch(/\.columns::\-webkit-scrollbar-thumb\s*\{[^}]*background:/s)
    expect(css).toContain('scrollbar-width: thin')
  })

  it('keeps the bottom scrollbar inside the board viewport', () => {
    const boardBlock = css.match(/\.board\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(boardBlock).toContain('box-sizing: border-box')
    expect(boardBlock).toContain('height: 100%')
  })

  it('responds to the board container rather than only the viewport', () => {
    expect(css).toMatch(/\[data-dsh-taskboard-view\]\s*\{[^}]*container-name:\s*task-board-view/s)
    expect(css).toContain('@container task-board-view (max-width: 720px)')
    expect(css).toContain('@container task-board-view (max-width: 600px)')
    expect(css).toMatch(/\.boardHeader\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(css).toMatch(/\.search\s*\{[^}]*flex:\s*1 1 calc\(100% - 72px\)/s)
  })
})
