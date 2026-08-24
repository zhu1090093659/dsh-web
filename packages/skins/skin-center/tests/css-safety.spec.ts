/**
 * Tests for the skin CSS safety pipeline (issue #506).
 * Scoping is skin-center owned; violations fail closed.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { SkinCssSafetyError, transformSkinCss } from '../src/core/css-safety/transform.ts'

const ID = 'harbor'
const SCOPE = 'html[data-dsh-skin="harbor"]'

function scope(css: string, filename?: string) {
  return transformSkinCss(css, { skinId: ID, filename })
}

describe('transformSkinCss scoping', () => {
  it('derives fallback tints for uncovered official tokens when enabled', () => {
    const css = [
      ':root {',
      '  --dsw-alias-bg-base: #141a2e;',
      '  --dsw-alias-bg-layer-1: #181f36;',
      '  --dsw-alias-label-primary: #fff5ec;',
      '  --dsw-alias-border-l2: #ffffff1f;',
      '}',
    ].join('\n')
    const { code } = transformSkinCss(css, { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(code).toContain('--dsw-specific-input-major: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 60%, transparent);')
    expect(code).toContain('--dsw-alias-label-secondary: color-mix(in srgb, var(--dsw-alias-label-primary) 70%, transparent);')
    expect(code).toContain('--dsw-alias-border-l3: color-mix(in srgb, var(--dsw-alias-border-l2) 55%, transparent);')
  })

  it('never re-derives tokens the skin defines and never touches excluded groups', () => {
    const css = [
      ':root {',
      '  --dsw-alias-bg-layer-1: #181f36;',
      '  --dsw-specific-input-major: #101a30;',
      '}',
    ].join('\n')
    const { code } = transformSkinCss(css, { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(code).not.toContain('--dsw-specific-input-major: color-mix')
    // Semantic / structural groups stay untouched.
    expect(code).not.toContain('--dsw-alias-state-error-primary:')
    expect(code).not.toContain('--dsw-alias-button-primary-fill:')
    expect(code).not.toContain('--dsw-alias-bg-mask-1:')
  })

  it('derives nothing without a defined anchor and stays off by default', () => {
    const noAnchor = transformSkinCss('.x { color: red; }', { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(noAnchor.code).not.toContain('color-mix')
    const off = transformSkinCss(':root { --dsw-alias-bg-base: #141a2e; }', { skinId: ID, filename: 'skin.css' })
    expect(off.code).not.toContain('color-mix')
  })

  it('clones :root custom properties onto the body scope (official body-level light tokens)', () => {
    const css = [
      ':root {',
      '  color: #123;',
      '  background-color: #eef;',
      '  --dsw-alias-bg-base: #ffffff29;',
      '  --dsw-alias-bg-layer-1: #f3f8ff2e;',
      '}',
    ].join('\n')
    const { code } = scope(css)
    expect(code).toContain(`${SCOPE} {`)
    // Only custom properties are cloned; colors stay html-scoped.
    expect(code).toContain(`${SCOPE} body {`)
    expect(code).toContain('--dsw-alias-bg-base: #ffffff29;')
    expect(code).toContain('--dsw-alias-bg-layer-1: #f3f8ff2e;')
    const bodyClone = code.slice(code.indexOf(`${SCOPE} body {`))
    expect(bodyClone).not.toContain('color: #123')
    // Backgrounds are cloned (the official opaque body background would
    // otherwise hide the skin's html-level base background).
    expect(bodyClone).toContain('background-color: #eef')
  })

  it('resets root-level Shiki aliases while preserving body theme variants (#646)', () => {
    const css = [
      ':root {',
      '  --dsw-alias-markdown-code-block: #ecf4fce6;',
      '  --dsw-specific-input-major: #f0f7fdf0;',
      '  --dsh-skin-grid-line: #123456;',
      '}',
      'body[data-ds-dark-theme] {',
      '  --dsw-alias-markdown-code-block: #17243ad9;',
      '}',
    ].join('\n')
    const token = '--dsw-alias-markdown-code-block'
    const { code } = scope(css)
    const rootValue = code.indexOf(`${token}: #ecf4fce6;`)
    const rootReset = code.indexOf(`${token}: initial;`)
    const bodyCloneStart = code.indexOf(`${SCOPE} body {`, rootReset)
    const bodyClone = code.slice(bodyCloneStart, code.indexOf('}', bodyCloneStart) + 1)
    expect(rootValue).toBeGreaterThanOrEqual(0)
    expect(rootReset).toBeGreaterThan(rootValue)
    expect(bodyCloneStart).toBeGreaterThan(rootReset)
    expect(bodyClone).toContain(`${token}: #ecf4fce6;`)
    expect(code).toContain('--dsw-specific-input-major: initial;')
    expect(code).not.toContain('--dsh-skin-grid-line: initial')
    expect(code).toContain(`${SCOPE} body[data-ds-dark-theme]`)
    expect(code).toContain('--dsw-alias-markdown-code-block: #17243ad9;')
  })

  it('keeps whale mom markdown code aliases body-scoped (#646)', () => {
    const css = readFileSync(new URL('../skins/whale-mom/skin.css', import.meta.url), 'utf8')
    const whaleScope = 'html[data-dsh-skin="whale-mom"]'
    const token = '--dsw-alias-markdown-code-block'
    const { code } = transformSkinCss(css, { skinId: 'whale-mom', filename: 'skin.css' })
    const rootReset = code.indexOf(`${token}: initial;`)
    const bodyCloneStart = code.indexOf(`${whaleScope} body {`, rootReset)
    const bodyClone = code.slice(bodyCloneStart, code.indexOf('}', bodyCloneStart) + 1)
    expect(css).toContain(token)
    expect(rootReset).toBeGreaterThanOrEqual(0)
    expect(bodyCloneStart).toBeGreaterThan(rootReset)
    expect(bodyClone).toContain(`${token}:`)
  })

  it('normalizes commented important html tokens for body themes (#646)', () => {
    const token = '--dsw-alias-markdown-code-block'
    const css = [
      `html { /* light palette */ ${token}: #ecf4fce6 !important; }`,
      `body[data-ds-dark-theme] { ${token}: #17243ad9; }`,
    ].join('\n')
    const { code } = scope(css)
    const rootReset = code.indexOf(`${token}: initial !important;`)
    const bodyCloneStart = code.indexOf(`${SCOPE} body {`, rootReset)
    const bodyClone = code.slice(bodyCloneStart, code.indexOf('}', bodyCloneStart) + 1)
    expect(rootReset).toBeGreaterThanOrEqual(0)
    expect(bodyCloneStart).toBeGreaterThan(rootReset)
    expect(bodyClone).toContain(`${token}: #ecf4fce6;`)
    expect(bodyClone).not.toContain(`${token}: #ecf4fce6 !important;`)
    expect(code).toContain(`${token}: #17243ad9;`)
  })

  it('clones custom properties from comma-listed :root heads and skips body-scoped rules', () => {    const css = [
      ':root, body[data-ds-dark-theme] {',
      '  --dsw-alias-bg-base: #141a2eb3;',
      '}',
      'body[data-ds-dark-theme] {',
      '  --dsw-alias-bg-layer-1: #181f36b3;',
      '}',
    ].join('\n')
    const { code } = scope(css)
    expect(code).toContain(`${SCOPE} body {`)
    expect(code).toContain('--dsw-alias-bg-base: #141a2eb3;')
    // The dark-only rule keeps its declaration but is not re-cloned
    // (it already lives on a body scope): exactly one occurrence.
    expect(code.split('--dsw-alias-bg-layer-1: #181f36b3;').length).toBe(2)
  })

  it('neutralizes the official opaque #root background for every skin', () => {
    const { code } = scope('.a { color: red; }')
    expect(code).toContain(`${SCOPE} [id="root"] { background: transparent; }`)
  })

  it('re-binds --shiki-background to the code-block alias on body (issue #826)', () => {
    const css = [
      ':root {',
      '  --dsw-alias-markdown-code-block: #ecf4fce6;',
      '}',
      'body[data-ds-dark-theme] {',
      '  --dsw-alias-markdown-code-block: #17243ad9;',
      '}',
    ].join('\n')
    const { code } = scope(css)
    expect(code).toContain(`${SCOPE} body { --shiki-background: var(--dsw-alias-markdown-code-block); }`)
    // The dark alias itself stays body-scoped so the re-bound variable
    // resolves the dark value in dark mode and the light value in light mode.
    expect(code).toContain(`${SCOPE} body[data-ds-dark-theme]`)
  })

  it('scopes :root token remaps to the skin scope', () => {
    const { code } = scope(':root { --dsw-primary: #ff9d5c; }')
    expect(code).toContain(`${SCOPE} {`)
    expect(code).toContain('--dsw-primary: #ff9d5c')
    expect(code).not.toContain(':root')
  })

  it('scopes plain selectors as descendants', () => {
    const { code } = scope('.panel > .item:hover { color: red; }')
    expect(code).toContain(`${SCOPE} .panel > .item:hover`)
  })

  it('merges into html-typed heads instead of nesting them', () => {
    const { code } = scope('html body .app { margin: 0; }')
    expect(code).toContain(`${SCOPE} body .app`)
    expect(code).not.toContain('html html')
  })

  it('anchors dark-theme combos on body under the scope (official attr lives on body)', () => {
    const { code } = scope('html[data-ds-dark-theme] .panel { background: #000; }')
    expect(code).toContain('html[data-dsh-skin="harbor"] body[data-ds-dark-theme] .panel')
  })

  it('anchors bare [data-ds-*] heads on body too', () => {
    const { code } = scope('[data-ds-dark-theme] .panel { background: #000; }')
    expect(code).toContain('html[data-dsh-skin="harbor"] body[data-ds-dark-theme] .panel')
  })

  it('handles var() declarations (upstream visitor crash regression)', () => {
    const { code } = scope('body { color: var(--dsw-alias-label-primary); }')
    expect(code).toContain('var(--dsw-alias-label-primary)')
    expect(code).toContain('html[data-dsh-skin="harbor"] body')
  })

  it('keeps author formatting and values byte-for-byte outside selector heads', () => {
    const { code } = scope('.a { background: #112233; }')
    expect(code).toContain('#112233')
  })

  it('scopes selectors inside @media', () => {
    const { code } = scope('@media (max-width: 600px) { .sidebar { display: none; } }')
    expect(code).toContain('@media')
    expect(code).toContain(`${SCOPE} .sidebar`)
  })

  it('keeps @keyframes unscoped', () => {
    const { code } = scope('@keyframes harbor-drift { from { opacity: 0; } to { opacity: 1; } }')
    expect(code).toContain('@keyframes harbor-drift')
    // The scope string appears only in the appended #root neutralization
    // rule; the keyframes name itself must never be rewritten.
    expect(code).not.toContain(`${SCOPE} @keyframes`)
  })

  it('scopes every selector in a list', () => {
    const { code } = scope('.a, .b { color: red; }')
    expect(code).toContain(`${SCOPE} .a`)
    expect(code).toContain(`${SCOPE} .b`)
  })

  it('scopes two skins independently (no cross-contamination)', () => {
    const a = scope('.x { color: red; }')
    const b = transformSkinCss('.x { color: blue; }', { skinId: 'matrix' })
    expect(a.code).toContain('data-dsh-skin="harbor"')
    expect(b.code).toContain('data-dsh-skin="matrix"')
    expect(a.code).not.toContain('matrix')
  })
})

describe('transformSkinCss whitelist (fail-closed)', () => {
  it('rejects @import', () => {
    expect(() => scope('@import "https://evil.example/x.css"; .a { color: red; }'))
      .toThrow(SkinCssSafetyError)
  })

  it('rejects remote URLs', () => {
    expect(() => scope('.a { background: url("https://evil.example/bg.png"); }'))
      .toThrow(/remote URL/)
    expect(() => scope('.a { background: url(http://evil.example/bg.png); }'))
      .toThrow(SkinCssSafetyError)
  })

  it('rejects protocol-relative URLs', () => {
    expect(() => scope('.a { background: url(//evil.example/bg.png); }'))
      .toThrow(/protocol-relative/)
  })

  it('rejects absolute and parent-escaping paths', () => {
    expect(() => scope('.a { background: url(/etc/passwd); }')).toThrow(/escapes/)
    expect(() => scope('.a { background: url(../secret.png); }')).toThrow(/escapes/)
  })

  it('accepts relative in-directory assets', () => {
    const { code } = scope('.a { background: url(assets/bg-dark.jpg); }')
    expect(code).toContain('assets/bg-dark.jpg')
  })

  it('collects every violation in one error', () => {
    try {
      scope('.a { background: url(https://a.example/x.png); } .b { background: url(/abs.png); }')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SkinCssSafetyError)
      expect((error as SkinCssSafetyError).violations).toHaveLength(2)
    }
  })
})

describe('transformSkinCss warnings', () => {
  it('warns on data: URLs but allows them', () => {
    const { warnings } = scope('.a { background: url(data:image/png;base64,AAAA); }')
    expect(warnings.some((w) => w.includes('data:'))).toBe(true)
  })

  it('warns on CSS-Modules hash-class reliance', () => {
    const { warnings } = scope('[class*="sidebar_item"] { color: red; }')
    expect(warnings.some((w) => w.includes('hash class'))).toBe(true)
  })

  it('warns on generic @keyframes names', () => {
    const { warnings } = scope('@keyframes spin { to { transform: rotate(360deg); } }')
    expect(warnings.some((w) => w.includes('spin'))).toBe(true)
  })
})

describe('primary-action derivation (issue #506 follow-up)', () => {
  const legacy = [
    ':root {',
    '  --dsw-alias-brand-primary: #4a5fa8;',
    '  --dsw-alias-brand-primary-invert: #fff;',
    '}',
  ].join('\n')
  it('completes the set for the legacy matched pair (brand + invert)', () => {
    const { code } = transformSkinCss(legacy, { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(code).toContain('--dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);')
    expect(code).toContain('--dsw-alias-button-primary-hover: color-mix(in srgb, var(--dsw-alias-button-primary-fill) 82%, var(--dsw-alias-bg-layer-1));')
    expect(code).toContain('--dsw-alias-button-primary-dimmed: color-mix(in srgb, var(--dsw-alias-button-primary-fill) 60%, var(--dsw-alias-bg-layer-1));')
    expect(code).toContain('--dsw-alias-label-primary-foreground: var(--dsw-alias-brand-primary-invert);')
  })
  it('derives hover and dimmed from an explicit fill but keeps the shell foreground', () => {
    const css = ':root { --dsw-alias-button-primary-fill: #2fbf8f; }'
    const { code } = transformSkinCss(css, { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(code).toContain('--dsw-alias-button-primary-hover: color-mix')
    expect(code).toContain('--dsw-alias-button-primary-dimmed: color-mix')
    expect(code).not.toContain('--dsw-alias-label-primary-foreground:')
    expect(code).not.toContain('--dsw-alias-button-primary-fill: var(--dsw-alias-brand-primary);')
  })
  it('never overrides a complete set and never derives without an anchor', () => {
    const complete = [
      ':root {',
      '  --dsw-alias-button-primary-fill: #e95c91;',
      '  --dsw-alias-button-primary-hover: #d64b80;',
      '  --dsw-alias-label-primary-foreground: #fff;',
      '}',
    ].join('\n')
    const done = transformSkinCss(complete, { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(done.code).not.toContain('--dsw-alias-button-primary-hover: color-mix')
    const none = transformSkinCss('.a { color: red; }', { skinId: ID, filename: 'skin.css', deriveFallbacks: true })
    expect(none.code).not.toContain('--dsw-alias-button-primary-')
  })
})
