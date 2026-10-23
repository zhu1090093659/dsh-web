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
import { DEFAULTS, WINDOWS_AGENT_PIPE, buildConnectConfig, connectChain, connectClient, parseJumpSpec } from '../src/engine/connection-pool.ts'
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

/** The minimal pool engine shape connectChain consumes. */
function poolEngine(store: HostStore): unknown {
  return {
    store,
    opts: {
      idleTimeoutMs: 1, connectTimeoutMs: 1, keepaliveIntervalMs: 1,
      maxOutputBytes: 1, defaultExecTimeoutMs: 1, defaultMaxWorkers: 1, sftpConcurrency: 1,
    },
    pool: new Map(),
    acquireQueue: new Map(),
  }
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

describe('connection timeout (issue #1931)', () => {
  it('operator gets a 30 s default pre-ready ceiling instead of the previous 15 s', () => {
    // Given no engine option override
    // When the engine applies its defaults
    // Then slow PAM / LDAP password authentication has 30 s to finish
    expect(DEFAULTS.connectTimeoutMs).toBe(30_000)
  })
})

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

  it('operator reads a user-authentication timeout when the key exchange already completed', async () => {
    // Given a client whose key exchange completed
    // When ssh2 reports its pre-ready timeout
    // Then the rejection names user authentication and the shared budget
    sshMock.behaviors.push((client) => {
      client.emit('handshake')
      client.emit('error', Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' }))
    })
    const config = buildConnectConfig(passwordEntry('slow-auth'), undefined, defaultOpts() as never)

    await expect(connectClient(config)).rejects.toThrow('SSH authentication timed out after 7001 ms')
  })

  it('operator reads a connection or key-exchange timeout before the handshake completes', async () => {
    // Given a client that has not completed the key exchange
    // When ssh2 reports its pre-ready timeout
    // Then the rejection names TCP connect or key exchange rather than authentication
    sshMock.behaviors.push((client) => {
      client.emit('error', Object.assign(new Error('Timed out while waiting for handshake'), { level: 'client-timeout' }))
    })
    const config = buildConnectConfig(passwordEntry('slow-connect'), undefined, defaultOpts() as never)

    await expect(connectClient(config)).rejects.toThrow('SSH connection timed out after 7001 ms before key exchange completed')
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
    expect(instance.connectConfig?.tryKeyboard).toBe(true)
  })

  it('answers keyboard-interactive password prompt automatically when password auth is configured (#806)', async () => {
    let answered: string[] | undefined
    sshMock.behaviors.push((client) => {
      client.emit('keyboard-interactive', 'PAM', '', '', [{ prompt: 'Password: ', echo: false }], (res: string[]) => {
        answered = res
        client.emit('ready')
      })
    })
    const config = buildConnectConfig(passwordEntry('pam-host', { auth: { kind: 'password', password: 'my-pam-password' } }), undefined, defaultOpts() as never)
    const client = await connectClient(config)
    expect(client).toBeDefined()
    expect(answered).toEqual(['my-pam-password'])
  })

  it('invokes custom onKeyboardInteractive handler when provided for 2FA (#806)', async () => {
    let customPrompts: Array<{ prompt: string; echo: boolean }> = []
    let answered: string[] | undefined
    sshMock.behaviors.push((client) => {
      client.emit('keyboard-interactive', '2FA', 'Enter TOTP code', '', [{ prompt: 'Verification code: ', echo: true }], (res: string[]) => {
        answered = res
        client.emit('ready')
      })
    })
    const config = buildConnectConfig(passwordEntry('2fa-host'), undefined, defaultOpts() as never)
    const client = await connectClient(config, (_name, _inst, _lang, prompts, finish) => {
      customPrompts = prompts
      finish(['123456'])
    })
    expect(client).toBeDefined()
    expect(customPrompts).toEqual([{ prompt: 'Verification code: ', echo: true }])
    expect(answered).toEqual(['123456'])
  })

  it('fails with clear error when non-interactive keyboard challenge cannot be answered (#806)', async () => {
    sshMock.behaviors.push((client) => {
      client.emit('keyboard-interactive', '2FA', '', '', [{ prompt: 'OTP: ', echo: false }], () => {})
    })
    const config = buildConnectConfig(passwordEntry('otp-host', { auth: { kind: 'password', password: 'pw' } }), undefined, defaultOpts() as never)
    await expect(connectClient(config)).rejects.toThrow(/Authentication failed \(keyboard-interactive\): OTP:/)
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
    // Force the non-Windows branch (the native named pipe is the Windows fallback).
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const entry = passwordEntry('agent-none', { auth: { kind: 'agent' } })
      expect(() => buildConnectConfig(entry, undefined, defaultOpts() as never)).toThrow(/ssh-agent is not available/)
    } finally {
      if (previous !== undefined) process.env.SSH_AUTH_SOCK = previous
      Object.defineProperty(process, 'platform', { value: previousPlatform })
    }
  })

  it('member leaving the agent path empty on Windows connects through the native OpenSSH pipe (#1910)', () => {
    // Given a Windows machine with no SSH_AUTH_SOCK and an agent-auth host
    // that left the agent path empty (the form's "auto-detect" choice)
    const previous = process.env.SSH_AUTH_SOCK
    delete process.env.SSH_AUTH_SOCK
    const previousPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const entry = passwordEntry('agent-win', { auth: { kind: 'agent' } })

      // When the connect config is built
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then it dials the pipe the native ssh-agent service listens on, not
      // PuTTY's "pageant" protocol name
      expect(config.agent).toBe(WINDOWS_AGENT_PIPE)
      expect(config.agent).toBe('\\\\.\\pipe\\openssh-ssh-agent')
      expect(config.agent).not.toBe('pageant')
    } finally {
      if (previous !== undefined) process.env.SSH_AUTH_SOCK = previous
      Object.defineProperty(process, 'platform', { value: previousPlatform })
    }
  })

  it('member pinning pageant on Windows keeps the PuTTY endpoint', () => {
    // Given a Windows user who explicitly chose PuTTY Pageant
    const previous = process.env.SSH_AUTH_SOCK
    delete process.env.SSH_AUTH_SOCK
    const previousPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const entry = passwordEntry('agent-pageant', { auth: { kind: 'agent', agentPath: 'pageant' } })

      // When the connect config is built
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then the explicit endpoint wins over the new default
      expect(config.agent).toBe('pageant')
    } finally {
      if (previous !== undefined) process.env.SSH_AUTH_SOCK = previous
      Object.defineProperty(process, 'platform', { value: previousPlatform })
    }
  })
})

describe('buildConnectConfig agent forwarding', () => {
  /** Distinctive endpoint so a resolution that ignored the environment is visible. */
  const FORWARD_SOCK = '/tmp/dsh-ssh-forward-agent.sock'

  it('member enabling forwarding on a password host gets a forwarding config with a concrete agent', () => {
    // Given a password host with forwarding enabled and one local agent endpoint
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = FORWARD_SOCK
    try {
      const entry = passwordEntry('forward-password', { forwardAgent: true })

      // When the connect config is built
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then the connection forwards the local agent and still authenticates
      // with the stored password
      expect(config.agentForward).toBe(true)
      expect(config.agent).toBe(FORWARD_SOCK)
      expect(config.password).toBe('secret')
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('member leaving forwarding off gets neither agent nor agentForward on the config', () => {
    // Given the same local agent endpoint, with the host opt-in left out
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = FORWARD_SOCK
    try {
      const entry = passwordEntry('no-forward')

      // When the connect config is built
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then the endpoint is never mentioned, so nothing is forwarded
      expect(config.agentForward).toBeUndefined()
      expect(config.agent).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('member enabling forwarding on an agent-auth host reuses the configured agent path', () => {
    // Given an agent-auth host pinned to an explicit endpoint, forwarding on,
    // and a different endpoint in the environment
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = FORWARD_SOCK
    try {
      const entry = passwordEntry('forward-agent', {
        auth: { kind: 'agent', agentPath: '/tmp/pinned-agent.sock' },
        forwardAgent: true,
      })

      // When the connect config is built
      const config = buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then the configured path is both the auth and the forwarded endpoint
      expect(config.agent).toBe('/tmp/pinned-agent.sock')
      expect(config.agentForward).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('operator enabling forwarding with no agent endpoint gets an actionable forwarding error', () => {
    // Given a host with forwarding on and no endpoint on this machine
    const previous = process.env.SSH_AUTH_SOCK
    delete process.env.SSH_AUTH_SOCK
    const previousPlatform = process.platform
    // Force the non-Windows branch (Pageant is the Windows fallback).
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const entry = passwordEntry('forward-none', { forwardAgent: true })

      // When the connect config is built
      const build = (): unknown => buildConnectConfig(entry, undefined, defaultOpts() as never)

      // Then the engine names the missing endpoint and the way out, instead of
      // letting ssh2's raw "You must set a valid agent path" surface
      expect(build).toThrow(/agent forwarding is enabled for this host/)
      expect(build).toThrow(/SSH_AUTH_SOCK/)
      expect(build).not.toThrow(/You must set a valid agent path/)
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

  it('seeds the transport from the entry ProxyCommand', async () => {
    const entry = passwordEntry('proxied', { proxyCommand: 'echo %h %p' })
    sshMock.behaviors.push((client) => { client.emit('ready') })
    const engine = poolEngine(fakeStore([entry]))

    await connectChain(engine as never, entry)

    const instance = sshMock.instances[0]
    const sock = instance?.connectConfig?.['sock'] as { destroy?: unknown } | undefined
    expect(sock).toBeDefined()
    expect(typeof sock?.destroy).toBe('function')
    ;(sock as { destroy: () => void }).destroy()
  })

  it('resolves an address-form hop and reuses the target credentials', async () => {
    const target = passwordEntry('target', { proxyJump: ['ops@bastion.example.com:2222'] })
    sshMock.behaviors.push((client) => { client.emit('ready') })
    sshMock.behaviors.push((client) => { client.emit('ready') })
    const engine = poolEngine(fakeStore([target]))

    await connectChain(engine as never, target)

    const hopConfig = sshMock.instances[0]?.connectConfig as Record<string, unknown> | undefined
    expect(hopConfig?.['host']).toBe('bastion.example.com')
    expect(hopConfig?.['port']).toBe(2222)
    expect(hopConfig?.['username']).toBe('ops')
    // An ad-hoc hop carries no auth of its own; it reuses the target's.
    expect(hopConfig?.['password']).toBe('secret')
  })

  it('names the hop when a hop connect fails', async () => {
    const target = passwordEntry('target', { proxyJump: ['ops@bastion.example.com:2222'] })
    sshMock.behaviors.push((client) => { client.emit('error', new Error('handshake dropped')) })
    const engine = poolEngine(fakeStore([target]))

    await expect(connectChain(engine as never, target))
      .rejects.toThrow("proxyJump hop 'ops@bastion.example.com:2222' (ops@bastion.example.com:2222): handshake dropped")
  })

  it('member forwarding through an ad-hoc address hop leaves the hop itself unforwarded', async () => {
    // Given a forwarding target that jumps through an address-form hop
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = '/tmp/dsh-ssh-hop-agent.sock'
    try {
      const target = passwordEntry('forward-target', { proxyJump: ['ops@bastion.example.com:2222'], forwardAgent: true })
      sshMock.behaviors.push((client) => { client.emit('ready') })
      sshMock.behaviors.push((client) => { client.emit('ready') })
      const engine = poolEngine(fakeStore([target]))

      // When the whole chain connects
      await connectChain(engine as never, target)

      // Then the ad-hoc hop carries no forwarding (it was never configured as
      // a Host), while the target session does forward
      const hopConfig = sshMock.instances[0]?.connectConfig as Record<string, unknown> | undefined
      const targetConfig = sshMock.instances[1]?.connectConfig as Record<string, unknown> | undefined
      expect(hopConfig?.['agentForward']).toBeUndefined()
      expect(hopConfig?.['agent']).toBeUndefined()
      expect(targetConfig?.['agentForward']).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('member forwarding through a configured alias hop gets that hop own forwarding setting', async () => {
    // Given a configured hop that enables forwarding and a plain target
    const previous = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = '/tmp/dsh-ssh-hop-agent.sock'
    try {
      const hop = passwordEntry('forwarding-bastion', { forwardAgent: true })
      const target = passwordEntry('plain-target', { proxyJump: ['forwarding-bastion'] })
      sshMock.behaviors.push((client) => { client.emit('ready') })
      sshMock.behaviors.push((client) => { client.emit('ready') })
      const engine = poolEngine(fakeStore([hop, target]))

      // When the whole chain connects
      await connectChain(engine as never, target)

      // Then each hop follows its own stored setting, not the target's
      const hopConfig = sshMock.instances[0]?.connectConfig as Record<string, unknown> | undefined
      const targetConfig = sshMock.instances[1]?.connectConfig as Record<string, unknown> | undefined
      expect(hopConfig?.['agentForward']).toBe(true)
      expect(hopConfig?.['agent']).toBe('/tmp/dsh-ssh-hop-agent.sock')
      expect(targetConfig?.['agentForward']).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = previous
    }
  })

  it('refuses a ProxyCommand on a hop that is not the first one', async () => {
    const hopA = passwordEntry('a', { proxyCommand: 'echo a' })
    const hopB = passwordEntry('b', { proxyCommand: 'echo b' })
    const target = passwordEntry('target', { proxyJump: ['a', 'b'] })
    sshMock.behaviors.push((client) => { client.emit('ready') })
    const engine = poolEngine(fakeStore([hopA, hopB, target]))

    await expect(connectChain(engine as never, target)).rejects.toThrow(/only supported on the first hop/)
    expect(sshMock.instances[0]?.endCalls).toBe(1)
  })

  it('refuses an entry that declares both transports (hand-edited store file)', async () => {
    const hop = passwordEntry('hop')
    const entry = passwordEntry('both', { proxyJump: ['hop'], proxyCommand: 'echo %h' })
    const engine = poolEngine(fakeStore([hop, entry]))

    await expect(connectChain(engine as never, entry)).rejects.toThrow(/both proxyCommand and proxyJump/)
    expect(sshMock.instances).toHaveLength(0)
  })
})

describe('parseJumpSpec', () => {
  it('parses [user@]host[:port] and rejects what is not an address', () => {
    expect(parseJumpSpec('bastion')).toEqual({ host: 'bastion' })
    expect(parseJumpSpec('ops@bastion.example.com:2222')).toEqual({ host: 'bastion.example.com', port: 2222, user: 'ops' })
    expect(parseJumpSpec('[::1]:22')).toEqual({ host: '::1', port: 22 })
    expect(parseJumpSpec('host:0')).toBeUndefined()
    expect(parseJumpSpec('host:not-a-port')).toBeUndefined()
    expect(parseJumpSpec('   ')).toBeUndefined()
  })
})
