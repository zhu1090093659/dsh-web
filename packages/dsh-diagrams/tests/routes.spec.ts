import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeRoutes } from '../src/routes.ts'
import { RUNTIME_ROUTE } from '../src/core/contract.ts'

/** Host context double: no pairing service, a recording logger. */
function fakeCtx() {
  return { get: () => undefined, logger: { warn: vi.fn() } }
}

/** Response double capturing status, headers and body. */
function fakeRes() {
  const headers: Record<string, string> = {}
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers[name] = value },
    end(body?: unknown) { res.body = body },
    headers,
  }
  return res
}

/** Request double shaped like a loopback browser request. */
function request(method: string, remoteAddress = '127.0.0.1'): IncomingMessage {
  return {
    method,
    url: RUNTIME_ROUTE,
    socket: { remoteAddress },
    headers: { host: '127.0.0.1:3080' },
  } as unknown as IncomingMessage
}

describe('mermaid vendor route', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** Stage a stand-in runtime bundle and return its path. */
  function stagedAsset(): string {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-diagrams-'))
    dirs.push(dir)
    const file = join(dir, 'mermaid.min.js')
    writeFileSync(file, 'window.mermaid={initialize(){},render(){}}')
    return file
  }

  it('user page loads the runtime from the host with an immutable cache header', () => {
    // Given a staged runtime bundle and a loopback request
    const assetPath = stagedAsset()
    const route = makeRoutes(fakeCtx() as never, { assetPath })[0]!
    const res = fakeRes()
    // When the browser half asks for it
    route.handler(request('GET'), res as unknown as ServerResponse)
    // Then the bundle is served as a script that may be cached forever
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/javascript; charset=utf-8')
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable')
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(String(res.body)).toContain('window.mermaid')
  })

  it('operator head probe gets the headers without a body', () => {
    // Given the same route
    const route = makeRoutes(fakeCtx() as never, { assetPath: stagedAsset() })[0]!
    const res = fakeRes()
    // When a HEAD probe arrives
    route.handler(request('HEAD'), res as unknown as ServerResponse)
    // Then the metadata is there and no payload is sent
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Length']).toBe(String(Buffer.byteLength('window.mermaid={initialize(){},render(){}}')))
    expect(res.body).toBeUndefined()
  })

  it('guest on the LAN is refused before the asset is read', () => {
    // Given the route and a request from the LAN
    const clickCtx = fakeCtx()
    const route = makeRoutes(clickCtx as never, { assetPath: stagedAsset() })[0]!
    const res = fakeRes()
    // When that request asks for the bundle
    route.handler(request('GET', '192.168.1.50'), res as unknown as ServerResponse)
    // Then it is refused
    expect(res.statusCode).toBe(403)
    expect(String(res.body)).toContain('forbidden')
  })

  it('user page falls back to code blocks when the bundle is missing, with one warning', () => {
    // Given a route whose asset was never copied by the build
    const ctx = fakeCtx()
    const route = makeRoutes(ctx as never, { assetPath: join(tmpdir(), 'dsh-diagrams-absent', 'mermaid.min.js') })[0]!
    const res = fakeRes()
    // When two requests arrive
    route.handler(request('GET'), res as unknown as ServerResponse)
    route.handler(request('GET'), fakeRes() as unknown as ServerResponse)
    // Then both answer 404 and the absence is reported once, not per request
    expect(res.statusCode).toBe(404)
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1)
  })

  it('operator finds the bundle read-only: other methods answer 405', () => {
    // Given the route
    const route = makeRoutes(fakeCtx() as never, { assetPath: stagedAsset() })[0]!
    const res = fakeRes()
    // When a POST arrives
    route.handler(request('POST'), res as unknown as ServerResponse)
    // Then the method is refused
    expect(res.statusCode).toBe(405)
  })
})
