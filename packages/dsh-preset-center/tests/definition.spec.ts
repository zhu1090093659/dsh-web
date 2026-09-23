/**
 * Preset declaration contract: the identity and display text read from
 * `preset.yml`, the child rows read from `agent.cordis.yml`, and the
 * fail-closed refusals that keep an unreadable preset undeclared.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { presetDefinition, readPresetDefinition, readPresetMetadata } from '../src/core/definition.ts'
import { CompositionError } from '../src/core/yaml.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-preset-definition-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('preset definition', () => {
  it('operator reads identity, display text and rows from one installed directory', () => {
    // Given an installed preset with display metadata and a group row, When
    // the operator builds its definition, Then every registry field is filled
    // from the installed bytes.
    const row = join(dir, 'demo')
    mkdirSync(row)
    writeFileSync(join(row, 'agent.cordis.yml'), [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: You are a helpful software engineer assistant.',
      '',
    ].join('\n'))
    writeFileSync(join(row, 'preset.yml'), [
      '# DSH roster display text, one line each.',
      'name: 演示预设',
      'description: 说明这个预设面向什么场景。',
      'order: 50',
      '',
    ].join('\n'))

    const definition = readPresetDefinition('demo', row)

    expect(definition.id).toBe('demo')
    expect(definition.name).toBe('演示预设')
    expect(definition.description).toBe('说明这个预设面向什么场景。')
    expect(definition.order).toBe(50)
    expect(definition.plugins).toEqual([{
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: 'You are a helpful software engineer assistant.' },
    }])
  })

  it('operator leaves absent display fields out of the definition', () => {
    // Given a `preset.yml` that declares only a name, When the operator reads
    // it, Then the optional fields stay absent rather than becoming undefined
    // keys the registry would publish.
    const metadata = readPresetMetadata('name: Bare\n')
    expect(metadata).toEqual({ name: 'Bare' })
    expect(Object.hasOwn(metadata, 'description')).toBe(false)
    expect(Object.hasOwn(metadata, 'order')).toBe(false)
  })

  it('operator is refused a composition that is not a row list', () => {
    // Given a composition whose root is a mapping, When the operator builds
    // the definition, Then it raises instead of declaring an empty preset.
    expect(() => presetDefinition('demo', 'id: persona\n', 'name: Demo\n', '/tmp/demo')).toThrowError(CompositionError)
  })

  it('operator gets a preset-local row resolved against the preset directory', () => {
    // Given an installed preset whose composition names a file it ships, When
    // the operator builds its definition, Then the row carries an absolute
    // file URL of the preset's own copy rather than a path the declaring
    // plugin's base URL would resolve elsewhere.
    const row = join(dir, 'demo')
    mkdirSync(row)
    writeFileSync(join(row, 'guard.mjs'), 'export const name = "guard"\n')
    writeFileSync(join(row, 'agent.cordis.yml'), [
      '- id: guard',
      "  name: './guard.mjs'",
      '',
    ].join('\n'))
    writeFileSync(join(row, 'preset.yml'), 'name: Demo\n')
    const definition = readPresetDefinition('demo', row)
    expect(definition.plugins[0]).toMatchObject({ id: 'guard' })
    const name = (definition.plugins[0] as { name?: string }).name ?? ''
    expect(name.startsWith('file://')).toBe(true)
    expect(name.endsWith('/guard.mjs')).toBe(true)
  })

  it('operator is refused multi-line or mistyped display text', () => {
    // Given a multi-line name and a non-numeric order, When the operator reads
    // the metadata, Then each is refused.
    expect(() => readPresetMetadata('name: |-\n  first\n  second\n')).toThrowError(CompositionError)
    expect(() => readPresetMetadata('order: soon\n')).toThrowError(CompositionError)
  })

  it('operator is refused a directory whose files are missing', () => {
    // Given a directory with only a composition, When the operator reads the
    // definition, Then the missing metadata file is named in the refusal.
    mkdirSync(join(dir, 'partial'))
    writeFileSync(join(dir, 'partial', 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n')
    expect(() => readPresetDefinition('partial', join(dir, 'partial'))).toThrowError(/preset\.yml is unreadable/)
  })
})
