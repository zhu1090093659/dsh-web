/**
 * Route tests for /describe-image/attach: payload validation, the
 * attachment-store handoff, and the HTTP envelope (status codes + error
 * shape), exercised through a fake ctx.webServer registry and a fake
 * attachment store.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import { attachBodyCap, attachmentMarkdown, attachmentNote, attachmentRefById, handleAttach, registerAttachRoute, registerAttachmentRef, validateAttachPayload, type AttachError } from '../src/attach-routes.ts'
import type { AttachPayload } from '../src/attach-routes.ts'
import { PNG_BYTES } from './mock-server.ts'

/** In-memory attachment store for the route tests. */
class FakeAttachments extends AttachmentStore {
  readonly saved: Array<{ input: SaveImageAttachment; ref: ImageAttachmentRef }> = []
  failSave = false

  get imageLimits(): ImageAttachmentLimits {
    return {
      maxImageBytes: 10_000_000,
      maxImagesPerMessage: 5,
      maxMessageImageBytes: 20_000_000,
      maxImagePixels: 10_000_000,
      maxImageDimension: 2_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    }
  }

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    if (this.failSave) return Promise.reject(new Error('disk full'))
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${'c'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    }
    this.saved.push({ input, ref })
    return Promise.resolve(ref)
  }

  /** Bytes by attachment id, for the raw-image GET tests. */
  readonly stored = new Map<string, Buffer>()
  /** Optional canonical metadata returned after the store validates a reference. */
  readRef?: ImageAttachmentRef

  readImage(ref: ImageAttachmentRef, _signal?: AbortSignal): Promise<StoredImageAttachment> {
    const data = this.stored.get(String(ref.attachmentId))
    if (data === undefined) return Promise.reject(new Error('no such attachment'))
    return Promise.resolve({ data, mediaType: ref.mediaType, ref: this.readRef ?? ref })
  }
}

/** A real registrant context with (or without) the attachment service mounted. */
async function makeCtx(withAttachments: boolean): Promise<{ ctx: Context; store: FakeAttachments | undefined }> {
  const ctx = new Context()
  if (withAttachments) await ctx.plugin(FakeAttachments)
  return { ctx, store: withAttachments ? (ctx.get('attachments') as FakeAttachments) : undefined }
}

/** Narrow the validateAttachPayload union to its error side. */
function errOf(result: { payload: AttachPayload; bytes: Buffer } | { error: AttachError }): AttachError | undefined {
  return 'error' in result ? result.error : undefined
}

const PNG_BASE64 = PNG_BYTES.toString('base64')

describe('attachBodyCap', () => {
  it('stays under the legacy 16 MiB wall for the default 10 MiB bound', () => {
    expect(attachBodyCap(10 * 1024 * 1024)).toBeLessThan(16 * 1024 * 1024)
  })

  it('scales above the legacy wall when the image bound is raised', () => {
    expect(attachBodyCap(20 * 1024 * 1024)).toBeGreaterThan(16 * 1024 * 1024)
  })
})

describe('validateAttachPayload', () => {
  it('accepts a well-formed PNG payload', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/png' }, 10_000_000)
    expect('payload' in result).toBe(true)
    if ('payload' in result) {
      expect(result.payload.mediaType).toBe('image/png')
      expect(result.bytes.equals(PNG_BYTES)).toBe(true)
    }
  })

  it('rejects non-object payloads as internal errors', () => {
    expect(errOf(validateAttachPayload(null, 100))?.code).toBe('internal')
    expect(errOf(validateAttachPayload('data', 100))?.code).toBe('internal')
    expect(errOf(validateAttachPayload(undefined, 100))?.code).toBe('internal')
  })

  it('rejects missing or empty data', () => {
    expect(errOf(validateAttachPayload({ mediaType: 'image/png' }, 100))?.message).toContain('base64')
    expect(errOf(validateAttachPayload({ data: '', mediaType: 'image/png' }, 100))?.code).toBe('rejected')
  })

  it('rejects a media type outside the accepted set', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/bmp' }, 100)
    expect(errOf(result)?.code).toBe('rejected')
    expect(errOf(result)?.message).toContain('image/png')
  })

  it('rejects a non-empty name that is not a string', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/png', name: 42 }, 100)
    expect(errOf(result)?.code).toBe('rejected')
    expect(errOf(result)?.message).toContain('name')
  })

  it('accepts a display name', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/png', name: 'shot.png' }, 100)
    expect('payload' in result).toBe(true)
    if ('payload' in result) expect(result.payload.name).toBe('shot.png')
  })

  it('rejects invalid base64 text', () => {
    expect(errOf(validateAttachPayload({ data: '!!!not-base64!!!', mediaType: 'image/png' }, 100))?.message).toContain('base64')
    expect(errOf(validateAttachPayload({ data: 'abc', mediaType: 'image/png' }, 100))?.message).toContain('base64')
  })

  it('rejects bytes above the bound', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/png' }, PNG_BYTES.length - 1)
    expect(errOf(result)?.code).toBe('rejected')
    expect(errOf(result)?.message).toContain('bound')
  })

  it('rejects bytes whose magic header does not match the declared type', () => {
    const result = validateAttachPayload({ data: PNG_BASE64, mediaType: 'image/jpeg' }, 10_000_000)
    expect(errOf(result)?.code).toBe('rejected')
    expect(errOf(result)?.message).toContain('do not match')
  })

  it('rejects base64 that decodes to empty bytes', () => {
    // "AAAA" decodes to three NUL bytes: non-empty, but unsupported magic.
    const result = validateAttachPayload({ data: 'AAAA', mediaType: 'image/png' }, 10_000_000)
    expect(errOf(result)?.code).toBe('rejected')
    expect(errOf(result)?.message).toContain('do not match')
  })
})

describe('attachmentNote', () => {
  it('builds the [image attachment …] note text from a reference', () => {
    const ref: ImageAttachmentRef = {
      attachmentId: 'id-1' as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: 4,
      width: 2,
      height: 2,
    }
    expect(attachmentNote(ref)).toBe(`[image attachment ${JSON.stringify(ref)}]`)
  })
})

describe('attachmentMarkdown', () => {
  it('embeds the complete durable reference when metadata is available', () => {
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${'d'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
      name: 'screen (1).png',
    }
    const markdown = attachmentMarkdown(ref)
    const match = /\(([^)]+)\)$/.exec(markdown)
    expect(match).not.toBeNull()
    const url = new URL(match?.[1] ?? '', 'http://dsh.local')
    expect(url.pathname).toBe(`/describe-image/raw/${ref.attachmentId}`)
    expect(url.searchParams.get('ref')).toBe(JSON.stringify(ref))
  })

  it('keeps legacy id-only Markdown available for callers without metadata', () => {
    expect(attachmentMarkdown('sha256:legacy')).toBe('![图片](/describe-image/raw/sha256:legacy)')
  })
})

describe('attachment reference registry', () => {
  it('remembers references persisted by the route and resolves them by bare id', async () => {
    const { ctx, store } = await makeCtx(true)
    const outcome = await handleAttach(ctx, 10_000_000, { data: PNG_BASE64, mediaType: 'image/png' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const resolved = attachmentRefById(String(outcome.ref.attachmentId))
      expect(resolved).toBeDefined()
      expect(resolved?.bytes).toBe(PNG_BYTES.length)
      expect(store?.saved).toHaveLength(1)
    }
  })

  it('returns undefined for an unknown id', () => {
    expect(attachmentRefById('sha256:missing')).toBeUndefined()
  })

  it('evicts the oldest entry beyond the cap', () => {
    for (let i = 0; i < 140; i += 1) {
      registerAttachmentRef({
        attachmentId: `sha256:${String(i).padStart(64, '0')}` as ImageAttachmentRef['attachmentId'],
        mediaType: 'image/png',
        bytes: i,
        width: 1,
        height: 1,
      })
    }
    expect(attachmentRefById('sha256:' + String(0).padStart(64, '0'))).toBeUndefined()
    expect(attachmentRefById('sha256:' + String(139).padStart(64, '0'))).toBeDefined()
  })
})

describe('handleAttach', () => {
  it('persists a valid image and returns its note', async () => {
    const { ctx, store } = await makeCtx(true)
    const outcome = await handleAttach(ctx, 10_000_000, { data: PNG_BASE64, mediaType: 'image/png', name: 'pic.png' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.note.startsWith('[image attachment {')).toBe(true)
      expect(outcome.markdown).toMatch(/^!\[图片\]\(\/describe-image\/raw\/sha256:.*\?ref=/)
      const path = /\(([^)]+)\)$/.exec(outcome.markdown)?.[1]
      const url = new URL(path ?? '', 'http://dsh.local')
      expect(url.searchParams.get('ref')).toBe(JSON.stringify(outcome.ref))
      expect(outcome.ref.mediaType).toBe('image/png')
      expect(store?.saved).toHaveLength(1)
      expect(store?.saved[0].input.data).toEqual(PNG_BYTES)
      expect(store?.saved[0].input.name).toBe('pic.png')
    }
  })

  it('rejects without a mounted attachment service', async () => {
    const { ctx } = await makeCtx(false)
    const outcome = await handleAttach(ctx, 10_000_000, { data: PNG_BASE64, mediaType: 'image/png' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('internal')
      expect(outcome.error.message).toContain('attachment service')
    }
  })

  it('reports a store failure as an internal error without leaking the payload', async () => {
    const { ctx, store } = await makeCtx(true)
    if (store !== undefined) store.failSave = true
    const outcome = await handleAttach(ctx, 10_000_000, { data: PNG_BASE64, mediaType: 'image/png' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('internal')
      expect(outcome.error.message).toContain('disk full')
    }
  })

  it('rejects an oversized image before any store write', async () => {
    const { ctx, store } = await makeCtx(true)
    const outcome = await handleAttach(ctx, 1, { data: PNG_BASE64, mediaType: 'image/png' })
    expect(outcome.ok).toBe(false)
    expect(store?.saved).toHaveLength(0)
  })
})

describe('registerAttachRoute', () => {
  /** One async-iterable fake request carrying an optional body. */
  const makeReq = (method: string, body?: string, url = '/describe-image/attach'): IncomingMessage => ({
    method,
    url,
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(body)
    },
  } as unknown as IncomingMessage)

  /** One fake response collecting status/headers/body. */
  const makeRes = (): { res: ServerResponse; status: () => number; body: () => string; headers: () => Record<string, string | number> | undefined } => {
    let status = 0
    let body = ''
    let headers: Record<string, string | number> | undefined
    const res = {
      writeHead: (code: number, nextHeaders?: Record<string, string | number>) => {
        status = code
        headers = nextHeaders
      },
      end: (chunk?: unknown) => {
        if (chunk !== undefined && chunk !== null) body += String(chunk)
      },
    } as unknown as ServerResponse
    return { res, status: () => status, body: () => body, headers: () => headers }
  }

  /** Register the route and return the captured prefix row. */
  const capture = (attachments: AttachmentStore | undefined, webserver: boolean, readMaxBytes?: () => number) => {
    const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
    const webServer = webserver
      ? { register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { registrations.push(row); return () => {} } }
      : undefined
    const ctx = {
      get: (key: string) => {
        if (key === 'attachments') return attachments
        if (key === 'webServer') return webServer
        return undefined
      },
    }
    registerAttachRoute(ctx as unknown as Context, readMaxBytes)
    return registrations
  }

  it('registers the prefix route on the webserver', () => {
    const registrations = capture(undefined, true)
    expect(registrations).toHaveLength(1)
    expect(registrations[0].kind).toBe('prefix')
    expect(registrations[0].path).toBe('/describe-image')
  })

  it('is a no-op when no webserver is mounted', () => {
    expect(capture(undefined, false)).toHaveLength(0)
  })

  it('answers non-GET/non-POST requests with 405', async () => {
    const registrations = capture(undefined, true)
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('DELETE'), res)
    expect(status()).toBe(405)
  })

  it('answers malformed JSON with 400', async () => {
    const registrations = capture(undefined, true)
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('POST', '{not json'), res)
    expect(status()).toBe(400)
  })

  it('scales the body cap with a higher configured maxBytes (no fixed 16 MiB wall)', async () => {
    const registrations = capture(undefined, true, () => 20 * 1024 * 1024)
    // A base64 payload that exceeds the old fixed 16 MiB cap but fits the
    // scaled cap for a 20 MiB image bound.
    const payload = JSON.stringify({ data: 'A'.repeat((16 * 1024 * 1024) + 4), mediaType: 'image/png' })
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('POST', payload), res)
    // The body cap passed; the (fake) image is then rejected by payload
    // validation (422), not by a fixed body cap (400).
    expect(status()).toBe(422)
  })

  it('stores a valid upload and returns the note with 200', async () => {
    const { store } = await makeCtx(true)
    const registrations = capture(store, true)
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', JSON.stringify({ data: PNG_BASE64, mediaType: 'image/png' })), res)
    expect(status()).toBe(200)
    const envelope = JSON.parse(body()) as { ok: boolean; value?: { note: string } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value?.note.startsWith('[image attachment {')).toBe(true)
    expect(store?.saved).toHaveLength(1)
  })

  it('serves a durable Markdown reference without the in-process id registry', async () => {
    const { store } = await makeCtx(true)
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${'b'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
    }
    store?.stored.set(String(ref.attachmentId), PNG_BYTES)
    expect(attachmentRefById(String(ref.attachmentId))).toBeUndefined()
    const registrations = capture(store, true)
    const { res, status } = makeRes()
    const markdown = attachmentMarkdown(ref)
    const path = /\(([^)]+)\)$/.exec(markdown)?.[1]
    await registrations[0].handler(makeReq('GET', undefined, path), res)
    expect(status()).toBe(200)
  })

  it('uses the attachment store canonical media type rather than URL metadata', async () => {
    const { store } = await makeCtx(true)
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${'9'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
    }
    store?.stored.set(String(ref.attachmentId), PNG_BYTES)
    if (store !== undefined) store.readRef = { ...ref, mediaType: 'image/jpeg' }
    const registrations = capture(store, true)
    const { res, status, headers } = makeRes()
    const path = /\(([^)]+)\)$/.exec(attachmentMarkdown(ref))?.[1]
    await registrations[0].handler(makeReq('GET', undefined, path), res)
    expect(status()).toBe(200)
    expect(headers()?.['content-type']).toBe('image/jpeg')
  })

  it('rejects a durable Markdown reference whose path and metadata disagree', async () => {
    const { store } = await makeCtx(true)
    const ref: ImageAttachmentRef = {
      attachmentId: `sha256:${'e'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
    }
    const markdown = attachmentMarkdown(ref).replace(`raw/${ref.attachmentId}`, `raw/sha256:${'f'.repeat(64)}`)
    const path = /\(([^)]+)\)$/.exec(markdown)?.[1]
    const registrations = capture(store, true)
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('GET', undefined, path), res)
    expect(status()).toBe(404)
  })

  it('answers a rejected payload with 422 and the structured error', async () => {
    const registrations = capture(undefined, true)
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', JSON.stringify({ data: PNG_BASE64, mediaType: 'image/bmp' })), res)
    expect(status()).toBe(422)
    const envelope = JSON.parse(body()) as { ok: boolean; error: { code: string } }
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('rejected')
  })

  it('answers a missing attachment service with 500', async () => {
    const registrations = capture(undefined, true)
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', JSON.stringify({ data: PNG_BASE64, mediaType: 'image/png' })), res)
    expect(status()).toBe(500)
    const envelope = JSON.parse(body()) as { ok: boolean; error: { code: string } }
    expect(envelope.error.code).toBe('internal')
  })
})

describe('registerAttachRoute capability route', () => {
  /** One fake GET request at the given URL. */
  const makeGet = (url: string): IncomingMessage => ({
    method: 'GET',
    url,
    [Symbol.asyncIterator]: async function* () {},
  } as unknown as IncomingMessage)

  /** One fake response collecting status/headers/body. */
  const makeRes = (): { res: ServerResponse; status: () => number; body: () => string } => {
    let status = 0
    let body = ''
    const res = {
      writeHead: (code: number) => { status = code },
      end: (chunk?: unknown) => {
        if (chunk !== undefined && chunk !== null) body += String(chunk)
      },
    } as unknown as ServerResponse
    return { res, status: () => status, body: () => body }
  }

  /** Register the route with the given probe and return the captured handler. */
  const captureWithProbe = (probe?: (sessionId: string) => Promise<{ acceptsImages: boolean; known: boolean }>) => {
    const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
    const webServer = { register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { registrations.push(row); return () => {} } }
    const ctx = { get: (key: string) => (key === 'webServer' ? webServer : undefined) }
    registerAttachRoute(ctx as unknown as Context, undefined, probe)
    return registrations
  }

  it('answers the probe verdict for the queried session', async () => {
    const probe = vi.fn(async (sessionId: string) => ({ acceptsImages: sessionId === 'vision-session', known: true }))
    const registrations = captureWithProbe(probe)
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeGet('/describe-image/capability?session=vision-session'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { acceptsImages: true, known: true } })
    expect(probe).toHaveBeenCalledWith('vision-session')
  })

  it('answers unknown-capability when no probe is registered', async () => {
    const registrations = captureWithProbe()
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeGet('/describe-image/capability?session=x'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { acceptsImages: false, known: false } })
  })

  it('answers unknown-capability when the session parameter is missing', async () => {
    const probe = vi.fn(async () => ({ acceptsImages: true, known: true }))
    const registrations = captureWithProbe(probe)
    const { res, body } = makeRes()
    await registrations[0].handler(makeGet('/describe-image/capability'), res)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { acceptsImages: false, known: false } })
    expect(probe).not.toHaveBeenCalled()
  })

  it('keeps raw-image GETs on the raw path', async () => {
    const registrations = captureWithProbe(async () => ({ acceptsImages: true, known: true }))
    const { res, status } = makeRes()
    await registrations[0].handler(makeGet('/describe-image/raw/sha256:missing'), res)
    expect(status()).toBe(404)
  })
})
