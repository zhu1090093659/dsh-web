/**
 * Fallback ledger: disable intents are upserted, enables clear entries, and
 * corrupt files fall back to an empty document.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePluginLedgerDocument, PluginLedger } from '../src/core/ledger.ts'

const dirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('parsePluginLedgerDocument', () => {
  it('parses a valid document', () => {
    const doc = parsePluginLedgerDocument(JSON.stringify({
      version: 1,
      entries: [{ entryId: 'ui-task-board', disabled: true, updatedAt: 1 }],
    }))
    expect(doc?.entries[0]).toMatchObject({ entryId: 'ui-task-board', disabled: true })
  })

  it('rejects corrupt documents', () => {
    expect(parsePluginLedgerDocument('not json')).toBeUndefined()
    expect(parsePluginLedgerDocument(JSON.stringify({ version: 1, entries: [{ entryId: 'x', disabled: false }] }))).toBeUndefined()
  })
})

describe('PluginLedger', () => {
  it('records and clears disable intents', async () => {
    const dir = await tempDir('dsh-pm-ledger-')
    const ledger = new PluginLedger(join(dir, 'plugin-manager.json'))
    await ledger.set('ui-task-board', true)
    expect((await ledger.disableIntents()).map(entry => entry.entryId)).toEqual(['ui-task-board'])
    await ledger.set('ui-task-board', false)
    expect(await ledger.disableIntents()).toEqual([])
  })

  it('upserts instead of duplicating', async () => {
    const dir = await tempDir('dsh-pm-ledger-')
    const ledger = new PluginLedger(join(dir, 'plugin-manager.json'))
    await ledger.set('a', true)
    await ledger.set('a', true)
    expect(await ledger.disableIntents()).toHaveLength(1)
    const text = await readFile(join(dir, 'plugin-manager.json'), 'utf8')
    expect(JSON.parse(text)).toMatchObject({ version: 1, entries: [{ entryId: 'a', disabled: true }] })
  })

  it('falls back to an empty document for a corrupt ledger', async () => {
    const dir = await tempDir('dsh-pm-ledger-')
    const ledger = new PluginLedger(join(dir, 'plugin-manager.json'))
    expect(await ledger.disableIntents()).toEqual([])
  })
})
