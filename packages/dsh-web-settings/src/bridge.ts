/**
 * Host-side settings bridge for the Web UI plugin group.
 *
 * Serves the dsh-web family settings namespaces over a same-origin HTTP pair.
 * Access is loopback-only by default; deployments may opt in an authenticated
 * local reverse proxy. The handlers ride the Host settings surface
 * (`ctx.settings`, the SettingsForms service), which keeps the official schema
 * validation, revision fencing, persistence, and event emission for free; the
 * bridge only adds the allowlist gate the apiproxy normally provides and the
 * namespace-to-profile-entry-id mapping the new surface does not carry. Error
 * codes mirror the official RPC codes so the client controller treats
 * refusals exactly like an apiproxy answer.
 */

import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SettingsDescribeOptions, SettingsDescriptor, SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { composeAllowlist, extractWebSettingsNamespaces, resolveNamespaceEntries, resolveNamespaceEntry } from './allowlist.ts'
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

/** One profile entry as the Host config editor reports it (only the fields this bridge reads). */
export interface BridgeProfileEntry {
  options?: {
    /** Unique profile entry id; this IS the settings namespace of the new surface. */
    id?: unknown
    /** Package name the row loads: the family client package, or the aggregate's `@linxin666/dsh-web-all/<x>`. */
    name?: unknown
    /** Row config; an aggregate row points at the client package it carries. */
    config?: unknown
  }
}

/** One live namespace the bridge can serve. */
export interface ServedNamespace {
  /** The Host's descriptor for the profile entry, read under the caller's describe options. */
  descriptor: SettingsDescriptor
  /**
   * Profile entry id owning this namespace. Undefined when the descriptor is
   * already keyed by the family namespace itself (a Host whose settings
   * surface predates the profile-entry identity).
   */
  entryId: string | undefined
}

/** The settings view one namespace projection needs. */
export interface SettingsSurface {
  /** The live Host settings view, one descriptor per served entry. */
  describe(options?: SettingsDescribeOptions): SettingsDescriptor[]
}

/** Minimal dependencies of the namespace projection (the bridge handlers need more). */
export interface NamespaceProjectionDeps {
  /** The Host settings surface. */
  settings: SettingsSurface
  /** Live profile entries (`configEditor.entries()`), the only place a package identity survives. */
  entries?: () => BridgeProfileEntry[]
}

/** The package identities one profile row declares, in resolution order. */
function entryIdentities(entry: BridgeProfileEntry): string[] {
  const options = entry.options
  if (options === undefined) return []
  const identities: string[] = []
  if (typeof options.name === 'string') identities.push(options.name)
  const config = options.config
  if (typeof config === 'object' && config !== null) {
    const plugin = (config as { plugin?: unknown }).plugin
    if (typeof plugin === 'string') identities.push(plugin)
  }
  return identities
}

/** The profile entry id of one row, when it carries one. */
function entryIdOf(entry: BridgeProfileEntry): string | undefined {
  const id = entry.options?.id
  return typeof id === 'string' ? id : undefined
}

/**
 * The family settings namespaces one profile row serves. A standalone install
 * names the family client package directly; an aggregate install names the
 * `dsh-web-all/<x>` subplugin while its config points at the same client
 * package. Both resolve through the allowlist's package-name table, so the
 * bridge never invents a second identity mapping.
 * @param entry - one profile entry.
 * @returns every family settings namespace the row serves, in a stable order.
 */
function entryNamespaces(entry: BridgeProfileEntry): string[] {
  const found: string[] = []
  for (const identity of entryIdentities(entry)) {
    for (const ns of resolveNamespaceEntries(identity)) {
      if (!found.includes(ns)) found.push(ns)
    }
  }
  return found
}

/**
 * The extra family settings namespaces one entry declares itself, on top of
 * the one its package identity resolves to.
 *
 * A plugin whose Config nests several sub-namespaces under one profile row —
 * the skin center declares `skin-background`, `skin-custom-theme` and
 * `skin-wallpaper` — is registered by the Host as a single descriptor keyed by
 * that row's entry id, with the whole Config object as its `value`. The Host
 * therefore has one form for the row, but the family cards address one
 * namespace each. Resolving only the first alias made the other two absent
 * from the served map, so the allowlist could never intersect them in and
 * every write to them was refused as `settings-not-exposed` (#1755). Reading
 * the declared keys back off the descriptor's own value keeps each sub-namespace
 * bound to the entry id the Host actually writes through.
 *
 * @param descriptor - the live descriptor of the entry's row.
 * @returns the declared sub-namespaces that the allowlist recognizes, in the
 *   descriptor's own key order.
 */
function declaredNamespaces(descriptor: SettingsDescriptor): string[] {
  const value = descriptor.value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const found: string[] = []
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    // Only a NESTED section counts. The value is the entry's whole Config, so a
    // plugin that merely carries a field named after some other family's
    // namespace (a usage entry with a 'pet' key) must not claim that namespace
    // and shadow the row that actually serves it.
    if (typeof nested !== 'object' || nested === null || Array.isArray(nested)) continue
    if (resolveNamespaceEntry(key) !== undefined && !found.includes(key)) found.push(key)
  }
  return found
}

/**
 * Project the live Host settings view onto the namespaces the bridge serves.
 * The descriptor's `ns` is a profile entry id on the new surface, so each one
 * is traced back to its family namespace through the profile row that owns it.
 * @param deps - the settings surface and the profile-entry reader.
 * @param options - describe options; secret redaction is the wire default and
 *   is relaxed only by an in-process reader that must see what a user holds.
 * @returns one entry per family namespace, keyed by that namespace.
 */
export function servedNamespaces(deps: NamespaceProjectionDeps, options?: SettingsDescribeOptions): Map<string, ServedNamespace> {
  const byId = new Map<string, BridgeProfileEntry>()
  for (const entry of deps.entries?.() ?? []) {
    const id = entryIdOf(entry)
    if (id !== undefined) byId.set(id, entry)
  }
  const served = new Map<string, ServedNamespace>()
  for (const descriptor of deps.settings.describe(options ?? { redactSecrets: true })) {
    const ns = String(descriptor.ns)
    const owner = byId.get(ns)
    // One profile row can serve several family namespaces: the one its package
    // identity resolves to, plus every sub-namespace the row's own Config
    // declares (#1755). They all write through the same entry id, so they all
    // share this descriptor.
    const families = owner === undefined ? [] : [...entryNamespaces(owner), ...declaredNamespaces(descriptor)]
    if (families.length > 0) {
      for (const family of families) served.set(family, { descriptor, entryId: ns })
      continue
    }
    // No profile row to trace: a descriptor already keyed by a family
    // namespace is still served, without an entry id for the client to bind.
    const direct = resolveNamespaceEntry(ns)
    if (direct !== undefined) served.set(direct, { descriptor, entryId: undefined })
  }
  return served
}

/** Project one served namespace onto the bridge wire view. */
function toView(ns: string, served: ServedNamespace): BridgeNamespaceView {
  const { descriptor, entryId } = served
  return {
    ns,
    ...entryId === undefined ? {} : { entryId },
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

/** Map a Host settings failure onto the official-shaped refusal envelope. */
function failureOf(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof SettingsConflictError) {
    return { ok: false, code: 'settings-conflict', message: error.message }
  }
  // Everything else (an entry the Host no longer exposes, a rejected field, a
  // value the schema refuses) collapses onto the one refusal code the client
  // controller understands, with the Host's own message.
  return { ok: false, code: 'settings-rejected', message: error instanceof Error ? error.message : String(error) }
}

/** Dependencies of the bridge handlers. */
export interface BridgeDeps {
  /** The host settings surface (already injected). */
  settings: SettingsForms
  /** Read the raw settings YAML text ('' when unreadable or absent). */
  readSettingsYaml: () => string
  /**
   * Live profile entries (`configEditor.entries()`), the only place a package
   * identity survives; used to map a family namespace onto its profile entry
   * id. Absent (or empty) when the Host serves no config editor: the bridge
   * then serves namespaces without an entry id and the client keeps the HTTP
   * transport.
   */
  entries?: () => BridgeProfileEntry[]
}

/** The describe and mutate handlers the routes wrap. */
export interface BridgeHandlers {
  describe(): Promise<BridgeDescribeResult>
  mutate(request: unknown): Promise<BridgeMutateResult>
}

/**
 * Build the bridge handlers. The allowlist is re-read on every call so edits
 * to settings.yaml take effect without a host restart.
 * @param deps - the settings surface, the settings.yaml reader, and the profile-entry reader.
 * @returns the handlers.
 */
export function makeBridgeHandlers(deps: BridgeDeps): BridgeHandlers {
  // The allowlist derives from the same describe scan the handlers already
  // need: trace the descriptors first and pass the served namespaces in
  // instead of scanning the surface twice per request.
  const allowlisted = (served: Map<string, ServedNamespace>): string[] =>
    composeAllowlist(extractWebSettingsNamespaces(deps.readSettingsYaml()), [...served.keys()])
  return {
    async describe() {
      const served = servedNamespaces(deps)
      const namespaces = allowlisted(served).map(ns => toView(ns, served.get(ns)!))
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
      const served = servedNamespaces(deps)
      if (!allowlisted(served).includes(ns)) {
        return { ok: false, code: 'settings-not-exposed', message: 'settings namespace "' + ns + '" is not exposed to configuration clients' }
      }
      const target = served.get(ns)!
      // The Host writes by profile entry id; a namespace served without one
      // (the pre-0.1.7 layout) is already the id the Host knows.
      const entryId = target.entryId ?? ns
      const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
      try {
        await deps.settings.mutate(entryId, body.ops as SettingsPathOp[], expectedRevision)
      } catch (error) {
        return failureOf(error)
      }
      const descriptor = deps.settings.describe({ redactSecrets: true }).find(candidate => String(candidate.ns) === entryId)
      if (descriptor === undefined) {
        return { ok: false, code: 'internal', message: 'settings namespace "' + ns + '" was disposed after the mutate' }
      }
      return { ok: true, value: toView(ns, { descriptor, entryId: target.entryId }) }
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
      auth: 'anonymous',
      handler: async (req, res) => {
        if (!guard(req, res)) return
        writeJson(res, 200, await handlers.describe())
      },
    },
    {
      kind: 'exact',
      path: WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate',
      auth: 'anonymous',
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
