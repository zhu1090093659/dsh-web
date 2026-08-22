/**
 * Journal append/replay and lock manager behavior.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryFs, nodeFs, type FsLike } from '../src/core/fs.ts'
import { createJournal } from '../src/core/journal.ts'
import { createLockManager, LockError } from '../src/core/lock.ts'

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function makeJournal() {
  const fs = createMemoryFs()
  await fs.mkdir('/h/.dsh-doctor', { recursive: true })
  const journal = createJournal({ fs, file: '/h/.dsh-doctor/journal.jsonl', now: () => '2026-08-21T23:00:00.000Z' })
  return { fs, journal }
}

describe('journal', () => {
  it('appends incrementing sequence entries and replays in order', async () => {
    const { fs, journal } = await makeJournal()
    const one = await journal.append({ op: 'stage', ok: true, detail: { a: 1 } })
    const two = await journal.append({ op: 'promote', ok: true })
    expect(one.seq).toBe(1)
    expect(two.seq).toBe(2)
    const { entries, corrupted } = await journal.replay()
    expect(corrupted).toBe(0)
    expect(entries.map((entry) => entry.op)).toEqual(['stage', 'promote'])
  })

  it('tolerates corrupt lines and keeps counting', async () => {
    const { fs, journal } = await makeJournal()
    await journal.append({ op: 'ok-one', ok: true })
    await fs.writeText('/h/.dsh-doctor/journal.jsonl', (await fs.readText('/h/.dsh-doctor/journal.jsonl')) + 'not json\n')
    await journal.append({ op: 'ok-two', ok: true })
    const { entries, corrupted } = await journal.replay()
    expect(corrupted).toBe(1)
    expect(entries.length).toBe(2)
  })
})

describe('lock manager', () => {
  it('acquires and releases a profile lock', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h', { recursive: true })
    const manager = createLockManager({ fs, home: '/h', pid: 10, clock: () => 1000, iso: () => '2026-08-21T23:00:00.000Z' })
    const handle = await manager.acquire('profile', 'web', { intent: 'repair' })
    expect(handle.path).toContain('web')
    const state = await manager.status('profile', 'web')
    expect(state.held).toBe(true)
    expect(state.token?.pid).toBe(10)
    await handle.release()
    expect((await manager.status('profile', 'web')).held).toBe(false)
  })

  it('separates global and profile locks', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h', { recursive: true })
    const manager = createLockManager({ fs, home: '/h', pid: 1, clock: () => 1000, iso: () => 'x' })
    const a = await manager.acquire('global', undefined, { intent: 'x' })
    const b = await manager.acquire('profile', 'web', { intent: 'y' })
    expect(a.path).not.toBe(b.path)
    await a.release()
    await b.release()
  })

  it('publishes a fully initialized lock atomically when two acquirers race', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-'))
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'global')
      const firstClaimReady = deferred()
      const releaseFirstClaim = deferred()
      const firstObservedWinner = deferred()
      const originalExists = nodeFs.exists.bind(nodeFs)
      const originalRename = nodeFs.rename.bind(nodeFs)
      let firstRenameBlocked = false
      let firstRenameReleased = false
      const racingFs: FsLike = {
        ...nodeFs,
        async exists(path) {
          const exists = await originalExists(path)
          if (firstRenameReleased && path === lockPath && exists) firstObservedWinner.resolve()
          return exists
        },
        async rename(from, to) {
          if (!firstRenameBlocked && to === lockPath && from.startsWith(lockPath + '.claim-')) {
            firstRenameBlocked = true
            firstClaimReady.resolve()
            await releaseFirstClaim.promise
            firstRenameReleased = true
          }
          await originalRename(from, to)
        },
      }
      const firstManager = createLockManager({ fs: racingFs, home, pid: 11, clock: Date.now, iso: () => 'first', pidAlive: () => true })
      const secondManager = createLockManager({ fs: racingFs, home, pid: 12, clock: Date.now, iso: () => 'second', pidAlive: () => true })
      let firstSettled = false
      const first = firstManager.acquire('global', undefined, { intent: 'first' }).then((handle) => {
        firstSettled = true
        return handle
      })
      await firstClaimReady.promise

      const second = await secondManager.acquire('global', undefined, { intent: 'second' })
      expect((await secondManager.status('global', undefined)).token).toMatchObject({ pid: 12, intent: 'second' })
      releaseFirstClaim.resolve()
      await firstObservedWinner.promise
      expect(firstSettled).toBe(false)

      await second.release()
      const firstHandle = await first
      expect((await firstManager.status('global', undefined)).token).toMatchObject({ pid: 11, intent: 'first' })
      await firstHandle.release()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('times out with LOCK_HELD when a live pid holds the lock', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h', { recursive: true })
    let clock = 1000
    const manager = createLockManager({
      fs,
      home: '/h',
      pid: 1,
      clock: () => clock,
      iso: () => 'x',
      pidAlive: () => true,
      sleep: async () => { clock += 200 },
    })
    const held = await manager.acquire('profile', 'web', { intent: 'first' })
    await expect(manager.acquire('profile', 'web', { intent: 'second', timeoutMs: 500 })).rejects.toMatchObject({ code: 'LOCK_HELD' })
    await held.release()
  })

  it('steals a stale lock left by a dead pid', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h/.dsh-doctor/locks', { recursive: true })
    await fs.mkdir('/h/.dsh-doctor/locks/profile__web')
    const token = JSON.stringify({ pid: 999, host: 'h', intent: 'dead', startedAt: 'x', heartbeatAt: 5000, nonce: 'n' })
    await fs.writeText('/h/.dsh-doctor/locks/profile__web/token.json', token)
    const manager = createLockManager({ fs, home: '/h', pid: 3, clock: () => 9000, iso: () => 'y', pidAlive: () => false })
    const gained = await manager.acquire('profile', 'web', { intent: 'recovery' })
    const state = await manager.status('profile', 'web')
    expect(state.token?.pid).toBe(3)
    await gained.release()
  })

  it('reports a clean status for absent locks', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h', { recursive: true })
    const manager = createLockManager({ fs, home: '/h', pid: 1, clock: () => 1, iso: () => 'x' })
    const state = await manager.status('profile', 'web')
    expect(state.held).toBe(false)
  })

  it('wraps unrecoverable acquire failures in LOCK_ERROR', async () => {
    const fs = createMemoryFs()
    await fs.mkdir('/h', { recursive: true })
    await fs.writeText('/h/.dsh-doctor', 'file-blocking-dir')
    const manager = createLockManager({ fs, home: '/h', pid: 1, clock: () => 1, iso: () => 'x', sleep: async () => {} })
    await expect(manager.acquire('global', undefined, { intent: 'x', timeoutMs: 50 })).rejects.toMatchObject({ code: 'LOCK_ERROR' })
  })

  it('exposes LockError with a stable code', () => {
    expect(() => { throw new LockError('LOCK_HELD', 'profile', 'web', 'held') }).toThrowError(/held/)
  })
})
