/**
 * SkillApi client-side tests: request headers, error handling, and defense
 * against third-party fetch wrappers that inspect init.headers.
 * test-standards-allow: client fetch wrapper unit tests
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, SkillApi } from '../src/client/api.ts'

describe('SkillApi', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('supplies an explicit Headers instance on GET requests without a body (issue #1609)', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      // Simulates third-party wrappers (e.g. Kaspersky) that access init.headers methods
      if (init && 'headers' in init) {
        if (init.headers === undefined) {
          throw new TypeError("Cannot read properties of undefined (reading 'toString')")
        }
      }
      return new Response(JSON.stringify({ cwd: '/test', projectRoots: [], complete: true, groups: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    const result = await api.list()

    expect(result.cwd).toBe('/test')
    expect(capturedInit).toBeDefined()
    expect(capturedInit?.headers).toBeInstanceOf(Headers)
    expect((capturedInit?.headers as Headers).get('content-type')).toBeNull()
  })

  it('encodes cwd query parameter on list when supplied', async () => {
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ cwd: '/my/path', projectRoots: [], complete: true, groups: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.list('/my/path')
    expect(capturedUrl).toBe('/api/dsh-skill-explorer/list?cwd=%2Fmy%2Fpath')
  })

  it('sets application/json content-type on POST requests with a body', async () => {
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ name: 'test-skill', enabled: true, modelInvocable: true }), { status: 200 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await api.setEnabled('test-skill', '/path/to/skill', true)

    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.headers).toBeInstanceOf(Headers)
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/path/to/skill',
      enabled: true,
    })
  })

  it('throws ApiError with error message from server on non-ok response', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'skill is locked' }), { status: 400 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await expect(api.remove('test', '/path')).rejects.toThrow(ApiError)
    await expect(api.remove('test', '/path')).rejects.toThrow('skill is locked')
  })

  it('falls back to HTTP status when error body is not JSON', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    const api = new SkillApi()
    await expect(api.list()).rejects.toThrow('HTTP 404')
  })
})
