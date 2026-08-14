/**
 * Workspace ledger unit tests: validation, per-session records, idempotent
 * registration, non-destructive removal, and the side-effect helpers with a
 * fake host workspace registry.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrantError } from '../src/grants.ts'
import {
  registerWorkspace, removeWorkspaces, toWorkspaceViews,
  WorkspaceLedger, type WorkspaceRegistryLike,
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
    const record = ledger.register('s1', canonical, 'ws-1', '项目')
    expect(record).toMatchObject({ path: dir, title: '项目', workspaceId: 'ws-1', sessionId: 's1', status: 'active' })
    expect(ledger.list('s1')).toHaveLength(1)
    expect(ledger.list('s2')).toHaveLength(0)
    expect(ledger.list()).toHaveLength(1)
  })

  it('rejects duplicate registrations and per-session caps', async () => {
    const dir = join(base, 'dup')
    await mkdir(dir)
    const canonical = await ledger.prepareRegistration('s1', dir)
    ledger.register('s1', canonical, 'ws-dup', '重复')
    await expect(ledger.prepareRegistration('s1', dir)).rejects.toBeInstanceOf(GrantError)

    const capped = new WorkspaceLedger({ maxPerSession: 1 })
    const first = await capped.prepareRegistration('s1', dir)
    capped.register('s1', first, 'ws-cap', '占位')
    const other = join(base, 'other')
    await mkdir(other)
    await expect(capped.prepareRegistration('s1', other)).rejects.toBeInstanceOf(GrantError)
  })

  it('rejects missing paths and the filesystem root', async () => {
    await expect(ledger.prepareRegistration('s1', join(base, 'nope'))).rejects.toBeInstanceOf(GrantError)
    await expect(ledger.prepareRegistration('s1', '/')).rejects.toBeInstanceOf(GrantError)
  })

  it('finds records by ledger id, workspace id, or path and removes them', async () => {
    const dir = join(base, 'find')
    await mkdir(dir)
    const record = ledger.register('s1', dir, 'ws-9', '查找')
    expect(ledger.find(record.id)).toHaveLength(1)
    expect(ledger.find('ws-9')).toHaveLength(1)
    expect(ledger.find(dir)).toHaveLength(1)
    expect(ledger.find('unknown')).toHaveLength(0)

    const removed = ledger.remove(ledger.find(record.id))
    expect(removed).toHaveLength(1)
    expect(removed[0].status).toBe('removed')
    expect(ledger.list('s1')).toHaveLength(0)
    // Idempotent: removing again yields nothing.
    expect(ledger.remove(ledger.find(record.id))).toHaveLength(0)
  })
})

describe('workspace side-effect helpers', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-ws-helpers-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  function fakeRegistry(): WorkspaceRegistryLike & { create: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; resolveByPath: ReturnType<typeof vi.fn> } {
    let n = 0
    return {
      create: vi.fn(async () => ({ id: `ws-${n++}` })),
      delete: vi.fn(async () => true),
      resolveByPath: vi.fn(async () => undefined),
    }
  }

  it('registerWorkspace canonicalizes, registers in the host, and records it', async () => {
    const ledger = new WorkspaceLedger()
    const registry = fakeRegistry()
    const dir = join(base, 'target')
    await mkdir(dir)

    const result = await registerWorkspace(ledger, registry, 's1', dir, '我的工作区')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record).toMatchObject({ path: dir, title: '我的工作区', workspaceId: 'ws-0' })
    expect(registry.create).toHaveBeenCalledWith(dir, '我的工作区')
    expect(ledger.list('s1')).toHaveLength(1)
  })

  it('registerWorkspace returns a readable error on failure and registers nothing', async () => {
    const ledger = new WorkspaceLedger()
    const registry = fakeRegistry()
    registry.create.mockRejectedValueOnce(new Error('boom'))
    const dir = join(base, 'target')
    await mkdir(dir)

    const result = await registerWorkspace(ledger, registry, 's1', dir, 'x')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('boom')
    expect(ledger.list('s1')).toHaveLength(0)
  })

  it('removeWorkspaces is non-destructive and tolerates a missing host record', async () => {
    const ledger = new WorkspaceLedger()
    const registry = fakeRegistry()
    const dir = join(base, 'target')
    await mkdir(dir)
    await registerWorkspace(ledger, registry, 's1', dir, 'x')
    registry.delete.mockRejectedValueOnce(new Error('already gone'))

    const removed = await removeWorkspaces(ledger, registry, dir)
    expect(removed).toHaveLength(1)
    expect(ledger.list('s1')).toHaveLength(0)
    expect(ledger.find(dir)).toHaveLength(0)
  })

  it('falls back to the durable registry when the ledger misses (post-restart)', async () => {
    const ledger = new WorkspaceLedger() // empty: plugin restarted
    const registry = fakeRegistry()
    const dir = join(base, 'target')
    await mkdir(dir)
    registry.resolveByPath.mockResolvedValue({ id: 'ws-durable', path: dir, title: '已注册' })

    const removed = await removeWorkspaces(ledger, registry, dir)
    expect(removed).toHaveLength(1)
    expect(removed[0]).toMatchObject({ workspaceId: 'ws-durable', path: dir, title: '已注册', sessionId: '' })
    expect(registry.delete).toHaveBeenCalledWith('ws-durable')
  })

  it('deletes a bare host workspace id when the ledger misses', async () => {
    const ledger = new WorkspaceLedger()
    const registry = fakeRegistry()
    registry.delete.mockResolvedValue(true)

    const removed = await removeWorkspaces(ledger, registry, 'ws-orphan')
    expect(removed).toHaveLength(1)
    expect(registry.delete).toHaveBeenCalledWith('ws-orphan')
  })

  it('toWorkspaceViews shapes records for the wire', async () => {
    const ledger = new WorkspaceLedger()
    const dir = join(base, 'target')
    await mkdir(dir)
    const record = ledger.register('s1', dir, 'ws-3', '视图')
    const views = toWorkspaceViews([record])
    expect(views[0]).toEqual({
      id: record.id,
      workspaceId: 'ws-3',
      path: dir,
      title: '视图',
      sessionId: 's1',
      createdAt: record.createdAt,
      status: 'active',
    })
  })
})
