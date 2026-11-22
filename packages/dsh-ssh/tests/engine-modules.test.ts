/**
 * Unit tests for the extracted engine modules (connection-pool, pty, sftp,
 * tunnel, cluster), exercised through mock/stand-in engine objects so no
 * real SSH server is needed here. The full end-to-end behaviour stays
 * covered by tests/engine.test.ts against the embedded ssh2 server.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { describe, expect, it, vi } from 'vitest'
import type { Client, SFTPWrapper } from 'ssh2'
import { appendOutput, disposeRecord, sweepPool, DEFAULTS, type PoolEngine, type PoolRecord } from '../src/engine/connection-pool.ts'
import { openShell } from '../src/engine/pty.ts'
import { ensureRemoteDir, fastTransfer, walkLocalDir, upload } from '../src/engine/sftp.ts'
import type { TransferProgress } from '../src/protocol.ts'
import { listTunnels, stopAllTunnels, type TunnelEngine, type TunnelRecord } from '../src/engine/tunnel.ts'
import { cluster } from '../src/engine/cluster.ts'
import type { HostStore } from '../src/store.ts'

function fakeClient(): { client: Client; end: ReturnType<typeof vi.fn> } {
  const end = vi.fn()
  const client = { end } as unknown as Client
  return { client, end }
}

function fakeRecord(client: Client, overrides: Partial<PoolRecord> = {}): PoolRecord {
  return { client, hops: [], idleAt: 0, pinned: false, broken: false, inFlight: 0, ...overrides }
}

/** A bare PoolEngine whose store.list() is controlled by the caller. */
function fakeEngine(entries: unknown[] = []): PoolEngine {
  return {
    store: { list: () => entries, find: () => undefined } as unknown as HostStore,
    opts: { ...DEFAULTS },
    pool: new Map<string, PoolRecord>(),
    acquireQueue: new Map<string, Promise<PoolRecord>>(),
  }
}

/** PoolEngine widened to the tunnel registry surface. */
function fakeTunnelEngine(entries: unknown[] = []): TunnelEngine {
  return {
    ...fakeEngine(entries),
    tunnels: new Map<string, TunnelRecord>(),
    nextTunnelId: 1,
  }
}

describe('connection-pool', () => {
  it('appendOutput caps bytes and never splits a surrogate pair', () => {
    const target = { text: '', truncated: false }
    appendOutput(target, Buffer.from('hello'), 3)
    expect(target.text).toBe('hel…[output truncated]')
    expect(target.truncated).toBe(true)
    // Already truncated: a later chunk is ignored.
    appendOutput(target, Buffer.from('world'), 3)
    expect(target.text).toBe('hel…[output truncated]')
  })

  it('operator sees split multi-byte UTF-8 chunks decoded intact and bounded by UTF-8 byte length', () => {
    // Given a Chinese character split across two Buffer chunks and a 4-byte cap
    const full = Buffer.from('中文', 'utf8')
    const part1 = full.subarray(0, 2)
    const part2 = full.subarray(2, 3)
    const part3 = full.subarray(3)
    const target = { text: '', truncated: false, bytes: 0 }
    const decoder = new StringDecoder('utf8')

    // When the split chunks arrive and exceed the 4-byte cap on the second character
    appendOutput(target, part1, 4, decoder)
    appendOutput(target, part2, 4, decoder)
    expect(target.text).toBe('中')
    expect(target.truncated).toBe(false)
    appendOutput(target, part3, 4, decoder)

    // Then the first character decoded intact and the second was truncated cleanly by byte budget
    expect(target.text).toBe('中…[output truncated]')
    expect(target.truncated).toBe(true)
  })

  it('sweepPool disposes only idle, unpinned, unused records', () => {
    const engine = fakeEngine()
    const busy = fakeClient().client
    const pinned = fakeClient().client
    const stale = fakeClient().client
    engine.pool.set('busy', fakeRecord(busy, { idleAt: 0, inFlight: 1 }))
    engine.pool.set('pinned', fakeRecord(pinned, { idleAt: 0, pinned: true }))
    engine.pool.set('stale', fakeRecord(stale, { idleAt: 0 }))
    sweepPool(engine)
    expect(engine.pool.has('busy')).toBe(true)
    expect(engine.pool.has('pinned')).toBe(true)
    expect(engine.pool.has('stale')).toBe(false)
  })

  it('disposeRecord ends the target and every hop client', () => {
    const engine = fakeEngine()
    const target = fakeClient()
    const hop = fakeClient()
    engine.pool.set('a', fakeRecord(target.client, { hops: [hop.client] }))
    disposeRecord(engine, 'a')
    expect(target.end).toHaveBeenCalledTimes(1)
    expect(hop.end).toHaveBeenCalledTimes(1)
    expect(engine.pool.has('a')).toBe(false)
    // A stale record that is no longer the current one must not touch it.
    const fresh = fakeClient()
    engine.pool.set('b', fakeRecord(fresh.client))
    const ghost = fakeRecord(fresh.client)
    disposeRecord(engine, 'b', ghost)
    expect(fresh.end).not.toHaveBeenCalled()
  })
})

describe('pty', () => {
  it('openShell rejects an unknown alias before any connection', async () => {
    const engine = fakeEngine()
    await expect(openShell(engine, 'nope', { cols: 80, rows: 24 })).rejects.toThrow(/not found/)
  })
})

describe('sftp', () => {
  it('walkLocalDir collects every file recursively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-sftp-walk-'))
    try {
      mkdirSync(join(dir, 'a', 'b'), { recursive: true })
      writeFileSync(join(dir, 'root.txt'), 'x', 'utf8')
      writeFileSync(join(dir, 'a', 'one.txt'), 'x', 'utf8')
      writeFileSync(join(dir, 'a', 'b', 'two.txt'), 'x', 'utf8')
      const files = walkLocalDir(dir).sort()
      expect(files).toEqual(['a/b/two.txt', 'a/one.txt', 'root.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('walkLocalDir skips symlinks (a link cycle must not recurse forever)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-sftp-walk-'))
    try {
      writeFileSync(join(dir, 'real.txt'), 'x', 'utf8')
      symlinkSync('.', join(dir, 'self'))
      symlinkSync('real.txt', join(dir, 'alias.txt'))
      const files = walkLocalDir(dir)
      expect(files).toEqual(['real.txt'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('upload rejects a relative remote path before touching the pool', async () => {
    const engine = fakeEngine()
    await expect(upload(engine, 'host', '/tmp/x', 'relative/file.txt', false)).rejects.toThrow(/absolute/)
    expect(engine.pool.size).toBe(0)
    expect(engine.acquireQueue.size).toBe(0)
  })

  it('operator recursively uploading nested subdirectories creates every parent dir once and caches prefixes', async () => {
    // Given a local tree with nested subdirectories and an SFTP server that rejects missing parents
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-sftp-nested-'))
    try {
      mkdirSync(join(dir, 'sub', 'a'), { recursive: true })
      mkdirSync(join(dir, 'sub', 'b'), { recursive: true })
      writeFileSync(join(dir, 'root.txt'), 'r', 'utf8')
      writeFileSync(join(dir, 'sub', 'a', 'one.txt'), '1', 'utf8')
      writeFileSync(join(dir, 'sub', 'a', 'two.txt'), '2', 'utf8')
      writeFileSync(join(dir, 'sub', 'b', 'three.txt'), '3', 'utf8')

      const remoteDirs = new Set<string>(['/'])
      const statPaths: string[] = []
      const mkdirPaths: string[] = []
      const uploadedDsts: string[] = []
      const fakeSftp = {
        once: () => fakeSftp,
        end: () => undefined,
        stat(path: string, cb: (error?: Error, stats?: unknown) => void) {
          statPaths.push(path)
          cb(remoteDirs.has(path) ? undefined : new Error('ENOENT'))
        },
        mkdir(path: string, cb: (error?: Error) => void) {
          mkdirPaths.push(path)
          const parent = posix.dirname(path)
          if (!remoteDirs.has(parent)) {
            cb(new Error('missing parent ' + parent))
            return
          }
          remoteDirs.add(path)
          cb()
        },
        fastPut(_src: string, dst: string, _opts: unknown, cb: (error?: Error) => void) {
          const parent = posix.dirname(dst)
          if (!remoteDirs.has(parent)) {
            cb(new Error('ENOENT parent ' + parent))
            return
          }
          uploadedDsts.push(dst)
          cb()
        },
      }
      const engine = fakeEngine()
      const client = { sftp: (cb: (err: Error | undefined, sftp: unknown) => void) => cb(undefined, fakeSftp) } as unknown as Client
      engine.pool.set('host', fakeRecord(client))

      // When recursive upload runs into /remote/out
      const outcome = await upload(engine, 'host', dir, '/remote/out', true)

      // Then all 4 files succeed, every parent exists, and sibling files in sub/a share the cached prefix
      expect(outcome).toEqual({ bytes: 4, files: 4 })
      expect(uploadedDsts.sort()).toEqual([
        '/remote/out/root.txt',
        '/remote/out/sub/a/one.txt',
        '/remote/out/sub/a/two.txt',
        '/remote/out/sub/b/three.txt',
      ])
      expect(mkdirPaths.filter(p => p === '/remote/out/sub/a')).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('operator ensuring an already-existing deep remote directory pays a single stat RTT', async () => {
    // Given an SFTP target where /var/log/app/releases already exists
    const statPaths: string[] = []
    const mkdirPaths: string[] = []
    const fakeSftp = {
      stat(path: string, cb: (error?: Error) => void) {
        statPaths.push(path)
        cb(path === '/var/log/app/releases' ? undefined : new Error('unexpected'))
      },
      mkdir(path: string, cb: (error?: Error) => void) {
        mkdirPaths.push(path)
        cb()
      },
    } as unknown as SFTPWrapper

    // When ensureRemoteDir checks the nested directory
    await ensureRemoteDir(fakeSftp, '/var/log/app/releases/')

    // Then only one stat round-trip runs and no mkdir is issued
    expect(statPaths).toEqual(['/var/log/app/releases'])
    expect(mkdirPaths).toEqual([])
  })

  it('operator receives instantaneous window speedBps instead of cumulative decay during SFTP transfers', async () => {
    // Given fake timers and a local source file
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-sftp-speed-'))
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    try {
      const src = join(dir, 'data.bin')
      writeFileSync(src, 'x'.repeat(2000), 'utf8')
      const frames: TransferProgress[] = []
      const fakeSftp = {
        fastPut(_s: string, _d: string, opts: { step: (t: number, c: number, total: number) => void }, cb: (err?: Error) => void) {
          vi.advanceTimersByTime(500)
          opts.step(1000, 1000, 2000)
          vi.advanceTimersByTime(500)
          opts.step(2000, 1000, 2000)
          cb()
        },
      } as unknown as SFTPWrapper

      // When fastTransfer completes across two 500ms windows of 1000 bytes each
      await fastTransfer(fakeSftp, 'put', src, '/remote/data.bin', 1, frame => frames.push(frame))

      // Then both window speed reports remain 2000 B/s instead of halving on the second tick
      const speeds = frames.filter(f => f.phase === 'transferring' && f.speedBps !== undefined).map(f => f.speedBps)
      expect(speeds).toEqual([2000, 2000])
    } finally {
      vi.useRealTimers()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tunnel', () => {
  it('stopAllTunnels stops only the matching alias and clears the registry', () => {
    const engine = fakeTunnelEngine()
    const makeRecord = (id: string, alias: string): TunnelRecord => ({
      info: { id, alias, localPort: 40000, remoteHost: 'db', remotePort: 5432, state: 'forwarding', startedAt: 1 },
      server: { close: vi.fn() } as unknown as TunnelRecord['server'],
      alias,
      record: { client: { end: vi.fn() }, hops: [], idleAt: 0, pinned: true, broken: false, inFlight: 0 } as unknown as TunnelRecord['record'],
      sockets: new Set(),
    })
    engine.tunnels.set('tun-1', makeRecord('tun-1', 'api'))
    engine.tunnels.set('tun-2', makeRecord('tun-2', 'db'))
    expect(listTunnels(engine)).toHaveLength(2)
    expect(stopAllTunnels(engine, 'api')).toBe(1)
    expect(engine.tunnels.has('tun-1')).toBe(false)
    expect(engine.tunnels.has('tun-2')).toBe(true)
    expect(stopAllTunnels(engine, 'db')).toBe(1)
    expect(listTunnels(engine)).toHaveLength(0)
  })
})

describe('cluster', () => {
  it('returns an empty list when no host matches', async () => {
    const engine = fakeEngine([{ alias: 'a', environment: 'prod', tags: ['web'] }])
    const results = await cluster(engine, { command: 'true', aliases: ['missing'] })
    expect(results).toEqual([])
  })
})