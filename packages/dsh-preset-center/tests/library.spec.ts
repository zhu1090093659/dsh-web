/**
 * Preset library contract: one inert install directory, the declaration-
 * derived enablement, provenance integrity, and the removal refusals.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PresetOperationError,
  libraryDirOf,
  listPresetStates,
  readPresetState,
  uninstallPreset,
} from '../src/core/library.ts'
import { LIBRARY_DIR, PROVENANCE_FILENAME } from '../src/core/paths.ts'
import { verifyProvenance } from '../src/core/provenance.ts'

let home: string

const NONE: ReadonlySet<string> = new Set()

/** Write one workshop-installed preset (composition + provenance) into the library. */
function writeLibraryPreset(id: string, files: Record<string, string> = {}): string {
  const dir = join(home, LIBRARY_DIR, id)
  mkdirSync(dir, { recursive: true })
  const all: Record<string, string> = { 'agent.cordis.yml': '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n', 'preset.yml': 'name: Test\n', ...files }
  const hashes: Record<string, string> = {}
  for (const [rel, content] of Object.entries(all)) {
    writeFileSync(join(dir, rel), content)
    hashes[rel] = createHash('sha256').update(content).digest('hex')
  }
  writeFileSync(join(dir, PROVENANCE_FILENAME), JSON.stringify({
    version: 1,
    source: 'https://dsh-market.com',
    kind: 'preset',
    id,
    installedAt: '2026-09-09T00:00:00.000Z',
    assetVersion: '1.0.0',
    files: hashes,
  }, null, 2) + '\n')
  return dir
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dsh-preset-center-'))
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('preset library', () => {
  it('operator sees an absent preset as uninstalled and undeclared', () => {
    const row = readPresetState(home, 'demo', new Set(['demo']))
    expect(row).toMatchObject({ id: 'demo', installed: false, enabled: false, managed: false, integrity: 'none' })
    expect(row.dir).toBe(libraryDirOf(home, 'demo'))
  })

  it('operator sees an installed preset as inert until the plugin declares it', () => {
    // Given a workshop-installed preset, When the operator reads its state
    // without and with a live declaration, Then only the declaration enables
    // it and nothing moves on disk.
    writeLibraryPreset('demo')

    const inert = readPresetState(home, 'demo', NONE)
    expect(inert).toMatchObject({ installed: true, enabled: false, managed: true, integrity: 'valid' })

    const declared = readPresetState(home, 'demo', new Set(['demo']))
    expect(declared.enabled).toBe(true)
    expect(existsSync(join(home, LIBRARY_DIR, 'demo', 'agent.cordis.yml'))).toBe(true)
  })

  it('operator reads a declaration without an installed copy as disabled', () => {
    expect(readPresetState(home, 'demo', new Set(['demo'])).enabled).toBe(false)
  })

  it('operator lists every installed id in order', () => {
    writeLibraryPreset('beta')
    writeLibraryPreset('alpha')
    mkdirSync(join(home, LIBRARY_DIR, 'Hand-Made'), { recursive: true })
    expect(listPresetStates(home, NONE).map((row) => row.id)).toEqual(['alpha', 'beta'])
  })

  it('operator reads a modified file as modified instead of repairing it', () => {
    writeLibraryPreset('demo')
    writeFileSync(join(home, LIBRARY_DIR, 'demo', 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n# edited\n')
    const report = verifyProvenance(join(home, LIBRARY_DIR, 'demo'), 'demo')
    expect(report.state).toBe('modified')
    expect(report.mismatches).toContain('agent.cordis.yml')
    expect(readPresetState(home, 'demo', NONE).integrity).toBe('modified')
  })

  it('operator reads provenance for another id as absent', () => {
    writeLibraryPreset('demo')
    const raw = JSON.parse(readFileSync(join(home, LIBRARY_DIR, 'demo', PROVENANCE_FILENAME), 'utf8')) as Record<string, unknown>
    raw.id = 'other'
    writeFileSync(join(home, LIBRARY_DIR, 'demo', PROVENANCE_FILENAME), JSON.stringify(raw))
    expect(readPresetState(home, 'demo', NONE).managed).toBe(false)
  })

  it('operator uninstalls a managed preset and leaves nothing behind', () => {
    // Given a workshop-installed preset, When the operator uninstalls it,
    // Then the library directory is gone and the state reads as uninstalled.
    writeLibraryPreset('demo')
    uninstallPreset(home, 'demo')
    expect(existsSync(join(home, LIBRARY_DIR, 'demo'))).toBe(false)
    expect(readPresetState(home, 'demo', NONE).installed).toBe(false)
  })

  it('operator is refused a directory the workshop did not install', () => {
    // Given a hand-authored directory, When the operator uninstalls it, Then
    // the refusal names the missing provenance and the files stay.
    mkdirSync(join(home, LIBRARY_DIR, 'hand'), { recursive: true })
    writeFileSync(join(home, LIBRARY_DIR, 'hand', 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n')
    try {
      uninstallPreset(home, 'hand')
      throw new Error('expected a refusal')
    } catch (err) {
      expect(err).toBeInstanceOf(PresetOperationError)
      expect((err as PresetOperationError).code).toBe('not-managed')
    }
    expect(existsSync(join(home, LIBRARY_DIR, 'hand', 'agent.cordis.yml'))).toBe(true)
  })

  it('operator uninstalling an absent preset is a no-op', () => {
    expect(() => { uninstallPreset(home, 'ghost') }).not.toThrow()
  })

  it('operator is refused an invalid id before touching the filesystem', () => {
    for (const id of ['Demo', 'a b', '../escape', 'demo/preset']) {
      try {
        uninstallPreset(home, id)
        throw new Error('expected a refusal')
      } catch (err) {
        expect((err as PresetOperationError).code).toBe('invalid-id')
      }
    }
  })
})
