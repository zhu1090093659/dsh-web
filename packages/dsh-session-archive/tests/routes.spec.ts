// @vitest-environment node
import { describe, expect, it, afterAll } from 'vitest'
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { makeArchiveRoutes } from '../src/host/routes.ts'
import { ArchiveService, PlanMismatchError } from '../src/host/janitor.ts'
import { createFakeHost, fakeContext } from './fixtures.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

function startServer(routes: WebRoute[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const route = routes.find((candidate) => candidate.kind === 'exact' && candidate.path === url.pathname)
      if (route === undefined) {
        res.writeHead(404).end()
        return
      }
      void route.handler(req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

const servers: Server[] = []
afterAll(() => {
  for (const server of servers) server.close()
})

async function post(url: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url + path, { method: 'POST', body: JSON.stringify(body), headers })
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

async function get(url: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url + path, { headers })
  return { status: response.status, body: await response.json().catch(() => undefined) }
}

function makeService(): ArchiveService {
  const host = createFakeHost({ feedItems: [{ sessionId: 'session-a', updatedAt: 1 }], persistedIds: ['session-a'] })
  return new ArchiveService(fakeContext(host) as never, { dshHome: host.home })
}

describe('route fencing and contracts', () => {
  it('rejects non-loopback sockets with 403', async () => {
    const service = makeService()
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    // Same loopback socket but a cross-site marker is still rejected.
    const crossSite = await get(url, '/api/dsh-session-archive/inventory', { 'sec-fetch-site': 'cross-site' })
    expect(crossSite.status).toBe(403)
    // A foreign Host header is rejected even from loopback (raw request:
    // fetch forbids overriding Host).
    const foreignHost = await new Promise<{ status: number }>((resolve, reject) => {
      const target = new URL(url)
      const req = httpRequest({ host: target.hostname, port: target.port, path: '/api/dsh-session-archive/inventory', headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        resolve({ status: res.statusCode ?? 0 })
      })
      req.on('error', reject)
      req.end()
    })
    expect(foreignHost.status).toBe(403)
    const ok = await get(url, '/api/dsh-session-archive/inventory')
    expect(ok.status).toBe(200)
  })

  it('gates mutating routes to POST', async () => {
    const service = makeService()
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const response = await fetch(url + '/api/dsh-session-archive/delete')
    expect(response.status).toBe(405)
  })

  it('validates ids and bodies', async () => {
    const service = makeService()
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const noIds = await post(url, '/api/dsh-session-archive/archive', { ids: [] })
    expect(noIds.status).toBe(400)
    const badIds = await post(url, '/api/dsh-session-archive/archive', { ids: ['../etc/passwd'] })
    expect(badIds.status).toBe(400)
    const badPreview = await get(url, '/api/dsh-session-archive/preview?id=nope')
    expect(badPreview.status).toBe(400)
  })

  it('answers 409 with the host plan on a delete total mismatch', async () => {
    const host = createFakeHost({
      feedItems: [
        { sessionId: 'session-p', updatedAt: 1 },
        { sessionId: 'session-c', updatedAt: 2, parentSessionId: 'session-p' },
      ],
      persistedIds: ['session-p', 'session-c'],
    })
    const service = new ArchiveService(fakeContext(host) as never, { dshHome: host.home })
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const response = await post(url, '/api/dsh-session-archive/delete', { ids: ['session-p'], expectedTotal: 1 })
    expect(response.status).toBe(409)
    expect((response.body as { error: string }).error).toBe('plan-mismatch')
    expect((response.body as { plan: { targets: string[] } }).plan.targets.sort()).toEqual(['session-c', 'session-p'])
  })

  it('accepts bare-uuid ids (the harness native spelling) and canonicalizes them', async () => {
    const bare = '84777561-8adb-452d-a3ac-b25c7e72d36e'
    const host = createFakeHost({
      feedItems: [{ sessionId: bare, updatedAt: 1 }],
      persistedIds: [bare],
      archivedSessionIds: [bare],
      dirs: [bare],
    })
    host.ledger.entries[bare] = { archivedAt: 5, source: 'manual' }
    const service = new ArchiveService(fakeContext(host) as never, { dshHome: host.home })
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const response = await post(url, '/api/dsh-session-archive/delete', { ids: [bare], expectedTotal: 1 })
    expect(response.status).toBe(200)
    const body = response.body as { results: { id: string; status: string }[] }
    expect(body.results[0]?.id).toBe(`session-${bare}`)
    expect(body.results[0]?.status).toBe('ok')
    // The archive set (native bare spelling) is cleaned.
    expect(host.registry.state.archivedSessionIds).toEqual([])
  })

  it('rejects path-unsafe ids', async () => {
    const service = makeService()
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const response = await post(url, '/api/dsh-session-archive/delete', { ids: ['../../etc/passwd'] })
    expect(response.status).toBe(400)
  })

  it('answers 409 busy while another operation holds the lock', async () => {
    const host = createFakeHost({ feedItems: [{ sessionId: 'session-a', updatedAt: 1 }], persistedIds: ['session-a'] })
    // Gate the feed so the first archive stays mid-flight until released.
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const ctx = fakeContext(host) as { get(name: string): { list(): Promise<unknown> } }
    const controller = ctx.get('sessionController')
    const originalList = controller.list.bind(controller)
    controller.list = async (...args: unknown[]) => {
      await gate
      return originalList(...(args as []))
    }
    const service = new ArchiveService(ctx as never, { dshHome: host.home })
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const first = service.archive(['session-a'], 'manual')
    try {
      const busy = await post(url, '/api/dsh-session-archive/archive', { ids: ['session-a'] })
      expect(busy.status).toBe(409)
    } finally {
      release?.()
      await first
    }
  })

  it('serves the inventory document', async () => {
    const service = makeService()
    const { server, url } = await startServer(makeArchiveRoutes(service))
    servers.push(server)
    const response = await get(url, '/api/dsh-session-archive/inventory')
    expect(response.status).toBe(200)
    const body = response.body as { rows: unknown[]; auto: { cycleRunning: boolean } }
    expect(Array.isArray(body.rows)).toBe(true)
    expect(body.auto.cycleRunning).toBe(false)
  })
})

describe('PlanMismatchError carries the plan', () => {
  it('exposes the plan for the 409 body', () => {
    const error = new PlanMismatchError({ direct: [], descendants: [], skipped: [], targets: ['session-a'], totalBytes: 0 })
    expect(error.plan.targets).toEqual(['session-a'])
  })
})

describe('route paths are prefixed', () => {
  it('uses the documented API prefix', () => {
    const service = makeService()
    const routes = makeArchiveRoutes(service)
    for (const route of routes) {
      expect(route.path.startsWith('/api/dsh-session-archive/')).toBe(true)
    }
  })
})
