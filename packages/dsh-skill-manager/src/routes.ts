/**
 * The /api/dsh-skill-manager route family: list / toggle / install /
 * uninstall. Every route carries a loopback-only trust fence (plus browser
 * same-origin markers) — these endpoints read and write skill files on the
 * host machine, so LAN-exposed dsh web deployments must not serve them.
 * @module @linxin666/dsh-skill-manager/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { API, type ApiErrorBody, type InstallRequest, type ListRequest, type ToggleRequest, type UninstallRequest } from './core/protocol.ts'
import type { SkillManagerService } from './core/service.ts'

/** Cap on JSON request bodies (all payloads are small). */
const MAX_JSON_BODY_BYTES = 64 * 1024

/** Route family dependencies. */
export interface SkillManagerRoutesDeps {
  /** The manager service backing every route. */
  service: SkillManagerService
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
    case 'session-not-found':
    case 'no-cwd':
      return 404
    case 'internal':
      return 500
    default:
      return 422
  }
}

/** Read the sessionId field of a body. */
function sessionIdOf(body: Record<string, unknown>): string | undefined {
  return typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
}

/**
 * Build every /api/dsh-skill-manager route (exact paths).
 * @param deps - the manager service.
 * @returns the route list.
 */
export function makeRoutes(deps: SkillManagerRoutesDeps): WebRoute[] {
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
        const sessionId = sessionIdOf(body)
        if (sessionId === undefined) {
          writeJson(res, 400, { error: 'sessionId is required' } satisfies ApiErrorBody)
          return
        }
        const request: ListRequest = { sessionId }
        const result = await service.list(request.sessionId)
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, { skills: result.value.skills, cwd: result.value.cwd, live: result.value.live })
      },
    },
    {
      kind: 'exact',
      path: API.toggle,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' } satisfies ApiErrorBody)
          return
        }
        const sessionId = sessionIdOf(body)
        const name = typeof body.name === 'string' && body.name !== '' ? body.name : undefined
        const enabled = typeof body.enabled === 'boolean' ? body.enabled : undefined
        if (sessionId === undefined || name === undefined || enabled === undefined) {
          writeJson(res, 400, { error: 'sessionId, name and enabled are required' } satisfies ApiErrorBody)
          return
        }
        const request: ToggleRequest = { sessionId, name, enabled }
        const result = await service.toggle(request.sessionId, request.name, request.enabled)
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, result.value)
      },
    },
    {
      kind: 'exact',
      path: API.install,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' } satisfies ApiErrorBody)
          return
        }
        const sessionId = sessionIdOf(body)
        const source = typeof body.source === 'object' && body.source !== null
          ? body.source as { kind?: unknown; value?: unknown }
          : undefined
        const kind = source?.kind
        const value = source?.value
        const destination = body.destination
        if (sessionId === undefined
          || (kind !== 'dir' && kind !== 'git')
          || typeof value !== 'string'
          || (destination !== 'workspace' && destination !== 'user')) {
          writeJson(res, 400, { error: 'sessionId, source.kind, source.value and destination are required' } satisfies ApiErrorBody)
          return
        }
        const request: InstallRequest = { sessionId, source: { kind, value }, destination }
        const result = await service.install(request.sessionId, request.source, request.destination)
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, result.value)
      },
    },
    {
      kind: 'exact',
      path: API.uninstall,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 400, { error: 'invalid JSON body' } satisfies ApiErrorBody)
          return
        }
        const sessionId = sessionIdOf(body)
        const name = typeof body.name === 'string' && body.name !== '' ? body.name : undefined
        if (sessionId === undefined || name === undefined) {
          writeJson(res, 400, { error: 'sessionId and name are required' } satisfies ApiErrorBody)
          return
        }
        const request: UninstallRequest = { sessionId, name }
        const result = await service.uninstall(request.sessionId, request.name)
        if (!result.ok) {
          fail(res, result.error)
          return
        }
        writeJson(res, 200, result.value)
      },
    },
  ]
}
