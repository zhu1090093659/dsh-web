/**
 * The remote desktop data channel: `/remote/api` mirrors the connection
 * plugin's `/api` surface for a paired desktop Web GUI opened at a non-loopback
 * origin (LAN address or public tunnel). The connection plugin's `/api` fence
 * stays closed for such origins (no `--trusted-host` needed or wanted), and
 * this prefix is the plugin's own route — so the paired-device cookie gate is
 * the access control, exactly like `/m/api`.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie (the same gate
 *   semantic as /m/api and the LAN fence), enforced before any host call.
 * - The SDK's loopback-only privileged methods (native dialogs, the settings
 *   plane, credentials — the `PRIVILEGED_METHODS` set of client-connection)
 *   are denied here: a paired remote desktop must not reach them. The set is
 *   pinned by tests/remote-contract.spec.ts against the installed SDK.
 * - Unary traffic is forwarded to the host ApiProxy through the SDK's own
 *   `toFetchHandler` — envelope parsing, method dispatch, error shapes, and
 *   body-size behavior all stay SDK-native; this layer only gates and
 *   rewrites the path (`/remote/api/<method>` -> `/api/<method>`).
 * - The two browser event streams (`/api/events.mux`, `/api/events.host`)
 *   ride WebSocket upgrades on this prefix: the handshake is rebuilt
 *   loopback-shaped (Host rewritten, Origin and cookies dropped) and piped
 *   over a plain TCP connection to the local port, so the connection
 *   plugin's own fence accepts it and frames pass through untouched.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, type Duplex } from 'node:stream'
import { connect } from 'node:net'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { PairingService } from './pairing.ts'
import { readCookie } from './gate.ts'
import { writeJson } from './http.ts'
import { LOOPBACK_ONLY_METHODS, REMOTE_API_PATHS, REMOTE_API_PREFIX } from './remote-methods.ts'

export { LOOPBACK_ONLY_METHODS, REMOTE_API_PREFIX, REMOTE_API_PATHS } from './remote-methods.ts'

/**
 * Request bodies ride the same cap the connection plugin applies (the SDK
 * default for `maxRequestBodyBytes`, sized for aggregate image payloads).
 */
export const REMOTE_API_MAX_BODY_BYTES = 167_772_160

/** Method-name segment shape (mirrors client-connection's endpoint pattern). */
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/

/** WebSocket handshake headers forwarded to the loopback upstream. */
const WS_FORWARD_HEADERS = [
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
] as const

/** Route-family dependencies. */
export interface RemoteApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The host ApiProxy service (injected by the plugin). */
  apiProxy: ApiProxy
  /** The local webServer port the event-stream pipe connects to. */
  port: number
  /**
   * Carrier seam over the ApiProxy (defaults to the SDK's own
   * `toFetchHandler(apiProxy).fetch`; injectable so tests run without the
   * full host dependency graph).
   */
  apiFetch?: (request: Request) => Promise<Response>
}

/**
 * Read one bounded raw request body (bytes, not parsed).
 * @throws 'body too large' beyond the cap.
 */
async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) throw new Error('body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * Build the remote desktop channel routes.
 * @param deps - pairing service + apiProxy + local port (+ carrier seam).
 * @returns the routes to register on webServer.
 */
export function makeRemoteApiRoutes(deps: RemoteApiDeps): WebRoute[] {
  const { service, apiProxy, port } = deps
  // The SDK carrier loads lazily: a static import would drag the whole host
  // dependency graph into every module that touches this file (tests
  // included), while at runtime it resolves inside the dsh host where that
  // graph always exists. One memoized load per factory.
  let carrier: Promise<(request: Request) => Promise<Response>> | undefined
  const apiFetch = deps.apiFetch ?? ((request: Request) => {
    carrier ??= import('@deepseek-ai/dsh-host-apiproxy').then(module => module.toFetchHandler(apiProxy).fetch)
    return carrier.then(fetch => fetch(request))
  })

  /** One SDK-shaped error envelope (keeps the desktop client's parse path intact). */
  const envelopeError = (res: ServerResponse, status: number, rpcId: string, code: string, message: string): void => {
    writeJson(res, status, {
      type: 'server-response',
      rpcId,
      result: { ok: false, error: { code, message, details: { issues: [] } } },
    })
  }

  /** Best-effort rpcId from an already-buffered JSON body (diagnostics only). */
  const rpcIdOf = (body: Buffer | undefined): string => {
    if (body === undefined) return 'invalid-request'
    try {
      const value: unknown = JSON.parse(body.toString('utf8'))
      if (typeof value === 'object' && value !== null && typeof (value as { rpcId?: unknown }).rpcId === 'string') {
        return (value as { rpcId: string }).rpcId
      }
    } catch {
      // Unparsable body: the SDK's own invalid-request id.
    }
    return 'invalid-request'
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // The gate runs before anything touches the body.
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    const paired = deviceId !== undefined && service.touchDevice(deviceId)

    let body: Buffer | undefined
    try {
      body = await readRawBody(req, REMOTE_API_MAX_BODY_BYTES)
    } catch {
      writeJson(res, 413, { ok: false, error: { code: 'payload-too-large', message: 'body too large' } })
      return
    }

    if (!paired) {
      envelopeError(res, 403, rpcIdOf(body), 'unpaired', 'this device is not paired with the desktop')
      return
    }

    if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const prefix = `${REMOTE_API_PREFIX}/`
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(404).end()
      return
    }
    const endpoint = url.pathname.slice(prefix.length)
    if (endpoint === '' || endpoint.split('/').some(segment => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT_PATTERN.test(segment))) {
      res.writeHead(404).end()
      return
    }

    if (LOOPBACK_ONLY_METHODS.has(endpoint)) {
      envelopeError(res, 403, rpcIdOf(body), 'forbidden', `${endpoint} is loopback-only and stays unreachable from a paired remote desktop`)
      return
    }

    // Forward through the SDK's own fetch handler: envelope parsing, method
    // dispatch, and error shapes all stay native. The URL is loopback-shaped
    // so nothing here depends on the deployment's fence configuration. The
    // search string rides along (session.export takes query parameters).
    const headers = new Headers()
    const contentType = req.headers['content-type']
    if (typeof contentType === 'string') headers.set('content-type', contentType)
    const upstream = new Request(`http://127.0.0.1:${String(port)}/api/${endpoint}${url.search}`, {
      method: req.method,
      headers,
      ...(body !== undefined ? { body: new Uint8Array(body), duplex: 'half' } : {}),
    })
    let response
    try {
      response = await apiFetch(upstream)
    } catch (error) {
      writeJson(res, 502, { ok: false, error: { code: 'upstream-failure', message: String(error) } })
      return
    }
    const outHeaders: Record<string, string> = {}
    const responseContentType = response.headers.get('content-type')
    if (responseContentType !== null) outHeaders['content-type'] = responseContentType
    res.writeHead(response.status, outHeaders)
    if (response.body === null) {
      res.end()
      return
    }
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
  }

  return [{ kind: 'prefix', path: REMOTE_API_PREFIX, handler }]
}

/**
 * Build the WebSocket upgrade routes for the two browser event streams.
 * @param deps - pairing service + local port.
 * @returns the upgrade routes to register on webServer.
 */
export function makeRemoteApiUpgradeRoutes(deps: Omit<RemoteApiDeps, 'apiProxy'>): WebUpgradeRoute[] {
  const { service, port } = deps

  const makeHandler = (upstreamPath: string) => (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined || !service.touchDevice(deviceId)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }

    // Rebuild the handshake loopback-shaped: Host is ours, Origin and
    // Sec-Fetch markers are dropped (a non-browser-shaped request), and only
    // the WebSocket cryptosession headers ride through. The pairing cookie
    // never leaves this process.
    const lines = [
      `GET ${upstreamPath} HTTP/1.1`,
      `Host: 127.0.0.1:${String(port)}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
    ]
    for (const name of WS_FORWARD_HEADERS) {
      const value = req.headers[name]
      if (value === undefined) continue
      lines.push(`${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
    }
    const handshake = `${lines.join('\r\n')}\r\n\r\n`

    const upstream = connect(port, '127.0.0.1')
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

  return [
    { path: REMOTE_API_PATHS.mux, handler: makeHandler('/api/events.mux') },
    { path: REMOTE_API_PATHS.host, handler: makeHandler('/api/events.host') },
  ]
}
