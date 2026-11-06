// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from '../../src/client/sanitize.ts'

describe('diagram SVG sanitizing', () => {
  it('user never receives executable elements or attributes in a diagram', () => {
    // Given rendered markup carrying a script, a nested foreignObject script,
    // an event handler and a javascript: link
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<script>alert(1)</script>'
      + '<foreignObject><script>alert(2)</script></foreignObject>'
      + '<a onclick="alert(3)" href=" javascript:alert(4)"><text>x</text></a>'
      + '</svg>'
    // When it is sanitized
    const cleaned = sanitizeSvg(hostile)
    // Then every offensive construct is gone and the harmless text survives
    expect(cleaned.toLowerCase()).not.toContain('<script')
    expect(cleaned.toLowerCase()).not.toContain('foreignobject')
    expect(cleaned.toLowerCase()).not.toContain('javascript:')
    expect(cleaned.toLowerCase()).not.toContain('onclick')
    expect(cleaned).toContain('<text>x</text>')
  })

  it('user never receives a javascript: link whose scheme is split by whitespace characters', () => {
    // Given rendered markup hiding the scheme behind a tab, a line feed, a carriage
    // return and an entity-encoded tab, beside one ordinary link
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
      + '<a href="java\tscript:alert(1)"><text>tab</text></a>'
      + '<a href="java\nscript:alert(2)"><text>feed</text></a>'
      + '<a xlink:href="java\rscript:alert(3)"><text>carriage</text></a>'
      + '<a href="java&#9;script:alert(4)"><text>entity</text></a>'
      + '<a href="https://example.com/ok"><text>ok</text></a>'
      + '</svg>'
    // When it is sanitized
    const cleaned = sanitizeSvg(hostile)
    // Then every obfuscated link loses its URL attribute, the ordinary link keeps its
    // target, and the labels survive
    expect(cleaned).not.toMatch(/href="java/i)
    expect(cleaned).not.toContain('script:')
    expect(cleaned).toContain('href="https://example.com/ok"')
    expect(cleaned).toContain('<text>entity</text>')
  })

  it('user never receives a javascript: link led by a C0 control character', () => {
    // Given rendered markup whose link starts with a C0 control character
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><a href="\u0001javascript:alert(1)"><text>x</text></a></svg>'
    // When it is sanitized
    const cleaned = sanitizeSvg(hostile)
    // Then the link loses its target and the label survives
    expect(cleaned).not.toContain('href=')
    expect(cleaned).toContain('<text>x</text>')
  })

  it('user never receives a data: or vbscript: link in a diagram', () => {
    // Given rendered markup linking to a data: document, a data: image the mermaid
    // runtime never emits (its own sanitize-url blocks the scheme too) and a
    // vbscript: target, beside one ordinary link
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><text>markup</text></a>'
      + '<a href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="><text>image</text></a>'
      + '<a href="VBScript:msgbox(1)"><text>vbscript</text></a>'
      + '<a href="https://example.com/ok"><text>ok</text></a>'
      + '</svg>'
    // When it is sanitized
    const cleaned = sanitizeSvg(hostile)
    // Then every executable scheme loses its URL attribute and the ordinary link stays
    expect(cleaned).not.toContain('data:')
    expect(cleaned).not.toContain('vbscript:')
    expect(cleaned).not.toContain('VBScript:')
    expect(cleaned).toContain('href="https://example.com/ok"')
  })

  it('user receives ordinary mermaid markup unchanged', () => {
    // Given a plain diagram
    const clean = '<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><text>A</text></g></svg>'
    // When it is sanitized
    // Then nothing is stripped
    expect(sanitizeSvg(clean)).toBe(clean)
  })

  it('user keeps the code block when cleaned markup is still suspicious', () => {
    // Given a style block whose text keeps a javascript: token (not an attribute)
    const sneaky = '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "javascript:x";</style></svg>'
    // When it is sanitized
    // Then the caller learns it must fall back
    expect(() => sanitizeSvg(sneaky)).toThrow(/executable content/)
  })
})