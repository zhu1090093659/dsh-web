import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// whale-mom's shell-wide [class*="bubble"] color rule also lands on the pet's
// usage / status bubbles, whose background dsh-pet always paints dark navy
// (.bubbleUsage). In the light theme --dsh-skin-text-strong is near-black, so
// the "今日 ¥0.00 / 空闲时段 计价减半 · 余额" bubble became unreadable
// (zhu1090093659/dsh-web#1636). A pet-scoped rule must keep the last word and
// restore the pet's own light text color; the check is mechanical so the guard
// cannot be dropped silently again.
const PET_TEXT_COLOR = '#f4f7ff'

const ATTRIBUTE_UNITS = /\[[^\]]*\]/g
const CLASS_UNITS = /\.[A-Za-z_-][\w-]*/g
const ID_UNITS = /#[A-Za-z_-][\w-]*/g

const specificity = (selector: string): number => {
  const attributes = selector.match(ATTRIBUTE_UNITS)?.length ?? 0
  const classes = selector.match(CLASS_UNITS)?.length ?? 0
  const ids = selector.match(ID_UNITS)?.length ?? 0
  return attributes + classes + ids
}

describe('whale-mom pet bubble contrast', () => {
  const stripped = readFileSync(resolve(__dirname, '../skins/whale-mom/patches.css'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = (stripped.match(/[^{}]+\{[^{}]*\}/g) ?? []).map((rule) => {
    const brace = rule.indexOf('{')
    return {
      selectors: rule
        .slice(0, brace)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
      body: rule.slice(brace),
    }
  })

  const bubbleRules = rules.flatMap((rule) =>
    rule.selectors
      .filter((selector) => selector.includes('[class*="bubble"]'))
      .map((selector) => ({ selector, body: rule.body })),
  )

  it('colors the shell-wide bubble rule from the theme token', () => {
    expect(
      bubbleRules.some(
        (rule) =>
          rule.selector === '[class*="bubble"]' &&
          rule.body.includes('color: var(--dsh-skin-text-strong)'),
      ),
      'shell-wide [class*="bubble"] color rule missing — update this test with the skin',
    ).toBe(true)
  })

  it('restores the pet bubble text color with equal-or-higher specificity', () => {
    const shellWide = bubbleRules.filter((rule) => rule.selector === '[class*="bubble"]')
    const guards = bubbleRules.filter((rule) => rule.selector.includes('[data-dsh-pet-root]'))
    expect(guards.length, 'no [data-dsh-pet-root] guard for the bubble color').toBeGreaterThan(0)
    const light = guards.filter((rule) => rule.body.includes('color: ' + PET_TEXT_COLOR))
    expect(light.length, 'pet bubble guard does not set ' + PET_TEXT_COLOR).toBeGreaterThan(0)
    const maxShell = Math.max(...shellWide.map((rule) => specificity(rule.selector)))
    expect(
      light.some((rule) => specificity(rule.selector) > maxShell),
      'pet bubble guard must out-specify the shell-wide rule (source order is not enough once skin-center prefixes both)',
    ).toBe(true)
  })
})
