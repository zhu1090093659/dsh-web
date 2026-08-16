/**
 * Route-layer tests: the loopback fence, method checks, payload validation,
 * and success paths through a real loopback HTTP server.
 */

import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeRoutes } from '../src/routes.ts'
import { API, type SkillRow } from '../src/core/protocol.ts'
import type { SkillManagerService } from '../src/core/service.ts'

/** In-memory service stub for route-level tests. */
class StubService {
  rows: SkillRow[] = []
  async list(sessionId: string) {
    if (sessionId !== 's1') {
      return { ok: false as const, error: { code: 'session-not-found', message: 'session "x" not found' } }
    }
    return { ok: true as const, value: { skills: this.rows, cwd: '/work', live: true } }
  }

  async toggle() {
    return { ok: true as const, value: { name: 'alpha', path: '/skills/alpha/SKILL.md', modelInvocable: false, userInvocable: false } }
  }

  async install() {
    return { ok: true as const, value: { entries: [{ name: 'alpha', kind: 'dir' as const, path: '/skills/alpha' }] } }
  }

  async uninstall() {
    return { ok: true as const, value: { name: 'alpha', path: '/skills/alpha' } }
  }
}

const service = (stub: StubService): SkillManagerService => stub as unknown as SkillManagerService

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
  it('returns the decorated catalog', async () => {
    stub.rows = [{
      name: 'alpha',
      description: 'A demo skill.',
      source: 'user-dsh',
      provider: 'filesystem',
      path: '/skills/alpha/SKILL.md',
      toggleable: true,
      installed: false,
      modelInvocable: true,
      userInvocable: true,
    }]
    const response = await fetch(url(API.list), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { skills: SkillRow[] }
    expect(body.skills[0]?.name).toBe('alpha')
  })

  it('maps session failures to 404', async () => {
    const response = await fetch(url(API.list), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'nope' }),
    })
    expect(response.status).toBe(404)
    const body = await response.json() as { code?: string }
    expect(body.code).toBe('session-not-found')
  })

  it('rejects a missing sessionId', async () => {
    const response = await fetch(url(API.list), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(400)
  })
})

describe('toggle / install / uninstall', () => {
  it('toggles a skill', async () => {
    const response = await fetch(url(API.toggle), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', name: 'alpha', enabled: false }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { modelInvocable: boolean }
    expect(body.modelInvocable).toBe(false)
  })

  it('rejects an invalid toggle payload', async () => {
    const response = await fetch(url(API.toggle), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', name: 'alpha' }),
    })
    expect(response.status).toBe(400)
  })

  it('installs skills', async () => {
    const response = await fetch(url(API.install), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', source: { kind: 'dir', value: '/src' }, destination: 'user' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { entries: { name: string }[] }
    expect(body.entries[0]?.name).toBe('alpha')
  })

  it('rejects an invalid destination', async () => {
    const response = await fetch(url(API.install), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', source: { kind: 'dir', value: '/src' }, destination: 'elsewhere' }),
    })
    expect(response.status).toBe(400)
  })

  it('uninstalls a skill', async () => {
    const response = await fetch(url(API.uninstall), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', name: 'alpha' }),
    })
    expect(response.status).toBe(200)
  })
})