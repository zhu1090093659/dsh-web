import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { TaskBoardHostService } from './host-service.ts'
import { writeJson } from './http.ts'
import { isForwardedLoopbackRequest, isLoopbackAddress, isLoopbackRequest } from './loopback.ts'
import { TaskParseError, TASK_PARSE_MAX_INPUT } from './host-ai.ts'
import {
  parseActionEnvelope,
  parseTaskParseRequest,
  TASK_BOARD_API_PREFIX,
  type TaskBoardParseDraft,
  type TaskBoardParseRequest,
} from './protocol.ts'
import {
  attachmentErrorStatus,
  effectiveImageByteLimit,
  imageRefOf,
  readRequestBytes,
  requestChunks,
  sanitizeAttachmentName,
  storeFile,
  storeImage,
  TaskBoardAttachmentError,
  type TaskBoardAttachmentStore,
} from './host/attachments.ts'

const ACTION_LIMIT = 64 * 1024
const IMPORT_LIMIT = 2 * 1024 * 1024
/**
 * Comment-frame cadence on the event stream. It keeps the connection alive
 * through intermediaries that would close an idle one; it is not a frame the
 * browser reports to the panel (an SSE comment is invisible to EventSource).
 */
export const HEARTBEAT_MS = 15_000

/** Header replaced by an authenticated same-host reverse proxy. */
export const TASK_BOARD_PROXY_TOKEN_HEADER = 'x-dsh-task-board-proxy-token'

/**
 * The composition's Host connection service, narrowed to the one check the
 * board bridges: `requestRejection` runs the Host/Origin fence and verifies
 * the authority-bound `dsh-auth-*` browser session minted by the Host. It
 * answers `undefined` only for a request it admits and 401/403 otherwise.
 * Declared structurally, like the official open-in-app routes do, because the
 * service's package is a browser-side dependency this Host half does not
 * import.
 */
export interface TaskBoardConnectionTrust {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/** Optional authenticated reverse-proxy access layered over the loopback default. */
export interface TaskBoardRouteAccess {
  trustedProxyHosts?: readonly string[]
  proxyToken?: string
  /**
  /**
   * Whether the operator's own reverse proxy or tunnel may speak for the
   * browser: a forwarded request that landed on this machine's loopback
   * upstream then counts as trustable, still behind the browser same-origin
   * marker. Read at each request (hence the function), so the settings switch
   * binds the next request without re-registering the routes. Absent or false
   * keeps the pre-existing fence exactly as it was (issue #1906).
   */
  trustForwardedProxy?: () => boolean
  /**
   * Resolves the Host's `connection` service when a request arrives, so a
   * deployment that mounts it after these routes still gains the bridge and a
   * composition that never mounts it keeps the pre-existing fence. Absent means
   * no bridge (issue #1930).
   */
  connection?: () => TaskBoardConnectionTrust | undefined
}

/**
 * Host faces the routes need beyond the ledger service. The parse face is
 * resolved lazily by the caller, so a deployment without an llm service still
 * registers the route and answers with a typed "no model" failure instead of
 * leaving the panel with an unmounted path (issue #1540).
 */
export interface TaskBoardRouteOptions {
  parseTask?: (request: TaskBoardParseRequest, signal: AbortSignal) => Promise<TaskBoardParseDraft>
  /**
   * The official attachment storage, read at request time so a deployment that
   * mounts it after these routes still gains the attachment surface. Absent
   * means this deployment stores no attachments, and every attachment route
   * answers with a typed "storage unavailable" failure.
   */
  attachments?: () => TaskBoardAttachmentStore | undefined
}

interface ResolvedRouteAccess {
  trustedProxyHosts: ReadonlySet<string>
  proxyToken?: string
  trustForwardedProxy: () => boolean
  connection?: () => TaskBoardConnectionTrust | undefined
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
  return {
    trustedProxyHosts,
    trustForwardedProxy: access.trustForwardedProxy ?? ((): boolean => false),
    ...(access.proxyToken === undefined ? {} : { proxyToken: access.proxyToken }),
    ...(access.connection === undefined ? {} : { connection: access.connection }),
  }
}

/**
 * Harness browser-auth cookie prefix (dsh-client-connection): the
 * authority-bound signed cookie the Host mints in exchange for its launch
 * token. dsh-web's remote channel redeems that token before re-issuing paired
 * traffic to 127.0.0.1 (packages/dsh-remote-web-ui/src/inner-auth.ts), and the
 * official DSH Desktop shell keeps its own copy from the same exchange and
 * attaches it to every request it forwards for the dsh-app://app/ page. The
 * two constants describe one fact and move together.
 */
const BROWSER_AUTH_COOKIE_PREFIX = 'dsh-auth-'

/**
 * Whether a Cookie header carries the Host's browser-auth credential. Only an
 * application on this machine can hold it: the desktop shell never lets it
 * reach the page's cookie jar, and SameSite=Strict keeps a cross-site page
 * from attaching it.
 * @param header - the raw Cookie header value.
 */
function carriesBrowserAuthCookie(header: string | undefined): boolean {
  if (header === undefined) return false
  return header.split(';').some(segment => segment.trim().startsWith(BROWSER_AUTH_COOKIE_PREFIX))
}

/**
 * Browser-signal tripwire, NOT an authority check: a bare curl sends neither
 * header and is refused, but a curl with a forged Origin passes this too.
 * The real boundary is the loopback socket + Host + origin-equality checks
 * in isTrustedTaskBoardRequest below; do not rely on this marker alone.
 *
 * A first-party client that presents NEITHER header must still pass. The DSH
 * Desktop shell serves the Web GUI from dsh-app://app/ and forwards that
 * page's Host requests itself, deleting origin and sec-fetch-site on the
 * way (dsh-desktop-host's forwardWebRequest), so the panel's own fetch
 * arrives marker-less and every route behind this guard answered 403 - which
 * the panel renders as its board.hostError.unauthorized message. The shell
 * does attach the Host's browser-auth cookie, redeemed from the Host's launch
 * URL at startup and deliberately withheld from the page. That credential,
 * not a header the shell strips, is the browser signal of an application on
 * this machine; a marker-less, credential-less request stays refused.
 */
function browserSameOriginMarker(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (site === 'same-origin') return true
  if (typeof req.headers.origin === 'string') return true
  return carriesBrowserAuthCookie(req.headers.cookie)
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
 *
 * A third party's proxy cannot inject that token, so a deployment whose own
 * tunnel dials the loopback upstream (issue #1918) can instead turn on
 * trustForwardedProxy: a forwarded request that landed on this machine
 * (loopback socket AND loopback Host) is then admitted on the same browser
 * marker alone. The switch defaults off, so an unconfigured board keeps
 * refusing every forwarded request (issue #1906).
 *
 * A deployment behind a reverse proxy or ingress that DSH itself serves
 * (`--trusted-host`, TLS terminated at the edge) is admitted by the Host's
 * `connection` service instead: a request whose Host/Origin fence and signed
 * browser session it accepts needs no board-specific allowlist, which is why
 * the check runs first when the service is mounted (issue #1930). The fence
 * below stays untouched as the fallback, so a deployment without the service,
 * and every direct client the service does not admit, keeps exactly the
 * pre-existing decision.
 */
export function isTrustedTaskBoardRequest(req: IncomingMessage, access: ResolvedRouteAccess): boolean {
  const connection = access.connection?.()
  if (connection !== undefined && connection.requestRejection(req) === undefined) return true
  if (!browserSameOriginMarker(req)) return false
  if (isLoopbackRequest(req)) return true
  // The tunnel makes the socket and the Host describe the proxy, so the
  // origin-equality check of the direct fence has nothing to compare on this
  // path; the explicit cross-site marker is then the one signal that separates
  // the operator's own page from a third-party page posting through the tunnel,
  // and it is refused instead of being read as a mere tripwire.
  if (access.trustForwardedProxy()
    && req.headers['sec-fetch-site'] !== 'cross-site'
    && isForwardedLoopbackRequest(req)) return true
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

/**
 * The query parameters of one request, read against a fixed base so a
 * relative request target still parses.
 */
function requestQuery(req: IncomingMessage): URLSearchParams {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams
  } catch {
    return new URLSearchParams()
  }
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
        // The verified path: an action that carries attachments is proven
        // against the official storage BEFORE the ledger commits it, so a
        // spoofed claim can never become a stored fact.
        writeJson(res, 200, await service.applyVerified(parsed.requestId, parsed.action, parsed.initiator), { 'cache-control': 'no-store' })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // An attachment failure keeps its own class: a storage that is
        // unavailable answers 503 exactly like the upload route does, instead
        // of being flattened into a generic rejected action.
        if (error instanceof TaskBoardAttachmentError) {
          writeJson(res, attachmentErrorStatus(error.code), { ok: false, code: error.code, error: message }, { 'cache-control': 'no-store' })
          return
        }
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
      // The stream is the board's only live signal, so it also has to be able to
      // STOP being one. A connection can stop accepting bytes while neither end
      // has closed it (a half-open socket, an intermediary that stopped
      // reading); from then on every frame is written into nothing, the browser's
      // EventSource sees an open stream that never speaks, and the panel keeps
      // the snapshot it last applied with no error to react to. A failed write is
      // the one report of that state, so it ends the connection here: the browser
      // then reports the closed stream, and a closed stream makes the panel read
      // the state again.
      let heartbeat: ReturnType<typeof setInterval> | undefined
      let release: (() => void) | undefined
      const stop = (): void => {
        if (heartbeat !== undefined) {
          clearInterval(heartbeat)
          heartbeat = undefined
        }
        const unsubscribe = release
        release = undefined
        unsubscribe?.()
      }
      const drop = (): void => {
        if (release === undefined) return
        stop()
        res.destroy()
      }
      const write = (chunk: string): void => {
        if (release === undefined || res.writableEnded || res.destroyed) return
        // The callback is the only place Node reports a write that never landed;
        // its result (backpressure) is not an error and is ignored.
        res.write(chunk, (error) => { if (error !== null && error !== undefined) drop() })
      }
      const push = (): void => {
        write(`data: ${JSON.stringify(service.eventPayload())}\n\n`)
      }
      release = service.subscribe(push)
      heartbeat = setInterval(() => { write(': ping\n\n') }, HEARTBEAT_MS)
      req.once('close', stop)
      res.once('close', stop)
      // A reset socket reports the same fact as a failed write. Without this
      // listener Node treats a response error as unhandled, so the connection is
      // released here instead of being left behind.
      res.on('error', () => { drop() })
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
  const verification: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/verification`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      try {
        writeJson(res, 200, await service.verificationOptions(), { 'cache-control': 'no-store' })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }, { 'cache-control': 'no-store' })
      }
    },
  }
  const attachmentUpload: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/attachments/upload`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      const store = options.attachments?.()
      if (store === undefined) {
        return writeJson(res, 503, { ok: false, code: 'storage-unavailable', error: 'this deployment serves no attachment storage' }, { 'cache-control': 'no-store' })
      }
      const query = requestQuery(req)
      const kind = query.get('kind')
      if (kind !== 'image' && kind !== 'file') {
        return writeJson(res, 400, { ok: false, code: 'invalid-request', error: 'the attachment kind must be image or file' }, { 'cache-control': 'no-store' })
      }
      const name = sanitizeAttachmentName(query.get('name'))
      const mediaType = query.get('mediaType') ?? ''
      try {
        if (kind === 'image') {
          // The declared type is what the storage checks the decoded bytes
          // against, so it is required rather than guessed: a guess would
          // store a mislabelled object or fail with the storage's own
          // mismatch error.
          if (mediaType === '') {
            return writeJson(res, 400, { ok: false, code: 'invalid-request', error: 'an image upload must declare its media type' }, { 'cache-control': 'no-store' })
          }
          const limit = effectiveImageByteLimit(store)
          const bytes = await readRequestBytes(req, limit)
          const attachment = await storeImage(store, bytes, name, mediaType)
          writeJson(res, 200, { ok: true, attachment }, { 'cache-control': 'no-store' })
          return
        }
        const stored = await storeFile(store, requestChunks(req), name, mediaType)
        writeJson(res, 200, { ok: true, attachment: stored.attachment }, { 'cache-control': 'no-store' })
      } catch (error) {
        // The body is drained so the refusal reaches the caller instead of a
        // closed socket.
        req.resume()
        const failure = error instanceof TaskBoardAttachmentError
          ? error
          : new TaskBoardAttachmentError('storage-unavailable', 'the attachment storage is unavailable', { cause: error })
        writeJson(res, attachmentErrorStatus(failure.code), { ok: false, code: failure.code, error: failure.message }, { 'cache-control': 'no-store' })
      }
    },
  }
  const attachmentImage: WebRoute = {
    kind: 'exact',
    path: `${TASK_BOARD_API_PREFIX}/attachments/image`,
    handler: async (req, res): Promise<void> => {
      if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' }, { 'cache-control': 'no-store' })
      if (!guard(req, res)) return
      const store = options.attachments?.()
      if (store === undefined) {
        return writeJson(res, 503, { ok: false, code: 'storage-unavailable', error: 'this deployment serves no attachment storage' }, { 'cache-control': 'no-store' })
      }
      const id = requestQuery(req).get('id') ?? ''
      // An image is served only when a card of THIS board references it: an
      // unreferenced identifier must never become a readable object.
      const referenced = service.ledger.allTasks().flatMap(task => task.attachments ?? [])
        .find(attachment => attachment.kind === 'image' && attachment.attachmentId === id)
      if (referenced === undefined) {
        return writeJson(res, 404, { ok: false, code: 'not-found', error: 'no card references this attachment' }, { 'cache-control': 'no-store' })
      }
      try {
        const stored = await store.readImage(imageRefOf(referenced))
        res.writeHead(200, {
          'content-type': stored.ref.mediaType,
          'content-length': String(stored.data.byteLength),
          'cache-control': 'no-store',
        })
        res.end(Buffer.from(stored.data))
      } catch (error) {
        const failure = error instanceof TaskBoardAttachmentError
          ? error
          : new TaskBoardAttachmentError('unreadable', 'the stored attachment could not be read back', { cause: error })
        writeJson(res, attachmentErrorStatus(failure.code), { ok: false, code: failure.code, error: failure.message }, { 'cache-control': 'no-store' })
      }
    },
  }
  return [state, action, events, parse, verification, attachmentUpload, attachmentImage]
}
