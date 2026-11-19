/**
 * The `dshSsh` service a sibling plugin reuses.
 *
 * These cases drive a REAL cordis registry: the plugin is mounted as its own
 * fiber, the dependent declares `ctx.inject(['dshSsh'], ...)`, and the
 * assertions are about what that dependent actually receives and loses — the
 * host inventory, the shared pool, and the moment the service is withdrawn with
 * the plugin's master switch or with the plugin itself.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { Config, apply } from '../src/index.ts'
import type { HostPayload } from '../src/protocol.ts'
import { DSH_SSH_API_VERSION, DSH_SSH_SERVICE, type DshSshService } from '../src/service.ts'
import { HostStore } from '../src/store.ts'
import { TEST_PASSWORD, TEST_USER, TestSshServer } from './helpers/ssh-server.ts'
import { TestSshd } from './helpers/sshd.ts'

/** The symbol the loader writes a volatile config value through. */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** Fields the service publishes for one host; every other entry field stays private. */
const PUBLIC_HOST_FIELDS = [
  'alias', 'auth', 'createdAt', 'description', 'environment', 'forwardAgent',
  'host', 'keyReady', 'location', 'port', 'proxyJump', 'tags', 'updatedAt', 'user',
]

/** Fields a stored host holds that must never reach a sibling plugin. */
const PRIVATE_HOST_FIELDS = ['agentPath', 'keyPath', 'passphrase', 'password', 'proxyCommand']

/** What a dependent plugin observed while its inject scope was loaded. */
interface DependentRecord {
  /** The face the scope was handed; undefined again once the scope unloaded. */
  service: DshSshService | undefined
  /** Number of times the scope loaded. */
  loads: number
  /** Number of times the scope was released. */
  releases: number
}

/** What the fake host services recorded: the tool names currently registered. */
interface FakeSurfaces {
  tools: string[]
}

/** Everything started since the last test, torn down in reverse order. */
const teardowns: Array<() => unknown> = []
/** Sandboxed DSH homes created by this suite. */
const homes: string[] = []
/** DSH home the process environment carried before this suite. */
const originalDshHome = process.env.DSH_HOME

/**
 * Track a cleanup, so a failing assertion still releases the fiber, the server
 * and the temp directory.
 * @param teardown - the cleanup to run after this test.
 */
function track(teardown: () => unknown): void {
  teardowns.push(teardown)
}

/**
 * Point DSH_HOME at a fresh sandbox directory.
 * @returns the directory (the store file appears on the first write).
 */
function useDshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-ssh-service-'))
  homes.push(home)
  process.env.DSH_HOME = home
  return home
}

/**
 * Write one host entry through the plugin's own store, the way the GUI does.
 * @param payload - the entry to create.
 */
function seedHost(payload: HostPayload): void {
  new HostStore().create(payload)
}

/**
 * Serve the three host services the plugin injects.
 * @param root - the context to provide them on.
 * @param surfaces - the recorder the fake tool registry reports into.
 */
function provideHostServices(root: Context, surfaces: FakeSurfaces): void {
  root.provide('webServer', {
    register: () => () => undefined,
    registerUpgrade: () => () => undefined,
  } as never)
  root.provide('tools', {
    register: (tool: { name: string }) => {
      surfaces.tools.push(tool.name)
      return () => {
        const at = surfaces.tools.indexOf(tool.name)
        if (at >= 0) surfaces.tools.splice(at, 1)
      }
    },
  } as never)
  root.provide('systemPrompt', { section: () => () => undefined } as never)
}

/**
 * Mount the plugin in its own fiber, the way the Host mounts a row.
 * @param root - the registry root.
 * @param config - the resolved config the row was activated with.
 * @returns the mounted context and its unload.
 */
async function mountPlugin(root: Context, config: unknown): Promise<{ ctx: Context; dispose: () => Promise<void> }> {
  const fiber = root.plugin(apply, config as never)
  await settle()
  return {
    ctx: fiber.ctx,
    dispose: async () => {
      await fiber.dispose()
      await settle()
    },
  }
}

/**
 * Load a dependent plugin that declares the service, exactly as a sibling
 * package would.
 * @param root - the registry root.
 * @param record - what the dependent observed.
 * @returns the dependent's unload.
 */
function mountDependent(root: Context, record: DependentRecord): { dispose: () => Promise<void> } {
  const fiber = root.inject([DSH_SSH_SERVICE], (scoped) => {
    record.service = scoped.dshSsh
    record.loads += 1
    return () => {
      record.service = undefined
      record.releases += 1
    }
  })
  return {
    dispose: async () => {
      await fiber.dispose()
      await settle()
    },
  }
}

/**
 * A dependent record with nothing observed yet.
 * @returns the record.
 */
function dependentRecord(): DependentRecord {
  return { service: undefined, loads: 0, releases: 0 }
}

/**
 * Let cordis fiber transitions settle (load, unload and their nested awaits).
 * @param turns - microtask turns to yield.
 */
async function settle(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve()
}

/**
 * The face a dependent's scope was handed, or a failure naming the wiring.
 * @param record - what the dependent observed.
 * @returns the published service.
 */
function publishedService(record: DependentRecord): DshSshService {
  if (record.service === undefined) throw new Error('the dependent scope never received the dshSsh service')
  return record.service
}

/**
 * Mount a plugin plus one dependent that loads its service.
 * @param root - the registry root.
 * @param surfaces - the recorder the fake host services report into.
 * @returns the mounted plugin, the dependent record, and the config the row was activated with.
 */
async function mountBoth(root: Context, surfaces: FakeSurfaces, config: unknown = Config({})): Promise<{
  plugin: { ctx: Context; dispose: () => Promise<void> }
  record: DependentRecord
}> {
  const plugin = await mountPlugin(root, config)
  track(() => plugin.dispose())
  const record = dependentRecord()
  const dependent = mountDependent(root, record)
  track(() => dependent.dispose())
  await settle()
  return { plugin, record }
}

describe('dshSsh service', () => {
  it('operator\'s sibling plugin resolves dshSsh through ctx.inject and drives the configured host', async () => {
    // Given a host machine in this machine's store and a host process serving the plugin's surfaces
    useDshHome()
    const root = new Context()
    provideHostServices(root, { tools: [] })
    const server = await TestSshServer.start()
    track(() => server.stop())
    seedHost({
      alias: 'build-box',
      host: '127.0.0.1',
      port: server.port,
      user: TEST_USER,
      auth: { kind: 'password', password: TEST_PASSWORD },
      description: 'nightly builder',
      environment: 'staging',
      tags: ['build'],
      location: 'lab',
    })
    const { record } = await mountBoth(root, { tools: [] })

    // When the dependent reads the inventory and runs a command through the service
    const face = publishedService(record)
    const hosts = face.hosts.list()
    const found = face.hosts.find('build-box')
    const result = await face.exec('build-box', 'echo hello', { timeoutMs: 10_000 })

    // Then it sees the operator's host and the command ran over the shared pool
    expect(hosts.map(host => host.alias)).toEqual(['build-box'])
    expect(found).toEqual(hosts[0])
    expect(result.success).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hello\n')
    expect(face.apiVersion).toBe(DSH_SSH_API_VERSION)
    expect(face.hosts.find('never-configured')).toBeUndefined()
  })

  it('operator\'s sibling plugin cannot reach a host the operator never configured', async () => {
    // Given an empty store and a running plugin
    useDshHome()
    const root = new Context()
    provideHostServices(root, { tools: [] })
    const { record } = await mountBoth(root, { tools: [] })

    // When the dependent reads the inventory and resolves any alias
    const face = publishedService(record)

    // Then the inventory is empty and no alias resolves
    expect(face.hosts.list()).toEqual([])
    expect(face.hosts.find('build-box')).toBeUndefined()
  })

  it('operator\'s sibling plugin never receives credentials or the ProxyCommand text', async () => {
    // Given hosts using a password, an encrypted key and an agent, one of them behind a ProxyCommand
    useDshHome()
    const root = new Context()
    provideHostServices(root, { tools: [] })
    seedHost({
      alias: 'password-host',
      host: '10.0.0.1',
      port: 22,
      user: 'root',
      auth: { kind: 'password', password: 'hunter2-secret' },
      description: 'password auth',
      environment: 'production',
      tags: ['web'],
      location: 'dc-a',
    })
    seedHost({
      alias: 'key-host',
      host: '10.0.0.2',
      port: 2222,
      user: 'deploy',
      auth: { kind: 'key', keyPath: '/home/operator/.ssh/id_ed25519', passphrase: 'keypassphrase-secret' },
      description: 'key auth',
      environment: 'production',
      tags: ['db'],
      location: 'dc-b',
    })
    seedHost({
      alias: 'proxy-host',
      host: '10.0.0.3',
      port: 22,
      user: 'ops',
      auth: { kind: 'agent', agentPath: 'SSH_AUTH_SOCK' },
      proxyCommand: 'corp-vpn proxy %h %p %r --token bastion-token-secret',
      description: 'through the bastion',
      environment: 'production',
      tags: ['internal'],
      location: 'dc-c',
    })
    // The store's own projection does carry the ProxyCommand text, so the
    // service face is what strips it rather than the file never holding it.
    const store = new HostStore()
    const stored = store.list().map(entry => store.summarize(entry))
    expect(stored.some(host => host.proxyCommand?.includes('bastion-token-secret') === true)).toBe(true)
    const { record } = await mountBoth(root, { tools: [] })

    // When the dependent reads the whole inventory
    const face = publishedService(record)
    const hosts = face.hosts.list()
    const serialized = JSON.stringify(hosts)

    // Then every host carries exactly the public field set and no secret value rides along
    expect(hosts.map(host => host.alias)).toEqual(['password-host', 'key-host', 'proxy-host'])
    for (const host of hosts) expect(Object.keys(host).sort()).toEqual(PUBLIC_HOST_FIELDS)
    for (const host of hosts) {
      for (const field of PRIVATE_HOST_FIELDS) expect(Object.hasOwn(host, field)).toBe(false)
    }
    for (const secret of ['hunter2-secret', 'keypassphrase-secret', 'id_ed25519', 'bastion-token-secret', 'corp-vpn']) {
      expect(serialized.includes(secret)).toBe(false)
    }
    expect(hosts[0]?.auth).toBe('password')
    expect(hosts[1]?.auth).toBe('key')
    expect(hosts[1]?.keyReady).toBe(false)
    expect(hosts[2]?.auth).toBe('agent')
  })

  it('operator unloading dsh-ssh withdraws the service and releases the dependent scope', async () => {
    // Given a running plugin whose service a sibling plugin has loaded
    useDshHome()
    const root = new Context()
    const surfaces: FakeSurfaces = { tools: [] }
    provideHostServices(root, surfaces)
    const { plugin, record } = await mountBoth(root, surfaces)
    expect(record.loads).toBe(1)
    expect(record.releases).toBe(0)

    // When dsh-ssh is unloaded
    await plugin.dispose()

    // Then the service left the registry and the dependent scope was released
    expect(record.releases).toBe(1)
    expect(record.service).toBeUndefined()
    expect(root.get(DSH_SSH_SERVICE)).toBeUndefined()
    expect(surfaces.tools).toEqual([])
  })

  it('operator turning the master switch off withdraws the service and turning it back on restores it', async () => {
    // Given a running instance whose service a sibling plugin has loaded
    useDshHome()
    const root = new Context()
    const surfaces: FakeSurfaces = { tools: [] }
    provideHostServices(root, surfaces)
    const config = Config({})
    const { plugin, record } = await mountBoth(root, surfaces, config)
    expect(record.loads).toBe(1)
    const reference = config.enabled as unknown as Record<symbol, (next: boolean) => void>

    // When the operator turns the plugin off and the loader commits that edit
    reference[VOLATILE_WRITE](false)
    plugin.ctx.emit('loader/volatile-update', [['enabled']])
    await settle()

    // Then the service is withdrawn with the rest of the surfaces and the dependent is released
    expect(record.releases).toBe(1)
    expect(record.service).toBeUndefined()
    expect(root.get(DSH_SSH_SERVICE)).toBeUndefined()
    expect(surfaces.tools).toEqual([])

    // When the operator turns it back on through the same switch
    reference[VOLATILE_WRITE](true)
    plugin.ctx.emit('loader/volatile-update', [['enabled']])
    await settle()

    // Then the service returns and the dependent loads it again
    expect(record.loads).toBe(2)
    expect(publishedService(record).apiVersion).toBe(DSH_SSH_API_VERSION)
    expect(surfaces.tools).toHaveLength(6)
  })
})

describe.skipIf(process.platform === 'win32' || !existsSync('/usr/sbin/sshd'))('dshSsh transfers over a real sshd', () => {
  it('operator\'s sibling plugin uploads a file, reads it remotely, and downloads it back', async () => {
    // Given a real sshd host and a local file to move
    useDshHome()
    const root = new Context()
    provideHostServices(root, { tools: [] })
    const sshd = await TestSshd.start()
    track(() => sshd.stop())
    seedHost({
      alias: 'sshd-box',
      host: '127.0.0.1',
      port: sshd.port,
      user: process.env.USER ?? 'root',
      auth: { kind: 'key', keyPath: sshd.clientKey },
    })
    const localSource = join(sshd.root, 'payload.txt')
    const content = 'dshSsh transfer payload'
    writeFileSync(localSource, content, 'utf8')
    const remotePath = join(sshd.root, 'up', 'payload.txt')
    const localTarget = join(sshd.root, 'payload.back.txt')
    const { record } = await mountBoth(root, { tools: [] })

    // When the dependent uploads it, reads it through the pool, and downloads it back
    const face = publishedService(record)
    const uploaded = await face.upload('sshd-box', localSource, remotePath)
    const remote = await face.exec('sshd-box', 'cat ' + remotePath, { timeoutMs: 20_000 })
    const downloaded = await face.download('sshd-box', remotePath, localTarget)

    // Then both directions moved the whole file and the remote copy matches
    expect(uploaded.bytes).toBe(content.length)
    expect(remote.success).toBe(true)
    expect(remote.stdout).toBe(content)
    expect(downloaded.bytes).toBe(content.length)
    expect(readFileSync(localTarget, 'utf8')).toBe(content)
  })
})

afterEach(async () => {
  for (const teardown of teardowns.splice(0).reverse()) await teardown()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})
