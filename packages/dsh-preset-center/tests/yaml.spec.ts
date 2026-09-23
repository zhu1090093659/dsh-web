/**
 * Composition reader contract over the preset subset of YAML: block maps and
 * sequences, scalar styles, the `!!js` encoding the registry expects, the
 * shipped catalog parsed byte for byte, and the fail-closed refusals.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CompositionError, readCordisYaml } from '../src/core/yaml.ts'

const PRESETS_DIR = fileURLToPath(new URL('../presets/', import.meta.url))

/** The catalog directories that ship a composition (the template included). */
function catalogIds(): string[] {
  return readdirSync(PRESETS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * Read the literal block that follows one `key: |` header straight from the
 * source, without the reader under test: the independent expectation the
 * shipped personas are compared against.
 */
function literalBlockFromSource(source: string, header: string): string {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === header)
  expect(start).toBeGreaterThanOrEqual(0)
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') { body.push(''); continue }
    if (!line.startsWith('      ')) break
    body.push(line.slice(6))
  }
  while (body.length > 0 && body[body.length - 1] === '') body.pop()
  return body.join('\n')
}

describe('composition reader', () => {
  it('operator reads group rows, isolation realms and inline expressions', () => {
    // Given a composition whose group row carries an isolate realm and a
    // loader expression, When the operator reads it, Then every row keeps its
    // shape and the expression stays data.
    const rows = readCordisYaml([
      '- id: group',
      '  name: cordis:group',
      '  group: true',
      '  isolate:',
      '    fs: true',
      '  config:',
      '    - id: tool-bash',
      "      name: '@deepseek-ai/dsh-tool-bash'",
      "      disabled: !!js process.platform === 'win32'",
      '      config:',
      '        timeoutMs: 300000',
      '',
    ].join('\n'))

    expect(rows).toEqual([{
      id: 'group',
      name: 'cordis:group',
      group: true,
      isolate: { fs: true },
      config: [{
        id: 'tool-bash',
        name: '@deepseek-ai/dsh-tool-bash',
        disabled: { __jsExpr: "process.platform === 'win32'" },
        config: { timeoutMs: 300000 },
      }],
    }])
  })

  it('operator keeps a literal block scalar byte for byte', () => {
    // Given a literal block whose content carries comments, blank lines and
    // punctuation, When the operator reads it, Then the scalar is the block
    // content exactly, without the trailing newline the header chomps.
    const source = [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: |-',
      '      # not a comment inside the block',
      '',
      '      第一行：角色设定。',
      '      - 一条带连字符的规则',
      '    complete: true',
      '',
    ].join('\n')

    const rows = readCordisYaml(source) as { config: { prefix: string; complete: boolean } }[]
    expect(rows[0]?.config.prefix).toBe('# not a comment inside the block\n\n第一行：角色设定。\n- 一条带连字符的规则')
    expect(rows[0]?.config.complete).toBe(true)
  })

  it('operator reads a folded and a clipped block scalar with their chomping', () => {
    // Given folded (`>`) and clipped (`|`) headers, When the operator reads
    // them, Then folding turns a blank line into one newline and clipping
    // keeps exactly one.
    const value = readCordisYaml([
      'folded: >-',
      '  one',
      '  two',
      '',
      '  three',
      'clipped: |',
      '  text',
      'kept: |+',
      '  text',
      '',
      '',
    ].join('\n')) as Record<string, string>

    expect(value['folded']).toBe('one two\nthree')
    expect(value['clipped']).toBe('text\n')
    expect(value['kept']).toBe('text\n\n\n')
  })

  it('operator reads an explicitly indented block scalar header', () => {
    // Given an indentation indicator, When the operator reads the block,
    // Then the content is stripped at the declared indent.
    const value = readCordisYaml('value: |2\n  text\n') as Record<string, string>
    expect(value['value']).toBe('text\n')
  })

  it('operator reads quoted scalars, comments and empty values', () => {
    // Given quoted keys and values, a trailing comment and a valueless key,
    // When the operator reads the map, Then each scalar resolves to its value.
    const value = readCordisYaml([
      "name: '@deepseek-ai/dsh-persona' # display hint",
      '"quoted key": "a\\tb"',
      'empty:',
      'next: 12',
      "apostrophe: 'it''s fine'",
      '',
    ].join('\n'))

    expect(value).toEqual({
      name: '@deepseek-ai/dsh-persona',
      'quoted key': 'a\tb',
      empty: null,
      next: 12,
      apostrophe: "it's fine",
    })
  })

  it('operator parses every shipped catalog composition and its persona', () => {
    // Given the whole market catalog, When the operator reads each
    // composition, Then each is a row list whose persona prefix matches the
    // literal block in the source file byte for byte.
    const ids = catalogIds()
    expect(ids.length).toBeGreaterThan(30)

    for (const id of ids) {
      const source = readFileSync(join(PRESETS_DIR, id, 'agent.cordis.yml'), 'utf8')
      const rows = readCordisYaml(source) as { id?: string; name?: string; config?: { prefix?: string } }[]
      expect(Array.isArray(rows), `${id} is a row list`).toBe(true)
      expect(rows[0]?.name, `${id} opens with the persona row`).toBe('@deepseek-ai/dsh-persona')
      if (source.includes('prefix: |-')) {
        expect(rows[0]?.config?.prefix, `${id} prefix`).toBe(literalBlockFromSource(source, 'prefix: |-'))
      } else {
        expect(typeof rows[0]?.config?.prefix, `${id} prefix`).toBe('string')
      }
    }
  })

  it('operator is refused an unsupported or malformed construct', () => {
    // Given constructs outside the preset subset and broken indentation, When
    // the operator reads them, Then each raises instead of guessing.
    const refused = [
      'rows: [a, b]\n',
      'row: &anchor value\n',
      '- id: x\n  name: !custom y\n',
      '\t- id: x\n',
      '- id: x\n  id: y\n',
      'plain scalar without a colon\n',
      '- id: x\n  name: y\n   over: indented\n',
      'value: |0\n',
    ]

    for (const text of refused) {
      expect(() => readCordisYaml(text), text.trim()).toThrowError(CompositionError)
    }
  })

  it('operator reads an empty document as null', () => {
    // Given a composition with only comments, When the operator reads it,
    // Then the document resolves to null rather than an empty list.
    expect(readCordisYaml('# nothing here\n\n')).toBeNull()
  })
})
