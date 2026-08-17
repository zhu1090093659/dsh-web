import { describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the apply chain needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => ({
    get: () => init,
    set: () => {},
    subscribe: () => () => {},
  }),
}))
import { apply } from '../src/client/index.ts'
import { createDesktopShortcut, DesktopLauncherApiError } from '../src/client/api.ts'

describe('desktop-launcher client apply', () => {
  it('registers the plugin settings card into the Web UI plugin group', () => {
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
          getSnapshot: () => ({ status: 'unavailable' as const, writable: false }),
          subscribe: () => () => {},
          set: async () => {},
          unset: async () => {},
        }),
      },
    }
    apply(ctx as never)
    expect(injected).toEqual(['web-ui.plugin.item'])
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
      expect(init?.method).toBe('POST')
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
