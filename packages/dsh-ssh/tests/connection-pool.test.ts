/**
 * Unit tests for the connection-pool connectClient / connectChain failure
 * paths, driving a mocked ssh2 Client so no real SSH server is needed.
 *
 * Two regressions for issue #224:
 *   - connectClient uses a persistent 'error' listener (not a one-shot
 *     once-listener), destroys the failed client, and ignores a second
 *     'error' emission after the promise has settled.
 *   - connectChain ends every hop and the failed target client is destroyed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConnectConfig, connectChain, connectClient } from '../src/engine/connection-pool.ts'
import type { SshHostEntry } from '../src/protocol.ts'
import type { HostStore } from '../src/store.ts'

/** Controllable state shared between the tests and the mocked Client class. */
const sshMock = vi.hoisted(() => {
  interface RecordedClient {
    emit: (event: string, ...args: unknown[]) => boolean
    destroyCalls: number
    endCalls: number
    forwardOutCalls: number
    connectConfig?: Record<string, unknown>
  }
  const instances: RecordedClient[] = []
  const behaviors: Array<(client: RecordedClient, config: Record<string, unknown>) => void> = []
  let nextStream: unknown
  return { instances, behaviors, nextStreamSet: (s: unknown) => { nextStream = s }, nextStream }
})

vi.mock('ssh2', () => {
  class MockClient {
    connectConfig: Record<string, unknown> | undefined
    destroyCalls = 0
    endCalls = 0
    forwardOutCalls = 0
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>()

    on(event: string, listener: (...args: unknown[]) => void): this {
      const arr = this.listeners.get(event) ?? []
      arr.push(listener)
      this.listeners.set(event, arr)
      return this
    }

    once(event: string, listener: (...args: unknown[]) => void): this {
      const wrapped = (...args: unknown[]): void => {
        this.removeListener(event, wrapped)
        listener(...args)
      }
      return this.on(event, wrapped)
    }

    removeListener(event: string, listener: (...args: unknown[]) => void): this {
      const arr = this.listeners.get(event)
      if (arr !== undefined) this.listeners.set(event, arr.filter((l) => l !== listener))
      return this
    }

    emit(event: string, ...args: unknown[]): boolean {
      const arr = this.listeners.get(event)
      if (arr === undefined || arr.length === 0) return false
      for (const listener of [...arr]) listener(...args)
      return true
    }

    connect(config: Record<string, unknown>): void {
      this.connectConfig = config
      sshMock.instances.push(this as never)
      const behavior = sshMock.behaviors.shift()
      if (behavior !== undefined) behavior(this as never, config)
    }

    destroy(): void {
      this.destroyCalls += 1
      this.emit('close')
    }

    end(): void {
      this.endCalls += 1
    }

    forwardOut(_src: string, _srcPort: number, _dst: string, _dstPort: number, cb: (error: Error | undefined, stream?: unknown) => void): void {
      this.forwardOutCalls += 1
      cb(undefined, sshMock.nextStream)
    }
  }
  return { Client: MockClient }
})

/** A minimal pool engine whose store lookups are controlled per test. */
function fakeStore(entries: SshHostEntry[]): HostStore {
  return {
    list: () => entries,
    find: (alias: string) => entries.find((e) => e.alias === alias),
  } as unknown as HostStore
}

function passwordEntry(alias: string, overrides: Partial<SshHostEntry> = {}): SshHostEntry {
  return {
    alias,
    host: alias + '.test',
    port: 22,
    user: 'tester',
    auth: { kind: 'password', password: 'secret' },
    proxyJump: [],
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as SshHostEntry
}

/** Distinctive engine options used to verify timeouts reach the ssh2 config. */
function defaultOpts(): Record<string, number> {
  return {
    idleTimeoutMs: 123_456,
    connectTimeoutMs: 7_001,
    keepaliveIntervalMs: 8_002,
    maxOutputBytes: 1,
    defaultExecTimeoutMs: 1,
    defaultMaxWorkers: 1,
    sftpConcurrency: 1,
  }
}

describe('connectClient', () => {
  beforeEach(() => {
    sshMock.instances.length = 0
    sshMock.behaviors.length = 0
  })

  it('destroys the client on the first error and ignores a second error emission', async () => {
    sshMock.behaviors.push((client) => {
      client.emit('error', new Error('handshake dropped'))
    })
    const config = buildConnectConfig(passwordEntry('a'), undefined, defaultOpts() as never)

    await expect(connectClient(config)).rejects.toThrow('handshake dropped')

    const instance = sshMock.instances[0]
    expect(instance).toBeDefined()
    expect(instance.destroyCalls).toBe(1)
    // A second 'error' after settlement must be a no-op: no throw, no repeat destroy.
    expect(() => instance.emit('error', new Error('Connection lost before handshake'))).not.toThrow()
    expect(instance.destroyCalls).toBe(1)
  })

  it('resolves on ready', async () => {
    sshMock.behaviors.push((client) => {
      client.emit('ready')
    })
    const client = await connectClient(buildConnectConfig(passwordEntry('a'), undefined, defaultOpts() as never))
    expect(client).toBeDefined()
    const instance = sshMock.instances[0]
    expect(instance.destroyCalls).toBe(0)
  })

  it('threads EngineOptions timeouts into the ssh2 connect config', async () => {
    sshMock.behaviors.push((client) => {
      client.emit('ready')
    })
    const config = buildConnectConfig(passwordEntry('x'), undefined, defaultOpts() as never)
    await connectClient(config)

    const instance = sshMock.instances[0]
    expect(instance.connectConfig?.readyTimeout).toBe(7_001)
    expect(instance.connectConfig?.keepaliveInterval).toBe(8_002)
  })
})

describe('buildConnectConfig agent auth', () => {
  it('uses an explicit agent path', () => {
    const entry = passwordEntry('agent', { auth: { kind: 'agent', agentPath: '/tmp/agent.sock' } })
    const config = buildConnectConfig(entry, undefined, defaultOpts() as never)
    expect(config.agent).toBe('/tmp/agent.sock')
    expect(config.password).toBeUndefined()
    expect(config.privateKey).toBeUndefined()
  })

  it('falls back to SSH_AUTH_SOCK when no agent path is configured', () => {
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = '/tmp/auto-agent.sock'
    try {
      const entry = passwordEntry('agent-auto', { auth: { kind: 'agent' } })
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)
      expect(config.agent).toBe('/tmp/auto-agent.sock')
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('rejects agent auth when no agent endpoint is available', () => {
    const previous = process.env.SSH_AUTH_SOCK
    delete process.env.SSH_AUTH_SOCK
    const previousPlatform = process.platform
    // Force the non-Windows branch (Pageant is the Windows fallback).
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const entry = passwordEntry('agent-none', { auth: { kind: 'agent' } })
      expect(() => buildConnectConfig(entry, undefined, defaultOpts() as never)).toThrow(/ssh-agent is not available/)
    } finally {
      if (previous !== undefined) process.env.SSH_AUTH_SOCK = previous
      Object.defineProperty(process, 'platform', { value: previousPlatform })
    }
  })
})

describe('connectChain', () => {
  beforeEach(() => {
    sshMock.instances.length = 0
    sshMock.behaviors.length = 0
    sshMock.nextStreamSet({})
  })

  it('ends every hop and destroys the failed target on a broken handshake', async () => {
    const hop = passwordEntry('hop', { proxyJump: [] })
    const target = passwordEntry('target', { proxyJump: ['hop'] })
    const store = fakeStore([hop, target])
    // First client (hop) connects and forwards; second client (target) fails.
    sshMock.behaviors.push((client) => { client.emit('ready') })
    sshMock.behaviors.push((client) => { client.emit('error', new Error('Connection lost before handshake')) })

    const engine = {
      store,
      opts: { idleTimeoutMs: 1, connectTimeoutMs: 1, keepaliveIntervalMs: 1, maxOutputBytes: 1, defaultExecTimeoutMs: 1, defaultMaxWorkers: 1, sftpConcurrency: 1 },
      pool: new Map(),
      acquireQueue: new Map(),
    }

    await expect(connectChain(engine as never, target)).rejects.toThrow('Connection lost before handshake')

    const hopInstance = sshMock.instances[0]
    const targetInstance = sshMock.instances[1]
    expect(hopInstance).toBeDefined()
    expect(targetInstance).toBeDefined()
    expect(hopInstance.forwardOutCalls).toBe(1)
    expect(hopInstance.endCalls).toBe(1)
    // The failed target is destroyed (connectClient does it on failure).
    expect(targetInstance.destroyCalls).toBe(1)
    // EngineOptions timeouts flow into every hop and target config.
    expect(hopInstance.connectConfig?.readyTimeout).toBe(1)
    expect(hopInstance.connectConfig?.keepaliveInterval).toBe(1)
    expect(targetInstance.connectConfig?.readyTimeout).toBe(1)
    expect(targetInstance.connectConfig?.keepaliveInterval).toBe(1)
  })

  it('ends already-connected hops when a middle-hop connect fails', async () => {
    const hopA = passwordEntry('a', { proxyJump: [] })
    const hopB = passwordEntry('b', { proxyJump: [] })
    const target = passwordEntry('target', { proxyJump: ['a', 'b'] })
    const store = fakeStore([hopA, hopB, target])
    // Hop A connects and forwards; hop B fails its handshake.
    sshMock.behaviors.push((client) => { client.emit('ready') })
    sshMock.behaviors.push((client) => { client.emit('error', new Error('Connection lost before handshake')) })

    const engine = {
      store,
      opts: { idleTimeoutMs: 1, connectTimeoutMs: 1, keepaliveIntervalMs: 1, maxOutputBytes: 1, defaultExecTimeoutMs: 1, defaultMaxWorkers: 1, sftpConcurrency: 1 },
      pool: new Map(),
      acquireQueue: new Map(),
    }

    await expect(connectChain(engine as never, target)).rejects.toThrow('Connection lost before handshake')

    const hopAInstance = sshMock.instances[0]
    const hopBInstance = sshMock.instances[1]
    expect(hopAInstance).toBeDefined()
    expect(hopBInstance).toBeDefined()
    expect(hopAInstance.forwardOutCalls).toBe(1)
    // The already-connected hop A must be closed so no middle-hop leaks.
    expect(hopAInstance.endCalls).toBe(1)
    // The failed hop B is destroyed by connectClient on its own failure.
    expect(hopBInstance.destroyCalls).toBe(1)
  })
})
