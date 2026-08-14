/**
 * Browser-half pure tests: draft splicing math, client-side admission, and
 * the upload client against a stubbed fetch. DOM-dependent pieces (FileReader)
 * stay untested here — they are thin browser glue over the covered paths.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { admitPickedImage, insertNoteIntoDraft, uploadImageForDescribe } from '../src/client/attach.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('insertNoteIntoDraft', () => {
  it('inserts into an empty draft', () => {
    expect(insertNoteIntoDraft('', '[image attachment {}]')).toBe('[image attachment {}]')
  })

  it('inserts at the end of a draft', () => {
    expect(insertNoteIntoDraft('look at this', '[image attachment {}]')).toBe('look at this [image attachment {}]')
  })

  it('inserts at the caret with one space on each side', () => {
    expect(insertNoteIntoDraft('a b', '[image attachment {}]', 1)).toBe('a [image attachment {}] b')
  })

  it('does not add a space right after leading whitespace', () => {
    expect(insertNoteIntoDraft('  x', '[image attachment {}]', 2)).toBe('  [image attachment {}] x')
  })

  it('does not add a space right before trailing whitespace', () => {
    expect(insertNoteIntoDraft('x  ', '[image attachment {}]', 1)).toBe('x [image attachment {}]  ')
  })

  it('is a no-op for an empty note', () => {
    expect(insertNoteIntoDraft('draft', '')).toBe('draft')
  })

  it('clamps an out-of-range caret to the draft ends', () => {
    expect(insertNoteIntoDraft('draft', 'N', -5)).toBe('N draft')
    expect(insertNoteIntoDraft('draft', 'N', 99)).toBe('draft N')
  })
})

describe('admitPickedImage', () => {
  it('accepts the four supported image types', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(admitPickedImage(new File([new Uint8Array(4)], 'x', { type }))).toEqual({ ok: true })
    }
  })

  it('rejects other types', () => {
    expect(admitPickedImage(new File([new Uint8Array(4)], 'x.bmp', { type: 'image/bmp' }))).toEqual({ ok: false, reason: 'type' })
  })

  it('rejects files above the byte bound', () => {
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    expect(admitPickedImage(big)).toEqual({ ok: false, reason: 'size' })
  })
})

describe('uploadImageForDescribe', () => {
  it('posts base64, type, and name and returns the note', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body.data).toBe('QUJD')
      expect(body.mediaType).toBe('image/png')
      expect(body.name).toBe('pic.png')
      return new Response(JSON.stringify({ ok: true, value: { note: '[image attachment {}]', markdown: '![图片](/describe-image/raw/sha256:x)' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await uploadImageForDescribe('QUJD', 'image/png', 'pic.png')
    expect(outcome).toEqual({ ok: true, note: '[image attachment {}]', markdown: '![图片](/describe-image/raw/sha256:x)' })
    expect(fetchMock).toHaveBeenCalledWith('/describe-image/attach', expect.objectContaining({ method: 'POST' }))
  })

  it('omits the name when absent', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: { note: 'N' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await uploadImageForDescribe('QUJD', 'image/png')
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>
    expect('name' in body).toBe(false)
  })

  it('surfaces the server rejection message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'rejected', message: 'too big' } }), { status: 422 })))
    const outcome = await uploadImageForDescribe('QUJD', 'image/png')
    expect(outcome).toEqual({ ok: false, message: 'too big' })
  })

  it('maps a network failure to a stable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch') }))
    const outcome = await uploadImageForDescribe('QUJD', 'image/png')
    expect(outcome).toEqual({ ok: false, message: 'network-failed' })
  })

  it('maps a non-JSON response to a stable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    const outcome = await uploadImageForDescribe('QUJD', 'image/png')
    expect(outcome).toEqual({ ok: false, message: 'bad-response' })
  })

  it('maps an ok envelope without a note to a stable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: {} }), { status: 200 })))
    const outcome = await uploadImageForDescribe('QUJD', 'image/png')
    expect(outcome).toEqual({ ok: false, message: 'bad-response' })
  })
})
