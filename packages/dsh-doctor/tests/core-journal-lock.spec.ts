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
    await handle.touch(2000)
    expect((await manager.status('profile', 'web')).token?.heartbeatAt).toBe(2000)
    await handle.release()
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

  it('heartbeats a lock held longer than its stale lease', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-heartbeat-'))
    try {
      let clock = 1_000
      const firstManager = createLockManager({ fs: nodeFs, home, pid: 51, clock: () => clock, iso: () => 'first', pidAlive: () => true })
      const first = await firstManager.acquire('global', undefined, { intent: 'long repair', staleMs: 150 })
      const initialHeartbeat = (await firstManager.status('global', undefined)).token?.heartbeatAt

      clock = 20_000
      let refreshedHeartbeat = initialHeartbeat
      for (let attempt = 0; attempt < 100 && refreshedHeartbeat !== clock; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        refreshedHeartbeat = (await firstManager.status('global', undefined)).token?.heartbeatAt
      }
      expect(refreshedHeartbeat).toBe(clock)

      const secondManager = createLockManager({ fs: nodeFs, home, pid: 52, clock: () => clock, iso: () => 'second', pidAlive: () => true })
      await expect(secondManager.acquire('global', undefined, {
        intent: 'second repair',
        staleMs: 150,
        timeoutMs: 0,
      })).rejects.toMatchObject({ code: 'LOCK_HELD' })

      await first.release()
      const releasedTokenPath = join(home, '.dsh-doctor', 'locks', 'global', 'token.json')
      const releasedToken = await nodeFs.readText(releasedTokenPath)
      await new Promise<void>((resolve) => setTimeout(resolve, 80))
      expect(await nodeFs.readText(releasedTokenPath)).toBe(releasedToken)
      const second = await secondManager.acquire('global', undefined, { intent: 'second repair', staleMs: 150 })
      expect((await secondManager.status('global', undefined)).token).toMatchObject({ pid: 52 })
      await second.release()
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('fails closed after an automatic heartbeat cannot be persisted', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-heartbeat-failure-'))
    const heartbeatAttempted = deferred()
    try {
      const originalWriteText = nodeFs.writeText.bind(nodeFs)
      const failingFs: FsLike = {
        ...nodeFs,
        async writeText(path, text) {
          if (path.includes('.touch-')) {
            heartbeatAttempted.resolve()
            const error = new Error('injected heartbeat write failure') as Error & { code: string }
            error.code = 'EACCES'
            throw error
          }
          await originalWriteText(path, text)
        },
      }
      const manager = createLockManager({ fs: failingFs, home, pid: 61, clock: Date.now, iso: () => 'owner', pidAlive: () => true })
      const handle = await manager.acquire('global', undefined, { intent: 'repair', staleMs: 150 })

      await Promise.race([
        heartbeatAttempted.promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('heartbeat did not run')), 1_000)),
      ])
      await new Promise<void>((resolve) => setTimeout(resolve, 10))

      await expect(handle.touch(Date.now())).rejects.toMatchObject({ code: 'LOCK_ERROR' })
      await expect(handle.release()).rejects.toMatchObject({ code: 'LOCK_ERROR' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
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

  it('prevents a stale owner from touching or releasing a replacement lock', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-owner-'))
    try {
      let clock = 1000
      const firstManager = createLockManager({ fs: nodeFs, home, pid: 11, clock: () => clock, iso: () => 'first', pidAlive: () => true })
      const first = await firstManager.acquire('profile', 'web', { intent: 'first' })
      clock = 20_000
      const secondManager = createLockManager({ fs: nodeFs, home, pid: 12, clock: () => clock, iso: () => 'second', pidAlive: (pid) => pid === 12 })
      const second = await secondManager.acquire('profile', 'web', { intent: 'second' })
      const replacement = (await secondManager.status('profile', 'web')).token
      expect(replacement).toMatchObject({ pid: 12, intent: 'second' })
      expect((await nodeFs.readdir(join(home, '.dsh-doctor', 'locks'))).some((entry) => entry.name.includes('.stale-'))).toBe(false)

      await expect(first.touch(clock + 1)).rejects.toMatchObject({ code: 'LOCK_LOST' })
      expect((await secondManager.status('profile', 'web')).token).toEqual(replacement)
      await expect(first.release()).rejects.toMatchObject({ code: 'LOCK_LOST' })
      expect((await secondManager.status('profile', 'web')).token).toEqual(replacement)

      await second.release()
      expect((await secondManager.status('profile', 'web')).held).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('does not treat a malformed owner token as a missing stale lease', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-malformed-'))
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'profile__web')
      const tokenPath = join(lockPath, 'token.json')
      await nodeFs.mkdir(lockPath, { recursive: true })
      await nodeFs.writeText(tokenPath, '{broken')
      const manager = createLockManager({ fs: nodeFs, home, pid: 62, clock: () => 20_000, iso: () => 'second', pidAlive: () => false })

      await expect(manager.acquire('profile', 'web', { intent: 'second', timeoutMs: 0 })).rejects.toMatchObject({ code: 'LOCK_ERROR' })

      expect(await nodeFs.readText(tokenPath)).toBe('{broken')
      expect((await nodeFs.readdir(join(home, '.dsh-doctor', 'locks'))).some((entry) => entry.name.includes('.stale-'))).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('does not delete a replacement that takes over during release', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-release-race-'))
    const releasePublishReady = deferred()
    const continueRelease = deferred()
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'profile__web')
      const tokenPath = join(lockPath, 'token.json')
      const originalRename = nodeFs.rename.bind(nodeFs)
      const releasingFs: FsLike = {
        ...nodeFs,
        async rename(from, to) {
          if (to === tokenPath && from.includes('.release-')) {
            releasePublishReady.resolve()
            await continueRelease.promise
          }
          await originalRename(from, to)
        },
      }
      let clock = 1000
      const firstManager = createLockManager({ fs: releasingFs, home, pid: 31, clock: () => clock, iso: () => 'first', pidAlive: () => true })
      const first = await firstManager.acquire('profile', 'web', { intent: 'first' })
      const releasing = first.release()
      await releasePublishReady.promise

      clock = 20_000
      const secondManager = createLockManager({ fs: nodeFs, home, pid: 32, clock: () => clock, iso: () => 'second', pidAlive: (pid) => pid === 32 })
      const second = await secondManager.acquire('profile', 'web', { intent: 'second' })
      const replacement = (await secondManager.status('profile', 'web')).token
      expect(replacement).toMatchObject({ pid: 32, intent: 'second' })

      continueRelease.resolve()
      await expect(releasing).rejects.toMatchObject({ code: 'LOCK_LOST' })
      expect((await secondManager.status('profile', 'web')).token).toEqual(replacement)
      await second.release()
    } finally {
      continueRelease.resolve()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('does not steal when the observed owner refreshes before takeover', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-refresh-'))
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'profile__web')
      const tokenPath = join(lockPath, 'token.json')
      const staleToken = { pid: 21, host: 'local', intent: 'first', startedAt: 'first', heartbeatAt: 1000, nonce: 'same-owner' }
      await nodeFs.mkdir(lockPath, { recursive: true })
      await nodeFs.writeText(tokenPath, JSON.stringify(staleToken) + '\n')

      const originalReadText = nodeFs.readText.bind(nodeFs)
      const originalRename = nodeFs.rename.bind(nodeFs)
      let tokenReads = 0
      let takeoverRenames = 0
      const refreshedHeartbeat = 20_000
      const refreshingFs: FsLike = {
        ...nodeFs,
        async readText(path) {
          if (path === tokenPath) {
            tokenReads += 1
            if (tokenReads === 2) {
              await nodeFs.writeText(tokenPath, JSON.stringify({ ...staleToken, heartbeatAt: refreshedHeartbeat }) + '\n')
            }
          }
          return await originalReadText(path)
        },
        async rename(from, to) {
          if (from === lockPath && to.startsWith(lockPath + '.stale-')) takeoverRenames += 1
          await originalRename(from, to)
        },
      }
      const manager = createLockManager({ fs: refreshingFs, home, pid: 22, clock: () => refreshedHeartbeat, iso: () => 'second', pidAlive: () => true })

      await expect(manager.acquire('profile', 'web', { intent: 'second', staleMs: 1000, timeoutMs: 0 })).rejects.toMatchObject({ code: 'LOCK_HELD' })
      expect(takeoverRenames).toBe(0)
      expect((await manager.status('profile', 'web')).token).toEqual({ ...staleToken, heartbeatAt: refreshedHeartbeat })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('restores an owner that refreshes after the final stale check', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-refresh-race-'))
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'profile__web')
      const tokenPath = join(lockPath, 'token.json')
      const staleToken = { pid: 41, host: 'local', intent: 'first', startedAt: 'first', heartbeatAt: 1000, nonce: 'same-owner' }
      const refreshedHeartbeat = 20_000
      await nodeFs.mkdir(lockPath, { recursive: true })
      await nodeFs.writeText(tokenPath, JSON.stringify(staleToken) + '\n')

      const originalRename = nodeFs.rename.bind(nodeFs)
      let refreshedDuringRename = false
      const refreshingFs: FsLike = {
        ...nodeFs,
        async rename(from, to) {
          if (!refreshedDuringRename && from === lockPath && to.startsWith(lockPath + '.stale-')) {
            refreshedDuringRename = true
            await nodeFs.writeText(tokenPath, JSON.stringify({ ...staleToken, heartbeatAt: refreshedHeartbeat }) + '\n')
          }
          await originalRename(from, to)
        },
      }
      const manager = createLockManager({ fs: refreshingFs, home, pid: 42, clock: () => refreshedHeartbeat, iso: () => 'second', pidAlive: () => true })

      await expect(manager.acquire('profile', 'web', { intent: 'second', staleMs: 1000, timeoutMs: 0 })).rejects.toMatchObject({ code: 'LOCK_HELD' })
      expect(refreshedDuringRename).toBe(true)
      expect((await manager.status('profile', 'web')).token).toEqual({ ...staleToken, heartbeatAt: refreshedHeartbeat })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('restores a displaced owner when its token cannot be revalidated', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-displaced-read-'))
    try {
      const lockPath = join(home, '.dsh-doctor', 'locks', 'profile__web')
      const tokenPath = join(lockPath, 'token.json')
      const staleToken = { pid: 71, host: 'local', intent: 'first', startedAt: 'first', heartbeatAt: 1_000, nonce: 'first-owner' }
      await nodeFs.mkdir(lockPath, { recursive: true })
      await nodeFs.writeText(tokenPath, JSON.stringify(staleToken) + '\n')
      const originalReadText = nodeFs.readText.bind(nodeFs)
      const originalRename = nodeFs.rename.bind(nodeFs)
      let replacementClaims = 0
      const unreadableFs: FsLike = {
        ...nodeFs,
        async readText(path) {
          if (path.startsWith(lockPath + '.stale-') && path.endsWith('token.json')) {
            const error = new Error('injected displaced token read failure') as Error & { code: string }
            error.code = 'EIO'
            throw error
          }
          return await originalReadText(path)
        },
        async rename(from, to) {
          if (to === lockPath && from.startsWith(lockPath + '.claim-')) replacementClaims += 1
          await originalRename(from, to)
        },
      }
      const manager = createLockManager({ fs: unreadableFs, home, pid: 72, clock: () => 20_000, iso: () => 'second', pidAlive: () => false })

      await expect(manager.acquire('profile', 'web', { intent: 'second', staleMs: 1_000, timeoutMs: 0 })).rejects.toMatchObject({ code: 'LOCK_STALE' })

      expect(replacementClaims).toBe(0)
      expect(JSON.parse(await nodeFs.readText(tokenPath))).toEqual(staleToken)
      expect((await nodeFs.readdir(join(home, '.dsh-doctor', 'locks'))).some((entry) => entry.name.includes('.stale-'))).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('reports a clean status for absent locks', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-doctor-lock-status-'))
    try {
      const manager = createLockManager({ fs: nodeFs, home, pid: 1, clock: () => 1, iso: () => 'x' })
      const state = await manager.status('profile', 'web')
      expect(state.held).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
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
