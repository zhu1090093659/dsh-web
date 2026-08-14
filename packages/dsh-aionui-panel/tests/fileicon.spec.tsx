/**
 * FileTypeIcon: per-language colored badges for known extensions and exact
 * filenames, outline folders, and the kind-icon fallback for unmapped types.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTypeIcon } from '../src/client/components/FileIcon.tsx'

function icon(name: string, isDir = false, expanded = false): string {
  return renderToStaticMarkup(createElement(FileTypeIcon, { name, isDir, expanded }))
}

describe('FileTypeIcon badges', () => {
  it('renders a colored badge with the language label for known extensions', () => {
    const ts = icon('app.tsx')
    expect(ts).toContain('fill="#3178c6"')
    expect(ts).toContain('>TS</text>')
    expect(icon('README.md')).toContain('>MD</text>')
    expect(icon('script.py')).toContain('>Py</text>')
  })

  it('prefers exact filenames over the extension mapping', () => {
    expect(icon('package.json')).toContain('fill="#cb3837"')
    expect(icon('other.json')).toContain('>{}</text>')
    expect(icon('Dockerfile')).toContain('fill="#2496ed"')
  })

  it('keeps outline folder icons for directories', () => {
    expect(icon('src', true)).toContain('stroke="currentColor"')
    expect(icon('src', true)).not.toContain('<rect')
  })

  it('falls back to kind icons for unmapped types', () => {
    const image = icon('photo.png')
    expect(image).toContain('stroke="currentColor"')
    expect(image).not.toContain('<rect')
    expect(icon('mystery.xyz')).not.toContain('<rect')
  })
})
