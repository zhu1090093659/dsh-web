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

/** One fake conversation surface recording what the hook did with it. */
function makeConversation() {
  const original = vi.fn(async (_session: unknown, _text: string, _ids: readonly string[], _mode: string) => { log.push('original') })
  const log: string[] = []
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

  it('rewrites an image-bearing send into a text prompt carrying the reference', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: '![图片](/describe-image/raw/sha256:x)' } }), { status: 200 })))
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['release'])
    expect(prompt).toHaveBeenCalledTimes(1)
    const blocks = (prompt.mock.calls[0] as unknown as [{ type: string; text: string }[]])[0]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toContain('look')
    expect(blocks[0].text).toContain('![图片](/describe-image/raw/sha256:x)')
  })

  it('falls back to the original send when the upload fails', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { message: 'boom' } }), { status: 422 })))
    const { face, log } = makeConversation()
    installSendHook(face)
    await face.sendSession({ prompt: vi.fn() } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original'])
  })

  it('falls back when a draft image id no longer resolves', async () => {
    const { face, log } = makeConversation()
    face.draftImages = vi.fn(() => [])
    installSendHook(face)
    await face.sendSession({ prompt: vi.fn() } as never, 'look', ['gone'], 'queue')
    expect(log).toEqual(['original'])
  })

  it('is idempotent across repeated installs', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: 'R' } }), { status: 200 })))
    const { face } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(prompt).toHaveBeenCalledTimes(1)
  })
})
