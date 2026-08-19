/**
 * Model-probe tests: the listing URL each style hits, the payload extraction,
 * the upstream call itself (headers, failure envelopes) against the local mock
 * server, and the draft-override merge the settings card's probe relies on.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { buildModelsUrl, buildModelPingRequest, extractModelIds, handleModelProbe, handleModelTest, probeModels, testModelConnection, PROBE_MAX_MODELS } from '../src/model-probe.ts'
import type { Config } from '../src/config-resolve.ts'
import type { ResolvedConfig } from '../src/config-resolve.ts'
import { resolveConfig } from '../src/config-resolve.ts'
import { jsonReply, startMockServer, type MockServer } from './mock-server.ts'

/** An OpenAI-style models listing answering `ids`. */
function modelsReply(ids: string[]): unknown {
  return { object: 'list', data: ids.map(id => ({ id, object: 'model' })) }
}

const servers: MockServer[] = []

/** Start one mock upstream and remember it for teardown. */
async function mock(handler: Parameters<typeof startMockServer>[0]): Promise<MockServer> {
  const server = await startMockServer(handler)
  servers.push(server)
  return server
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
})

describe('buildModelsUrl', () => {
  it('appends /models for the OpenAI-compatible styles', () => {
    expect(buildModelsUrl('https://api.example.com/v1', 'chat-completions')).toBe('https://api.example.com/v1/models')
    expect(buildModelsUrl('https://api.example.com/v1', 'responses')).toBe('https://api.example.com/v1/models')
  })

  it('maps every anthropic base shape onto /v1/models', () => {
    expect(buildModelsUrl('https://api.anthropic.com', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/models')
    expect(buildModelsUrl('https://api.anthropic.com/v1', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/models')
    expect(buildModelsUrl('https://api.anthropic.com/v1/messages', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/models')
  })
})

describe('extractModelIds', () => {
  it('reads the data[].id entries in order', () => {
    expect(extractModelIds(modelsReply(['gpt-x', 'vision-1']))).toEqual(['gpt-x', 'vision-1'])
  })

  it('skips entries without a usable id', () => {
    expect(extractModelIds({ data: [{ id: 'keep' }, { name: 'no-id' }, { id: '' }, { id: '  ' }, 'not-an-object'] })).toEqual(['keep'])
  })

  it('rejects payloads without a data array', () => {
    expect(() => extractModelIds({ models: [] })).toThrow('unexpected shape')
    expect(() => extractModelIds(null)).toThrow('unexpected shape')
    expect(() => extractModelIds([])).toThrow('unexpected shape')
  })

  it('caps the listing at the model bound', () => {
    const ids = Array.from({ length: PROBE_MAX_MODELS + 8 }, (_, i) => `m${i}`)
    expect(extractModelIds(modelsReply(ids))).toHaveLength(PROBE_MAX_MODELS)
  })
})

describe('probeModels', () => {
  it('sends Bearer auth to the chat-completions listing', async () => {
    const upstream = await mock((request, res) => jsonReply(res, 200, modelsReply(['vision-1'])))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x', apiStyle: 'chat-completions' })
    const models = await probeModels(spec, 'sk-test')
    expect(models).toEqual(['vision-1'])
    expect(upstream.request(0).path).toBe('/models')
    expect(upstream.request(0).authorization).toBe('Bearer sk-test')
  })

  it('sends the anthropic headers to the /v1/models listing', async () => {
    const upstream = await mock((request, res) => jsonReply(res, 200, modelsReply(['claude-sonnet'])))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x', apiStyle: 'anthropic-messages' })
    const models = await probeModels(spec, 'ak-test')
    expect(models).toEqual(['claude-sonnet'])
    expect(upstream.request(0).path).toBe('/v1/models')
    expect(upstream.request(0).xApiKey).toBe('ak-test')
    expect(upstream.request(0).anthropicVersion).toBe('2023-06-01')
    expect(upstream.request(0).authorization).toBeUndefined()
  })

  it('flags a rejected key on 401/403', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 401, { error: 'bad key' }))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x' })
    await expect(probeModels(spec, 'wrong')).rejects.toThrow('HTTP 401 (key rejected)')
  })

  it('surfaces other upstream statuses verbatim', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 500, {}))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x' })
    await expect(probeModels(spec, 'k')).rejects.toThrow('HTTP 500')
  })

  it('rejects invalid JSON bodies', async () => {
    const upstream = await mock((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{not json')
    })
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x' })
    await expect(probeModels(spec, 'k')).rejects.toThrow('invalid JSON')
  })

  it('treats an empty listing as its own failure', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, { data: [] }))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'x' })
    await expect(probeModels(spec, 'k')).rejects.toThrow('listed no models')
  })

  it('reports an unreachable endpoint', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['x'])))
    const url = upstream.url
    await upstream.close()
    const spec = resolveConfig({ baseURL: url, model: 'x' })
    await expect(probeModels(spec, 'k')).rejects.toThrow('endpoint unreachable')
  })
})

describe('handleModelProbe', () => {
  /** A stored configuration pointing at `url` with an inline key. */
  const stored = (url: string): Config => ({ baseURL: url, model: 'stored-model', apiKey: 'stored-key' })

  it('lists with the stored settings when no override rides along', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['m1'])))
    const outcome = await handleModelProbe(stored(upstream.url), {}, async (spec) => spec.apiKey ?? '')
    expect(outcome).toEqual({ ok: true, models: ['m1'] })
    expect(upstream.request(0).authorization).toBe('Bearer stored-key')
  })

  it('honors the card drafts over the stored settings', async () => {
    const storedUpstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['stored'])))
    const draftUpstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['draft'])))
    const outcome = await handleModelProbe(
      stored(storedUpstream.url),
      { baseURL: draftUpstream.url, apiKey: 'draft-key', apiStyle: 'chat-completions' },
      async (spec) => spec.apiKey ?? '',
    )
    expect(outcome).toEqual({ ok: true, models: ['draft'] })
    expect(storedUpstream.requests).toHaveLength(0)
    expect(draftUpstream.request(0).authorization).toBe('Bearer draft-key')
  })

  it('lists even when no model is configured yet', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['m1'])))
    const outcome = await handleModelProbe({ baseURL: upstream.url, apiKey: 'k' }, {}, async (spec) => spec.apiKey ?? '')
    expect(outcome).toEqual({ ok: true, models: ['m1'] })
  })

  it('keeps the stored key when the draft key is empty', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['m1'])))
    const seen: Array<string | undefined> = []
    const outcome = await handleModelProbe(stored(upstream.url), { apiKey: '  ' }, async (spec) => {
      seen.push(spec.apiKey)
      return spec.apiKey ?? 'seam-key'
    })
    expect(outcome).toEqual({ ok: true, models: ['m1'] })
    expect(seen).toEqual(['stored-key'])
    expect(upstream.request(0).authorization).toBe('Bearer stored-key')
  })

  it('rejects an invalid draft without calling the endpoint', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['m1'])))
    const badStyle = await handleModelProbe(stored(upstream.url), { apiStyle: 'carrier-pigeon' }, async (spec) => spec.apiKey ?? '')
    expect(badStyle.ok).toBe(false)
    if (!badStyle.ok) expect(badStyle.error.code).toBe('rejected')
    const noEndpoint = await handleModelProbe({}, {}, async () => 'k')
    expect(noEndpoint.ok).toBe(false)
    if (!noEndpoint.ok) expect(noEndpoint.error.message).toContain('baseURL')
    expect(upstream.requests).toHaveLength(0)
  })

  it('surfaces the credential seam failure as a rejection', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['m1'])))
    const outcome = await handleModelProbe({ baseURL: upstream.url, model: 'x' }, {}, async () => {
      throw new Error('describe-image: no API key')
    })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('rejected')
      expect(outcome.error.message).toContain('no API key')
    }
    expect(upstream.requests).toHaveLength(0)
  })

  it('envelopes upstream failures as internal errors', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 502, {}))
    const outcome = await handleModelProbe(stored(upstream.url), {}, async (spec) => spec.apiKey ?? '')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('internal')
      expect(outcome.error.message).toContain('HTTP 502')
    }
  })
})

describe('probeModels spec passthrough', () => {
  it('accepts an externally resolved configuration', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, modelsReply(['only'])))
    const spec: ResolvedConfig = resolveConfig({ baseURL: upstream.url, model: 'x' })
    expect(await probeModels(spec, 'k')).toEqual(['only'])
  })
})

describe('buildModelPingRequest', () => {
  it('posts a one-token chat-completions ping', () => {
    const spec = resolveConfig({ baseURL: 'https://api.example.com/v1', model: 'vision-1' })
    const { path, body } = buildModelPingRequest(spec)
    expect(path).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(body)).toEqual({ model: 'vision-1', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
  })

  it('posts a one-token responses ping', () => {
    const spec = resolveConfig({ baseURL: 'https://api.example.com/v1', model: 'vision-1', apiStyle: 'responses' })
    const { path, body } = buildModelPingRequest(spec)
    expect(path).toBe('https://api.example.com/v1/responses')
    expect(JSON.parse(body)).toEqual({ model: 'vision-1', max_output_tokens: 1, input: 'ping' })
  })

  it('maps every anthropic base shape onto the messages path', () => {
    for (const baseURL of ['https://api.anthropic.com', 'https://api.anthropic.com/v1', 'https://api.anthropic.com/v1/messages']) {
      const spec = resolveConfig({ baseURL, model: 'vision-1', apiStyle: 'anthropic-messages' })
      const { path, body } = buildModelPingRequest(spec)
      expect(path).toBe('https://api.anthropic.com/v1/messages')
      expect(JSON.parse(body).max_tokens).toBe(1)
    }
  })
})

describe('testModelConnection', () => {
  it('measures the chat-completions round trip', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, { choices: [{ message: { content: 'pong' } }] }))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'vision-1' })
    const latency = await testModelConnection(spec, 'sk-test')
    expect(latency).toBeGreaterThanOrEqual(1)
    expect(upstream.request(0).path).toBe('/chat/completions')
    expect(upstream.request(0).authorization).toBe('Bearer sk-test')
    expect((upstream.request(0).body as { max_tokens: number }).max_tokens).toBe(1)
  })

  it('sends the anthropic headers on the messages ping', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, { content: [{ type: 'text', text: 'pong' }] }))
    const spec = resolveConfig({ baseURL: upstream.url, model: 'vision-1', apiStyle: 'anthropic-messages' })
    await testModelConnection(spec, 'ak-test')
    expect(upstream.request(0).path).toBe('/v1/messages')
    expect(upstream.request(0).xApiKey).toBe('ak-test')
    expect(upstream.request(0).anthropicVersion).toBe('2023-06-01')
  })

  it('flags a rejected key and a missing model', async () => {
    const denied = await mock((_request, res) => jsonReply(res, 401, {}))
    const spec = resolveConfig({ baseURL: denied.url, model: 'x' })
    await expect(testModelConnection(spec, 'wrong')).rejects.toThrow('HTTP 401 (key rejected)')
    const missing = await mock((_request, res) => jsonReply(res, 404, {}))
    const spec404 = resolveConfig({ baseURL: missing.url, model: 'ghost' })
    await expect(testModelConnection(spec404, 'k')).rejects.toThrow('HTTP 404 (model not found)')
  })
})

describe('handleModelTest', () => {
  const stored = (url: string): Config => ({ baseURL: url, model: 'stored-model', apiKey: 'stored-key' })

  it('rejects a test without any model', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, {}))
    const outcome = await handleModelTest({ baseURL: upstream.url, apiKey: 'k' }, {}, async () => 'k')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('rejected')
      expect(outcome.error.message).toContain('pick a model')
    }
    expect(upstream.requests).toHaveLength(0)
  })

  it('pings the draft model at the draft endpoint', async () => {
    const storedUpstream = await mock((_request, res) => jsonReply(res, 200, {}))
    const draftUpstream = await mock((_request, res) => jsonReply(res, 200, { choices: [{ message: { content: 'pong' } }] }))
    const outcome = await handleModelTest(
      stored(storedUpstream.url),
      { baseURL: draftUpstream.url, model: 'draft-model', apiKey: 'draft-key' },
      async (spec) => spec.apiKey ?? '',
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.latencyMs).toBeGreaterThanOrEqual(1)
    expect(storedUpstream.requests).toHaveLength(0)
    const sent = draftUpstream.request(0)
    expect(sent.authorization).toBe('Bearer draft-key')
    expect((sent.body as { model: string }).model).toBe('draft-model')
  })

  it('keeps the stored key when the draft key is empty', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 200, { choices: [{ message: { content: 'pong' } }] }))
    const outcome = await handleModelTest(stored(upstream.url), { apiKey: '  ' }, async (spec) => spec.apiKey ?? 'seam')
    expect(outcome.ok).toBe(true)
    expect(upstream.request(0).authorization).toBe('Bearer stored-key')
  })

  it('envelopes upstream failures as internal errors', async () => {
    const upstream = await mock((_request, res) => jsonReply(res, 500, {}))
    const outcome = await handleModelTest(stored(upstream.url), {}, async (spec) => spec.apiKey ?? '')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('internal')
      expect(outcome.error.message).toContain('HTTP 500')
    }
  })
})
