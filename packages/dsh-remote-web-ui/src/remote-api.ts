/**
 * The remote desktop data channel: `/remote` is this plugin's own prefix, so
 * the paired-device cookie is the access control (exactly like `/m/api`).
 * After that gate, every fenced same-origin path the browser rewrote here is
 * re-issued to 127.0.0.1 as a loopback-shaped request so sibling plugin
 * fences (and the connection plugin's `/api`) accept it — no `--trusted-host`
 * and no per-plugin pairing consult.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie, enforced before
 *   any bytes are forwarded and before any host call.
 * - The SDK's loopback-only privileged methods (native dialogs, the settings
 *   plane, credentials — the `PRIVILEGED_METHODS` set of client-connection)
 *   are denied here. The set is pinned by tests/remote-contract.spec.ts.
 * - `/api/pair/*`, `/api/update/*`, `/api/plugin-manager/*`,
 *   `/api/dsh-desktop-launcher/*` and `/api/dsh-web-ui-settings/*` stay physically local.
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
import { proxyLoopbackHttp, proxyLoopbackUpgrade } from './loopback-proxy.ts'
import {
  DESKTOP_LAUNCHER_PATH,
  LOOPBACK_ONLY_METHODS,
  PLUGIN_MANAGER_PATH,
  REMOTE_API_PATHS,
  REMOTE_PREFIX,
  REMOTE_UPGRADE_PATHS,
  WEB_UI_SETTINGS_BRIDGE_PATH,
} from './remote-methods.ts'

export {
  DESKTOP_LAUNCHER_PATH,
  LOOPBACK_ONLY_METHODS,
  PLUGIN_MANAGER_PATH,
  REMOTE_API_PATHS,
  REMOTE_PREFIX,
  REMOTE_UPGRADE_PATHS,
  WEB_UI_SETTINGS_BRIDGE_PATH,
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
 * Whether a paired inner path must stay physically local.
 * @returns a denial message, or undefined when the path may be proxied.
 */
export function loopbackOnlyDenial(innerPath: string): string | undefined {
  if (innerPath === '/api/pair' || innerPath.startsWith('/api/pair/')) {
    return 'pairing endpoints stay loopback-only and stay unreachable from a paired remote desktop'
  }
  if (innerPath === '/api/update' || innerPath.startsWith('/api/update/')) {
    return 'update endpoints stay loopback-only and stay unreachable from a paired remote desktop'
  }
  if (innerPath === PLUGIN_MANAGER_PATH || innerPath.startsWith(`${PLUGIN_MANAGER_PATH}/`)) {
    return 'plugin-manager stays loopback-only and stays unreachable from a paired remote desktop'
  }
  if (innerPath === DESKTOP_LAUNCHER_PATH || innerPath.startsWith(`${DESKTOP_LAUNCHER_PATH}/`)) {
    return 'desktop-launcher endpoints stay loopback-only and stay unreachable from a paired remote desktop'
  }
  if (innerPath === WEB_UI_SETTINGS_BRIDGE_PATH || innerPath.startsWith(`${WEB_UI_SETTINGS_BRIDGE_PATH}/`)) {
    return 'settings-bridge endpoints stay loopback-only and stay unreachable from a paired remote desktop'
  }
  if (!innerPath.startsWith('/api/')) return undefined
  const method = innerPath.slice('/api/'.length)
  if (method !== '' && !method.includes('/') && LOOPBACK_ONLY_METHODS.has(method)) {
    return `${method} is loopback-only and stays unreachable from a paired remote desktop`
  }
  return undefined
}

/**
 * Build the remote desktop channel HTTP routes.
 * @param deps - pairing service + local port.
 * @returns the routes to register on webServer.
 */
export function makeRemoteApiRoutes(deps: RemoteApiDeps): WebRoute[] {
  const { service, port } = deps

  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    // Cookie gate first — same order as /m/api. Do not buffer an unpaired body.
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    const paired = deviceId !== undefined && service.touchDevice(deviceId)
    if (!paired) {
      req.resume()
      envelopeError(res, 403, 'invalid-request', 'unpaired', 'this device is not paired with the desktop')
      return
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

    proxyLoopbackHttp(req, res, port, `${inner}${url.search}`)
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
 * @param deps - pairing service + local port.
 * @returns the upgrade routes to register on webServer.
 */
export function makeRemoteApiUpgradeRoutes(deps: RemoteApiDeps): WebUpgradeRoute[] {
  const { service, port } = deps

  const handlerFor = (fallbackPath: string) => (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined || !service.touchDevice(deviceId)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const inner = upgradeInnerPath(req.url, fallbackPath)
    const denied = loopbackOnlyDenial(inner.split('?')[0] ?? inner)
    if (denied !== undefined) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    proxyLoopbackUpgrade(req, socket, head, port, inner)
  }

  return REMOTE_UPGRADE_PATHS.map((path) => ({
    path,
    handler: handlerFor(path.slice(REMOTE_PREFIX.length)),
  }))
}
