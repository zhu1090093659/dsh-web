import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// dsh-better-sidebar appends a static, zero-height wrapper to document.body and
// mounts its viewport-sized fixed panel host inside it. A non-none
// backdrop-filter on either shell makes that shell the containing block of the
// fixed host, so the host resolves against the empty wrapper, collapses to
// 1600x0, and its own overflow: clip removes every panel from painting and from
// hit testing. The 2026-09-16 regression shipped exactly that way and is
// invisible in a page screenshot, so pin the shells mechanically: they may be
// anchored, never painted. Descendant selectors stay legal - the panels inside
// carry the glass.
const SHELLS = ['[data-dsh-better-sidebar]', '[data-dsh-panel-host]']

// Declarations that make an element the containing block of its fixed or
// absolutely positioned descendants.
const FORBIDDEN = [
  /-webkit-backdrop-filter\s*:/,
  /(?:^|[\s;{])backdrop-filter\s*:/,
  /(?:^|[\s;{])transform\s*:/,
  /(?:^|[\s;{])filter\s*:/,
  /(?:^|[\s;{])perspective\s*:/,
  /(?:^|[\s;{])will-change\s*:/,
  /(?:^|[\s;{])contain\s*:/,
]

// A rule only counts when a shell is the SUBJECT (the rightmost compound of one
// selector part); host-prefixed descendant rules are expected to exist.
const paintsShell = (selector: string): boolean =>
  selector.split(',').some((part) => {
    const subject = part.trim().split(/\s+|>/).filter(Boolean).pop() ?? ''
    return SHELLS.includes(subject)
  })

describe('wallpaper-exclusive better-sidebar host shells', () => {
  const sheets: Array<[string, string]> = [
    ['skin.css', resolve(__dirname, '../skins/wallpaper-exclusive/skin.css')],
    ['patches.css', resolve(__dirname, '../skins/wallpaper-exclusive/patches.css')],
  ]

  it('user opening the sidebar gets no host shell painted as a containing block', () => {
    // Given the wallpaper-exclusive sheets that style the plugin host shells
    const offenders: string[] = []

    // When every rule whose subject is a shell is scanned for the declarations
    // that would make it the containing block of its fixed panels
    for (const [filename, file] of sheets) {
      const stripped = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
      const rules = stripped.match(/[^{}]+\{[^{}]*\}/g) ?? []
      for (const rule of rules) {
        const brace = rule.indexOf('{')
        const selector = rule.slice(0, brace)
        const body = rule.slice(brace)
        if (paintsShell(selector) && FORBIDDEN.some((pattern) => pattern.test(body))) {
          offenders.push(filename + ': ' + selector.trim())
        }
      }
    }

    // Then no host shell is painted
    expect(offenders).toEqual([])
  })
})
