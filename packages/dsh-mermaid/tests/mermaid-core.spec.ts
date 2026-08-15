// @vitest-environment jsdom
/**
 * Core facts: the settings schema defaults, the theme normalizer, the auto
 * theme resolution, the package invariants, and the zh/en dictionary parity.
 */
import { describe, expect, it } from 'vitest'
import { makeMermaidSettingsSchema, MERMAID_THEMES } from '../src/index.ts'
import { normalizeTheme } from '../src/core/themes.ts'
import { resolveAutoTheme } from '../src/client/auto-theme.ts'
import { dictionaries, zh } from '../src/client/locales.ts'
import '../src/invariant.ts'

describe('makeMermaidSettingsSchema', () => {
  it('fills the defaults for an empty aggregate config', () => {
    expect(makeMermaidSettingsSchema()({})).toEqual({ enabled: true, theme: 'auto' })
  })

  it('accepts a stored free-form theme string', () => {
    expect(makeMermaidSettingsSchema()({ theme: 'forest', enabled: false }))
      .toEqual({ theme: 'forest', enabled: false })
  })
})

describe('normalizeTheme', () => {
  it('keeps every selectable theme', () => {
    for (const theme of MERMAID_THEMES) {
      expect(normalizeTheme(theme)).toBe(theme)
    }
  })

  it('falls back to auto for unknown or missing values', () => {
    expect(normalizeTheme('retro')).toBe('auto')
    expect(normalizeTheme(undefined)).toBe('auto')
    expect(normalizeTheme(42)).toBe('auto')
  })
})

describe('resolveAutoTheme', () => {
  it('picks dark for a dark body background and default for a light one', () => {
    const dark = document.createElement('body')
    dark.style.backgroundColor = 'rgb(18, 18, 24)'
    const light = document.createElement('body')
    light.style.backgroundColor = 'rgb(250, 250, 250)'
    const doc = { defaultView: window, body: dark } as unknown as Document
    expect(resolveAutoTheme(doc)).toBe('dark')
    const docLight = { defaultView: window, body: light } as unknown as Document
    expect(resolveAutoTheme(docLight)).toBe('default')
  })
})

describe('client dictionaries', () => {
  it('carries the complete key set in every language', () => {
    expect(Object.keys(dictionaries.en!).sort()).toEqual(Object.keys(zh).sort())
  })
})
