/**
 * The Host's HTTP surface: the six routes of the frozen contract, served under
 * the root-absolute `/dsh-agents/api` prefix.
 *
 * Every route answers JSON in both directions. A refusal is a stable machine
 * code plus one bounded sentence; no stack trace, no ledger content, no session
 * text ever reaches the browser. The fence admits only this machine's own
 * browser: a cross-site marker is refused outright, the socket must be loopback,
 * and a browser same-origin signal (fetch metadata, an origin matching the Host,
 * or the Host's own browser-auth cookie) must be present.
 *
 * @module @linxin666/dsh-agents/host/routes
 */
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { AgentsError, isAgentsError, statusForCode } from '../core/errors.ts'
import {
  DSH_AGENTS_API_PREFIX,
  gateMemberRequestBody,
  gateTeamRequestBody,
  parseDescribeRequestBody,
  parseMemberDeleteRequestBody,
  parseRunRequestBody,
  parseSquadRunRequestBody,
  parseTeamDeleteRequestBody,
  type AgentsErrorBody,
} from '../protocol.ts'
import type { AgentsHostService } from './service.ts'

/** Byte cap for every request body this API accepts. */
export const AGENTS_BODY_LIMIT = 64 * 1024

const JSON_HEADERS: OutgoingHttpHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
}

/**
 * Harness browser-auth cookie prefix (dsh-client-connection): the signed cookie
 * the Host mints in exchange for its launch token, which only an application on
 * this machine can hold. Same constant, same reason, as the task board's fence.
 */
const BROWSER_AUTH_COOKIE_PREFIX = 'dsh-auth-'

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(body))
}

function refuse(res: ServerResponse, status: number, code: AgentsErrorBody['code'], message: string): void {
  writeJson(res, status, { ok: false, code, error: message } satisfies AgentsErrorBody)
}

/** Whether the request came over a loopback socket. */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function carriesBrowserAuthCookie(header: string | undefined): boolean {
  if (header === undefined) return false
  return header.split(';').some(segment => segment.trim().startsWith(BROWSER_AUTH_COOKIE_PREFIX))
}

/**
 * Whether the request carries a browser same-origin signal. This is a tripwire,
 * not the authority: the loopback socket check carries that.
 */
export function hasBrowserSameOriginMarker(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'same-origin') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }
  return carriesBrowserAuthCookie(req.headers.cookie)
}

/**
 * The route fence: cross-site refused, non-loopback refused, and a
 * marker-less request refused.
 * @param req - the incoming request.
 * @returns whether the request may reach the squad API.
 */
export function isTrustedAgentsRequest(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!hasBrowserSameOriginMarker(req)) return false
  return isLoopbackAddress(req.socket.remoteAddress)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > AGENTS_BODY_LIMIT) throw new AgentsError('body-too-large', 'the request body exceeds ' + AGENTS_BODY_LIMIT + ' bytes')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new AgentsError('invalid-request', 'the request body is not valid JSON')
  }
}

/**
 * Serve one refusal for anything a handler threw.
 * @param res - the response to write.
 * @param error - the caught value.
 */
export function replyFailure(res: ServerResponse, error: unknown): void {
  if (isAgentsError(error)) return refuse(res, statusForCode(error.code), error.code, error.message)
  refuse(res, 500, 'internal-error', 'the dsh-agents host failed to serve this request')
}

/**
 * Build the route table. The paths are exactly {@link DSH_AGENTS_ROUTE_PATHS};
 * registering another route means amending the frozen contract first.
 * @param service - the squad service the routes act on.
 * @returns one exact route per contract path, in contract order.
 */
export function makeAgentsRoutes(service: AgentsHostService): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedAgentsRequest(req)) return true
    refuse(res, 403, 'forbidden', 'this route is served to this machine\'s own browser only')
    return false
  }
  const post = async (req: IncomingMessage, res: ServerResponse): Promise<unknown> => {
    if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      refuse(res, 415, 'json-required', 'this route accepts application/json only')
      return undefined
    }
    return await readJson(req)
  }

  return [
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/state',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'GET') return refuse(res, 405, 'method-not-allowed', 'this route serves GET only')
        if (!guard(req, res)) return
        try {
          writeJson(res, 200, await service.stateView())
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/team',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const gated = gateTeamRequestBody(await post(req, res))
          if ('reason' in gated) return refuse(res, 400, 'invalid-request', gated.reason)
          writeJson(res, 200, { team: service.saveTeam(gated.value.team) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/team/delete',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const body = parseTeamDeleteRequestBody(await post(req, res))
          if (body === undefined) return refuse(res, 400, 'invalid-request', 'the request does not name one team')
          service.deleteTeam(body.teamId)
          writeJson(res, 200, { ok: true })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/member',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const gated = gateMemberRequestBody(await post(req, res))
          if ('reason' in gated) return refuse(res, 400, 'invalid-request', gated.reason)
          writeJson(res, 200, { team: service.saveMember(gated.value.teamId, gated.value.member) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/member/delete',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const body = parseMemberDeleteRequestBody(await post(req, res))
          if (body === undefined) return refuse(res, 400, 'invalid-request', 'the request does not name one member of one team')
          writeJson(res, 200, { team: service.deleteMember(body.teamId, body.memberId) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/run',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const body = parseRunRequestBody(await post(req, res))
          if (body === undefined) return refuse(res, 400, 'invalid-request', 'the run request does not name one member of one team')
          writeJson(res, 200, { run: await service.run(body) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/squad/run',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const body = parseSquadRunRequestBody(await post(req, res))
          if (body === undefined) return refuse(res, 400, 'invalid-request', 'the squad run request does not name one team')
          writeJson(res, 200, { run: await service.runSquad(body) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
    {
      kind: 'exact',
      path: DSH_AGENTS_API_PREFIX + '/describe',
      handler: async (req, res): Promise<void> => {
        if (req.method !== 'POST') return refuse(res, 405, 'method-not-allowed', 'this route serves POST only')
        if (!guard(req, res)) return
        try {
          const body = parseDescribeRequestBody(await post(req, res))
          if (body === undefined) return refuse(res, 400, 'invalid-request', 'the describe request names no squad')
          // The model call is bounded by the Host's own timeout rather than by
          // this request: the browser always reads the body before it waits.
          writeJson(res, 200, { description: await service.describe(body) })
        } catch (error) {
          replyFailure(res, error)
        }
      },
    },
  ]
}
