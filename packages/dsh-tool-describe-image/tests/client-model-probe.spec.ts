/**
 * Browser-half probe client tests: the envelope math of fetchEndpointModels
 * against a stubbed fetch — the happy listing, the structured error
 * passthrough, and the controlled rejections for network/response failures.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchEndpointModels, MODELS_ENDPOINT, MODEL_TEST_ENDPOINT, testEndpointModel } from '../src/client/model-probe.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The drafts every case sends; the route owns their validation. */
const draft = { baseURL: 'https://api.example.com/v1', apiStyle: 'chat-completions', apiKey: '' }

/** Stub fetch to answer one JSON envelope. */
function stubEnvelope(envelope: unknown, init?: { reject?: boolean; badJson?: boolean }) {
  const fetchMock = vi.fn(async (url: string, requestInit?: RequestInit) => {
    expect(url).toBe(MODELS_ENDPOINT)
    if (init?.reject === true) throw new Error('network down')
    return {
      json: async () => {
        if (init?.badJson === true) throw new Error('not json')
        return envelope
      },
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('fetchEndpointModels', () => {
  it('posts the drafts and returns the listing', async () => {
    const fetchMock = stubEnvelope({ ok: true, value: { models: ['a', 'b'] } })
    const result = await fetchEndpointModels(draft)
    expect(result).toEqual({ ok: true, models: ['a', 'b'] })
    const call = fetchMock.mock.calls[0]
    expect(call[1]?.method).toBe('POST')
    expect(JSON.parse(String((call[1] as RequestInit | undefined)?.body))).toEqual(draft)
  })

  it('passes the host error message through', async () => {
    stubEnvelope({ ok: false, error: { code: 'rejected', message: 'describe-image: no API key' } })
    const result = await fetchEndpointModels(draft)
    expect(result).toEqual({ ok: false, message: 'describe-image: no API key' })
  })

  it('rejects a listing whose ids are not strings', async () => {
    stubEnvelope({ ok: true, value: { models: ['a', 42] } })
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'bad-response' })
  })

  it('answers bad-response for unparseable or shapeless envelopes', async () => {
    stubEnvelope(null, { badJson: true })
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'bad-response' })
    stubEnvelope('text')
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'bad-response' })
    stubEnvelope({ ok: true, value: { models: 'nope' } })
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'bad-response' })
  })

  it('answers network-failed when the fetch itself throws', async () => {
    stubEnvelope(null, { reject: true })
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'network-failed' })
  })

  it('falls back to server-failed when the error carries no message', async () => {
    stubEnvelope({ ok: false, error: {} })
    expect(await fetchEndpointModels(draft)).toEqual({ ok: false, message: 'server-failed' })
  })
})

describe('testEndpointModel', () => {
  /** The test draft every case sends: connection fields plus the model. */
  const testDraft = { ...draft, model: 'vision-1' }

  /** Stub fetch against the test endpoint answering one envelope. */
  function stubTest(envelope: unknown, init?: { reject?: boolean; badJson?: boolean }) {
    const fetchMock = vi.fn(async (url: string, _requestInit?: RequestInit) => {
      expect(url).toBe(MODEL_TEST_ENDPOINT)
      if (init?.reject === true) throw new Error('network down')
      return {
        json: async () => {
          if (init?.badJson === true) throw new Error('not json')
          return envelope
        },
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('posts the model draft and returns the latency', async () => {
    const fetchMock = stubTest({ ok: true, value: { latencyMs: 432 } })
    const result = await testEndpointModel(testDraft)
    expect(result).toEqual({ ok: true, latencyMs: 432 })
    const call = fetchMock.mock.calls[0]
    expect(JSON.parse(String((call[1] as RequestInit | undefined)?.body))).toEqual(testDraft)
  })

  it('passes the host error message through', async () => {
    stubTest({ ok: false, error: { code: 'internal', message: 'describe-image: model ping returned HTTP 404 (model not found)' } })
    const result = await testEndpointModel(testDraft)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('model not found')
  })

  it('rejects envelopes without a usable latency', async () => {
    stubTest({ ok: true, value: { latencyMs: 'fast' } })
    expect(await testEndpointModel(testDraft)).toEqual({ ok: false, message: 'bad-response' })
    stubTest({ ok: true, value: { latencyMs: -5 } })
    expect(await testEndpointModel(testDraft)).toEqual({ ok: false, message: 'bad-response' })
    stubTest(null, { badJson: true })
    expect(await testEndpointModel(testDraft)).toEqual({ ok: false, message: 'bad-response' })
  })

  it('answers network-failed when the fetch itself throws', async () => {
    stubTest(null, { reject: true })
    expect(await testEndpointModel(testDraft)).toEqual({ ok: false, message: 'network-failed' })
  })
})
