/**
 * Loopback-shaped reverse proxy used by the remote desktop channel: after
 * the pairing cookie gate, traffic is re-issued to 127.0.0.1 so sibling
 * plugin fences (socket + Host loopback) accept it. Origin, cookies, and
 * caller-controlled Sec-Fetch markers are dropped. HTTP requests receive a
 * synthetic same-origin marker after the pairing gate so sibling loopback
 * routes that require a browser tripwire accept the authenticated proxy.
 */

import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import { writeJson } from './http.ts'
import type { InnerAuth } from './inner-auth.ts'

/** WebSocket handshake headers forwarded to the loopback upstream. */
const WS_FORWARD_HEADERS = [
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
] as const

/** Response headers copied from the loopback upstream (no hop-by-hop). */
const HTTP_FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
] as const

/**
 * Pipe one HTTP request to loopback and stream the response back.
 * @param req - the already-gated outer request.
 * @param res - the outer response.
 * @param port - local webServer port.
 * @param upstreamPath - path + query on 127.0.0.1 (must start with `/`).
 * @param auth - when given, the process's inner browser-auth credential is
 *   attached so the connection plugin's /api route (fence + browser auth,
 *   authority-bound cookie, no loopback exemption on this cohort) accepts
 *   the re-issued request; a 401 answer invalidates the cached credential.
 */
export function proxyLoopbackHttp(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  upstreamPath: string,
  auth?: InnerAuth,
): void {
  void Promise.resolve(auth?.ready())
    .catch(() => undefined)
    .then((cookie) => { pipeLoopbackHttp(req, res, port, upstreamPath, auth, typeof cookie === 'string' ? cookie : undefined) })
}

function pipeLoopbackHttp(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  upstreamPath: string,
  auth: InnerAuth | undefined,
  cookie: string | undefined,
): void {
  const headers: Record<string, string> = {
    host: `127.0.0.1:${String(port)}`,
    'sec-fetch-site': 'same-origin',
  }
  const contentType = req.headers['content-type']
  if (typeof contentType === 'string') headers['content-type'] = contentType
  const contentLength = req.headers['content-length']
  if (typeof contentLength === 'string') headers['content-length'] = contentLength
  const accept = req.headers.accept
  if (typeof accept === 'string') headers.accept = accept
  if (cookie !== undefined) headers.cookie = cookie

  const upstream = httpRequest({
    host: '127.0.0.1',
    port,
    path: upstreamPath,
    method: req.method,
    headers,
  }, (upstreamRes) => {
    // The cached credential went stale (secret rotation, credential store
    // reset): drop it so the next request re-redeems. The in-flight response
    // still pipes through untouched.
    if (upstreamRes.statusCode === 401 && cookie !== undefined) auth?.invalidate()
    const out: OutgoingHttpHeaders = {}
    for (const name of HTTP_FORWARD_RESPONSE_HEADERS) {
      const value = upstreamRes.headers[name]
      if (value !== undefined) out[name] = value
    }
    res.writeHead(upstreamRes.statusCode ?? 502, out)
    upstreamRes.pipe(res)
  })
  upstream.on('error', () => {
    if (!res.headersSent) {
      writeJson(res, 502, { ok: false, error: { code: 'upstream-failure', message: 'upstream request failed' } })
      return
    }
    res.destroy()
  })
  req.pipe(upstream)
}

/**
 * Rebuild a WebSocket handshake as loopback-shaped and pipe both directions.
 * @param req - the already-gated upgrade request.
 * @param socket - the client duplex.
 * @param head - bytes already read past the handshake.
 * @param port - local webServer port.
 * @param upstreamPath - path + query on 127.0.0.1.
 * @param cookie - the inner browser-auth credential for the handshake, when
 *   the upstream route enforces it (the gateway event-stream mux does).
 */
export function proxyLoopbackUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
  upstreamPath: string,
  cookie?: string,
): void {
  const lines = [
    `GET ${upstreamPath} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
  ]
  if (cookie !== undefined) lines.push(`Cookie: ${cookie}`)
  for (const name of WS_FORWARD_HEADERS) {
    const value = req.headers[name]
    if (value === undefined) continue
    lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
  }
  const handshake = `${lines.join('\r\n')}\r\n\r\n`

  const upstream = connect(port, '127.0.0.1')
  // A half-open tunnel path (dead-but-alive edge connection) would otherwise
  // let the phone's mux socket sit stale for minutes: keepalive probes the
  // pipe periodically and destroys both legs on the first real gap, so the
  // client's reconnect + stream re-baseline re-syncs the feed in seconds.
  ;(socket as unknown as import('node:net').Socket).setKeepAlive(true, 20_000)
  upstream.setKeepAlive(true, 20_000)
  const tearDown = (): void => {
    upstream.destroy()
    socket.destroy()
  }
  upstream.on('error', tearDown)
  socket.on('error', tearDown)
  upstream.on('close', () => { socket.destroy() })
  socket.on('close', () => { upstream.destroy() })
  upstream.on('connect', () => {
    upstream.write(handshake)
    if (head.length > 0) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
}
