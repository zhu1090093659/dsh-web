import { describe, expect, it } from 'vitest'
import { bareRowEnabled, bareRowId, claimedIdsOf, parsePatch, rowDefaultEnabledOf, setRowEnabled } from '../src/host/rows.ts'

const SAMPLE = `[
  # a top-level comment that must survive every edit
  { id: keep-me, name: keep-me, config: { x: 1 } },
  # managed product row (insert format)
  { insert: [ { id: genui, name: "@omdsh-dev/dsh-genui", disabled: false } ] },
  { id: llm-codex-auth, name: dsh-codex-auth, config: { codexCommand: /opt/homebrew/bin/codex } },
  { id: expr-row, name: expr, config: { port: !!js process.env.PORT } },
]
`

describe('parsePatch', () => {
  it('parses a valid top-level array and tolerates !!js expressions', () => {
    const { root } = parsePatch(SAMPLE, 'cordis.patch.yml')
    expect(root.items).toHaveLength(4)
  })

  it('fails loud on invalid YAML', () => {
    expect(() => parsePatch('{ broken', 'cordis.patch.yml')).toThrow(/cannot parse/)
  })

  it('fails loud on a non-array root', () => {
    expect(() => parsePatch('key: value\n', 'cordis.patch.yml')).toThrow(/top-level YAML array/)
  })
})

describe('bare row enablement', () => {
  it('reads ids from bare rows only', () => {
    const { root } = parsePatch(SAMPLE, 'cordis.patch.yml')
    const ids = root.items.map(bareRowId)
    expect(ids).toEqual(['keep-me', undefined, 'llm-codex-auth', 'expr-row'])
  })

  it('is enabled unless disabled: true', () => {
    const { root } = parsePatch('[{ id: a }, { id: b, disabled: true }, { id: c, disabled: false }]', 'p')
    const rows = root.items
    expect(bareRowEnabled(rows[0])).toBe(true)
    expect(bareRowEnabled(rows[1])).toBe(false)
    expect(bareRowEnabled(rows[2])).toBe(true)
  })
})

describe('claimedIdsOf', () => {
  it('extracts insert ids from a bundle patch', () => {
    expect(claimedIdsOf('- insert:\n    - id: ui-plugin-manager\n      name: "@linxin666/dsh-client-ui-plugin-manager"\n')).toEqual(['ui-plugin-manager'])
  })

  it('returns empty for empty or malformed patches', () => {
    expect(claimedIdsOf('[]')).toEqual([])
    expect(claimedIdsOf('')).toEqual([])
    expect(claimedIdsOf('{ broken')).toEqual([])
  })
})

const AGGREGATE = [
  '- insert:',
  '    - id: web-ui-skin-center',
  "      name: '@linxin666/dsh-web-all/skin-center'",
  '- insert:',
  '    - id: web-ui-i18n',
  "      name: '@linxin666/dsh-i18n'",
  '# inactive by default (opt-in rows)',
  '- id: web-ui-ssh',
  '  disabled: true',
  '- id: web-ui-doctor',
  '  disabled: true',
  '',
].join('\n')

describe('rowDefaultEnabledOf', () => {
  it('reads the bundle inactive-by-default rows and leaves undeclared ids absent', () => {
    const defaults = rowDefaultEnabledOf(AGGREGATE)
    expect(defaults.get('web-ui-ssh')).toBe(false)
    expect(defaults.get('web-ui-doctor')).toBe(false)
    // A row the bundle never mentions carries no opinion, not "enabled".
    expect(defaults.has('web-ui-skin-center')).toBe(false)
  })

  it('reads an insert entry own disabled flag', () => {
    const defaults = rowDefaultEnabledOf('- insert:\n    - id: x\n      name: x\n      disabled: true\n')
    expect(defaults.get('x')).toBe(false)
  })

  it('applies later bare rows last-wins', () => {
    const defaults = rowDefaultEnabledOf('- id: x\n  disabled: true\n- id: x\n  disabled: false\n')
    expect(defaults.get('x')).toBe(true)
  })

  it('returns an empty map for empty and malformed patches', () => {
    expect(rowDefaultEnabledOf('[]').size).toBe(0)
    expect(rowDefaultEnabledOf('').size).toBe(0)
    expect(rowDefaultEnabledOf('{ broken').size).toBe(0)
  })
})

describe('setRowEnabled', () => {
  it('creates a bare disabled row and preserves comments and other rows', () => {
    const next = setRowEnabled(SAMPLE, 'cordis.patch.yml', 'ui-plugin-manager', 'ui-plugin-manager', false)
    expect(next).toContain('# a top-level comment that must survive every edit')
    expect(next).toContain('id: keep-me')
    expect(next).toContain('!!js process.env.PORT')
    expect(next).toContain('disabled: true')
    expect(next).toContain('id: ui-plugin-manager')
    const { root } = parsePatch(next, 'cordis.patch.yml')
    expect(root.items).toHaveLength(5)
  })

  it('updates an existing bare row in place instead of appending', () => {
    const once = setRowEnabled(SAMPLE, 'p', 'llm-codex-auth', 'llm-codex-auth', false)
    expect(once).toContain('disabled: true')
    const { root } = parsePatch(once, 'p')
    expect(root.items).toHaveLength(4)
    expect(root.items.map(bareRowId).filter(Boolean)).toContain('llm-codex-auth')
  })

  it('removes the override row when re-enabling', () => {
    const disabled = setRowEnabled(SAMPLE, 'p', 'x', 'x', false)
    const enabled = setRowEnabled(disabled, 'p', 'x', 'x', true)
    expect(enabled).not.toContain('id: x')
    expect(enabled).toContain('id: keep-me')
  })

  it('returns the original text when enabling an absent row', () => {
    expect(setRowEnabled(SAMPLE, 'p', 'absent', 'absent', true)).toBe(SAMPLE)
  })

  it('writes an explicit disabled: false override for a bundle-disabled row', () => {
    // Removing the user row is only equivalent to enabling when no lower layer
    // disables the id; a bundle that ships it disabled needs the explicit flag.
    const next = setRowEnabled(SAMPLE, 'p', 'web-ui-ssh', '@linxin666/dsh-web-all/ssh', true, false)
    expect(next).not.toBe(SAMPLE)
    const { root } = parsePatch(next, 'p')
    const appended = root.items.find(item => bareRowId(item) === 'web-ui-ssh')
    expect(appended).toBeDefined()
    expect(bareRowEnabled(appended)).toBe(true)
  })

  it('flips an existing user disable to disabled: false when the bundle disables the row', () => {
    const disabled = setRowEnabled(SAMPLE, 'p', 'web-ui-ssh', 'web-ui-ssh', false)
    const enabled = setRowEnabled(disabled, 'p', 'web-ui-ssh', 'web-ui-ssh', true, false)
    const { root } = parsePatch(enabled, 'p')
    const rows = root.items.filter(item => bareRowId(item) === 'web-ui-ssh')
    expect(rows).toHaveLength(1)
    expect(bareRowEnabled(rows[0])).toBe(true)
  })

  it('edits the inner row of insert-format managed rows in place', () => {
    const next = setRowEnabled(SAMPLE, 'p', 'genui', 'genui', false)
    expect(next).toContain('id: genui, name: "@omdsh-dev/dsh-genui", disabled: true')
    const { root } = parsePatch(next, 'p')
    expect(root.items).toHaveLength(4)
    // No duplicate bare row is appended.
    expect(root.items.filter(item => typeof item === 'object' && item !== null && 'get' in (item as object) && (item as { get: (k: string, d?: unknown) => unknown }).get('id', true) === 'genui' && !('insert' in (item as object)))).toHaveLength(0)
  })

  it('falls back to matching by name when the row id is customized', () => {
    const customSample = `[
      { id: web-ui-dsh-perf, name: "@linxin666/dsh-perf", disabled: false },
    ]\n`
    // Disable using the package id 'dsh-perf' (different from row id 'web-ui-dsh-perf')
    const disabled = setRowEnabled(customSample, 'p', 'dsh-perf', '@linxin666/dsh-perf', false)
    expect(disabled).toContain('id: web-ui-dsh-perf')
    expect(disabled).toContain('disabled: true')
    expect(disabled).not.toContain('id: dsh-perf')
    const { root: disabledRoot } = parsePatch(disabled, 'p')
    expect(disabledRoot.items).toHaveLength(1)

    // Re-enable: should flip to disabled: false rather than deleting the mounted row
    const reEnabled = setRowEnabled(disabled, 'p', 'dsh-perf', '@linxin666/dsh-perf', true)
    expect(reEnabled).toContain('id: web-ui-dsh-perf')
    expect(reEnabled).toContain('disabled: false')
    const { root: reEnabledRoot } = parsePatch(reEnabled, 'p')
    expect(reEnabledRoot.items).toHaveLength(1)
  })

  it('keeps conservative append behavior when name matches multiple rows ambiguously', () => {
    const ambiguousSample = `[
      { id: row-a, name: "@linxin666/dup" },
      { id: row-b, name: "@linxin666/dup" },
    ]\n`
    const disabled = setRowEnabled(ambiguousSample, 'p', 'dup', '@linxin666/dup', false)
    const { root } = parsePatch(disabled, 'p')
    expect(root.items).toHaveLength(3)
    expect(disabled).toContain('id: dup')
  })
})

