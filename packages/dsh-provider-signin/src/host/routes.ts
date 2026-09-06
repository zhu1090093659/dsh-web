/**
 * The loopback-fenced HTTP routes that carry authorization attempts between
 * the browser card and the host authorization seam. The route half validates
 * addressing (scope + known attempt), the store owns semantics.
 * @module @linxin666/dsh-provider-signin/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationNotice, AuthorizationPrompt, AuthorizationService } from '@deepseek-ai/dsh-authorization'
import { readJsonBody, writeJson } from './http.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { AttemptStore } from './attempts.ts'
import type { AttemptView, BeginBody, FlowView, RecordView } from '../core/types.ts'

/** The only credential scope this plugin drives: llm-pi-ai's own records. */
const ALLOWED_SCOPE = 'llm-pi-ai'

/** Fence + method guard shared by every route. */
function fenced(req: IncomingMessage, res: ServerResponse, method: 'GET' | 'POST'): boolean {
  if (!isLoopbackRequest(req)) {
    writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return false
  }
  if (req.method !== method) {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  return true
}

/** Validate an addressable flow key: exactly `<scope>/<id>` under our scope. */
function parseFlowKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const key = parseCredentialKey(raw)
    return key.startsWith(ALLOWED_SCOPE + '/') ? raw : undefined
  } catch {
    return undefined
  }
}

/** `GET /flow?key=llm-pi-ai/<route>` — the flow (if any) plus the stored record kind. */
export function makeFlowRoute(
  authorization: AuthorizationService,
  describeRecord: (key: string) => Promise<RecordView | undefined>,
): WebRoute {
  return {
    kind: 'exact',
    path: '/api/provider-signin/flow',
    handler: async (req, res) => {
      if (!fenced(req, res, 'GET')) return
      const url = new URL(req.url ?? '/', 'http://loopback')
      const key = parseFlowKey(url.searchParams.get('key'))
      if (key === undefined) {
        writeJson(res, 400, { ok: false, error: 'invalid or out-of-scope key' })
        return
      }
      const entry = authorization.describe(parseCredentialKey(key))
      const flow: FlowView | undefined = entry === undefined ? undefined : {
        key: entry.key,
        label: entry.label,
        methods: entry.methods.map(method => ({ ...method })),
        inFlight: entry.inFlight,
      }
      const record: RecordView | undefined = await describeRecord(key)
      writeJson(res, 200, { flow, record }, { 'cache-control': 'no-store' })
    },
  }
}

/** The relay halves `store.create()` handed back, passed through to `begin`. */
export interface AttemptRelay {
  id: string
  signal: AbortSignal
  notify: (notice: AuthorizationNotice) => void
  prompt: (prompt: AuthorizationPrompt) => Promise<string>
}

/**
 * `POST /begin` — start one relayed attempt. Answers with the attempt id
 * immediately; the outcome lands on the attempt snapshot, never on this
 * response.
 */
export function makeBeginRoute(
  authorization: AuthorizationService,
  store: AttemptStore,
  begin: (relay: AttemptRelay, key: string, method: string | undefined) => Promise<{ status: 'authorized' | 'cancelled' }>,
): WebRoute {
  return {
    kind: 'exact',
    path: '/api/provider-signin/begin',
    handler: async (req, res) => {
      if (!fenced(req, res, 'POST')) return
      const raw = await readJsonBody(req, { maxBytes: 8 * 1024, objectOnly: true })
      if (raw === null) {
        writeJson(res, 400, { ok: false, error: 'invalid body' })
        return
      }
      const body = raw as BeginBody
      const key = parseFlowKey(body.key)
      if (key === undefined) {
        writeJson(res, 400, { ok: false, error: 'invalid or out-of-scope key' })
        return
      }
      const entry = authorization.describe(parseCredentialKey(key))
      if (entry === undefined) {
        writeJson(res, 404, { ok: false, error: 'no flow registered for this key' })
        return
      }
      if (entry.inFlight) {
        writeJson(res, 409, { ok: false, error: 'an attempt is already running for this key' })
        return
      }
      const method = typeof body.method === 'string' && entry.methods.some(candidate => candidate.id === body.method)
        ? body.method
        : undefined
      const relay = store.create(key)
      // The attempt's lifecycle decouples from this HTTP response on purpose:
      // login takes minutes, the response takes milliseconds.
      void begin(relay, key, method).then((outcome) => {
        relay.settled(outcome.status)
      }, (error: unknown) => {
        if (store.view(relay.id, 0)?.status !== 'running') return
        if (error instanceof AuthorizationDeclinedError) relay.settled('cancelled')
        else store.fail(relay.id, error instanceof Error ? error.message : String(error))
      })
      writeJson(res, 200, { ok: true, attemptId: relay.id }, { 'cache-control': 'no-store' })
    },
  }
}

/** Path parser for the `/attempt/<id>[/answer|/cancel]` prefix family. */
function parseAttemptPath(pathname: string): { id: string, action: 'view' | 'answer' | 'cancel' } | undefined {
  const prefix = '/api/provider-signin/attempt/'
  if (!pathname.startsWith(prefix)) return undefined
  const tail = pathname.slice(prefix.length)
  const idPattern = /^([\da-f-]{36})(?:\/(answer|cancel))?$/
  const match = idPattern.exec(tail)
  if (match === null) return undefined
  const [, id, verb] = match
  return { id: id ?? '', action: verb === 'answer' ? 'answer' : verb === 'cancel' ? 'cancel' : 'view' }
}

/**
 * `/attempt/...` family — one route because (kind, path) pairs are unique:
 * `GET /attempt/<id>?since=<seq>` snapshots the attempt, `POST /attempt/<id>/
 * answer` replies to the pending prompt, `POST /attempt/<id>/cancel` withdraws
 * the attempt (locally, and through the seam so an attempt another surface
 * started for the same key is cancelled too).
 */
export function makeAttemptRoute(
  authorization: AuthorizationService,
  store: AttemptStore,
): WebRoute {
  return {
    kind: 'prefix',
    path: '/api/provider-signin/attempt',
    handler: async (req, res) => {
      if (!fenced(req, res, req.method === 'GET' ? 'GET' : 'POST')) return
      const url = new URL(req.url ?? '/', 'http://loopback')
      const parsed = parseAttemptPath(url.pathname)
      if (parsed === undefined) {
        writeJson(res, 404, { ok: false, error: 'unknown attempt' })
        return
      }
      if (parsed.action === 'view') {
        const since = Number(url.searchParams.get('since') ?? '0')
        const view: AttemptView | undefined = store.view(parsed.id, Number.isFinite(since) ? since : 0)
        if (view === undefined) {
          writeJson(res, 404, { ok: false, error: 'unknown attempt' })
          return
        }
        writeJson(res, 200, view, { 'cache-control': 'no-store' })
        return
      }
      const rawBody: unknown = await readJsonBody(req, { maxBytes: 8 * 1024, objectOnly: true })
      const body: Record<string, unknown> = typeof rawBody === 'object' && rawBody !== null
        ? rawBody as Record<string, unknown>
        : {}
      if (parsed.action === 'cancel') {
        const view = store.view(parsed.id, 0)
        store.cancel(parsed.id)
        // Also cancel at the seam: its attempt may be ours, but a second
        // surface could have started one for the same key.
        if (view !== undefined) {
          try {
            authorization.cancel(parseCredentialKey(view.key))
          } catch {
            // The seam refuses unknown keys; our own attempt is already cancelled.
          }
        }
        writeJson(res, 200, { ok: true })
        return
      }
      const pendingId = typeof body.pendingId === 'string' ? body.pendingId : undefined
      const value = typeof body.value === 'string' ? body.value : undefined
      if (pendingId === undefined || value === undefined) {
        writeJson(res, 400, { ok: false, error: 'pendingId and value are required' })
        return
      }
      const answered = store.answer(parsed.id, pendingId, value)
      if (!answered) {
        writeJson(res, 409, { ok: false, error: 'this prompt is no longer pending' })
        return
      }
      writeJson(res, 200, { ok: true })
    },
  }
}
