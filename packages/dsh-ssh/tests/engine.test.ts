/**
 * Engine integration tests against the embedded ssh2 test server:
 * exec (success/exit codes/stderr/timeout), connection pooling and
 * reconnect, key auth, cluster, PTY shell, local-port-forward tunnel,
 * SFTP upload/download/ls, and the connection probe.
 */

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer, type AddressInfo } from 'node:net'
import type { Client } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SshEngine } from '../src/engine.ts'
import { HostStore } from '../src/store.ts'
import type { HostPayload } from '../src/protocol.ts'
import { TEST_PASSWORD, TEST_USER, TestSshServer } from './helpers/ssh-server.ts'
import { TestSshd } from './helpers/sshd.ts'

let server: TestSshServer
let store: HostStore
let engine: SshEngine
const dir = mkdtempSync(join(tmpdir(), 'dsh-ssh-engine-'))

function addHost(alias: string, overrides: Partial<HostPayload> = {}): void {
  store.create({
    alias,
    host: '127.0.0.1',
    port: server.port,
    user: TEST_USER,
    auth: { kind: 'password', password: TEST_PASSWORD },
    ...overrides,
  } as HostPayload)
}

/** The slice of PoolRecord the fake SFTP tests need to inject. */
interface FakePoolRecord {
  client: Client
  hops: Client[]
  idleAt: number
  pinned: boolean
  broken: boolean
  inFlight: number
}

/** Minimal stats shape consumed by the engine SFTP paths. */
interface FakeStats {
  isDirectory: () => boolean
  isFile: () => boolean
  size: number
  mtime: number
  mode: number
}

const FILE_STATS: FakeStats = {
  isDirectory: () => false,
  isFile: () => true,
  size: 4,
  mtime: 1_700_000_000,
  mode: 0o644,
}

interface FakeSftpOptions {
  statMode?: 'missing' | 'file'
  fastPutError?: Error
  readdirError?: Error
}

/** SFTPWrapper stand-in that records end() calls and honors the close guard. */
class FakeSftp {
  endCalls = 0
  statCalls = 0
  mkdirCalls = 0
  fastPutCalls = 0
  fastGetCalls = 0
  readdirCalls = 0
  onFastPut?: () => void
  private readonly statMode: 'missing' | 'file'
  private readonly fastPutError?: Error
  private readonly readdirError?: Error
  private readonly closeListeners: Array<() => void> = []

  constructor(options: FakeSftpOptions = {}) {
    this.statMode = options.statMode ?? 'missing'
    this.fastPutError = options.fastPutError
    this.readdirError = options.readdirError
  }

  once(event: string, listener: () => void): this {
    if (event === 'close') this.closeListeners.push(listener)
    return this
  }

  emitClose(): void {
    this.closeListeners.shift()?.()
  }

  end(): void {
    this.endCalls += 1
  }

  stat(_path: string, cb: (error: Error | undefined, stats?: FakeStats) => void): void {
    this.statCalls += 1
    if (this.statMode === 'file') cb(undefined, FILE_STATS)
    else cb(new Error('no such file'), undefined)
  }

  mkdir(_path: string, cb: (error?: Error) => void): void {
    this.mkdirCalls += 1
    cb()
  }

  fastPut(_src: string, _dst: string, _options: unknown, cb: (error?: Error) => void): void {
    this.fastPutCalls += 1
    this.onFastPut?.()
    cb(this.fastPutError)
  }

  fastGet(_src: string, _dst: string, _options: unknown, cb: (error?: Error) => void): void {
    this.fastGetCalls += 1
    cb()
  }

  readdir(_path: string, cb: (error: Error | undefined, list?: Array<{ filename: string; attrs: FakeStats }>) => void): void {
    this.readdirCalls += 1
    if (this.readdirError !== undefined) cb(this.readdirError, undefined)
    else cb(undefined, [{ filename: 'a.txt', attrs: FILE_STATS }])
  }
}

/** Insert a fake connected client into one engine's private pool. */
function seedPooledSftp(engine: SshEngine, alias: string, client: Client): void {
  const pool = (engine as unknown as { pool: Map<string, FakePoolRecord> }).pool
  pool.set(alias, { client, hops: [], idleAt: Date.now(), pinned: false, broken: false, inFlight: 0 })
}

beforeAll(async () => {
  server = await TestSshServer.start()
  store = new HostStore(join(dir, 'hosts.json'))
  engine = new SshEngine(store, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000, defaultExecTimeoutMs: 5_000 })
})

afterAll(async () => {
  engine.dispose()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('exec', () => {
  it('runs a command and captures stdout', async () => {
    addHost('exec-ok')
    const result = await engine.exec('exec-ok', 'echo hello')
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('hello')
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('reports remote exit codes as failures', async () => {
    addHost('exec-code')
    const result = await engine.exec('exec-code', 'exit 7')
    expect(result.success).toBe(false)
    expect(result.exitCode).toBe(7)
  })

  it('captures stderr separately', async () => {
    addHost('exec-err')
    const result = await engine.exec('exec-err', 'out-and-err')
    expect(result.stdout).toContain('hello out')
    expect(result.stderr).toContain('hello err')
  })

  it('times out and reports timedOut', async () => {
    addHost('exec-timeout')
    const started = Date.now()
    const result = await engine.exec('exec-timeout', 'hang', 400)
    expect(result.timedOut).toBe(true)
    expect(result.success).toBe(false)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('fails cleanly for unknown aliases', async () => {
    await expect(engine.exec('nope', 'true')).rejects.toThrow(/not found/)
  })

  it('fails cleanly on authentication errors', async () => {
    addHost('exec-badauth', { auth: { kind: 'password', password: 'wrong' } })
    await expect(engine.exec('exec-badauth', 'true')).rejects.toThrow(/authentication/i)
  })
})

describe('connection pool', () => {
  it('reuses one connection across execs', async () => {
    addHost('pool-reuse')
    const before = server.connectCount
    await engine.exec('pool-reuse', 'true')
    await engine.exec('pool-reuse', 'echo hello')
    expect(server.connectCount).toBe(before + 1)
  })

  it('reconnects after the server drops the connection', async () => {
    addHost('pool-reconnect')
    await engine.exec('pool-reconnect', 'true')
    const before = server.connectCount
    server.killAllClients()
    await new Promise(resolve => setTimeout(resolve, 150))
    const result = await engine.exec('pool-reconnect', 'echo hello')
    expect(result.success).toBe(true)
    expect(server.connectCount).toBe(before + 1)
  })

  it('retries a mid-flight failure on a fresh connection within the attempt budget', async () => {
    addHost('pool-midflight')
    await engine.exec('pool-midflight', 'true')
    const before = server.connectCount
    const pending = engine.exec('pool-midflight', 'hang', 3_000)
    await new Promise(resolve => setTimeout(resolve, 150))
    server.killAllClients()
    const result = await pending
    // Attempt one died with the link; the retry re-ran on a fresh connection
    // and surfaced the command timeout there instead of a connection error.
    expect(result.timedOut).toBe(true)
    expect(server.connectCount).toBe(before + 1)
  }, 10_000)

  it('dropAlias closes the pooled connection so the next exec reconnects', async () => {
    addHost('pool-drop')
    await engine.exec('pool-drop', 'true')
    const before = server.connectCount
    engine.dropAlias('pool-drop')
    expect(engine.pool.has('pool-drop')).toBe(false)
    const result = await engine.exec('pool-drop', 'echo hello')
    expect(result.success).toBe(true)
    expect(server.connectCount).toBe(before + 1)
  })
})

describe('key auth', () => {
  it('connects with a generated private key', async () => {
    addHost('key-auth', { auth: { kind: 'key', keyPath: server.keyPair.privateKey } })
    const result = await engine.exec('key-auth', 'echo hello')
    expect(result.success).toBe(true)
    expect(result.stdout).toContain('hello')
  })
})

describe('cluster', () => {
  it('runs one command on every matched host concurrently', async () => {
    addHost('cluster-a')
    addHost('cluster-b')
    addHost('cluster-c', { environment: 'staging' })
    // The store accumulates hosts from every test; scope by explicit aliases.
    const aliases = ['cluster-a', 'cluster-b', 'cluster-c']
    const results = await engine.cluster({ command: 'echo hello', aliases })
    expect(results).toHaveLength(3)
    for (const result of results) {
      expect(result.ok).toBe(true)
      expect(result.stdout).toContain('hello')
    }
    const scoped = await engine.cluster({ command: 'true', aliases: ['cluster-a'] })
    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.alias).toBe('cluster-a')
    const staging = await engine.cluster({ command: 'true', aliases, environment: 'staging' })
    expect(staging).toHaveLength(1)
    expect(staging[0]?.alias).toBe('cluster-c')
    const none = await engine.cluster({ command: 'true', aliases, environment: 'production' })
    expect(none).toHaveLength(0)
  })
})

describe('shell', () => {
  it('opens a PTY, echoes input, resizes, and exits', async () => {
    addHost('shell-host')
    const session = await engine.openShell('shell-host', { cols: 80, rows: 24 })
    const outputs: string[] = []
    let exited = false
    session.onData = (data) => outputs.push(data.toString('utf8'))
    session.onExit = () => { exited = true }
    await new Promise(resolve => setTimeout(resolve, 200))
    // Bidirectional flow: input written to the shell is echoed back.
    session.send('ping\r')
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(outputs.join('')).toContain('ping')
    session.resize(100, 30)
    await new Promise(resolve => setTimeout(resolve, 100))
    session.close()
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(exited).toBe(true)
  })
})

describe('tunnel', () => {
  it('forwards a local port to the remote echo server', async () => {
    addHost('tunnel-host')
    const tunnel = await engine.startTunnel('tunnel-host', { remotePort: server.echoPort })
    expect(tunnel.localPort).toBeGreaterThan(0)
    expect(engine.listTunnels()).toHaveLength(1)
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(tunnel.localPort, '127.0.0.1')
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('tunnel echo timed out')) }, 3_000)
      socket.on('connect', () => socket.write('ping-through-tunnel'))
      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer)
        socket.destroy()
        resolve(chunk.toString('utf8'))
      })
      socket.on('error', (error) => { clearTimeout(timer); reject(error) })
    })
    expect(reply).toBe('ping-through-tunnel')
    expect(engine.stopTunnel(tunnel.id)).toBe(true)
    expect(engine.listTunnels()).toHaveLength(0)
  })

  it('stopping one tunnel keeps sibling tunnels on the same alias forwarding', async () => {
    addHost('tunnel-shared')
    const first = await engine.startTunnel('tunnel-shared', { remotePort: server.echoPort })
    const second = await engine.startTunnel('tunnel-shared', { remotePort: server.echoPort })
    expect(engine.listTunnels()).toHaveLength(2)

    expect(engine.stopTunnel(first.id)).toBe(true)
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(second.localPort, '127.0.0.1')
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('sibling tunnel echo timed out')) }, 3_000)
      socket.on('connect', () => socket.write('still-alive'))
      socket.on('data', (chunk: Buffer) => {
        clearTimeout(timer)
        socket.destroy()
        resolve(chunk.toString('utf8'))
      })
      socket.on('error', (error) => { clearTimeout(timer); reject(error) })
    })
    expect(reply).toBe('still-alive')

    // The last tunnel releases the shared connection.
    expect(engine.stopTunnel(second.id)).toBe(true)
    expect(engine.pool.has('tunnel-shared')).toBe(false)
  })
})

describe('sftp (real sshd)', () => {
  it('uploads, lists, and downloads files', async () => {
    const sshd = await TestSshd.start()
    try {
      store.create({
        alias: 'sftp-real',
        host: '127.0.0.1',
        port: sshd.port,
        user: process.env.USER ?? 'root',
        auth: { kind: 'key', keyPath: sshd.clientKey },
      })
      const remoteDir = join(sshd.root, 'up')
      const local = join(sshd.root, 'payload.txt')
      const content = 'sftp roundtrip payload ' + Math.random()
      writeFileSync(local, content, 'utf8')

      const uploaded = await engine.upload('sftp-real', local, join(remoteDir, 'payload.txt'), false)
      expect(uploaded.bytes).toBe(content.length)

      const listing = await engine.ls('sftp-real', remoteDir)
      expect(listing.some(entry => entry.name === 'payload.txt' && entry.type === 'file')).toBe(true)

      const downloaded = await engine.download('sftp-real', join(remoteDir, 'payload.txt'), join(sshd.root, 'out.txt'))
      expect(downloaded.bytes).toBe(content.length)
      expect(readFileSync(join(sshd.root, 'out.txt'), 'utf8')).toBe(content)
    } finally {
      sshd.stop()
    }
  })
})

describe('sftp channel release', () => {
  it('ends every SFTP channel exactly once after repeated upload, download, and list calls', async () => {
    const wrappers: FakeSftp[] = []
    const statModes: Array<'missing' | 'file'> = ['missing', 'missing', 'file']
    let opened = 0
    const client = {
      sftp(cb: (error: Error | undefined, sftp: unknown) => void): void {
        const wrapper = new FakeSftp({ statMode: statModes[Math.min(opened, statModes.length - 1)] })
        opened += 1
        wrappers.push(wrapper)
        cb(undefined, wrapper)
      },
    } as unknown as Client
    const engine2 = new SshEngine(store, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000, defaultExecTimeoutMs: 5_000 })
    const local = join(dir, 'sftp-release-src.txt')
    const localOut = join(dir, 'sftp-release-out.txt')
    writeFileSync(local, 'ping', 'utf8')
    writeFileSync(localOut, 'pong', 'utf8')
    try {
      seedPooledSftp(engine2, 'sftp-release', client)
      await engine2.upload('sftp-release', local, '/remote/one.txt', false)
      await engine2.upload('sftp-release', local, '/remote/two.txt', false)
      await engine2.download('sftp-release', '/remote/one.txt', localOut)
      await engine2.ls('sftp-release', '/remote')

      expect(wrappers).toHaveLength(4)
      expect(wrappers[0]?.fastPutCalls).toBe(1)
      expect(wrappers[1]?.fastPutCalls).toBe(1)
      expect(wrappers[2]?.fastGetCalls).toBe(1)
      expect(wrappers[3]?.readdirCalls).toBe(1)
      for (const wrapper of wrappers) {
        expect(wrapper.endCalls).toBe(1)
        // A late peer close after release must not end the channel twice.
        wrapper.emitClose()
        expect(wrapper.endCalls).toBe(1)
      }
    } finally {
      engine2.dispose()
    }
  })

  it('ends the SFTP channel when an upload or list fails', async () => {
    const wrappers: FakeSftp[] = []
    let opened = 0
    const client = {
      sftp(cb: (error: Error | undefined, sftp: unknown) => void): void {
        const wrapper = opened === 0
          ? new FakeSftp({ statMode: 'missing', fastPutError: new Error('remote write failed') })
          : new FakeSftp({ readdirError: new Error('readdir failed') })
        opened += 1
        wrappers.push(wrapper)
        cb(undefined, wrapper)
      },
    } as unknown as Client
    const engine2 = new SshEngine(store, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000, defaultExecTimeoutMs: 5_000 })
    const local = join(dir, 'sftp-release-error-src.txt')
    writeFileSync(local, 'ping', 'utf8')
    try {
      seedPooledSftp(engine2, 'sftp-release-error', client)
      await expect(engine2.upload('sftp-release-error', local, '/remote/bad.txt', false)).rejects.toThrow(/remote write failed/)
      await expect(engine2.ls('sftp-release-error', '/remote')).rejects.toThrow(/readdir failed/)

      expect(wrappers).toHaveLength(2)
      expect(wrappers[0]?.endCalls).toBe(1)
      expect(wrappers[1]?.endCalls).toBe(1)
    } finally {
      engine2.dispose()
    }
  })

  it('does not end twice when the channel closes before the operation settles', async () => {
    const wrappers: FakeSftp[] = []
    let wrapper: FakeSftp | undefined
    const client = {
      sftp(cb: (error: Error | undefined, sftp: unknown) => void): void {
        wrapper = new FakeSftp({ statMode: 'missing' })
        wrapper.onFastPut = () => wrapper!.emitClose()
        wrappers.push(wrapper)
        cb(undefined, wrapper)
      },
    } as unknown as Client
    const engine2 = new SshEngine(store, { idleTimeoutMs: 60_000, connectTimeoutMs: 5_000, defaultExecTimeoutMs: 5_000 })
    const local = join(dir, 'sftp-release-selfclose-src.txt')
    writeFileSync(local, 'ping', 'utf8')
    try {
      seedPooledSftp(engine2, 'sftp-release-selfclose', client)
      await engine2.upload('sftp-release-selfclose', local, '/remote/ok.txt', false)

      expect(wrapper).toBeDefined()
      expect(wrapper!.endCalls).toBe(1)
    } finally {
      engine2.dispose()
    }
  })
})

describe('cluster filters', () => {
  it('matches hosts carrying ALL requested tags', async () => {
    addHost('tag-web', { tags: ['web'] })
    addHost('tag-both', { tags: ['web', 'staging'] })
    addHost('tag-staging', { tags: ['staging'] })
    const results = await engine.cluster({ command: 'true', tags: ['web', 'staging'] })
    expect(results.map(r => r.alias)).toEqual(['tag-both'])
  })

  it('rejects invalid maxWorkers', async () => {
    await expect(engine.cluster({ command: 'true', maxWorkers: 0 })).rejects.toThrow(/maxWorkers/)
    await expect(engine.cluster({ command: 'true', maxWorkers: -2 })).rejects.toThrow(/maxWorkers/)
  })
})

describe('tunnel safety', () => {
  it('rejects out-of-range ports', async () => {
    addHost('tun-port')
    await expect(engine.startTunnel('tun-port', { remotePort: 0 })).rejects.toThrow(/remotePort/)
    await expect(engine.startTunnel('tun-port', { remotePort: 70_000 })).rejects.toThrow(/remotePort/)
    await expect(engine.startTunnel('tun-port', { remotePort: 22, localPort: 0 })).rejects.toThrow(/localPort/)
  })

  it('rolls back the connection when the local port is taken', async () => {
    addHost('tun-conflict')
    const blocker = createServer(() => undefined)
    await new Promise<void>((resolve) => { blocker.listen(0, '127.0.0.1', resolve) })
    const takenPort = (blocker.address() as AddressInfo).port
    await expect(
      engine.startTunnel('tun-conflict', { remotePort: server.echoPort, localPort: takenPort }),
    ).rejects.toThrow()
    expect(engine.listTunnels()).toHaveLength(0)
    // The failed tunnel must not pin a leaked connection: exec still works.
    const result = await engine.exec('tun-conflict', 'true')
    expect(result.success).toBe(true)
    await new Promise<void>((resolve) => { blocker.close(() => resolve()) })
  })

  it('stops tunnels scoped by alias', async () => {
    addHost('tun-a')
    addHost('tun-b')
    await engine.startTunnel('tun-a', { remotePort: server.echoPort })
    const b = await engine.startTunnel('tun-b', { remotePort: server.echoPort })
    const stopped = engine.stopAllTunnels('tun-a')
    expect(stopped).toBe(1)
    expect(engine.listTunnels().map(t => t.id)).toEqual([b.id])
    expect(engine.stopTunnel(b.id)).toBe(true)
    expect(engine.listTunnels()).toHaveLength(0)
  })
})

describe('shell isolation', () => {
  it('shell sessions use their own connection and never disturb pooled execs', async () => {
    addHost('shell-iso')
    await engine.exec('shell-iso', 'true')
    const before = server.connectCount
    const session = await engine.openShell('shell-iso', { cols: 80, rows: 24 })
    // Opening the shell must not reuse the pooled connection.
    expect(server.connectCount).toBe(before + 1)
    session.close()
    await new Promise(resolve => setTimeout(resolve, 300))
    const result = await engine.exec('shell-iso', 'echo hello')
    expect(result.success).toBe(true)
    expect(result.stdout).toContain('hello')
    // The exec reused the ORIGINAL pooled connection (no new connect).
    expect(server.connectCount).toBe(before + 1)
  })
})

describe('sweep safety', () => {
  it('does not sweep an in-flight exec past the idle timeout', async () => {
    addHost('sweep-exec')
    const engine2 = new SshEngine(store, { idleTimeoutMs: 300, defaultExecTimeoutMs: 2_000 })
    try {
      let resolved = false
      const pending = engine2.exec('sweep-exec', 'hang', 1_500).then(result => {
        resolved = true
        return result
      })
      await new Promise(resolve => setTimeout(resolve, 800))
      // Still running well past the idle timeout: the sweep must not kill it.
      expect(resolved).toBe(false)
      const result = await pending
      expect(result.timedOut).toBe(true)
    } finally {
      engine2.dispose()
    }
  })
})

describe('upload path rules', () => {
  it('rejects relative remote paths', async () => {
    addHost('rel-path')
    await expect(
      engine.upload('rel-path', join(process.cwd(), 'package.json'), 'relative/dir/file.txt', false),
    ).rejects.toThrow(/absolute/)
  })
})

describe('probe', () => {
  it('uses a cross-platform command to probe connectivity', async () => {
    const execSpy = vi.spyOn(engine, 'exec').mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      stdout: 'ok\n',
      stderr: '',
      durationMs: 1,
    })

    try {
      const result = await engine.test('probe-command')
      expect(execSpy).toHaveBeenCalledWith('probe-command', 'echo ok', 10_000)
      expect(result).toEqual({ ok: true, latencyMs: 1 })
    } finally {
      execSpy.mockRestore()
    }
  })

  it('reports a working connection', async () => {
    addHost('probe-host')
    const result = await engine.test('probe-host')
    expect(result.ok).toBe(true)
    expect(result.latencyMs).toBeGreaterThan(0)
  })

  it('reports failures', async () => {
    addHost('probe-bad', { auth: { kind: 'password', password: 'nope' } })
    const result = await engine.test('probe-bad')
    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
  })
})
