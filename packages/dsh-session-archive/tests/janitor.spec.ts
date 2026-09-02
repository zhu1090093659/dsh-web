// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArchiveService, BusyError, PlanMismatchError } from '../src/host/janitor.ts'
import { writeJsonAtomic } from '../src/host/ledger.ts'
import { fakeContext, writeProjcache, type FakeHost } from './fixtures.ts'
import { createFakeHost } from './fixtures.ts'

function makeService(host: FakeHost, config: Record<string, unknown> = {}): ArchiveService {
  const service = new ArchiveService(fakeContext(host) as never, { dshHome: host.home })
  service.applyConfig({ enabled: true, ...config })
  return service
}

function writeSessionDir(host: FakeHost, id: string, size = 64): string {
  const project = join(host.home, 'sessions', '--Users-demo--')
  mkdirSync(project, { recursive: true })
  const dir = join(project, id.startsWith('session-') ? id.slice('session-'.length) : id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.jsonl.zstd'), Buffer.alloc(size, 5))
  return dir
}

/** Seed the on-disk ledger BEFORE the service starts (it loads once). */
async function seedLedger(host: FakeHost, entries: Record<string, { archivedAt: number; source: 'manual' | 'auto' }>): Promise<void> {
  await writeJsonAtomic(join(host.home, 'dsh-session-archive', 'archive-ledger.json'), { version: 1, entries })
}

async function settledService(host: FakeHost, config?: Record<string, unknown>): Promise<ArchiveService> {
  const service = makeService(host, config)
  await service.start()
  return service
}

describe('archive / unarchive ledger', () => {
  it('records a reliable archive time and is idempotent on re-archive', async () => {
    const host = createFakeHost({ feedItems: [{ sessionId: 'session-a', updatedAt: 1 }], persistedIds: ['session-a'] })
    const service = await settledService(host)
    const first = await service.archive(['session-a'], 'manual')
    expect(first.results).toEqual([{ id: 'session-a', status: 'ok' }])
    const at1 = service.ledgerSnapshot().entries['session-a']?.archivedAt
    expect(at1).toBeGreaterThan(0)

    const second = await service.archive(['session-a'], 'manual')
    expect(second.results).toEqual([{ id: 'session-a', status: 'skipped', reason: 'already-archived' }])
    expect(service.ledgerSnapshot().entries['session-a']?.archivedAt).toBe(at1)
    expect(host.registry.archivedSessionIds).toEqual(['session-a'])
  })

  it('drops the ledger entry on unarchive, so a re-archive restarts the clock', async () => {
    const host = createFakeHost({ feedItems: [{ sessionId: 'session-a', updatedAt: 1 }], persistedIds: ['session-a'] })
    const service = await settledService(host)
    await service.archive(['session-a'], 'auto')
    expect(service.ledgerSnapshot().entries['session-a']).toBeDefined()

    const response = await service.unarchive(['session-a'])
    expect(response.results).toEqual([{ id: 'session-a', status: 'ok' }])
    expect(host.registry.archivedSessionIds).toEqual([])
    expect(service.ledgerSnapshot().entries['session-a']).toBeUndefined()

    const again = await service.archive(['session-a'], 'manual')
    expect(again.results).toEqual([{ id: 'session-a', status: 'ok' }])
    expect(service.ledgerSnapshot().entries['session-a']?.archivedAt).toBeGreaterThanOrEqual(0)
  })

  it('skips unarchive for sessions not archived', async () => {
    const host = createFakeHost({ feedItems: [{ sessionId: 'session-a', updatedAt: 1 }] })
    const service = await settledService(host)
    const response = await service.unarchive(['session-a'])
    expect(response.results).toEqual([{ id: 'session-a', status: 'skipped', reason: 'not-archived' }])
  })
})

describe('physical delete', () => {
  it('removes the directory, archive marker, workspace row, projcache entry, and ledger entry', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-del', updatedAt: 10, cwd: '/Users/demo' }],
      workspaces: [{ id: 'ws-1', path: '/Users/demo', title: 'Demo', sessionIds: ['session-del'] }],
      archivedSessionIds: ['session-del'],
      persistedIds: ['session-del'],
    })
    const dir = writeSessionDir(host, 'session-del')
    writeProjcache(host.home, { 'session-del': { title: 'Doomed', createdAt: 5 } })
    await seedLedger(host, { 'session-del': { archivedAt: 123, source: 'manual' } })
    const service = await settledService(host)

    const response = await service.deleteSessions(['session-del'], { expectedTotal: 1 })
    expect(response.results).toEqual([{ id: 'session-del', status: 'ok' }])
    expect(response.freedBytes).toBe(64)
    expect(existsSync(dir)).toBe(false)
    expect(host.registry.archivedSessionIds).toEqual([])
    expect(host.registry.workspaces[0]?.sessionIds).toEqual([])
    const projcache = JSON.parse((await import('node:fs')).readFileSync(join(host.home, 'storages', 'session_projcache.json'), 'utf8'))
    expect(projcache.tables.sessions['session-del']).toBeUndefined()
    expect(service.ledgerSnapshot().entries['session-del']).toBeUndefined()
  })

  it('deletes the whole family when the parent is targeted, cascading to sub-sessions', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-p', updatedAt: 10 },
        { sessionId: 'session-c', updatedAt: 9, parentSessionId: 'session-p' },
      ],
      persistedIds: ['session-p', 'session-c'],
    })
    const parentDir = writeSessionDir(host, 'session-p')
    const childDir = writeSessionDir(host, 'session-c')
    const service = await settledService(host)
    const response = await service.deleteSessions(['session-p'])
    expect(response.results.map((entry) => entry.id).sort()).toEqual(['session-c', 'session-p'])
    expect(existsSync(parentDir)).toBe(false)
    expect(existsSync(childDir)).toBe(false)
  })

  it('skips running sessions with a reason', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-run', updatedAt: 10, running: true }, { sessionId: 'session-ok', updatedAt: 9 }],
      persistedIds: ['session-run', 'session-ok'],
    })
    writeSessionDir(host, 'session-run')
    const dirOk = writeSessionDir(host, 'session-ok')
    const service = await settledService(host)
    const response = await service.deleteSessions(['session-run', 'session-ok'])
    const byId = new Map(response.results.map((entry) => [entry.id, entry]))
    expect(byId.get('session-run')?.status).toBe('skipped')
    expect(byId.get('session-run')?.reason).toBe('running')
    expect(byId.get('session-ok')?.status).toBe('ok')
    expect(existsSync(dirOk)).toBe(false)
  })

  it('protects the client-declared current session', async () => {
    const host = createFakeHost({ feedItems: [{ sessionId: 'session-cur', updatedAt: 10 }], persistedIds: ['session-cur'] })
    writeSessionDir(host, 'session-cur')
    const service = await settledService(host)
    const response = await service.deleteSessions(['session-cur'], { currentSessionId: 'session-cur' })
    expect(response.results).toEqual([{ id: 'session-cur', status: 'skipped', reason: 'current' }])
  })

  it('protects live (in-use) sessions even when the feed shows them idle', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-live', updatedAt: 10, running: false }],
      persistedIds: ['session-live'],
      liveIds: ['session-live'],
    })
    writeSessionDir(host, 'session-live')
    const service = await settledService(host)
    const response = await service.deleteSessions(['session-live'])
    expect(response.results[0]?.status).toBe('skipped')
    expect(response.results[0]?.reason).toBe('attached')
  })

  it('skips the entire family when a descendant is running (no half-deleted families)', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-p', updatedAt: 10 },
        { sessionId: 'session-c', updatedAt: 9, parentSessionId: 'session-p', running: true },
      ],
      persistedIds: ['session-p', 'session-c'],
    })
    const parentDir = writeSessionDir(host, 'session-p')
    const childDir = writeSessionDir(host, 'session-c')
    const service = await settledService(host)
    const response = await service.deleteSessions(['session-p'])
    for (const entry of response.results) {
      expect(entry.status).toBe('skipped')
      expect(entry.reason).toBe('family-protected')
    }
    expect(existsSync(parentDir)).toBe(true)
    expect(existsSync(childDir)).toBe(true)
  })

  it('aborts with a plan mismatch when the confirmed total disagrees', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-p', updatedAt: 10 },
        { sessionId: 'session-c', updatedAt: 9, parentSessionId: 'session-p' },
      ],
      persistedIds: ['session-p', 'session-c'],
    })
    writeSessionDir(host, 'session-p')
    writeSessionDir(host, 'session-c')
    const service = await settledService(host)
    await expect(service.deleteSessions(['session-p'], { expectedTotal: 1 })).rejects.toBeInstanceOf(PlanMismatchError)
    // Nothing was deleted.
    expect(host.registry.archivedSessionIds).toEqual([])
  })

  it('keeps succeeded entries successful when a sibling fails (partial failure)', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-a', updatedAt: 10 }, { sessionId: 'session-b', updatedAt: 9 }],
      persistedIds: ['session-a', 'session-b'],
    })
    writeSessionDir(host, 'session-a')
    const dirB = writeSessionDir(host, 'session-b')
    // Make b's dir undeletable: replace it with a file that fails rm -rf of a dir? Instead make b's storage a symlink escape.
    const { symlinkSync, rmSync } = await import('node:fs')
    rmSync(dirB, { recursive: true })
    const outside = mkdtempSync(join(tmpdir(), 'dsh-session-archive-outside-'))
    symlinkSync(outside, dirB)

    const service = await settledService(host)
    const response = await service.deleteSessions(['session-a', 'session-b'])
    const byId = new Map(response.results.map((entry) => [entry.id, entry]))
    expect(byId.get('session-a')?.status).toBe('ok')
    expect(byId.get('session-b')?.status).toBe('failed')
    expect(existsSync(join(host.home, 'sessions'))).toBe(true)
  })
})

describe('operation lock', () => {
  it('rejects concurrent mutating operations with BusyError', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-a', updatedAt: 1 }, { sessionId: 'session-b', updatedAt: 2 }],
      persistedIds: ['session-a', 'session-b'],
    })
    const service = await settledService(host)
    // withLock takes the flag synchronously, so the second call fails fast
    // while the first is still in flight.
    const first = service.archive(['session-a'], 'manual')
    await expect(service.archive(['session-b'], 'manual')).rejects.toBeInstanceOf(BusyError)
    await first
    // After the first completes, the lock is free again.
    const second = await service.archive(['session-b'], 'manual')
    expect(second.results).toEqual([{ id: 'session-b', status: 'ok' }])
  })
})

describe('automatic cycles', () => {
  const DAY = 86_400_000

  it('auto-archives by last activity and skips running/current sessions', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-stale', updatedAt: Date.now() - 40 * DAY },
        { sessionId: 'session-run', updatedAt: Date.now() - 40 * DAY, running: true },
        { sessionId: 'session-fresh', updatedAt: Date.now() - 1 * DAY },
      ],
      persistedIds: ['session-stale', 'session-run', 'session-fresh'],
    })
    const service = await settledService(host, { autoArchiveEnabled: true, autoArchiveDays: 30 })
    const stats = await service.runAutoCycle('archive', 'session-fresh')
    expect(stats.ok).toBe(1)
    expect(host.registry.archivedSessionIds).toEqual(['session-stale'])
    expect(service.ledgerSnapshot().entries['session-stale']?.source).toBe('auto')
  })

  it('auto-deletes only expired known-time archives and never a session archived in the same cycle', async () => {
    const now = Date.now()
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-expired', updatedAt: now - 10 * DAY },
        { sessionId: 'session-justarchived', updatedAt: now - 10 * DAY },
        { sessionId: 'session-unknown', updatedAt: now - 10 * DAY },
      ],
      persistedIds: ['session-expired', 'session-justarchived', 'session-unknown'],
      archivedSessionIds: ['session-expired', 'session-justarchived', 'session-unknown'],
    })
    const dir = writeSessionDir(host, 'session-expired')
    writeSessionDir(host, 'session-justarchived')
    // Seed BEFORE the service starts: the ledger loads once at boot.
    await seedLedger(host, {
      'session-expired': { archivedAt: now - 10 * DAY, source: 'manual' },
      'session-justarchived': { archivedAt: now, source: 'auto' },
    })
    const service = await settledService(host, { autoDeleteEnabled: true, autoDeleteDays: 7 })
    // session-unknown has NO ledger entry (historical, unknown archive time).

    const stats = await service.runAutoCycle('delete')
    expect(stats.ok).toBe(1)
    expect(existsSync(dir)).toBe(false)
    // Unknown archive time survives auto-delete.
    expect(host.registry.archivedSessionIds.sort()).toEqual(['session-justarchived', 'session-unknown'])
  })

  it('preview counts candidates without modifying anything', async () => {
    const now = Date.now()
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-stale', updatedAt: now - 40 * DAY }],
      persistedIds: ['session-stale'],
    })
    const service = await settledService(host, { autoArchiveEnabled: true, autoArchiveDays: 30, autoDeleteEnabled: true })
    const preview = await service.autoPreview()
    expect(preview.archiveCandidates.map((entry) => entry.id)).toEqual(['session-stale'])
    expect(preview.deleteCandidates).toEqual([])
    expect(host.registry.archivedSessionIds).toEqual([])
  })

  it('auto-delete honors family protection', async () => {
    const now = Date.now()
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-p', updatedAt: now - 10 * DAY },
        { sessionId: 'session-c', updatedAt: now - 10 * DAY, parentSessionId: 'session-p', running: true },
      ],
      persistedIds: ['session-p', 'session-c'],
      archivedSessionIds: ['session-p'],
    })
    writeSessionDir(host, 'session-p')
    await seedLedger(host, { 'session-p': { archivedAt: now - 10 * DAY, source: 'manual' } })
    const service = await settledService(host, { autoDeleteEnabled: true, autoDeleteDays: 7 })
    const stats = await service.runAutoCycle('delete')
    expect(stats.ok).toBe(0)
    expect(stats.skipped).toBeGreaterThanOrEqual(2)
  })
})

describe('preview', () => {
  it('returns basic info plus a tolerant message excerpt and survives inspect failures', async () => {
    const host = createFakeHost({
      feedItems: [{ sessionId: 'session-a', updatedAt: 777, cwd: '/x' }, { sessionId: 'session-broken', updatedAt: 1 }],
      persistedIds: ['session-a', 'session-broken'],
      brokenIds: ['session-broken'],
    })
    writeSessionDir(host, 'session-a', 256)
    const service = await settledService(host)
    const preview = await service.preview('session-a')
    expect(preview.id).toBe('session-a')
    expect(preview.messageCount).toBe(2)
    expect(preview.excerpt).toEqual([
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'world' },
    ])
    const broken = await service.preview('session-broken')
    expect(broken.messageCount).toBe(0)
    await expect(service.preview('session-missing')).rejects.toThrow('session not found')
  })
})
