import { describe, expect, it } from 'vitest'
import { bareRowEnabled, bareRowId, claimedIdsOf, declaredRowIds, overrideRowId, parsePatch, pruneOrphanRowOverrides, repairStaleRowNames, rowDefaultEnabledOf, setRowEnabled } from '../src/host/rows.ts'

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
  '- id: web-ui-liangshen',
  '  disabled: true',
  '',
].join('\n')

describe('rowDefaultEnabledOf', () => {
  it('reads the bundle inactive-by-default rows and leaves undeclared ids absent', () => {
    const defaults = rowDefaultEnabledOf(AGGREGATE)
    expect(defaults.get('web-ui-ssh')).toBe(false)
    expect(defaults.get('web-ui-liangshen')).toBe(false)
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

/**
 * A user layer as 0.4.6 wrote it: an override the plugin manager owns for a
 * row the aggregate has since retired, an override for a row that still
 * exists, an override on a row the target composition also carries, and a
 * config row carrying keys this manager never writes.
 */
const PROFILE_LAYER = [
  '# user overrides written by the plugin manager',
  '- id: web-ui-model-capabilities',
  '  name: "@linxin666/dsh-model-capabilities"',
  '  disabled: true',
  '- id: web-ui-pet',
  '  name: "@linxin666/dsh-pet"',
  '  disabled: false',
  '- id: web-ui-skin-center',
  '  name: "@linxin666/dsh-web-all/skin-center"',
  '  config:',
  '    theme: blue-fantasy',
  '',
].join('\n')

const COMPOSED = new Set(['web-ui-pet', 'web-ui-skin-center'])

describe('pruneOrphanRowOverrides', () => {
  it('operator: drops the override of a retired row and keeps every other line', () => {
    // Given a profile layer carrying an override for a row the composition no
    // longer declares, beside rows that still exist and a config row
    // When the orphan pruning runs against the composed entry ids
    const { text, pruned } = pruneOrphanRowOverrides(PROFILE_LAYER, 'cordis.patch.yml', COMPOSED)

    // Then only the retired override is gone and the rest is byte-identical
    expect(pruned).toEqual(['web-ui-model-capabilities'])
    expect(text).toBe([
      '# user overrides written by the plugin manager',
      '- id: web-ui-pet',
      '  name: "@linxin666/dsh-pet"',
      '  disabled: false',
      '- id: web-ui-skin-center',
      '  name: "@linxin666/dsh-web-all/skin-center"',
      '  config:',
      '    theme: blue-fantasy',
      '',
    ].join('\n'))
  })

  it('operator: reports nothing and changes nothing on an already pruned layer', () => {
    // Given a layer that already went through pruning
    const first = pruneOrphanRowOverrides(PROFILE_LAYER, 'p', COMPOSED)
    // When the same pruning runs again
    const second = pruneOrphanRowOverrides(first.text, 'p', COMPOSED)

    // Then it returns the input text untouched, so the caller writes nothing
    expect(second.pruned).toEqual([])
    expect(second.text).toBe(first.text)
  })

  it('operator: leaves every override alone when the whole composition still carries them', () => {
    // Given overrides whose row ids the composition all still declares
    const text = '- id: web-ui-pet\n  name: "@linxin666/dsh-pet"\n  disabled: true\n'
    // When the orphan pruning runs
    const result = pruneOrphanRowOverrides(text, 'p', new Set(['web-ui-pet']))

    // Then nothing is pruned and the caller is handed its own text back
    expect(result.pruned).toEqual([])
    expect(result.text).toBe(text)
  })

  it('operator: never removes a row the manager does not own', () => {
    // Given a config row and an insert wrapper whose ids the composition lost
    const text = [
      '- id: retiring-config-row',
      '  config:',
      '    port: 3082',
      '- insert:',
      '    - id: retiring-insert-row',
      '      name: retiring-package',
      '- id: retired-override',
      '  disabled: true',
      '',
    ].join('\n')
    // When the orphan pruning runs with an empty composed set
    const { text: next, pruned } = pruneOrphanRowOverrides(text, 'p', new Set())

    // Then only the bare override row this manager writes is removed
    expect(pruned).toEqual(['retired-override'])
    expect(next).toContain('id: retiring-config-row')
    expect(next).toContain('id: retiring-insert-row')
    expect(next).not.toContain('retired-override')
  })

  it('operator: recognizes an override row only in the shape this manager writes', () => {
    // Given rows with a boolean disabled flag, a missing flag, and an extra key
    const owned = parsePatch('- id: a\n  name: pkg\n  disabled: true\n', 'p').root.items[0]
    const noFlag = parsePatch('- id: b\n  name: pkg\n', 'p').root.items[0]
    const extraKey = parsePatch('- id: c\n  disabled: true\n  config:\n    x: 1\n', 'p').root.items[0]
    const insertWrapper = parsePatch('- insert:\n    - id: d\n      disabled: true\n', 'p').root.items[0]

    // When each item is classified
    // Then only the override shape is claimed by this manager
    expect(overrideRowId(owned)).toBe('a')
    expect(overrideRowId(noFlag)).toBeUndefined()
    expect(overrideRowId(extraKey)).toBeUndefined()
    expect(overrideRowId(insertWrapper)).toBeUndefined()
  })
})

describe('repairStaleRowNames', () => {
  it('operator: points a row at the package that now carries its entry id', () => {
    // Given a profile layer whose row still names the package the aggregate
    // mounted for that id before issue #1901
    const text = [
      '- id: web-ui-task-board-github',
      '  name: "@linxin666/dsh-web-all/task-board-github"',
      '  config:',
      '    repositories: []',
      '',
    ].join('\n')

    // When the repair runs against the live name of that id
    const live = new Map([['web-ui-task-board-github', '@linxin666/dsh-client-ui-task-board-github']])
    const { text: next, repaired } = repairStaleRowNames(text, 'p', live)

    // Then the row names the live package and keeps its configuration
    expect(repaired).toEqual([{
      id: 'web-ui-task-board-github',
      from: '@linxin666/dsh-web-all/task-board-github',
      to: '@linxin666/dsh-client-ui-task-board-github',
    }])
    expect(next).toContain('name: "@linxin666/dsh-client-ui-task-board-github"')
    expect(next).toContain('repositories: []')
  })

  it('operator: repairs an enablement override whose name went stale too', () => {
    // Given an override row that still names the retired package
    const text = [
      '- id: web-ui-ssh',
      '  name: "@linxin666/dsh-web-all/ssh"',
      '  disabled: true',
      '',
    ].join('\n')

    // When the repair runs against the live name of that id
    const live = new Map([['web-ui-ssh', '@linxin666/dsh-ssh']])
    const { text: next, repaired } = repairStaleRowNames(text, 'p', live)

    // Then the override keeps disabling the row and names the live package
    expect(repaired).toEqual([{ id: 'web-ui-ssh', from: '@linxin666/dsh-web-all/ssh', to: '@linxin666/dsh-ssh' }])
    expect(next).toContain('name: "@linxin666/dsh-ssh"')
    expect(next).toContain('disabled: true')
  })

  it('operator: leaves a row no live bundle claims alone', () => {
    // Given a row whose id no installed bundle claims
    const text = [
      '- id: some-other-row',
      '  name: "@example/whatever"',
      '  config:',
      '    x: 1',
      '',
    ].join('\n')

    // When the repair runs with a live map that does not carry that id
    const { text: next, repaired } = repairStaleRowNames(text, 'p', new Map([['web-ui-pet', '@linxin666/dsh-pet']]))

    // Then nothing is rewritten and the caller is handed its own text back
    expect(repaired).toEqual([])
    expect(next).toBe(text)
  })

  it('operator: changes nothing on a layer whose rows already name the live packages', () => {
    // Given a layer whose rows already name the live packages
    const text = [
      '- id: web-ui-pet',
      '  name: "@linxin666/dsh-pet"',
      '  disabled: true',
      '- id: web-ui-ssh',
      '  name: "@linxin666/dsh-ssh"',
      '  disabled: true',
      '',
    ].join('\n')

    // When the repair runs against the live names
    const live = new Map([['web-ui-pet', '@linxin666/dsh-pet'], ['web-ui-ssh', '@linxin666/dsh-ssh']])
    const { text: next, repaired } = repairStaleRowNames(text, 'p', live)

    // Then the file is not rewritten at all
    expect(repaired).toEqual([])
    expect(next).toBe(text)
  })

  it('operator: leaves a row without a name alone', () => {
    // Given a nameless row, which the loader applies to its id whatever the
    // package is called
    const text = [
      '- id: web-ui-pet',
      '  disabled: true',
      '',
    ].join('\n')

    // When the repair runs
    const { text: next, repaired } = repairStaleRowNames(text, 'p', new Map([['web-ui-pet', '@linxin666/dsh-pet']]))

    // Then nothing is rewritten
    expect(repaired).toEqual([])
    expect(next).toBe(text)
  })
})

describe('declaredRowIds', () => {
  it('operator: reports every id a layer declares, rows and insert entries alike', () => {
    // Given a bundle layer carrying an insert list, a config row of its own and
    // the same id twice
    const layer = [
      '- insert:',
      '    - id: web-ui-remote-web-ui',
      "      name: '@linxin666/dsh-web-all/remote-web-ui'",
      '    - id: ui-schedule',
      "      name: '@deepseek-ai/dsh-client-ui-schedule'",
      '- id: web-ui-pet',
      "  name: '@linxin666/dsh-pet'",
      '  config:',
      '    size: 160',
      '    children:',
      '      - id: nested-child',
      '- id: ui-schedule',
      '  disabled: false',
      '',
    ].join('\n')

    // When the layer's declarations are read
    const ids = declaredRowIds(layer, 'cordis.patch.yml')

    // Then every layer entry is declared once, in file order, and an id nested
    // inside a plain (non-group) row's config stays a child, not a layer entry
    expect(ids).toEqual(['web-ui-remote-web-ui', 'ui-schedule', 'web-ui-pet'])
  })

  it('operator: declares the entries nested under a group entry config recursively', () => {
    // Given a bundle layer whose insert carries a group entry whose config
    // holds child entries (one of them a nested group), and a plain row whose
    // config carries an id-shaped data item that is not an entry (issue #2091)
    const layer = [
      '- insert:',
      '    - id: mnemon-bundle',
      '      name: mnemon-bundle',
      '      group: true',
      '      config:',
      '        - id: mnemon-strategy-auto-capture',
      "          name: '@dsh/mnemon-strategy-auto-capture'",
      '        - id: mnemon-inner-group',
      '          name: cordis:group',
      '          group: true',
      '          config:',
      '            - id: mnemon-deep-child',
      "              name: '@dsh/deep'",
      '- id: plain-row',
      '  name: plain',
      '  config:',
      '    children:',
      '      - id: data-not-entry',
      '',
    ].join('\n')

    // When the layer's declarations are read
    const ids = declaredRowIds(layer, 'cordis.patch.yml')

    // Then every group child id is declared, deepest included, and the id
    // inside a plain row's config data is not
    expect(ids).toEqual(['mnemon-bundle', 'mnemon-strategy-auto-capture', 'mnemon-inner-group', 'mnemon-deep-child', 'plain-row'])
    expect(ids).not.toContain('data-not-entry')
  })

  it('operator: fails loud on a layer it cannot parse so the caller prunes nothing', () => {
    // Given a layer that is not a patch list
    const broken = '- id: [unclosed\n'

    // When its declarations are read
    // Then the read fails instead of reporting an empty layer
    expect(() => declaredRowIds(broken, 'cordis.patch.yml')).toThrow()
  })
})
