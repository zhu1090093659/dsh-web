import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The host mounts the New Session button as the first control of the sidebar
// logo row; the skin rebrands it with the DSH wordmark. A pointer-events:none
// on that button (regression 2026-09-10) silently killed new-session clicks in
// the wide sidebar while the narrow layout kept working, so guard both
// stylesheets against ever targeting the brand button with pointer-events:none.
describe('orca-link sidebar hit targets', () => {
  const sheets: Array<[string, string]> = [
    ['skin.css', resolve(__dirname, '../skins/orca-link/skin.css')],
    ['patches.css', resolve(__dirname, '../skins/orca-link/patches.css')],
  ]

  it('keeps the brand New Session button clickable in every state', () => {
    for (const [filename, file] of sheets) {
      const stripped = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
      const rules = stripped.match(/[^{}]+\{[^{}]*\}/g) ?? []
      const offenders = rules.filter((rule) => {
        const brace = rule.indexOf('{')
        const selector = rule.slice(0, brace)
        const body = rule.slice(brace)
        return selector.includes('[data-orca-link-brand]') && /pointer-events\s*:\s*none/.test(body)
      })
      expect(offenders, `${filename} disables pointer events on the brand button`).toEqual([])
    }
  })
})
