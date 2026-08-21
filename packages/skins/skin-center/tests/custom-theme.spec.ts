import { describe, expect, it } from 'vitest'

import { OFFICIAL_TOKENS } from '../src/core/css-safety/official-tokens.generated.ts'
import {
  CUSTOM_THEME_DEFAULTS,
  buildCustomThemeCss,
  normalizeCustomThemeConfig,
} from '../src/core/custom-theme.ts'

describe('custom theme configuration', () => {
  it('falls back field-by-field and clamps contrast for malformed persisted data', () => {
    const config = normalizeCustomThemeConfig({
      version: 1,
      applied: 'yes',
      light: {
        accent: '#123456',
        background: 'red; color: transparent',
        foreground: '#abcdef',
        contrast: 140.7,
      },
      dark: {
        accent: '#1',
        background: '#010203',
        foreground: '#fefefe',
        contrast: -8,
      },
    })

    expect(config).toEqual({
      version: 1,
      applied: false,
      light: {
        accent: '#123456',
        background: CUSTOM_THEME_DEFAULTS.light.background,
        foreground: '#abcdef',
        contrast: 100,
      },
      dark: {
        accent: CUSTOM_THEME_DEFAULTS.dark.accent,
        background: '#010203',
        foreground: '#fefefe',
        contrast: 0,
      },
    })
  })

  it('returns independent copies of the default profiles', () => {
    const first = normalizeCustomThemeConfig(undefined)
    const second = normalizeCustomThemeConfig(undefined)

    first.light.accent = '#000000'
    expect(second).toEqual(CUSTOM_THEME_DEFAULTS)
  })

  it('fails closed for an unknown future configuration version', () => {
    const config = normalizeCustomThemeConfig({
      version: 99,
      applied: true,
      light: { accent: '#000000', background: '#000000', foreground: '#000000', contrast: 100 },
      dark: { accent: '#000000', background: '#000000', foreground: '#000000', contrast: 100 },
    })

    expect(config).toEqual(CUSTOM_THEME_DEFAULTS)
  })
})

describe('custom theme CSS generation', () => {
  it('emits only official tokens under stock-only light and dark selectors', () => {
    const css = buildCustomThemeCss({
      ...CUSTOM_THEME_DEFAULTS,
      light: { accent: '#112233', background: '#f1f2f3', foreground: '#101112', contrast: 25 },
      dark: { accent: '#aabbcc', background: '#090a0b', foreground: '#f8f9fa', contrast: 75 },
    })

    expect(css).toContain('html[data-dsh-custom-theme]:not([data-dsh-skin]) body {')
    expect(css).toContain('html[data-dsh-custom-theme]:not([data-dsh-skin]) body[data-ds-dark-theme] {')
    expect(css).toContain('--dsw-alias-brand-primary: #112233;')
    expect(css).toContain('--dsw-alias-bg-base: #f1f2f3;')
    expect(css).toContain('--dsw-alias-label-primary: #101112;')
    expect(css).toContain('--dsw-alias-brand-primary: #aabbcc;')

    const declared = [...css.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1])
    expect(declared.length).toBeGreaterThan(12)
    expect(new Set(declared).size).toBeLessThan(declared.length)
    for (const token of declared) expect(OFFICIAL_TOKENS).toContain(token)
  })

  it('normalizes untrusted profiles before interpolating CSS', () => {
    const css = buildCustomThemeCss({
      version: 1,
      applied: true,
      light: {
        accent: '#12; } body { display: none',
        background: '#ffffff',
        foreground: '#000000',
        contrast: Number.POSITIVE_INFINITY,
      },
      dark: CUSTOM_THEME_DEFAULTS.dark,
    } as never)

    expect(css).not.toContain('display: none')
    expect(css).not.toContain('Infinity')
    expect(css).toContain(`--dsw-alias-brand-primary: ${CUSTOM_THEME_DEFAULTS.light.accent};`)
  })
})
