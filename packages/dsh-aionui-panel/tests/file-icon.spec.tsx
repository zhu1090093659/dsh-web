// @vitest-environment jsdom
/**
 * FileTypeIcon smoke tests: real vscode-icons logos are picked per file
 * type (data-file-logo id), and the folder glyph is kept for SCM rows.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { FileTypeIcon } from '../src/client/components/FileIcon.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { document.body.innerHTML = '' })

function renderIcon(name: string, isDir = false): HTMLElement | null {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<FileTypeIcon name={name} isDir={isDir} expanded={false} />)
  })
  return host.querySelector('[data-file-logo], svg')
}

describe('FileTypeIcon vscode-icons logos', () => {
  it('picks the typescript logo for .ts and the react logo for .tsx', () => {
    expect(renderIcon('app.ts')?.getAttribute('data-file-logo')).toBe('typescript')
    expect(renderIcon('app.tsx')?.getAttribute('data-file-logo')).toBe('reactts')
  })

  it('picks distinct logos for js, json, html, css and markdown', () => {
    expect(renderIcon('a.js')?.getAttribute('data-file-logo')).toBe('js')
    expect(renderIcon('b.json')?.getAttribute('data-file-logo')).toBe('json')
    expect(renderIcon('index.html')?.getAttribute('data-file-logo')).toBe('html')
    expect(renderIcon('style.css')?.getAttribute('data-file-logo')).toBe('css')
    expect(renderIcon('README.md')?.getAttribute('data-file-logo')).toBe('markdown')
  })

  it('renders a real svg logo (not a generic file page) for ts', () => {
    const logo = renderIcon('app.ts')
    expect(logo?.innerHTML.length).toBeGreaterThan(200)
  })

  it('keeps the folder glyph for directory rows (SCM tree usage)', () => {
    expect(renderIcon('src', true)).not.toBeNull()
  })
})
