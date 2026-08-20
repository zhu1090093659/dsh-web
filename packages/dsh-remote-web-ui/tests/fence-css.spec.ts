/**
 * Unpaired blocking page layout: the card stays centered in the viewport
 * and its heading block is centered, while the step list stays left-aligned
 * for readable numbered copy.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/remote.module.css', import.meta.url), 'utf8')

/** Extract one top-level rule block's body by its class name. */
function ruleBody(name: string): string {
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)
  if (match === null) throw new Error(`.${name} rule not found in remote.module.css`)
  return match[1] ?? ''
}

describe('unpaired fence page centering', () => {
  it('centers the blocking page and card on both axes', () => {
    const page = ruleBody('fencePage')
    expect(page).toContain('display: flex')
    expect(page).toContain('align-items: center')
    expect(page).toContain('justify-content: center')
    expect(page).toContain('text-align: center')

    const card = ruleBody('fenceCard')
    expect(card).toContain('margin-inline: auto')
    expect(card).toContain('text-align: center')
    expect(ruleBody('fenceMark')).toContain('margin-inline: auto')
  })

  it('keeps the numbered steps left-aligned inside the centered card', () => {
    const steps = ruleBody('fenceSteps')
    expect(steps).toContain('margin: 24px auto 0')
    expect(steps).toContain('text-align: left')
  })
})
