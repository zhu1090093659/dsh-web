/**
 * Host-side settings bridge for the Web UI plugin group.
 *
 * Serves the dsh-web family settings namespaces over a same-origin HTTP
 * pair because rc.6 host-apiproxy refuses every third-party namespace at the
 * RPC boundary. Access is loopback-only by default; deployments may opt in an
 * authenticated local reverse proxy. The handlers ride the host settings
 * seam (ctx.settings), which keeps the official schema validation, revision
 * fencing, persistence, and event emission for free; the bridge only adds the
 * allowlist gate the apiproxy normally provides. Error codes mirror the
 * official RPC codes so the client controller treats refusals exactly like an
 * apiproxy answer.
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SettingsNamespace, SettingsDescriptor, SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { composeAllowlist, extractWebSettingsNamespaces } from './allowlist.ts'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from './protocol.ts'
import type { BridgeDescribeResult, BridgeMutateRequest, BridgeMutateResult, BridgeNamespaceView } from './protocol.ts'
import { readJsonBody, writeJson } from './http.ts'

/** Header an authenticated same-host reverse proxy replaces before forwarding. */
export const WEB_UI_SETTINGS_PROXY_TOKEN_HEADER = 'x-dsh-web-ui-settings-proxy-token'

/** Optional authenticated reverse-proxy access layered over the loopback default. */
export interface BridgeAccess {
  /** Canonical Host authorities accepted from the local reverse proxy. */
  trustedProxyHosts?: readonly string[]
  /** Shared token read from the Host environment; never sent to the browser. */
  proxyToken?: string
}

/** Resolved access policy used by every bridge route. */
interface ResolvedBridgeAccess {
  trustedProxyHosts: ReadonlySet<string>
  proxyToken?: string
}

/** Whether a socket address is a literal loopback peer. */
function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Whether a normalized hostname is a literal loopback authority. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Parse one bare Host authority. */
function parseAuthority(authority: string): { canonical: string; url: URL } | undefined {
  if (authority.trim() !== authority) return undefined
  const authorityMatch = authority.startsWith('[')
    ? /^\[[^\]]+\](?::([0-9]+))?$/.exec(authority)
    : /^[^:@/?#\s]+(?::([0-9]+))?$/.exec(authority)
  if (authorityMatch === null) return undefined
  try {
    const url = new URL('http://' + authority)
    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined
    const rawPort = authorityMatch[1]
    if (rawPort !== undefined && (String(Number(rawPort)) !== rawPort || Number(rawPort) > 65_535)) return undefined
    const canonical = url.hostname.toLowerCase() + (rawPort === undefined ? '' : ':' + rawPort)
    return { canonical, url }
  } catch {
    return undefined
  }
}

/** Resolve and validate the opt-in proxy policy once, when routes mount. */
function resolveBridgeAccess(access: BridgeAccess | undefined): ResolvedBridgeAccess {
  const trustedProxyHosts = new Set<string>()
  for (const entry of access?.trustedProxyHosts ?? []) {
    const parsed = parseAuthority(entry)
    if (parsed === undefined || parsed.canonical !== entry.toLowerCase()) {
      throw new Error('web-ui-settings: trustedProxyHosts entry ' + JSON.stringify(entry) + ' is not a canonical host[:port] authority')
    }
    trustedProxyHosts.add(parsed.canonical)
  }
  const proxyToken = access?.proxyToken
  if (trustedProxyHosts.size > 0 && (proxyToken === undefined || proxyToken === '')) {
    throw new Error('web-ui-settings: authenticated proxy hosts require a non-empty proxy token')
  }
  return { trustedProxyHosts, ...(proxyToken === undefined ? {} : { proxyToken }) }
}

/** Compare the proxy token without content-dependent early exit. */
function matchesProxyToken(candidate: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof candidate !== 'string' || expected === undefined || candidate === '' || expected === '') return false
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
}

/** Browser same-origin markers shared by direct loopback and proxy requests. */
function isSameOriginRequest(request: IncomingMessage, hostUrl: URL): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Decide whether one request may enter the settings bridge.
 *
 * Direct loopback retains the existing socket + Host fence. Authenticated
 * proxy mode additionally requires a canonical configured Host and the
 * server-injected shared token; the browser never sees or supplies it.
 */
export function isTrustedBridgeRequest(request: IncomingMessage, access?: BridgeAccess): boolean {
  return isTrustedBridgeRequestResolved(request, resolveBridgeAccess(access))
}

/** Hot-path trust decision over an already validated policy. */
function isTrustedBridgeRequestResolved(request: IncomingMessage, access: ResolvedBridgeAccess): boolean {
  const address = request.socket.remoteAddress
  if (!isLoopbackAddress(address)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  const parsedHost = parseAuthority(host)
  if (parsedHost === undefined || parsedHost.canonical !== host.toLowerCase() || !isSameOriginRequest(request, parsedHost.url)) return false
  if (isLoopbackHostname(parsedHost.url.hostname)) return true
  if (!access.trustedProxyHosts.has(parsedHost.canonical)) return false
  return matchesProxyToken(request.headers[WEB_UI_SETTINGS_PROXY_TOKEN_HEADER], access.proxyToken)
}

/** Project one settings descriptor onto the bridge wire view. */
function toView(descriptor: SettingsDescriptor): BridgeNamespaceView {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema,
    value: descriptor.value,
    ...descriptor.base === undefined ? {} : { base: descriptor.base },
    ...descriptor.user === undefined ? {} : { user: descriptor.user },
    ...descriptor.secrets === undefined ? {} : {
      secrets: descriptor.secrets.map(secret => ({ path: [...secret.path], set: secret.set })),
    },
    revision: descriptor.revision,
  }
}

/** Map a seam failure onto the official-shaped refusal envelope. */
function failureOf(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof SettingsConflictError) {
    return { ok: false, code: 'settings-conflict', message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  if (/is not registered/.test(message)) {
    return { ok: false, code: 'settings-rejected', message }
  }
  return { ok: false, code: 'settings-rejected', message }
}

/** Dependencies of the bridge handlers. */
export interface BridgeDeps {
  /** The host settings seam (already injected). */
  settings: SettingsProvider
  /** Read the raw settings.yaml text ('' when unreadable or absent). */
  readSettingsYaml: () => string
}

/** The describe and mutate handlers the routes wrap. */
export interface BridgeHandlers {
  describe(): Promise<BridgeDescribeResult>
  mutate(request: unknown): Promise<BridgeMutateResult>
}

/**
 * Build the bridge handlers. The allowlist is re-read on every call so edits
 * to settings.yaml take effect without a host restart.
 * @param deps - the settings seam and the settings.yaml reader.
 * @returns the handlers.
 */
export function makeBridgeHandlers(deps: BridgeDeps): BridgeHandlers {
  // The allowlist derives from the same describe scan the handlers already
  // need: pass the descriptors in instead of scanning the seam twice per
  // request.
  const allowlisted = (descriptors: SettingsDescriptor[]): string[] => {
    const registered = descriptors.map(descriptor => String(descriptor.ns))
    return composeAllowlist(extractWebSettingsNamespaces(deps.readSettingsYaml()), registered)
  }
  return {
    async describe() {
      const descriptors = deps.settings.describe({ redactSecrets: true })
      const allowlist = allowlisted(descriptors)
      const namespaces = allowlist
        .map(ns => descriptors.find(descriptor => String(descriptor.ns) === ns))
        .filter((descriptor): descriptor is SettingsDescriptor => descriptor !== undefined)
        .map(toView)
      return {
        ok: true,
        value: { namespaces, writable: deps.settings.writable !== false },
      }
    },
    async mutate(request) {
      const body = request as Partial<BridgeMutateRequest> | null
      if (body === null || typeof body !== 'object' || typeof body.ns !== 'string' || !Array.isArray(body.ops)) {
        return { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' }
      }
      const { ns } = body
      const allowlist = allowlisted(deps.settings.describe({ redactSecrets: true }))
      if (!allowlist.includes(ns)) {
        return { ok: false, code: 'settings-not-exposed', message: 'settings namespace "' + ns + '" is not exposed to configuration clients' }
      }
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      try {
        await deps.settings.mutate(ns as SettingsNamespace, body.ops as SettingsPathOp[], expectedRevision)
      } catch (error) {
        return failureOf(error)
      }
      const descriptor = deps.settings.describe({ redactSecrets: true }).find(candidate => String(candidate.ns) === ns)
      if (descriptor === undefined) {
        return { ok: false, code: 'internal', message: 'settings namespace "' + ns + '" was disposed after the mutate' }
      }
      return { ok: true, value: toView(descriptor) }
    },
  }
}

/**
 * Build the loopback-default bridge routes, optionally admitting one
 * authenticated same-host reverse proxy.
 * @param deps - handler dependencies.
 * @param access - opt-in authenticated proxy policy.
 * @returns the exact-path route registrations.
 */
export function makeBridgeRoutes(deps: BridgeDeps, access?: BridgeAccess): WebRoute[] {
  const handlers = makeBridgeHandlers(deps)
  const resolvedAccess = resolveBridgeAccess(access)
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!isTrustedBridgeRequestResolved(req, resolvedAccess)) {
      writeJson(res, 403, { error: 'forbidden' })
      return false
    }
    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') })
      return false
    }
    return true
  }
  return [
    {
      kind: 'exact',
      path: WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, await handlers.describe())
      },
    },
    {
      kind: 'exact',
      path: WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        const body = await readJsonBody(req)
        if (body === null) {
          writeJson(res, 400, { ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
          return
        }
        writeJson(res, 200, await handlers.mutate(body))
      },
    },
  ]
}
