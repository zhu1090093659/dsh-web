/** The short-lived semantic vision cache and the converged type-narrowing helpers it relies on. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { chatReply, FakeWebServer, jsonReply, PNG_BYTES, startMockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

/** A minimal PNG image representation for direct semantic-key and cache tests. */
function loadedImage(bytes: Buffer = PNG_BYTES): tool.LoadedImage {
  return { bytes, mimeType: 'image/png' }
}

const SPEC: tool.ResolvedConfig = {
  baseURL: 'https://api.example.com/v1',
  model: 'vision-1',
  apiKey: 'sk',
  apiKeyEnv: undefined,
  defaultPrompt: tool.DEFAULT_PROMPT,
  maxBytes: tool.DEFAULT_MAX_BYTES,
  maxOutputTokens: tool.DEFAULT_MAX_OUTPUT_TOKENS,
  timeoutMs: 60_000,
  apiStyle: 'chat-completions',
  thinking: undefined,
  renderImagePreview: tool.DEFAULT_RENDER_IMAGE_PREVIEW,
  interceptImageSend: tool.DEFAULT_INTERCEPT_IMAGE_SEND,
}

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-cache-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return path
}

async function boot(ctx: Context, baseURL: string): Promise<void> {
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { baseURL, model: 'vision-1', apiKey: 'sk-inline' })
}

function callDescribe(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('cache-vision-call'),
    name: 'describe_image',
    arguments: args,
  })
}

describe('semantic vision cache', () => {
  it('serves repeated calls for the same image and prompt from the cache without a second fetch', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Cached answer.')) })
    cleanup.push(server.close)
    const ctx = new Context()
  contexts.push(ctx)
    await boot(ctx, server.url)
    const path = await tempPng()

    const first = await callDescribe(ctx, { image: path, prompt: 'what is here?' })
    expect(first.isError).toBe(false)
    expect(server.requests).toHaveLength(1)

    const second = await callDescribe(ctx, { image: path, prompt: 'what is here?' })
    expect(second.isError).toBe(false)
    if (!first.isError && !second.isError) {
      expect(second.value).toEqual(first.value)
    }
    // The second identical call is served from cache, no new request.
    expect(server.requests).toHaveLength(1)
  })

  it('misses the cache for a different prompt on the same image', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = new Context()
  contexts.push(ctx)
    await boot(ctx, server.url)
    const path = await tempPng()

    await callDescribe(ctx, { image: path, prompt: 'first prompt' })
    await callDescribe(ctx, { image: path, prompt: 'second prompt' })
    expect(server.requests).toHaveLength(2)
  })

  it('expires entries after the TTL', () => {
    const cache = tool.createVisionCache({ ttlMs: 5, maxEntries: 8 })
    cache.set('k', 'v')
    expect(cache.get('k')).toBe('v')
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cache.get('k')).toBeUndefined()
        resolve()
      }, 15)
    })
  })

  it('caps capacity and evicts the oldest entry first', () => {
    const cache = tool.createVisionCache({ ttlMs: 10_000, maxEntries: 2 })
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('2')
    expect(cache.get('c')).toBe('3')
  })

  it('tracks hits and misses', () => {
    const cache = tool.createVisionCache({ ttlMs: 10_000, maxEntries: 8 })
    expect(cache.get('missing')).toBeUndefined()
    cache.set('hit', 'v')
    expect(cache.get('hit')).toBe('v')
    expect(cache.hits).toBe(1)
    expect(cache.misses).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('semantic request key', () => {
  it('distinguishes image bytes and prompt, but not ordering-irrelevant fields', () => {
    const a = tool.semanticRequestKey(SPEC, 'q', loadedImage(PNG_BYTES))
    const same = tool.semanticRequestKey(SPEC, 'q', loadedImage())
    const otherPrompt = tool.semanticRequestKey(SPEC, 'r', loadedImage())
    const otherModel = tool.semanticRequestKey({ ...SPEC, model: 'vision-2' }, 'q', loadedImage())
    const otherThinking = tool.semanticRequestKey({ ...SPEC, thinking: 'off' }, 'q', loadedImage())
    const otherImage = tool.semanticRequestKey(SPEC, 'q', loadedImage(Buffer.from('different bytes')))
    expect(a).toBe(same)
    expect(a).not.toBe(otherPrompt)
    expect(a).not.toBe(otherModel)
    expect(a).not.toBe(otherThinking)
    expect(a).not.toBe(otherImage)
  })
})

describe('parseImageAttachmentRef narrowing', () => {
  const valid = JSON.stringify({ attachmentId: `sha256:${"c".repeat(64)}`, mediaType: 'image/png', bytes: PNG_BYTES.length, width: 1, height: 1 })

  it('narrows a well-formed reference to the typed storage ref', () => {
    const ref = tool.parseImageAttachmentRef(valid)
    expect(ref.attachmentId).toBe(`sha256:${"c".repeat(64)}`)
    expect(ref.mediaType).toBe('image/png')
    expect(ref.bytes).toBe(PNG_BYTES.length)
    expect(ref.width).toBe(1)
    expect(ref.height).toBe(1)
  })

  it('accepts the complete attachment note carrier', () => {
    const ref = tool.parseImageAttachmentRef(`[image attachment ${valid}]`)
    expect(ref).toMatchObject({ attachmentId: `sha256:${'c'.repeat(64)}`, mediaType: 'image/png' })
  })

  it('rejects malformed references without narrowing', () => {
    const bad = [
      '{not json',
      '{}',
      JSON.stringify({ attachmentId: 'x', mediaType: 'image/png', bytes: 1, width: 1, height: 'tall' }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'video/mp4', bytes: 1, width: 1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 0, width: 1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1, width: -1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 42 }),
    ]
    for (const raw of bad) {
      expect(() => tool.parseImageAttachmentRef(raw)).toThrow(/not a valid attachment reference/)
    }
  })
})