/**
 * The mobile surface's data channel: `/m/api` proxies the host ApiProxy
 * service for the standalone phone page. The phone's RPC calls ride THIS
 * prefix instead of the connection plugin's `/api` — so the tunneled Host
 * never needs to enter the connection trust fence (a distributable plugin
 * cannot change that fence), and this plugin's own pairing gate is the
 * access control instead.
 *
 * Security model:
 * - Every request must carry a live paired-device cookie (the same gate
 *   semantic as the LAN fence), enforced before any host call.
 * - Only an explicit allowlist of methods is proxied; privileged domains
 *   (settings, credentials, host actions, goals, subagents, …) are never
 *   reachable from the phone.
 * - `session.list` is paged here (the host API returns everything; this
 *   layer slices stable pages) so the phone never transfers the whole list.
 * - The live mux stream is bridged over Server-Sent Events on the same
 *   prefix (one-directional push; answers to questions/approvals ride the
 *   unary channel), gated identically.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import type { PairingService } from './pairing.ts'
import { readCookie } from './gate.ts'

/** Methods the phone surface may call. Everything else is refused. */
const MOBILE_ALLOWLIST = new Set([
  'workspace.list',
  'session.create',
  'session.list',
  'session.history',
  'session.search',
  'session.prompt',
  'session.models',
  'session.selectModel',
  'session.rename',
])

/**
 * Locally answered display-preference method (the phone's read-only
 * surface preferences; never proxied to the host ApiProxy and never a
 * settings-domain write).
 */
const MOBILE_PREFERENCES_METHOD = 'mobile.preferences'

/** One session.list page (thin phones load incrementally). */
const SESSION_PAGE_SIZE = 20
/** SSE keep-alive ping cadence for the live mux stream (single connection). */
const DEFAULT_EVENTS_HEARTBEAT_MS = 15_000

/** Encode one list position as an opaque continuation cursor. */
function sessionListCursor(updatedAt: number, sessionId: string): string {
  return `${updatedAt}:${sessionId}`
}

/** Parse a cursor; malformed cursors mean "start over" (safe failure mode). */
function parseSessionListCursor(cursor: string): { updatedAt: number; sessionId: string } | undefined {
  const separator = cursor.indexOf(':')
  if (separator < 0) return undefined
  const updatedAt = Number(cursor.slice(0, separator))
  if (!Number.isFinite(updatedAt)) return undefined
  return { updatedAt, sessionId: cursor.slice(separator + 1) }
}

/** Whether a row comes strictly after the cursor position. */
function afterCursor(row: { updatedAt: number; sessionId: string }, position: { updatedAt: number; sessionId: string }): boolean {
  return row.updatedAt < position.updatedAt
    || (row.updatedAt === position.updatedAt && row.sessionId > position.sessionId)
}

/** Route-family dependencies. */
export interface MobileApiDeps {
  /** The pairing service (device gate + cookie name). */
  service: PairingService
  /** The host ApiProxy service (injected by the plugin). */
  apiProxy: ApiProxy
  /** The resolved mobile composer preference (live per request). */
  mobileEnterToSend: () => boolean
  /** SSE keep-alive ping cadence for the mux stream (default 15000 ms; test seam). */
  eventsHeartbeatMs?: number
}

/** Mobile API route paths. */
export const MOBILE_API_PATHS = {
  events: '/m/api/events.mux',
} as const

/** The mobile-api prefix (every other path under it is a method name). */
const MOBILE_API_PREFIX = '/m/api'
/** Method extraction: the prefix plus one slash. */
const MOBILE_API_METHOD_PREFIX = `${MOBILE_API_PREFIX}/`

/**
 * Build the mobile data-channel routes.
 * @param deps - pairing service + apiProxy.
 * @returns the routes to register on webServer.
 */
export function makeMobileApiRoutes(deps: MobileApiDeps): WebRoute[] {
  const { service, apiProxy, mobileEnterToSend } = deps
  const eventsHeartbeatMs = deps.eventsHeartbeatMs ?? DEFAULT_EVENTS_HEARTBEAT_MS

  /**
   * Refresh the paired device's presence and report whether it is live.
   * The mobile surface (unlike the desktop Web UI) has no `/api/pair/heartbeat`
   * sender, so any activity on the mobile channel — a gated RPC, or the live
   * SSE stream staying open — must count as presence. Without this, an
   * idle-but-connected phone ages past `offlineAfterMs` and the desktop panel
   * wrongly reports it as disconnected.
   */
  const touchDeviceFor = (req: IncomingMessage): boolean => {
    const deviceId = readCookie(req.headers.cookie, service.config.cookieName)
    if (deviceId === undefined) return false
    return service.touchDevice(deviceId)
  }

  /** The phone gate: a live paired-device cookie, or nothing else proceeds. */
  const gateOk = (req: IncomingMessage): boolean => {
    return touchDeviceFor(req)
  }

  const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const handleMethod = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      writeJson(res, 403, { ok: false, error: { code: 'unpaired', message: 'mobile session is not paired' } })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (!pathname.startsWith(MOBILE_API_METHOD_PREFIX)) {
      writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown mobile api path' } })
      return
    }
    const method = pathname.slice(MOBILE_API_METHOD_PREFIX.length)
    const local = method === MOBILE_PREFERENCES_METHOD
    if (!MOBILE_ALLOWLIST.has(method) && !local) {
      writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: `method ${method} is not exposed to the mobile surface` } })
      return
    }
    let envelope: unknown
    try {
      envelope = await readJsonBody(req)
    } catch {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'invalid json body' } })
      return
    }
    const parsed = envelope as { rpcId?: unknown; payload?: unknown }
    const rpcId = typeof parsed?.rpcId === 'string' ? parsed.rpcId : ''
    if (rpcId === '') {
      writeJson(res, 400, { ok: false, error: { code: 'bad-request', message: 'missing rpcId' } })
      return
    }
    if (local) {
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { mobileEnterToSend: mobileEnterToSend() } },
      })
      return
    }
    try {
      const response = await dispatch(apiProxy, method, parsed?.payload, rpcId)
      writeJson(res, 200, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(res, 200, {
        type: 'server-response',
        rpcId,
        result: { ok: false, error: { code: 'internal', message } },
      })
    }
  }

  /** Bridge the host mux stream over SSE: one `data:` frame per mux frame. */
  const handleEvents = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!gateOk(req)) {
      res.writeHead(403)
      res.end('forbidden')
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const controller = new AbortController()
    let closed = false
    const heartbeat = setInterval(() => {
      if (closed) return
      // An open SSE stream proves the phone is still live even while the agent
      // idles (no RPC traffic), so refresh presence alongside the transport
      // keepalive — otherwise an idle phone drifts to "disconnected".
      touchDeviceFor(req)
      try {
        res.write(': ping\n\n')
      } catch {
        // The write failed; the close handler tears the subscription down.
      }
    }, eventsHeartbeatMs)
    const onClose = (): void => {
      if (closed) return
      closed = true
      controller.abort()
      clearInterval(heartbeat)
    }
    res.on('close', onClose)
    req.on('close', onClose)
    try {
      const frames = apiProxy.events.mux({ rpcId: RpcId(`mobile-mux-${Date.now().toString(36)}`), payload: {} }, controller.signal)
      for await (const frame of frames) {
        if (closed) break
        res.write(`data: ${JSON.stringify(frame)}\n\n`)
      }
    } catch {
      // The stream ended or errored; the EventSource reconnects.
    } finally {
      controller.abort()
      clearInterval(heartbeat)
    }
    if (!closed) res.end()
  }

  return [
    { kind: 'prefix', path: MOBILE_API_PREFIX, handler: handleMethod },
    { kind: 'exact', path: MOBILE_API_PATHS.events, handler: handleEvents },
  ]
}

/** Read a request body as JSON (bounded). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Dispatch one allowlisted method through the host ApiProxy. */
async function dispatch(apiProxy: ApiProxy, method: string, payload: unknown, rpcId: string): Promise<unknown> {
  const request: RpcRequest<unknown> = { rpcId: RpcId(rpcId), payload }
  if (method === 'session.list') {
    const full = await apiProxy.sessions.list(request as never)
    if (!full.result.ok) return full
    const items = full.result.value.items as Array<{ updatedAt: number; sessionId: string }>
    const cursor = (payload as { cursor?: string } | undefined)?.cursor
    // Every call pages (the first call with no cursor IS the first page):
    // the phone must never transfer the whole session list at once.
    // One stable page over (updatedAt desc, sessionId asc); pages never skip
    // or repeat a row while the list changes between calls.
    items.sort((a, b) => b.updatedAt - a.updatedAt
      || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
    const position = cursor === undefined ? undefined : parseSessionListCursor(cursor)
    const from = position === undefined ? 0 : items.findIndex(row => afterCursor(row, position))
    const start = from < 0 ? items.length : from
    const page = items.slice(start, start + SESSION_PAGE_SIZE)
    const last = page[page.length - 1]
    const nextCursor = last !== undefined && start + page.length < items.length
      ? sessionListCursor(last.updatedAt, last.sessionId)
      : undefined
    return {
      type: 'server-response',
      rpcId,
      result: {
        ok: true,
        value: {
          items: page,
          hasMore: nextCursor !== undefined,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        },
      },
    }
  }
  // The ApiProxy unary methods resolve to the internal response shape
  // ({ rpcId, result }) without the transport envelope the phone's callUnary
  // requires — wrap every pass-through in the same 'server-response'
  // envelope session.list builds above.
  const wrap = (response: { rpcId: string; result: unknown }): unknown => ({
    type: 'server-response' as const,
    rpcId,
    result: response.result,
  })
  if (method === 'workspace.list') return wrap(await apiProxy.workspace.list(request as never))
  if (method === 'session.create') return wrap(await apiProxy.sessions.create(request as never))
  if (method === 'session.history') return wrap(await apiProxy.sessions.history(request as never))
  if (method === 'session.search') return wrap(await apiProxy.sessions.search(request as never, new AbortController().signal))
  if (method === 'session.prompt') return wrap(await apiProxy.sessions.prompt(request as never))
  if (method === 'session.models') return wrap(await apiProxy.sessions.models(request as never))
  if (method === 'session.selectModel') return wrap(await apiProxy.sessions.selectModel(request as never))
  if (method === 'session.rename') return wrap(await apiProxy.sessions.rename(request as never))
  throw new Error(`unhandled allowlisted method ${method}`)
}
