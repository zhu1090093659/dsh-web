/**
 * The plugin's configuration is its own `Config`: the values the Host hands
 * the plugin when it activates the profile row are the ones the runtime uses,
 * and the Host restarts the row after every accepted settings write — the
 * only path a settings change has to a call under the 0.1.7 surface, where
 * the row's Config schema IS its settings page (there is no separate settings
 * document to overlay any more).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm/brand'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'
import type { Config } from '../src/config-resolve.ts'
import { anthropicReply, chatReply, FakeWebServer, jsonReply, PNG_BYTES, responsesReply, startMockServer } from './mock-server.ts'
import { agentForWorkspace } from './test-agent.ts'
import type { MockServer, RecordedRequest } from './mock-server.ts'

const cleanup: Array<() => Promise<void>> = []
const contexts: Context[] = []

/** One activated profile row: the plugin instance the Host restarts on an accepted settings write. */
interface Row {
  /**
   * Restart the row with the configuration a settings write committed, the
   * way the Host does. A configuration the plugin refuses at activation
   * rejects, and the row falls back to the last accepted one exactly as the
   * Host's own rollback does.
   * @param config - the configuration the Host would hand the plugin.
   */
  reload: (config: Config) => Promise<void>
}

async function boot(
  makeConfig: (url: string) => Config,
  handler: (request: RecordedRequest, response: ServerResponse) => void
    = (_request, res) => { jsonReply(res, 200, chatReply('ok')) },
): Promise<{ ctx: Context; server: MockServer; row: Row }> {
  const server = await startMockServer(handler)
  cleanup.push(server.close)
  const ctx = new Context()
  contexts.push(ctx)
  // No settings service is mounted: under 0.1.7 the plugin reads its
  // configuration from the activation argument alone.
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  let config = makeConfig(server.url)
  let fork = await ctx.plugin(tool, config)
  return {
    ctx,
    server,
    row: {
      reload: async (next: Config) => {
        const previous = config
        await fork.dispose()
        try {
          fork = await ctx.plugin(tool, next)
          config = next
        } catch (error) {
          fork = await ctx.plugin(tool, previous)
          throw error
        }
      },
    },
  }
}

async function tempPng(): Promise<{ path: string; workspace: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-describe-image-settings-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'pixel.png')
  await writeFile(path, PNG_BYTES)
  return { path, workspace: dir }
}

function callDescribe(ctx: Context, image: string, workspace?: string) {
  const agent = agentForWorkspace(workspace)
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId('settings-vision-call'),
    name: 'describe_image',
    arguments: { image },
    ...(agent === undefined ? {} : { agent }),
  })
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => Promise.resolve(ctx.fiber.dispose())))
  await Promise.all(cleanup.splice(0).map(close => close()))
})

describe('describe-image configuration', () => {
  it('user sees a call served by the configuration the Host handed the row', async () => {
    // Given a row activated with an endpoint, model, key and a 7-token cap
    const { ctx, server } = await boot(url => ({
      baseURL: url,
      model: 'entry-model',
      apiKey: 'sk-entry',
      maxOutputTokens: 7,
    }))
    const { path, workspace } = await tempPng()

    // When the model calls describe_image
    const result = await callDescribe(ctx, path, workspace)

    // Then the call carries the configured model and cap
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ model: 'entry-model' })
    const body = server.request(0).body as { model?: unknown; max_tokens?: unknown }
    expect(body.model).toBe('entry-model')
    expect(body.max_tokens).toBe(7)
  })

  it('user sees a committed change reach the next call after the Host restarts the row', async () => {
    // Given a running row and a settings write the Host committed
    const { ctx, server, row } = await boot(url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-entry' }))
    const { path, workspace } = await tempPng()

    // When the Host restarts the row with the committed model
    await row.reload({ baseURL: server.url, model: 'live-model', apiKey: 'sk-entry' })

    // Then the next call uses it
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    expect((server.request(0).body as { model?: unknown }).model).toBe('live-model')
  })

  it('user sees an apiStyle committed to the row switch the next call to /responses', async () => {
    // Given a row whose committed configuration selects the Responses style
    const { ctx, server, row } = await boot(
      url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-entry' }),
      (_request, res) => { jsonReply(res, 200, responsesReply('switched')) },
    )
    const { path, workspace } = await tempPng()

    // When the Host restarts the row with it
    await row.reload({ baseURL: server.url, model: 'entry-model', apiKey: 'sk-entry', apiStyle: 'responses' })

    // Then the next call posts to /responses and parses its answer
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'switched' })
    expect(server.request(0).path).toBe('/responses')
  })

  it('user sees an anthropic-messages configuration drive the next call headers, endpoint, and parser', async () => {
    // Given a row whose committed configuration selects the Anthropic style
    const { ctx, server, row } = await boot(
      url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-entry' }),
      (_request, res) => { jsonReply(res, 200, anthropicReply('anthropic switched')) },
    )
    const { path, workspace } = await tempPng()

    // When the Host restarts the row with it
    await row.reload({ baseURL: server.url, model: 'entry-model', apiKey: 'sk-entry', apiStyle: 'anthropic-messages' })

    // Then the next call speaks the Messages API
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ text: 'anthropic switched' })
    const request = server.request(0)
    expect(request.path).toBe('/v1/messages')
    expect(request.authorization).toBeUndefined()
    expect(request.xApiKey).toBe('sk-entry')
    expect(request.anthropicVersion).toBe('2023-06-01')
  })

  it('user sees a model thinking suffix in the row configuration drive the next call body', async () => {
    // Given a row whose committed model carries the :off suffix
    const { ctx, server, row } = await boot(url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-entry' }))
    const { path, workspace } = await tempPng()

    // When the Host restarts the row with it
    await row.reload({ baseURL: server.url, model: 'entry-model:off', apiKey: 'sk-entry' })

    // Then the suffix is stripped from the id and sent as a thinking control
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected describe_image success')
    expect(result.value).toMatchObject({ model: 'entry-model' })
    const body = server.request(0).body as { model?: unknown; thinking?: unknown }
    expect(body.model).toBe('entry-model')
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('user sees an inline apiKey in the row configuration drive the next call', async () => {
    // Given a row configured with an inline key
    const { ctx, server } = await boot(url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-committed' }))
    const { path, workspace } = await tempPng()

    // When the model calls describe_image
    await callDescribe(ctx, path, workspace)

    // Then the endpoint is called with that key
    expect(server.request(0).authorization).toBe('Bearer sk-committed')
  })

  it('user sees an incoherent configuration refused instead of taking effect', async () => {
    // Given a serving row and a committed baseURL that is not http(s)
    const { ctx, server, row } = await boot(url => ({ baseURL: url, model: 'entry-model', apiKey: 'sk-entry' }))
    const { path, workspace } = await tempPng()

    // When the Host restarts the row with it
    await expect(row.reload({ baseURL: 'ftp://example.com', model: 'vision-1', apiKey: 'sk-entry' }))
      .rejects.toThrow(/describe-image: baseURL must be an absolute http\(s\) URL/)

    // Then the row the Host rolled back to keeps serving the last accepted values
    const result = await callDescribe(ctx, path, workspace)
    expect(result.isError).toBe(false)
    expect((server.request(0).body as { model?: unknown }).model).toBe('entry-model')
  })

  it('user sees the row served from its own configuration with no settings service mounted', async () => {
    // Given a context carrying only the deployment configuration
    const { ctx, server } = await boot(url => ({ baseURL: url, model: 'entry-only', apiKey: 'sk-entry' }))
    const { path, workspace } = await tempPng()

    // When the model calls describe_image
    await callDescribe(ctx, path, workspace)

    // Then the call uses that configuration
    expect((server.request(0).body as { model?: unknown }).model).toBe('entry-only')
  })
})
