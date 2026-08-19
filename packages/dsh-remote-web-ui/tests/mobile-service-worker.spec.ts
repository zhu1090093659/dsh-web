import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const ORIGIN = 'https://dsh.example'
const CACHE_NAME = 'dsh-remote-mobile-shell-v2'

type WorkerRequest = { method: string; mode: string; url: string }
type FetchListener = (event: { request: WorkerRequest; respondWith(response: Promise<Response> | Response): void }) => void

interface WorkerHarness {
  dispatch(request: WorkerRequest): Promise<Response | undefined>
  setCached(path: string, response: Response): void
}

function cacheKey(input: unknown): string {
  const url = typeof input === 'string' ? input : (input as { url: string }).url
  return new URL(url, ORIGIN).href
}

async function loadWorker(fetcher: (request: WorkerRequest) => Promise<Response>): Promise<WorkerHarness> {
  const handlers = new Map<string, FetchListener>()
  const entries = new Map<string, Response>()
  const cache = {
    add: async (input: unknown): Promise<void> => {
      const key = cacheKey(input)
      entries.set(key, (await fetcher({ method: 'GET', mode: 'same-origin', url: key })).clone())
    },
    match: async (input: unknown): Promise<Response | undefined> => entries.get(cacheKey(input))?.clone(),
    put: async (input: unknown, response: Response): Promise<void> => { entries.set(cacheKey(input), response.clone()) },
  }
  const caches = {
    open: async (_name: string) => cache,
    keys: async () => [CACHE_NAME],
    delete: async (_name: string) => true,
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: FetchListener): void => { handlers.set(type, listener) },
  }
  const source = await readFile(new URL('../assets/mobile-service-worker.js', import.meta.url), 'utf8')
  runInNewContext(source, { Error, Promise, Response, Set, URL, caches, fetch: fetcher, self })
  const fetchListener = handlers.get('fetch')
  if (fetchListener === undefined) throw new Error('worker did not register a fetch listener')

  return {
    setCached: (path, response) => { entries.set(new URL(path, ORIGIN).href, response.clone()) },
    dispatch: async (request) => {
      let response: Promise<Response> | undefined
      fetchListener({
        request,
        respondWith: (value) => { response = Promise.resolve(value) },
      })
      return response === undefined ? undefined : await response
    },
  }
}

describe('mobile service worker', () => {
  it('returns the static offline page for a 503 mobile navigation instead of cached shell HTML', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('upstream unavailable', { status: 503 }))
    const worker = await loadWorker(fetcher)
    worker.setCached('/m/', new Response('stale mobile shell'))
    worker.setCached('/m/offline.html', new Response('offline page'))

    const response = await worker.dispatch({ method: 'GET', mode: 'navigate', url: ORIGIN + '/m/' })
    expect(response).toBeDefined()
    expect(await response?.text()).toBe('offline page')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('uses cached static bundle content only when its network request fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    const worker = await loadWorker(fetcher)
    worker.setCached('/m/mobile.js', new Response('cached mobile bundle'))

    const response = await worker.dispatch({ method: 'GET', mode: 'same-origin', url: ORIGIN + '/m/mobile.js' })
    expect(response).toBeDefined()
    expect(await response?.text()).toBe('cached mobile bundle')
  })

  it('does not intercept the paired-device mobile API channel', async () => {
    const fetcher = vi.fn()
    const worker = await loadWorker(fetcher)

    const response = await worker.dispatch({ method: 'GET', mode: 'same-origin', url: ORIGIN + '/m/api/mobile.preferences' })
    expect(response).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
