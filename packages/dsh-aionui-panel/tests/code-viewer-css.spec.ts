/**
 * Code-viewer presentation contract: the preview must render shiki-highlighted
 * source as a plain full-bleed view — the harness CodeBlock banner (language
 * label + copy button) and card chrome are stripped by preview.module.css.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/client/styles/preview.module.css'), 'utf8')

describe('code viewer presentation contract', () => {
  it('hides the CodeBlock language/copy banner', () => {
    expect(css).toContain('.md-code-block > div:first-child')
    expect(css).toContain('display: none')
  })

  it('renders highlighted code as a plain full-bleed source view', () => {
    expect(css).toContain('.md-code-block pre')
    expect(css).toContain('white-space: pre')
    expect(css).toContain('background: transparent !important')
  })
})
