/**
 * Operation ledger unit tests: record/cap/release, write snapshot rollback,
 * delete stash rollback, move reversal, copy removal, and path gating.
 */

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  exists, OperationLedger, rollbackOp, rollbackRoot, snapshotForWrite, stashForDelete,
} from '../src/ops.ts'
import { computePerceptionDelta } from '../src/tools.ts'

describe('OperationLedger', () => {
  let base: string
  let ledger: OperationLedger

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-ops-'))
    ledger = new OperationLedger()
    // Point the rollback root into the temp sandbox for these tests.
    process.env.DSH_HOME = base
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('records operations per session, newest first, and caps the count', () => {
    for (let i = 0; i < 5; i++) ledger.record('s1', 'write', `/tmp/f${i}`, undefined, 0)
    const small = new OperationLedger({ maxPerSession: 3 })
    for (let i = 0; i < 5; i++) small.record('s1', 'write', `/tmp/g${i}`, undefined, 0)
    expect(small.list('s1')).toHaveLength(3)
    expect(small.list('s1')[0].path).toBe('/tmp/g4')
    expect(ledger.list('s1')).toHaveLength(5)
    expect(ledger.list('s2')).toHaveLength(0)
  })

  it('releases a session and deletes its rollback area', async () => {
    const record = ledger.record('s1', 'write', join(base, 'x.txt'), undefined, 0)
    await mkdir(ledger.opRollbackDir('s1', record.id), { recursive: true })
    await writeFile(join(ledger.opRollbackDir('s1', record.id), 'original'), 'old')
    await ledger.releaseSession('s1')
    expect(ledger.list('s1')).toHaveLength(0)
    await expect(stat(join(rollbackRoot(), 's1'))).rejects.toThrow()
  })

  it('marks rolled back', () => {
    const record = ledger.record('s1', 'write', '/tmp/x', undefined, 0)
    ledger.markRolledBack(record.id)
    expect(ledger.get(record.id)?.status).toBe('rolled-back')
    expect(ledger.list('s1')[0].status).toBe('rolled-back')
  })
})

describe('rollback behavior', () => {
  let base: string
  let ledger: OperationLedger

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-rollback-'))
    ledger = new OperationLedger()
    process.env.DSH_HOME = base
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  const allowAll = async (): Promise<boolean> => true
  const denyAll = async (): Promise<boolean> => false

  it('write rollback restores the snapshot content', async () => {
    const file = join(base, 'f.txt')
    await writeFile(file, 'original content')
    const record = ledger.record('s1', 'write', file, undefined, 0)
    await snapshotForWrite('s1', record.id, file)
    await writeFile(file, 'new content')

    const result = await rollbackOp(ledger, record, allowAll)
    expect(result.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('original content')
    expect(ledger.get(record.id)?.status).toBe('rolled-back')
  })

  it('write rollback removes a newly created file (no snapshot)', async () => {
    const file = join(base, 'new.txt')
    const record = ledger.record('s1', 'write', file, undefined, 0)
    const had = await snapshotForWrite('s1', record.id, file)
    expect(had).toBe(false)
    await writeFile(file, 'fresh')

    const result = await rollbackOp(ledger, record, allowAll)
    expect(result.ok).toBe(true)
    expect(await exists(file)).toBe(false)
  })

  it('delete rollback moves the artifact back', async () => {
    const dir = join(base, 'victim')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'a.txt'), 'a')
    const record = ledger.record('s1', 'delete', dir, undefined, 0)
    await stashForDelete('s1', record.id, dir)
    expect(await exists(dir)).toBe(false)

    const result = await rollbackOp(ledger, record, allowAll)
    expect(result.ok).toBe(true)
    expect(await exists(dir)).toBe(true)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('a')
  })

  it('move rollback reverses the move', async () => {
    const src = join(base, 'src.txt')
    const dest = join(base, 'dest.txt')
    await writeFile(src, 'moved')
    const record = ledger.record('s1', 'move', src, dest, 0)
    await import('node:fs/promises').then(fs => fs.rename(src, dest))

    const result = await rollbackOp(ledger, record, allowAll)
    expect(result.ok).toBe(true)
    expect(await readFile(src, 'utf8')).toBe('moved')
    expect(await exists(dest)).toBe(false)
  })

  it('copy rollback removes the copied target', async () => {
    const src = join(base, 'src.txt')
    const dest = join(base, 'copy.txt')
    await writeFile(src, 'data')
    const record = ledger.record('s1', 'copy', src, dest, 4)
    await import('node:fs/promises').then(fs => fs.copyFile(src, dest))

    const result = await rollbackOp(ledger, record, allowAll)
    expect(result.ok).toBe(true)
    expect(await exists(dest)).toBe(false)
    expect(await exists(src)).toBe(true)
  })

  it('gates restored paths through the allowed predicate', async () => {
    const file = join(base, 'g.txt')
    await writeFile(file, 'old')
    const record = ledger.record('s1', 'write', file, undefined, 0)
    await snapshotForWrite('s1', record.id, file)
    await writeFile(file, 'new')

    const result = await rollbackOp(ledger, record, denyAll)
    expect(result.ok).toBe(false)
    // Path gate failure leaves the file untouched.
    expect(await readFile(file, 'utf8')).toBe('new')
  })

  it('rejects double rollback', async () => {
    const file = join(base, 'd.txt')
    await writeFile(file, 'old')
    const record = ledger.record('s1', 'write', file, undefined, 0)
    await snapshotForWrite('s1', record.id, file)
    await writeFile(file, 'new')
    await rollbackOp(ledger, record, allowAll)
    const again = await rollbackOp(ledger, record, allowAll)
    expect(again.ok).toBe(false)
    expect(again.ok === false && again.error).toContain('已回滚')
  })
})

describe('perception timeline delta', () => {
  it('classifies new, changed, and removed entries', () => {
    const previous = {
      scannedAt: '2026-08-14T00:00:00.000Z',
      paths: new Set(['/a/old.txt', '/a/stable.txt']),
      mtimes: new Map([['/a/old.txt', 100], ['/a/stable.txt', 200]]),
    }
    const current = [
      { path: '/a/stable.txt', mtime: 200 },
      { path: '/a/stable.txt', mtime: 999 }, // duplicate path — last wins in the map
      { path: '/a/new.txt', mtime: 300 },
    ]
    const delta = computePerceptionDelta(previous, current)
    expect(delta.newFiles).toEqual(['/a/new.txt'])
    expect(delta.changedFiles).toEqual(['/a/stable.txt'])
    expect(delta.removedFiles).toEqual(['/a/old.txt'])
    expect(delta.since).toBe(previous.scannedAt)
  })
})
