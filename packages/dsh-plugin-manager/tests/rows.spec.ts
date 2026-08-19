import { describe, expect, it } from 'vitest'
import { bareRowEnabled, bareRowId, claimedIdsOf, parsePatch, setRowEnabled } from '../src/host/rows.ts'

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

  it('edits the inner row of insert-format managed rows in place', () => {
    const next = setRowEnabled(SAMPLE, 'p', 'genui', 'genui', false)
    expect(next).toContain('id: genui, name: "@omdsh-dev/dsh-genui", disabled: true')
    const { root } = parsePatch(next, 'p')
    expect(root.items).toHaveLength(4)
    // No duplicate bare row is appended.
    expect(root.items.filter(item => typeof item === 'object' && item !== null && 'get' in (item as object) && (item as { get: (k: string, d?: unknown) => unknown }).get('id', true) === 'genui' && !('insert' in (item as object)))).toHaveLength(0)
  })
})
