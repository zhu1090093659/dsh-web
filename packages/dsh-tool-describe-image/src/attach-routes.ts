/**
 * The /describe-image/attach route: a browser-to-host upload seam that turns a
 * picked image into a durable attachment reference and returns the
 * `[image attachment …]` note text the browser half splices into the composer
 * draft. The note is plain text, so a text-only model sees the reference and
 * can hand the exact JSON to describe_image; the image bytes themselves never
 * cross into the conversation log — they live in the attachment store, exactly
 * like images the vision pipeline uploads.
 *
 * The route works without any plugin configuration (the family aggregate mounts
 * this way): the byte bound falls back to the default and the attachment store
 * is resolved per call, failing with a clear message when it is absent.
 * @module @linxin666/dsh-tool-describe-image/attach
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, isImageMimeType, sniffMimeType, DEFAULT_MAX_BYTES, type ImageMimeType } from './media.ts'

/** Request-body byte cap: base64 of a {@link DEFAULT_MAX_BYTES} image plus envelope slack. */
export const MAX_ATTACH_BODY_BYTES = 16 * 1024 * 1024

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
 * In-memory registry of references this process's attach route persisted,
 * keyed by attachment id. Text models that copy only the id out of an
 * `[image attachment …]` note (instead of the whole JSON) still resolve
 * through here, and the attachment store's digest verification runs on the
 * read regardless. Bounded FIFO; ids are content-addressed so a stale entry
 * cannot be confused with another image.
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
export function attachmentRefById(id: string): ImageAttachmentRef | undefined {
  return ATTACHMENT_REF_REGISTRY.get(id)
}

/**
 * The markdown image reference inserted into the composer draft: short,
 * renders as an image/link in the conversation, and carries the attachment
 * id in the URL so a text model can extract it and hand it to
 * describe_image (the tool resolves bare ids through the registry).
 * @param id - the attachment id (e.g. `sha256:…`).
 * @returns the markdown text to splice into the draft.
 */
export function attachmentMarkdown(id: string): string {
  // The `:` of `sha256:…` stays readable and extractable for the model;
  // everything else is escaped for the path segment.
  return `![图片](/describe-image/raw/${encodeURIComponent(id).replace(/%3A/gi, ':')})`
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
    return { ok: true, ref, note: attachmentNote(ref), markdown: attachmentMarkdown(ref.attachmentId) }
  } catch (error) {
    return { ok: false, error: { code: 'internal', message: `attachment store rejected the image: ${(error as Error).message ?? String(error)}` } }
  }
}

/** Read a JSON request body up to a byte cap; null when unparseable or oversized. */
async function readJsonBody(req: IncomingMessage, cap: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > cap) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Write one JSON envelope response. */
function json(res: ServerResponse, envelope: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * Serve one stored image by its bare attachment id (the GET half of the
 * prefix route). Unknown ids and store failures answer 404; the media type
 * comes from the registered reference, never from the URL.
 * @param ctx - registrant context carrying the optional attachment service.
 * @param req - the incoming GET request.
 * @param res - the outgoing response.
 */
async function serveRawImage(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const match = /^\/describe-image\/raw\/([^/]+)$/.exec(new URL(req.url ?? '/', 'http://x').pathname)
  if (match === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const id = decodeURIComponent(match[1])
  const ref = attachmentRefById(id)
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
    res.writeHead(200, { 'content-type': ref.mediaType, 'content-length': String(stored.data.byteLength), 'cache-control': 'private, max-age=3600' })
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
 */
export function registerAttachRoute(ctx: Context, readMaxBytes: () => number = () => DEFAULT_MAX_BYTES): void {
  const webserver = ctx.get('webServer')
  if (webserver === undefined) return
  webserver.register({
    kind: 'prefix',
    path: '/describe-image',
    handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      // GET /describe-image/raw/<id>: serve the stored bytes so the
      // markdown image reference inserted into the draft renders. The id is
      // content-addressed and loopback-only, so a bare read carries no
      // secrets; the store's digest verification still runs.
      if (req.method === 'GET') {
        await serveRawImage(ctx, req, res)
        return
      }
      if (req.method !== 'POST') {
        json(res, { ok: false, error: METHOD_NOT_ALLOWED }, 405)
        return
      }
      const body = await readJsonBody(req, MAX_ATTACH_BODY_BYTES)
      if (body === null) {
        json(res, { ok: false, error: { code: 'internal', message: 'request body must be JSON within 16 MiB' } }, 400)
        return
      }
      const outcome = await handleAttach(ctx, readMaxBytes(), body)
      if (outcome.ok) {
        json(res, { ok: true, value: { note: outcome.note, markdown: outcome.markdown, ref: outcome.ref } })
        return
      }
      json(res, { ok: false, error: outcome.error }, outcome.error.code === 'rejected' ? 422 : 500)
    },
  })
}
