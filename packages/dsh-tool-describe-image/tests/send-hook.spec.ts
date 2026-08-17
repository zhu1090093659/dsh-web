/**
 * Send-interception tests: the hook rewrites image-bearing sends into
 * describe-image reference text, falls back to the original send when the
 * upload cannot complete, and stays idempotent. FileReader is stubbed; fetch
 * is stubbed for the attach route.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installSendHook } from '../src/client/send-hook.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Minimal FileReader stub: resolves every read to a fixed base64 payload. */
function stubFileReader(payload: string): void {
  vi.stubGlobal('FileReader', class {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    result: string | null = null
    readAsDataURL(_file: File): void {
      this.result = `data:image/png;base64,${payload}`
      queueMicrotask(() => this.onload?.())
    }
  })
}

function imageCapabilityError(): Error {
  return new Error('conversation.send failed: attachment-error: Model "text-only" does not support image input.')
}

/** One fake conversation surface recording what the hook did with it. */
function makeConversation(originalError?: unknown) {
  const log: string[] = []
  const original = vi.fn(async (_session: unknown, _text: string, _ids: readonly string[], _mode: string) => {
    log.push('original')
    if (originalError !== undefined) throw originalError
  })
  const face = {
    send: vi.fn(async () => { log.push('send') }),
    sendSession: original,
    draftImages: vi.fn((ids: readonly string[]) => ids.map(id => ({

      id,

      file: new File([new Uint8Array(3)], 'x.png', { type: 'image/png' }),

    }))),
    releaseDraftImage: vi.fn(() => { log.push('release') }),
  }
  return { face, log }
}

describe('installSendHook', () => {
  it('delegates image-free sends to the original method', async () => {
    const { face, log } = makeConversation()
    installSendHook(face)
    await face.sendSession({ prompt: vi.fn() } as never, 'hello', [], 'queue')
    expect(log).toEqual(['original'])
  })

  it('keeps image sends on the native path when the model accepts them', async () => {
    stubFileReader('QUJD')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { note: 'N', markdown: 'R' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))

    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')

    expect(log).toEqual(['original'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(face.releaseDraftImage).not.toHaveBeenCalled()
  })

  it('rewrites an image-bearing send into a text prompt carrying the reference', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: '![图片](/describe-image/raw/sha256:x)' } }), { status: 200 })))
    const { face, log } = makeConversation(imageCapabilityError())
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original', 'release'])
    expect(prompt).toHaveBeenCalledTimes(1)
    const blocks = (prompt.mock.calls[0] as unknown as [{ type: string; text: string }[]])[0]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('look')
    expect(blocks[0].text).toContain('![图片](/describe-image/raw/sha256:x)')
  })

  it('falls back for the host structured image-capability rejection', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { note: 'N', markdown: 'R' },
    }), { status: 200 })))
    const originalError = Object.assign(new Error('image capability rejected'), {
      details: { reason: 'MODEL_DOES_NOT_SUPPORT_IMAGES' },
    })
    const { face, log } = makeConversation(originalError)
    const prompt = vi.fn(async () => ({ ok: true }))

    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')

    expect(log).toEqual(['original', 'release'])
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('rethrows unrelated attachment errors without describe-image fallback', async () => {
    stubFileReader('QUJD')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      value: { note: 'N', markdown: 'R' },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const originalError = new Error('conversation.send failed: attachment-error: Attachment summary mismatch.')
    const { face } = makeConversation(originalError)
    const prompt = vi.fn(async () => ({ ok: true }))

    installSendHook(face)

    await expect(face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')).rejects.toBe(originalError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(face.releaseDraftImage).not.toHaveBeenCalled()
  })

  it('preserves the original capability error when the fallback upload fails', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { message: 'boom' } }), { status: 422 })))
    const originalError = imageCapabilityError()
    const { face, log } = makeConversation(originalError)
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)

    await expect(face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')).rejects.toBe(originalError)

    expect(log).toEqual(['original'])
    expect(prompt).not.toHaveBeenCalled()
    expect(face.releaseDraftImage).not.toHaveBeenCalled()
  })

  it('preserves the capability error when a draft image id no longer resolves', async () => {
    const originalError = imageCapabilityError()
    const { face, log } = makeConversation(originalError)
    face.draftImages = vi.fn(() => [])
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)

    await expect(face.sendSession({ prompt } as never, 'look', ['gone'], 'queue')).rejects.toBe(originalError)

    expect(log).toEqual(['original'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prompt).not.toHaveBeenCalled()
    expect(face.releaseDraftImage).not.toHaveBeenCalled()
  })

  it('is idempotent across repeated installs', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: 'R' } }), { status: 200 })))
    const { face } = makeConversation(imageCapabilityError())
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('passes image-bearing sends through untouched when the live switch is off', async () => {
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face, () => false)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    // The original send ran; no rewrite, no draft release, no prompt call.
    expect(log).toEqual(['original'])
    expect(prompt).not.toHaveBeenCalled()
    expect(face.releaseDraftImage).not.toHaveBeenCalled()
  })

  it('re-reads the live switch on every send', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: 'R' } }), { status: 200 })))
    const { face, log } = makeConversation()
    face.sendSession
      .mockImplementationOnce(async () => { log.push('original') })
      .mockImplementationOnce(async () => {
        log.push('original')
        throw imageCapabilityError()
      })
    const prompt = vi.fn(async () => ({ ok: true }))
    let enabled = false
    installSendHook(face, () => enabled)
    // Off: passthrough.
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original'])
    // Flipped on between sends: the very next send is rewritten.
    enabled = true
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original', 'original', 'release'])
    expect(prompt).toHaveBeenCalledTimes(1)
    const blocks = (prompt.mock.calls[0] as unknown as [{ type: string; text: string }[]])[0]
    expect(blocks[0].type).toBe('text')
  })
})
