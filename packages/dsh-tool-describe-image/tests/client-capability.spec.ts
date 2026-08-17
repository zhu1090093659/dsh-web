/**
 * Client capability-checker tests: the host verdict envelope parses strictly
 * (only an explicit acceptsImages-true passes), answers cache per session,
 * and every failure fails closed to false so the legacy rewrite proceeds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageCapabilityChecker, fetchSessionAcceptsImages } from '../src/client/capability.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Stub fetch to answer the given envelope (or throw). */
function stubFetch(envelope: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 }))
}

describe('fetchSessionAcceptsImages', () => {
  it('answers true only on an explicit acceptsImages-true envelope', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true, value: { acceptsImages: true, known: true } }))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(true)
  })

  it('answers false on an acceptsImages-false verdict', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true, value: { acceptsImages: false, known: true } }))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(false)
  })

  it('answers false on an unknown verdict', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: true, value: { acceptsImages: false, known: false } }))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(false)
  })

  it('answers false on an error envelope, bad JSON, and network failure', async () => {
    vi.stubGlobal('fetch', stubFetch({ ok: false, error: { message: 'boom' } }))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(false)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(fetchSessionAcceptsImages('s1')).resolves.toBe(false)
  })

  it('queries the capability endpoint with the encoded session id', async () => {
    const fetchSpy = stubFetch({ ok: true, value: { acceptsImages: true } })
    vi.stubGlobal('fetch', fetchSpy)
    await fetchSessionAcceptsImages('session/1')
    const url = String((fetchSpy.mock.calls[0] as unknown as [string])[0])
    expect(url).toBe('/describe-image/capability?session=' + encodeURIComponent('session/1'))
  })
})

describe('createImageCapabilityChecker', () => {
  it('caches the verdict per session', async () => {
    const fetchSpy = stubFetch({ ok: true, value: { acceptsImages: true } })
    vi.stubGlobal('fetch', fetchSpy)
    const check = createImageCapabilityChecker()
    await expect(check({ sessionId: 's1' })).resolves.toBe(true)
    await expect(check({ sessionId: 's1' })).resolves.toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('probes different sessions independently', async () => {
    const fetchSpy = stubFetch({ ok: true, value: { acceptsImages: true } })
    vi.stubGlobal('fetch', fetchSpy)
    const check = createImageCapabilityChecker()
    await check({ sessionId: 's1' })
    await check({ sessionId: 's2' })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('answers false without fetching when the session carries no id', async () => {
    const fetchSpy = stubFetch({ ok: true, value: { acceptsImages: true } })
    vi.stubGlobal('fetch', fetchSpy)
    const check = createImageCapabilityChecker()
    await expect(check({ prompt: () => Promise.resolve({ ok: true }) })).resolves.toBe(false)
    await expect(check(null)).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed and caches the conservative answer when the fetch fails', async () => {
    const fetchSpy = vi.fn(async (): Promise<Response> => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchSpy)
    const check = createImageCapabilityChecker()
    await expect(check({ sessionId: 's1' })).resolves.toBe(false)
    await expect(check({ sessionId: 's1' })).resolves.toBe(false)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
