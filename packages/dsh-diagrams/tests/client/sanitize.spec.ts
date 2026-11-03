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