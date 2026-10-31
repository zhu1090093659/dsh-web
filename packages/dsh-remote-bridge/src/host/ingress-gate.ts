/**
 * The inbound ingress gate: one loopback-only HTTP listener that forwards
 * exactly one upgrade path to the host's own protocol port.
 *
 * It exists so a tunnel or the relay bridge can be pointed at a listener whose
 * whole surface is `WS_PATH`. Everything else is refused at this hop instead
 * of being forwarded and judged further in: a request the gate does not serve
 * never opens an upstream connection, so the host's routes, plugins and
 * control plane are not reachable through it even by a misconfigured tunnel.
 *
 * The gate holds no state between two connections: it writes no log line,
 * touches no file, and keeps no token. The only thing it owns is one socket
 * per side, closed together.
 *
 * @module dsh-remote-bridge/host/ingress-gate
 */

import http from 'node:http'
import { connect } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { WS_PATH } from '../core/protocol.ts'

/** The body every refused request and upgrade is answered with. */
export const INGRESS_NOT_FOUND_BODY = '{"error":"not-found"}'

/**
 * The one address the gate ever binds. It is a loopback listener by
 * construction: nothing outside this machine may reach it directly, which is
 * what keeps the forwarding decision the only way in.
 */
export const INGRESS_BIND_HOST = '127.0.0.1'

/**
 * Whether one inbound URL is the single path this gate forwards.
 *
 * The comparison is on the path, not the whole URL: the pairing link carries
 * its one-shot ticket in the query (`WS_PATH?token=...`), so a strict
 * whole-URL match would refuse the one client the host is waiting for. A path
 * that merely starts the same way, another path, and an empty URL are refused.
 * @param url - the request URL as node reports it.
 * @returns true when the path is exactly `WS_PATH`.
 */
export function isIngressPath(url: string): boolean {
  const query = url.indexOf('?')
  return (query === -1 ? url : url.slice(0, query)) === WS_PATH
}

/** What the gate needs to know to dial the host's own listener. */
export interface IngressGateOptions {
  /** The host the upstream protocol listener answers on. */
  upstreamHost: string
  /** The port the upstream protocol listener bound. */
  upstreamPort: number
}

/** The port the gate took. */
export interface IngressGateStarted {
  port: number
}

/** One ingress gate: bind, report the port, close. */
export interface IngressGate {
  /** Bind the loopback listener and report the port it took. */
  start(): Promise<IngressGateStarted>
  /** Close the listener and every socket it still holds (idempotent). */
  stop(): void
}

/** The response head of one refused upgrade, which has no `ServerResponse`. */
function notFoundHead(length: number): string {
  return 'HTTP/1.1 404 Not Found\r\n'
    + 'content-type: application/json\r\n'
    + 'content-length: ' + String(length) + '\r\n'
    + 'connection: close\r\n'
    + '\r\n'
}

/**
 * Rebuild the upgrade request line and headers for the upstream hop: the
 * `Host` the phone dialed is dropped and replaced with the loopback authority
 * the host's own admission gate expects, and every other header travels
 * untouched (the upgrade handshake cannot be reconstructed header by header
 * without losing what the protocol put there).
 * @param request - the inbound upgrade request.
 * @param authority - the `host:port` the upstream listener answers on.
 * @returns the request head, headers included, ending in a blank line.
 */
function upstreamHead(request: http.IncomingMessage, authority: string): string {
  const lines = ['GET ' + (request.url ?? '/') + ' HTTP/1.1']
  const raw = request.rawHeaders
  for (let index = 0; index + 1 < raw.length; index += 2) {
    if (raw[index].toLowerCase() === 'host') continue
    lines.push(raw[index] + ': ' + raw[index + 1])
  }
  lines.push('Host: ' + authority)
  return lines.join('\r\n') + '\r\n\r\n'
}

/**
 * Build one gate.
 * @param options - the upstream listener the gate forwards to.
 * @returns the gate itself; nothing is bound until `start()` runs.
 */
export function createIngressGate(options: IngressGateOptions): IngressGate {
  const authority = options.upstreamHost + ':' + String(options.upstreamPort)
  const sockets = new Set<Socket>()

  const track = (socket: Socket): void => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
  }

  /** Refuse one plain request: 404, no upstream dial. */
  const refuse = (response: http.ServerResponse): void => {
    const body = Buffer.from(INGRESS_NOT_FOUND_BODY)
    response.writeHead(404, {
      'content-type': 'application/json',
      'content-length': String(body.byteLength),
      connection: 'close',
    })
    response.end(body)
  }

  /** Refuse one upgrade: the same 404, then the socket is closed. */
  const refuseUpgrade = (socket: Socket): void => {
    const body = Buffer.from(INGRESS_NOT_FOUND_BODY)
    socket.end(notFoundHead(body.byteLength) + INGRESS_NOT_FOUND_BODY)
  }

  /**
   * Dial the upstream for one admitted upgrade and pipe both directions.
   *
   * The two sockets are piped blind: nothing here inspects the upstream's answer,
   * so a handshake the upstream refuses is relayed as-is instead of becoming a
   * 502. That is sound only because of what the upstream is — this gate always
   * dials the same process's own Node http server, which stops parsing HTTP the
   * moment it emits `upgrade` and never speaks first on that socket. A socket
   * that answers something other than `101` therefore cannot occur today; if the
   * upstream ever becomes a proxy, a TLS terminator or another process, this is
   * the spot that must first read the response head and close both sides when it
   * is not a 101.
   * @param request - the admitted upgrade.
   * @param socket - the client side of it.
   * @param head - bytes the client already sent past the handshake.
   */
  const forward = (request: http.IncomingMessage, socket: Socket, head: Buffer): void => {
    const upstream = connect({ host: options.upstreamHost, port: options.upstreamPort })
    track(upstream)
    upstream.on('error', () => { socket.destroy() })
    socket.on('error', () => { upstream.destroy() })
    // A half-closed pair must not leave the other side holding a connection: a
    // destroyed socket is not an ended one, so the pipe above never delivers it.
    upstream.on('close', () => { socket.destroy() })
    socket.on('close', () => { upstream.destroy() })
    upstream.on('connect', () => {
      upstream.write(upstreamHead(request, authority))
      if (head.byteLength > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
  }

  const server = http.createServer((_request, response) => {
    // A plain request is never proxied: the gate serves one upgrade path and
    // nothing else, so there is no branch in which this dials upstream.
    refuse(response)
  })
  server.on('connection', track)
  server.on('upgrade', (request, socket: Socket, head: Buffer) => {
    track(socket)
    if (!isIngressPath(request.url ?? '')) {
      refuseUpgrade(socket)
      return
    }
    forward(request, socket, head)
  })

  return {
    start(): Promise<IngressGateStarted> {
      if (server.listening) {
        return Promise.resolve({ port: (server.address() as AddressInfo).port })
      }
      return new Promise<IngressGateStarted>((resolve, reject) => {
        const onError = (error: Error): void => { reject(error) }
        server.once('error', onError)
        server.listen(0, INGRESS_BIND_HOST, () => {
          server.off('error', onError)
          resolve({ port: (server.address() as AddressInfo).port })
        })
      })
    },
    stop(): void {
      if (!server.listening) {
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        return
      }
      server.close()
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
  }
}
