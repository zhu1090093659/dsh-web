/**
 * Legacy bridge tests (issue #506): one-shot migration of the retired
 * dsh-skin managed-section state into the v2 selection store.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MANAGED_END,
  MANAGED_START,
  migrateLegacySelection,
  readLegacyActiveId,
  stripLegacySkinState,
  stripManaged,
} from '../src/legacy-bridge.ts'
import { readActiveSelection } from '../src/active-state.ts'

const KNOWN = ['harbor', 'xp', 'matrix']

const INSERT_PATCH = [
  '- insert:',
  '    - id: ui-skin-center',
  "      name: '@linxin666/dsh-client-ui-skin-center'",
  '',
  MANAGED_START,
  '- id: ui-skin-harbor',
  '  disabled: true',
  '- id: ui-skin-matrix',
  '  disabled: true',
  '- insert:',
  '    - id: ui-skin-xp',
  "      name: '@linxin666/dsh-client-ui-skin-xp'",
  MANAGED_END,
  '',
].join('\n')

const WIRED_PATCH = [
  MANAGED_START,
  '- id: ui-skin-xp',
  '  disabled: true',
  '- id: ui-skin-matrix',
  '  disabled: true',
  MANAGED_END,
  '',
].join('\n')

const STOCK_PATCH = [
  MANAGED_START,
  '- id: ui-skin-harbor',
  '  disabled: true',
  '- id: ui-skin-xp',
  '  disabled: true',
  '- id: ui-skin-matrix',
  '  disabled: true',
  MANAGED_END,
  '',
].join('\n')

let root: string
let statePath: string
let patchPath: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legacy-bridge-'))
  statePath = join(root, 'skin-center-active.json')
  patchPath = join(root, 'cordis.patch.yml')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readLegacyActiveId', () => {
  it('reads the insert-row skin', () => {
    expect(readLegacyActiveId(INSERT_PATCH, KNOWN)).toBe('xp')
  })

  it('reads the bundle-wired skin as the known id not disabled', () => {
    expect(readLegacyActiveId(WIRED_PATCH, KNOWN)).toBe('harbor')
  })

  it('returns null for the stock look and for no managed state', () => {
    expect(readLegacyActiveId(STOCK_PATCH, KNOWN)).toBeNull()
    expect(readLegacyActiveId('- insert: []\n', KNOWN)).toBeNull()
  })

  it('returns null when the non-disabled set is ambiguous', () => {
    const ambiguous = [MANAGED_START, '- id: ui-skin-xp', '  disabled: true', MANAGED_END, ''].join('\n')
    expect(readLegacyActiveId(ambiguous, KNOWN)).toBeNull()
  })
})

describe('stripManaged / stripLegacySkinState', () => {
  it('removes the managed section entirely', () => {
    const out = stripManaged(INSERT_PATCH)
    expect(out).not.toContain('ui-skin-xp')
    expect(out).toContain('ui-skin-center')
  })

  it('throws on an unterminated managed section', () => {
    expect(() => stripManaged(MANAGED_START + '\n- id: ui-skin-xp\n')).toThrow(/unterminated/)
  })

  it('strips legacy insert rows outside the section too', () => {
    const withStraggler = '- insert:\n    - id: ui-skin-old\n      name: \'@linxin666/dsh-client-ui-skin-old\'\n' + INSERT_PATCH
    const out = stripLegacySkinState(withStraggler)
    expect(out).not.toContain('ui-skin-old')
    expect(out).toContain('ui-skin-center')
  })
})

describe('migrateLegacySelection', () => {
  it('migrates the active id and cleans the patch', () => {
    writeFileSync(patchPath, INSERT_PATCH)
    const result = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(result.migrated).toBe('xp')
    expect(result.patchCleaned).toBe(true)
    expect(readActiveSelection(statePath)).toBe('xp')
    expect(readFileSync(patchPath, 'utf8')).not.toContain('dsh-skin managed')
  })

  it('is a no-op on the second run', () => {
    writeFileSync(patchPath, INSERT_PATCH)
    migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    const second = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(second.migrated).toBeNull()
    expect(second.patchCleaned).toBe(false)
  })

  it('does not clobber an existing v2 selection but still cleans', () => {
    mkdirSync(join(statePath, '..'), { recursive: true })
    writeFileSync(statePath, JSON.stringify({ active: 'matrix' }))
    writeFileSync(patchPath, INSERT_PATCH)
    const result = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(result.migrated).toBeNull()
    expect(result.patchCleaned).toBe(true)
    expect(readActiveSelection(statePath)).toBe('matrix')
  })

  it('reports nothing-to-migrate without legacy state', () => {
    writeFileSync(patchPath, '- insert: []\n')
    const result = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(result.migrated).toBeNull()
    expect(result.patchCleaned).toBe(false)
    expect(result.notes.join(' ')).toContain('nothing to migrate')
  })

  it('fails closed without a readable patch', () => {
    const result = migrateLegacySelection({
      knownIds: KNOWN,
      activeStatePath: statePath,
      patchPath: join(root, 'nope.yml'),
    })
    expect(result.migrated).toBeNull()
    expect(result.notes.join(' ')).toContain('nothing to migrate')
  })

  it('a managed-only patch normalizes to [] instead of an empty file', () => {
    writeFileSync(patchPath, STOCK_PATCH)
    const result = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(result.patchCleaned).toBe(true)
    const after = readFileSync(patchPath, 'utf8')
    expect(after.trim()).toBe('[]')
  })

  it('a comment-only patch after cleanup normalizes to []', () => {
    writeFileSync(patchPath, '# User patch layer.\n\n' + STOCK_PATCH)
    migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(readFileSync(patchPath, 'utf8')).toBe('[]\n')
  })

  it('stock-look legacy state migrates no id and still cleans', () => {
    writeFileSync(patchPath, STOCK_PATCH)
    const result = migrateLegacySelection({ knownIds: KNOWN, activeStatePath: statePath, patchPath })
    expect(result.migrated).toBeNull()
    expect(result.patchCleaned).toBe(true)
    expect(readActiveSelection(statePath)).toBeNull()
  })
})
