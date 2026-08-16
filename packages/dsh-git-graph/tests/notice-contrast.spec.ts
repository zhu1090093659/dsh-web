/**
 * Switch-notice contrast guard: the feedback banners must never pair a
 * solid state-secondary fill with state-primary text. Dark themes alias
 * both state tokens onto the same static color (the official dark theme
 * maps error primary and secondary to red-400), which rendered the
 * rejection copy invisible — an empty-looking solid red box. The banners
 * tint from the primary token over transparent instead (the aionui-panel
 * scm banner idiom).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../src/client/chips/context.module.css', import.meta.url), 'utf8')

/** Extract one top-level rule block's body by its class name. */
function ruleBody(name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(source)
  if (match === null) throw new Error(`.${name} rule not found in context.module.css`)
  return match[1] ?? ''
}

describe('switch notice contrast', () => {
  it('never uses a solid state-secondary fill for the notice banners', () => {
    // The exact invisible pairing this guard exists to ban.
    expect(source).not.toMatch(/background(-color)?:\s*var\(--dsw-alias-state-error-secondary\)/)
    expect(source).not.toMatch(/background(-color)?:\s*var\(--dsw-alias-state-success-secondary\)/)
  })

  it('tints the error banner from the primary token over transparent', () => {
    const body = ruleBody('notice')
    expect(body).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--dsw-alias-state-error-primary\)\s+\d+%,\s*transparent\)/)
    expect(body).toMatch(/color:\s*var\(--dsw-alias-state-error-primary\)/)
  })

  it('tints the success banner from the primary token over transparent', () => {
    const body = ruleBody('noticeOk')
    expect(body).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--dsw-alias-state-success-primary\)\s+\d+%,\s*transparent\)/)
    expect(body).toMatch(/color:\s*var\(--dsw-alias-state-success-primary\)/)
  })
})
