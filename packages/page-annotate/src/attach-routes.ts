/**
 * Self-contained image attach seam: POST /page-annotate/attach persists a
 * base64 image through the official attachments service and returns the
 * durable `[image attachment ...]` note plus Markdown reference; GET
 * /page-annotate/raw/<id> serves the stored bytes back. This is the
 * plugin's own fallback when the describe-image attach route is absent —
 * the client prefers /describe-image/attach and only falls back here.
 * @module @linxin666/dsh-page-annotate/attach-routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { decodeBase64, MAX_ATTACH_BYTES, sniffMimeType, type ImageMimeType } from './core/media.ts'
import { isLoopbackRequest } from './loopback.ts'
import { json, type WebRoute } from './routes.ts'

/** The attachments-service face the route resolves per call. */
export interface AttachmentStoreFace {
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>
  readImage(ref: ImageAttachmentRef): Promise<{ ref: ImageAttachmentRef; data: Uint8Array }>
}

/** Resolver for the attachments service (per-call so late mounting works). */
export type AttachmentStoreResolver = () => AttachmentStoreFace | undefined

/** Bounded in-memory id registry so bare-id reads keep working (describe-image parity). */
const REF_REGISTRY = new Map<string, ImageAttachmentRef>()
const REF_REGISTRY_CAP = 128

/** Encode a URL component for Markdown, escaping parens too. */
function encodeMarkdownComponent(value: string): string {
  return encodeURIComponent(value).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** Build the `[image attachment ...]` note text. */
export function attachmentNote(ref: ImageAttachmentRef): string {
  return `[image attachment ${JSON.stringify(ref)}]`
}

/** Build the self-contained Markdown reference. */
export function attachmentMarkdown(ref: ImageAttachmentRef): string {
  const id = encodeMarkdownComponent(ref.attachmentId).replace(/%3A/gi, ':')
  const serializedRef = encodeMarkdownComponent(JSON.stringify(ref))
  return `![图片](/page-annotate/raw/${id}?ref=${serializedRef})`
}

/** Validate one attach payload; return the decoded bytes or a coded rejection. */
export function validateAttachPayload(payload: unknown): { bytes: Uint8Array; mediaType: ImageMimeType; name?: string } | { error: { code: string; message: string } } {
  const record = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
  const data = record.data
  const mediaType = record.mediaType
  if (typeof data !== 'string' || data.length === 0) {
    return { error: { code: 'rejected', message: 'image data must be a non-empty base64 string' } }
  }
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg' && mediaType !== 'image/webp') {
    return { error: { code: 'rejected', message: 'mediaType must be image/png, image/jpeg or image/webp' } }
  }
  const decoded = decodeBase64(data)
  if (decoded === undefined) {
    return { error: { code: 'rejected', message: 'image data is not valid base64' } }
  }
  if (decoded.byteLength > MAX_ATTACH_BYTES) {
    return { error: { code: 'rejected', message: 'image too large' } }
  }
  const sniffed = sniffMimeType(decoded)
  if (sniffed === undefined || sniffed !== mediaType) {
    return { error: { code: 'rejected', message: 'image bytes do not match the declared media type' } }
  }
  const name = record.name
  return {
    bytes: decoded,
    mediaType: sniffed,
    ...typeof name === 'string' && name.length > 0 ? { name } : {},
  }
}

/** Build the attach + raw routes for one attachments resolver. */
export function makeAttachRoutes(resolveStore: AttachmentStoreResolver, options: { loopback?: (req: IncomingMessage) => boolean } = {}): WebRoute[] {
  const loopback = options.loopback ?? isLoopbackRequest
  const fenced = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (loopback(req)) return true
    json(res, 403, { ok: false, error: { code: 'forbidden', message: 'loopback-only' } })
    return false
  }

  const attach: WebRoute = {
    kind: 'exact',
    path: '/page-annotate/attach',
    handler: async (req, res) => {
      if (!fenced(req, res)) return
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'POST required' } })
        return
      }
      const store = resolveStore()
      if (store === undefined) {
        json(res, 503, { ok: false, error: { code: 'store-unavailable', message: 'attachments service unavailable' } })
        return
      }
      let body: unknown
      try {
        const chunks: Buffer[] = []
        let total = 0
        for await (const chunk of req) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
          total += buffer.length
          if (total > MAX_ATTACH_BYTES + 1024) throw new Error('body-too-large')
          chunks.push(buffer)
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown
      } catch {
        json(res, 400, { ok: false, error: { code: 'bad-body', message: 'request body must be small JSON' } })
        return
      }
      const validated = validateAttachPayload(body)
      if ('error' in validated) {
        json(res, 400, { ok: false, error: validated.error })
        return
      }
      try {
        const ref = await store.saveImage({ data: validated.bytes, mediaType: validated.mediaType, ...(validated.name === undefined ? {} : { name: validated.name }) })
        REF_REGISTRY.set(ref.attachmentId, ref)
        while (REF_REGISTRY.size > REF_REGISTRY_CAP) {
          const oldest = REF_REGISTRY.keys().next().value
          if (oldest === undefined) break
          REF_REGISTRY.delete(oldest)
        }
        json(res, 200, { ok: true, value: { note: attachmentNote(ref), markdown: attachmentMarkdown(ref) } })
      } catch (error) {
        json(res, 500, { ok: false, error: { code: 'store-failed', message: error instanceof Error ? error.message : String(error) } })
      }
    },
  }

  const raw: WebRoute = {
    kind: 'prefix',
    path: '/page-annotate/raw',
    handler: async (req, res) => {
      if (!fenced(req, res)) return
      const store = resolveStore()
      if (store === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      const requestUrl = new URL(req.url ?? '/', 'http://x')
      const match = /^\/page-annotate\/raw\/([^/]+)$/.exec(requestUrl.pathname)
      if (match === null) {
        res.writeHead(404)
        res.end()
        return
      }
      let id: string
      try {
        id = decodeURIComponent(match[1])
      } catch {
        res.writeHead(404)
        res.end()
        return
      }
      let ref: ImageAttachmentRef | undefined = REF_REGISTRY.get(id)
      const serializedRef = requestUrl.searchParams.get('ref')
      if (serializedRef !== null) {
        try {
          const parsed = JSON.parse(decodeURIComponent(serializedRef)) as ImageAttachmentRef
          if (parsed.attachmentId === id) ref = parsed
        } catch {
          res.writeHead(404)
          res.end()
          return
        }
      }
      if (ref === undefined) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const stored = await store.readImage(ref)
        res.writeHead(200, {
          'content-type': stored.ref.mediaType,
          'content-length': String(stored.data.byteLength),
          'cache-control': 'private, max-age=3600',
        })
        res.end(Buffer.from(stored.data))
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }

  return [attach, raw]
}
