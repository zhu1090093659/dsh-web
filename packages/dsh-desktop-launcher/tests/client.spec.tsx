/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the apply chain needs.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
}))
import { apply } from '../src/client/index.ts'
import { createDesktopShortcut, DesktopLauncherApiError } from '../src/client/api.ts'
import { requestShutdown } from '../src/client/shutdown-api.ts'

describe('desktop-launcher client apply', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** One apply-ready client ctx; the settings snapshot is per-case. */
  function makeCtx(snapshot: unknown) {
    const injected: string[] = []
    const ctx = {
      effect: (fn: () => unknown) => fn(),
      get: () => undefined,
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (key: string) => { injected.push(key); return () => {} },
        register: () => () => {},
      },
      settingsScope: {
        bind: () => ({
          getSnapshot: () => snapshot,
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
    }
    return { ctx: ctx as never, injected }
  }

  it('registers the plugin settings card into the Web UI plugin group', () => {
    const { ctx, injected } = makeCtx({ status: 'unavailable' as const, writable: false })
    apply(ctx)
    expect(injected).toEqual(['web-ui.plugin.item'])
  })

  it('mounts no floating shutdown button while the plugin is off (default)', () => {
    const { ctx } = makeCtx({ status: 'ready' as const, writable: true, value: {} })
    apply(ctx)
    expect(document.querySelector('[data-dsh-shutdown-float]')).toBeNull()
  })

  it('mounts the floating shutdown button once the plugin is enabled', () => {
    const { ctx } = makeCtx({ status: 'ready' as const, writable: true, value: { enabled: true } })
    apply(ctx)
    expect(document.querySelector('[data-dsh-shutdown-float]')).toBeTruthy()
  })
})

describe('createDesktopShortcut api', () => {
  it('posts to the create route and returns the result', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ result: { ok: true, path: '/desktop/DSH.lnk', platform: 'win32' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const result = await createDesktopShortcut()
      expect(result.path).toBe('/desktop/DSH.lnk')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('/api/dsh-desktop-launcher/create')
      expect(init).toEqual({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports a plain-text transport error without hiding its detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('content type must be application/json', { status: 415 })))
    try {
      await expect(createDesktopShortcut()).rejects.toThrow('HTTP 415: content type must be application/json')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws the server error message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 })))
    try {
      await expect(createDesktopShortcut()).rejects.toThrow('boom')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('throws on invalid result payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { ok: false } }), { status: 200 })))
    try {
      await expect(createDesktopShortcut()).rejects.toThrow(DesktopLauncherApiError)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('requestShutdown api', () => {
  it('sends a valid empty JSON request', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await requestShutdown()
      expect(fetchMock.mock.calls[0]).toEqual([
        '/api/dsh-desktop-launcher/shutdown',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
