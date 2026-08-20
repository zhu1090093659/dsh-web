/**
 * Client native-image API tests: envelope parsing is strict, the toggle
 * POST carries the JSON body, and every failure answers a conservative
 * envelope instead of throwing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchNativeImageState, setNativeImageEnabled, NATIVE_IMAGES_ENDPOINT } from '../src/client/native-images.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(envelope: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }))
}

describe('fetchNativeImageState', () => {
  it('returns the state on an ok envelope', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true, value: { model: 'v4-pro', supported: true, capability: { acceptsImages: true, known: true } } }))
    const state = await fetchNativeImageState()
    expect(state?.model).toBe('v4-pro')
    expect(state?.capability.acceptsImages).toBe(true)
  })

  it('answers null on a refused envelope and on network failure', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: false, message: 'nope' }))
    await expect(fetchNativeImageState()).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fetchNativeImageState()).resolves.toBeNull()
  })
})

describe('setNativeImageEnabled', () => {
  it('posts the JSON toggle body and returns the refreshed state', async () => {
    const fetchSpy = stubFetch({ ok: true, value: { model: 'v4-pro', inputModalities: ['text', 'image'], capability: { acceptsImages: true, known: true }, supported: true } })
    vi.stubGlobal('fetch', fetchSpy)
    const result = await setNativeImageEnabled(true)
    expect(result.ok).toBe(true)
    expect(result.value?.inputModalities).toEqual(['text', 'image'])
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(NATIVE_IMAGES_ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"enabled":true}')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('returns the refusal message on a rejected envelope', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: false, message: 'loopback only' }))
    const result = await setNativeImageEnabled(true)
    expect(result.ok).toBe(false)
    expect(result.message).toBe('loopback only')
  })
})