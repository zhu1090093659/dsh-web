import { mkdtemp } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PAIR_TOKEN_PATH, WS_PATH } from '../src/core/protocol.ts'
import { apply } from '../src/index.ts'
import { nextTurn, settle } from './support/harness.ts'

const WEB_SOCKET_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='

/** One route as the host web server would have received it. */
interface RegisteredRoute {
  readonly kind: string
  readonly path: string
  readonly handler: (req: IncomingMessage, res: unknown) => void | Promise<void>
}

/** One upgrade route as the host web server would have received it. */
interface RegisteredUpgrade {
  readonly path: string
  readonly handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** What the mounted plugin registered on its fake host. */
interface FakeHost {
  readonly routes: RegisteredRoute[]
  readonly upgrades: RegisteredUpgrade[]
  readonly disposers: (() => void)[]
  readonly listeners: Map<string, unknown>
}

/** Every host this file is currently running, newest last. */
const mountedHosts: FakeHost[] = []

/**
 * A minimal `ctx`: the three services the plugin injects, the effect registry, and
 * the event bus. Nothing is patched or spied on — the plugin is mounted exactly as
 * the loader mounts it.
 */
function mountPlugin(): FakeHost {
  const routes: RegisteredRoute[] = []
  const upgrades: RegisteredUpgrade[] = []
  const disposers: (() => void)[] = []
  const listeners = new Map<string, unknown>()
  const ctx = {
    typertGateway: { invoke: async () => ({}), stream: async () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }) },
    webServer: {
      register: (route: RegisteredRoute) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      registerUpgrade: (route: RegisteredUpgrade) => {
        upgrades.push(route)
        return () => {
          const index = upgrades.indexOf(route)
          if (index >= 0) upgrades.splice(index, 1)
        }
      },
    },
    // The third injected service (protocol §35): this row registers the ui_present
    // tool when it mounts, so the fake only has to make that registration possible.
    tools: { register: () => () => undefined },
    effect: (callback: () => () => void) => { disposers.push(callback()); return () => undefined },
    on: (name: string, listener: unknown) => { listeners.set(name, listener); return () => undefined },
  } as unknown as Context
  const host: FakeHost = { routes, upgrades, disposers, listeners }
  mountedHosts.push(host)
  apply(ctx)
  return host
}

/** @returns the one registered upgrade handler, or throws. */
function upgradeHandlerOf(host: FakeHost): RegisteredUpgrade['handler'] {
  const route = host.upgrades.find(candidate => candidate.path === WS_PATH)
  if (route === undefined) throw new Error(`no upgrade route was registered for ${WS_PATH}`)
  return route.handler
}

/** A WebSocket upgrade request as the host would hand it over. */
function upgradeRequest(host = '127.0.0.1:3080', authorization?: string): IncomingMessage {
  return {
    url: WS_PATH,
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host,
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': WEB_SOCKET_KEY,
      ...(authorization === undefined ? {} : { authorization }),
    },
  } as unknown as IncomingMessage
}

/** A socket pair carrying a real byte stream in both directions. */
function socketPair(): { inbound: PassThrough; socket: Duplex; serverBytes: () => Buffer } {
  const inbound = new PassThrough()
  const outbound = new PassThrough()
  const chunks: Buffer[] = []
  outbound.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  return { inbound, socket: Duplex.from({ readable: inbound, writable: outbound }) as unknown as Duplex, serverBytes: () => Buffer.concat(chunks) }
}

/** One masked client frame. */
function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44])
  return Buffer.concat([
    Buffer.from([0x81, 0x80 | payload.length]),
    mask,
    Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0))),
  ])
}

/** Every unmasked server frame written after the handshake response. */
function serverFrames(bytes: Buffer): unknown[] {
  const boundary = bytes.indexOf(Buffer.from('\r\n\r\n'))
  let rest = bytes.subarray(boundary + 4)
  const answers: unknown[] = []
  while (rest.length >= 2) {
    let length = rest[1] ?? 0
    let offset = 2
    if (length === 126) {
      length = rest.readUInt16BE(2)
      offset = 4
    }
    answers.push(JSON.parse(rest.subarray(offset, offset + length).toString('utf8')) as unknown)
    rest = rest.subarray(offset + length)
  }
  return answers
}

describe('the mounted plugin', () => {
  let home: string

  beforeEach(async () => {
    // The device roster lives under DSH_HOME; point it at a temp directory so the
    // suite never reads or writes the roster of the DSH installation on this machine.
    home = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-plugin-'))
    process.env.DSH_HOME = home
  })

  afterEach(() => {
    // Newest first: a queued mount must die before the owner releases the package
    // name, or the release replays it into a context this suite is tearing down.
    for (const host of mountedHosts.splice(0).reverse()) for (const dispose of host.disposers) dispose()
    delete process.env.DSH_HOME
  })

  it('operator mounts the plugin and finds exactly the two frozen routes', () => {
    // Given the plugin mounted on a fake host
    const host = mountPlugin()
    // When the registrations are read
    const paths = [...host.upgrades.map(route => route.path), ...host.routes.map(route => route.path)].sort()
    // Then the WebSocket endpoint and the loopback token endpoint are the whole surface
    expect(paths).toEqual([PAIR_TOKEN_PATH, WS_PATH].sort())
    expect(host.routes[0]?.kind).toBe('exact')
    expect(host.listeners.has('approval/request')).toBe(true)
    expect(host.listeners.has('user-questions/request')).toBe(true)
  })

  it('user upgrading on the mounted route has the greeting answered over the socket', async () => {
    // Given the plugin mounted and a client that upgrades on /ios/v1
    const host = mountPlugin()
    const pair = socketPair()
    await upgradeHandlerOf(host)(upgradeRequest(), pair.socket, Buffer.alloc(0))
    // When the client greets
    pair.inbound.write(maskedTextFrame(JSON.stringify({ t: 'req', id: 1, m: 'hello', p: { proto: 1 } })))
    await nextTurn()
    await settle()
    // Then the answer came back out of the socket, as an unpaired connection
    expect(serverFrames(pair.serverBytes())).toEqual([
      { t: 'res', id: 1, ok: true, r: { proto: 1, minor: 22, server: 'dsh-remote-bridge', capabilities: ['session.snapshot.trim.v1', 'session.snapshot.page.v1', 'questions.v1', 'questions.list.v1', 'subagent.thread.v1', 'jobs.v1', 'agents.v1', 'delta.v1', 'session.list.omit-archived.v1', 'session.deep-history.v1', 'frame.deflate.v1', 'session.list.compact.v1', 'session.snapshot.since.v1', 'session.fork.v1', 'commands.v1', 'workspace.v1', 'session.admin.v1', 'squads.v1', 'push.v1', 'usage.v1', 'usage.stats.v1', 'ui.v1', 'ui.list.v1', 'session.attachment.path.v1'], resume: 'snapshot', auth: 'unpaired' } },
    ])
  })

  it('user upgrading with a frame in the request itself has it answered too', async () => {
    // Given the plugin mounted and an upgrade whose leftover bytes carry the greeting
    const host = mountPlugin()
    const pair = socketPair()
    const head = maskedTextFrame(JSON.stringify({ t: 'req', id: 2, m: 'hello', p: { proto: 1 } }))
    // When the upgrade is handed over
    await upgradeHandlerOf(host)(upgradeRequest(), pair.socket, head)
    await nextTurn()
    await settle()
    // Then those bytes were parsed rather than dropped on the floor
    const answers = serverFrames(pair.serverBytes()) as { id: number; ok: boolean }[]
    expect(answers.map(answer => answer.id)).toEqual([2])
    expect(answers[0]?.ok).toBe(true)
  })

  it('user upgrading a non-WebSocket request is refused without a route being reached', async () => {
    // Given the mounted plugin and a plain HTTP request that asks to upgrade
    const host = mountPlugin()
    const pair = socketPair()
    const plain = { url: WS_PATH, method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } } as unknown as IncomingMessage
    // When the handler takes it
    await upgradeHandlerOf(host)(plain, pair.socket, Buffer.alloc(0))
    await nextTurn()
    // Then the socket was answered with a refusal instead of being upgraded
    const written = pair.serverBytes().toString('latin1')
    expect(written.startsWith('HTTP/1.1 400')).toBe(true)
  })

  it('user upgrading a malformed handshake never lets that refusal reach the host as an uncaught error', async () => {
    // Given the mounted plugin and a refusal whose transport then fails while the
    // answer is on its way - the shape Linux produced when the write was torn down
    // mid-flight, where the abort escaped as the process's own uncaught exception.
    const host = mountPlugin()
    const pair = socketPair()
    const plain = { url: WS_PATH, method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } } as unknown as IncomingMessage
    // When the handler refuses and the socket reports the failure
    await upgradeHandlerOf(host)(plain, pair.socket, Buffer.alloc(0))
    await nextTurn()
    // Then the failure stayed on the socket: an 'error' with no listener would have
    // been thrown straight out of this emit and out of the refusal path.
    expect(() => { pair.socket.emit('error', new Error('aborted')) }).not.toThrow()
    expect(pair.serverBytes().toString('latin1').startsWith('HTTP/1.1 400')).toBe(true)
    expect(pair.socket.listenerCount('error')).toBeGreaterThan(0)
  })

  it('operator mounts a second source of the same package and only the first registers routes', () => {
    // Given a first source whose two routes are registered on the host
    const first = mountPlugin()
    expect([...first.upgrades.map(route => route.path), ...first.routes.map(route => route.path)].sort()).toEqual([PAIR_TOKEN_PATH, WS_PATH].sort())
    // When the same package is mounted again from a second source (the aggregate row beside a standalone install)
    const second = mountPlugin()
    // Then that mount is a no-op: the host half stays registered exactly once
    expect(second.upgrades).toEqual([])
    expect(second.routes).toEqual([])
  })

  it('operator disposes the owning mount and the waiting second source takes the routes over', async () => {
    // Given a second source queued behind the first, with nothing registered on its own host
    const first = mountPlugin()
    const second = mountPlugin()
    expect(second.upgrades).toEqual([])
    expect(second.routes).toEqual([])
    // When the owning source disposes
    for (const dispose of first.disposers) dispose()
    await nextTurn()
    // Then the queued mount was replayed and both routes are live on the second host
    expect([...second.upgrades.map(route => route.path), ...second.routes.map(route => route.path)].sort()).toEqual([PAIR_TOKEN_PATH, WS_PATH].sort())
  })

  it('operator unmounts the plugin and both routes are gone', () => {
    // Given a mounted plugin with its two routes registered
    const host = mountPlugin()
    // When the effect the plugin registered is disposed
    for (const dispose of host.disposers) dispose()
    // Then nothing is left registered on the host web server
    expect(host.routes).toEqual([])
    expect(host.upgrades).toEqual([])
  })

  it('operator registers anonymous auth policy on self-fenced pairing HTTP and WebSocket routes', () => {
    // Given a newly mounted remote-bridge host on a webServer that defaults routes to required auth
    const host = mountPlugin()

    // When inspecting the registered HTTP and WebSocket upgrade route descriptors
    const routeAuth = host.routes.map((route) => (route as { readonly auth?: string }).auth)
    const upgradeAuth = host.upgrades.map((route) => (route as { readonly auth?: string }).auth)

    // Then both routes explicitly opt into anonymous access for the plugin's own fence
    expect(routeAuth).toEqual(['anonymous'])
    expect(upgradeAuth).toEqual(['anonymous'])
  })
})
