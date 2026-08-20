/**
 * /git/* route layer: JSON envelope (ok/error with stable codes) for the
 * query/mutation operations and an SSE stream for external branch changes.
 * The service itself owns workspace gating and the git guards; this layer
 * owns HTTP shape and the SSE subscriber bookkeeping. Routes are loopback-only
 * by default; a live paired-device cookie is an extra allow path when
 * remote-web-ui is loaded.
 * @module dsh-git-graph/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  isBranchesView, isGitError, isGraphView, isRepoStatus,
  type GitError,
} from '../core/types.ts'
import { PollGuard } from './poll-guard.ts'
import { isGitAllowed } from './access.ts'
import type { GitService } from './git-service.ts'

/** Envelope every /git JSON response carries. */
export type GitEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: GitError }

const OK = (value: unknown): GitEnvelope<unknown> => ({ ok: true, value })
const FAIL = (error: GitError): GitEnvelope<never> => ({ ok: false, error })

/** Git operation error for structurally invalid requests (never a workspace fault). */
const BAD_REQUEST: GitError = { code: 'internal', message: 'malformed request' }

/** One SSE subscriber: a workspace path and its last pushed state key. */
interface Subscriber {
  path: string
  last: string
  res: ServerResponse
  statusAbort?: AbortController
}

/**
 * Poll interval for external git-state changes while subscribers are
 * connected. Kept deliberately long (30s): each tick spawns several git
 * processes per subscriber, and on Windows a cold git.exe costs ~0.7s per
 * spawn — a short interval turns the poll itself into a self-exciting
 * storm. Window focus and the client's own refresh calls cover the
 * interactive freshness path.
 */
const POLL_INTERVAL_MS = 30_000
/** SSE keep-alive comment interval (proxies drop idle connections). */
const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * Route-layer deadline for one git status request. On expiry the controller
 * aborts the read path so the subprocess can terminate; the JSON handler keeps
 * the stable envelope and the SSE poll loop can clear its overlap guard.
 */
const STATUS_TIMEOUT_MS = 15_000
const STATUS_TIMEOUT_MESSAGE = 'git status timed out'

/**
 * PollGuard lifetime bound. The SSE loop must live exactly as long as the
 * subscriber set (start on first join, stop on empty), so there is no natural
 * server-side expiry: the deadline is set to a sentinel that never fires and
 * the loop is terminated by {@link PollGuard.stop} when the last subscriber
 * closes. The per-subscriber 15s {@link STATUS_TIMEOUT_MS} deadline is a run
 * bound, unrelated to this loop-lifetime value.
 */
const POLL_LIFETIME_MS = Number.MAX_SAFE_INTEGER

/** Git operation error for a structurally invalid service view (never a workspace fault). */
const MALFORMED_VIEW: GitError = { code: 'internal', message: 'malformed git response' }

/** Request body size cap; larger bodies are destroyed rather than drained. */
const BODY_CAP_BYTES = 1 << 20

/** Write the shared non-loopback rejection (same body as dsh-ssh). */
function forbidden(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: 'forbidden: loopback-only' }))
}

/** Read a JSON request body into an unknown value; null when unparseable. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const part = chunk as Buffer
    total += part.length
    if (total > BODY_CAP_BYTES) {
      // Stop reading (no drain) and tear the connection down; the oversized
      // body is never parsed.
      req.destroy()
      chunks.length = 0
      return null
    }
    chunks.push(part)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Extract the required string field from a JSON object payload. */
function pathOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const path = (payload as Record<string, unknown>).path
  return typeof path === 'string' && path !== '' ? path : null
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: GitEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Send a service view under the ok envelope, rejecting structurally invalid
 * values (a malformed RepoStatus / BranchesView / GraphView would otherwise
 * leak to the browser as a typed-but-wrong payload).
 * @param res - the server response.
 * @param value - the view the service produced.
 * @param guard - the runtime narrowing for the view.
 */
function okView(res: ServerResponse, value: unknown, guard: (view: unknown) => boolean): void {
  if (value !== null && !guard(value)) {
    json(res, FAIL(MALFORMED_VIEW))
    return
  }
  json(res, OK(value))
}

/**
 * Register the /git routes (prefix for the JSON operations, exact for the
 * SSE stream — longest-prefix-wins keeps them disjoint).
 * @param ctx - context carrying the webServer service.
 * @param service - the workspace-gated git service.
 * @returns the route disposers.
 */
export function registerGitRoutes(ctx: Context, service: GitService): () => void {
  const subscribers = new Set<Subscriber>()
  // The poll loop's lifetime is bound to the subscriber set: created/started
  // when the first subscriber joins, stopped when the last one closes.
  let guard: PollGuard | undefined
  let heartbeatTimer: NodeJS.Timeout | undefined

  const removeSubscriber = (subscriber: Subscriber): void => {
    subscriber.statusAbort?.abort(new Error('git status subscriber closed'))
    subscriber.statusAbort = undefined
    subscribers.delete(subscriber)
    if (subscribers.size === 0) {
      guard?.stop()
      guard = undefined
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      heartbeatTimer = undefined
    }
  }

  const push = (subscriber: Subscriber, payload: unknown): void => {
    subscriber.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  // One PollGuard owns the whole poll lifecycle: at most one status round
  // runs at a time (a tick arriving mid-run is dropped), consecutive failures
  // back off up to the base interval (cadence stays exactly 30s), and the
  // loop stops when the last subscriber closes. The per-subscriber 15s
  // STATUS_TIMEOUT_MS controller aborts hung status work so a round settles.
  const statusWithDeadline = async (path: string, controller: AbortController = new AbortController()): Promise<Awaited<ReturnType<GitService['status']>>> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new Error(STATUS_TIMEOUT_MESSAGE)
        controller.abort(error)
        reject(error)
      }, STATUS_TIMEOUT_MS)
    })
    try {
      return await Promise.race([service.status(path, controller.signal), deadline])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  const runPoll = async (): Promise<void> => {
    await Promise.all([...subscribers].map(async (subscriber) => {
      const controller = new AbortController()
      subscriber.statusAbort = controller
      try {
        const status = await statusWithDeadline(subscriber.path, controller)
        const key = status === null ? 'no-repo' : `${status.root}|${status.branch}|${status.head}`
        if (key === subscriber.last) return
        subscriber.last = key
        push(subscriber, { path: subscriber.path, status })
      } catch (error: unknown) {
        if (subscribers.has(subscriber)) {
          ctx.logger.warn(`dsh-git-graph: status poll failed for ${subscriber.path}: ${String(error)}`)
        }
      } finally {
        if (subscriber.statusAbort === controller) subscriber.statusAbort = undefined
      }
    }))
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Trust fence first: never let an unpaired LAN client reach any /git
    // operation, regardless of method or content-type.
    if (!isGitAllowed(ctx, req)) {
      forbidden(res)
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // CSRF hardening: the /git mutations (switch/create-branch) act on the
    // real repository with no origin/referer check, so require a JSON
    // content-type — cross-site forms cannot set application/json without a
    // CORS preflight, which the same-origin client always sends.
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      res.writeHead(415)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const payload = await readJsonBody(req)
    const path = pathOf(payload)
    if (path === null) {
      json(res, FAIL(BAD_REQUEST))
      return
    }
    switch (pathname) {
      case '/git/status':
        try {
          okView(res, await statusWithDeadline(path), isRepoStatus)
        } catch (error: unknown) {
          ctx.logger.warn(`dsh-git-graph: status request failed for ${path}: ${String(error)}`)
          json(res, FAIL({ code: 'internal', message: STATUS_TIMEOUT_MESSAGE }))
        }
        return
      case '/git/branches':
        okView(res, await service.branches(path), isBranchesView)
        return
      case '/git/graph': {
        const rawLimit = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).limit
          : undefined
        // Clamp rather than reset: a limit above 1000 must not silently fall
        // back to the 200 default (the client's load-more grows past 1000).
        const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 1000) : undefined
        okView(res, await service.graph(path, limit), isGraphView)
        return
      }
      case '/git/switch': {
        const branch = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).branch
          : undefined
        if (typeof branch !== 'string' || branch === '') {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await service.switchBranch(path, branch)
        json(res, result.ok ? OK({ branch: result.branch }) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW))
        return
      }
      case '/git/create-branch': {
        const name = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).name
          : undefined
        if (typeof name !== 'string' || name === '') {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await service.createBranch(path, name)
        json(res, result.ok ? OK({ branch: result.branch }) : FAIL(isGitError(result.error) ? result.error : MALFORMED_VIEW))
        return
      }
      default:
        res.writeHead(404)
        res.end()
    }
  }

  const sse = (req: IncomingMessage, res: ServerResponse): void => {
    // Reject unpaired non-loopback clients before the stream opens.
    if (!isGitAllowed(ctx, req)) {
      forbidden(res)
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.searchParams.get('path')
    if (path === null || path === '') {
      res.writeHead(400)
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    const subscriber: Subscriber = { path, last: '', res }
    subscribers.add(subscriber)
    // A push/heartbeat write racing socket teardown emits 'error' on the
    // response stream; unhandled, that can crash the host. Dropping the
    // subscriber degrades the race to a lost write; req 'close' finishes
    // the remaining cleanup.
    res.on('error', () => { removeSubscriber(subscriber) })
    if (guard === undefined) {
      guard = new PollGuard({
        intervalMs: POLL_INTERVAL_MS,
        deadlineMs: POLL_LIFETIME_MS,
        maxBackoffMs: POLL_INTERVAL_MS,
        onRun: runPoll,
      })
    }
    guard.start()
    if (heartbeatTimer === undefined) {
      heartbeatTimer = setInterval(() => {
        for (const current of subscribers) current.res.write(': ping\n\n')
      }, HEARTBEAT_INTERVAL_MS)
    }
    req.on('close', () => { removeSubscriber(subscriber) })
  }

  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/git', handler }),
    ctx.webServer.register({ kind: 'exact', path: '/git/events', handler: sse }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
    guard?.stop()
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    for (const subscriber of subscribers) {
      subscriber.statusAbort?.abort(new Error('git status routes disposed'))
      subscriber.res.end()
    }
    subscribers.clear()
  }
}
