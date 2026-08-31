/** The reopen service worker script: decision matrix over a mocked worker scope. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appServiceWorkerScript, PAIR_PATHS } from '../src/routes.ts'

type Handler = (event: FetchEventMock) => void

interface FetchEventMock {
  request: { method: string; mode: string; url: string }
  respondWith: (response: Promise<Response>) => void
  waitUntil: (promise: Promise<unknown>) => void
  waits: Promise<unknown>[]
}

const SHELL_CACHE = 'dsh-remote-shell-v1'
const SHELL_KEY = '/dsh-remote-shell'

/**
 * Evaluate the worker script against a fake ServiceWorkerGlobalScope: the
 * handlers register, `fetch` is the stubbed global, and CacheStorage is an
 * in-memory map.
 */
function makeScope(): {
  listeners: Record<string, Handler>
  stores: Map<string, Map<string, Response>>
  self: Record<string, unknown>
} {
  const listeners: Record<string, Handler> = {}
  const stores = new Map<string, Map<string, Response>>()
  const self = {
    addEventListener: (type: string, handler: Handler) => { listeners[type] = handler },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    caches: {
      open: vi.fn(async (name: string) => {
        let store = stores.get(name)
        if (store === undefined) {
          store = new Map<string, Response>()
          stores.set(name, store)
        }
        const chosen = store
        return { put: async (key: string, response: Response) => { chosen.set(key, response) } }
      }),
      match: vi.fn(async (key: string) => stores.get(SHELL_CACHE)?.get(key)),
      keys: vi.fn(async () => [...stores.keys()]),
      delete: vi.fn(async (name: string) => { stores.delete(name) }),
    },
  }
  new Function('self', appServiceWorkerScript())(self)
  return { listeners, stores, self: self as Record<string, unknown> }
}

/** A navigation fetch event; `waits` collects the waitUntil promises. */
function navigationEvent(url = 'https://phone.example.com/', respondWith: (response: Promise<Response>) => void = () => undefined): FetchEventMock {
  const waits: Promise<unknown>[] = []
  return {
    request: { method: 'GET', mode: 'navigate', url },
    respondWith,
    waitUntil: (promise: Promise<unknown>) => { waits.push(promise) },
    waits,
  }
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reopen service worker script', () => {
  it('registers the install, activate, and fetch handlers', () => {
    const { listeners } = makeScope()
    expect(Object.keys(listeners).sort()).toEqual(['activate', 'fetch', 'install'])
  })

  it('ignores non-navigations and non-root paths', () => {
    const { listeners } = makeScope()
    const respondWith = vi.fn()
    for (const request of [
      { method: 'GET', mode: 'same-origin', url: 'https://phone.example.com/' },
      { method: 'POST', mode: 'navigate', url: 'https://phone.example.com/' },
      { method: 'GET', mode: 'navigate', url: 'https://phone.example.com/pair-app' },
      { method: 'GET', mode: 'navigate', url: 'https://phone.example.com/client.js' },
    ]) {
      listeners.fetch({ ...navigationEvent(), request, respondWith })
    }
    expect(respondWith).not.toHaveBeenCalled()
  })

  it('serves a live shell network-first and refreshes the cache', async () => {
    const { listeners, stores } = makeScope()
    const fetchMock = vi.fn(async () => htmlResponse('<html>fresh shell</html>'))
    vi.stubGlobal('fetch', fetchMock)
    let served: Promise<Response> | undefined
    const event = navigationEvent('https://phone.example.com/', (response) => { served = response })
    listeners.fetch(event)
    const body = await (served as Promise<Response>).then(r => r.text())
    expect(body).toBe('<html>fresh shell</html>')
    // The shell round trip is the only network call; the cache write rides
    // waitUntil and stores the shell under the fixed key.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/pair-app')
    await Promise.all(event.waits)
    expect((await stores.get(SHELL_CACHE)?.get(SHELL_KEY)?.text()) ?? '').toBe('<html>fresh shell</html>')
  })

  it('passes the navigation through when the app landing refuses', async () => {
    const { listeners } = makeScope()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse('gone', 404))
      .mockResolvedValueOnce(htmlResponse('harness 401', 401))
    vi.stubGlobal('fetch', fetchMock)
    let served: Promise<Response> | undefined
    listeners.fetch(navigationEvent('https://phone.example.com/', (response) => { served = response }))
    const body = await (served as Promise<Response>).then(r => r.text())
    expect(body).toBe('harness 401')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toMatchObject({ url: 'https://phone.example.com/' })
  })

  it('falls back to the cached shell when the server is unreachable', async () => {
    const { listeners, stores, self } = makeScope()
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('<html>warm shell</html>')))
    const install: FetchEventMock = { request: { method: 'GET', mode: 'navigate', url: 'https://phone.example.com/' }, respondWith: () => undefined, waitUntil: () => undefined, waits: [] }
    listeners.install(install)
    listeners.activate(install)
    // The install warms the shell and skips waiting; the activate claims the
    // open client. All three converge before the reopen below.
    await vi.waitFor(() => {
      expect(self.skipWaiting).toHaveBeenCalled()
      expect(self.clients.claim).toHaveBeenCalled()
      expect(stores.get(SHELL_CACHE)?.has(SHELL_KEY)).toBe(true)
    })

    // The reopen with a dead network answers from the warmed cache.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    let served: Promise<Response> | undefined
    listeners.fetch(navigationEvent('https://phone.example.com/', (response) => { served = response }))
    const body = await (served as Promise<Response>).then(r => r.text())
    expect(body).toBe('<html>warm shell</html>')
  })

  it('passes through when the server is unreachable and no shell is cached', async () => {
    const { listeners } = makeScope()
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(htmlResponse('harness 401', 401))
    vi.stubGlobal('fetch', fetchMock)
    let served: Promise<Response> | undefined
    listeners.fetch(navigationEvent('https://phone.example.com/', (response) => { served = response }))
    const body = await (served as Promise<Response>).then(r => r.text())
    expect(body).toBe('harness 401')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('prunes foreign caches on activate', async () => {
    const { listeners, stores } = makeScope()
    stores.set('dsh-remote-shell-v0', new Map())
    const event = navigationEvent()
    listeners.activate(event)
    await Promise.all(event.waits)
    expect(stores.has('dsh-remote-shell-v0')).toBe(false)
  })

  it('script path stays root-level so the default scope covers /', () => {
    expect(PAIR_PATHS.appServiceWorker.startsWith('/')).toBe(true)
    // Exactly ['', '<file>']: no directory component, so the script's
    // default scope is the site root.
    expect(PAIR_PATHS.appServiceWorker.split('/')).toHaveLength(2)
  })
})
