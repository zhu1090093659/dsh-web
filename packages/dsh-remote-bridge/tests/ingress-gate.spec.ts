/**
 * The ingress gate against real sockets: a local HTTP server stands in for the
 * host's protocol listener, and every assertion is about what that stand-in did
 * or did not see.
 *
 * The four paths this file covers are the whole contract: one admitted upgrade
 * (forwarded, Host rewritten to the loopback authority), one upgrade outside
 * the whitelist (refused, never dialed), one plain request (refused even on the
 * whitelisted path, never dialed), and the predicate that decides between them.
 */
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import http from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import {
  INGRESS_BIND_HOST,
  INGRESS_NOT_FOUND_BODY,
  createIngressGate,
  isIngressPath,
} from '../src/host/ingress-gate.ts'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** The public origin a phone would dial through the tunnel. */
const PUBLIC_HOST = 'abcd1234abcd1234.dsh-market.com'

/** One request the upstream stand-in received. */
interface UpstreamCall {
  url: string
  host: string
  headers: http.IncomingHttpHeaders
}

interface UpstreamStandIn {
  port: number
  calls: UpstreamCall[]
  close(): Promise<void>
}

/** The host's protocol listener: records, answers 101, and echoes one frame. */
async function startUpstream(): Promise<UpstreamStandIn> {
  const calls: UpstreamCall[] = []
  const openSockets: import('node:net').Socket[] = []
  const server = http.createServer((request, response) => {
    calls.push({ url: request.url ?? '', host: String(request.headers.host ?? ''), headers: request.headers })
    response.statusCode = 200
    response.end('plain')
  })
  server.on('upgrade', (request: http.IncomingMessage, socket: import('node:net').Socket) => {
    calls.push({ url: request.url ?? '', host: String(request.headers.host ?? ''), headers: request.headers })
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + WS_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + 'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    openSockets.push(socket)
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    calls,
    async close() {
      for (const socket of openSockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  // Newest first: a socket is closed before the listener it was opened on.
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** One gate in front of the upstream stand-in. */
async function startGate(upstream: UpstreamStandIn) {
  const gate = createIngressGate({ upstreamHost: '127.0.0.1', upstreamPort: upstream.port })
  cleanups.push(() => { gate.stop() })
  const { port } = await gate.start()
  return { gate, port }
}

/** Dial one upgrade through the gate and report the status line it answered. */
function upgradeThrough(port: number, path: string): Promise<{ status: number; socket: import('node:net').Socket }> {
  const key = createHash('sha1').update(String(Math.random())).digest('base64')
  return new Promise((resolve) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path,
      headers: {
        host: PUBLIC_HOST,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-key': key,
        'sec-websocket-version': '13',
      },
    })
    request.on('upgrade', (response: http.IncomingMessage, socket: import('node:net').Socket) => {
      cleanups.push(() => { socket.destroy() })
      resolve({ status: response.statusCode ?? 0, socket })
    })
    request.on('response', (response: http.IncomingMessage) => {
      response.resume()
      resolve({ status: response.statusCode ?? 0, socket: undefined as unknown as import('node:net').Socket })
    })
    request.on('error', () => { resolve({ status: 0, socket: undefined as unknown as import('node:net').Socket }) })
    request.end()
  })
}

/** One raw request over a plain socket, for the refusal the client cannot parse. */
async function rawRequest(port: number, text: string): Promise<string> {
  const socket = connect({ host: '127.0.0.1', port })
  cleanups.push(() => { socket.destroy() })
  let seen = ''
  socket.on('data', (chunk: Buffer) => { seen += chunk.toString('utf8') })
  socket.on('error', () => undefined)
  socket.write(text)
  await once(socket, 'close').catch(() => undefined)
  return seen
}

describe('the gate forwards exactly one upgrade path', () => {
  it('operator: the whitelist matches the path, not a whole URL', () => {
    // Given the one path the protocol serves, whose query carries the ticket
    // When the predicate is asked about URLs around it
    // Then exactly that path passes
    expect(isIngressPath('/ios/v1')).toBe(true)
    expect(isIngressPath('/ios/v1?token=abc')).toBe(true)
    expect(isIngressPath('/ios/v1/extra')).toBe(false)
    expect(isIngressPath('/ios/v10')).toBe(false)
    expect(isIngressPath('/ios/v1/')).toBe(false)
    expect(isIngressPath('/api/pair/start')).toBe(false)
    expect(isIngressPath('/')).toBe(false)
    expect(isIngressPath('')).toBe(false)
  })

  it('operator: the gate only ever binds loopback', async () => {
    // Given a started gate
    const upstream = await startUpstream()
    cleanups.push(() => upstream.close())
    const { port } = await startGate(upstream)

    // When its port is read and a loopback client dials it
    // Then it took a real port on the loopback address and nothing else: the
    // constant is the bind, and a loopback client reaches it
    expect(INGRESS_BIND_HOST).toBe('127.0.0.1')
    expect(port).toBeGreaterThan(0)
    const socket = connect({ host: INGRESS_BIND_HOST, port })
    cleanups.push(() => { socket.destroy() })
    await once(socket, 'connect')
    expect(socket.remoteAddress).toBe('127.0.0.1')
  })

  it('operator: the served upgrade is piped and its Host rewritten', async () => {
    // Given a gate in front of the host's protocol listener
    const upstream = await startUpstream()
    cleanups.push(() => upstream.close())
    const { port } = await startGate(upstream)

    // When a phone's upgrade for the served path arrives through the gate
    const answer = await upgradeThrough(port, '/ios/v1?token=abc')

    // Then the gate dialed the upstream and handed it the loopback authority as
    // Host -- not the public origin the phone dialed -- while the path and its
    // query travelled untouched
    expect(answer.status).toBe(101)
    expect(upstream.calls.length).toBe(1)
    expect(upstream.calls[0].url).toBe('/ios/v1?token=abc')
    expect(upstream.calls[0].host).toBe('127.0.0.1:' + String(upstream.port))
  })

  it('operator: an upgrade outside the whitelist is refused and never dialed', async () => {
    // Given the same gate
    const upstream = await startUpstream()
    cleanups.push(() => upstream.close())
    const { port } = await startGate(upstream)

    // When an upgrade names another path
    const answer = await rawRequest(port, 'GET /api/pair/start HTTP/1.1\r\nHost: ' + PUBLIC_HOST
      + '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\n'
      + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n')

    // Then the gate answered 404 itself and the upstream saw nothing at all
    expect(answer).toContain('404 Not Found')
    expect(answer).toContain(INGRESS_NOT_FOUND_BODY)
    expect(upstream.calls).toEqual([])
  })

  it('operator: a plain request is refused even on the served path', async () => {
    // Given the same gate
    const upstream = await startUpstream()
    cleanups.push(() => upstream.close())
    const { port } = await startGate(upstream)

    // When a plain GET names the served path without upgrading
    const status = await new Promise<number>((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/ios/v1', headers: { host: PUBLIC_HOST } }, (response) => {
        response.resume()
        resolve(response.statusCode ?? 0)
      }).on('error', () => { resolve(0) })
    })

    // Then it is answered 404 by the gate: only the upgrade crosses this hop,
    // so there is no request shape in which it dials the upstream
    expect(status).toBe(404)
    expect(upstream.calls).toEqual([])
  })

  it('operator: stop closes the listener', async () => {
    // Given a started gate
    const upstream = await startUpstream()
    cleanups.push(() => upstream.close())
    const { gate, port } = await startGate(upstream)

    // When it is stopped
    gate.stop()

    // Then the port no longer accepts a connection
    const socket = connect({ host: '127.0.0.1', port })
    cleanups.push(() => { socket.destroy() })
    const [error] = await once(socket, 'error')
    expect(error).toBeInstanceOf(Error)
  })
})
