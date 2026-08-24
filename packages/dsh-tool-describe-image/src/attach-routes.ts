/**
 * The /describe-image/attach route: a browser-to-host upload seam that turns a
 * picked image into a durable attachment reference and returns both its
 * `[image attachment ...]` note and self-contained Markdown reference. The
 * Markdown carries immutable metadata, so a text-only model can pass it intact
 * to describe_image after a restart or from a PTC nested tool call; image bytes
 * never cross into the conversation log and remain in the attachment store.
 *
 * The route works without any plugin configuration (the family aggregate mounts
 * this way): the byte bound falls back to the default and the attachment store
 * is resolved per call, failing with a clear message when it is absent.
 * @module @linxin666/dsh-tool-describe-image/attach
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { attachmentMarkdown as renderAttachmentMarkdown, parseImageAttachmentRef } from './attachment-reference.ts'
import { decodeBase64, isImageMimeType, sniffMimeType, DEFAULT_MAX_BYTES, type ImageMimeType } from './media.ts'
import { UNKNOWN_CAPABILITY, type CapabilityProbe } from './model-capability.ts'
import { handleModelProbe, handleModelTest, type ProbeKeyResolver } from './model-probe.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { Config } from './config-resolve.ts'
import { readJsonBody, writeJson } from './http.ts'

export { renderAttachmentMarkdown as attachmentMarkdown }

/** Request-body byte cap for the default image bound (kept for docs/tests). */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

/**
 * JSON request-body cap for one attach: base64 of a `maxBytes` image
 * inflates to ~4/3 its byte length, plus JSON envelope slack. Scaling it with
 * the configured image bound (not a fixed 16 MiB) keeps a higher configured
 * maxBytes usable — a fixed cap silently rejected any image whose base64
 * exceeded it.
 */
export function attachBodyCap(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024
}

/** Stable error codes the browser half surfaces without leaking internals. */
export interface AttachError {
  /** `rejected`: the image or payload fails validation; `internal`: the route or store failed. */
  code: 'rejected' | 'internal'
  message: string
}

/** Validated upload payload. */
export interface AttachPayload {
  /** Base64-encoded image bytes (standard alphabet). */
  data: string
  /** Media type the sender declares; verified against magic bytes. */
  mediaType: ImageMimeType
  /** Optional display name; never interpreted as a path. */
  name?: string
}

/** Outcome of one attach attempt. */
export type AttachOutcome =
  | { ok: true; ref: ImageAttachmentRef; note: string; markdown: string }
  | { ok: false; error: AttachError }

/** The failure envelope used when a non-POST request hits the route. */
export const METHOD_NOT_ALLOWED: AttachError = { code: 'internal', message: 'only POST is allowed' }

/**
 * In-memory fallback for callers that copied only a bare attachment id instead
 * of the complete durable Markdown or note. The attachment store still verifies
 * the digest on every read. Bounded FIFO; ids are content-addressed so a stale
 * entry cannot be confused with another image.
 */
const ATTACHMENT_REF_REGISTRY = new Map<string, ImageAttachmentRef>()

/** Registry capacity; beyond it the oldest entry is dropped. */
const ATTACHMENT_REF_REGISTRY_CAP = 128

/** Remember one persisted reference by its attachment id. */
export function registerAttachmentRef(ref: ImageAttachmentRef): void {
  ATTACHMENT_REF_REGISTRY.delete(ref.attachmentId)
  ATTACHMENT_REF_REGISTRY.set(ref.attachmentId, ref)
  while (ATTACHMENT_REF_REGISTRY.size > ATTACHMENT_REF_REGISTRY_CAP) {
    const oldest = ATTACHMENT_REF_REGISTRY.keys().next().value
    if (oldest === undefined) break
    ATTACHMENT_REF_REGISTRY.delete(oldest)
  }
}

/** Look up a persisted reference by its bare attachment id, if still in the registry. */
/** decodeURIComponent that returns null instead of throwing on malformed input. */
export function safeDecodeUriComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function attachmentRefById(id: string): ImageAttachmentRef | undefined {
  return ATTACHMENT_REF_REGISTRY.get(id)
}

/** Build the `[image attachment …]` note text for one reference. */
export function attachmentNote(ref: ImageAttachmentRef): string {
  return `[image attachment ${JSON.stringify(ref)}]`
}

/**
 * Validate an unknown upload payload and decode its bytes. Pure: no context,
 * no I/O — every rejection reason is spelled in the error message.
 * @param payload - the parsed request body.
 * @param maxBytes - the image byte bound.
 * @returns the validated payload and decoded bytes, or the rejection.
 */
export function validateAttachPayload(payload: unknown, maxBytes: number): { payload: AttachPayload; bytes: Buffer } | { error: AttachError } {
  if (typeof payload !== 'object' || payload === null) {
    return { error: { code: 'internal', message: 'request body must be a JSON object' } }
  }
  const record = payload as Record<string, unknown>
  const { data, mediaType, name } = record
  if (typeof data !== 'string' || data.length === 0) {
    return { error: { code: 'rejected', message: 'image data must be a non-empty base64 string' } }
  }
  if (!isImageMimeType(mediaType)) {
    return { error: { code: 'rejected', message: 'mediaType must be one of image/png, image/jpeg, image/gif, image/webp' } }
  }
  if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
    return { error: { code: 'rejected', message: 'name must be a non-empty string when present' } }
  }
  const bytes = decodeBase64(data)
  if (bytes === undefined) {
    return { error: { code: 'rejected', message: 'image data is not valid base64' } }
  }
  if (bytes.length === 0) {
    return { error: { code: 'rejected', message: 'image data is empty' } }
  }
  if (bytes.length > maxBytes) {
    return { error: { code: 'rejected', message: `image is ${bytes.length} bytes, above the ${maxBytes}-byte bound` } }
  }
  if (sniffMimeType(bytes) !== mediaType) {
    return { error: { code: 'rejected', message: `bytes do not match the declared ${mediaType} type` } }
  }
  return { payload: { data, mediaType, name }, bytes }
}

/**
 * Validate and persist one upload. The declared media type is checked against
 * magic bytes before any store write; the store's own validation runs before
 * the reference is published.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param maxBytes - the image byte bound.
 * @param payload - the parsed request body.
 * @returns the stored reference and its note text, or a structured rejection.
 */
export async function handleAttach(ctx: Context, maxBytes: number, payload: unknown): Promise<AttachOutcome> {
  const validated = validateAttachPayload(payload, maxBytes)
  if ('error' in validated) return { ok: false, error: validated.error }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    return { ok: false, error: { code: 'internal', message: 'the attachment service is not mounted; the route cannot store images' } }
  }
  try {
    const ref = await attachments.saveImage({
      data: validated.bytes,
      mediaType: validated.payload.mediaType,
      ...validated.payload.name === undefined ? {} : { name: validated.payload.name },
    })
    registerAttachmentRef(ref)
    return { ok: true, ref, note: attachmentNote(ref), markdown: renderAttachmentMarkdown(ref) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: `attachment store rejected the image: ${(error as Error).message ?? String(error)}` } }
  }
}

/**
 * Answer one capability probe (GET /describe-image/capability?session=<id>):
 * whether the session's effective model positively declares image input.
 * The browser send hook passes raw image blocks through only on an explicit
 * acceptsImages; every other answer keeps the legacy describe-image rewrite.
 * @param probe - the per-mount capability probe.
 * @param req - the incoming GET request.
 * @param res - the outgoing response.
 */
async function serveCapability(probe: CapabilityProbe | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessionId = new URL(req.url ?? '/', 'http://x').searchParams.get('session') ?? ''
  const capability = probe === undefined || sessionId === '' ? UNKNOWN_CAPABILITY : await probe(sessionId)
  writeJson(res, 200, { ok: true, value: capability })
}

/**
 * Serve one stored image by its raw-route id. Unknown ids and store failures
 * answer 404; current Markdown supplies verified reference metadata in its
 * query string, while legacy id-only Markdown falls back to the process registry.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param req - the incoming GET request.
 * @param res - the outgoing response.
 */
async function serveRawImage(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://x')
  const match = /^\/describe-image\/raw\/([^/]+)$/.exec(requestUrl.pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  // Malformed percent-encoding must answer a controlled 404, not throw a
  // URIError out of the handler.
  const id = safeDecodeUriComponent(match[1])
  if (id === null) {
    res.writeHead(404)
    res.end()
    return
  }
  let ref: ImageAttachmentRef | undefined
  const serializedRef = requestUrl.searchParams.get('ref')
  if (serializedRef !== null) {
    try {
      ref = parseImageAttachmentRef(serializedRef)
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    if (ref.attachmentId !== id) {
      res.writeHead(404)
      res.end()
      return
    }
  }
  ref ??= attachmentRefById(id)
  if (ref === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const stored = await attachments.readImage(ref)
    res.writeHead(200, { 'content-type': stored.ref.mediaType, 'content-length': String(stored.data.byteLength), 'cache-control': 'private, max-age=3600' })
    res.end(Buffer.from(stored.data))
  } catch {
    res.writeHead(404)
    res.end()
  }
}

/**
 * Register the /describe-image/attach POST route on the shared webserver. The
 * byte bound is read per request so the Settings card's maxBytes change lands
 * immediately; the attachment service is resolved per call.
 * @param ctx - registrant context; webServer is required.
 * @param readMaxBytes - per-request byte-bound reader (defaults to the constant).
 * @param probe - per-session image-input capability probe for the GET capability route.
 */
export function registerAttachRoute(ctx: Context, readMaxBytes: () => number = () => DEFAULT_MAX_BYTES, probe?: CapabilityProbe): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: '/describe-image',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      // Loopback fence first: the raw read serves stored image bytes and the
      // attach POST writes them into the local attachment store, so a LAN or
      // cross-site caller must be turned away regardless of method or
      // content-type (same fence as the model probe routes below).
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      // GET /describe-image/raw/<id>: serve the stored bytes so the
      // markdown image reference inserted into the draft renders. The id is
      // content-addressed and loopback-only, so a bare read carries no
      // secrets; the store's digest verification still runs.
      if (req.method === 'GET') {
        // GET /describe-image/capability?session=<id>: the send hook's
        // per-session image-input verdict; anything else under GET is the
        // raw-image read.
        if (new URL(req.url ?? '/', 'http://x').pathname === '/describe-image/capability') {
          await serveCapability(probe, req, res)
          return
        }
        await serveRawImage(ctx, req, res)
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: METHOD_NOT_ALLOWED })
        return
      }
      const maxBytes = readMaxBytes()
      const body = await readJsonBody(req, { maxBytes: attachBodyCap(maxBytes) })
      if (body === null) {
        writeJson(res, 400, { ok: false, error: { code: 'internal', message: 'request body must be JSON within the configured image bound' } })
        return
      }
      const outcome = await handleAttach(ctx, maxBytes, body)
      if (outcome.ok) {
        writeJson(res, 200, { ok: true, value: { note: outcome.note, markdown: outcome.markdown, ref: outcome.ref } })
        return
      }
      writeJson(res, outcome.error.code === 'rejected' ? 422 : 500, { ok: false, error: outcome.error })
    },
  })
}

/** Request-body byte cap for the model probe: three short connection-field drafts. */
export const MAX_MODEL_PROBE_BODY_BYTES = 4096

/**
 * Register the /describe-image/models POST routes on the shared webserver.
 * Two actions share the prefix: the bare path lists the configured
 * endpoint's models (the settings card's fetch control — a success doubles
 * as the endpoint connectivity and credential check), and the /test suffix
 * pings the selected model with a minimal completion so the card reports
 * the model's own round-trip latency. The stored settings and the key
 * resolver are read per request, so the card's unsaved drafts can override
 * the connection fields before any save, while the key itself never crosses
 * into the browser (only the id list or the latency comes back).
 * @param ctx - registrant context; webServer is required.
 * @param readConfig - per-request reader of the settings currently in effect.
 * @param resolveKey - the credential resolver for the final configuration.
 */
export function registerModelRoutes(ctx: Context, readConfig: () => Config, resolveKey: ProbeKeyResolver): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: '/describe-image/models',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      // Loopback fence first: the probe forwards the stored key to the
      // endpoint named in the settings or drafts, so a LAN or cross-site
      // caller must be turned away regardless of method or content-type.
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'forbidden: loopback-only' })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: METHOD_NOT_ALLOWED })
        return
      }
      const body = await readJsonBody(req, { maxBytes: MAX_MODEL_PROBE_BODY_BYTES })
      const overrides = body !== null && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {}
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (pathname === '/describe-image/models/test') {
        const test = await handleModelTest(readConfig(), overrides, resolveKey)
        if (test.ok) {
          writeJson(res, 200, { ok: true, value: { latencyMs: test.latencyMs } })
          return
        }
        writeJson(res, test.error.code === 'rejected' ? 422 : 502, { ok: false, error: test.error })
        return
      }
      const outcome = await handleModelProbe(readConfig(), overrides, resolveKey)
      if (outcome.ok) {
        writeJson(res, 200, { ok: true, value: { models: outcome.models } })
        return
      }
      writeJson(res, outcome.error.code === 'rejected' ? 422 : 502, { ok: false, error: outcome.error })
    },
  })
}
