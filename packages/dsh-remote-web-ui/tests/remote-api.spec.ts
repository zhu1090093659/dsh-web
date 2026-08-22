/**
 * The remote desktop channel (`/remote`) over a real HTTP server: the
 * paired-cookie gate, the loopback-only denial, and HTTP reverse-proxy to a
 * loopback upstream (Host rewritten, Origin and cookies dropped).
 */
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PairingService } from '../src/pairing.ts'
import {
  innerPathOf,
  LOOPBACK_ONLY_METHODS,
  loopbackOnlyDenial,
  makeRemoteApiRoutes,
} from '../src/remote-api.ts'

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

function pairedCookie(service: PairingService): string {
  service.issue()
  const accepted = service.accept('tok-1')
  if (!accepted.ok) throw new Error('accept failed')
  return `dsh_pair=${accepted.deviceId}`
}

interface TestServer {
  port: number
  close: () => Promise<void>
}

interface UpstreamHit {
  method: string
  url: string
  host: string | undefined
  cookie: string | undefined
  origin: string | undefined
  secFetchSite: string | undefined
  body: string
}

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

async function startUpstream(reply: (req: IncomingMessage, hits: UpstreamHit[]) => { status: number; headers?: Record<string, string>; body: string }): Promise<TestServer & { hits: UpstreamHit[] }> {
  const hits: UpstreamHit[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    request.on('end', () => {
      hits.push({
        method: request.method ?? 'GET',
        url: request.url ?? '',
        host: typeof request.headers.host === 'string' ? request.headers.host : undefined,
        cookie: typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
        secFetchSite: typeof request.headers['sec-fetch-site'] === 'string' ? request.headers['sec-fetch-site'] : undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const out = reply(request, hits)
      response.writeHead(out.status, { 'content-type': 'application/json', ...out.headers })
      response.end(out.body)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    hits,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

async function call(
  port: number,
  method: string,
  path: string,
  opts: { body?: string; cookie?: string; origin?: string } = {},
): Promise<{ status: number; contentType: string | undefined; body: string }> {
  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: 'tunnel.example.com' }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    if (opts.cookie !== undefined) headers.cookie = opts.cookie
    if (opts.origin !== undefined) headers.origin = opts.origin
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

describe('innerPathOf / loopbackOnlyDenial', () => {
  it('strips /remote and rejects traversal', () => {
    expect(innerPathOf('/remote/api/session.list')).toBe('/api/session.list')
    expect(innerPathOf('/remote/api/pet/state')).toBe('/api/pet/state')
    expect(innerPathOf('/remote/sidebar/api/fs.tree')).toBe('/sidebar/api/fs.tree')
    expect(innerPathOf('/remote/pet/whale-girl/spritesheet.webp')).toBe('/pet/whale-girl/spritesheet.webp')
    expect(innerPathOf('/remote')).toBeUndefined()
    expect(innerPathOf('/remote/')).toBeUndefined()
    expect(innerPathOf('/remote/api/../secret')).toBeUndefined()
    expect(innerPathOf('/remote/api/%2e%2e%2fsecret')).toBeUndefined()
    expect(innerPathOf('/remote/api/%5csecret')).toBeUndefined()
  })

  it('denies privileged SDK methods, pairing, update, plugin-manager, desktop-launcher, and the settings bridge', () => {
    expect(loopbackOnlyDenial('/api/settings.update')).toBeDefined()
    expect(loopbackOnlyDenial('/api/pair')).toBeDefined()
    expect(loopbackOnlyDenial('/api/pair/status')).toBeDefined()
    expect(loopbackOnlyDenial('/api/pair/revoke')).toBeDefined()
    expect(loopbackOnlyDenial('/api/update/run')).toBeDefined()
    expect(loopbackOnlyDenial('/api/plugin-manager/install')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-desktop-launcher')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-desktop-launcher/shutdown')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-desktop-launcher/create')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-web-ui-settings')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-web-ui-settings/describe')).toBeDefined()
    expect(loopbackOnlyDenial('/api/dsh-web-ui-settings/mutate')).toBeDefined()
    expect(loopbackOnlyDenial('/api/session.list')).toBeUndefined()
    expect(loopbackOnlyDenial('/api/pet/state')).toBeUndefined()
    expect(loopbackOnlyDenial('/sidebar/api/fs.tree')).toBeUndefined()
  })
})

describe('remote desktop channel (/remote)', () => {
  it('refuses unpaired requests before forwarding', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: 1 }))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-9', 'session.list', {}) })
      expect(result.status).toBe(403)
      const body = JSON.parse(result.body) as { type: string; rpcId: string; result: { ok: boolean; error: { code: string } } }
      expect(body.type).toBe('server-response')
      expect(body.rpcId).toBe('invalid-request')
      expect(body.result.ok).toBe(false)
      expect(body.result.error.code).toBe('unpaired')
    } finally {
      await close()
    }
  })

  it('refuses an unknown device cookie like a missing one', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: 1 }))
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

  it('proxies a paired session.list to loopback without Origin or cookie', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream((req) => {
      if (req.url === '/api/session.list' && req.method === 'POST') {
        return { status: 200, body: JSON.stringify({ type: 'server-response', rpcId: 'rpc-2', result: { ok: true } }) }
      }
      return { status: 404, body: 'no' }
    })
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', {
        body: ENVELOPE('rpc-2', 'session.list', {}),
        cookie,
        origin: 'https://tunnel.example.com',
      })
      expect(result.status).toBe(200)
      expect(result.contentType).toContain('application/json')
      const body = JSON.parse(result.body) as { type: string; rpcId: string; result: { ok: boolean } }
      expect(body.rpcId).toBe('rpc-2')
      expect(body.result.ok).toBe(true)
      expect(upstream.hits).toHaveLength(1)
      expect(upstream.hits[0].url).toBe('/api/session.list')
      expect(upstream.hits[0].host).toBe(`127.0.0.1:${String(upstream.port)}`)
      expect(upstream.hits[0].cookie).toBeUndefined()
      expect(upstream.hits[0].origin).toBeUndefined()
      expect(upstream.hits[0].secFetchSite).toBe('same-origin')
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('proxies an unpaired request when the pairing policy is off', async () => {
    const service = makeService()
    const upstream = await startUpstream((req) => {
      if (req.url === '/api/session.list' && req.method === 'POST') {
        return { status: 200, body: JSON.stringify({ type: 'server-response', rpcId: 'rpc-open', result: { ok: true } }) }
      }
      return { status: 404, body: 'no' }
    })
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port, requirePairingForLan: false }))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-open', 'session.list', {}) })
      expect(result.status).toBe(200)
      expect(JSON.parse(result.body).result.ok).toBe(true)
      expect(upstream.hits).toHaveLength(1)
      expect(upstream.hits[0].url).toBe('/api/session.list')
      expect(upstream.hits[0].host).toBe('127.0.0.1:' + String(upstream.port))
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('re-reads the live pairing policy per request', async () => {
    const service = makeService()
    let policy = false
    const upstream = await startUpstream((req) => {
      if (req.url === '/api/session.list' && req.method === 'POST') {
        return { status: 200, body: JSON.stringify({ type: 'server-response', rpcId: 'rpc-' + String(upstream.hits.length), result: { ok: true } }) }
      }
      return { status: 404, body: 'no' }
    })
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port, requirePairingForLan: () => policy }))
    try {
      const open = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-a', 'session.list', {}) })
      expect(open.status).toBe(200)
      policy = true
      const locked = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-b', 'session.list', {}) })
      expect(locked.status).toBe(403)
      const body = JSON.parse(locked.body) as { result: { ok: boolean; error: { code: string } } }
      expect(body.result.ok).toBe(false)
      expect(body.result.error.code).toBe('unpaired')
      policy = false
      const openAgain = await call(port, 'POST', '/remote/api/session.list', { body: ENVELOPE('rpc-c', 'session.list', {}) })
      expect(openAgain.status).toBe(200)
      expect(upstream.hits.map(hit => hit.url)).toEqual(['/api/session.list', '/api/session.list'])
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('still denies loopback-only paths when the pairing policy is off', async () => {
    const service = makeService()
    const upstream = await startUpstream(() => ({ status: 200, body: '{"leaked":true}' }))
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port, requirePairingForLan: false }))
    try {
      const pair = await call(port, 'POST', '/remote/api/pair/status', { body: '{}' })
      expect(pair.status).toBe(403)
      const pairBody = JSON.parse(pair.body) as { result: { ok: boolean; error: { code: string } } }
      expect(pairBody.result.ok).toBe(false)
      expect(pairBody.result.error.code).toBe('forbidden')
      const privileged = await call(port, 'POST', '/remote/api/settings.update', { body: '{}' })
      expect(privileged.status).toBe(403)
      const privilegedBody = JSON.parse(privileged.body) as { result: { error: { code: string } } }
      expect(privilegedBody.result.error.code).toBe('forbidden')
      expect(upstream.hits).toHaveLength(0)
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('proxies plugin namespaces and sidebar paths the same way', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream((req) => {
      if (req.url === '/api/pet/state') return { status: 200, body: JSON.stringify({ ok: true, pet: 'whale' }) }
      if (req.url === '/sidebar/api/fs.tree') return { status: 200, body: JSON.stringify({ ok: true, value: { entries: [] } }) }
      return { status: 404, body: 'no' }
    })
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      const pet = await call(port, 'GET', '/remote/api/pet/state', { cookie })
      expect(pet.status).toBe(200)
      expect(JSON.parse(pet.body)).toEqual({ ok: true, pet: 'whale' })
      const sidebar = await call(port, 'POST', '/remote/sidebar/api/fs.tree', { cookie, body: '{}' })
      expect(sidebar.status).toBe(200)
      expect(JSON.parse(sidebar.body)).toEqual({ ok: true, value: { entries: [] } })
      expect(upstream.hits.map(hit => hit.url)).toEqual(['/api/pet/state', '/sidebar/api/fs.tree'])
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('denies every loopback-only method with a forbidden envelope', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: 1 }))
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
      const manager = await call(port, 'POST', '/remote/api/plugin-manager/install', { cookie, body: '{}' })
      expect(manager.status).toBe(403)
      expect(JSON.parse(manager.body).result.error.code).toBe('forbidden')
    } finally {
      await close()
    }
  })

  it('denies the pairing control plane to a paired remote desktop', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream(() => ({ status: 200, body: '{"leaked":true}' }))
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      for (const path of ['/remote/api/pair/status', '/remote/api/pair/revoke', '/remote/api/pair/issue']) {
        const result = await call(port, 'POST', path, { cookie, body: '{}' })
        expect(result.status, path).toBe(403)
        const body = JSON.parse(result.body) as { result: { error: { code: string } } }
        expect(body.result.error.code, path).toBe('forbidden')
      }
      expect(upstream.hits).toHaveLength(0)
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('denies the desktop-launcher control plane to a paired remote desktop', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream(() => ({ status: 200, body: '{"leaked":true}' }))
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      for (const path of ['/remote/api/dsh-desktop-launcher/shutdown', '/remote/api/dsh-desktop-launcher/create']) {
        const result = await call(port, 'POST', path, { cookie, body: '{}' })
        expect(result.status, path).toBe(403)
        const body = JSON.parse(result.body) as { result: { error: { code: string } } }
        expect(body.result.error.code, path).toBe('forbidden')
      }
      expect(upstream.hits).toHaveLength(0)
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('denies the family settings bridge to a paired remote desktop', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream(() => ({ status: 200, body: '{"leaked":true}' }))
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      for (const path of ['/remote/api/dsh-web-ui-settings/describe', '/remote/api/dsh-web-ui-settings/mutate']) {
        const result = await call(port, 'POST', path, { cookie, body: '{}' })
        expect(result.status, path).toBe(403)
        const body = JSON.parse(result.body) as { result: { error: { code: string } } }
        expect(body.result.error.code, path).toBe('forbidden')
      }
      expect(upstream.hits).toHaveLength(0)
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('preserves the query string for GET downloads (session.export)', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const upstream = await startUpstream((req) => {
      if (req.url === '/api/session.export?sessionId=s-1&includeDescendants=1') {
        return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: 'export-bytes' }
      }
      return { status: 404, body: 'no' }
    })
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: upstream.port }))
    try {
      const result = await call(port, 'GET', '/remote/api/session.export?sessionId=s-1&includeDescendants=1', { cookie })
      expect(result.status).toBe(200)
      expect(result.body).toBe('export-bytes')
    } finally {
      await close()
      await upstream.close()
    }
  })

  it('rejects unknown shapes: wrong method, bare prefix, traversal', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: 1 }))
    try {
      expect((await call(port, 'OPTIONS', '/remote/api/session.list', { cookie })).status).toBe(405)
      expect((await call(port, 'POST', '/remote/api/', { body: ENVELOPE('r', 'x', {}), cookie })).status).toBe(404)
      expect((await call(port, 'POST', '/remote/api/%2e%2e%2fsecret', { body: '{}', cookie })).status).toBe(404)
    } finally {
      await close()
    }
  })

  it('returns a fixed 502 message instead of the upstream error text', async () => {
    const service = makeService()
    const cookie = pairedCookie(service)
    const { port, close } = await serve(makeRemoteApiRoutes({ service, port: 1 }))
    try {
      const result = await call(port, 'POST', '/remote/api/session.list', {
        body: ENVELOPE('rpc-502', 'session.list', {}),
        cookie,
      })
      expect(result.status).toBe(502)
      expect(result.body).not.toContain('ECONNREFUSED')
      const body = JSON.parse(result.body) as { ok: boolean; error: { code: string; message: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('upstream-failure')
      expect(body.error.message).toBe('upstream request failed')
    } finally {
      await close()
    }
  })
})
