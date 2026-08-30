/**
 * The /api/pair route family + the desktop status stream. Exact routes
 * under /api: the webserver matches exact paths before the connection
 * plugin's /api prefix, so these handlers own the full response lifecycle
 * and apply their own trust fence (loopback-only for control endpoints;
 * loopback-or-LAN for the phone-facing accept/heartbeat/status). The cookie
 * set on accept is the device identity the plugin's own surfaces enforce:
 * the /remote channel gate and the api/gate listener. Note that on the
 * 0.1.2-alpha.1 cohort nothing emits api/gate — direct /api is governed by
 * the harness fence + browser auth — while the /remote channel always
 * enforces the pairing cookie itself.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { z, type ZodType } from 'zod'
import { UnknownLanAddressError, type PairingService, type PairingSnapshot } from './pairing.ts'
import { isLoopbackAddress } from './loopback.ts'
import { isLoopbackClient, readCookie } from './gate.ts'
import { readJsonBody, writeJson } from './http.ts'

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
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  const trusted = isLoopbackClient(request) || trustedHosts.some(entry => {
    // A port-less entry matches the hostname on any port; an exact host:port
    // entry matches that authority verbatim (WHATWG normalization both sides).
    const entryUrl = new URL(`http://${entry}`)
    return entryUrl.port === '' ? entryUrl.hostname === hostname : entryUrl.host === hostUrl.host
  })
  if (!trusted) return false
  // Cross-site fence: an explicit cross-site marker is refused regardless of
  // Origin (modern browsers label the initiator on every fetch).
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  // Origin fence: when a browser attaches an Origin it must be exactly this
  // authority; absent Origin is fine — the Host fence already bound it.
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Cap on pairing request bodies (tokens and workspace ids are tiny). */
const MAX_BODY_BYTES = 4096

/**
 * The rate-limit bucket key for one accept attempt (pure; unit-tested).
 * The first client-visible XFF hop separates buckets behind the auto-tunnel
 * (every internet client arrives from 127.0.0.1 there) — but only for
 * loopback peers, since a direct LAN client can rotate the header freely.
 * @param socketIp - the socket peer address.
 * @param forwarded - the first XFF hop, already trimmed, if any.
 * @param bucket - page (GET /pair-accept) vs api (POST /api/pair/accept).
 */
export function acceptLimitKey(socketIp: string, forwarded: string | undefined, bucket: 'page' | 'api'): string {
  if (isLoopbackAddress(socketIp) && forwarded !== undefined && forwarded !== '') {
    return `${bucket}|${socketIp}|${forwarded}`
  }
  return `${bucket}|${socketIp}`
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
 * leaves the SPA at its canonical root path.
 */
export const APP_DEVICE_STORAGE_KEY = 'dsh-remote-device'

export function appShellCaptureScript(deviceId: string): string {
  const safeId = JSON.stringify(deviceId)
  return `<script>(function(){try{sessionStorage.setItem(${JSON.stringify(APP_DEVICE_STORAGE_KEY)},${safeId});localStorage.setItem(${JSON.stringify(APP_DEVICE_STORAGE_KEY)},${safeId});}catch(e){}try{history.replaceState(null,'','/')}catch(e){}})()</script>`
}

/** Patch the official index document with the device-capture script. */
export function patchAppShell(html: string, deviceId: string): string {
  const script = appShellCaptureScript(deviceId)
  const marker = '</head>'
  const at = html.indexOf(marker)
  if (at === -1) return script + html
  return html.slice(0, at) + script + html.slice(at)
}

/**
 * The dead-end guard for a failed /pair-accept: an unauthenticated device
 * redirected to bare `/` would land on the harness browser-auth 401 page
 * ("authentication required"), which reads like a broken server. Serve a
 * plain bilingual explanation instead; an already-paired device (live
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
    '<p><strong>配对链接已失效或已被使用。</strong></p>',
    '<p>请在桌面端打开远程控制面板，刷新二维码后重新扫码。</p>',
    '<hr style="border:none;border-top:1px solid #ccc;margin:16px 0">',
    '<p><strong>This pairing link is invalid or has already been used.</strong></p>',
    '<p>Open the remote panel on the desktop, refresh the QR code, and scan again.</p>',
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
  /** The LAN IP literals the fence accepts (derived from the bind host). */
  lanAddresses: readonly string[]
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
}

/**
 * Build the /api/pair route family.
 * @param deps - service + fence inputs.
 * @returns the exact routes to register on webServer.
 */
export function makeRoutes(deps: PairRoutesDeps): WebRoute[] {
  const { service, lanAddresses, requirePairingForLan = true } = deps
  const pairingRequired = (): boolean => typeof requirePairingForLan === 'function'
    ? requirePairingForLan()
    : requirePairingForLan
  const events = new PairingEventsStream(service)

  /** Loopback-only fence: the desktop panel's control endpoints. */
  const loopbackFence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, [])
  /** Phone-facing fence: loopback, the service's live LAN literals, or the configured public host. */
  const lanFence = (req: IncomingMessage): boolean => {
    const publicHost = publicHostOf(service.publicBaseUrl)
    // The service's LAN bases re-read per request: a hot rebind (the lan-bind
    // toggle) updates them mid-process, and the fence must follow.
    const bases = service.lanAddresses
    return isTrustedApiRequest(req, publicHost === undefined ? bases : [...bases, publicHost])
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
  const rateLimitAccept = (req: IncomingMessage, bucket: 'page' | 'api'): boolean => {
    const socketIp = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? 'unknown'
    // XFF is honored only for loopback peers (the tunnel edge); see
    // acceptLimitKey. It is untrusted for authentication and never grants
    // access.
    const forwarded = typeof req.headers['x-forwarded-for'] === 'string'
      ? (req.headers['x-forwarded-for'].split(',')[0] ?? '').trim()
      : undefined
    const ip = acceptLimitKey(socketIp, forwarded, bucket)
    const nowMs = Date.now()
    // The map lives as long as the plugin: prune expired windows once the
    // table grows past a modest size so distinct source IPs (LAN clients,
    // brute-force scans) cannot accumulate forever.
    if (acceptAttempts.size > 256) {
      for (const [key, attempt] of acceptAttempts) {
        if (nowMs - attempt.windowStart > ACCEPT_WINDOW_MS) acceptAttempts.delete(key)
      }
    }
    const entry = acceptAttempts.get(ip)
    if (entry === undefined || nowMs - entry.windowStart > ACCEPT_WINDOW_MS) {
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
    if (!lanFence(req)) {
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
      writeJson(res, result.code === 'used' ? 409 : 404, { ok: false, code: result.code })
      return
    }
    // No Secure attribute: LAN pairing runs over plain HTTP (the cookie must
    // work there), and the same cookie rides HTTPS on the tunnel. Lax keeps
    // top-level navigations working while blocking cross-site subrequests.
    writeJson(res, 200, { ok: true, deviceId: result.deviceId }, {
      'set-cookie': [
        `${service.config.cookieName}=${result.deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`,
      ],
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
    const snapshot = service.snapshot()
    // Unpaired LAN/tunnel clients get only the pairing-relevant fields; the
    // token expiry, public tunnel URL, and counts are an oracle for targeting
    // and stay behind a live device cookie. The per-device roster (ids are
    // session credentials) is never returned here — only the loopback events
    // stream carries it to the desktop panel.
    const { devices: _devices, ...rest } = snapshot
    const visible = paired
      ? rest
      : { phase: snapshot.phase, lanAvailable: snapshot.lanAvailable, lanAddresses: snapshot.lanAddresses }
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
    if (!lanFence(req)) {
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
      // accept() now refuses only expired/unknown/stopped tokens: a consumed
      // token stays re-usable until its expiry or replacement, so a mobile
      // flow that split across cookie contexts (camera preview, in-app
      // browser, system browser) can re-pair from the same link. A failure
      // here means the link is truly dead: an already-paired device is sent
      // on to the app, everyone else gets the bilingual explanation page
      // instead of the harness 401 dead end.
      const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
      if (deviceId !== undefined && service.hasDevice(deviceId)) {
        // An already-paired device re-opening a dead link goes straight to
        // the cookieless app landing with its live device credential.
        res.writeHead(303, { location: `${appOrigin(req)}/pair-app?device=${encodeURIComponent(deviceId)}`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
      res.end(pairingFailurePage())
      return
    }
    // Land the paired device on the cookieless app page: the official shell
    // served by this plugin, with the device id in the URL. No harness index
    // gate, no browser-auth cookie hop - the channel gate accepts the device
    // credential whether or not the browser stores cookies.
    res.writeHead(303, {
      location: `${appOrigin(req)}/pair-app?device=${encodeURIComponent(result.deviceId)}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'set-cookie': [
        `${service.config.cookieName}=${result.deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`,
      ],
    })
    res.end()
  }

  /**
   * The cookieless app landing. A paired device (device query or live
   * pairing cookie) receives the official index shell patched with the
   * device-capture script; the shell itself is the official document and
   * carries no data, so serving it needs only the device credential.
   */
  const handleAppPage = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'GET')) return
    if (!lanFence(req)) {
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
    const device = url.searchParams.get('device') ?? ''
    const cookieDevice = readCookie(req.headers.cookie, service.config.cookieName)
    const id = (device !== '' && service.touchDevice(device))
      ? device
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
      'set-cookie': [
        `${service.config.cookieName}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`,
      ],
    })
    res.end(patchAppShell(html, id))
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
  }
  return routes
}

/** The request origin (https when a tunnel edge says so). */
function appOrigin(req: IncomingMessage): string {
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  const origin = `http://${req.headers.host ?? '127.0.0.1'}`
  return proto === 'https' ? origin.replace('http://', 'https://') : origin
}
