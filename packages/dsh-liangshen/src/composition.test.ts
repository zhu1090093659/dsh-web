/**
 * The composition reader the preset declaration is built from. It is the only
 * thing standing between the shipped `agent.cordis.yml` and the registry, and
 * it must not guess: these tests fence the supported subset against the real
 * file, the settings overlay, and every construct it refuses.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { describe, expect, it } from 'vitest'

import {
  CompositionError,
  applyPresetOverrides,
  readCompositionRows,
  readPresetDefinition,
  readPresetMetadata,
  type CompositionRow,
} from './composition.ts'

const presetDir = join(process.cwd(), 'presets', 'liangshen')
const shipped = readFileSync(join(presetDir, 'agent.cordis.yml'), 'utf8')

/** The shipped composition parsed for the preset's own directory. */
function rows(): PresetDefinition['plugins'] {
  return readCompositionRows(shipped, presetDir)
}

/** The rows of one parsed list as the loose records these tests read. */
function loose(list: PresetDefinition['plugins']): readonly CompositionRow[] {
  return list as readonly CompositionRow[]
}

/** One row of a parsed list, by id. */
function rowOf(list: PresetDefinition['plugins'], id: string): CompositionRow {
  const found = loose(list).find(row => row.id === id)
  if (found === undefined) throw new Error(`the composition carries no row ${id}`)
  return found
}

/** One row's configuration, asserted to be the map the plugins mount with. */
function configOf(row: CompositionRow): Record<string, unknown> {
  expect(typeof row.config).toBe('object')
  return row.config as Record<string, unknown>
}

describe('readCompositionRows', () => {
  it('operator reads every row of the shipped composition once', () => {
    // Given the shipped composition, When the operator reads it for the preset
    // directory, Then every row arrives with a unique id and a module name.
    const parsed = rows()
    const ids = loose(parsed).map(row => row.id)
    expect(ids.length).toBeGreaterThan(20)
    expect(new Set(ids).size).toBe(ids.length)
    for (const row of parsed) expect(typeof row.name).toBe('string')
  })

  it('operator resolves relative module names against the preset directory', () => {
    // Given a declaration mounted under the registry's own loader base, When
    // the operator reads a relative row name, Then it is an absolute file URL
    // beside the composition, while a bare package name stays a specifier.
    expect(rowOf(rows(), 'minimal-prompt').name).toBe(pathToFileURL(join(presetDir, 'minimal-prompt.mjs')).href)
    expect(rowOf(rows(), 'tool-catalog').name).toBe(pathToFileURL(join(presetDir, 'tool-catalog.mjs')).href)
    expect(rowOf(rows(), 'persona').name).toBe('@deepseek-ai/dsh-persona')
    expect(rowOf(rows(), 'tool-bash').name).toBe('@deepseek-ai/dsh-tool-bash')
  })

  it('operator keeps the row configuration the plugins mount with', () => {
    // Given the tool-catalog row, When the operator reads its config, Then the
    // shipped scalars and the single-line flow sequence survive.
    const catalog = configOf(rowOf(rows(), 'tool-catalog'))
    expect(catalog['presentation']).toBe('both')
    expect(catalog['descriptionMaxLength']).toBe(200)
    expect(catalog['maxResidentTokens']).toBe(8000)
    expect(catalog['pagedToolPatterns']).toEqual(['mcp__*'])
  })

  it('operator keeps a literal block scalar verbatim', () => {
    // Given the persona row's `prefix: |-` scalar, When the operator reads it,
    // Then the prose is content and the next composition row ends it.
    const persona = configOf(rowOf(rows(), 'persona'))
    const prefix = persona['prefix']
    expect(typeof prefix).toBe('string')
    expect(prefix as string).toContain('You are a helpful software engineer assistant.')
    expect(prefix as string).toContain('Thinking Disruption: Never reason through the same hypothesis more than twice')
    expect(prefix as string).not.toContain('- id: minimal-prompt')
  })

  it('operator keeps a loader expression as data instead of executing it', () => {
    // Given the platform-conditional shell rows, When the operator reads them,
    // Then each `!!js` expression arrives as data for the Loader to evaluate.
    expect(rowOf(rows(), 'tool-bash').disabled).toEqual({ __jsExpr: "process.platform === 'win32'" })
    expect(rowOf(rows(), 'tool-pwsh').disabled).toEqual({ __jsExpr: "process.platform !== 'win32'" })
  })

  it('operator reads the nested entry list of a group row', () => {
    // Given the planning and compaction group rows, When the operator reads
    // them, Then the realm keys survive and their child rows are read too.
    const planning = rowOf(rows(), 'planning')
    expect(planning.group).toBe(true)
    expect(planning.isolate).toEqual({ planMode: true })
    const nested = planning.config as readonly CompositionRow[]
    expect(Array.isArray(nested)).toBe(true)
    expect(nested.map(row => row.id)).toEqual(['plan-mode'])
    expect(rowOf(rows(), 'compaction').group).toBe(true)
    expect((rowOf(rows(), 'compaction').config as readonly CompositionRow[]).map(row => row.id))
      .toEqual(['compaction-basic', 'command-compact', 'tool-result-pruner'])
  })

  it('operator is refused a document the registry could never mount', () => {
    // Given row lists that name no plugin, When the operator reads them, Then
    // each is refused instead of producing an unmountable declaration.
    expect(() => readCompositionRows('name: nope\n', presetDir)).toThrow(CompositionError)
    expect(() => readCompositionRows('- id: a\n', presetDir)).toThrow(/names no plugin/)
    expect(() => readCompositionRows('- name: ./x.mjs\n  group: true\n  config: nope\n', presetDir)).toThrow(/must hold a list/)
    expect(() => readCompositionRows('- name: cordis:group\n  group: true\n  config:\n    - nope\n', presetDir))
      .toThrow(/not a plugin row/)
  })

  it('operator is refused YAML outside the supported subset', () => {
    // Given constructs the subset does not cover, When the operator reads them,
    // Then every one raises instead of being guessed at.
    const cases: readonly [string, RegExp][] = [
      ['- name: &a ./x.mjs\n', /unsupported YAML node/],
      ['- name: *a\n', /unsupported YAML node/],
      ['- name: !tag ./x.mjs\n', /unsupported YAML node/],
      ['- name: ./x.mjs\n  config: {a: 1}\n', /flow mappings are not supported/],
      ['- name: ./x.mjs\n  config: [[1]]\n', /nested flow collections are not supported/],
      ['- name: ./x.mjs\n  config: [1,]\n', /empty item in a flow sequence/],
      ['- name: ./x.mjs\n  config: [1\n', /unterminated flow sequence/],
      ['- name: ./x.mjs\n  config: [1] trailing\n', /unexpected content after a flow sequence/],
      ['- name: ./x.mjs\n\tconfig: 1\n', /tabs must not be used for indentation/],
      ['- name: ./x.mjs\n  config: |\n    a\n   b\n', /unexpected/],
      ['- name: "unterminated\n', /unterminated/],
      ['- name: ./x.mjs\n  config: !!js\n', /!!js requires an expression/],
      ['- name: ./x.mjs\n  config:\n    a: 1\n    a: 2\n', /duplicate key/],
      ['- name: ./x.mjs\nname: ./y.mjs\n', /unexpected indentation|unexpected content/],
      ['- name: ./x.mjs\n   stray: 1\n', /unexpected indentation|not a plugin row/],
      ['', /not a plugin row|must be a top-level list/],
    ]
    for (const [text, expected] of cases) {
      expect(() => readCompositionRows(text, presetDir), text).toThrow(expected)
    }
  })

  it('operator reads scalars the way YAML does', () => {
    // Given a config map of every scalar shape the composition uses, When the
    // operator reads it, Then each value resolves as YAML resolves it.
    const parsed = readCompositionRows([
      '- name: ./x.mjs',
      '  config:',
      '    truth: true',
      '    lie: false',
      '    empty: ~',
      '    count: 42',
      '    ratio: 0.5',
      "    quoted: 'it''s here'",
      '    double: "a\\nb"',
      '    plain: a value',
      '    hashed: a # comment',
      '    url: http://example.test/x#frag',
      '',
    ].join('\n'), presetDir)
    expect(configOf(loose(parsed)[0]!)).toEqual({
      truth: true,
      lie: false,
      empty: null,
      count: 42,
      ratio: 0.5,
      quoted: "it's here",
      double: 'a\nb',
      plain: 'a value',
      hashed: 'a',
      url: 'http://example.test/x#frag',
    })
  })

  it('operator reads an absolute name as written and nested sequences of maps', () => {
    // Given a group row whose child rows carry a nested list and an absolute
    // module path, When the operator reads it, Then neither is rewritten.
    const parsed = readCompositionRows([
      '- id: top',
      '  name: cordis:group',
      '  group: true',
      '  config:',
      '    - id: inner',
      "      name: '@scope/pkg'",
      '      config:',
      '        list:',
      '          - one',
      '          - two',
      '    - name: /absolute/plugin.mjs',
      '',
    ].join('\n'), presetDir)
    const nested = rowOf(parsed, 'top').config as readonly CompositionRow[]
    expect(nested.map(row => row.id)).toEqual(['inner', undefined])
    expect(configOf(nested[0]!)['list']).toEqual(['one', 'two'])
    expect(nested[1]!.name).toBe('/absolute/plugin.mjs')
  })
})

describe('readPresetMetadata', () => {
  it('operator reads the shipped display map', () => {
    // Given the shipped preset.yml, When the operator reads it, Then the
    // roster receives the display name, the sentence and the order rank.
    const metadata = readPresetMetadata(readFileSync(join(presetDir, 'preset.yml'), 'utf8'))
    expect(metadata.name).toBe('梁神模式')
    expect(metadata.order).toBe(4)
    expect(metadata.description?.length).toBeGreaterThan(0)
  })

  it('operator reads a display map with no optional field', () => {
    // Given a preset.yml carrying only a name, When the operator reads it,
    // Then the absent fields are simply not supplied.
    expect(readPresetMetadata('name: only\n')).toEqual({ name: 'only' })
  })

  it('operator is refused a display map the roster cannot render', () => {
    // Given a list, a multi-line name and a non-numeric order, When the
    // operator reads them, Then each is refused rather than coerced.
    expect(() => readPresetMetadata('- a\n')).toThrow(/must be a mapping/)
    expect(() => readPresetMetadata('# nothing but a comment\n')).toThrow(/must be a mapping/)
    expect(() => readPresetMetadata('name: |\n  two\n  lines\n')).toThrow(/single-line string/)
    expect(() => readPresetMetadata('order: soon\n')).toThrow(/order must be a number/)
  })
})

describe('applyPresetOverrides', () => {
  it('operator keeps the composition unchanged when no setting is overridden', () => {
    // Given the shipped rows and empty settings, When the operator applies the
    // overlay, Then the declaration is exactly what the composition declares.
    const parsed = rows()
    expect(applyPresetOverrides(parsed, {})).toEqual(parsed)
  })

  it('operator writes the settings into the rows that carry them', () => {
    // Given committed settings, When the operator applies the overlay, Then
    // the tool-catalog and guard rows carry them and nothing else moves.
    const applied = applyPresetOverrides(rows(), {
      presentation: 'ptc',
      guardEnabled: false,
      guardSensitivity: 'aggressive',
      guardStallReasoningChars: 12000,
      guardGlobalStallCap: 6,
      guardEchoFailures: 2,
    })
    expect(configOf(rowOf(applied, 'tool-catalog'))['presentation']).toBe('ptc')
    expect(configOf(rowOf(applied, 'guard'))).toEqual({
      enabled: false,
      sensitivity: 'aggressive',
      stallReasoningChars: 12000,
      globalStallCap: 6,
      echoFailures: 2,
    })
    expect(configOf(rowOf(applied, 'tool-catalog'))['descriptionMaxLength']).toBe(200)
    expect(rowOf(applied, 'minimal-prompt')).toEqual(rowOf(rows(), 'minimal-prompt'))
  })

  it('operator is never given a row the composition does not carry', () => {
    // Given a composition with no tool-catalog row, When the operator applies
    // a presentation choice, Then no row is invented for it.
    const parsed = readCompositionRows('- id: other\n  name: ./other.mjs\n  config:\n    presentation: both\n', presetDir)
    const applied = applyPresetOverrides(parsed, { presentation: 'ptc' })
    expect(applied).toEqual(parsed)
  })
})

describe('readPresetDefinition', () => {
  it('operator builds the declaration from the shipped preset directory', () => {
    // Given the bundled preset directory, When the operator reads its
    // declaration, Then it carries the display text and mountable module rows.
    const definition = readPresetDefinition('liangshen', presetDir)
    expect(definition.id).toBe('liangshen')
    expect(definition.name).toBe('梁神模式')
    expect(definition.order).toBe(4)
    expect(definition.plugins.length).toBe(loose(rows()).length)
    for (const plugin of definition.plugins) {
      expect(plugin.name, JSON.stringify(plugin)).toMatch(/^(file:|@|\.\/|cordis:)/)
    }
    const local = definition.plugins.filter(plugin => (plugin.name ?? '').startsWith('file:'))
    expect(local.length).toBeGreaterThan(4)
    for (const plugin of local) {
      expect(fileURLToPath(plugin.name!)).toContain('presets')
    }
  })

  it('operator is refused a directory that is not a preset', () => {
    // Given a path holding no preset files, When the operator reads a
    // declaration from it, Then the failure names the unreadable file.
    expect(() => readPresetDefinition('nope', join(process.cwd(), 'presets', 'nope'))).toThrow(/unreadable/)
  })
})
