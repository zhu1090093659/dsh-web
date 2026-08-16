/**
 * Route-layer tests: the loopback fence, method checks, payload validation,
 * and success paths through a real loopback HTTP server.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeRoutes } from '../src/routes.ts'
import { API, type ListResponse, type SetEnabledResponse } from '../src/protocol.ts'
import type { PluginManagerService } from '../src/core/service.ts'

/** In-memory service stub for route-level tests. */
class StubService {
  list(): { ok: true; value: ListResponse } {
    return {
      ok: true,
      value: {
        entries: [{
          entryId: 'ui-task-board',
          moduleName: '@linxin666/dsh-client-ui-task-board',
          enabled: true,
          fiberPhase: 'active',
          protected: false,
          official: true,
        }],
      },
    }
  }

  async setEnabled(entryId: string, enabled: boolean): Promise<{ ok: true; value: SetEnabledResponse } | { ok: false; error: { code: string; message: string } }> {
    if (entryId === 'missing') {
      return { ok: false, error: { code: 'unknown-entry', message: 'plugin entry "missing" is not loaded' } }
    }
    return {
      ok: true,
      value: { entryId, enabled, applied: true, persisted: true, deferred: false },
    }
  }
}

const service = (stub: StubService): PluginManagerService => stub as unknown as PluginManagerService

let server: Server
let port: number
let stub: StubService

beforeAll(async () => {
  stub = new StubService()
  const routes = makeRoutes({ service: service(stub) })
  server = createServer((req, res) => {
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    const route = routes.find(item => item.kind === 'exact' && item.path === rawPath)
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    void route.handler(req, res)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => resolve()) })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('loopback fence', () => {
  it('rejects cross-site requests with 403', async () => {
    const response = await fetch(url(API.list), {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(403)
  })

  it('rejects non-loopback Host headers with 403', async () => {
    const response = await new Promise<{ status: number }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: API.list, method: 'POST', headers: { host: 'evil.example.com' } }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }))
      })
      req.on('error', reject)
      req.end('{}')
    })
    expect(response.status).toBe(403)
  })

  it('rejects wrong methods with 405', async () => {
    const response = await fetch(url(API.list))
    expect(response.status).toBe(405)
  })
})

describe('list', () => {
  it('returns the decorated inventory', async () => {
    const response = await fetch(url(API.list), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(200)
    const body = await response.json() as ListResponse
    expect(body.entries[0]?.entryId).toBe('ui-task-board')
  })
})

describe('setEnabled', () => {
  it('toggles a plugin', async () => {
    const response = await fetch(url(API.setEnabled), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId: 'ui-task-board', enabled: false }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as SetEnabledResponse
    expect(body).toMatchObject({ entryId: 'ui-task-board', enabled: false, applied: true, persisted: true })
  })

  it('maps unknown entries to 404', async () => {
    const response = await fetch(url(API.setEnabled), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId: 'missing', enabled: false }),
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe('unknown-entry')
  })

  it('rejects an invalid payload', async () => {
    const response = await fetch(url(API.setEnabled), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entryId: 'ui-task-board' }),
    })
    expect(response.status).toBe(400)
  })
})
