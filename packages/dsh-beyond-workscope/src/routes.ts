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
  type RemoveWorkspacePayload,
  type RevokeGrantPayload,
  type SessionInfoView,
  type SimpleActionResponse,
} from './protocol.ts'
import { removeWorkspaces, toWorkspaceViews, type WorkspaceLedger } from './workspaces.ts'

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

/** Audit-kind subset the workspace surface writes. */
export type WorkspaceAuditKind = 'workspace_registered' | 'workspace_removed'

/** Optional session-info provider (host-side session metadata lookup). */
export type SessionInfoProvider = (sessionId: string) => Promise<SessionInfoView | undefined>

/** Optional workspace surface injected by the assembler. */
export interface RouteHooks {
  readonly ledger?: WorkspaceLedger
  readonly audit?: (sessionId: string, kind: WorkspaceAuditKind, detail: string) => void
  readonly sessionInfo?: SessionInfoProvider
}

/**
 * Build the route family.
 * @param registry - the grant registry the routes drive.
 * @param hooks - optional surfaces: the sub-workspace ledger powers the
 *   /workspaces routes and the workspace-confirm effect; the audit writer
 *   appends workspace lifecycle entries; the session-info provider feeds the
 *   会话信息 view tab. Without the hooks the matching routes fail closed
 *   while grants keep working.
 */
export function makeRoutes(registry: GrantRegistry, hooks: RouteHooks = {}): WebRoute[] {
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
      handler: bodyRoute(async (body, _req, res) => {
        const payload = body as Partial<ApprovePendingPayload>
        if (typeof payload.id !== 'string' || payload.id.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 id' } satisfies SimpleActionResponse)
          return
        }
        const info = registry.pendingInfo(payload.id)
        if (info === undefined) {
          json(res, 404, { ok: false, error: '该授权请求不存在或已处理' } satisfies SimpleActionResponse)
          return
        }
        // Workspace confirmations record the sub-workspace in the ledger
        // BEFORE settling the pending entry: the record exists only when the
        // user actually approved it.
        if (info.kind === 'workspace') {
          if (hooks.ledger === undefined) {
            json(res, 503, { ok: false, error: '子工作区服务不可用' } satisfies SimpleActionResponse)
            return
          }
          try {
            hooks.ledger.register(info.sessionId, info.path, info.title)
          } catch (error) {
            json(res, 409, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } satisfies SimpleActionResponse)
            return
          }
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
      path: `${API_PREFIX}/workspaces`,
      handler: (req, res) => {
        if (!fence(req, res)) return
        if ((req.method ?? 'GET') !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
          return
        }
        if (hooks.ledger === undefined) {
          json(res, 503, { ok: false, error: '子工作区服务不可用' } satisfies SimpleActionResponse)
          return
        }
        json(res, 200, { workspaces: toWorkspaceViews(hooks.ledger.list()) })
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/workspaces/remove`,
      handler: bodyRoute(async (body, _req, res) => {
        const payload = body as Partial<RemoveWorkspacePayload>
        if (typeof payload.id !== 'string' || payload.id.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 id' } satisfies SimpleActionResponse)
          return
        }
        if (hooks.ledger === undefined) {
          json(res, 503, { ok: false, error: '子工作区服务不可用' } satisfies SimpleActionResponse)
          return
        }
        const removed = removeWorkspaces(hooks.ledger, payload.id)
        for (const record of removed) {
          hooks.audit?.(record.sessionId, 'workspace_removed', `${record.title}（${record.path}）`)
        }
        json(res, 200, { ok: true, removed: removed.length })
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/session-info`,
      handler: async (req, res) => {
        if (!fence(req, res)) return
        if ((req.method ?? 'GET') !== 'GET') {
          json(res, 405, { ok: false, error: 'method not allowed' } satisfies SimpleActionResponse)
          return
        }
        if (hooks.sessionInfo === undefined) {
          json(res, 200, {})
          return
        }
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const sessionId = url.searchParams.get('session')
        if (sessionId === null || sessionId.trim() === '') {
          json(res, 400, { ok: false, error: '缺少 session 参数' } satisfies SimpleActionResponse)
          return
        }
        const session = await hooks.sessionInfo(sessionId)
        json(res, 200, session === undefined ? {} : { session })
      },
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
