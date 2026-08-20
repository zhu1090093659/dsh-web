import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import { AttachmentError, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { attachmentMarkdown, attachmentRefById, handleAttach, registerAttachmentRef, safeDecodeUriComponent } from '../src/attach-routes.ts'
import { anthropicReply, chatReply, FakeWebServer, jsonReply, PNG_BYTES, rawReply, responsesReply, sentAnthropicContent, sentContent, sentInputContent, startMockServer } from './mock-server.ts'

/** In-memory attachment store so the attachment-reference input path is observable. */
class FakeAttachments extends AttachmentStore {
  readonly stored = new Map<string, Buffer | 'boom'>()

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
    const id = `sha256:${'c'.repeat(64)}`
    this.stored.set(id, Buffer.from(input.data))
    return Promise.resolve({
      attachmentId: id as unknown as ImageAttachmentRef['attachmentId'],
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
    })
  }

  readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
    signal?.throwIfAborted()
    const data = this.stored.get(String(ref.attachmentId))
    if (data === undefined) {
      return Promise.reject(new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND'))
    }
    if (data === 'boom') return Promise.reject(new Error('integrity failure'))
    return Promise.resolve({ ref, data })
  }
}

/** In-memory credential provider so key resolution through the seam is observable. */
class FakeCredentials extends CredentialProvider {
  private readonly values: Map<string, string>
  constructor(ctx: Context, seed: Record<string, string> = {}) {
    super(ctx)
    this.values = new Map(Object.entries(seed))
  }

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(ref)
    return Promise.resolve(value === undefined ? undefined : { value, source: 'memory' })
  }

  describe(ref: CredentialRef): Promise<CredentialInfo> {
    const configured = this.values.has(ref)
    return Promise.resolve({ configured, writable: true, ...configured ? { source: 'memory' } : {} })
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    this.values.set(ref, value)
    return Promise.resolve()
  }

  unset(ref: CredentialRef): Promise<void> {
    this.values.delete(ref)
    return Promise.resolve()
  }
}

const savedEnv = new Map<string, string | undefined>()
const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []

const BASE_CONFIG = { baseURL: 'http://127.0.0.1:9/v1/', model: 'vision-1' }

/** Mount the real plugin body with the given overrides; `noInlineKey` starts without the default inline key. */
async function setup(
  over: Partial<tool.Config> = {},
  options: { seed?: Record<string, string>; noInlineKey?: boolean; attachments?: boolean } = {},
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  if (options.seed !== undefined) await ctx.plugin(FakeCredentials, options.seed)
  if (options.attachments === true) await ctx.plugin(FakeAttachments)
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {
    ...BASE_CONFIG,
    ...options.noInlineKey === true ? {} : { apiKey: 'sk-inline' },
    ...over,
  })
  return ctx
}

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return path
}

function callDescribe(ctx: Context, args: unknown, signal?: AbortSignal) {
  return ctx.tools.execute({
    signal: signal ?? new AbortController().signal,
    callId: CallId('vision-call'),
    name: 'describe_image',
    arguments: args,
  })
}

/** Dispose one mounted context early so the mountOnce guard releases the package for the next setup. */
async function teardown(ctx: Context): Promise<void> {
  const at = contexts.indexOf(ctx)
  if (at !== -1) contexts.splice(at, 1)
  await Promise.resolve(ctx.fiber.dispose())
}

function errorText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

beforeEach(() => {
  savedEnv.set('VISION_API_KEY', process.env.VISION_API_KEY)
  delete process.env.VISION_API_KEY
})

afterEach(async () => {
  const env = savedEnv.get('VISION_API_KEY')
  if (env === undefined) delete process.env.VISION_API_KEY
  else process.env.VISION_API_KEY = env
  savedEnv.clear()
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

describe('schema and call view', () => {
  it('registers describe_image with an image argument and an optional prompt', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'describe_image')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['image', 'prompt'])
    expect((props.image as { type?: string }).type).toBe('string')
  })

  it('renders a read card with the file location for local paths and none for URLs', () => {
    expect(tool.describeImageCallView({ image: '/tmp/pixel.png' })).toEqual({
      card: 'generic',
      title: 'Describe image',
      kind: 'read',
      rawInput: { image: '/tmp/pixel.png' },
      locations: [{ path: '/tmp/pixel.png' }],
    })
    expect(tool.describeImageCallView({ image: 'https://example.com/p.png' })).toEqual({
      card: 'generic',
      title: 'Describe image',
      kind: 'read',
      rawInput: { image: 'https://example.com/p.png' },
    })
  })
})

describe('successful descriptions', () => {
  it('describes a local file with the default prompt and returns the canonical value', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('A red square.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toEqual({
      text: 'A red square.',
      model: 'vision-1',
      image: path,
      mimeType: 'image/png',
      bytes: PNG_BYTES.length,
    })

    const request = server.request(0)
    expect(request.authorization).toBe('Bearer sk-inline')
    expect(request.path).toBe('/chat/completions')
    const body = request.body as { model?: unknown; max_tokens?: unknown }
    expect(body.model).toBe('vision-1')
    expect(body.max_tokens).toBe(tool.DEFAULT_MAX_OUTPUT_TOKENS)
    const [textPart, imagePart] = sentContent(request) as Array<{ type?: string; text?: string; image_url?: { url?: string } }>
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_PROMPT })
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('forwards a caller prompt and the configured output cap', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('Yes.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, maxOutputTokens: 7 })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'Is there text in this image?' })
    expect(result.isError).toBe(false)
    const body = server.request(0).body as { max_tokens?: unknown }
    expect(body.max_tokens).toBe(7)
    const [textPart] = sentContent(server.request(0)) as Array<{ text?: string }>
    expect(textPart?.text).toBe('Is there text in this image?')
  })

  it('strips the model thinking suffix and maps it to thinking.type', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const path = await tempPng()

    const inheritCtx = await setup({ baseURL: server.url })
    const inheritResult = await callDescribe(inheritCtx, { image: path })
    expect(inheritResult.isError).toBe(false)
    expect((server.request(0).body as { model?: unknown; thinking?: unknown }).model).toBe('vision-1')
    expect((server.request(0).body as { thinking?: unknown }).thinking).toBeUndefined()
    await teardown(inheritCtx)

    const offCtx = await setup({ baseURL: server.url, model: 'vision-1:off' })
    const offResult = await callDescribe(offCtx, { image: path })
    expect(offResult.isError).toBe(false)
    expect((server.request(1).body as { model?: unknown; thinking?: unknown }).model).toBe('vision-1')
    expect((server.request(1).body as { thinking?: unknown }).thinking).toEqual({ type: 'disabled' })
    await teardown(offCtx)

    const highCtx = await setup({ baseURL: server.url, model: 'vision-1:high' })
    const highResult = await callDescribe(highCtx, { image: path })
    expect(highResult.isError).toBe(false)
    if (!highResult.isError) expect(highResult.value).toMatchObject({ model: 'vision-1' })
    expect((server.request(2).body as { model?: unknown; thinking?: unknown }).model).toBe('vision-1')
    expect((server.request(2).body as { thinking?: unknown }).thinking).toEqual({ type: 'enabled' })
  })

  it('downloads an http(s) image when given a URL', async () => {
    const server = await startMockServer((request, res) => {
      if (request.path === '/img.png') rawReply(res, 200, PNG_BYTES, 'image/png')
      else jsonReply(res, 200, chatReply('Downloaded.'))
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })

    const result = await callDescribe(ctx, { image: `${server.url}/img.png` })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Downloaded.', image: `${server.url}/img.png`, mimeType: 'image/png' })
    const [, imagePart] = sentContent(server.request(1)) as Array<{ image_url?: { url?: string } }>
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })
})

describe('Responses API style', () => {
  it('posts /responses with input parts and max_output_tokens when configured', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, responsesReply('Via responses.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'responses' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Via responses.', model: 'vision-1', mimeType: 'image/png' })

    const request = server.request(0)
    expect(request.authorization).toBe('Bearer sk-inline')
    expect(request.path).toBe('/responses')
    const body = request.body as { model?: unknown; max_output_tokens?: unknown; max_tokens?: unknown }
    expect(body.model).toBe('vision-1')
    expect(body.max_output_tokens).toBe(tool.DEFAULT_MAX_OUTPUT_TOKENS)
    expect(body.max_tokens).toBeUndefined()
    const [textPart, imagePart] = sentInputContent(request) as Array<{ type?: string; text?: string; image_url?: string }>
    expect(textPart).toEqual({ type: 'input_text', text: tool.DEFAULT_PROMPT })
    expect(imagePart?.type).toBe('input_image')
    expect(imagePart?.image_url).toMatch(/^data:image\/png;base64,/)
  })

  it('forwards a caller prompt and the configured output cap in the responses body', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, responsesReply('Yes.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'responses', maxOutputTokens: 7 })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'Is there text in this image?' })
    expect(result.isError).toBe(false)
    const body = server.request(0).body as { max_output_tokens?: unknown }
    expect(body.max_output_tokens).toBe(7)
    const [textPart] = sentInputContent(server.request(0)) as Array<{ text?: string }>
    expect(textPart?.text).toBe('Is there text in this image?')
  })

  it('maps the model thinking suffix to reasoning.effort in the responses body', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, responsesReply('ok')) })
    cleanup.push(server.close)
    const path = await tempPng()

    const inheritCtx = await setup({ baseURL: server.url, apiStyle: 'responses' })
    await callDescribe(inheritCtx, { image: path })
    expect((server.request(0).body as { reasoning?: unknown }).reasoning).toBeUndefined()
    await teardown(inheritCtx)

    const offCtx = await setup({ baseURL: server.url, apiStyle: 'responses', model: 'vision-1:off' })
    await callDescribe(offCtx, { image: path })
    expect((server.request(1).body as { reasoning?: unknown }).reasoning).toEqual({ effort: 'none' })
    await teardown(offCtx)

    const highCtx = await setup({ baseURL: server.url, apiStyle: 'responses', model: 'vision-1:high' })
    await callDescribe(highCtx, { image: path })
    expect((server.request(2).body as { reasoning?: unknown }).reasoning).toEqual({ effort: 'high' })
  })

  it('joins every output_text part of the first assistant message', async () => {
    const server = await startMockServer((_request, res) => {
      jsonReply(res, 200, {
        output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Part one.' }, { type: 'output_text', text: 'Part two.' }] },
        ],
      })
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'responses' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Part one.\nPart two.' })
  })

  it('rejects invalid JSON, missing output, and non-string output text', async () => {
    const cases: Array<[string, unknown]> = [
      ['invalid JSON', 'not json'],
      ['missing output', {}],
      ['non-string output text', responsesReply(42)],
      ['no output_text part', { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] }],
    ]
    for (const [label, reply] of cases) {
      const server = await startMockServer((_request, res) => { rawReply(res, 200, typeof reply === 'string' ? reply : JSON.stringify(reply), 'application/json') })
      cleanup.push(server.close)
      const ctx = await setup({ baseURL: server.url, apiStyle: 'responses' })
      const path = await tempPng()

      const result = await callDescribe(ctx, { image: path })
      expect(result.isError, `expected rejection for ${label}`).toBe(true)
    }
  })

  it('never follows a redirect on the responses request', async () => {
    const target = await startMockServer((_request, res) => { jsonReply(res, 200, responsesReply('should not be reached')) })
    cleanup.push(target.close)
    const server = await startMockServer((_request, res) => {
      res.writeHead(302, { location: `${target.url}/responses` })
      res.end()
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'responses' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(target.requests).toHaveLength(0)
  })
})

describe('Anthropic Messages API style', () => {
  it('posts /v1/messages with x-api-key and anthropic-version headers and parses the text block', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, anthropicReply('Via anthropic.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'anthropic-messages' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Via anthropic.', model: 'vision-1', mimeType: 'image/png' })

    const request = server.request(0)
    expect(request.authorization).toBeUndefined()
    expect(request.xApiKey).toBe('sk-inline')
    expect(request.anthropicVersion).toBe('2023-06-01')
    expect(request.path).toBe('/v1/messages')
    const body = request.body as { model?: unknown; max_tokens?: unknown; max_output_tokens?: unknown }
    expect(body.model).toBe('vision-1')
    expect(body.max_tokens).toBe(tool.DEFAULT_MAX_OUTPUT_TOKENS)
    expect(body.max_output_tokens).toBeUndefined()
    const [imagePart, textPart] = sentAnthropicContent(request) as Array<{ type?: string; text?: string; source?: { type?: string; media_type?: string; data?: string } }>
    expect(imagePart?.type).toBe('image')
    expect(imagePart?.source?.type).toBe('base64')
    expect(imagePart?.source?.media_type).toBe('image/png')
    expect(imagePart?.source?.data).toBe(PNG_BYTES.toString('base64'))
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_PROMPT })
  })

  it('preserves provider paths and normalizes /v1 roots and complete endpoints', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, anthropicReply('normalized')) })
    cleanup.push(server.close)
    const path = await tempPng()

    const providerCtx = await setup({ baseURL: `${server.url}/zen/go`, apiStyle: 'anthropic-messages' })
    expect((await callDescribe(providerCtx, { image: path })).isError).toBe(false)
    await teardown(providerCtx)

    const apiRootCtx = await setup({ baseURL: `${server.url}/v1`, apiStyle: 'anthropic-messages' })
    expect((await callDescribe(apiRootCtx, { image: path })).isError).toBe(false)
    await teardown(apiRootCtx)

    const endpointCtx = await setup({ baseURL: `${server.url}/v1/messages`, apiStyle: 'anthropic-messages' })
    expect((await callDescribe(endpointCtx, { image: path })).isError).toBe(false)

    expect(server.requests.map(request => request.path)).toEqual([
      '/zen/go/v1/messages',
      '/v1/messages',
      '/v1/messages',
    ])
  })

  it('forwards a caller prompt and the configured output cap in the anthropic body', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, anthropicReply('Yes.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'anthropic-messages', maxOutputTokens: 7 })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'Is there text in this image?' })
    expect(result.isError).toBe(false)
    const body = server.request(0).body as { max_tokens?: unknown }
    expect(body.max_tokens).toBe(7)
    const parts = sentAnthropicContent(server.request(0)) as Array<{ type?: string; text?: string }>
    const textPart = parts.find(part => part.type === 'text')
    expect(textPart?.text).toBe('Is there text in this image?')
  })

  it('joins every text block and skips thinking blocks', async () => {
    const server = await startMockServer((_request, res) => {
      jsonReply(res, 200, {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private reasoning' },
          { type: 'text', text: 'Part one.' },
          { type: 'text', text: 'Part two.' },
        ],
      })
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'anthropic-messages' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'Part one.\nPart two.' })
  })

  it('rejects invalid JSON, missing content, and non-string text blocks', async () => {
    const cases: Array<[string, unknown]> = [
      ['invalid JSON', 'not json'],
      ['missing content', {}],
      ['no text block', { type: 'message', role: 'assistant', content: [{ type: 'thinking', thinking: 'x' }] }],
      ['non-string text', { type: 'message', role: 'assistant', content: [{ type: 'text', text: 42 }] }],
    ]
    for (const [label, reply] of cases) {
      const server = await startMockServer((_request, res) => { rawReply(res, 200, typeof reply === 'string' ? reply : JSON.stringify(reply), 'application/json') })
      cleanup.push(server.close)
      const ctx = await setup({ baseURL: server.url, apiStyle: 'anthropic-messages' })
      const path = await tempPng()

      const result = await callDescribe(ctx, { image: path })
      expect(result.isError, `expected rejection for ${label}`).toBe(true)
    }
  })

  it('never follows a redirect on the anthropic-messages request', async () => {
    const target = await startMockServer((_request, res) => { jsonReply(res, 200, anthropicReply('should not be reached')) })
    cleanup.push(target.close)
    const server = await startMockServer((_request, res) => {
      res.writeHead(302, { location: `${target.url}/v1/messages` })
      res.end()
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, apiStyle: 'anthropic-messages' })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(target.requests).toHaveLength(0)
  })
})

describe('API key resolution', () => {
  it('resolves the key through the credential seam when no inline key is set', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { noInlineKey: true, seed: { VISION_API_KEY: 'sk-seam' } })
    const path = await tempPng()

    await callDescribe(ctx, { image: path })
    expect(server.request(0).authorization).toBe('Bearer sk-seam')
  })

  it('resolves the reference from the launch environment when the seam is absent', async () => {
    process.env.VISION_API_KEY = 'sk-env'
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { noInlineKey: true })
    const path = await tempPng()

    await callDescribe(ctx, { image: path })
    expect(server.request(0).authorization).toBe('Bearer sk-env')
  })

  it('fails with a credential-free message when no key source is configured', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { noInlineKey: true })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('describe-image: no API key')
    expect(server.requests).toHaveLength(0)
  })

  it('fails when the seam is composed but the reference is unconfigured', async () => {
    const ctx = await setup({}, { seed: {} })
    await expect(tool.resolveApiKey(ctx, tool.resolveConfig({ baseURL: 'https://x', model: 'm' })))
      .rejects.toThrow(/describe-image: no API key/)
  })

  it('ignores an empty ambient environment value and an absent reference', async () => {
    process.env.VISION_API_KEY = ''
    const ctx = await setup({}, { noInlineKey: true })
    await expect(tool.resolveApiKey(ctx, tool.resolveConfig({ baseURL: 'https://x', model: 'm' })))
      .rejects.toThrow(/describe-image: no API key/)
    await expect(tool.resolveApiKey(ctx, { ...tool.resolveConfig({ baseURL: 'https://x', model: 'm' }), apiKeyEnv: undefined }))
      .rejects.toThrow(/describe-image: no API key; set apiKey, store VISION_API_KEY/)
  })
})

describe('input bounds', () => {
  it('rejects an oversized local file before any vision request', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, maxBytes: 4 })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('above the 4-byte bound')
    expect(server.requests).toHaveLength(0)
  })

  it('rejects a downloaded image above the byte bound mid-stream', async () => {
    const server = await startMockServer((request, res) => {
      if (request.path === '/big.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.alloc(200, 0x89))
      } else {
        jsonReply(res, 200, chatReply('ok'))
      }
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, maxBytes: 100 })

    const result = await callDescribe(ctx, { image: `${server.url}/big.png` })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('exceeds the 100-byte bound')
    expect(server.requests).toHaveLength(1)
  })

  it('rejects a downloaded image whose declared content length exceeds the bound', async () => {
    const server = await startMockServer((request, res) => {
      if (request.path === '/big.png') {
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': '99999' })
        res.end(PNG_BYTES)
      } else {
        jsonReply(res, 200, chatReply('ok'))
      }
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, maxBytes: 100 })

    const result = await callDescribe(ctx, { image: `${server.url}/big.png` })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('image is 99999 bytes, above the 100-byte bound')
  })

  it('rejects an empty image file', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })
    const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'empty.png')
    await writeFile(path, '')

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('image is empty')
    expect(server.requests).toHaveLength(0)
  })

  it('rejects an unsupported media type', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })
    const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const path = join(dir, 'notes.txt')
    await writeFile(path, 'plain text, not an image')

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('unsupported image type')
    expect(server.requests).toHaveLength(0)
  })

  it('rejects empty, directory, and non-http(s) URL inputs', async () => {
    const ctx = await setup()
    const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))

    for (const image of ['', '   ', `file://${dir}/p.png`, 'ftp://example.com/p.png', dir]) {
      const result = await callDescribe(ctx, { image })
      expect(result.isError, `expected rejection for ${JSON.stringify(image)}`).toBe(true)
    }
  })

  it('reports a failed image download with the HTTP status', async () => {
    const server = await startMockServer((_request, res) => { res.writeHead(404).end() })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })

    const result = await callDescribe(ctx, { image: `${server.url}/missing.png` })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('image fetch returned HTTP 404')
  })
})

describe('safeDecodeUriComponent', () => {
  it('decodes valid input and returns null for malformed percent-encoding', () => {
    expect(safeDecodeUriComponent('sha256%3Aabc')).toBe('sha256:abc')
    expect(safeDecodeUriComponent('%E0%A4%A')).toBeNull()
    expect(safeDecodeUriComponent('%')).toBeNull()
  })
})

describe('attachment references', () => {
  const ref = JSON.stringify({
    attachmentId: `sha256:${'c'.repeat(64)}`,
    mediaType: 'image/png',
    bytes: PNG_BYTES.length,
    width: 1,
    height: 1,
  })

  async function seedAttachment(bytes: Buffer): Promise<Context> {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('From attachment.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { attachments: true })
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(`sha256:${'c'.repeat(64)}`, bytes)
    return ctx
  }

  it('describes a stored attachment addressed by its bare id through the registry', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('ok')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { attachments: true })
    registerAttachmentRef({
      attachmentId: `sha256:${'a'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
    })
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(`sha256:${'a'.repeat(64)}`, PNG_BYTES)

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('bare-id-attachment'),
      name: 'describe_image',
      arguments: { image: `sha256:${'a'.repeat(64)}` },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success for bare attachment id')
    expect(result.value).toMatchObject({ text: 'ok', image: `sha256:${'a'.repeat(64)}` })
  })

  it('describes a stored attachment addressed by its note JSON', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('From attachment.')) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url }, { attachments: true })
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(`sha256:${'c'.repeat(64)}`, PNG_BYTES)

    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'From attachment.', mimeType: 'image/png', bytes: PNG_BYTES.length })
    const [textPart, imagePart] = sentContent(server.request(0)) as Array<{ type?: string; text?: string; image_url?: { url?: string } }>
    expect(textPart).toEqual({ type: 'text', text: tool.DEFAULT_PROMPT })
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/png;base64,/)
  })

  it('describes a stored attachment from a complete attachment note', async () => {
    const ctx = await seedAttachment(PNG_BYTES)
    const result = await callDescribe(ctx, { image: `[image attachment ${ref}]` })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected complete attachment note success')
    expect(result.value).toMatchObject({ text: 'From attachment.', mimeType: 'image/png' })
  })

  it('describes a stored attachment from self-contained Markdown without the id registry', async () => {
    const ctx = await seedAttachment(PNG_BYTES)
    const attachment: ImageAttachmentRef = {
      attachmentId: `sha256:${'b'.repeat(64)}` as ImageAttachmentRef['attachmentId'],
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
    }
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(String(attachment.attachmentId), PNG_BYTES)
    const image = attachmentMarkdown(attachment)

    const result = await callDescribe(ctx, { image })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected self-contained Markdown reference success')
    expect(result.value).toMatchObject({ text: 'From attachment.', image, mimeType: 'image/png' })
  })

  it('describes the attach route Markdown after the bare-id registry is evicted', async () => {
    const ctx = await seedAttachment(PNG_BYTES)
    const outcome = await handleAttach(ctx, 10_000_000, { data: PNG_BYTES.toString('base64'), mediaType: 'image/png' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error('expected attachment route success')
    for (let index = 0; index < 140; index += 1) {
      registerAttachmentRef({
        attachmentId: `sha256:${String(index).padStart(64, '0')}` as ImageAttachmentRef['attachmentId'],
        mediaType: 'image/png',
        bytes: PNG_BYTES.length,
        width: 1,
        height: 1,
      })
    }
    expect(attachmentRefById(String(outcome.ref.attachmentId))).toBeUndefined()

    const result = await callDescribe(ctx, { image: outcome.markdown })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected durable attach-route Markdown success')
    expect(result.value).toMatchObject({ text: 'From attachment.', image: outcome.markdown, mimeType: 'image/png' })
  })

  it('rejects an attachment reference without a mounted attachment service', async () => {
    const ctx = await setup()
    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('no attachment service is mounted')
  })

  it('accepts a reference carrying a display name', async () => {
    const ctx = await seedAttachment(PNG_BYTES)
    const named = JSON.stringify({
      attachmentId: `sha256:${'c'.repeat(64)}`,
      mediaType: 'image/png',
      bytes: PNG_BYTES.length,
      width: 1,
      height: 1,
      name: 'screenshot.png',
    })
    const result = await callDescribe(ctx, { image: named })
    expect(result.isError).toBe(false)
  })

  it('rejects malformed and misshaped references with the copy-verbatim guidance', async () => {
    const ctx = await setup({}, { attachments: true })
    for (const image of [
      '{not json',
      '{}',
      JSON.stringify({ attachmentId: 'x', mediaType: 'image/png', bytes: 1, width: 1, height: 'tall' }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'video/mp4', bytes: 1, width: 1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 0, width: 1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1, width: -1, height: 1 }),
      JSON.stringify({ attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 42 }),
    ]) {
      const result = await callDescribe(ctx, { image })
      expect(result.isError, `expected rejection for ${image}`).toBe(true)
      expect(errorText(result)).toContain('not a valid attachment reference')
    }
  })

  it('reports a missing stored attachment distinctly', async () => {
    const ctx = await setup({}, { attachments: true })
    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('is no longer available')
  })

  it('rethrows a storage failure that is not a missing attachment', async () => {
    const ctx = await setup({}, { attachments: true })
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(`sha256:${'c'.repeat(64)}`, 'boom')

    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('integrity failure')
  })

  it('enforces the byte bound and the sniff gate on stored bytes', async () => {
    const ctx = await setup({ maxBytes: 100 }, { attachments: true })
    const attachments = ctx.get('attachments') as FakeAttachments
    attachments.stored.set(`sha256:${'c'.repeat(64)}`, Buffer.alloc(200, 0x89))

    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('above the 100-byte bound')
  })

  it('rejects stored bytes that are not an accepted image type', async () => {
    const ctx = await seedAttachment(Buffer.from('not an image at all'))
    const result = await callDescribe(ctx, { image: ref })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('unsupported image type')
  })
})

describe('endpoint failures', () => {
  it('reports a non-2xx vision response with status and a bounded excerpt', async () => {
    const server = await startMockServer((_request, res) => { jsonReply(res, 401, { error: { message: 'bad key' } }) })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(errorText(result)).toContain('vision endpoint returned HTTP 401')
    expect(errorText(result)).toContain('bad key')
  })

  it('rejects invalid JSON, missing choices, and non-string content', async () => {
    const cases: Array<[string, unknown]> = [
      ['invalid JSON', 'not json'],
      ['missing choices', {}],
      ['non-string content', chatReply([{ type: 'text', text: 'x' }])],
    ]
    for (const [label, reply] of cases) {
      const server = await startMockServer((_request, res) => { rawReply(res, 200, typeof reply === 'string' ? reply : JSON.stringify(reply), 'application/json') })
      cleanup.push(server.close)
      const ctx = await setup({ baseURL: server.url })
      const path = await tempPng()

      const result = await callDescribe(ctx, { image: path })
      expect(result.isError, `expected rejection for ${label}`).toBe(true)
    }
  })

  it('never follows a redirect on the credential-bearing vision request', async () => {
    const target = await startMockServer((_request, res) => { jsonReply(res, 200, chatReply('should not be reached')) })
    cleanup.push(target.close)
    const server = await startMockServer((_request, res) => {
      res.writeHead(302, { location: `${target.url}/chat/completions` })
      res.end()
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
    expect(target.requests).toHaveLength(0)
  })

  it('never follows a redirect on the image download', async () => {
    const target = await startMockServer((_request, res) => { rawReply(res, 200, PNG_BYTES, 'image/png') })
    cleanup.push(target.close)
    const server = await startMockServer((_request, res) => {
      res.writeHead(302, { location: `${target.url}/img.png` })
      res.end()
    })
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url })

    const result = await callDescribe(ctx, { image: `${server.url}/img.png` })
    expect(result.isError).toBe(true)
    expect(target.requests).toHaveLength(0)
  })

  it('aborts an in-flight vision request when the caller signal fires', async () => {
    const server = await startMockServer(() => {})
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, timeoutMs: 60_000 })
    const path = await tempPng()

    const controller = new AbortController()
    const pending = callDescribe(ctx, { image: path }, controller.signal)
    setTimeout(() => { controller.abort() }, 20)
    const result = await pending
    expect(result.isError).toBe(true)
  })

  it('aborts a hanging vision request at the configured timeout', async () => {
    const server = await startMockServer(() => {})
    cleanup.push(server.close)
    const ctx = await setup({ baseURL: server.url, timeoutMs: 50 })
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path })
    expect(result.isError).toBe(true)
  })
})

describe('resolveConfig, sniffing, and bounded reads', () => {
  const minimal = { baseURL: 'https://api.example.com/v1', model: 'vision-1' }

  it('applies defaults and strips trailing slashes', () => {
    const spec = tool.resolveConfig({ ...minimal, baseURL: 'https://api.example.com/v1///' })
    expect(spec).toMatchObject({
      baseURL: 'https://api.example.com/v1',
      model: 'vision-1',
      apiKeyEnv: tool.DEFAULT_API_KEY_ENV,
      defaultPrompt: tool.DEFAULT_PROMPT,
      maxBytes: tool.DEFAULT_MAX_BYTES,
      maxOutputTokens: tool.DEFAULT_MAX_OUTPUT_TOKENS,
      timeoutMs: tool.DEFAULT_TIMEOUT_MS,
      apiStyle: tool.DEFAULT_API_STYLE,
      renderImagePreview: tool.DEFAULT_RENDER_IMAGE_PREVIEW,
      interceptImageSend: tool.DEFAULT_INTERCEPT_IMAGE_SEND,
    })
  })

  it('honors an explicit renderImagePreview override', () => {
    expect(tool.resolveConfig({ ...minimal, renderImagePreview: false }).renderImagePreview).toBe(false)
  })

  it('honors an explicit interceptImageSend override', () => {
    expect(tool.resolveConfig({ ...minimal, interceptImageSend: false }).interceptImageSend).toBe(false)
  })

  it('splits a model thinking suffix off the id and leaves bare ids untouched', () => {
    expect(tool.resolveConfig(minimal)).toMatchObject({ model: 'vision-1', thinking: undefined })
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:off' })).toMatchObject({ model: 'vision-1', thinking: 'off' })
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:low' })).toMatchObject({ model: 'vision-1', thinking: 'low' })
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:medium' })).toMatchObject({ model: 'vision-1', thinking: 'medium' })
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:high' })).toMatchObject({ model: 'vision-1', thinking: 'high' })
    // Unknown or non-trailing colons are part of the id, not a thinking suffix: real ids
    // carry colon variants (OpenRouter ':free', Replicate ':version'), so only the four known
    // thinking tokens are stripped.
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:unknown' })).toMatchObject({ model: 'vision-1:unknown', thinking: undefined })
    expect(tool.resolveConfig({ ...minimal, model: 'vision-1:high-custom' })).toMatchObject({ model: 'vision-1:high-custom', thinking: undefined })
    expect(tool.resolveConfig({ ...minimal, model: 'openrouter/openai/gpt-4o:free' })).toMatchObject({ model: 'openrouter/openai/gpt-4o:free', thinking: undefined })
  })

  it('rejects a model id that is only a thinking suffix', () => {
    expect(() => tool.resolveConfig({ ...minimal, model: ':off' })).toThrow(/model must be a non-empty model id/)
  })

  it('parses thinking suffixes through splitModelSuffix with surrounding whitespace', () => {
    expect(tool.splitModelSuffix('  mimo-v2.5:off  ')).toEqual({ model: 'mimo-v2.5', thinking: 'off' })
    expect(tool.splitModelSuffix('mimo-v2.5:high')).toEqual({ model: 'mimo-v2.5', thinking: 'high' })
    expect(tool.splitModelSuffix('mimo-v2.5')).toEqual({ model: 'mimo-v2.5', thinking: undefined })
  })

  it('accepts the responses and anthropic-messages styles and rejects anything else', () => {
    expect(tool.resolveConfig({ ...minimal, apiStyle: 'responses' }).apiStyle).toBe('responses')
    expect(tool.resolveConfig({ ...minimal, apiStyle: 'anthropic-messages' }).apiStyle).toBe('anthropic-messages')
    expect(() => tool.resolveConfig({ ...minimal, apiStyle: 'legacy' as tool.ApiStyle })).toThrow(/apiStyle must be one of "chat-completions", "responses", "anthropic-messages"/)
  })

  it.each([
    ['non-http(s) base URL', { ...minimal, baseURL: 'ftp://api.example.com' }, /baseURL must be an absolute http\(s\) URL/],
    ['absent base URL', { model: 'vision-1' }, /baseURL must be an absolute http\(s\) URL/],
    ['empty model', { ...minimal, model: '  ' }, /model must be a non-empty model id/],
    ['absent model', { baseURL: 'https://api.example.com' }, /model must be a non-empty model id/],
    ['empty inline key', { ...minimal, apiKey: '' }, /apiKey must be non-empty/],
    ['invalid credential ref', { ...minimal, apiKeyEnv: '9bad' }, /not a valid environment-variable name/],
    ['zero maxBytes', { ...minimal, maxBytes: 0 }, /maxBytes must be a positive safe integer/],
    ['fractional timeout', { ...minimal, timeoutMs: 1.5 }, /timeoutMs must be a positive safe integer/],
  ])('rejects %s', (_label, config, message) => {
    expect(() => tool.resolveConfig(config as tool.Config)).toThrow(message)
  })

  it('treats an empty apiKeyEnv as no reference at all', () => {
    const spec = tool.resolveConfig({ ...minimal, apiKeyEnv: '' })
    expect(spec.apiKeyEnv).toBeUndefined()
  })

  it.each([
    ['png', PNG_BYTES, 'image/png'],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg'],
    ['gif87a', Buffer.from('GIF87a....'), 'image/gif'],
    ['gif89a', Buffer.from('GIF89a....'), 'image/gif'],
    ['webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPxxxx'), 'image/webp'],
  ])('sniffs %s', (_label, bytes, mime) => {
    expect(tool.sniffMimeType(bytes)).toBe(mime)
  })

  it('rejects unknown and truncated inputs at the sniff gate', () => {
    expect(tool.sniffMimeType(Buffer.from('hello world'))).toBeUndefined()
    expect(tool.sniffMimeType(Buffer.from([0x89]))).toBeUndefined()
  })

  it('caps bounded body reads and truncates bounded text reads', async () => {
    const big = new Response(new Uint8Array(50).fill(0x61))
    await expect(tool.readBoundedBody(big, 10)).rejects.toThrow('exceeds the 10-byte bound')
    expect(await tool.readBoundedText(new Response('short'), 10)).toBe('short')
    expect(await tool.readBoundedText(new Response(null), 10)).toBe('')
    expect(await tool.readBoundedBody(new Response(null), 10)).toEqual(Buffer.alloc(0))
  })

  it('truncates mid-stream and at the final decode for bounded text reads', async () => {
    const chunked = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(20)))
        controller.enqueue(new TextEncoder().encode('x'.repeat(20)))
        controller.close()
      },
    }))
    expect(await tool.readBoundedText(chunked, 10)).toBe('x'.repeat(10))

    // The final decoder flush completes a multibyte character split across chunks — the partial
    // bytes ride the LAST chunk, so the cap breaks only after the loop exits.
    const split = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'.repeat(9)))
        controller.enqueue(Buffer.from([0x62, 0xe4, 0xb8])) // 'b' + first bytes of a 3-byte char
        controller.close()
      },
    }))
    expect(await tool.readBoundedText(split, 10)).toBe('a'.repeat(9) + 'b')
  })
})
