/**
 * Mobile markdown renderer tests: GFM subset coverage plus the security
 * contract — raw HTML escapes, dangerous link/image protocols are
 * stripped, and code fences never parse their content.
 */
import { describe, expect, it } from 'vitest'
import { escapeHtml, renderInline, renderMarkdown, safeUrl } from './markdown.ts'

describe('safeUrl', () => {
  it('allows http/https/mailto/fragments and scheme-less targets', () => {
    expect(safeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeUrl('http://example.com')).toBe('http://example.com')
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeUrl('#top')).toBe('#top')
    expect(safeUrl('./rel/path')).toBe('./rel/path')
  })

  it('rejects javascript:/data:/vbscript: and blanks', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull()
    expect(safeUrl('data:text/html,x')).toBeNull()
    expect(safeUrl('vbscript:x')).toBeNull()
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })

  it('rejects protocol-relative targets that escape the origin', () => {
    expect(safeUrl('//attacker.example/x')).toBeNull()
    expect(safeUrl('  //attacker.example/track.png')).toBeNull()
  })
})

describe('renderInline', () => {
  it('renders code, bold, italic, strikethrough and links', () => {
    expect(renderInline('`a<b`')).toBe('<code>a&lt;b</code>')
    expect(renderInline('**b**')).toBe('<strong>b</strong>')
    expect(renderInline('*i*')).toBe('<em>i</em>')
    expect(renderInline('~~d~~')).toBe('<del>d</del>')
    expect(renderInline('[x](https://e.com)')).toBe('<a href="https://e.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('strips unsafe link targets and renders the label as plain text', () => {
    expect(renderInline('[x](javascript:alert(1))')).toBe('x')
    expect(renderInline('![a](data:text/html,x)')).toBe('a')
  })

  it('escapes raw HTML instead of passing it through', () => {
    expect(renderInline('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('renderMarkdown', () => {
  it('renders headings, hr, paragraphs', () => {
    const html = renderMarkdown('# T\n\npara\n\n---')
    expect(html).toContain('<h1>T</h1>')
    expect(html).toContain('<p>para</p>')
    expect(html).toContain('<hr />')
  })

  it('renders fenced code without parsing its content', () => {
    const html = renderMarkdown('```ts\nconst a = **bold** <x>\n```')
    expect(html).toBe('<pre class="language-ts"><code>const a = **bold** &lt;x&gt;</code></pre>')
  })

  it('renders lists, blockquotes and tables', () => {
    const html = renderMarkdown('- a\n- b\n\n1. x\n2. y\n\n> quote\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |')
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>')
    expect(html).toContain('<ol><li>x</li><li>y</li></ol>')
    expect(html).toContain('<blockquote><p>quote</p></blockquote>')
    expect(html).toContain('<thead><tr><th>h1</th><th>h2</th></tr></thead>')
    expect(html).toContain('<td>c1</td><td>c2</td>')
  })

  it('normalizes CRLF and keeps user-visible text intact', () => {
    expect(renderMarkdown('a\r\nb')).toBe('<p>a\nb</p>')
  })
})

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&#39;')
  })

  it('equals the five sequential passes on mixed, pre-escaped and plain input', () => {
    // Single-pass map replacement must never diverge from the sequential
    // five-pass escape (including double-escaping of literal entities).
    expect(escapeHtml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f')
    expect(escapeHtml('&amp; &lt; &gt;')).toBe('&amp;amp; &amp;lt; &amp;gt;')
    expect(escapeHtml('plain text 123')).toBe('plain text 123')
    expect(escapeHtml('')).toBe('')
  })
})
