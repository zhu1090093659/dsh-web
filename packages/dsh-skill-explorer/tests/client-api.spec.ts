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

  it('user listing skills gets an explicit Headers instance even without a body (issue #1609)', async () => {
    // Given a third-party fetch wrapper that inspects init.headers on every call
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

    // When the client lists skills without a request body
    const api = new SkillApi()
    const result = await api.list()

    // Then the request carries a real Headers instance and no body content type
    expect(result.cwd).toBe('/test')
    expect(capturedInit?.headers).toBeInstanceOf(Headers)
    expect((capturedInit?.headers as Headers).get('content-type')).toBeNull()
  })

  it('user listing one directory gets its cwd URL-encoded', async () => {
    // Given a directory path supplied by the caller
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ cwd: '/my/path', projectRoots: [], complete: true, groups: [] }), { status: 200 })
    }) as unknown as typeof fetch

    // When the client lists that directory
    const api = new SkillApi()
    await api.list('/my/path')

    // Then the cwd travels as an encoded query parameter
    expect(capturedUrl).toBe('/api/dsh-skill-explorer/list?cwd=%2Fmy%2Fpath')
  })

  it('user enabling a skill sends application/json with the picked state', async () => {
    // Given a skill the caller wants to enable
    let capturedInit: RequestInit | undefined
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ name: 'test-skill', enabled: true, modelInvocable: true }), { status: 200 })
    }) as unknown as typeof fetch

    // When the client enables it
    const api = new SkillApi()
    await api.setEnabled('test-skill', '/path/to/skill', true)

    // Then the request is a JSON POST carrying the skill identity and the state
    expect(capturedInit?.method).toBe('POST')
    expect(capturedInit?.headers).toBeInstanceOf(Headers)
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/path/to/skill',
      enabled: true,
    })
  })

  it('user reading one skill gets name and path URL-encoded', async () => {
    // Given a skill whose name and path contain spaces
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(JSON.stringify({ name: 'my skill', path: '/a b/SKILL.md', description: 'd', content: 'body' }), { status: 200 })
    }) as unknown as typeof fetch

    // When the client reads that skill
    const api = new SkillApi()
    const result = await api.read('my skill', '/a b/SKILL.md')

    // Then both coordinates travel URL-encoded and the body comes back
    expect(capturedUrl).toBe('/api/dsh-skill-explorer/read?name=my%20skill&path=%2Fa%20b%2FSKILL.md')
    expect(result.content).toBe('body')
  })

  it('user saving an edit posts the edited fields to the update route', async () => {
    // Given an edited skill document
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(JSON.stringify({ ok: true, name: 'test-skill', path: '/path/SKILL.md', disabled: false }), { status: 200 })
    }) as unknown as typeof fetch

    // When the client saves the edit
    const api = new SkillApi()
    await api.update({ name: 'test-skill', path: '/path/SKILL.md', description: 'new', whenToUse: 'when', content: 'body' })

    // Then the update route receives a JSON POST with every edited field
    expect(capturedUrl).toBe('/api/dsh-skill-explorer/update')
    expect(capturedInit?.method).toBe('POST')
    expect((capturedInit?.headers as Headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(capturedInit?.body as string)).toEqual({
      name: 'test-skill',
      path: '/path/SKILL.md',
      description: 'new',
      whenToUse: 'when',
      content: 'body',
    })
  })

  it('user whose delete is rejected sees the server error message', async () => {
    // Given a server that rejects the delete with a JSON error
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'skill is locked' }), { status: 400 })
    }) as unknown as typeof fetch

    // When the client removes the skill
    const api = new SkillApi()

    // Then the ApiError carries the server message
    await expect(api.remove('test', '/path')).rejects.toThrow(ApiError)
    await expect(api.remove('test', '/path')).rejects.toThrow('skill is locked')
  })

  it('user hitting a non-JSON error sees the HTTP status instead', async () => {
    // Given a server answer whose body is not JSON
    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 })
    }) as unknown as typeof fetch

    // When the client lists skills
    const api = new SkillApi()

    // Then the error falls back to the plain HTTP status
    await expect(api.list()).rejects.toThrow('HTTP 404')
  })
})
