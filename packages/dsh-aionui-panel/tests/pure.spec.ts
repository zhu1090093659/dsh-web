/**
 * Pure helper tests: markdown rendering (escaping first, own tags only),
 * CSV parsing, URL normalization, grid-track parsing, and content-type
 * detection.
 */
import { describe, expect, it } from 'vitest'
import { renderInline, renderMarkdown, resolveMarkdownImage } from '../src/client/preview/markdown.ts'
import { parseCsv, normalizeUrl } from '../src/client/preview/content.tsx'
import { parseGridTracks, trackPx } from '../src/client/layout.ts'
import { detectContentType, pdfPreviewUrl } from '../src/client/fileType.ts'

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and hr', () => {
    const html = renderMarkdown('# Title\n\nbody text\n\n---\n')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>body text</p>')
    expect(html).toContain('<hr />')
  })

  it('escapes raw HTML and keeps code blocks intact', () => {
    const html = renderMarkdown('```ts\nconst x = "<b>"\n```\n\n<script>alert(1)</script>')
    expect(html).toContain('<pre class="language-ts"><code>const x = &quot;&lt;b&gt;&quot;</code></pre>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders inline formatting', () => {
    expect(renderInline('a **b** c')).toBe('a <strong>b</strong> c')
    expect(renderInline('a *b* c')).toBe('a <em>b</em> c')
    expect(renderInline('`code` here')).toBe('<code>code</code> here')
    expect(renderInline('[x](https://a.b)')).toBe('<a href="https://a.b" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('renders tables', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders lists and blockquotes', () => {
    const html = renderMarkdown('- one\n- two\n\n> quote\n')
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
    expect(html).toContain('<blockquote><p>quote</p></blockquote>')
  })
})

describe('parseCsv', () => {
  it('parses quoted cells and escaped quotes', () => {
    const rows = parseCsv('a,"b,c","d""e"\n1,2,3\n')
    expect(rows).toEqual([['a', 'b,c', 'd"e'], ['1', '2', '3']])
  })
})

describe('normalizeUrl', () => {
  it('adds https to bare domains and searches whitespace queries', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('hello world')).toContain('https://www.bing.com/search?q=')
    expect(normalizeUrl('')).toBe('about:blank')
  })
})

describe('parseGridTracks / trackPx', () => {
  it('parses the shell inline grid including minmax with spaces', () => {
    const tracks = parseGridTracks('280px minmax(0, 1fr) 0px')
    expect(tracks).toEqual(['280px', 'minmax(0, 1fr)', '0px'])
    expect(trackPx(tracks[0])).toBe(280)
    expect(trackPx(tracks[1])).toBe(0)
    expect(trackPx(tracks[2])).toBe(0)
  })

  it('parses five-track strings', () => {
    const tracks = parseGridTracks('280px minmax(0, 1fr) 0px 480px 260px')
    expect(tracks).toHaveLength(5)
    expect(trackPx(tracks[3])).toBe(480)
    expect(trackPx(tracks[4])).toBe(260)
  })
})

describe('detectContentType', () => {
  it('maps the format set', () => {
    expect(detectContentType('README.md')).toBe('markdown')
    expect(detectContentType('index.html')).toBe('html')
    expect(detectContentType('app.tsx')).toBe('code')
    expect(detectContentType('patch.diff')).toBe('diff')
    expect(detectContentType('data.csv')).toBe('csv')
    expect(detectContentType('doc.pdf')).toBe('pdf')
    expect(detectContentType('a.docx')).toBe('word')
    expect(detectContentType('b.xlsx')).toBe('excel')
    expect(detectContentType('c.pptx')).toBe('ppt')
    expect(detectContentType('pic.png')).toBe('image')
    expect(detectContentType('LICENSE')).toBe('text')
    expect(detectContentType('weird.bin')).toBe('unsupported')
  })
})

describe('pdfPreviewUrl (issue #236)', () => {
  it('encodes root and path and appends the nonce as &v=', () => {
    const url = pdfPreviewUrl('C:\\work dir', 'docs/a b#1.pdf', 42)
    expect(url).toBe(
      `/aionui-panel/raw?root=${encodeURIComponent('C:\\work dir')}&path=${encodeURIComponent('docs/a b#1.pdf')}&v=42`,
    )
    // Space and # must never survive raw into the URL.
    expect(url).not.toContain(' ')
    expect(url).not.toContain('#')
    expect(url).toContain('a%20b%231.pdf')
    expect(url.endsWith('&v=42')).toBe(true)
  })
})

describe('resolveMarkdownImage', () => {
  it('leaves absolute URLs and fragments to the browser', () => {
    expect(resolveMarkdownImage('a.md', 'https://x.y/i.png')).toEqual({ kind: 'absolute' })
    expect(resolveMarkdownImage('a.md', 'data:image/png;base64,xx')).toEqual({ kind: 'absolute' })
    expect(resolveMarkdownImage('a.md', '#frag')).toEqual({ kind: 'absolute' })
    expect(resolveMarkdownImage('a.md', '')).toEqual({ kind: 'absolute' })
  })

  it('resolves relative srcs against the markdown file directory', () => {
    expect(resolveMarkdownImage('docs/a.md', './img.png')).toEqual({ kind: 'relative', path: 'docs/img.png', suffix: '' })
    expect(resolveMarkdownImage('docs/a.md', 'img.png')).toEqual({ kind: 'relative', path: 'docs/img.png', suffix: '' })
    expect(resolveMarkdownImage('docs/a.md', '../img.png')).toEqual({ kind: 'relative', path: 'img.png', suffix: '' })
    expect(resolveMarkdownImage('docs/sub/a.md', '../../top.png')).toEqual({ kind: 'relative', path: 'top.png', suffix: '' })
    // Root-level markdown keeps bare names at the root.
    expect(resolveMarkdownImage('README.md', './img.png')).toEqual({ kind: 'relative', path: 'img.png', suffix: '' })
  })

  it('resolves root-relative srcs from the project root', () => {
    expect(resolveMarkdownImage('docs/a.md', '/img.png')).toEqual({ kind: 'relative', path: 'img.png', suffix: '' })
    expect(resolveMarkdownImage('docs/a.md', '/assets/i.png')).toEqual({ kind: 'relative', path: 'assets/i.png', suffix: '' })
  })

  it('rejects .. escaping the project root', () => {
    expect(resolveMarkdownImage('a.md', '../x.png')).toEqual({ kind: 'escape' })
    expect(resolveMarkdownImage('docs/a.md', '../../x.png')).toEqual({ kind: 'escape' })
  })

  it('preserves query/hash suffixes and decodes percent-encoded names', () => {
    expect(resolveMarkdownImage('docs/a.md', './img.png?v=2#top')).toEqual({ kind: 'relative', path: 'docs/img.png', suffix: '?v=2#top' })
    expect(resolveMarkdownImage('docs/a.md', './my%20img.png')).toEqual({ kind: 'relative', path: 'docs/my img.png', suffix: '' })
    expect(resolveMarkdownImage('docs/a.md', './a%2Fb.png')).toEqual({ kind: 'relative', path: 'docs/a/b.png', suffix: '' })
  })
})

describe('renderMarkdown image resolution hook', () => {
  it('rewrites relative srcs through the resolver', () => {
    const resolve = (src: string): string | null => {
      const r = resolveMarkdownImage('docs/a.md', src)
      return r.kind === 'relative' ? `RAW:${r.path}` : null
    }
    const html = renderMarkdown('![x](./img.png)', { resolveImageSrc: resolve })
    expect(html).toContain('<img alt="x" src="RAW:docs/img.png" />')
  })

  it('drops images the resolver rejects and keeps absolute srcs untouched', () => {
    const drop = (): string | null => null
    const html = renderMarkdown('![x](./img.png) ![y](https://a.b/c.png)', { resolveImageSrc: drop })
    expect(html).not.toContain('<img')
    // No resolver: behavior is unchanged from before.
    expect(renderMarkdown('![x](./img.png)')).toContain('<img alt="x" src="./img.png" />')
  })
})

describe('safeUrl protocol whitelist (M3 regression)', () => {
  it('allows http/https/mailto/relative and rejects dangerous schemes', () => {
    expect(renderInline('[x](https://a.b)')).toContain('<a href="https://a.b"')
    expect(renderInline('[x](http://a.b)')).toContain('<a href="http://a.b"')
    expect(renderInline('[x](mailto:a@b.c)')).toContain('<a href="mailto:a@b.c"')
    expect(renderInline('[x](./rel.md)')).toContain('<a href="./rel.md"')
    expect(renderInline('[x](javascript:alert(1))')).not.toContain('<a')
    expect(renderInline('[x](data:text/html,<b>)')).not.toContain('<a')
    expect(renderInline('[x](vbscript:x)')).not.toContain('<a')
  })

  it('does not emit img tags for dangerous srcs', () => {
    expect(renderInline('![a](javascript:alert(1))')).not.toContain('<img')
    expect(renderInline('![a](data:image/png;base64,xx)')).not.toContain('<img')
    expect(renderInline('![a](https://a.b/c.png)')).toContain('<img')
  })
})

describe('dotfile content detection (M5 regression)', () => {
  it('classifies leading-dot config files as text/code', () => {
    expect(detectContentType('.gitignore')).toBe('text')
    expect(detectContentType('.env')).toBe('text')
    expect(detectContentType('.npmrc')).toBe('text')
    expect(detectContentType('.env.local')).toBe('text')
    expect(detectContentType('.editorconfig')).toBe('text')
  })
})
