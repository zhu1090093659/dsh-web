// @vitest-environment jsdom
/**
 * resolveTerminalFontFamily unit tests (issue #577): the settings override
 * wins, then --dsh-ssh-terminal-font, then the official --ds-font-family-code
 * token, then the built-in fallback stack; blank values never win.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { resolveTerminalFontFamily, TERMINAL_FONT_FALLBACK } from '../src/client/panel/helpers.ts'

afterEach(() => {
  document.body.removeAttribute('style')
  document.head.replaceChildren()
})

describe('resolveTerminalFontFamily (#577)', () => {
  it('falls back to the built-in stack when nothing is configured', () => {
    expect(resolveTerminalFontFamily()).toBe(TERMINAL_FONT_FALLBACK)
    expect(resolveTerminalFontFamily('')).toBe(TERMINAL_FONT_FALLBACK)
    expect(resolveTerminalFontFamily('   ')).toBe(TERMINAL_FONT_FALLBACK)
  })

  it('lets the settings override win over any CSS custom property', () => {
    document.body.style.setProperty('--dsh-ssh-terminal-font', '"SauceCodePro Nerd Font", monospace')
    expect(resolveTerminalFontFamily('User Mono, monospace')).toBe('User Mono, monospace')
  })

  it('reads --dsh-ssh-terminal-font before --ds-font-family-code', () => {
    document.body.style.setProperty('--ds-font-family-code', 'Code Mono, monospace')
    document.body.style.setProperty('--dsh-ssh-terminal-font', '"SauceCodePro Nerd Font", monospace')
    expect(resolveTerminalFontFamily()).toBe('"SauceCodePro Nerd Font", monospace')
  })

  it('falls back to the official code-font token when the dedicated hook is unset', () => {
    document.body.style.setProperty('--ds-font-family-code', 'Code Mono, monospace')
    expect(resolveTerminalFontFamily()).toBe('Code Mono, monospace')
  })

  it('resolves custom properties from a stylesheet, not only inline style', () => {
    const style = document.createElement('style')
    style.textContent = 'body { --dsh-ssh-terminal-font: "JetBrainsMono Nerd Font", monospace; }'
    document.head.appendChild(style)
    expect(resolveTerminalFontFamily()).toBe('"JetBrainsMono Nerd Font", monospace')
  })

  it('ignores a custom property that is only whitespace', () => {
    document.body.style.setProperty('--dsh-ssh-terminal-font', '  ')
    expect(resolveTerminalFontFamily()).toBe(TERMINAL_FONT_FALLBACK)
  })
})
