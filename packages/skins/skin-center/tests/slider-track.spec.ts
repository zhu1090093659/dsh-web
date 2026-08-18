/**
 * Slider track visibility guard (issue #309): under the official default
 * light theme every --dsw-alias-bg-layer-* token maps to the same white, so
 * a track filled with bg-layer-3 becomes invisible against the card. The
 * track must carry an independent border-token outline and explicit
 * webkit/moz track rules instead of relying on layer contrast alone.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skin-center.module.css', import.meta.url), 'utf8')

describe('skin-center background slider track', () => {
  it('outlines the range track with the border token so it stays visible on same-color layer tokens', () => {
    const block = css.match(/.backgroundRange\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).toContain('box-shadow: 0 0 0 1px var(--dsw-alias-border-l3, #cbd5e1)')
  })

  it('styles the webkit runnable track explicitly', () => {
    const block = css.match(/.backgroundRange::-webkit-slider-runnable-track\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).toContain('height: 4px')
    expect(block).toContain('var(--dsw-alias-bg-layer-3, #e2e8f0)')
  })

  it('styles the moz range track explicitly', () => {
    const block = css.match(/.backgroundRange::-moz-range-track\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).toContain('height: 4px')
    expect(block).toContain('var(--dsw-alias-bg-layer-3, #e2e8f0)')
  })
})
