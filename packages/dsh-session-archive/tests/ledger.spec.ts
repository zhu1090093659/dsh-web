// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { capEntries, deserializeAutoState, deserializeLedger, writeJsonAtomic } from '../src/host/ledger.ts'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('ledger serialization', () => {
  it('round-trips entries', () => {
    const doc = { version: 1 as const, entries: { 'session-a': { archivedAt: 123, source: 'auto' as const } } }
    const restored = deserializeLedger(JSON.stringify(doc))
    expect(restored).toEqual(doc)
  })

  it('starts fresh on corrupt or foreign documents', () => {
    expect(deserializeLedger('not json at all')).toEqual({ version: 1, entries: {} })
    expect(deserializeLedger('{"version":2,"entries":{}}')).toEqual({ version: 1, entries: {} })
    expect(deserializeLedger('{"version":1,"entries":{"x":{"archivedAt":"nope"}}}')).toEqual({ version: 1, entries: {} })
  })

  it('tolerates a corrupt auto-state document', () => {
    expect(deserializeAutoState('garbage')).toEqual({ version: 1 })
    expect(deserializeAutoState('{"version":1,"nextCheckAt":123}').nextCheckAt).toBe(123)
  })
})

describe('capEntries', () => {
  it('caps the failure list', () => {
    const entries = Array.from({ length: 80 }, (_, index) => ({ id: `session-${index}`, status: 'failed' as const, reason: 'error' as const }))
    expect(capEntries(entries)).toHaveLength(50)
  })
})

describe('writeJsonAtomic', () => {
  it('writes atomically and leaves no temp files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-session-archive-'))
    const path = join(dir, 'state.json')
    await writeJsonAtomic(path, { ok: 1 })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ok: 1 })
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
