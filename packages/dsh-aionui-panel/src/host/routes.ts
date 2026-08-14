/**
 * /aionui-panel/* route layer: JSON envelope (ok/error with stable codes) for
 * the fs/git operations and one SSE stream (fs changes + git status changes)
 * per project root. The services own gating and parsing; this layer owns HTTP
 * shape and subscriber bookkeeping.
 * @module dsh-aionui-panel/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PanelEnvelope, PanelError } from '../core/types.ts'
import type { FsService } from './fs-service.ts'
import type { GitService } from './git-service.ts'
import type { PyService } from './py-service.ts'

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

/** Poll interval for git-status changes while subscribers are connected. */
const GIT_POLL_MS = 2_000
/** SSE keep-alive comment interval (proxies drop idle connections). */
const HEARTBEAT_MS = 15_000

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
 * @param py - the gated python analysis service.
 * @returns the route disposers.
 */
export function registerPanelRoutes(ctx: Context, fs: FsService, git: GitService, py: PyService): () => void {
  const subscribers = new Set<Subscriber>()
  let gitTimer: NodeJS.Timeout | undefined
  let heartbeatTimer: NodeJS.Timeout | undefined

  const push = (subscriber: Subscriber, payload: unknown): void => {
    subscriber.res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`)
  }

  let polling = false
  // One-shot availability state: a machine without a git binary must not
  // re-spawn ENOENT every 2s tick. The probe result is cached inside the git
  // service, so this runs once, logs at most once, and then git polling stops
  // for the rest of this route instance while fs watching keeps working.
  let gitProbed = false
  let gitUnavailable = false
  const pollGit = async (): Promise<void> => {
    // Guard against overlapping polls: a slow git status on a large repo must
    // not stack another run on the next 2s tick.
    if (polling) return
    polling = true
    try {
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
          const status = await git.status(subscriber.root)
          if (status === null || typeof status === 'object' && 'code' in status) return
          const key = `${status.branch}|${JSON.stringify(status.staged)}|${JSON.stringify(status.unstaged)}|${JSON.stringify(status.untracked)}`
          if (key === subscriber.lastGit) return
          subscriber.lastGit = key
          push(subscriber, { kind: 'git', status })
        } catch (error: unknown) {
          ctx.logger.warn(`dsh-aionui-panel: git poll failed for ${subscriber.root}: ${String(error)}`)
        }
      }))
    } finally {
      polling = false
    }
  }

  /**
   * GET /aionui-panel/raw: stream one workspace file (markdown image srcs).
   * Gated like every other operation; the bytes go out with the derived mime
   * so an `<img>` can load them. No validators are negotiated, so the browser
   * revalidates every time — a re-edited image never shows stale bytes.
   */
  const serveRaw = async (url: URL, res: ServerResponse): Promise<void> => {
    const root = url.searchParams.get('root')
    const path = url.searchParams.get('path')
    if (root === null || root === '' || path === null || path === '') {
      json(res, FAIL(BAD_REQUEST), 400)
      return
    }
    const result = await fs.readRaw(root, path)
    if (!('data' in result)) {
      const status = result.code === 'path-outside-root' || result.code === 'is-directory' ? 403 : 404
      json(res, FAIL(result), status)
      return
    }
    res.writeHead(200, {
      'content-type': result.mime,
      'content-length': result.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    })
    res.end(result.data)
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://x')
      if (url.pathname === '/aionui-panel/raw') {
        await serveRaw(url, res)
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
      case '/aionui-panel/py-lint': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await py.lint(root, path)
        json(res, 'diagnostics' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/py-symbols': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const result = await py.symbols(root, path)
        json(res, 'defs' in result ? OK(result) : FAIL(result))
        return
      }
      case '/aionui-panel/py-format': {
        const path = strField(payload, 'path')
        if (path === null) {
          json(res, FAIL(BAD_REQUEST))
          return
        }
        const apply = typeof payload === 'object' && payload !== null
          ? (payload as Record<string, unknown>).apply === true
          : false
        const result = await py.format(root, path, apply)
        json(res, 'diff' in result ? OK(result) : FAIL(result))
        return
      }
      default:
        res.writeHead(404)
        res.end()
    }
  }

  const sse = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
    if (gitTimer === undefined) gitTimer = setInterval(pollGit, GIT_POLL_MS)
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
        if (gitTimer !== undefined) clearInterval(gitTimer)
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
        gitTimer = undefined
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
    if (gitTimer !== undefined) clearInterval(gitTimer)
    if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
    for (const subscriber of subscribers) subscriber.res.end()
    subscribers.clear()
  }
}
