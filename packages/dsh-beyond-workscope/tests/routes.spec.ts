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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GrantRegistry } from '../src/grants.ts'
import { API_PREFIX } from '../src/protocol.ts'
import { makeRoutes } from '../src/routes.ts'
import { WorkspaceLedger } from '../src/workspaces.ts'

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

describe('workspace routes', () => {
  let base: string
  let registry: GrantRegistry
  let ledger: WorkspaceLedger
  let server: Server
  let port: number

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'workscope-ws-routes-'))
    registry = new GrantRegistry({ confirmTimeoutMs: 30_000, maxActivePerSession: 4, maxPendingPerSession: 2, auditCap: 100 })
    ledger = new WorkspaceLedger()
    server = createServer((req, res) => {
      const route = makeRoutes(registry, {
        ledger,
        audit: (sessionId, kind, detail) => registry.appendAudit(sessionId, kind, detail),
        sessionInfo: async (sessionId) => sessionId === 's1' ? { id: 's1', cwd: base, title: '测试会话' } : undefined,
      }).find(route => route.path === req.url?.split('?')[0])
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

  it('records a sub-workspace in the ledger when the user approves', async () => {
    const dir = join(base, 'ws-target')
    await mkdir(dir)
    const outcome = registry.requestWorkspace('s1', dir, '项目工作区', '持续开发')
    await new Promise(resolve => setTimeout(resolve, 50))

    const pending = await jsonFetch(`${API_PREFIX}/pending`).then(r => r.json())
    expect(pending.pending[0]).toMatchObject({ kind: 'workspace', title: '项目工作区', path: dir })

    const approve = await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pending.pending[0].id }),
    })
    expect(approve.status).toBe(200)
    await expect(outcome).resolves.toMatchObject({ status: 'active' })

    // Session-scoped ledger record; the confirmation is NOT a grant.
    expect(ledger.list('s1')).toHaveLength(1)
    expect(ledger.list('s1')[0]).toMatchObject({ path: dir, title: '项目工作区', sessionId: 's1' })
    expect(registry.activeGrants('s1')).toHaveLength(0)
    expect(ledger.covers('s1', join(dir, 'x.txt'))).toBe(true)

    const workspaces = await jsonFetch(`${API_PREFIX}/workspaces`).then(r => r.json())
    expect(workspaces.workspaces).toHaveLength(1)
    expect(workspaces.workspaces[0].title).toBe('项目工作区')
    expect(workspaces.workspaces[0].workspaceId).toBeUndefined()
  })

  it('serves session metadata for the 会话信息 tab', async () => {
    const info = await jsonFetch(`${API_PREFIX}/session-info?session=s1`).then(r => r.json())
    expect(info.session).toMatchObject({ id: 's1', cwd: base, title: '测试会话' })
    const missing = await jsonFetch(`${API_PREFIX}/session-info?session=nope`).then(r => r.json())
    expect(missing.session).toBeUndefined()
    const bare = await jsonFetch(`${API_PREFIX}/session-info`)
    expect(bare.status).toBe(400)
  })

  it('removes a sub-workspace registration through the route (non-destructive)', async () => {
    const dir = join(base, 'ws-remove')
    await mkdir(dir)
    const outcome = registry.requestWorkspace('s1', dir, '待移除', '测试')
    await new Promise(resolve => setTimeout(resolve, 50))
    const pending = await jsonFetch(`${API_PREFIX}/pending`).then(r => r.json())
    await jsonFetch(`${API_PREFIX}/pending/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: pending.pending[0].id }),
    })
    await outcome
    expect(ledger.list('s1')).toHaveLength(1)

    const remove = await jsonFetch(`${API_PREFIX}/workspaces/remove`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ledger.list('s1')[0].id }),
    })
    expect(remove.status).toBe(200)
    expect(await remove.json()).toMatchObject({ ok: true, removed: 1 })
    expect(ledger.list('s1')).toHaveLength(0)
    expect(ledger.covers('s1', dir)).toBe(false)
    const audit = await jsonFetch(`${API_PREFIX}/audit`).then(r => r.json())
    const kinds = audit.entries.map((entry: { kind: string }) => entry.kind)
    expect(kinds).toContain('workspace_removed')
  })

  it('answers 503 for workspace routes without the hooks', async () => {
    // A hook-less route family (grant-only deployments) rejects workspace use.
    const plainServer = createServer((req, res) => {
      const route = makeRoutes(new GrantRegistry({ confirmTimeoutMs: 30_000, maxActivePerSession: 4, maxPendingPerSession: 2, auditCap: 100 }))
        .find(route => route.path === req.url?.split('?')[0])
      if (route === undefined) {
        res.writeHead(404, { 'content-type': 'text/plain' })
        res.end('not found')
        return
      }
      void route.handler(req, res)
    })
    await new Promise<void>(resolve => plainServer.listen(0, '127.0.0.1', resolve))
    const plainPort = (plainServer.address() as AddressInfo).port
    try {
      const workspaces = await fetch(`http://127.0.0.1:${plainPort}${API_PREFIX}/workspaces`)
      expect(workspaces.status).toBe(503)
    } finally {
      await new Promise<void>(resolve => plainServer.close(() => resolve()))
    }
  })
})
