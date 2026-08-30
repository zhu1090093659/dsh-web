// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { URL as FileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new FileURL('../src/client/panel/panel.module.css', import.meta.url), 'utf8')
const source = readFileSync(new FileURL('../src/client/sidebar-entry.ts', import.meta.url), 'utf8')

describe('SSH sidebar entry layout (#872)', () => {
  it('uses an explicit navigation icon box and visible 18px glyph', () => {
    expect(source).toContain('width="18" height="18"')
    expect(css).toMatch(/\.entryIcon\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s)
    expect(css).toMatch(/\.entryIcon svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s)
    expect(css).toMatch(/\.entry:hover\s*\{[^}]*var\(--dsw-alias-interactive-bg-hover\)/s)
    expect(css).toMatch(/\.entry\[data-active\]\s*\{[^}]*var\(--dsw-alias-interactive-bg-active\)/s)
  })

  it.each([false, true])('centers the native collapsed rail (compat frame: %s)', (compatFrame) => {
    const frame = document.createElement('main')
    frame.toggleAttribute('data-dsh-frame', compatFrame)
    frame.setAttribute('data-sidebar-collapsed', '')
    frame.innerHTML = '<button class="entry"><span class="entryIcon"></span><span class="entryLabel">SSH</span></button>'
    const style = document.createElement('style')
    // Exercise the actual entry rules without unrelated panel styles.
    style.textContent = css.slice(css.indexOf('.entry {'), css.indexOf('/* --- panel frame'))
    document.head.append(style)
    document.body.append(frame)
    try {
      const entry = frame.querySelector<HTMLElement>('.entry')!
      const label = frame.querySelector<HTMLElement>('.entryLabel')!
      const collapsed = getComputedStyle(entry)
      expect(collapsed.justifyContent).toBe('center')
      expect(collapsed.paddingLeft).toBe('0px')
      expect(collapsed.paddingRight).toBe('0px')
      expect(collapsed.width).toBe('36px')
      expect(collapsed.minHeight).toBe('36px')
      expect(collapsed.margin).toBe('0px auto 12px')
      expect(collapsed.borderRadius).toBe('50%')
      expect(getComputedStyle(label).display).toBe('none')

      frame.removeAttribute('data-sidebar-collapsed')
      const expanded = getComputedStyle(entry)
      expect(expanded.width).toBe('100%')
      expect(expanded.paddingLeft).toBe('10px')
      expect(expanded.paddingRight).toBe('10px')
      expect(getComputedStyle(label).display).not.toBe('none')
    } finally {
      frame.remove()
      style.remove()
    }
  })
})
