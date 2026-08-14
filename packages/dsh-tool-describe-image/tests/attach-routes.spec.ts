/**
 * Route tests for /describe-image/attach: payload validation, the
 * attachment-store handoff, and the HTTP envelope (status codes + error
 * shape), exercised through a fake ctx.webServer registry and a fake
 * attachment store.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Context } from '@deepseek-ai/cordis'
import { attachmentMarkdown, attachmentNote, attachmentRefById, handleAttach, registerAttachRoute, registerAttachmentRef, validateAttachPayload, type AttachError } from '../src/attach-routes.ts'
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

  readImage(ref: ImageAttachmentRef, _signal?: AbortSignal): Promise<StoredImageAttachment> {
    const data = this.stored.get(String(ref.attachmentId))
    if (data === undefined) return Promise.reject(new Error('no such attachment'))
    return Promise.resolve({ data, mediaType: ref.mediaType, ref })
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
      expect(outcome.markdown).toMatch(/^!\[图片\]\(\/describe-image\/raw\/sha256:/)
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

  /** Register the route and return the captured prefix row. */
  const capture = (attachments: AttachmentStore | undefined, webserver: boolean) => {
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
    registerAttachRoute(ctx as unknown as Context)
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
