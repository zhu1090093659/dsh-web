/**
 * A scripted DevTools endpoint: the HTTP `/json/version` discovery answer and
 * the WebSocket that carries protocol traffic, on one loopback port.
 *
 * The transport under test is the real one — real socket, real handshake, real
 * frames — and only the browser is missing, which is what keeps these tests
 * runnable on a machine without Chrome while still covering the client's own
 * deadlines instead of a mocked socket's.
 *
 * @module tests/helpers/fake-cdp-endpoint
 */

import { createServer } from 'node:http'
import { createServer as createTcpServer, type Socket } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'

/** One protocol command the endpoint received. */
export interface EndpointFrame {
  method: string
  params: Record<string, unknown>
  sessionId: string | undefined
}

/** What the scripted endpoint should answer. */
export interface FakeCdpEndpointOptions {
  /**
   * Method to immediate result. A method absent here is never answered, which
   * is how a caller observes a command deadline.
   */
  answers?: Record<string, unknown>
}

/** One running fake endpoint. */
export interface FakeCdpEndpoint {
  /** Origin to hand to `fetchCdpVersion` and to the service configuration. */
  httpUrl: string
  /** DevTools WebSocket URL the version document advertises. */
  wsUrl: string
  /** Every protocol command received, in order. */
  received: EndpointFrame[]
  /** Stop listening and drop every open socket. */
  close(): Promise<void>
}

/** Read the port an ephemeral loopback listener was granted. */
function portOf(server: { address(): { port: number } | string | null }): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fake endpoint got no port')
  return address.port
}

/**
 * Start the scripted endpoint.
 * @param options - the methods it answers.
 * @returns the running endpoint with its URLs and received frames.
 */
export async function startFakeCdpEndpoint(options: FakeCdpEndpointOptions = {}): Promise<FakeCdpEndpoint> {
  const received: EndpointFrame[] = []
  const sockets = new Set<WebSocket>()
  const answers = options.answers ?? {}
  // The version document is only ever read after the caller knows the origin,
  // so filling this in after `listen` is safe and keeps one port for both sides.
  let wsUrl = ''
  const http = createServer((request, response) => {
    if (request.url !== '/json/version') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ Browser: 'FakeCdp/1.0', webSocketDebuggerUrl: wsUrl }))
  })
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => { sockets.delete(socket) })
    socket.on('message', data => {
      const message = JSON.parse(data.toString()) as {
        id?: unknown
        method?: unknown
        params?: unknown
        sessionId?: unknown
      }
      if (typeof message.method !== 'string' || typeof message.id !== 'number') return
      received.push({
        method: message.method,
        params: (message.params ?? {}) as Record<string, unknown>,
        sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
      })
      if (!Object.hasOwn(answers, message.method)) return
      socket.send(JSON.stringify({ id: message.id, result: answers[message.method] ?? {} }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', () => {
      http.off('error', reject)
      resolve()
    })
  })
  const httpUrl = `http://127.0.0.1:${portOf(http)}`
  wsUrl = `ws://127.0.0.1:${portOf(http)}/devtools/browser/fake`
  return {
    httpUrl,
    wsUrl,
    received,
    async close() {
      for (const socket of [...sockets]) socket.terminate()
      await new Promise<void>(resolve => { wss.close(() => { resolve() }) })
      await new Promise<void>(resolve => { http.close(() => { resolve() }) })
    },
  }
}

/** One TCP listener that accepts a connection and never answers the upgrade. */
export interface SilentEndpoint {
  /** DevTools WebSocket URL nothing will ever complete a handshake on. */
  wsUrl: string
  /** Stop listening. */
  close(): Promise<void>
}

/**
 * Start a listener that accepts connections and never completes a handshake.
 * @returns the endpoint and the shutdown hook.
 */
export async function startSilentEndpoint(): Promise<SilentEndpoint> {
  const open = new Set<Socket>()
  const server = createTcpServer(socket => {
    // Accept and stay silent: an unfinished handshake is exactly what the
    // handshake deadline exists for, and dropping the socket would test a reset.
    open.add(socket)
    socket.on('close', () => { open.delete(socket) })
    socket.on('error', () => { open.delete(socket) })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return {
    wsUrl: `ws://127.0.0.1:${portOf(server)}/devtools/browser/fake`,
    async close() {
      for (const socket of [...open]) socket.destroy()
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    },
  }
}
