/**
 * Tests for the primary-action token contract audit (issue #506 follow-up).
 * The audit is warning-only; the loader completion keeps every outcome
 * legible, so these tests pin the messaging, not a fail-closed policy.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { auditTokenContract } from '../src/core/css-safety/token-audit.ts'

function audit(css: string, extra = '') {
  return auditTokenContract([{ filename: 'skin.css', css }])
}

const GOOD_TRIO = [
  ':root {',
  '  --dsw-alias-button-primary-fill: #4a5fa8;',
  '  --dsw-alias-button-primary-hover: #5d74c4;',
  '  --dsw-alias-label-primary-foreground: #fff;',
  '}',
  'body[data-ds-dark-theme] {',
  '  --dsw-alias-button-primary-fill: #3c4e92;',
  '  --dsw-alias-button-primary-hover: #4a5fa8;',
  '  --dsw-alias-label-primary-foreground: #fff;',
  '}',
].join('\n')

describe('auditTokenContract completeness', () => {
  it('stays silent for a complete trio in both themes', () => {
    expect(audit(GOOD_TRIO).warnings).toHaveLength(0)
  })

  it('accepts the legacy matched pair (brand-primary + brand-primary-invert)', () => {
    const css = [
      ':root {',
      '  --dsw-alias-brand-primary: #ff9d5c;',
      '  --dsw-alias-brand-primary-invert: #141a2e;',
      '}',
    ].join('\n')
    expect(audit(css).warnings).toHaveLength(0)
  })

  it('warns when the foreground is missing (fill/hover only)', () => {
    const css = [
      ':root {',
      '  --dsw-alias-button-primary-fill: #2fbf8f;',
      '  --dsw-alias-button-primary-hover: #45cba0;',
      '}',
    ].join('\n')
    const warnings = audit(css).warnings
    expect(warnings.some((w) => w.includes('label-primary-foreground'))).toBe(true)
    expect(warnings.some((w) => w.includes('contrast'))).toBe(true)
  })

  it('warns when a brand anchor exists without an invert pair', () => {
    const css = ':root { --dsw-alias-brand-primary: #2fbf8f; }'
    const warnings = audit(css).warnings
    // fill and hover are satisfied by the brand anchor; the foreground is not.
    expect(warnings.some((w) => w.includes('label-primary-foreground'))).toBe(true)
    expect(warnings.every((w) => !w.includes('button-primary-fill" is not'))).toBe(true)
    expect(warnings.some((w) => w.includes('contrast'))).toBe(true)
  })

  it('stays silent for a deliberate shell-CTA skin (no anchors)', () => {
    const css = ':root { --dsw-alias-bg-base: #fff; }'
    expect(audit(css).warnings).toHaveLength(0)
  })

  it('accepts a skin with a complete trio split across skin.css and patches.css', () => {
    const main = ':root { --dsw-alias-button-primary-fill: #526aa8; }'
    const patches = [
      'body[data-ds-dark-theme] { --dsw-alias-button-primary-fill: #9bb0e1; }',
      ':root { --dsw-alias-label-primary-foreground: #fffaf0; }',
      'body[data-ds-dark-theme] { --dsw-alias-label-primary-foreground: #15234a; }',
    ].join('\n')
    const result = auditTokenContract([
      { filename: 'skin.css', css: main },
      { filename: 'patches.css', css: patches },
    ])
    expect(result.warnings).toHaveLength(0)
  })
})

describe('auditTokenContract contrast', () => {
  it('warns on a low-contrast light fill with the shell foreground', () => {
    const css = [
      ':root {',
      '  --dsw-alias-button-primary-fill: #2fbf8f;',
      '  --dsw-alias-button-primary-hover: #45cba0;',
      '}',
    ].join('\n')
    expect(audit(css).warnings.some((w) => w.includes('2.34:1'))).toBe(true)
  })

  it('resolves var() references through the static palette', () => {
    const css = [
      ':root {',
      '  --dsw-alias-button-primary-fill: var(--dsw-static-blue-500);',
      '  --dsw-alias-button-primary-hover: var(--dsw-static-blue-450);',
      '  --dsw-alias-label-primary-foreground: var(--dsw-static-neutral-bluish-950);',
      '}',
    ].join('\n')
    expect(audit(css).warnings).toHaveLength(0)
  })

  it('only ever warns, never fails', () => {
    const css = ':root { --dsw-alias-button-primary-fill: #fff; }'
    const result = audit(css)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.every((w) => typeof w === 'string')).toBe(true)
  })
})
