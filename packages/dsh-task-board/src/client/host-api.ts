import type { TaskRecord } from '../core/tasks.ts'
import { t } from './locales.ts'
import {
  isTaskParseDraft,
  TASK_BOARD_API_PREFIX,
  type TaskBoardAction,
  type TaskBoardActionEnvelope,
  type TaskBoardEventPayload,
  type TaskBoardParseDraft,
  type TaskBoardParseRequest,
  type TaskBoardSnapshot,
} from '../protocol.ts'

const IMPORT_MARKER = 'dsh.taskBoard.v2.hostImported'
const SOURCE_KEY = 'dsh.taskBoard.v2.sourceId'
const IMPORT_REQUEST_KEY = 'dsh.taskBoard.v2.importRequestId'
const REQUEST_TIMEOUT_MS = 15_000
/** Re-notify the panel at most this often while the event stream stays broken. */
const STREAM_ERROR_NOTIFY_MS = 15_000
/** Mirrors the Host's own parse budget; only used to phrase the timeout. */
const TASK_PARSE_TIMEOUT_SECONDS = 45

/**
 * Failure classes of the Host API, in the language the panel renders
 * (issue #1528). The Host is the only part that knows whether a task-board
 * route exists at all, so a raw fetch/parse error must never reach the user:
 * "Unexpected token 'o', \"not found\" is not valid JSON" is what a missing
 * Host half looks like today.
 */
export type HostApiFailure = 'not-mounted' | 'unauthorized' | 'locked' | 'rejected' | 'timeout' | 'unreachable' | 'unexpected'

/** Transport failure carrying a stable class next to its user-facing message. */
export class HostApiError extends Error {
  constructor(readonly failure: HostApiFailure, message: string, readonly status?: number) {
    super(message)
    this.name = 'HostApiError'
  }
}

function uuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Read one Host response without ever handing a non-JSON body to JSON.parse:
 * the core webserver answers an unmounted `/api/*` path with the plain text
 * "not found", which used to surface as a JavaScript parse error in the panel.
 */
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  let parsed: unknown
  let readable = false
  if (text.trim() !== '') {
    try {
      parsed = JSON.parse(text)
      readable = true
    } catch {
      readable = false
    }
  }
  const hostError = readable && typeof parsed === 'object' && parsed !== null && typeof (parsed as { error?: unknown }).error === 'string'
    ? (parsed as { error: string }).error
    : undefined
  if (response.ok) {
    if (!readable) throw new HostApiError('unexpected', t('board.hostError.unexpected', { status: String(response.status) }), response.status)
    return parsed as T
  }
  if (hostError !== undefined) {
    // The Host answered with a reason of its own. A ledger lock is the one
    // class worth naming in the panel's words; the authentication fence and
    // every other action rejection are reported as they arrive.
    if (hostError === 'forbidden') throw new HostApiError('unauthorized', t('board.hostError.unauthorized'), response.status)
    if (response.status === 503 || /lock/i.test(hostError)) {
      throw new HostApiError('locked', t('board.hostError.locked', { detail: hostError }), response.status)
    }
    throw new HostApiError('rejected', hostError, response.status)
  }
  if (response.status === 404) throw new HostApiError('not-mounted', t('board.hostError.notMounted'), 404)
  if (response.status === 401 || response.status === 403) throw new HostApiError('unauthorized', t('board.hostError.unauthorized'), response.status)
  throw new HostApiError('unexpected', t('board.hostError.unexpected', { status: String(response.status) }), response.status)
}

export interface TaskBoardHostTransport {
  bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot>
  state(): Promise<TaskBoardSnapshot>
  action(action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot>
  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void
  /** One-shot model parse of pasted text (issue #1540). */
  parseDraft(request: TaskBoardParseRequest, signal?: AbortSignal): Promise<TaskBoardParseDraft>
}

export class HttpTaskBoardHostTransport implements TaskBoardHostTransport {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {}

  async bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot> {
    const initial = await this.state()
    const ledgerId = initial.scheduler.ledgerId
    if (legacy.length > 0 && ledgerId !== undefined && this.storage?.getItem(IMPORT_MARKER) !== ledgerId) {
      let sourceId = this.storage?.getItem(SOURCE_KEY)
      if (sourceId === null || sourceId === undefined || sourceId === '') {
        sourceId = uuid()
        this.storage?.setItem(SOURCE_KEY, sourceId)
      }
      let requestId = this.storage?.getItem(IMPORT_REQUEST_KEY)
      if (requestId === null || requestId === undefined || requestId === '') {
        requestId = uuid()
        this.storage?.setItem(IMPORT_REQUEST_KEY, requestId)
      }
      const snapshot = await this.post(requestId, { kind: 'import', sourceId, tasks: [...legacy] })
      this.storage?.setItem(IMPORT_MARKER, snapshot.scheduler.ledgerId ?? ledgerId)
      return snapshot
    }
    return initial
  }

  async state(): Promise<TaskBoardSnapshot> {
    return await this.request(`${TASK_BOARD_API_PREFIX}/state`, { cache: 'no-store' })
  }

  async action(action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot> {
    return await this.post(uuid(), action, initiator)
  }

  private async post(requestId: string, action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot> {
    const envelope: TaskBoardActionEnvelope = { requestId, action, ...(initiator === undefined || initiator === '' ? {} : { initiator }) }
    return await this.request(`${TASK_BOARD_API_PREFIX}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    })
  }

  private async request(url: string, init: RequestInit): Promise<TaskBoardSnapshot> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    try {
      return await readJson<TaskBoardSnapshot>(await fetch(url, { ...init, signal: controller.signal }))
    } catch (error) {
      if (error instanceof HostApiError) throw error
      if (controller.signal.aborted) throw new HostApiError('timeout', t('board.hostError.timeout', { seconds: String(REQUEST_TIMEOUT_MS / 1_000) }))
      // fetch itself failed (server stopped, connection reset, DNS): the panel
      // says so in its own words instead of leaking "Failed to fetch".
      throw new HostApiError('unreachable', t('board.hostError.unreachable'))
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  /**
   * Ask the Host to turn pasted text into task fields. The route answers a
   * typed failure (no model, timeout, unparseable reply) already phrased for
   * the form, so the UI never renders a raw status code (issue #1540).
   */
  async parseDraft(request: TaskBoardParseRequest, signal?: AbortSignal): Promise<TaskBoardParseDraft> {
    let response: Response
    try {
      response = await fetch(`${TASK_BOARD_API_PREFIX}/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      // A cancelled parse and a stopped Host look the same to fetch; the form
      // checks its own abort flag before showing anything.
      throw new HostApiError('unreachable', t('board.hostError.unreachable'))
    }
    const text = await response.text()
    let parsed: unknown
    let readable = false
    if (text.trim() !== '') {
      try {
        parsed = JSON.parse(text)
        readable = true
      } catch {
        readable = false
      }
    }
    const record = readable && typeof parsed === 'object' && parsed !== null
      ? parsed as { code?: unknown; error?: unknown; draft?: unknown }
      : undefined
    if (response.ok) {
      if (record !== undefined && isTaskParseDraft(record.draft)) return record.draft
      throw new HostApiError('unexpected', t('new.aiParseFailed', { error: t('board.hostError.unexpected', { status: String(response.status) }) }), response.status)
    }
    if (response.status === 404) throw new HostApiError('not-mounted', t('new.aiParseUnavailable'), 404)
    if (response.status === 401 || response.status === 403) throw new HostApiError('unauthorized', t('board.hostError.unauthorized'), response.status)
    const code = typeof record?.code === 'string' ? record.code : undefined
    if (code === 'no-model') throw new HostApiError('rejected', t('new.aiParseNoModel'), response.status)
    if (code === 'timeout') throw new HostApiError('timeout', t('new.aiParseTimeout', { seconds: String(TASK_PARSE_TIMEOUT_SECONDS) }), response.status)
    const detail = typeof record?.error === 'string' && record.error !== '' ? record.error : String(response.status)
    throw new HostApiError('rejected', t('new.aiParseFailed', { error: detail }), response.status)
  }

  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void {
    const events = new EventSource(`${TASK_BOARD_API_PREFIX}/events`)
    let lastStreamErrorNotify = 0
    events.onmessage = (message: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(message.data) as TaskBoardEventPayload
        if (parsed === null || typeof parsed !== 'object' || typeof parsed.revision !== 'number') throw new Error('invalid event frame')
        listener(parsed)
      } catch {
        listener()
      }
    }
    // A stream that cannot connect at all (unmounted route, refused socket) is
    // how a Host half that never mounted looks from the browser; nudge the
    // panel into one state read so the failure becomes visible (#1528).
    events.onerror = (): void => {
      const now = Date.now()
      if (now - lastStreamErrorNotify < STREAM_ERROR_NOTIFY_MS) return
      lastStreamErrorNotify = now
      listener()
    }
    const onVisible = (): void => { if (document.visibilityState === 'visible') listener() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      events.close()
    }
  }
}
