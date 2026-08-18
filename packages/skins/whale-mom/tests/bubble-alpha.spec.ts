/**
 * Whale-mom bubble transparency regression (issue #486): user and model
 * bubbles must ride the --dsw-skin-bubble-alpha knob with a 50% default, so
 * the skin-center bubble-opacity slider can tune them live and the default
 * look is half-transparent instead of the previous near-opaque fill.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/whale-mom.module.css', import.meta.url), 'utf8')

describe('whale-mom bubble transparency', () => {
  it('declares the default bubble alpha as 0.5 on the scoped body', () => {
    expect(css).toContain('--dsw-skin-bubble-alpha: 0.5')
  })

  it('rides the official user-bubble token on the alpha variable (light and dark)', () => {
    expect(css).toContain('--dsw-specific-bubble: rgba(246, 250, 254, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-specific-bubble: rgba(11, 16, 30, var(--dsw-skin-bubble-alpha, 0.5))')
  })

  it('rides the model-output bubble tokens on the alpha variable (light and dark)', () => {
    expect(css).toContain('--dsw-skin-bubble: rgba(255, 255, 255, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v2: rgba(246, 250, 254, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v3: rgba(249, 252, 254, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v4: rgba(246, 250, 254, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble: rgba(11, 16, 30, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v2: rgba(11, 16, 30, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v3: rgba(11, 16, 30, var(--dsw-skin-bubble-alpha, 0.5))')
    expect(css).toContain('--dsw-skin-bubble-v4: rgba(10, 14, 27, var(--dsw-skin-bubble-alpha, 0.5))')
  })
})
