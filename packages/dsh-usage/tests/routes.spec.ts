import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { emptyTotals, type UsageOverviewView } from '../src/core/types.ts'
import type { UsageService } from '../src/host/usage-service.ts'
import { makeUsageOverviewRoute, makeUsageRefreshRoute, USAGE_API_PREFIX } from '../src/host/routes.ts'

/**
 * Route-surface tests: the loopback fence, the POST-only refresh method
 * gate, and the JSON response contract. The service is a stub — the
 * service-level behaviors live in usage-service.spec.ts.
 */

const OVERVIEW: UsageOverviewView = {
  updatedAt: 1,
  providers: [],
  current: { source: 'default' },
  usage: { today: { date: '2026-08-29', totals: emptyTotals(), providers: [] }, days: [] },
}

function stubService(overrides: Partial<Pick<UsageService, 'overview' | 'refresh'>> = {}): UsageService {
  return { overview: () => OVERVIEW, refresh: async () => {}, ...overrides } as unknown as UsageService
}

let server: Server
let port: number
let refreshes = 0

beforeAll(async () => {
  refreshes = 0
  const routes: WebRoute[] = [
    makeUsageOverviewRoute(stubService()),
    makeUsageRefreshRoute(stubService({ refresh: async () => { refreshes += 1 } })),
  ]
  server = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const url = (path: string) => `http://127.0.0.1:${port}${path}`

describe('usage routes', () => {
  it('serves the overview with family JSON headers and no-store', async () => {
    const res = await fetch(url(USAGE_API_PREFIX + '/overview'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(OVERVIEW)
  })

  it('answers 405 when the refresh endpoint is not POSTed', async () => {
    const res = await fetch(url(USAGE_API_PREFIX + '/refresh'))
    expect(res.status).toBe(405)
    expect(refreshes).toBe(0)
  })

  it('forces one probe cycle and answers with the fresh overview', async () => {
    const res = await fetch(url(USAGE_API_PREFIX + '/refresh'), { method: 'POST' })
    expect(res.status).toBe(200)
    expect(refreshes).toBe(1)
    expect(await res.json()).toEqual(OVERVIEW)
  })

  it('answers 500 when the refresh cycle fails', async () => {
    const routes = [makeUsageRefreshRoute(stubService({ refresh: async () => { throw new Error('probe boom') } }))]
    const state = { status: 0, body: '' }
    const res = {
      writeHead: (status: number) => { state.status = status },
      end: (body?: string) => { state.body = body ?? '' },
    } as unknown as ServerResponse
    await routes[0]!.handler({ method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } } as unknown as IncomingMessage, res)
    expect(state.status).toBe(500)
    expect(JSON.parse(state.body)).toEqual({ ok: false, error: 'probe boom' })
  })

  it('fences non-loopback clients out of both endpoints', () => {
    const probe = () => {
      const state = { status: 0, body: '' }
      return {
        res: {
          writeHead: (code: number) => { state.status = code },
          end: (chunk?: string) => { state.body = chunk ?? '' },
        },
        state,
      }
    }
    const lanRequest = { method: 'GET', socket: { remoteAddress: '192.168.1.9' }, headers: { host: '192.168.1.9:3080' } }

    const overview = probe()
    void makeUsageOverviewRoute(stubService()).handler(lanRequest as never, overview.res as never)
    expect(overview.state.status).toBe(403)
    expect(overview.state.body).toContain('loopback-only')

    const refresh = probe()
    void makeUsageRefreshRoute(stubService()).handler({ ...lanRequest, method: 'POST' } as never, refresh.res as never)
    expect(refresh.state.status).toBe(403)
  })

  it('fences cross-site browser requests even from a loopback socket', () => {
    const state = { status: 0, body: '' }
    const res = {
      writeHead: (code: number) => { state.status = code },
      end: (chunk?: string) => { state.body = chunk ?? '' },
    }
    const request = {
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
    }
    void makeUsageOverviewRoute(stubService()).handler(request as never, res as never)
    expect(state.status).toBe(403)
  })
})
