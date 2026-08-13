/**
 * The /api/dsh-beyond-workscope route family: pending-grant confirmation,
 * active-grant management, and audit history for the browser half.
 *
 * The webServer matches registered paths EXACTLY (no path parameters), so
 * action targets travel in the JSON body — the same convention dsh-ssh uses.
 * Every route carries the loopback-only trust fence (plus browser same-origin
 * markers): these endpoints hand out and revoke filesystem permissions, so
 * LAN-exposed dsh web deployments must not serve them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { GrantRegistry } from './grants.ts'
import {
  API_PREFIX,
  type ApprovePendingPayload,
  type DenyPendingPayload,
  type RevokeGrantPayload,
  type SimpleActionResponse,
} from './protocol.ts'

/** Cap on JSON request bodies (approve/deny payloads are tiny). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh's fence). */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Read and parse a small JSON body, or respond 400. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_JSON_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw) as unknown
}

/** Write a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Shared guard for every route. */
function fence(request: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackRequest(request)) return true
  json(res, 403, { ok: false, error: 'forbidden: loopback only' } satisfies SimpleActionResponse)
  return false
}

/** A handler that received a parsed body. */
type BodyHandler = (body: unknown, req: IncomingMessage, res: ServerResponse) => void | Promise<void>

/** Wrap a body-consuming route: fence + method + JSON parse + body handler. */
function bodyRoute(handler: BodyHandler): WebRoute['handler'] {
  return async (req, res) => {
    if (!fence(req, res)) return
    if ((req.method ?? 'GET') !== 'POST') {
      json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req)
    } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON 或过大' } satisfies SimpleActionResponse)
      return
    }
    try {
      await handler(body, req, res)
    } catch (error) {
      json(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies SimpleActionResponse)
    }
  }
}

/**
 * Build the route family.
 * @param registry - the grant registry the routes drive.
 * @returns named web routes (register with ctx.webServer.register).
 */
export function makeRoutes(registry: GrantRegistry): WebRoute[] {
  return [
    {
      kind: 'exact',
      path: `${API_PREFIX}/pending`,
      handler: (req, res) => {
        if (!fence(req, res)) return
        if ((req.method ?? 'GET') !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { pending: registry.pendingViews() })
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/pending/approve`,
      handler: bodyRoute((body, _req, res) => {
        const payload = body as Partial<ApprovePendingPayload>
        if (typeof payload.id !== 'string' || payload.id.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 id' } satisfies SimpleActionResponse)
          return
        }
        const scope = payload.scope === 'read' || payload.scope === 'write' ? payload.scope : undefined
        const error = registry.approve(payload.id, scope)
        if (error !== undefined) {
          json(res, 404, { ok: false, error } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { ok: true } satisfies SimpleActionResponse)
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/pending/deny`,
      handler: bodyRoute((body, _req, res) => {
        const payload = body as Partial<DenyPendingPayload>
        if (typeof payload.id !== 'string' || payload.id.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 id' } satisfies SimpleActionResponse)
          return
        }
        const error = registry.deny(payload.id)
        if (error !== undefined) {
          json(res, 404, { ok: false, error } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { ok: true } satisfies SimpleActionResponse)
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/grants`,
      handler: (req, res) => {
        if (!fence(req, res)) return
        if ((req.method ?? 'GET') !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, {
          grants: registry.activeGrants().map(g => ({
            id: g.id,
            path: g.path,
            scope: g.scope,
            reason: g.reason,
            sessionId: g.sessionId,
            requestedAt: g.requestedAt,
          })),
        })
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/grants/revoke`,
      handler: bodyRoute(async (body, _req, res) => {
        const payload = body as Partial<RevokeGrantPayload>
        if (typeof payload.id !== 'string' || payload.id.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 id' } satisfies SimpleActionResponse)
          return
        }
        const revoked = await registry.revoke(payload.id)
        json(res, 200, { ok: true, revoked: revoked.length })
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/audit`,
      handler: (req, res) => {
        if (!fence(req, res)) return
        if ((req.method ?? 'GET') !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { entries: registry.auditEntries(100) })
      },
    },
  ]
}
