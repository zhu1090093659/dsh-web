/**
 * The /api/pair route family + the desktop status stream. Exact routes
 * under /api: the webserver matches exact paths before the connection
 * plugin's /api prefix, so these handlers own the full response lifecycle
 * and apply their own trust fence (loopback-only for control endpoints;
 * loopback-or-LAN for the phone-facing accept/heartbeat/status). The cookie
 * set on accept is the device identity the plugin's own surfaces enforce:
 * the /remote channel gate and the api/gate listener. Alongside the JSON
 * family sit the phone-facing top-level pages (exact routes /pair-accept,
 * /pair-app, /pair-app.sw.js) with their own LAN-or-public fence. Note that
 * on the 0.1.2-alpha.2 cohort nothing emits api/gate — direct /api is
 * governed by the harness fence + browser auth — while the /remote channel
 * always enforces the pairing cookie itself.
 *
 * The app landing is reached with a one-time grant, never with the device id
 * itself: /pair-accept mints a short-lived, single-consume grant
 * (pair-grant.ts) and redirects to /pair-app?grant=<g>, and only the landing's
 * own response carries the device credential into the shell. The device cookie
 * stays the primary credential; the grant only keeps a live session credential
 * out of the URL, the address bar, and every log on the redirect path.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { z, type ZodType } from 'zod'
import { UnknownLanAddressError, type PairingService, type PairingSnapshot } from './pairing.ts'
import { isLoopbackAddress } from './loopback.ts'
import { isLoopbackClient, readCookie } from './gate.ts'
import { readJsonBody, writeJson } from './http.ts'
import { createPairGrantStore, type PairGrantStore } from './pair-grant.ts'
import { REMOTE_HOST_GRANT_GLOBAL } from './remote-channel-rules.ts'

/**
 * Browser-trust fence for the /api/pair routes, mirroring the connection
 * package's internal fence semantics (Host/Origin based, DNS-rebinding and
 * cross-site defense). The connection package no longer exports its trust
 * predicate — the fence for the /api prefix lives inside the connection
 * plugin — so the pairing routes, which must stay reachable from LAN phones
 * ahead of the connection prefix route (exact routes match first), carry
 * their own copy scoped to the literals the QR links advertise.
 * @param request - the node HTTP request.
 * @param trustedHosts - non-loopback authorities this surface serves: exact
 * `host:port`, or port-less `host` matching any port.
 * @returns true when the Host is ours (loopback or trusted) and any attached
 * browser markers are same-origin.
 */
export function isTrustedApiRequest(request: IncomingMessage, trustedHosts: readonly string[]): boolean {
  if (!isTrustedHost(request, trustedHosts)) return false
  // Cross-site fence: an explicit cross-site marker is refused regardless of
  // Origin (modern browsers label the initiator on every fetch).
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be exactly this
  // authority; absent Origin is fine — the Host fence already bound it.
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === new URL(`http://${request.headers.host ?? ''}`).host
  } catch {
    return false
  }
}

/**
 * Whether the request's Host is an authority this surface serves: loopback, or
 * a trusted entry (exact `host:port`, or port-less `host` matching any port).
 * The browser-marker checks stay in {@link isTrustedApiRequest}: a pairing
 * entry page is a navigation, and its authority is the token or device
 * credential it carries, not who linked to it.
 * @param request - the node HTTP request.
 * @param trustedHosts - non-loopback authorities this surface serves.
 * @returns true when the Host is ours.
 */
export function isTrustedHost(request: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  return isLoopbackClient(request) || trustedHosts.some(entry => {
    // A port-less entry matches the hostname on any port; an exact host:port
    // entry matches that authority verbatim (WHATWG normalization both sides).
    // A malformed entry (a config or DSH_REMOTE_TRUSTED_HOSTS typo) contributes
    // no trust instead of throwing out of the fence: every pairing request from
    // a non-loopback origin would otherwise answer 400 with only a generic
    // webserver warning, and the valid entries would never be consulted.
    let entryUrl: URL
    try {
      entryUrl = new URL(`http://${entry}`)
    } catch {
      return false
    }
    return entryUrl.port === '' ? entryUrl.hostname === hostname : entryUrl.host === hostUrl.host
  })
}

/**
 * Whether the request is a top-level document navigation — the shape every
 * phone uses to open a pairing link. Browsers label it `Sec-Fetch-Mode:
 * navigate` with `Sec-Fetch-Dest: document`; in-app browsers (WeChat, and
 * anything else wrapping a WKWebView) additionally attach `Sec-Fetch-Site:
 * cross-site` or an opaque `Origin: null`, which the API fence must keep
 * refusing but which says nothing about a document navigation: the pairing
 * token or the device id in the URL is what authorizes it.
 * @param request - the node HTTP request.
 * @returns true for a top-level document navigation.
 */
export function isTopLevelDocumentNavigation(request: IncomingMessage): boolean {
  return request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document'
}

/**
 * Test whether a hostname represents a private local-area network (RFC 1918 / ULA / mDNS / loopback).
 * Supports pairing in container-bridged (Docker) or NAT-proxied topologies where the host
 * machine's LAN IP or proxy domain differs from the container's internal sampled network interface.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().trim()
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true
  }
  let ip = normalized
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  if (ip === '::1' || ip === '127.0.0.1') return true
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true
  const parts = ip.split('.').map(Number)
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
  }
  return false
}

/**
 * Validates that an incoming request is non-cross-site (rejects cross-site fetch metadata
 * and ensures Origin matches Host when present).
 */
export function isNonCrossSite(request: IncomingMessage): boolean {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const originUrl = new URL(origin)
    const hostUrl = new URL(`http://${host}`)
    return originUrl.host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * The private-LAN fallback authority of a request: its Host header when the
 * hostname is private/local (RFC 1918 / ULA / mDNS / loopback) and the
 * browser markers are non-cross-site, else undefined. The accept paths and
 * the lanFence fallback use this to serve container-bridged and reverse-proxy
 * topologies whose Host is not among the advertised or configured authorities.
 */
function privateLanHostOf(request: IncomingMessage, navigation = false): string | undefined {
  const host = request.headers.host
  if (typeof host !== 'string') return undefined
  let hostName = ''
  try {
    hostName = new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
  if (hostName === '' || !isPrivateOrLocalHostname(hostName)) return undefined
  // A top-level navigation is judged by its credential, not by the initiator
  // marker (see isTopLevelDocumentNavigation); every other request keeps the
  // non-cross-site requirement.
  if (!(navigation && isTopLevelDocumentNavigation(request)) && !isNonCrossSite(request)) return undefined
  return host
}

/** Cap on pairing request bodies (tokens and workspace ids are tiny). */
const MAX_BODY_BYTES = 4096

/**
 * The rate-limit bucket key for one accept attempt (pure; unit-tested).
 * A forwarded hop separates buckets behind the auto-tunnel (every internet
 * client arrives from 127.0.0.1 there) — but only for loopback peers, since a
 * direct LAN client can rotate the header freely. The caller passes the hop it
 * trusts (the edge-appended LAST one; see rateLimitAccept), and the hop is
 * truncated so one oversized header cannot mint a huge key.
 * @param socketIp - the socket peer address.
 * @param forwarded - the trusted XFF hop, already trimmed, if any.
 * @param bucket - page (GET /pair-accept) vs api (POST /api/pair/accept).
 */
export function acceptLimitKey(socketIp: string, forwarded: string | undefined, bucket: 'page' | 'api'): string {
  if (isLoopbackAddress(socketIp) && forwarded !== undefined && forwarded !== '') {
    return `${bucket}|${socketIp}|${forwarded.slice(0, MAX_FORWARDED_KEY_CHARS)}`
  }
  return `${bucket}|${socketIp}`
}

/** Longest forwarded hop kept in a bucket key (the header is caller-sized). */
const MAX_FORWARDED_KEY_CHARS = 64

/**
 * Hard cap on live accept buckets. The key is caller-influenced (a forwarded
 * hop), so a rotating flood must not grow the table without bound: past the
 * cap the oldest bucket is evicted, the same FIFO stance as
 * {@link addBounded}. A legitimate client that loses its bucket merely starts
 * a fresh window.
 */
export const MAX_ACCEPT_BUCKETS = 1024

/**
 * Cap on the dynamically trusted hosts (see {@link addBounded}): room for
 * every legitimate router/proxy aliasing shape, small enough that a flood of
 * distinct private Host headers cannot grow the table unboundedly.
 */
export const MAX_DYNAMIC_TRUSTED_HOSTS = 64

/**
 * Reasons a phone-facing entry page refused a request, logged once per shape
 * so a real device failure is diagnosable from the host console without a
 * debug build. Keyed by `reason|host|path`; bounded by construction (a handful
 * of reasons, and only the first occurrence of each is printed).
 */
const loggedEntryRefusals = new Set<string>()

/**
 * Log one entry-page refusal (first occurrence per shape) and cap the set.
 * @param request - the refused request.
 * @param path - the entry path that refused it.
 * @param reason - why the fence refused.
 */
function logEntryRefusal(request: IncomingMessage, path: string, reason: string): void {
  const key = `${reason}|${request.headers.host ?? ''}|${path}`
  if (loggedEntryRefusals.has(key) || loggedEntryRefusals.size >= 64) return
  loggedEntryRefusals.add(key)
  const markers = [
    `sec-fetch-site=${request.headers['sec-fetch-site'] ?? '-'}`,
    `sec-fetch-mode=${request.headers['sec-fetch-mode'] ?? '-'}`,
    `sec-fetch-dest=${request.headers['sec-fetch-dest'] ?? '-'}`,
    `origin=${request.headers.origin ?? '-'}`,
  ].join(' ')
  console.log(`remote-web-ui: refused ${path} from host ${request.headers.host ?? '-'} (${reason}; ${markers})`)
}

/**
 * FIFO-bounded Set insert: past `max` entries the oldest one is evicted
 * (a Set iterates in insertion order). The dynamic trusted-host table is fed
 * by caller-controlled Host headers, so it must stay bounded; an evicted
 * legitimate host re-adds itself on that device's next gated request.
 */
export function addBounded(set: Set<string>, value: string, max: number): void {
  if (set.has(value)) return
  if (set.size >= max) {
    const oldest = set.values().next().value
    if (oldest !== undefined) set.delete(oldest)
  }
  set.add(value)
}

/**
 * The host authority of a configured public base URL, e.g. `foo.trycloudflare.com`
 * from `https://foo.trycloudflare.com`. Undefined when the URL does not parse —
 * a malformed config then simply contributes no fence entry (and the panel
 * falls back to LAN-only URLs).
 * @param url - the configured public base URL (or undefined).
 * @returns the `host[:port]` authority the fence should trust.
 */
export function publicHostOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/** Cookie lifetime: one year; revoked sessions die at the gate regardless. */
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60

/**
 * The cookieless device credential: pass the device id from the /pair-app
 * URL into sessionStorage (and localStorage for tab reloads) before any app
 * script runs - same key the boot patch and the channel gate read. The
 * replaceState to '/' hides the credential URL from the address bar and
 * leaves the SPA at its canonical root path. The reopen service worker is
 * registered in the same breath: later navigations to '/' (history,
 * bookmark, tab restore) must not fall through to the harness index gate,
 * which the cookieless flow can never satisfy.
 */
export const APP_DEVICE_STORAGE_KEY = 'dsh-remote-device'

export function appShellCaptureScript(deviceId: string): string {
  const safeId = JSON.stringify(deviceId)
  const grantGlobal = JSON.stringify(REMOTE_HOST_GRANT_GLOBAL)
  const register = `try{if('serviceWorker' in navigator){navigator.serviceWorker.register(${JSON.stringify(PAIR_PATHS.appServiceWorker)},{scope:'/'}).catch(function(e){})}}catch(e){}`
  return `<script>(function(){try{sessionStorage.setItem(${JSON.stringify(APP_DEVICE_STORAGE_KEY)},${safeId});}catch(e){}try{history.replaceState(null,'','/')}catch(e){}try{window[${grantGlobal}]=true}catch(e){}${register}})()</script>`
}

/**
 * Patch the official index document with the device-capture script. The script
 * goes immediately after the opening <head> tag, ahead of the harness-injected
 * parse-time channel boot patch: that patch installs the transport host-mode
 * hook only when this server-served marker is already set (see
 * remote-channel-boot.ts), so host mode is granted by the device-gated landing
 * instead of being asserted from the origin.
 */
export function patchAppShell(html: string, deviceId: string): string {
  const script = appShellCaptureScript(deviceId)
  const head = /<head[^>]*>/i.exec(html)
  if (head === null) return script + html
  const end = head.index + head[0].length
  return html.slice(0, end) + script + html.slice(end)
}

/**
 * The reopen service worker served at PAIR_PATHS.appServiceWorker. A paired
 * phone comes back to `/` from history, bookmarks, or tab restore; the
 * harness fallback seat answers that navigation with its browser-auth 401,
 * and the cookieless mobile flow never holds a browser-auth cookie. The
 * worker owns navigations to `/` instead: network-first through /pair-app
 * (which validates the device cookie and refreshes its presence), the
 * cached shell for offline opens, and a pass-through of the original
 * request when the plugin no longer answers. Plain-HTTP LAN origins are not
 * secure contexts, so the worker never registers there — the LAN reopen
 * path stays "scan a fresh QR", which is cheap in-network.
 *
 * Kept as a plain string (same pattern as the capture script): it must load
 * with no build step, run on every JS engine that ships service workers,
 * and be assertable as source in tests. Bump SHELL_CACHE when the storage
 * layout changes so old caches are pruned on activate.
 */
export function appServiceWorkerScript(): string {
  return `'use strict';
var SHELL_CACHE = 'dsh-remote-shell-v1';
var SHELL_KEY = '/dsh-remote-shell';
var APP_URL = '/pair-app';
self.addEventListener('install', function (event) {
  event.waitUntil(refreshShell().then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.caches.keys().then(function (names) {
    return Promise.all(names.map(function (name) {
      return name === SHELL_CACHE ? Promise.resolve() : self.caches.delete(name);
    }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  var path;
  try { path = new URL(request.url).pathname; } catch (error) { return; }
  if (path !== '/') return;
  event.respondWith(reopen(event));
});
/* Network-first: a live pairing gets the current shell (the /pair-app check
   refreshes lastSeenAt, so every reopen also keeps the session alive); a
   refused shell passes the original navigation through for the harness's
   own response; an unreachable server falls back to the cached shell. */
function reopen(event) {
  var request = event.request;
  return fetch(APP_URL, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
    if (!response.ok) return fetch(request);
    var copy = response.clone();
    event.waitUntil(self.caches.open(SHELL_CACHE).then(function (cache) {
      return cache.put(SHELL_KEY, copy);
    }));
    return response;
  }, function () {
    return self.caches.match(SHELL_KEY).then(function (cached) {
      return cached !== undefined ? cached : fetch(request);
    });
  });
}
/* Best-effort shell warm-up and refresh; never rejects. */
function refreshShell() {
  return fetch(APP_URL, { credentials: 'same-origin', cache: 'no-store' }).then(function (response) {
    if (!response.ok) return undefined;
    var copy = response.clone();
    return self.caches.open(SHELL_CACHE).then(function (cache) {
      return cache.put(SHELL_KEY, copy);
    });
  }, function () { return undefined; });
}`
}

/**
 * The dead-end guard for a failed /pair-accept and for a dead reopen (the
 * reopen service worker serves this page at `/` when the pairing no longer
 * passes): a device without a live pairing has no harness browser-auth
 * cookie, so a redirect to bare `/` would land on the harness browser-auth
 * 401 page ("authentication required"), which reads like a broken server.
 * Serve a plain bilingual explanation instead; an already-paired device (live
 * device cookie, browser credential redeemed during its first scan) keeps
 * the old behavior and is sent on to the app.
 */
function pairingFailurePage(): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>Pairing link invalid</title></head>',
    '<body style="font-family:system-ui,sans-serif;padding:24px;max-width:32em;margin:0 auto;line-height:1.6">',
    '<p><strong>配对已失效，或配对链接已过期。</strong></p>',
    '<p>请在桌面端打开远程控制面板，刷新二维码后重新扫码；重新配对后本机即可恢复访问。</p>',
    '<hr style="border:none;border-top:1px solid #ccc;margin:16px 0">',
    '<p><strong>This pairing has expired or the link is no longer valid.</strong></p>',
    '<p>Open the remote panel on the desktop, refresh the QR code, and scan again — re-pairing restores access on this device.</p>',
    '</body></html>',
  ].join('')
}

/** Route paths (exact matches under /api). */
export const PAIR_PATHS = {
  issue: '/api/pair/issue',
  accept: '/api/pair/accept',
  stop: '/api/pair/stop',
  revoke: '/api/pair/revoke',
  heartbeat: '/api/pair/heartbeat',
  status: '/api/pair/status',
  events: '/api/pair/events',
  lanBind: '/api/pair/lan-bind',
  /** Top-level accept-and-redirect entry the QR link points at. */
  acceptPage: '/pair-accept',
  /** The cookieless app landing: serves the official shell for a paired device. */
  appPage: '/pair-app',
  /**
   * The reopen service worker (registered by the capture script). Root-level
   * path so its default script-directory scope already covers `/`.
   */
  appServiceWorker: '/pair-app.sw.js',
} as const

/**
 * /api/pair request payload contracts. Each POST endpoint validates its body
 * against one of these instead of reaching into a hand-parsed object: the
 * control-plane endpoints that carry no meaningful payload use the permissive
 * pairActionPayloadSchema so their smoke calls keep working unchanged, while
 * issue/accept enforce their optional/required fields. Unknown (extra) keys
 * are tolerated exactly as the previous manual reads ignored them.
 */
export const issuePayloadSchema = z.object({
  address: z.string().min(1).optional(),
})
export const acceptPayloadSchema = z.object({
  token: z.string().default(''),
})
export const revokePayloadSchema = z.object({
  deviceId: z.string().min(1),
})
export const pairActionPayloadSchema = z.object({}).passthrough()

/**
 * Parse a pair request body through schema. A missing/empty, unparseable
 * or non-object body (shared readJsonBody with objectOnly yields null for
 * all of them) is treated as an empty object — the desktop stop/heartbeat
 * send no body — and a value that fails the schema returns `undefined` so
 * the caller can answer with the existing error shape.
 */
function parsePairPayload<T>(schema: ZodType<T>, body: unknown | null): T | undefined {
  const result = schema.safeParse(body ?? {})
  return result.success ? result.data : undefined
}

/** One open desktop status stream. */
interface StatusStream {
  res: ServerResponse
  closed: boolean
}

/** The SSE fan-out for desktop panel status. */
export class PairingEventsStream {
  private readonly streams = new Set<StatusStream>()

  /**
   * @param service - the pairing service whose snapshots are fanned out.
   */
  constructor(service: PairingService) {
    service.onState((snapshot) => { this.push(snapshot) })
  }

  /** Open one stream; the response is owned to completion. */
  open(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const stream: StatusStream = { res, closed: false }
    this.streams.add(stream)
    const close = (): void => {
      if (stream.closed) return
      stream.closed = true
      this.streams.delete(stream)
    }
    res.on('close', close)
    req.on('close', close)
  }

  /** Push one frame to every open stream (contained per stream). */
  push(snapshot: PairingSnapshot): void {
    const frame = `data: ${JSON.stringify({ type: 'state', ...snapshot })}\n\n`
    for (const stream of this.streams) {
      try {
        stream.res.write(frame)
      } catch {
        stream.closed = true
        this.streams.delete(stream)
      }
    }
  }

  /** Stream count (tests/diagnostics). */
  get size(): number {
    return this.streams.size
  }
}

/** Route-family dependencies (test seam). */
export interface PairRoutesDeps {
  /** The pairing service. */
  service: PairingService
  /** Current desktop gate policy, re-read for every status response. */
  requirePairingForLan?: boolean | (() => boolean)
  /**
   * LAN-bind facts for the settings card (managed patch block state, live
   * bind host/port, firewall summary). Re-read per request so a hot-reloaded
   * rebind and a fresh toggle round are both reflected without a restart.
   * The route is loopback-only; undefined drops it (tests).
   */
  lanBindStatus?: () => Record<string, unknown>
  /**
   * The official index document to serve on the /pair-app landing. The
   * plugin fetches it from the inner loopback with its own credential and
   * patches it with the device-capture script, so a paired device loads
   * the app shell WITHOUT passing the harness index gate - the mobile flow
   * then needs no browser cookie at all (the channel gate accepts the
   * cookieless header/query credential). Undefined drops the route (tests).
   */
  indexDocument?: (deviceId: string) => Promise<string | undefined>
  /** Extra trusted non-loopback hosts (from config or environment). */
  trustedHosts?: readonly string[] | (() => readonly string[])
  /**
   * The one-time grant table behind the /pair-accept → /pair-app redirect.
   * Defaults to a fresh store; tests inject one with a fixed clock/entropy.
   */
  grants?: PairGrantStore
}

/**
 * Build the /api/pair route family.
 * @param deps - service + fence inputs.
 * @returns the exact routes to register on webServer.
 */
export function makeRoutes(deps: PairRoutesDeps): WebRoute[] {
  const { service, requirePairingForLan = true } = deps
  const pairingRequired = (): boolean => typeof requirePairingForLan === 'function'
    ? requirePairingForLan()
    : requirePairingForLan
  const grants = deps.grants ?? createPairGrantStore()
  const events = new PairingEventsStream(service)
  const dynamicTrustedHosts = new Set<string>()

  /** Loopback-only fence: the desktop panel's control endpoints. */
  const loopbackFence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, [])
  /**
   * Phone-facing fence: loopback, the service's live LAN literals, configured
   * public host, extra trusted hosts, or dynamically paired hosts. `navigation`
   * relaxes the browser-marker checks for a top-level document navigation (the
   * pairing entry pages), never for an API or subresource request.
   */
  const lanFence = (req: IncomingMessage, navigation = false): boolean => {
    const publicHost = publicHostOf(service.publicBaseUrl)
    // The service's LAN bases re-read per request: a hot rebind (the lan-bind
    // toggle) updates them mid-process, and the fence must follow.
    const bases = service.lanAddresses
    const extraHosts = typeof deps.trustedHosts === 'function' ? deps.trustedHosts() : (deps.trustedHosts ?? [])
    const combined = [
      ...bases,
      ...(publicHost !== undefined ? [publicHost] : []),
      ...extraHosts,
      ...dynamicTrustedHosts,
    ]
    if (navigation && isTopLevelDocumentNavigation(req) ? isTrustedHost(req, combined) : isTrustedApiRequest(req, combined)) return true

    // If request carries a valid paired device cookie from a private LAN host (e.g. after service restart), trust and remember it
    const privateLanHost = privateLanHostOf(req, navigation)
    if (privateLanHost !== undefined) {
      const cookieDeviceId = readCookie(req.headers.cookie, service.config.cookieName)
      let queryDeviceId: string | null = null
      let queryGrant: string | undefined
      try {
        const params = new URL(req.url ?? '/', 'http://pair.invalid').searchParams
        queryDeviceId = params.get('device')
        queryGrant = params.get('grant') ?? undefined
      } catch {}
      // The app landing carries a one-time grant instead of the device id;
      // peek (never spend) so the fence can trust a container/NAT authority
      // whose Host is not among the advertised ones.
      const granted = grants.peek(queryGrant)
      const deviceId = cookieDeviceId ?? queryDeviceId ?? granted ?? undefined
      if (deviceId !== undefined && service.hasDevice(deviceId)) {
        addBounded(dynamicTrustedHosts, privateLanHost, MAX_DYNAMIC_TRUSTED_HOSTS)
        return true
      }
    }
    return false
  }

  const requireMethod = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (req.method === method) return true
    res.writeHead(405)
    res.end()
    return false
  }

  /** Per-source-IP accept rate limit (brute-force defense in depth). */
  const acceptAttempts = new Map<string, { count: number; windowStart: number }>()
  const ACCEPT_MAX_ATTEMPTS = 10
  const ACCEPT_WINDOW_MS = 30_000
  /**
   * @param bucket - the POST /api/pair/accept and the GET /pair-accept flows
   *   count separately: a QR re-scan (page navigation) must not consume a
   *   brute-force budget that belongs to token guessing (and vice versa).
   */
  /**
   * Drop expired buckets from the FRONT of the insertion-ordered table, then
   * FIFO-evict past the hard cap. The front always holds the oldest window
   * because a re-armed bucket is re-inserted at the tail, so this is amortized
   * O(1) per request: every iteration deletes an entry that was inserted once.
   * It replaces a full-table scan that ran on every pairing request once the
   * table passed 256 entries (and deleted nothing while all windows were
   * fresh).
   */
  const pruneAcceptAttempts = (nowMs: number): void => {
    while (acceptAttempts.size > 0) {
      const oldest = acceptAttempts.keys().next().value
      if (oldest === undefined) break
      const attempt = acceptAttempts.get(oldest)
      if (attempt !== undefined && nowMs - attempt.windowStart <= ACCEPT_WINDOW_MS) break
      acceptAttempts.delete(oldest)
    }
    while (acceptAttempts.size > MAX_ACCEPT_BUCKETS) {
      const oldest = acceptAttempts.keys().next().value
      if (oldest === undefined) break
      acceptAttempts.delete(oldest)
    }
  }

  const rateLimitAccept = (req: IncomingMessage, bucket: 'page' | 'api'): boolean => {
    const socketIp = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? 'unknown'
    // XFF is honored only for loopback peers (the tunnel edge); see
    // acceptLimitKey. It is untrusted for authentication and never grants
    // access. Only the LAST hop is used: an edge APPENDS the address it saw, so
    // any earlier hop is whatever the client sent — keying on the first one let
    // an attacker rotate the header for a fresh brute-force budget per request.
    const hops = typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')
      : []
    const forwarded = (hops[hops.length - 1] ?? '').trim()
    const ip = acceptLimitKey(socketIp, forwarded, bucket)
    const nowMs = Date.now()
    pruneAcceptAttempts(nowMs)
    const entry = acceptAttempts.get(ip)
    if (entry === undefined || nowMs - entry.windowStart > ACCEPT_WINDOW_MS) {
      // Re-insert at the tail so insertion order stays window order.
      acceptAttempts.delete(ip)
      acceptAttempts.set(ip, { count: 1, windowStart: nowMs })
      return false
    }
    entry.count += 1
    return entry.count > ACCEPT_MAX_ATTEMPTS
  }

  const handleIssue = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true })
    const payload = parsePairPayload(issuePayloadSchema, body)
    if (payload === undefined) {
      writeJson(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    const { address } = payload
    try {
      // The QR link is the official Web GUI itself: after the accept round
      // trip every device — phone or PC — boots the desktop SPA (phones get
      // the injected portrait adaptation, PCs the full desktop UI), so the
      // remote surface can never drift from the official one.
      const { token, expiresAt } = service.issue(undefined, address)
      // The default base is the public (tunneled) URL when configured — a
      // phone anywhere can reach it — and the first LAN interface otherwise.
      // An explicit address always names a LAN literal.
      const base = address === undefined ? (service.publicBaseUrl ?? service.lanBaseUrl) : service.lanBaseUrlFor(address)
      if (base === undefined) throw new Error('remote-web-ui: base unavailable')
      writeJson(res, 200, {
        ok: true,
        url: `${base}/pair-accept?pair=${token}`,
        token,
        expiresAt,
        // Every constructible base, so a multi-homed panel can switch the
        // advertised network without a second round trip.
        lanAddresses: service.lanAddresses,
        // The configured public base, when present — the panel uses it to
        // label the QR as a public (tunneled) link.
        ...(service.publicBaseUrl !== undefined ? { publicBaseUrl: service.publicBaseUrl } : {}),
      })
    } catch (error) {
      // lan-required (no bind) and unknown-address are both configuration
      // mistakes the panel should surface distinctly.
      const unknownAddress = error instanceof UnknownLanAddressError
      writeJson(res, unknownAddress ? 400 : 409, {
        ok: false,
        code: unknownAddress ? 'unknown-address' : 'lan-required',
      })
    }
  }

  const handleAccept = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    const privateLanHost = privateLanHostOf(req)
    if (!lanFence(req) && privateLanHost === undefined) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    if (rateLimitAccept(req, 'api')) {
      writeJson(res, 429, { ok: false, code: 'rate-limited' })
      return
    }
    const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true })
    const payload = parsePairPayload(acceptPayloadSchema, body)
    if (payload === undefined) {
      writeJson(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    const ua = req.headers['user-agent']
    const result = service.accept(payload.token, typeof ua === 'string' ? ua : undefined)
    if (!result.ok) {
      if (!lanFence(req)) {
        writeJson(res, 403, { ok: false, code: 'forbidden' })
        return
      }
      writeJson(res, 404, { ok: false, code: result.code })
      return
    }
    if (privateLanHost !== undefined) {
      addBounded(dynamicTrustedHosts, privateLanHost, MAX_DYNAMIC_TRUSTED_HOSTS)
    }
    // The Secure attribute follows the transport (deviceCookie): off on
    // plain-HTTP LAN, where a Secure cookie is dropped by the browser, and on
    // for a tunneled request the edge stamped as https. Lax keeps top-level
    // navigations working while blocking cross-site subrequests.
    writeJson(res, 200, { ok: true, deviceId: result.deviceId }, {
      'set-cookie': [deviceCookie(req, service.config.cookieName, result.deviceId)],
    })
  }

  const handleStop = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true })
    if (parsePairPayload(pairActionPayloadSchema, body) === undefined) {
      writeJson(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    service.stop()
    writeJson(res, 200, { ok: true })
  }

  const handleRevoke = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true })
    const payload = parsePairPayload(revokePayloadSchema, body)
    if (payload === undefined) {
      writeJson(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    const revoked = service.revoke(payload.deviceId)
    if (!revoked) {
      writeJson(res, 404, { ok: false, code: 'unknown-device' })
      return
    }
    writeJson(res, 200, { ok: true })
  }

  const handleHeartbeat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!lanFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES, objectOnly: true })
    if (parsePairPayload(pairActionPayloadSchema, body) === undefined) {
      writeJson(res, 400, { ok: false, code: 'bad-payload' })
      return
    }
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined || !service.heartbeat(deviceId)) {
      writeJson(res, 401, { ok: false, code: 'unpaired' })
      return
    }
    writeJson(res, 200, { ok: true })
  }

  const handleStatus = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'GET')) return
    if (!lanFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    const paired = deviceId !== undefined && service.hasDevice(deviceId)
    // The desktop (loopback) keeps the full pairing-relevant view; the LAN IP
    // literals stay behind a live pairing or loopback so an unauthenticated
    // caller on a tunnel cannot map the internal network. A phone already knows
    // its usable literal from the URL it opened.
    const local = isLoopbackClient(req)
    const snapshot = service.snapshot()
    // Unpaired LAN/tunnel clients get only the pairing-relevant fields; the
    // token expiry, public tunnel URL, and counts are an oracle for targeting
    // and stay behind a live device cookie. The per-device roster (ids are
    // session credentials) is never returned here — only the loopback events
    // stream carries it to the desktop panel.
    const { devices: _devices, ...rest } = snapshot
    const visible = paired || local
      ? rest
      : { phase: snapshot.phase, lanAvailable: snapshot.lanAvailable }
    writeJson(res, 200, { ok: true, paired, requirePairingForLan: pairingRequired(), ...visible })
  }

  const handleEvents = (req: IncomingMessage, res: ServerResponse): void => {
    if (!requireMethod(req, res, 'GET')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    events.open(req, res)
    // Snapshot on open: a late-opening panel converges without history.
    events.push(service.snapshot())
  }

  /** LAN-bind facts for the settings card; loopback-only, read per request. */
  const handleLanBind = (req: IncomingMessage, res: ServerResponse): void => {
    if (!requireMethod(req, res, 'GET')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    writeJson(res, 200, { ok: true, ...(deps.lanBindStatus?.() ?? {}) })
  }

  /**
   * The QR entry: navigate here with ?pair=<token>. Sets the device cookie,
   * then redirects to the authenticated home (the connection service's
   * launch-token URL), so a LAN device that has never seen this authority
   * clears the browser-auth gate and boots the paired official UI in one
   * chain: /pair-accept → /?token=<launch> → /. A device that is already
   * authenticated (or loopback) skips straight through the same way.
   */
  const handleAcceptPage = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'GET')) return
    const privateLanHost = privateLanHostOf(req, true)
    if (!lanFence(req, true) && privateLanHost === undefined) {
      logEntryRefusal(req, PAIR_PATHS.acceptPage, 'untrusted-host')
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    if (rateLimitAccept(req, 'page')) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('rate limited')
      return
    }
    const url = new URL(req.url ?? '/', 'http://pair.invalid')
    const token = url.searchParams.get('pair') ?? ''
    const ua = req.headers['user-agent']
    const result = token === '' ? { ok: false as const, code: 'invalid' as const } : service.accept(token, typeof ua === 'string' ? ua : undefined)
    if (!result.ok) {
      if (!lanFence(req, true)) {
        logEntryRefusal(req, PAIR_PATHS.acceptPage, 'untrusted-host-after-invalid-token')
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('forbidden')
        return
      }
      // accept() now refuses only expired/unknown/stopped tokens: a consumed
      // token stays re-usable until its expiry or replacement, so a mobile
      // flow that split across cookie contexts (camera preview, in-app
      // browser, system browser) can re-pair from the same link. A failure
      // here means the link is truly dead: an already-paired device is sent
      // on to the app, everyone else gets the bilingual explanation page
      // instead of the harness 401 dead end.
      const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
      if (deviceId !== undefined && service.hasDevice(deviceId)) {
        // An already-paired device re-opening a dead link goes straight to the
        // cookieless app landing, again on a fresh one-time grant.
        const { grant } = grants.issue(deviceId)
        res.writeHead(303, { location: `${appOrigin(req)}/pair-app?grant=${encodeURIComponent(grant)}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      res.end(pairingFailurePage())
      return
    }
    if (privateLanHost !== undefined) {
      addBounded(dynamicTrustedHosts, privateLanHost, MAX_DYNAMIC_TRUSTED_HOSTS)
    }
    // Land the paired device on the cookieless app page: the official shell
    // served by this plugin. The URL carries a one-time grant, never the
    // device id - a session credential must not travel in a URL (history, the
    // address bar, every log on the redirect path) - and the landing's own
    // response hands the device id to the shell. No harness index gate, no
    // browser-auth cookie hop: the channel gate accepts the device credential
    // whether or not the browser stores cookies.
    const { grant } = grants.issue(result.deviceId)
    res.writeHead(303, {
      location: `${appOrigin(req)}/pair-app?grant=${encodeURIComponent(grant)}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': [deviceCookie(req, service.config.cookieName, result.deviceId)],
    })
    res.end()
  }

  /**
   * The cookieless app landing. A paired device (a one-time grant minted by
   * /pair-accept, or a live pairing cookie on a reopen) receives the official
   * index shell patched with the device-capture script; the shell itself is
   * the official document and carries no data, so serving it needs only the
   * device credential.
   */
  const handleAppPage = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'GET')) return
    if (!lanFence(req, true)) {
      logEntryRefusal(req, PAIR_PATHS.appPage, 'untrusted-host')
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    if (rateLimitAccept(req, 'page')) {
      res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('rate limited')
      return
    }
    const url = new URL(req.url ?? '/', 'http://pair.invalid')
    // The one-time grant is spent before anything else: a replayed or expired
    // grant resolves to nothing (pair-grant.ts), so a leaked landing URL can
    // never be re-run. The cookie stays the primary credential for a reopen
    // (the service worker's network-first navigation carries it).
    const grantedDevice = grants.consume(url.searchParams.get('grant') ?? undefined)
    const cookieDevice = readCookie(req.headers.cookie, service.config.cookieName)
    const id = (grantedDevice !== undefined && service.touchDevice(grantedDevice))
      ? grantedDevice
      : (cookieDevice !== undefined && service.touchDevice(cookieDevice))
        ? cookieDevice
        : undefined
    if (id === undefined) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      res.end(pairingFailurePage())
      return
    }
    const html = await deps.indexDocument?.(id).catch(() => undefined)
    if (html === undefined) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end('remote device app unavailable')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': [deviceCookie(req, service.config.cookieName, id)],
    })
    res.end(patchAppShell(html, id))
  }

  /**
   * The reopen service worker script. Same phone-facing fence as the app
   * page but no rate limit and no device check: the script is inert logic
   * (no secrets, no data), and browsers re-fetch it on navigations for
   * update checks, which must not trip a brute-force budget. no-store keeps
   * the update check meaningful across deploys.
   */
  const handleAppServiceWorker = (req: IncomingMessage, res: ServerResponse): void => {
    if (!requireMethod(req, res, 'GET')) return
    if (!lanFence(req, true)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('forbidden')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      // Defensive: the root-level script path already allows a `/` scope,
      // the header keeps that explicit for engines that want it stated.
      'service-worker-allowed': '/',
    })
    res.end(appServiceWorkerScript())
  }

  const routes: WebRoute[] = [
    { kind: 'exact', path: PAIR_PATHS.issue, handler: handleIssue },
    { kind: 'exact', path: PAIR_PATHS.accept, handler: handleAccept },
    { kind: 'exact', path: PAIR_PATHS.stop, handler: handleStop },
    { kind: 'exact', path: PAIR_PATHS.revoke, handler: handleRevoke },
    { kind: 'exact', path: PAIR_PATHS.heartbeat, handler: handleHeartbeat },
    { kind: 'exact', path: PAIR_PATHS.status, handler: handleStatus },
    { kind: 'exact', path: PAIR_PATHS.events, handler: handleEvents },
  ]
  if (deps.lanBindStatus !== undefined) {
    routes.push({ kind: 'exact', path: PAIR_PATHS.lanBind, handler: handleLanBind })
  }
  routes.push({ kind: 'exact', path: PAIR_PATHS.acceptPage, handler: handleAcceptPage })
  if (deps.indexDocument !== undefined) {
    routes.push({ kind: 'exact', path: PAIR_PATHS.appPage, handler: handleAppPage })
    // The reopen worker is only meaningful when the app landing it
    // re-serves exists (same condition as /pair-app).
    routes.push({ kind: 'exact', path: PAIR_PATHS.appServiceWorker, handler: handleAppServiceWorker })
  }
  return routes
}

/**
 * Whether the request reached this process over TLS. The harness itself serves
 * plain HTTP; a tunnel edge terminates TLS and stamps `x-forwarded-proto`
 * (the same signal {@link appOrigin} trusts when it rebuilds a redirect).
 */
export function isHttpsRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim().toLowerCase()
    if (first === 'https') return true
  }
  return (req.socket as { encrypted?: boolean }).encrypted === true
}

/**
 * The device cookie for one request. `Secure` is added only when the request
 * arrived over TLS: LAN pairing runs on plain HTTP, where a Secure cookie is
 * simply dropped by the browser and the phone would silently lose its session.
 */
export function deviceCookie(req: IncomingMessage, cookieName: string, deviceId: string): string {
  const secure = isHttpsRequest(req) ? '; Secure' : ''
  return `${cookieName}=${deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}${secure}`
}

/** The request origin (https when a tunnel edge says so). */
function appOrigin(req: IncomingMessage): string {
  const origin = `http://${req.headers.host ?? '127.0.0.1'}`
  return isHttpsRequest(req) ? origin.replace('http://', 'https://') : origin
}
