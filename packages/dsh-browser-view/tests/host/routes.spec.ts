/**
 * Route-family tests: the loopback fence on both the status route and the
 * socket upgrade, the first-frame protocol gate, and the rule that a malformed
 * frame after the handshake costs an error event rather than the stream.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BROWSER_VIEW_API_VERSION,
  BROWSER_VIEW_SOCKET_PATH,
  type BrowserViewCommand,
  type BrowserViewEvent,
} from '../../src/core/protocol.ts'
import {
  BROWSER_VIEW_STATE_PATH,
  PROTOCOL_MISMATCH_CLOSE_CODE,
  handleClientFrame,
  makeRoutes,
} from '../../src/host/routes.ts'
import type { BrowserViewBackend, BrowserViewSink } from '../../src/host/service.ts'
import { waitForSignal, waitUntil } from '../helpers/wait.ts'

/**
 * Read the admission policy a route declares. The SDK cohort this package
 * compiles against does not type the field; hosts that enforce it do read it.
 * @param route - one registered route or upgrade.
 * @returns the declared policy, or undefined when the route declares none.
 */
function authOf(route: object): unknown {
  return (route as { readonly auth?: unknown }).auth
}

/** A backend that records what reached it and answers like the real one. */
class StubBackend implements BrowserViewBackend {
  readonly sinks: BrowserViewSink[] = []
  readonly commands: BrowserViewCommand[] = []
  readonly detached: number[] = []
  private events: BrowserViewEvent[] = []

  state(): { tabs: []; activeTabId: null; running: boolean } {
    return { tabs: [], activeTabId: null, running: this.sinks.length > 0 }
  }

  attach(sink: BrowserViewSink): () => void {
    this.sinks.push(sink)
    return () => { this.detached.push(this.sinks.length) }
  }

  async handleCommand(_sink: BrowserViewSink, command: BrowserViewCommand): Promise<void> {
    this.commands.push(command)
  }

  /** Events a sink received, for assertions that do not go through a socket. */
  sentTo(index: number): BrowserViewEvent[] {
    void index
    return this.events
  }

  /** Swallow events in the pure-gate tests where nothing listens on a socket. */
  record(event: BrowserViewEvent): void {
    this.events.push(event)
  }
}

/** A sink that only records, for the pure gate tests. */
function recordingSink(): { events: BrowserViewEvent[]; sink: BrowserViewSink } {
  const events: BrowserViewEvent[] = []
  return {
    events,
    sink: {
      send: (event: BrowserViewEvent) => { events.push(event) },
      close: () => undefined,
    },
  }
}

describe('first-frame protocol gate', () => {
  it('operator opens a socket that declares another version and the host closes it with the mismatch code', async () => {
    // Given a backend and a recording sink
    // When the first frame declares version 2
    // Then the handler asks for a close, one error event carries protocol-mismatch and the backend receives no command
    const backend = new StubBackend()
    const { events, sink } = recordingSink()
    const next = await handleClientFrame(backend, sink, JSON.stringify({ v: 2, kind: 'attach' }), true)
    expect(next).toBe('close')
    expect(events).toEqual([{
      v: 1,
      kind: 'error',
      code: 'protocol-mismatch',
      message: `unsupported protocol version 2; this host speaks version ${BROWSER_VIEW_API_VERSION}`,
    }])
    expect(backend.commands).toEqual([])
  })

  it('operator opens a socket whose first frame omits the version and the host closes it', async () => {
    // Given a recording sink
    // When the first frame carries no version
    // Then the handler resolves to close
    const backend = new StubBackend()
    const { sink } = recordingSink()
    await expect(handleClientFrame(backend, sink, JSON.stringify({ kind: 'attach' }), true)).resolves.toBe('close')
  })

  it('operator sends a valid first frame and the backend receives that command', async () => {
    // Given a backend
    // When a valid attach frame arrives
    // Then the handler accepts it and the backend receives exactly that command
    const backend = new StubBackend()
    const { sink } = recordingSink()
    const next = await handleClientFrame(backend, sink, JSON.stringify({ v: 1, kind: 'attach', sessionId: 's-1' }), true)
    expect(next).toBe('accept')
    expect(backend.commands).toEqual([{ v: 1, kind: 'attach', sessionId: 's-1' }])
  })

  it('operator sends unparseable frames and the socket survives after the first one', async () => {
    // Given two unparseable frames
    // When the first arrives as the handshake and the second after it
    // Then the handshake closes, the later frame is accepted and both produce invalid-payload
    const backend = new StubBackend()
    const { events, sink } = recordingSink()
    const first = await handleClientFrame(backend, sink, 'not json', true)
    const later = await handleClientFrame(backend, sink, 'still not json', false)
    expect(first).toBe('close')
    expect(later).toBe('accept')
    expect(events.map(event => event.kind === 'error' ? event.code : event.kind)).toEqual(['invalid-payload', 'invalid-payload'])
  })

  it('operator sends an unknown command and receives an error event without a close', async () => {
    // Given an attached session
    // When an unknown command arrives
    // Then the handler accepts the frame, one invalid-command error is sent and the backend receives nothing
    const backend = new StubBackend()
    const { events, sink } = recordingSink()
    const next = await handleClientFrame(backend, sink, JSON.stringify({ v: 1, kind: 'explode' }), false)
    expect(next).toBe('accept')
    expect(events).toEqual([{
      v: 1,
      kind: 'error',
      code: 'invalid-command',
      message: 'unsupported command explode',
    }])
    expect(backend.commands).toEqual([])
  })

  it('operator sends a command with a wrongly typed payload and the backend sees nothing', async () => {
    // Given an attached session
    // When select-tab carries a numeric tab id
    // Then the handler accepts the frame and the backend receives no command
    const backend = new StubBackend()
    const { sink } = recordingSink()
    await expect(handleClientFrame(backend, sink, JSON.stringify({ v: 1, kind: 'select-tab', tabId: 7 }), false))
      .resolves.toBe('accept')
    expect(backend.commands).toEqual([])
  })
})

describe('route admission declarations', () => {
  it('operator mounts the family on a host that defaults routes to required admission and both surfaces are self-fenced', () => {
    // Given the route family every Host builds
    const { routes, upgrade } = makeRoutes({ backend: new StubBackend() })

    // When the host applies its own admission policy to each surface
    // Then both declare anonymous admission and keep the loopback fence in their handlers
    expect(routes.map(route => ({ path: route.path, auth: authOf(route) }))).toEqual([
      { path: BROWSER_VIEW_STATE_PATH, auth: 'anonymous' },
    ])
    expect(authOf(upgrade)).toBe('anonymous')
  })
})

describe('loopback fence over a real server', () => {
  let server: Server
  let port: number
  let backend: StubBackend

  beforeAll(async () => {
    backend = new StubBackend()
    const { routes, upgrade } = makeRoutes({ backend })
    server = createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      const route = routes.find(candidate => candidate.kind === 'exact' && candidate.path === path)
      if (route === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      void route.handler(req, res)
    })
    server.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname
      if (path === upgrade.path) {
        void upgrade.handler(req, socket, head)
      } else {
        socket.destroy()
      }
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>(resolve => { server.close(() => resolve()) })
  })

  const get = (headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number }> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: BROWSER_VIEW_STATE_PATH, headers, method }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      })
      req.on('error', reject)
      req.end()
    })

  it('operator reads the state route from loopback and receives 200', async () => {
    // Given a real server behind the routes
    // When the state route is read from loopback
    // Then the answer is 200
    expect((await get()).status).toBe(200)
  })

  it('operator sends a cross-site request and the fence answers 403', async () => {
    // Given a real server behind the routes
    // When the request marks itself cross-site
    // Then the answer is 403
    expect((await get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  })

  it('operator sends a forwarded request and the fence answers 403', async () => {
    // Given a real server behind the routes
    // When the request carries a forwarded-for header
    // Then the answer is 403
    expect((await get({ 'x-forwarded-for': '10.0.0.1' })).status).toBe(403)
  })

  it('operator sends a non-loopback Host header and the fence answers 403', async () => {
    // Given a real server behind the routes
    // When the Host header names another host
    // Then the answer is 403
    expect((await get({ host: 'evil.example.com' })).status).toBe(403)
  })

  it('operator posts to the state route and the fence answers 405', async () => {
    // Given a real server behind the routes
    // When the state route is posted to
    // Then the answer is 405
    expect((await get({}, 'POST')).status).toBe(405)
  })

  it('operator upgrades from a cross-site origin and the handshake dies with 403', async () => {
    // Given a real server behind the routes
    // When a cross-site upgrade is attempted
    // Then the handshake fails with 403 and no sink attaches
    const socket = new WebSocket(`ws://127.0.0.1:${port}${BROWSER_VIEW_SOCKET_PATH}`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    const outcome = await new Promise<string>((resolve) => {
      socket.on('open', () => resolve('opened'))
      socket.on('error', (error: Error) => resolve(error.message))
    })
    socket.terminate()
    expect(outcome).toMatch(/403/)
    expect(backend.sinks).toHaveLength(0)
  })

  it('operator attaches with another protocol version and the host closes the upgrade', async () => {
    // Given a real server behind the routes
    // When the client attaches with version 9
    // Then a protocol-mismatch error arrives and the socket closes with the mismatch code
    const socket = new WebSocket(`ws://127.0.0.1:${port}${BROWSER_VIEW_SOCKET_PATH}`)
    const received: BrowserViewEvent[] = []
    socket.on('message', (data: WebSocket.RawData) => { received.push(JSON.parse(data.toString()) as BrowserViewEvent) })
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve())
      socket.on('error', (error: Error) => reject(error))
    })
    socket.send(JSON.stringify({ v: 9, kind: 'attach' }))
    // Waiting on the close event, bounded: a socket that never closes fails
    // with a named error instead of a fixed sleep standing in for the wait.
    const code = await waitForSignal<number>('the host to close the upgrade', (settle) => {
      socket.on('close', (closeCode: number) => settle(closeCode))
    })
    expect(received[0]).toMatchObject({ kind: 'error', code: 'protocol-mismatch' })
    expect(code).toBe(PROTOCOL_MISMATCH_CLOSE_CODE)
  })

  it('operator attaches a session and its commands reach the backend while the gate answers the rest', async () => {
    // Given a real server behind the routes
    // When a session attaches, then requests a frame, then sends an unknown command
    // Then the backend receives attach and request-frame in order and the gate answers the unknown one with invalid-command
    const socket = new WebSocket(`ws://127.0.0.1:${port}${BROWSER_VIEW_SOCKET_PATH}`)
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve())
      socket.on('error', (error: Error) => reject(error))
    })
    socket.send(JSON.stringify({ v: 1, kind: 'attach', sessionId: 'session-routes' }))
    await waitUntil('the backend to receive the attach command', () => backend.commands.some(command => command.kind === 'attach'))
    socket.send(JSON.stringify({ v: 1, kind: 'request-frame' }))
    await waitUntil('the backend to receive the request-frame command', () => backend.commands.some(command => command.kind === 'request-frame'))
    socket.send(JSON.stringify({ v: 1, kind: 'nonsense' }))
    // Resolving on the error event rather than after a pause: the collected
    // list is handed over the moment the gate answers the unknown command.
    const errors = await waitForSignal<BrowserViewEvent[]>('the gate to answer the unknown command', (settle) => {
      const collected: BrowserViewEvent[] = []
      socket.on('message', (data: WebSocket.RawData) => {
        const event = JSON.parse(data.toString()) as BrowserViewEvent
        collected.push(event)
        if (event.kind === 'error') settle(collected)
      })
    })
    socket.terminate()
    // The unknown command never reaches the backend: the gate answers it first.
    expect(backend.commands.slice(-2).map(command => command.kind)).toEqual(['attach', 'request-frame'])
    expect(errors.at(-1)).toMatchObject({ kind: 'error', code: 'invalid-command' })
  })
})
