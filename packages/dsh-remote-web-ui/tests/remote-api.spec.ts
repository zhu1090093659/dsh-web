/**
 * The remote desktop channel (`/remote/api`) over a real HTTP server: the
 * paired-cookie gate, the loopback-only method denial, envelope round-trips
 * through the SDK's own fetch handler, and query-string preservation.
 */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { PairingService } from '../src/pairing.ts'
import { LOOPBACK_ONLY_METHODS, makeRemoteApiRoutes } from '../src/remote-api.ts'

function makeService(): PairingService {
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  }, {
    now: () => 1_000_000,
    randomToken: () => 'tok-1',
  })
  service.setLanBases([{ address: '192.168.1.5', base: 'http://192.168.1.5:3080' }])
  return service
}

/** A paired device cookie for the service. */
function pairedCookie(service: PairingService): string {
  service.issue()
  const accepted = service.accept('tok-1')
  if (!accepted.ok) throw new Error('accept failed')
  return `dsh_pair=${accepted.deviceId}`
}

/** The channel routes over a fake carrier (keeps tests off the SDK graph). */
function makeRoutesForTest(service: PairingService): WebRoute[] {
  const api = makeApiProxy()
  return makeRemoteApiRoutes({ service, apiProxy: api, apiFetch: makeCarrier(api), port: 1 })
}

/** Fake ApiProxy: session.list answers a marker value; sessionLog echoes bytes. */
function makeApiProxy(): ApiProxy {
  return {
    sessions: {
      list: async () => ({ ok: true, value: { items: [] } }),
    },
    downloads: {
      sessionLog: async () => new Response('export-bytes', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
    },
  } as unknown as ApiProxy
}

/**
 * A minimal carrier with the SDK fetch handler's contract (the real one is
 * pinned by tests/remote-contract.spec.ts): POST /api/<method> validates the
 * envelope and dispatches; GET /api/session.export serves the download.
 */
function makeCarrier(api: ApiProxy): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/api/session.export' && request.method === 'GET') {
      return await (api as unknown as { downloads: { sessionLog(): Promise<Response> } }).downloads.sessionLog()
    }
    if (request.method !== 'POST') return new Response('not found', { status: 404 })
    const method = url.pathname.slice('/api/'.length)
    if (method !== 'session.list') return new Response('not found', { status: 404 })
    const body = JSON.parse(await request.text()) as { type?: string; rpcId?: string; method?: string }
    if (body.type !== 'client-request' || typeof body.rpcId !== 'string' || body.method !== method) {
      return Response.json({
        type: 'server-response',
        rpcId: typeof body.rpcId === 'string' ? body.rpcId : 'invalid-request',
        result: { ok: false, error: { code: 'bad-request', message: 'invalid client-request message', details: { issues: [] } } },
      }, { status: 200 })
    }
    const result = await (api as unknown as { sessions: { list(): Promise<{ ok: true; value: unknown }> } }).sessions.list()
    return Response.json({ type: 'server-response', rpcId: body.rpcId, result })
  }
}

interface TestServer {
  port: number
  close: () => Promise<void>
}

/** Serve the route family from a real server (prefix-aware). */
async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(r => (r.kind === 'prefix' ? pathname === r.path || pathname.startsWith(`${r.path}/`) : r.path === pathname))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

/** One raw call returning status, headers, and the body bytes. */
async function call(
  port: number,
  method: string,
  path: string,
  opts: { body?: string; cookie?: string } = {},
): Promise<{ status: number; contentType: string | undefined; body: string }> {
  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: `tunnel.example.com` }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.cookie !== undefined) headers.cookie = opts.cookie
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            contentType: response.headers['content-type'],
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    if (opts.body !== undefined) req.write(opts.body)
    req.end()
  })
}

const ENVELOPE = (rpcId: string, method: string, payload: unknown): string =>
  JSON.stringify({ type: 'client-request', rpcId, method, payload })

describe('remote desktop channel (/remote/api)', () => {
  it('refuses unpaired requests with a SDK-shaped envelope carrying the rpcId', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-9', 'session.list', {}) })
      expect(result.status).toBe(403)
      const body = JSON.parse(result.body) as { type: string; rpcId: string; result: { ok: boolean; error: { code: string } } }
      expect(body.type).toBe('server-response')
      expect(body.rpcId).toBe('rpc-9')
      expect(body.result.ok).toBe(false)
      expect(body.result.error.code).toBe('unpaired')
    } finally {
      await close()
    }
  })

  it('refuses an unknown device cookie like a missing one', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', {
        body: ENVELOPE('rpc-1', 'session.list', {}),
        cookie: 'dsh_pair=unknown-device',
      })
      expect(result.status).toBe(403)
    } finally {
      await close()
    }
  })

  it('round-trips a paired session.list envelope through the SDK fetch handler', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', {
        body: ENVELOPE('rpc-2', 'session.list', {}),
        cookie,
      })
      expect(result.status).toBe(200)
      expect(result.contentType).toContain('application/json')
      const body = JSON.parse(result.body) as { type: string; rpcId: string; result: { ok: boolean } }
      expect(body.type).toBe('server-response')
      expect(body.rpcId).toBe('rpc-2')
      expect(body.result.ok).toBe(true)
    } finally {
      await close()
    }
  })

  it('denies every loopback-only method with a forbidden envelope', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      for (const method of LOOPBACK_ONLY_METHODS) {
        const result = await call(port, 'POST', `/remote/api/${method}`, {
          body: ENVELOPE(`rpc-${method}`, method, {}),
          cookie,
        })
        expect(result.status, method).toBe(403)
        const body = JSON.parse(result.body) as { rpcId: string; result: { ok: boolean; error: { code: string } } }
        expect(body.result.ok, method).toBe(false)
        expect(body.result.error.code, method).toBe('forbidden')
      }
    } finally {
      await close()
    }
  })

  it('preserves the query string for GET downloads (session.export)', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      const result = await call(port, 'GET', '/remote/api/session.export?sessionId=s-1&includeDescendants=1', { cookie })
      expect(result.status).toBe(200)
      expect(result.body).toBe('export-bytes')
    } finally {
      await close()
    }
  })

  it('rejects unknown shapes: wrong method, bare prefix, bad segments', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRoutesForTest(service))
    try {
      expect((await call(port, 'PUT', '/remote/api/session.list', { cookie })).status).toBe(405)
      expect((await call(port, 'POST', '/remote/api/', { body: ENVELOPE('r', 'x', {}), cookie })).status).toBe(404)
      expect((await call(port, 'POST', '/remote/api/a/b', { body: ENVELOPE('r', 'a', {}), cookie })).status).toBe(404)
    } finally {
      await close()
    }
  })
})
