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

/** Self-contained rc.7-compatible Markdown attachment carrier returned by the host route. */
const DURABLE_MARKDOWN = '![图片](/describe-image/raw/sha256:cccc?ref=%7B%22attachmentId%22%3A%22sha256%3Acccc%22%2C%22mediaType%22%3A%22image%2Fpng%22%2C%22bytes%22%3A3%2C%22width%22%3A1%2C%22height%22%3A1%7D)'

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
  const original = vi.fn(async (_session: unknown, _text: string, _ids: readonly string[], _mode: string, _signal?: AbortSignal): Promise<unknown> => { log.push('original'); return undefined })
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: DURABLE_MARKDOWN } }), { status: 200 })))
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['release'])
    expect(prompt).toHaveBeenCalledTimes(1)
    const blocks = (prompt.mock.calls[0] as unknown as [{ type: string; text: string }[]])[0]
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('text')
    expect(blocks[0].text).toBe(`look\n${DURABLE_MARKDOWN}`)
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
    const prompt = vi.fn(async () => ({ ok: true }))
    let enabled = false
    installSendHook(face, () => enabled)
    // Off: passthrough.
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original'])
    // Flipped on between sends: the very next send is rewritten.
    enabled = true
    await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original', 'release'])
    expect(prompt).toHaveBeenCalledTimes(1)
    const blocks = (prompt.mock.calls[0] as unknown as [{ type: string; text: string }[]])[0]
    expect(blocks[0].type).toBe('text')
  })
})

describe('installSendHook capability gating', () => {
  it('passes image sends through untouched when the session model accepts images', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face, undefined, async () => true)
    await face.sendSession({ prompt, sessionId: 's1' } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original'])
    expect(prompt).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rewrites when the checker reports a text-only model', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: '![图片](/describe-image/raw/sha256:x)' } }), { status: 200 })))
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face, undefined, async () => false)
    await face.sendSession({ prompt, sessionId: 's1' } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['release'])
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('rewrites when the checker throws, failing closed to the legacy path', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: '![图片](/describe-image/raw/sha256:x)' } }), { status: 200 })))
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face, undefined, async () => { throw new Error('probe down') })
    await face.sendSession({ prompt, sessionId: 's1' } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['release'])
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('still honors the disabled switch ahead of the capability check', async () => {
    const { face, log } = makeConversation()
    const checker = vi.fn(async () => true)
    installSendHook(face, () => false, checker)
    await face.sendSession({ prompt: vi.fn(), sessionId: 's1' } as never, 'look', ['id1'], 'queue')
    expect(log).toEqual(['original'])
    expect(checker).not.toHaveBeenCalled()
  })
})
describe('installSendHook rc.8 signal and outcome contract', () => {
  it('forwards the AbortSignal and preserves the SubmitOutcome on the passthrough paths', async () => {
    const { face } = makeConversation()
    const outcome = { accepted: true }
    const original = face.sendSession = vi.fn(async (_session: unknown, _text: string, _ids: readonly string[], _mode: string, _signal?: AbortSignal) => outcome)
    installSendHook(face)
    const signal = new AbortController().signal
    const result = await face.sendSession({ prompt: vi.fn() } as never, 'hello', [], 'queue', signal)
    expect(result).toBe(outcome)
    expect(original).toHaveBeenCalledWith(expect.anything(), 'hello', [], 'queue', signal)
    const second = await face.sendSession({ prompt: vi.fn() } as never, 'hello', [], 'queue', signal)
    expect(second).toBe(outcome)
  })

  it('forwards the signal to the original when the model accepts images natively', async () => {
    const { face } = makeConversation()
    const original = face.sendSession
    installSendHook(face, undefined, async () => true)
    const signal = new AbortController().signal
    await face.sendSession({ prompt: vi.fn(), sessionId: 's1' } as never, 'look', ['id1'], 'queue', signal)
    expect(original).toHaveBeenCalledWith(expect.anything(), 'look', ['id1'], 'queue', signal)
  })

  it('forwards the signal into the session prompt on the rewritten path', async () => {
    stubFileReader('QUJD')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, value: { note: 'N', markdown: DURABLE_MARKDOWN } }), { status: 200 })))
    const { face, log } = makeConversation()
    const prompt = vi.fn(async () => ({ ok: true }))
    installSendHook(face)
    const signal = new AbortController().signal
    const outcome = await face.sendSession({ prompt } as never, 'look', ['id1'], 'queue', signal)
    expect(outcome).toEqual({ kind: 'success' })
    expect(log).toEqual(['release'])
    const call = prompt.mock.calls[0] as unknown as [unknown, unknown, AbortSignal]
    expect(call[2]).toBe(signal)
  })

  it('forwards the signal on the upload-shortfall fallback', async () => {
    const { face, log } = makeConversation()
    const original = face.sendSession
    face.draftImages = vi.fn(() => [])
    installSendHook(face)
    const signal = new AbortController().signal
    await face.sendSession({ prompt: vi.fn() } as never, 'look', ['id1'], 'queue', signal)
    expect(log).toEqual(['original'])
    expect(original).toHaveBeenCalledWith(expect.anything(), 'look', ['id1'], 'queue', signal)
  })
})
