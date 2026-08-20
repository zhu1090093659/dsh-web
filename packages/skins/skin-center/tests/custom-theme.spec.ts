import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CUSTOM_THEME,
  customThemeCss,
  validateCustomThemeProfile,
  type CustomThemeProfile,
} from '../src/client/custom-theme.ts'

describe('custom theme profile', () => {
  it('normalizes valid colors and clamps contrast to 0..100', () => {
    const result = validateCustomThemeProfile({
      accent: '#AABBCC',
      background: 'invalid',
      foreground: '#112233',
      contrast: 101,
    }, DEFAULT_CUSTOM_THEME.light)

    expect(result).toEqual({
      accent: '#aabbcc',
      background: DEFAULT_CUSTOM_THEME.light.background,
      foreground: '#112233',
      contrast: 100,
    })
  })

  it('derives visible surface, text, action, bubble and state tokens from all three colors', () => {
    const profile: CustomThemeProfile = {
      accent: '#123456',
      background: '#223344',
      foreground: '#fefefe',
      contrast: 15,
    }
    const css = customThemeCss(profile)

    expect(css).toContain('--dsw-alias-bg-base: #223344')
    expect(css).toContain('--dsw-alias-brand-primary: #123456')
    expect(css).toContain('--dsw-alias-label-primary: #fefefe')
    expect(css).toContain('--dsw-alias-button-primary-fill: #123456')
    expect(css).toContain('--dsw-specific-bubble:')
    expect(css).toContain('--dsw-alias-state-error-primary:')
    expect(css).toContain('--dsh-custom-theme-contrast:')
    expect(css).not.toContain('filter: contrast')
  })

  it('keeps the light and dark defaults independent', () => {
    expect(DEFAULT_CUSTOM_THEME.light).toEqual({
      accent: '#4f6faf', background: '#f7f9fc', foreground: '#1b2533', contrast: 50,
    })
    expect(DEFAULT_CUSTOM_THEME.dark).toEqual({
      accent: '#86a7ff', background: '#162235', foreground: '#e7edf7', contrast: 50,
    })
    expect(DEFAULT_CUSTOM_THEME.light).not.toEqual(DEFAULT_CUSTOM_THEME.dark)
    expect(DEFAULT_CUSTOM_THEME.light.contrast).toBe(50)
    expect(DEFAULT_CUSTOM_THEME.dark.contrast).toBe(50)
  })
})
