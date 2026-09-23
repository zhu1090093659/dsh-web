import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('maid-atelier composer input color regression (Issue #1405)', () => {
  const patchesCss = readFileSync(
    resolve(__dirname, '../skins/maid-atelier/patches.css'),
    'utf-8',
  )

  it('pins porcelain color on lexical contenteditable input inside composer card', () => {
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\[data-composer-input\][\s\S]*?color:\s*#eef3fc/,
    )
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\[data-lexical-editor\][\s\S]*?color:\s*#eef3fc/,
    )
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\[contenteditable="true"\][\s\S]*?color:\s*#eef3fc/,
    )
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\.uV2eYG_input[\s\S]*?color:\s*#eef3fc/,
    )
  })

  it('ensures children span inherit light color and caret-color is pinned', () => {
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+:is\(\[data-composer-input\],\s*\[data-lexical-editor\],\s*\[contenteditable="true"\]\)\s+span\s*\{\s*color:\s*inherit;\s*\}/,
    )
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\[data-composer-input\][\s\S]*?caret-color:\s*#bcd2ff/,
    )
  })

  it('pins placeholder color for both textarea and contenteditable placeholder nodes', () => {
    expect(patchesCss).toMatch(
      /\[data-composer-card\]\s+\[class\*="placeholder"\][\s\S]*?color:\s*#b6c2e0/,
    )
  })
})
