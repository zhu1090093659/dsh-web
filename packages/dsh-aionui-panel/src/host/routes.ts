/**
 * /aionui-panel/* route layer: JSON envelope (ok/error with stable codes) for
 * the fs/git operations and one SSE stream (fs changes + git status changes)
 * per project root. The services own gating and parsing; this layer owns HTTP
 * shape and subscriber bookkeeping.
 * @module dsh-aionui-panel/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PanelEnvelope, PanelError } from '../core/types.ts'
import type { FsService } from './fs-service.ts'
import type { GitService } from './git-service.ts'
import { PollGuard } from './poll-guard.ts'

const OK = (value: unknown): PanelEnvelope<unknown> => ({ ok: true, value })
const FAIL = (error: PanelError): PanelEnvelope<never> => ({ ok: false, error })

/** Structural request failure (never a workspace fault). */
const BAD_REQUEST: PanelError = { code: 'internal', message: 'malformed request' }

/** One SSE subscriber: a root and its last pushed git signature. */
interface Subscriber {
  root: string
  lastGit: string
  res: ServerResponse
}

/**
 * Poll interval for git-status changes while subscribers are connected.
 * Kept deliberately long (30s): on Windows a cold git.exe costs ~0.7s per
 * spawn, and the SCM panel already refreshes event-driven (fs watch for
 * file edits) and on window focus — the poll only needs to catch
 * out-of-band .git writes (commits/checkouts from other tools).
 */
const GIT_POLL_MS = 30_000
/** SSE keep-alive comment interval (proxies drop idle connections). */
const HEARTBEAT_MS = 15_000

/**
 * Parse a single-range `bytes=start-end` header against the file size.
 * Returns null when no range was requested, 'invalid' for malformed or
 * unsatisfiable ranges (the caller answers 416), or the clamped start/end
 * (inclusive). Multi-range requests are treated as invalid — the panel only
 * ever serves single ranges. Suffix ranges (`bytes=-N`) select the last N
 * bytes. Range support added after human review on #242 (pdf seeking).
 */
export function parseRangeHeader(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (header === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null || (match[1] === '' && match[2] === '')) return 'invalid'
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (suffix <= 0 || size === 0) return 'invalid'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  if (size === 0 || start > end || start >= size) return 'invalid'
  return { start, end }
}

/**
 * Deadline for one git-status subprocess inside pollGit. Not an execution
 * timeout — the subprocess' own graceMs limits a single binary run; this is
 * the route layer's guard against a hung status (e.g. a wedged git daemon on
 * a cold path) that would otherwise leave the anti-overlap guard (owned by
 * PollGuard) wedged forever and silence SCM. Owned here so the deadline is independent
 * of any service-level setting.
 */
const GIT_STATUS_TIMEOUT_MS = 15_000

/**
 * PollGuard loop bounds. The poll is stopped by the SSE subscriber lifecycle
 * (start on first subscriber, stop when the last disconnects), so the guard's
 * own deadline is never reached in practice (MAX_SAFE_INTEGER ms ~ no
 * deadline), preserving the former setInterval which kept polling as long as
 * any stream was connected. maxBackoffMs equals the interval so a rejected
 * run retries at the same cadence as a healthy one (interval unchanged).
 */
const GIT_POLL_DEADLINE_MS = Number.MAX_SAFE_INTEGER
const GIT_POLL_MAX_BACKOFF_MS = GIT_POLL_MS

/**
 * Loopback trust fence — the same judgment dsh-ssh applies to its host
 * routes: a loopback socket address AND a loopback Host header, plus browser
 * same-origin markers. The /aionui-panel operations read/write real workspace
 * files and run git, so a LAN-exposed dsh web must not serve them to unpaired
 * devices. The socket address is authoritative; X-Forwarded-For is never
 * trusted (matching dsh-ssh).
 */
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
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > 1 << 20) return null
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
function strField(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** Extract a string field, accepting the empty string as a value. */
function strOrEmpty(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** Extract a string array field (defaults to []). */
function strArray(payload: unknown, key: string): string[] | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) return null
  if (!value.every((item) => typeof item === 'string')) return null
  return value as string[]
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: PanelEnvelope<unknown>, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Register the /aionui-panel routes (prefix for JSON, exact for the SSE
 * stream — longest-prefix-wins keeps them disjoint).
 * @param ctx - context carrying the webServer service.
 * @param fs - the gated filesystem service.
 * @param git - the gated git service.
 * @returns the route disposers.
 */
export function registerPanelRoutes(ctx: Context, fs: FsService, git: GitService): () => void {
  const subscribers = new Set<Subscriber>()
  // A single PollGuard instance cannot be restarted after stop(), so a fresh
  // guard is created for each subscriber lifecycle (0 -> 1) and discarded when
  // the last subscriber disconnects — mirroring the former create/clear of the
  // setInterval so polling stays alive while any stream is connected.
  let gitPoll: PollGuard | undefined
  let heartbeatTimer: NodeJS.Timeout | undefined

  const push = (subscriber: Subscriber, payload: unknown): void => {
    subscriber.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  // One-shot availability state: a machine without a git binary must not
  // re-spawn ENOENT every 2s tick. The probe result is cached inside the git
  // service, so this runs once, logs at most once, and then git polling stops
  // for the rest of this route instance while fs watching keeps working.
  let gitProbed = false
  let gitUnavailable = false
  // Anti-overlap is owned by PollGuard (at most one run in flight at a time;
  // a tick that arrives mid-run is dropped), replacing the old `polling` bool.
  const pollGit = async (): Promise<void> => {
    if (!gitProbed) {
      gitProbed = true
      if (!(await git.gitAvailable())) {
        gitUnavailable = true
        ctx.logger.warn('dsh-aionui-panel: git binary unavailable, SCM polling disabled')
        for (const subscriber of subscribers) push(subscriber, { kind: 'gitUnavailable' })
      }
    }
    if (gitUnavailable) return
    await Promise.all([...subscribers].map(async (subscriber) => {
      try {
        // Subscribers were gated when the stream opened, so use the
        // canonical git methods (no double gate per 2s tick). repoOf inside
        // them re-runs `rev-parse --show-toplevel` only after its TTL
        // expires: a non-repo root never spawns a git status, and a repo
        // created or removed while the host is running (git init / deleting
        // .git) is still discovered by a later tick. The poll interval
        // therefore keeps running while any subscriber is connected.
        if (!(await git.isRepositoryCanonical(subscriber.root))) return
        const status = await Promise.race([
          git.statusCanonical(subscriber.root),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('git status timed out')), GIT_STATUS_TIMEOUT_MS)
          }),
        ])
        if (status === null) return
        const key = `${status.branch}|${JSON.stringify(status.staged)}|${JSON.stringify(status.unstaged)}|${JSON.stringify(status.untracked)}`
        if (key === subscriber.lastGit) return
        subscriber.lastGit = key
        push(subscriber, { kind: 'git', status })
      } catch (error: unknown) {
        ctx.logger.warn(`dsh-aionui-panel: git poll failed for ${subscriber.root}: ${String(error)}`)
      }
    }))
  }

  const startGitPoll = (): void => {
    if (gitPoll !== undefined) return
    gitPoll = new PollGuard({
      intervalMs: GIT_POLL_MS,
      deadlineMs: GIT_POLL_DEADLINE_MS,
      maxBackoffMs: GIT_POLL_MAX_BACKOFF_MS,
      onRun: pollGit,
    })
    gitPoll.start()
  }
  const stopGitPoll = (): void => {
    if (gitPoll === undefined) return
    gitPoll.stop()
    gitPoll = undefined
  }

  /**
   * GET /aionui-panel/raw: stream one workspace file (markdown image srcs,
   * pdf preview). Gated like every other operation; FsService.readRaw only
   * resolves and stats the path, the bytes are piped straight from disk with
   * the derived mime — the whole file never sits in host memory. Single byte
   * ranges are honored (206/416) so the browser pdf viewer can seek large
   * files. No validators are negotiated, so the browser revalidates every
   * time — a re-edited file never shows stale bytes.
   */
  const serveRaw = async (req: IncomingMessage, url: URL, res: ServerResponse): Promise<void> => {
    const root = url.searchParams.get('root')
    const path = url.searchParams.get('path')
    if (root === null || root === '' || path === null || path === '') {
      json(res, FAIL(BAD_REQUEST), 400)
      return
    }
    const result = await fs.readRaw(root, path)
    if (!('abs' in result)) {
      const status = result.code === 'path-outside-root' || result.code === 'is-directory' ? 403 : 404
      json(res, FAIL(result), status)
      return
    }
    const range = parseRangeHeader(req.headers.range, result.size)
    if (range === 'invalid') {
      res.writeHead(416, { 'content-range': `bytes */${result.size}` })
      res.end()
      return
    }
    const headers: Record<string, string | number> = {
      'content-type': result.mime,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'accept-ranges': 'bytes',
    }
    if (range === null) {
      headers['content-length'] = result.size
      res.writeHead(200, headers)
    } else {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${result.size}`
      headers['content-length'] = range.end - range.start + 1
      res.writeHead(206, headers)
    }
    try {
      await pipeline(createReadStream(result.abs, range === null ? undefined : { start: range.start, end: range.end }), res)
    } catch {
      // Client aborted mid-stream or the file vanished after stat: the
      // response is already committed, so just tear it down.
      res.destroy()
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Loopback fence first: never let a LAN client reach any /aionui-panel
    // operation, regardless of method or content-type.
    if (!isLoopbackRequest(req)) {
      forbidden(res)
      return
    }
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/aionui-panel/raw') {
        await serveRaw(req, url, res)
        return
      }
      res.writeHead(405)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // Require an explicit JSON content-type: cross-site simple requests (no
    // preflight) cannot set application/json, so this blocks form-based CSRF
    // from driving the fs/git routes.
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      json(res, FAIL(BAD_REQUEST), 415)
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const payload = await readJsonBody(req)
    if (payload === null) {
      json(res, FAIL(BAD_REQUEST))
      return
    }
    const root = strField(payload, 'root')
    if (root === null) {
      json(res, FAIL(BAD_REQUEST))
      return
    }
    switch (pathname) {
      case '/aionui-panel/list': {
        const path = strField(payload, 'path') ?? ''
        const result = await fs.list(root, path)
        json(res, 'entries' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/read': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const asImage = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).asImage === true
          : false
        const result = await fs.read(root, path, asImage)
        json(res, 'content' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/write': {
        const path = strField(payload, 'path')
        const content = strOrEmpty(payload, 'content')
        if (path === null || content === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const rawBase = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).baseMtime
          : undefined
        const baseMtime = typeof rawBase === 'number' && Number.isFinite(rawBase) ? rawBase : undefined
        const result = await fs.write(root, path, content, baseMtime)
        json(res, 'mtime' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/search': {
        const query = strField(payload, 'query') ?? ''
        const result = await fs.search(root, query)
        json(res, 'hits' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/delete': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await fs.delete(root, path)
        json(res, 'ok' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/git-status': {
        const result = await git.status(root)
        json(res, result === null ? OK(null) : 'root' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/git-diff': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const staged = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).staged === true
          : false
        const result = await git.diff(root, path, staged)
        json(res, 'content' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/git-stage': {
        const paths = strArray(payload, 'paths')
        if (paths === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await git.stage(root, paths)
        json(res, 'applied' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/git-unstage': {
        const paths = strArray(payload, 'paths')
        if (paths === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await git.unstage(root, paths)
        json(res, 'applied' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/git-discard': {
        const paths = strArray(payload, 'paths')
        if (paths === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await git.discard(root, paths)
        json(res, 'applied' in result ? OK(result) : FAIL(result))
        return
      }
      default:
        res.writeHead(404)
        res.end()
    }
  }

  const sse = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Reject non-loopback clients before gating the root or opening the
    // stream: a LAN-exposed deployment must not offer a subscription at all.
    if (!isLoopbackRequest(req)) {
      forbidden(res)
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const root = url.searchParams.get('root')
    if (root === null || root === '') {
      res.writeHead(400)
      res.end()
      return
    }
    // Gate the requested root before opening the stream: an unowned path must
    // not be able to subscribe to watch/git events. The canonical root becomes
    // the subscriber's root for both the watcher and git polling.
    const gated = await fs.verify(root)
    if (!gated.ok) {
      json(res, FAIL(gated.error), 400)
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('retry: 2000\n\n')
    const subscriber: Subscriber = { root: gated.canonical, lastGit: '', res }
    subscribers.add(subscriber)
    // A stream opened after the one-shot probe already failed gets the
    // unavailable event right away; streams open during the probe receive it
    // from the probe's broadcast above.
    if (gitUnavailable) push(subscriber, { kind: 'gitUnavailable' })
    startGitPoll()
    if (heartbeatTimer === undefined) {
      heartbeatTimer = setInterval(() => {
        for (const current of subscribers) current.res.write(': ping\n\n')
      }, HEARTBEAT_MS)
    }
    const disposeWatch = fs.watch(gated.canonical, () => {
      push(subscriber, { kind: 'fs' })
    })
    req.on('close', () => {
      disposeWatch()
      subscribers.delete(subscriber)
      if (subscribers.size === 0) {
        stopGitPoll()
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
        heartbeatTimer = undefined
      }
    })
  }

  const disposers = [
    ctx.webServer.register({ kind: 'prefix', path: '/aionui-panel', handler }),
    ctx.webServer.register({ kind: 'exact', path: '/aionui-panel/events', handler: sse }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
    stopGitPoll()
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    for (const subscriber of subscribers) subscriber.res.end()
    subscribers.clear()
  }
}
