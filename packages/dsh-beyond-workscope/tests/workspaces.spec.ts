/**
 * Sub-workspace ledger unit tests: validation, per-session records,
 * idempotent registration, coverage (auto read/write allowance), and
 * session-end release.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GrantError } from '../src/grants.ts'
import {
  removeWorkspaces, toWorkspaceViews,
  WorkspaceLedger,
} from '../src/workspaces.ts'

describe('WorkspaceLedger', () => {
  let base: string
  let ledger: WorkspaceLedger

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-ledger-'))
    ledger = new WorkspaceLedger()
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('registers records per session and lists them', async () => {
    const dir = join(base, 'ws')
    await mkdir(dir)
    const canonical = await ledger.prepareRegistration('s1', dir)
    const record = ledger.register('s1', canonical, '项目')
    expect(record).toMatchObject({ path: dir, title: '项目', sessionId: 's1', status: 'active' })
    expect(ledger.list('s1')).toHaveLength(1)
    expect(ledger.list('s2')).toHaveLength(0)
    expect(ledger.list()).toHaveLength(1)
  })

  it('rejects duplicate registrations and per-session caps', async () => {
    const dir = join(base, 'dup')
    await mkdir(dir)
    const canonical = await ledger.prepareRegistration('s1', dir)
    ledger.register('s1', canonical, '重复')
    await expect(ledger.prepareRegistration('s1', dir)).rejects.toBeInstanceOf(GrantError)

    const capped = new WorkspaceLedger({ maxPerSession: 1 })
    const first = await capped.prepareRegistration('s1', dir)
    capped.register('s1', first, '占位')
    const other = join(base, 'other')
    await mkdir(other)
    await expect(capped.prepareRegistration('s1', other)).rejects.toBeInstanceOf(GrantError)
  })

  it('register is idempotent for the same session and path', async () => {
    const dir = join(base, 'idem')
    await mkdir(dir)
    const first = ledger.register('s1', dir, 'x')
    const second = ledger.register('s1', dir, 'x')
    expect(second.id).toBe(first.id)
    expect(ledger.list('s1')).toHaveLength(1)
  })

  it('rejects missing paths and the filesystem root', async () => {
    await expect(ledger.prepareRegistration('s1', join(base, 'nope'))).rejects.toBeInstanceOf(GrantError)
    await expect(ledger.prepareRegistration('s1', '/')).rejects.toBeInstanceOf(GrantError)
  })

  it('covers paths inside an active record — the auto read/write allowance', async () => {
    const dir = join(base, 'cover')
    const sub = join(dir, 'sub')
    await mkdir(sub, { recursive: true })
    ledger.register('s1', dir, '覆盖')

    expect(ledger.covers('s1', dir)).toBe(true)
    expect(ledger.covers('s1', join(sub, 'file.txt'))).toBe(true)
    // Sibling or outside paths are NOT covered.
    const outside = join(base, 'outside')
    await mkdir(outside)
    expect(ledger.covers('s1', outside)).toBe(false)
    expect(ledger.covers('s2', dir)).toBe(false)
    // Prefix-safe: a directory sharing the path prefix is not covered.
    const prefixTwin = join(base, 'cover-extra')
    await mkdir(prefixTwin)
    expect(ledger.covers('s1', prefixTwin)).toBe(false)
  })

  it('finds records by ledger id or path and removes them', async () => {
    const dir = join(base, 'find')
    await mkdir(dir)
    const record = ledger.register('s1', dir, '查找')
    expect(ledger.find(record.id)).toHaveLength(1)
    expect(ledger.find(dir)).toHaveLength(1)
    expect(ledger.find('unknown')).toHaveLength(0)

    const removed = ledger.remove(ledger.find(record.id))
    expect(removed).toHaveLength(1)
    expect(removed[0].status).toBe('removed')
    expect(ledger.list('s1')).toHaveLength(0)
    expect(ledger.covers('s1', dir)).toBe(false)
    // Idempotent: removing again yields nothing.
    expect(ledger.remove(ledger.find(record.id))).toHaveLength(0)
  })

  it('releases everything on session end', async () => {
    const dir = join(base, 'release')
    await mkdir(dir)
    ledger.register('s1', dir, '释放')
    ledger.releaseSession('s1')
    expect(ledger.list('s1')).toHaveLength(0)
    expect(ledger.list('s2')).toHaveLength(0)
  })
})

describe('workspace helpers', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-ws-helpers-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('removeWorkspaces removes by path and keeps the directory', async () => {
    const ledger = new WorkspaceLedger()
    const dir = join(base, 'target')
    await mkdir(dir)

    const removed = removeWorkspaces(ledger, dir)
    expect(removed).toHaveLength(0) // not registered yet
    ledger.register('s1', dir, 'x')
    const removed2 = removeWorkspaces(ledger, dir)
    expect(removed2).toHaveLength(1)
    expect(ledger.list('s1')).toHaveLength(0)
    expect(ledger.find(dir)).toHaveLength(0)
    // Non-destructive: the directory itself stays.
    const { stat } = await import('node:fs/promises')
    await expect(stat(dir)).resolves.toBeTruthy()
  })

  it('removeWorkspaces is a no-op for unknown targets', () => {
    const ledger = new WorkspaceLedger()
    expect(removeWorkspaces(ledger, 'unknown')).toHaveLength(0)
  })

  it('toWorkspaceViews shapes records for the wire', async () => {
    const ledger = new WorkspaceLedger()
    const dir = join(base, 'target')
    await mkdir(dir)
    const record = ledger.register('s1', dir, '视图')
    const views = toWorkspaceViews([record])
    expect(views[0]).toEqual({
      id: record.id,
      path: dir,
      title: '视图',
      sessionId: 's1',
      createdAt: record.createdAt,
      status: 'active',
    })
  })
})
