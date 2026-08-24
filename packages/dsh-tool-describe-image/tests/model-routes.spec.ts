/**
 * Route tests for /describe-image/models: the HTTP envelope the settings
 * card's probe button reads (status codes + error shape), exercised through
 * a fake ctx.webServer registry and a local mock upstream.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { registerModelRoutes } from '../src/attach-routes.ts'
import type { Config } from '../src/config-resolve.ts'
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

describe('registerModelRoutes', () => {
  /** One async-iterable fake request carrying an optional body. */
  const makeReq = (method: string, body?: string, url = '/describe-image/models', overrides?: {
    remoteAddress?: string
    headers?: Record<string, string>
  }): IncomingMessage => ({
    method,
    url,
    socket: { remoteAddress: overrides?.remoteAddress ?? '127.0.0.1' },
    headers: { host: '127.0.0.1:3081', ...(overrides?.headers ?? {}) },
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield Buffer.from(body)
    },
  } as unknown as IncomingMessage)

  /** One fake response collecting status/body. */
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
  const capture = (readConfig: () => Config, resolveKey: (spec: { apiKey?: string }) => Promise<string>) => {
    const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
    const ctx = {
      get: (key: string) => key === 'webServer'
        ? { register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { registrations.push(row); return () => {} } }
        : undefined,
    }
    registerModelRoutes(ctx as unknown as Context, readConfig, resolveKey as never)
    return registrations
  }

  it('registers the prefix route on the webserver', () => {
    const registrations = capture(() => ({}), async () => 'k')
    expect(registrations).toHaveLength(1)
    expect(registrations[0].kind).toBe('prefix')
    expect(registrations[0].path).toBe('/describe-image/models')
  })

  describe('loopback fence', () => {
    it('answers 403 without touching the upstream for a LAN socket', async () => {
      const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1'])))
      const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
      const { res, status, body } = makeRes()
      await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models', { remoteAddress: '192.168.1.5' }), res)
      expect(status()).toBe(403)
      expect(body()).toContain('forbidden: loopback-only')
      expect(upstream.requests).toHaveLength(0)
    })

    it('answers 403 for a cross-site browser marker on a loopback socket', async () => {
      const registrations = capture(() => ({}), async () => 'k')
      const { res, status } = makeRes()
      await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models', { headers: { 'sec-fetch-site': 'cross-site' } }), res)
      expect(status()).toBe(403)
    })

    it('answers 403 for a cross-origin Origin header', async () => {
      const registrations = capture(() => ({}), async () => 'k')
      const { res, status } = makeRes()
      await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models', { headers: { origin: 'http://evil.example' } }), res)
      expect(status()).toBe(403)
    })

    it('still serves a same-origin loopback request carrying an Origin header', async () => {
      const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1'])))
      const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
      const { res, status } = makeRes()
      await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models', { headers: { origin: 'http://127.0.0.1:3081' } }), res)
      expect(status()).toBe(200)
    })
  })

  it('answers 405 for anything but POST', async () => {
    const registrations = capture(() => ({}), async () => 'k')
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('GET'), res)
    expect(status()).toBe(405)
  })

  it('lists the stored endpoint with an empty body', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1', 'm2'])))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}'), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { models: ['m1', 'm2'] } })
  })

  it('tolerates an unparseable body by probing the stored settings', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1'])))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('POST', '{not json'), res)
    expect(status()).toBe(200)
  })


  it('tears down an oversized body and probes the stored settings', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1'])))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
    const { res, status } = makeRes()
    let destroys = 0
    const req = {
      method: 'POST',
      url: '/describe-image/models',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3081', 'sec-fetch-site': 'same-origin' },
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify({ pad: 'x'.repeat(5000) })) },
      destroy() { destroys += 1 },
    } as unknown as IncomingMessage
    await registrations[0].handler(req, res)
    expect(status()).toBe(200)
    expect(destroys).toBe(1)
  })
  it('answers 422 when the merged configuration is invalid', async () => {
    const registrations = capture(() => ({}), async () => 'k')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}'), res)
    expect(status()).toBe(422)
    const envelope = JSON.parse(body()) as { ok: boolean; error: { code: string; message: string } }
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('rejected')
    expect(envelope.error.message).toContain('baseURL')
  })

  it('answers 422 when the key cannot be resolved', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['m1'])))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x' }), async () => { throw new Error('describe-image: no API key') })
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}'), res)
    expect(status()).toBe(422)
    expect(JSON.parse(body())).toMatchObject({ ok: false, error: { code: 'rejected' } })
    expect(upstream.requests).toHaveLength(0)
  })

  it('answers 502 when the upstream rejects the probe', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 401, {}))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}'), res)
    expect(status()).toBe(502)
    const envelope = JSON.parse(body()) as { ok: boolean; error: { code: string; message: string } }
    expect(envelope.error.code).toBe('internal')
    expect(envelope.error.message).toContain('key rejected')
  })

  it('honors draft overrides posted by the card', async () => {
    const storedUpstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['stored'])))
    const draftUpstream = await mock((_request, response) => jsonReply(response, 200, modelsReply(['draft'])))
    const registrations = capture(() => ({ baseURL: storedUpstream.url, model: 'x', apiKey: 'stored' }), async (spec) => spec.apiKey ?? '')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', JSON.stringify({ baseURL: draftUpstream.url, apiKey: 'draft' })), res)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ ok: true, value: { models: ['draft'] } })
    expect(storedUpstream.requests).toHaveLength(0)
    expect(draftUpstream.request(0).authorization).toBe('Bearer draft')
  })

  it('answers the /test suffix with the model ping latency', async () => {
    const upstream = await mock((_request, response) => jsonReply(response, 200, { choices: [{ message: { content: 'pong' } }] }))
    const registrations = capture(() => ({ baseURL: upstream.url, model: 'x', apiKey: 'k' }), async (spec) => spec.apiKey ?? '')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models/test'), res)
    expect(status()).toBe(200)
    const envelope = JSON.parse(body()) as { ok: boolean; value: { latencyMs: number } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.latencyMs).toBeGreaterThanOrEqual(1)
    expect(upstream.request(0).path).toBe('/chat/completions')
  })

  it('answers 422 when the test carries no model', async () => {
    const registrations = capture(() => ({ baseURL: 'http://127.0.0.1:1', apiKey: 'k' }), async () => 'k')
    const { res, status, body } = makeRes()
    await registrations[0].handler(makeReq('POST', '{}', '/describe-image/models/test'), res)
    expect(status()).toBe(422)
    expect(JSON.parse(body())).toMatchObject({ ok: false, error: { code: 'rejected' } })
  })

  it('answers 405 on the /test suffix for anything but POST', async () => {
    const registrations = capture(() => ({}), async () => 'k')
    const { res, status } = makeRes()
    await registrations[0].handler(makeReq('GET', undefined, '/describe-image/models/test'), res)
    expect(status()).toBe(405)
  })
})
