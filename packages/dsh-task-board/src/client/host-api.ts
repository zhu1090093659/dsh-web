import { degradedRowOf, ledgerOwnerPid } from '../core/degraded-reason.ts'
import { isTaskAttachment, type TaskAttachment, type TaskAttachmentKind } from '../core/attachment.ts'
import { TASK_BOARD_PACKAGE } from '../core/package-name.ts'
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

/**
 * Client-side base for the board's routes: DOCUMENT-RELATIVE (issue #1707).
 *
 * The host registers `TASK_BOARD_API_PREFIX` root-absolute; the page is served
 * with `<base href="./">`, so the browser half must drop the leading slash or
 * a sub-path deployment escapes its entry directory. Derived from the shared
 * constant so host and client cannot drift.
 */
const CLIENT_API_PREFIX = TASK_BOARD_API_PREFIX.slice(1)

const IMPORT_MARKER = 'dsh.taskBoard.v2.hostImported'
const SOURCE_KEY = 'dsh.taskBoard.v2.sourceId'
const IMPORT_REQUEST_KEY = 'dsh.taskBoard.v2.importRequestId'
const REQUEST_TIMEOUT_MS = 15_000
/** An upload moves real bytes, so it gets a wider budget than a JSON call. */
const UPLOAD_TIMEOUT_MS = 120_000
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
export type HostApiFailure =
  /** The board's own routes are not registered and nothing explains why. */
  | 'not-mounted'
  /** Another live DSH process owns the ledger, so this instance registered no board routes (#1730). */
  | 'ledger-locked'
  /** This row degraded during start for some other reason the family health route reports (#1730). */
  | 'degraded'
  | 'unauthorized'
  | 'forbidden'
  | 'locked'
  | 'rejected'
  | 'timeout'
  | 'unreachable'
  | 'unexpected'

/** Transport failure carrying a stable class next to its user-facing message. */
export class HostApiError extends Error {
  constructor(readonly failure: HostApiFailure, message: string, readonly status?: number) {
    super(message)
    this.name = 'HostApiError'
  }
}

/**
 * Same-origin family health route served by the dsh-web-all shell: the
 * degraded ledger, in which a family row that failed during apply appears WITH
 * its reason. DOCUMENT-RELATIVE for the same reason as the board's own routes
 * (issue #1707). A 404 here means the family shell is absent or older than the
 * route, which is not itself a failure of the board.
 */
const FAMILY_DEGRADED_ROUTE = 'api/dsh-web-all/degraded'

/** Health-route ceiling: an unresponsive family shell must not hold the board's first paint. */
const DEGRADED_LOOKUP_TIMEOUT_MS = 2_000

/**
 * The failure text for a row this browser knows failed during start.
 *
 * A ledger lock is the one class with an owner the user can act on, so its
 * reason is unpacked into the pid plus what to do about it; every other
 * degraded row is reported with the shell's own reason verbatim. The raw
 * reason rides along either way, because it is the only text that names the
 * lock file or the recovery step when the pid is not the whole story.
 * @param reason - the shell's one-line failure reason (never empty).
 */
function degradedFailureMessage(reason: string): { failure: 'ledger-locked' | 'degraded'; message: string } {
  const pid = ledgerOwnerPid(reason)
  if (pid === undefined) return { failure: 'degraded', message: t('board.hostError.degraded', { detail: reason }) }
  return { failure: 'ledger-locked', message: t('board.hostError.ledgerLocked', { pid: String(pid), detail: reason }) }
}

/**
 * The degraded record the family shell holds for THIS board, or undefined when
 * the row is healthy, the shell is absent, or the answer is unusable. The
 * lookup is best-effort by contract: any uncertainty keeps the caller's own
 * failure text instead of replacing it with a weaker one.
 * @param fetchImpl - fetch implementation (injected for tests).
 * @returns the ledger's reason for this row, or undefined when it names none.
 */
async function fetchDegradedReason(fetchImpl: typeof fetch): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => { controller.abort() }, DEGRADED_LOOKUP_TIMEOUT_MS)
  try {
    const response = await fetchImpl(FAMILY_DEGRADED_ROUTE, { signal: controller.signal, headers: { accept: 'application/json' }, cache: 'no-store' })
    if (!response.ok) return undefined
    return degradedRowOf(await response.json(), TASK_BOARD_PACKAGE)?.reason
  } catch {
    return undefined
  } finally {
    globalThis.clearTimeout(timer)
  }
}

/**
 * Name the real reason this board's routes are missing (issue #1730).
 *
 * The core webserver answers an unmounted route with a bare 404, which cannot
 * distinguish "this deployment never loaded the plugin" from "this row
 * degraded during start" — a second DSH process holding `ledger-v2.lock` is
 * the case that matters, because the panel's advice ("restart the service")
 * is then false: the lock belongs to the other process, and restarting cannot
 * win it. The family health route knows the difference, so the 404 is
 * disambiguated there before anything is shown.
 * @param fallback - copy for the plain "routes are not there" failure, which
 *   is route-specific (the board's state route and the AI-parse route phrase
 *   their own absence); it is also what is shown when the ledger names nothing.
 * @param fetchImpl - fetch implementation (injected for tests).
 * @returns the HostApiError to throw for a missing board route.
 */
export async function missingRouteFailure(
  fallback: string = t('board.hostError.notMounted'),
  fetchImpl: typeof fetch = fetch,
): Promise<HostApiError> {
  const absent = (): HostApiError => new HostApiError('not-mounted', fallback, 404)
  const reason = await fetchDegradedReason(fetchImpl)
  // A shell that predates the reason field (or recorded none) tells us the row
  // is degraded but not why; the route's own wording is more honest than an
  // empty "because".
  if (reason === undefined || reason === '') return absent()
  const described = degradedFailureMessage(reason)
  return new HostApiError(described.failure, described.message, 404)
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
    if (hostError === 'forbidden') throw new HostApiError('forbidden', t('board.hostError.forbidden'), response.status)
    if (response.status === 503 || /lock/i.test(hostError)) {
      throw new HostApiError('locked', t('board.hostError.locked', { detail: hostError }), response.status)
    }
    throw new HostApiError('rejected', hostError, response.status)
  }
  // A bare 404 is the ONLY signal that this board's routes are absent; the
  // family health route is what turns it into the real reason when this row
  // degraded during start (issue #1730).
  if (response.status === 404) throw await missingRouteFailure()
  if (response.status === 403) throw new HostApiError('forbidden', t('board.hostError.forbidden'), 403)
  if (response.status === 401) throw new HostApiError('unauthorized', t('board.hostError.unauthorized'), 401)
  throw new HostApiError('unexpected', t('board.hostError.unexpected', { status: String(response.status) }), response.status)
}

export interface TaskBoardHostTransport {
  bootstrap(legacy: readonly TaskRecord[]): Promise<TaskBoardSnapshot>
  state(): Promise<TaskBoardSnapshot>
  action(action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot>
  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void
  /** One-shot model parse of pasted text (issue #1540). */
  parseDraft(request: TaskBoardParseRequest, signal?: AbortSignal): Promise<TaskBoardParseDraft>
  /**
   * Upload one file or image into the Host's attachment storage. Optional: a
   * deployment that serves no attachment storage omits it, and the form then
   * refuses to stage an attachment at all.
   */
  uploadAttachment?(file: File, kind: TaskAttachmentKind): Promise<TaskAttachment>
}

/**
 * The URL of one stored image. The board serves it only for an id a card of
 * this board references, so the URL is useless on its own.
 * @param attachmentId - the stored object's identifier.
 * @returns the document-relative URL of the image.
 */
export function attachmentImageUrl(attachmentId: string): string {
  return `${CLIENT_API_PREFIX}/attachments/image?id=${encodeURIComponent(attachmentId)}`
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
    return await this.request(`${CLIENT_API_PREFIX}/state`, { cache: 'no-store' })
  }

  async action(action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot> {
    return await this.post(uuid(), action, initiator)
  }

  private async post(requestId: string, action: TaskBoardAction, initiator?: string): Promise<TaskBoardSnapshot> {
    const envelope: TaskBoardActionEnvelope = { requestId, action, ...(initiator === undefined || initiator === '' ? {} : { initiator }) }
    return await this.request(`${CLIENT_API_PREFIX}/action`, {
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
      response = await fetch(`${CLIENT_API_PREFIX}/parse`, {
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
    // The parse route lives beside the board's own routes, so a 404 means the
    // same thing here: absent routes, with the same health-ledger detail and
    // this route's own wording as the fallback.
    if (response.status === 404) throw await missingRouteFailure(t('new.aiParseUnavailable'))
    if (response.status === 403) throw new HostApiError('forbidden', t('board.hostError.forbidden'), 403)
    if (response.status === 401) throw new HostApiError('unauthorized', t('board.hostError.unauthorized'), 401)
    const code = typeof record?.code === 'string' ? record.code : undefined
    if (code === 'no-model') throw new HostApiError('rejected', t('new.aiParseNoModel'), response.status)
    if (code === 'timeout') throw new HostApiError('timeout', t('new.aiParseTimeout', { seconds: String(TASK_PARSE_TIMEOUT_SECONDS) }), response.status)
    const detail = typeof record?.error === 'string' && record.error !== '' ? record.error : String(response.status)
    throw new HostApiError('rejected', t('new.aiParseFailed', { error: detail }), response.status)
  }

  /**
   * Upload one attachment into the Host's attachment storage.
   *
   * The bytes travel as the raw request body: the Host measures the ACTUAL
   * stream, publishes the object and answers with the host-computed metadata
   * (size, type and digest) that the card will record.
   * @param file - the picked file.
   * @param kind - whether the file is stored as an image or verbatim.
   * @returns the metadata the Host computed for the stored object.
   */
  async uploadAttachment(file: File, kind: TaskAttachmentKind): Promise<TaskAttachment> {
    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => { controller.abort() }, UPLOAD_TIMEOUT_MS)
    try {
      const query = new URLSearchParams({ kind, name: file.name, mediaType: file.type })
      const response = await fetch(`${CLIENT_API_PREFIX}/attachments/upload?${query.toString()}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
        signal: controller.signal,
      })
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      const record = parsed as { ok?: unknown; attachment?: unknown; error?: unknown } | undefined
      if (response.ok) {
        if (record !== undefined && isTaskAttachment(record.attachment)) return record.attachment
        throw new HostApiError('unexpected', t('board.hostError.unexpected', { status: String(response.status) }), response.status)
      }
      const detail = typeof record?.error === 'string' && record.error !== '' ? record.error : String(response.status)
      throw new HostApiError('rejected', detail, response.status)
    } catch (error) {
      if (error instanceof HostApiError) throw error
      if (controller.signal.aborted) throw new HostApiError('timeout', t('board.hostError.timeout', { seconds: String(UPLOAD_TIMEOUT_MS / 1000) }))
      throw new HostApiError('unreachable', t('board.hostError.unreachable'))
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  subscribe(listener: (event?: TaskBoardEventPayload) => void): () => void {
    const events = new EventSource(`${CLIENT_API_PREFIX}/events`)
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
    // Every connect and every reconnect is a resynchronization point: the route
    // pushes one frame when it accepts a stream, but a frame whose revision
    // already matches the mirrored one is what the panel applies without a
    // read, so the connection itself asks for the snapshot. Without this, a
    // stream that came back after an outage would only catch up if some later
    // Host write happened to move the revision past the mirror.
    events.onopen = (): void => { listener() }
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
