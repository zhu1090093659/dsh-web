/**
 * The /api/dsh-beyond-workscope route family: pending-grant confirmation,
 * active-grant management, and audit history for the browser half.
 *
 * Every route carries the same loopback-only trust fence as the sibling
 * plugins (dsh-ssh / remote-web-ui): these endpoints hand out and revoke
 * filesystem permissions, so LAN-exposed dsh web deployments must not serve
 * them.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { GrantRegistry } from './grants.ts'
import { API_PREFIX, type ApprovePendingPayload, type SimpleActionResponse } from './protocol.ts'

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
    if (total > MAX_JSON_BODY_BYTES) {
      const error = new Error('body too large')
      ;(error as Error & { tooLarge?: boolean }).tooLarge = true
      throw error
    }
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

/**
 * Build the route family.
 * @param registry - the grant registry the routes drive.
 * @returns named web routes (register with ctx.webServer.register).
 */
export function makeRoutes(registry: GrantRegistry): WebRoute[] {
  const routeFor = (pattern: string): WebRoute[] => {
    const parts = pattern.split('/').filter(Boolean)
    const apiIndex = parts.findIndex(part => part === API_PREFIX.slice(1))
    const suffix = parts.slice(apiIndex + 1)
    return [{
      kind: 'exact',
      path: pattern,
      handler: (req, res) => {
        if (!fence(req, res)) return
        const segments = req.url?.split('?')[0]?.split('/').filter(Boolean) ?? []
        // :id sits at a fixed offset inside the suffix (…/:id/… is always the
        // last two segments of the concrete paths we register).
        const id = suffix.includes(':id') ? segments[segments.length - 2] ?? '' : ''
        handle(segments, id, req, res).catch(error => {
          // A handler must never reject: unknown ids and bad inputs surface as
          // JSON errors, not as unhandled promise rejections.
          json(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies SimpleActionResponse)
        })
      },
    }]
  }

  const handle = async (
    segments: string[],
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    // segments: ['api','dsh-beyond-workscope', ...suffix]
    const suffix = segments.slice(API_PREFIX.split('/').filter(Boolean).length)
    const method = req.method ?? 'GET'

    // GET  /pending
    if (method === 'GET' && suffix.length === 1 && suffix[0] === 'pending') {
      json(res, 200, { pending: registry.pendingViews() })
      return
    }
    // POST /pending/:id/approve  |  /pending/:id/deny
    if (method === 'POST' && suffix.length === 3 && suffix[0] === 'pending' && suffix[1] === id) {
      const action = suffix[2]
      if (action === 'approve' || action === 'deny') {
        let payload: ApprovePendingPayload = {}
        try {
          const body = await readJsonBody(req)
          if (body !== null && typeof body === 'object') {
            const maybe = body as ApprovePendingPayload
            if (maybe.scope === 'read' || maybe.scope === 'write') payload = { scope: maybe.scope }
          }
        } catch {
          json(res, 400, { ok: false, error: '请求体不是合法 JSON 或过大' } satisfies SimpleActionResponse)
          return
        }
        const error = action === 'approve' ? registry.approve(id, payload.scope) : registry.deny(id)
        if (error !== undefined) {
          json(res, 404, { ok: false, error } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { ok: true } satisfies SimpleActionResponse)
        return
      }
    }
    // GET  /grants
    if (method === 'GET' && suffix.length === 1 && suffix[0] === 'grants') {
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
      return
    }
    // POST /grants/:id/revoke
    if (method === 'POST' && suffix.length === 3 && suffix[0] === 'grants' && suffix[1] === id && suffix[2] === 'revoke') {
      const revoked = await registry.revoke(id)
      json(res, 200, { ok: true, revoked: revoked.length } satisfies SimpleActionResponse & { revoked?: number })
      return
    }
    // GET  /audit
    if (method === 'GET' && suffix.length === 1 && suffix[0] === 'audit') {
      json(res, 200, { entries: registry.auditEntries(100) })
      return
    }
    json(res, 404, { ok: false, error: 'not found' } satisfies SimpleActionResponse)
  }

  // Register the five concrete paths (segments resolve the :id at dispatch).
  const paths = [
    `${API_PREFIX}/pending`,
    `${API_PREFIX}/pending/:id/approve`,
    `${API_PREFIX}/pending/:id/deny`,
    `${API_PREFIX}/grants`,
    `${API_PREFIX}/grants/:id/revoke`,
    `${API_PREFIX}/audit`,
  ]
  return paths.flatMap(routeFor)
}
