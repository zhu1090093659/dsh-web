/**
 * Route-family integration tests: spin the WebRoute handlers on a real
 * node:http server (the same shape the webServer serves) and exercise the
 * full confirm/deny/revoke flow plus the loopback fence.
 */

import { createServer, request, type Server } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GrantRegistry } from '../src/grants.ts'
import { API_PREFIX } from '../src/protocol.ts'
import { makeRoutes } from '../src/routes.ts'

describe('routes', () => {
  let base: string
  let registry: GrantRegistry
  let server: Server
  let port: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-routes-'))
    registry = new GrantRegistry({ confirmTimeoutMs: 30_000, maxActivePerSession: 4, maxPendingPerSession: 2, auditCap: 100 })
    server = createServer((req, res) => {
      const route = makeRoutes(registry).find(route => route.path === req.url?.split('?')[0])
      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    registry.dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(base, { recursive: true, force: true })
  })

  const url = (path: string): string => `http://127.0.0.1:${port}${path}`
  const jsonFetch = (path: string, init?: RequestInit): Promise<Response> => fetch(url(path), init)

  it('serves empty lists initially', async () => {
    const pending = await jsonFetch(`${API_PREFIX}/pending`).then(r => r.json())
    expect(pending).toEqual({ pending: [] })
    const grants = await jsonFetch(`${API_PREFIX}/grants`).then(r => r.json())
    expect(grants).toEqual({ grants: [] })
    const audit = await jsonFetch(`${API_PREFIX}/audit`).then(r => r.json())
    expect(audit).toEqual({ entries: [] })
  })

  it('completes a grant round trip through the routes', async () => {
    const dir = join(base, 'target')
    await mkdir(dir)

    // A tool-side request creates the pending grant.
    const outcome = registry.requestGrant('s1', dir, 'write', '整理合同')
    await new Promise(resolve => setTimeout(resolve, 50))

    const pending = await jsonFetch(`${API_PREFIX}/pending`).then(r => r.json())
    expect(pending.pending).toHaveLength(1)
    const grantId = pending.pending[0].id
    expect(pending.pending[0].path).toBe(dir)
    expect(pending.pending[0].scope).toBe('write')
    expect(pending.pending[0].expiresInMs).toBeGreaterThan(0)

    // Approve with a scope tightening.
    const approve = await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: grantId, scope: 'read' }),
    })
    expect(approve.status).toBe(200)
    const settled = await outcome
    expect(settled.status).toBe('active')
    expect(settled.scope).toBe('read')

    const grants = await jsonFetch(`${API_PREFIX}/grants`).then(r => r.json())
    expect(grants.grants).toHaveLength(1)
    expect(grants.grants[0].scope).toBe('read')

    // Revoke.
    const revoke = await jsonFetch(`${API_PREFIX}/grants/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: grantId }),
    })
    expect(revoke.status).toBe(200)
    const after = await jsonFetch(`${API_PREFIX}/grants`).then(r => r.json())
    expect(after.grants).toHaveLength(0)

    const audit = await jsonFetch(`${API_PREFIX}/audit`).then(r => r.json())
    const kinds = audit.entries.map((entry: { kind: string }) => entry.kind)
    expect(kinds).toEqual(expect.arrayContaining(['grant_requested', 'grant_approved', 'grant_revoked']))
  })

  it('denies through the routes', async () => {
    const dir = join(base, 'deny')
    await mkdir(dir)
    const outcome = registry.requestGrant('s1', dir, 'read', '拒绝我')
    await new Promise(resolve => setTimeout(resolve, 50))

    const pending = await jsonFetch(`${API_PREFIX}/pending`).then(r => r.json())
    const deny = await jsonFetch(`${API_PREFIX}/pending/deny`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pending.pending[0].id }),
    })
    expect(deny.status).toBe(200)
    await expect(outcome).resolves.toMatchObject({ status: 'denied' })
  })

  it('rejects unknown ids and malformed bodies with JSON errors', async () => {
    const approve = await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'nope' }),
    })
    expect(approve.status).toBe(404)
    expect(await approve.json()).toMatchObject({ ok: false })

    const missing = await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(missing.status).toBe(400)

    const noId = await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(noId.status).toBe(400)
  })

  it('fences foreign hosts and non-GET on GET routes', async () => {
    // undici forbids setting Host on fetch — use raw http.request to spoof it.
    const foreign = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: `${API_PREFIX}/pending`,
        headers: { host: 'evil.example.com' },
      }, response => {
        response.resume()
        resolve(response.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(foreign).toBe(403)

    const badMethod = await jsonFetch(`${API_PREFIX}/pending`, { method: 'POST', body: '{}' })
    expect(badMethod.status).toBe(405)
  })

  it('404s unknown paths', async () => {
    const response = await jsonFetch(`${API_PREFIX}/nope`)
    expect(response.status).toBe(404)
  })
})
