/**
 * The LAN edge the lan-bind toggle owns (issue #1917).
 *
 * The toggle used to pin the LAN address into the profile's webserver row. That
 * row is the only place the harness takes its bind from, and rewriting it
 *   - replaced the official row's whole config (so the row's own
 *     `host: !!js ctx.webStartup.host ?? '127.0.0.1'` expression and the CLI
 *     `--host`/`--port` never reached it), and
 *   - the profile patch is watched by the Host's HMR config watcher, so the
 *     write recomposed the running process and rebound the live listener.
 *
 * This module keeps the host bound to loopback and gives LAN clients their own
 * listener: a forwarder on the machine's LAN address, on the same port, that
 * re-issues every request (HTTP and WebSocket upgrade alike) to
 * `127.0.0.1:<port>`. Two consequences are load-bearing:
 *
 * 1. The upstream leg is loopback, so the socket alone would read as "the
 *    desktop". The forwarder therefore DROPS whatever Host the client sent and
 *    stamps the LAN authority it was reached at, plus `X-Forwarded-For`. Every
 *    fence that decides "is this the desktop" (`isLoopbackClient`, the pairing
 *    gate, the `/remote` gate) then keeps refusing the forwarded request, while
 *    the phone-facing fences still match the LAN authority the QR advertises.
 * 2. A bind that cannot be taken (address gone after a network change, port
 *    taken) only loses the LAN edge: the loopback listener is never touched, so
 *    the host cannot be bricked and the failure is reported on the status
 *    frame.
 *
 * Nothing here writes a file: the forwarder is runtime state, so a network
 * change needs no profile edit and no restart.
 *
 * @module dsh-remote-bridge/host/lan-forward
 */

import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'

/** The upstream the forwarder re-issues to: the process's own loopback listener. */
export const FORWARD_UPSTREAM_HOST = '127.0.0.1'

/**
 * Headers that describe one hop rather than the request. They are rebuilt for
 * each leg so a keep-alive or upgrade marker from the client never leaks into
 * the loopback leg (and vice versa on the response).
 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/**
 * Headers the forwarder owns: a client-supplied value is discarded, never
 * appended to, so a LAN client cannot claim to be the desktop by forging them.
 */
const REWRITTEN = new Set(['host', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'cf-connecting-ip'])

/** What the forwarder is doing right now, for the status frame and the logs. */
export interface LanForwardState {
  /** Whether the LAN listener is bound. */
  listening: boolean
  /** The LAN address it listens on (undefined when it never bound). */
  address: string | undefined
  /** The port it listens on (the web server's own port). */
  port: number | undefined
  /** The loopback port it re-issues to. */
  upstreamPort: number | undefined
  /** Why the last bind attempt failed, when it did. */
  error: string | undefined
}

/** The idle state: nothing bound, nothing failed. */
export const IDLE_FORWARD_STATE: LanForwardState = {
  listening: false,
  address: undefined,
  port: undefined,
  upstreamPort: undefined,
  error: undefined,
}

/**
 * The `Host` authority a listener at `address:port` is reached at. IPv6
 * literals are bracketed like any URL authority.
 * @param address - the listen address (a literal).
 * @param port - the listen port.
 * @returns the authority text a request to that listener carries.
 */
export function authorityOf(address: string, port: number): string {
  const host = address.includes(':') ? `[${address}]` : address
  return `${host}:${String(port)}`
}

/**
 * The headers the loopback leg carries for one request: the client's own
 * headers minus the hop-by-hop and forwarder-owned ones, plus the LAN authority
 * the client actually reached and its address.
 * @param request - the request as it arrived on the LAN listener.
 * @param authority - the LAN authority the forwarder listens at.
 * @param clientAddress - the client's socket address, when readable.
 * @returns the headers for the loopback request.
 */
export function forwardedHeaders(
  request: IncomingMessage,
  authority: string,
  clientAddress: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (HOP_BY_HOP.has(lower) || REWRITTEN.has(lower)) continue
    headers[lower] = Array.isArray(value) ? value.join(', ') : value
  }
  headers.host = authority
  if (clientAddress !== undefined && clientAddress !== '') headers['x-forwarded-for'] = clientAddress
  headers['x-forwarded-proto'] = 'http'
  return headers
}

/**
 * Rebuild a WebSocket handshake for the loopback leg. The client's own headers
 * travel through verbatim (so `Sec-WebSocket-*` and any application protocol
 * survive) except the ones the forwarder owns.
 * @param request - the upgrade request as it arrived on the LAN listener.
 * @param authority - the LAN authority the forwarder listens at.
 * @param clientAddress - the client's socket address, when readable.
 * @returns the handshake request head to write on the loopback leg.
 */
export function forwardedHandshake(
  request: IncomingMessage,
  authority: string,
  clientAddress: string | undefined,
): string {
  const lines = [`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/1.1`]
  const raw = request.rawHeaders
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const name = raw[index] ?? ''
    const lower = name.toLowerCase()
    if (REWRITTEN.has(lower)) continue
    lines.push(`${name}: ${raw[index + 1] ?? ''}`)
  }
  lines.push(`Host: ${authority}`)
  if (clientAddress !== undefined && clientAddress !== '') lines.push(`X-Forwarded-For: ${clientAddress}`)
  lines.push('X-Forwarded-Proto: http')
  return `${lines.join('\r\n')}\r\n\r\n`
}

/** One listener, its live connections, and its last bind outcome. */
export class LanForwarder {
  private server: Server | undefined
  private config: { address: string; port: number; upstreamPort: number } | undefined
  private state: LanForwardState = IDLE_FORWARD_STATE
  /** Every socket this forwarder opened on either leg. */
  private readonly sockets = new Set<Duplex>()
  /** Every in-flight loopback request, so a teardown cannot leave one running. */
  private readonly upstreams = new Set<ClientRequest>()

  /** What the forwarder is doing right now. */
  snapshot(): LanForwardState {
    return this.state
  }

  /**
   * Bind the LAN listener, or report why it could not be bound.
   *
   * Never throws: a bind failure is the ordinary outcome after a network change
   * (the address is gone) or a port collision, and the loopback listener must
   * keep serving regardless.
   * @param address - the LAN address to listen on.
   * @param port - the port to listen on (the web server's own port).
   * @param upstreamPort - the loopback port to re-issue to; defaults to `port`.
   * @returns the settled state.
   */
  start(address: string, port: number, upstreamPort: number = port): Promise<LanForwardState> {
    if (this.config !== undefined && this.state.listening
      && this.config.address === address && this.config.port === port && this.config.upstreamPort === upstreamPort) {
      return Promise.resolve(this.state)
    }
    return this.stop().then(() => this.bind(address, port, upstreamPort))
  }

  private bind(address: string, port: number, upstreamPort: number): Promise<LanForwardState> {
    // The authority the requests are stamped with; re-read after listen so a
    // kernel-assigned port (or a resolved address) is what clients are told.
    let authority = authorityOf(address, port)
    const server = createServer((request, response) => { this.forwardHttp(request, response, upstreamPort, authority) })
    server.on('upgrade', (request, socket, head) => { this.forwardUpgrade(request, socket, head, upstreamPort, authority) })
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => { this.sockets.delete(socket) })
    })
    this.server = server
    this.config = { address, port, upstreamPort }
    return new Promise<LanForwardState>((resolve) => {
      let settled = false
      const settle = (next: LanForwardState): void => {
        if (settled) return
        settled = true
        this.state = next
        resolve(next)
      }
      // A failed bind arrives as an 'error' event (EADDRINUSE, EADDRNOTAVAIL, a
      // permission refusal). It is reported, never re-thrown: an unhandled
      // 'error' on a listening server would take the whole host process down.
      server.on('error', (error: NodeJS.ErrnoException) => {
        const reason = error.code === undefined ? error.message : `${error.code}: ${error.message}`
        if (this.server === server) {
          this.server = undefined
          this.config = undefined
        }
        this.releaseSockets()
        settle({ listening: false, address, port, upstreamPort, error: reason })
        if (!server.listening) return
        server.close(() => undefined)
      })
      server.listen(port, address, () => {
        // Report the address and port the kernel actually bound: a port of 0
        // (and a wildcard-adjacent literal) is resolved by the listen call, and
        // the status frame must name the listener clients can dial.
        const bound = server.address()
        const boundPort = typeof bound === 'object' && bound !== null ? bound.port : port
        const boundAddress = typeof bound === 'object' && bound !== null ? bound.address : address
        authority = authorityOf(boundAddress, boundPort)
        this.config = { address: boundAddress, port: boundPort, upstreamPort }
        settle({ listening: true, address: boundAddress, port: boundPort, upstreamPort, error: undefined })
      })
    })
  }

  /**
   * Close the LAN listener and every connection it opened, then resolve once the
   * port is released. Safe to call when nothing is bound.
   */
  stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.config = undefined
    this.releaseSockets()
    this.state = IDLE_FORWARD_STATE
    if (server === undefined) return Promise.resolve()
    return new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      // Keep-alive and upgraded connections keep the handle alive; they are
      // already destroyed above, so the close above settles on the next tick.
      server.closeAllConnections?.()
    })
  }

  private releaseSockets(): void {
    for (const upstream of this.upstreams) upstream.destroy()
    this.upstreams.clear()
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
  }

  private trackUpstream(upstream: ClientRequest): void {
    this.upstreams.add(upstream)
    upstream.on('close', () => { this.upstreams.delete(upstream) })
  }

  private forwardHttp(request: IncomingMessage, response: ServerResponse, upstreamPort: number, authority: string): void {
    const upstream = httpRequest({
      host: FORWARD_UPSTREAM_HOST,
      port: upstreamPort,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request, authority, request.socket.remoteAddress),
    }, (upstreamResponse) => {
      const headers: Record<string, string | string[]> = {}
      for (const [name, value] of Object.entries(upstreamResponse.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue
        headers[name] = value
      }
      response.writeHead(upstreamResponse.statusCode ?? 502, headers)
      upstreamResponse.pipe(response)
      upstreamResponse.on('error', () => { response.destroy() })
      // The client left mid-response: stop the loopback leg instead of working
      // on a call nobody will read.
      response.on('close', () => {
        if (!upstreamResponse.readableEnded) upstream.destroy()
      })
    })
    this.trackUpstream(upstream)
    upstream.on('error', () => {
      if (response.headersSent) {
        response.destroy()
        return
      }
      response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('remote-bridge: the LAN forwarder could not reach the loopback listener\n')
    })
    request.on('error', () => { upstream.destroy() })
    request.pipe(upstream)
  }

  private forwardUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, upstreamPort: number, authority: string): void {
    const upstream = connect(upstreamPort, FORWARD_UPSTREAM_HOST)
    this.sockets.add(upstream)
    const tearDown = (): void => {
      this.sockets.delete(upstream)
      upstream.destroy()
      socket.destroy()
    }
    upstream.on('error', tearDown)
    socket.on('error', tearDown)
    upstream.on('close', () => { socket.destroy() })
    socket.on('close', () => { upstream.destroy() })
    upstream.on('connect', () => {
      upstream.write(forwardedHandshake(request, authority, request.socket.remoteAddress))
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
  }
}
