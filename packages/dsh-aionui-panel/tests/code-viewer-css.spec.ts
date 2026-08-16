/**
 * Code-viewer presentation contract: the preview reuses the harness CodeBlock
 * (official shiki core via tsdown vendoring) and lets it draw its own
 * frame/padding — the panel only sizes the viewer area.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/client/styles/preview.module.css'), 'utf8')

describe('code viewer presentation contract', () => {
  it('sizes the CodeBlock viewer area without adding its own chrome', () => {
    expect(css).toContain('.codeViewer')
    expect(css).toContain('padding: 0')
  })

  it('keeps the viewer scrollable and full-height', () => {
    expect(css).toContain('overflow: auto')
    expect(css).toContain('min-height: 0')
  })
})
