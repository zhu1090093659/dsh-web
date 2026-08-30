/**
 * The remote desktop data channel: `/remote` is this plugin's own prefix, so
 * the paired-device cookie is the access control. After that gate, every
 * fenced same-origin path the browser rewrote here is re-issued to 127.0.0.1
 * as a loopback-shaped request so sibling plugin fences (and the connection
 * plugin's `/api`) accept it — no `--trusted-host` and no per-plugin pairing
 * consult.
 *
 * Security model:
 * - While `requirePairingForLan` is on (default), every request must carry a
 *   live paired-device cookie, enforced before any bytes are forwarded and
 *   before any host call. With the policy off, the cookie gate is skipped
 *   (the local-only denials below still apply).
 * - A paired remote desktop is a full-control credential: the browser half
 *   flips the official UI into host mode (the transport ownsHost hook), so
 *   the configuration plane (settings, credentials, presets, deliverables)
 *   rides this channel like every other call. The four control planes in
 *   LOCAL_ONLY_PREFIXES stay physically local.
 * - Everything else is HTTP- or WebSocket-proxied to the local port with
 *   Host rewritten, Origin and cookies dropped, and a synthetic same-origin
 *   browser marker added after authentication. Plugin loopback fences then
 *   pass. The pairing cookie never leaves this process.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PairingService } from './pairing.ts'
import { readCookie } from './gate.ts'
import { writeJson } from './http.ts'
import type { InnerAuth } from './inner-auth.ts'
import { proxyLoopbackHttp, proxyLoopbackUpgrade } from './loopback-proxy.ts'
import {
  REMOTE_DEVICE_HEADER,
  REMOTE_DEVICE_QUERY,
  REMOTE_PREFIX,
  REMOTE_UPGRADE_PATHS,
  localOnlyDenial,
} from './remote-methods.ts'

export {
  DESKTOP_LAUNCHER_PATH,
  LOCAL_ONLY_PREFIXES,
  PLUGIN_MANAGER_PATH,
  REMOTE_API_PATHS,
  REMOTE_DEVICE_HEADER,
  REMOTE_DEVICE_QUERY,
  REMOTE_PREFIX,
  REMOTE_UPGRADE_PATHS,
  WEB_UI_SETTINGS_BRIDGE_PATH,
  localOnlyDenial,
} from './remote-methods.ts'
export { REMOTE_API_PREFIX } from './remote-methods.ts'

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** Reject traversal and empty segments; allow plugin file-path characters. */
function isSafeSegment(segment: string): boolean {
  if (segment === '') return false
  let decoded: string
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    return false
  }
  return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\') && !decoded.includes('\0')
}

/** Route-family dependencies. */
export interface RemoteApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The local webServer port the loopback proxy connects to. */
  port: number
  /**
   * Live policy: whether the paired-device cookie gates the /remote channel.
   * When false, requests are proxied without a cookie (the loopback-only
   * denials still apply). A function is re-read per request, so a settings
   * edit takes effect without a restart. Defaults to true.
   */
  requirePairingForLan?: boolean | (() => boolean)
  /**
   * The process's inner browser-auth credential attached to re-issued
   * requests (the connection plugin's /api route enforces that cookie and
   * the pairing gate above already ran). Undefined keeps the previous
   * cookie-less behavior — the inner route then answers 401 on this cohort.
   */
  auth?: InnerAuth
}

/** One SDK-shaped error envelope (keeps the desktop client's parse path intact). */
function envelopeError(res: ServerResponse, status: number, rpcId: string, code: string, message: string): void {
  writeJson(res, status, {
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code, message, details: { issues: [] } } },
  })
}

/**
 * Map `/remote/...` to the inner path, or undefined when the outer path is
 * not a safe rewrite target.
 */
export function innerPathOf(pathname: string): string | undefined {
  if (pathname === REMOTE_PREFIX || pathname === `${REMOTE_PREFIX}/`) return undefined
  if (!pathname.startsWith(`${REMOTE_PREFIX}/`)) return undefined
  const rest = pathname.slice(REMOTE_PREFIX.length)
  if (!rest.startsWith('/')) return undefined
  const segments = rest.slice(1).split('/')
  if (segments.length === 0 || segments.some(segment => !isSafeSegment(segment))) {
    return undefined
  }
  return rest
}

/**
 * Whether a paired inner path must stay physically local (delegates to the
 * shared LOCAL_ONLY_PREFIXES table).
 * @returns a denial message, or undefined when the path may be proxied.
 */
export function loopbackOnlyDenial(innerPath: string): string | undefined {
  return localOnlyDenial(innerPath)
}

/**
 * Resolve a live device credential for a gated HTTP request: the pairing
 * cookie first, then the cookieless header the boot patch attaches. Unknown
 * or revoked ids are a no-op - a stale id never re-arms a device.
 * @returns the touched device id, or undefined when neither credential is live.
 */
export function pairedDeviceIdOf(req: IncomingMessage, service: PairingService): string | undefined {
  const cookieDevice = readCookie(req.headers.cookie, service.config.cookieName)
  const headerDevice = typeof req.headers[REMOTE_DEVICE_HEADER] === 'string'
    ? (req.headers[REMOTE_DEVICE_HEADER] as string)
    : undefined
  const id = cookieDevice ?? headerDevice
  if (id === undefined) return undefined
  return service.touchDevice(id) ? id : undefined
}

/**
 * Build the remote desktop channel HTTP routes.
 * @param deps - pairing service + local port + live pairing policy.
 * @returns the routes to register on webServer.
 */
export function makeRemoteApiRoutes(deps: RemoteApiDeps): WebRoute[] {
  const { service, port, requirePairingForLan = true } = deps

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    // Cookie gate first — same order as /m/api. Do not buffer an unpaired body.
    // With the live policy off, untrusted-but-policy-open callers are proxied
    // (a stale client rewrite must not 403); loopback-only denials stay below.
    const require = typeof requirePairingForLan === 'function' ? requirePairingForLan() : requirePairingForLan
    if (require) {
      const paired = pairedDeviceIdOf(req, service)
      if (paired === undefined) {
        req.resume()
        envelopeError(res, 403, 'invalid-request', 'unpaired', 'this device is not paired with the desktop')
        return
      }
    }

    const method = req.method ?? 'GET'
    if (!ALLOWED_METHODS.has(method)) {
      req.resume()
      res.writeHead(405).end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const inner = innerPathOf(url.pathname)
    if (inner === undefined) {
      req.resume()
      res.writeHead(404).end()
      return
    }
    const denied = loopbackOnlyDenial(inner)
    if (denied !== undefined) {
      req.resume()
      envelopeError(res, 403, 'invalid-request', 'forbidden', denied)
      return
    }

    proxyLoopbackHttp(req, res, port, `${inner}${url.search}`, deps.auth)
  }

  return [{ kind: 'prefix', path: REMOTE_PREFIX, handler }]
}

/**
 * Map one outer upgrade URL onto the loopback path (query string included).
 */
export function upgradeInnerPath(reqUrl: string | undefined, fallbackPath: string): string {
  if (reqUrl === undefined || reqUrl === '') return fallbackPath
  let url: URL
  try {
    url = new URL(reqUrl, 'http://127.0.0.1')
  } catch {
    return fallbackPath
  }
  const inner = innerPathOf(url.pathname)
  if (inner === undefined) return fallbackPath
  return `${inner}${url.search}`
}

/**
 * Build the WebSocket upgrade routes for the event streams and known plugin
 * sockets. webServer matches upgrades by exact path.
 * @param deps - pairing service + local port + live pairing policy.
 * @returns the upgrade routes to register on webServer.
 */
export function makeRemoteApiUpgradeRoutes(deps: RemoteApiDeps): WebUpgradeRoute[] {
  const { service, port, requirePairingForLan = true } = deps

  const handlerFor = (fallbackPath: string) => (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const require = typeof requirePairingForLan === 'function' ? requirePairingForLan() : requirePairingForLan
    if (require) {
      // WebSocket handshakes cannot carry headers from the Web API, so the
      // cookieless credential rides the query; the cookie stays the primary.
      let queryDevice: string | undefined
      try {
        queryDevice = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get(REMOTE_DEVICE_QUERY) ?? undefined
      } catch { /* fall through to the cookie */ }
      const deviceId = pairedDeviceIdOf(req, service)
      const paired = deviceId ?? (queryDevice !== undefined && service.touchDevice(queryDevice) ? queryDevice : undefined)
      if (paired === undefined) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
    }
    const inner = upgradeInnerPath(req.url, fallbackPath)
    const denied = loopbackOnlyDenial(inner.split('?')[0] ?? inner)
    if (denied !== undefined) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    // The inner handshake needs the browser-auth credential (the gateway
    // event-stream route enforces it); resolving it is async, so the
    // handshake bytes are written once it settles. A missing credential
    // proceeds as before — the gateway route then refuses.
    void Promise.resolve(deps.auth?.ready())
      .catch(() => undefined)
      .then((cookie) => {
        if (socket.destroyed) return
        proxyLoopbackUpgrade(req, socket, head, port, inner, typeof cookie === 'string' ? cookie : undefined)
      })
  }

  return REMOTE_UPGRADE_PATHS.map((path) => ({
    path,
    handler: handlerFor(path.slice(REMOTE_PREFIX.length)),
  }))
}
