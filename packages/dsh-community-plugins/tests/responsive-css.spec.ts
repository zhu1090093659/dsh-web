import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/client/community.module.css', 'utf8')

function rule(selector: string): string {
  const match = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))
  if (match === null) throw new Error(`.${selector} rule not found in community.module.css`)
  return match[1]
}

describe('community market responsive controls', () => {
  it('wraps filters instead of crushing the search field in a narrow settings pane', () => {
    expect(rule('filterControls')).toMatch(/display:\s*flex/)
    expect(rule('filterControls')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('search')).toMatch(/flex:\s*1 1 180px/)
  })
})
