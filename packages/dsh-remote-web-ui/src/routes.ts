/**
 * The /api/pair route family + the desktop status stream. Exact routes
 * under /api: the webserver matches exact paths before the connection
 * plugin's /api prefix, so these handlers own the full response lifecycle
 * and apply their own trust fence (loopback-only for control endpoints;
 * loopback-or-LAN for the phone-facing accept/heartbeat/status). The
 * cookie set on accept is the device identity the api/gate listener checks
 * on every other /api request.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { UnknownLanAddressError, type PairingService, type PairingSnapshot } from './pairing.ts'
import { isLoopbackClient, readCookie } from './gate.ts'

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

/** Route paths (exact matches under /api). */
export const PAIR_PATHS = {
  issue: '/api/pair/issue',
  accept: '/api/pair/accept',
  stop: '/api/pair/stop',
  heartbeat: '/api/pair/heartbeat',
  status: '/api/pair/status',
  events: '/api/pair/events',
} as const

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a request body up to MAX_BODY_BYTES and parse it as JSON. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
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
}

/**
 * Build the /api/pair route family.
 * @param deps - service + fence inputs.
 * @returns the exact routes to register on webServer.
 */
export function makeRoutes(deps: PairRoutesDeps): WebRoute[] {
  const { service, lanAddresses } = deps
  const events = new PairingEventsStream(service)

  /** Loopback-only fence: the desktop panel's control endpoints. */
  const loopbackFence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, [])
  /** Phone-facing fence: loopback, the derived LAN literals, or the configured public host. */
  const lanFence = (req: IncomingMessage): boolean => {
    const publicHost = publicHostOf(service.publicBaseUrl)
    return isTrustedApiRequest(req, publicHost === undefined ? lanAddresses : [...lanAddresses, publicHost])
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
  const rateLimitAccept = (req: IncomingMessage): boolean => {
    const ip = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress ?? 'unknown'
    const nowMs = Date.now()
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
    const body = await readJsonBody(req)
    const workspaceId = body === undefined || typeof body.workspaceId !== 'string' || body.workspaceId === ''
      ? undefined
      : body.workspaceId
    const address = body === undefined || typeof body.address !== 'string' || body.address === ''
      ? undefined
      : body.address
    try {
      const { token, expiresAt } = service.issue(workspaceId, address)
      // The default base is the public (tunneled) URL when configured — a
      // phone anywhere can reach it — and the first LAN interface otherwise.
      // An explicit address always names a LAN literal.
      const base = address === undefined ? (service.publicBaseUrl ?? service.lanBaseUrl) : service.lanBaseUrlFor(address)
      if (base === undefined) throw new Error('remote-web-ui: base unavailable')
      const workspaceQuery = workspaceId === undefined ? '' : `&workspace=${encodeURIComponent(workspaceId)}`
      writeJson(res, 200, {
        ok: true,
        url: `${base}/?pair=${token}${workspaceQuery}`,
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
    if (rateLimitAccept(req)) {
      writeJson(res, 429, { ok: false, code: 'rate-limited' })
      return
    }
    const body = await readJsonBody(req)
    const token = typeof body?.token === 'string' ? body.token : ''
    const result = service.accept(token)
    if (!result.ok) {
      writeJson(res, result.code === 'used' ? 409 : 404, { ok: false, code: result.code })
      return
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': [
        `${service.config.cookieName}=${result.deviceId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${String(COOKIE_MAX_AGE_SEC)}`,
      ],
    })
    res.end(JSON.stringify({ ok: true, deviceId: result.deviceId }))
  }

  const handleStop = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!loopbackFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    await readJsonBody(req)
    service.stop()
    writeJson(res, 200, { ok: true })
  }

  const handleHeartbeat = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!requireMethod(req, res, 'POST')) return
    if (!lanFence(req)) {
      writeJson(res, 403, { ok: false, code: 'forbidden' })
      return
    }
    await readJsonBody(req)
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
    writeJson(res, 200, { ok: true, paired: deviceId !== undefined && service.hasDevice(deviceId), ...service.snapshot() })
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

  return [
    { kind: 'exact', path: PAIR_PATHS.issue, handler: handleIssue },
    { kind: 'exact', path: PAIR_PATHS.accept, handler: handleAccept },
    { kind: 'exact', path: PAIR_PATHS.stop, handler: handleStop },
    { kind: 'exact', path: PAIR_PATHS.heartbeat, handler: handleHeartbeat },
    { kind: 'exact', path: PAIR_PATHS.status, handler: handleStatus },
    { kind: 'exact', path: PAIR_PATHS.events, handler: handleEvents },
  ]
}
