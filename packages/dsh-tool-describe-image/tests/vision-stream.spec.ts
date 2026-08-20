/** SSE streaming Responses endpoints: describe_image must parse `text/event-stream` payloads. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import { FakeWebServer, PNG_BYTES, rawReply, startMockServer } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

/** One SSE event: `event:` and `data:` lines followed by a blank line. */
function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** The event sequence a codex-lb style relay returns even for a non-stream request. */
function responsesStream(answer: string): string {
  return [
    sseEvent('codex.keepalive', { type: 'codex.keepalive' }),
    sseEvent('response.created', { type: 'response.created', response: { object: 'response', status: 'in_progress' } }),
    sseEvent('response.output_text.delta', { type: 'response.output_text.delta', delta: answer }),
    sseEvent('response.output_item.done', {
      type: 'response.output_item.done',
      item: { type: 'message', status: 'completed', content: [{ type: 'output_text', text: answer }] },
    }),
    // The relay leaves the completed response's output array empty: the text lives
    // only in the delta / output_item.done events.
    sseEvent('response.completed', { type: 'response.completed', response: { object: 'response', status: 'completed', output: [] } }),
    'data: [DONE]\n\n',
  ].join('')
}

async function boot(ctx: Context, baseURL: string): Promise<void> {
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { baseURL, model: 'vision-1', apiKey: 'sk-inline', apiStyle: 'responses' })
}

function callDescribe(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('stream-vision-call'),
    name: 'describe_image',
    arguments: args,
  })
}

async function tempPng(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-stream-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return path
}

describe('responses SSE streaming endpoint', () => {
  it('parses a text/event-stream Responses payload into the text answer', async () => {
    const server = await startMockServer((_request, res) => { rawReply(res, 200, responsesStream('Cyan'), 'text/event-stream') })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server.url)
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'what color is this?' })
    expect(result.isError).toBe(false)
    expect(server.request(0).path).toBe('/responses')
    const value = result.value as { text?: string }
    expect(value.text).toBe('Cyan')
  })

  it('falls back to stream parsing when the body is SSE but the content-type is JSON', async () => {
    const server = await startMockServer((_request, res) => { rawReply(res, 200, responsesStream('Cyan'), 'application/json') })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server.url)
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'what color is this?' })
    expect(result.isError).toBe(false)
    const value = result.value as { text?: string }
    expect(value.text).toBe('Cyan')
  })

  it('reports no text content when a stream carries no answer events', async () => {
    const server = await startMockServer((_request, res) => { rawReply(res, 200, sseEvent('codex.keepalive', { type: 'codex.keepalive' }) + 'data: [DONE]\n\n', 'text/event-stream') })
    cleanup.push(server.close)
    const ctx = new Context()
    contexts.push(ctx)
    await boot(ctx, server.url)
    const path = await tempPng()

    const result = await callDescribe(ctx, { image: path, prompt: 'what color is this?' })
    expect(result.isError).toBe(true)
  })
})
