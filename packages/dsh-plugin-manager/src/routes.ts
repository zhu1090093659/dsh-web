/**
 * The /api/dsh-plugin-manager route family: list / set-enabled. Every route
 * carries a loopback-only trust fence (plus browser same-origin markers) —
 * these endpoints read and rewrite the user's dsh patch layer, so
 * LAN-exposed dsh web deployments must not serve them.
 * @module @linxin666/dsh-plugin-manager/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API, type ApiErrorBody, type SetEnabledRequest } from './protocol.ts'
import type { PluginManagerService } from './core/service.ts'

/** Cap on JSON request bodies (all payloads are small). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Route family dependencies. */
export interface PluginManagerRoutesDeps {
  /** The manager service backing every route. */
  service: PluginManagerService
}

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh). */
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

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Map one manager error to an HTTP status. */
function statusOf(code: string): number {
  switch (code) {
    case 'unknown-entry':
      return 404
    case 'protected':
      return 403
    case 'internal':
      return 500
    default:
      return 422
  }
}

/**
 * Build every /api/dsh-plugin-manager route (exact paths).
 * @param deps - the manager service.
 * @returns the route list.
 */
export function makeRoutes(deps: PluginManagerRoutesDeps): WebRoute[] {
  const { service } = deps

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const fail = (res: ServerResponse, error: { code: string; message: string }): void => {
    const body: ApiErrorBody = { error: error.message, code: error.code }
    writeJson(res, statusOf(error.code), body)
  }

  return [
    {
      kind: 'exact',
      path: API.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' } satisfies ApiErrorBody)
          return
        }
        const result = service.list()
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, result.value)
      },
    },
    {
      kind: 'exact',
      path: API.setEnabled,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' } satisfies ApiErrorBody)
          return
        }
        const entryId = typeof body.entryId === 'string' && body.entryId !== '' ? body.entryId : undefined
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined
        if (entryId === undefined || enabled === undefined) {
          writeJson(res, 400, { error: 'entryId and enabled are required' } satisfies ApiErrorBody)
          return
        }
        const request: SetEnabledRequest = { entryId, enabled }
        const result = await service.setEnabled(request.entryId, request.enabled)
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, result.value)
      },
    },
  ]
}