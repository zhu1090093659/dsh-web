import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { TaskBoardHostService } from './host-service.ts'
import { writeJson } from './http.ts'
import { isLoopbackAddress, isLoopbackRequest } from './loopback.ts'
import { TaskParseError, TASK_PARSE_MAX_INPUT } from './host-ai.ts'
import {
  parseActionEnvelope,
  parseTaskParseRequest,
  TASK_BOARD_API_PREFIX,
  type TaskBoardParseDraft,
  type TaskBoardParseRequest,
} from './protocol.ts'

const ACTION_LIMIT = 64 * 1024
const IMPORT_LIMIT = 2 * 1024 * 1024
const HEARTBEAT_MS = 15_000

/** Header replaced by an authenticated same-host reverse proxy. */
export const TASK_BOARD_PROXY_TOKEN_HEADER = 'x-dsh-task-board-proxy-token'

/** Optional authenticated reverse-proxy access layered over the loopback default. */
export interface TaskBoardRouteAccess {
  trustedProxyHosts?: readonly string[]
  proxyToken?: string
}

/**
 * Host faces the routes need beyond the ledger service. The parse face is
 * resolved lazily by the caller, so a deployment without an llm service still
 * registers the route and answers with a typed "no model" failure instead of
 * leaving the panel with an unmounted path (issue #1540).
 */
export interface TaskBoardRouteOptions {
  parseTask?: (request: TaskBoardParseRequest, signal: AbortSignal) => Promise<TaskBoardParseDraft>
}

interface ResolvedRouteAccess {
  trustedProxyHosts: ReadonlySet<string>
  proxyToken?: string
}

function parseAuthority(authority: string): { canonical: string; url: URL } | undefined {
  if (authority.trim() !== authority) return undefined
  const match = authority.startsWith('[')
    ? /^\[[^\]]+\](?::([0-9]+))?$/.exec(authority)
    : /^[^:@/?#\s]+(?::([0-9]+))?$/.exec(authority)
  if (match === null) return undefined
  try {
    const url = new URL(`http://${authority}`)
    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined
    const rawPort = match[1]
    if (rawPort !== undefined && (String(Number(rawPort)) !== rawPort || Number(rawPort) > 65_535)) return undefined
    return { canonical: url.hostname.toLowerCase() + (rawPort === undefined ? '' : `:${rawPort}`), url }
  } catch {
    return undefined
  }
}

function resolveAccess(access: TaskBoardRouteAccess): ResolvedRouteAccess {
  const trustedProxyHosts = new Set<string>()
  for (const authority of access.trustedProxyHosts ?? []) {
    const parsed = parseAuthority(authority)
    if (parsed === undefined || parsed.canonical !== authority.toLowerCase()) {
      throw new Error(`task-board: trustedProxyHosts entry ${JSON.stringify(authority)} is not a canonical host[:port] authority`)
    }
    trustedProxyHosts.add(parsed.canonical)
  }
  if (trustedProxyHosts.size > 0 && (access.proxyToken === undefined || access.proxyToken === '')) {
    throw new Error('task-board: authenticated proxy hosts require a non-empty proxy token')
  }
  return { trustedProxyHosts, ...(access.proxyToken === undefined ? {} : { proxyToken: access.proxyToken }) }
}

/**
 * Browser-signal tripwire, NOT an authority check: a bare curl sends neither
 * header and is refused, but a curl with a forged Origin passes this too.
 * The real boundary is the loopback socket + Host + origin-equality checks
 * in isTrustedTaskBoardRequest below; do not rely on this marker alone.
 */
function browserSameOriginMarker(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  return site === 'same-origin' || typeof req.headers.origin === 'string'
}

function sameAuthority(req: IncomingMessage, host: URL): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return req.headers['sec-fetch-site'] === 'same-origin'
  try {
    return new URL(origin).host === host.host
  } catch {
    return false
  }
}

function matchesToken(candidate: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof candidate !== 'string' || expected === undefined || candidate === '' || expected === '') return false
  const actual = Buffer.from(candidate)
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

/**
 * Task-board route fence. Direct desktop access uses the repository-wide
 * loopback socket + Host guard and additionally requires a browser same-origin
 * marker: a bare local curl without any browser signal cannot exercise the
 * agent control plane (a forged Origin does pass the marker — it is a
 * tripwire, the socket/Host/origin-equality checks carry the authority).
 * Authenticated proxies must be explicitly allowlisted and replace the
 * internal token header after their own authentication step.
 */
export function isTrustedTaskBoardRequest(req: IncomingMessage, access: ResolvedRouteAccess): boolean {
  if (!browserSameOriginMarker(req)) return false
  if (isLoopbackRequest(req)) return true
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  const parsed = parseAuthority(host)
  if (parsed === undefined || parsed.canonical !== host.toLowerCase()) return false
  if (!access.trustedProxyHosts.has(parsed.canonical) || !sameAuthority(req, parsed.url)) return false
  return matchesToken(req.headers[TASK_BOARD_PROXY_TOKEN_HEADER], access.proxyToken)
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; value: unknown }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > IMPORT_LIMIT) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return { raw, value: JSON.parse(raw) }
}

export function makeTaskBoardRoutes(
  service: TaskBoardHostService,
  access: TaskBoardRouteAccess = {},
  options: TaskBoardRouteOptions = {},
): WebRoute[] {
  const resolvedAccess = resolveAccess(access)
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (isTrustedTaskBoardRequest(req, resolvedAccess)) return true
    writeJson(res, 403, { ok: false, error: 'forbidden' }, { 'cache-control': 'no-store' })
    return false
  }
  const state: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/state`,
    handler: (req, res): void => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      writeJson(res, 200, service.snapshot(), { 'cache-control': 'no-store' })
    },
  }
  const action: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/action`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return writeJson(res, 415, { ok: false, error: 'json-required' }, { 'cache-control': 'no-store' })
      }
      try {
        const body = await readBody(req)
        const parsed = parseActionEnvelope(body.value)
        if (parsed === undefined) return writeJson(res, 400, { ok: false, error: 'invalid-action' }, { 'cache-control': 'no-store' })
        if (parsed.action.kind !== 'import' && Buffer.byteLength(body.raw) > ACTION_LIMIT) {
          return writeJson(res, 413, { ok: false, error: 'body-too-large' }, { 'cache-control': 'no-store' })
        }
        writeJson(res, 200, service.apply(parsed.requestId, parsed.action, parsed.initiator), { 'cache-control': 'no-store' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message }, { 'cache-control': 'no-store' })
      }
    },
  }
  const events: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/events`,
    handler: (req, res): void => {
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      if (!guard(req, res)) return
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const push = (): void => {
        const payload = service.eventPayload()
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }
      const unsubscribe = service.subscribe(push)
      const heartbeat = setInterval(() => { res.write(': ping\n\n') }, HEARTBEAT_MS)
      const close = (): void => {
        clearInterval(heartbeat)
        unsubscribe()
      }
      req.once('close', close)
      res.once('close', close)
      push()
    },
  }
  const parse: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/parse`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return writeJson(res, 415, { ok: false, error: 'json-required' }, { 'cache-control': 'no-store' })
      }
      let body: { raw: string; value: unknown }
      try {
        body = await readBody(req)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return writeJson(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message }, { 'cache-control': 'no-store' })
      }
      const request = parseTaskParseRequest(body.value)
      if (request === undefined) return writeJson(res, 400, { ok: false, error: 'invalid-parse-request' }, { 'cache-control': 'no-store' })
      if (Buffer.byteLength(request.text, 'utf8') > TASK_PARSE_MAX_INPUT) {
        return writeJson(res, 413, { ok: false, error: 'text-too-large' }, { 'cache-control': 'no-store' })
      }
      const parseTask = options.parseTask
      if (parseTask === undefined) {
        return writeJson(res, 503, { ok: false, code: 'no-model', error: 'task-board parsing is unavailable' }, { 'cache-control': 'no-store' })
      }
      // The model call outlives a closed tab: stop it when the response goes
      // away instead of holding the provider request open for the full timeout.
      const controller = new AbortController()
      const onClose = (): void => { controller.abort() }
      res.once('close', onClose)
      try {
        const draft = await parseTask(request, controller.signal)
        writeJson(res, 200, { ok: true, draft }, { 'cache-control': 'no-store' })
      } catch (error) {
        const failure = error instanceof TaskParseError
          ? error
          : new TaskParseError('model-error', error instanceof Error ? error.message : String(error))
        const status = failure.code === 'no-model' ? 503 : failure.code === 'timeout' ? 504 : 502
        writeJson(res, status, { ok: false, code: failure.code, error: failure.message }, { 'cache-control': 'no-store' })
      } finally {
        res.off('close', onClose)
      }
    },
  }
  return [state, action, events, parse]
}
