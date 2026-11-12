/**
 * The loopback reverse proxy's connection lifecycle over real HTTP servers:
 * an outer-client abort must stop the inner request, an inner reset must tear
 * the outer leg down without an unhandled error, and normal completion must
 * keep reusing the upstream keep-alive connection.
 */
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { InnerAuth } from '../src/inner-auth.ts'
import { proxyLoopbackHttp } from '../src/loopback-proxy.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

async function listen(server: Server): Promise<TestServer> {
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

/** Outer server whose every request is proxied to the given port. */
async function serveProxy(port: number): Promise<TestServer> {
  const server: Server = createServer((req, res) => { proxyLoopbackHttp(req, res, port, req.url ?? '/') })
  return await listen(server)
}

/** One client request; resolves with status, collected body, and the abort error if any. */
function call(port: number, opts: { method?: string; chunked?: boolean } = {}): Promise<{
  status: number | undefined
  body: string
  premature: boolean
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', ...(opts.chunked === true ? {} : {}) },
      (res) => {
        const chunks: Buffer[] = []
        let premature = false
        res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        res.on('error', () => { premature = true })
        res.on('close', () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), premature })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const settle = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * Poll a predicate until it holds or the deadline passes, then return its final
 * value. The proxy propagates an outer abort asynchronously; a loaded runner can
 * take longer than any fixed sleep, and polling keeps the assertion strict while
 * removing the load sensitivity (the deadline still fails a real regression).
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000, stepMs = 10): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await settle(stepMs)
  }
  return predicate()
}

describe('loopback proxy connection lifecycle', () => {
  it('stops the inner request when the outer client aborts mid-body', async () => {
    let innerCompleted = false
    let innerAborted = false
    const upstream: Server = createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        innerCompleted = true
        res.writeHead(200)
        res.end('ok')
      })
      // A proxy-side reset surfaces as ECONNRESET / 'aborted' on the inner request.
      req.on('error', () => { innerAborted = true })
      req.on('aborted', () => { innerAborted = true })
    })
    const up = await listen(upstream)
    const proxy = await serveProxy(up.port)
    try {
      // A chunked POST whose body never finishes: abort mid-flight.
      await new Promise<void>((resolve, _reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: proxy.port, method: 'POST' })
        req.on('error', () => { resolve() })
        req.write('partial-body-half')
        setTimeout(() => {
          req.destroy()
          resolve()
        }, 30)
      })
      const aborted = await waitFor(() => innerAborted)
      expect(innerCompleted).toBe(false)
      expect(aborted).toBe(true)
    } finally {
      await proxy.close()
      await up.close()
    }
  })

  it('tears the outer leg down when the inner response dies mid-stream', async () => {
    const upstream: Server = createServer((req, res) => {
      // Announce a longer body than will ever be sent, then truncate.
      res.writeHead(200, { 'content-length': '64' })
      res.write('half-')
      setTimeout(() => { res.destroy() }, 20)
    })
    const up = await listen(upstream)
    const proxy = await serveProxy(up.port)
    try {
      const result = await call(proxy.port)
      expect(result.status).toBe(200)
      expect(result.body).toBe('half-')
      expect(result.premature).toBe(true)
    } finally {
      await proxy.close()
      await up.close()
    }
  })

  it('keeps the upstream keep-alive connection across sequential proxied requests', async () => {
    let connections = 0
    const upstream: Server = createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('hello')
      })
    })
    upstream.on('connection', () => { connections += 1 })
    const up = await listen(upstream)
    const proxy = await serveProxy(up.port)
    try {
      for (let i = 0; i < 5; i += 1) {
        const result = await call(proxy.port)
        expect(result.status).toBe(200)
        expect(result.body).toBe('hello')
        expect(result.premature).toBe(false)
      }
      // One pooled socket serves every request: a naive close-hook that
      // destroyed the upstream on normal completion would open five.
      expect(connections).toBe(1)
    } finally {
      await proxy.close()
      await up.close()
    }
  })
})
interface Captured {
  headers: IncomingHttpHeaders
  body: string
}

/** Upstream that records each request it received and answers 200 JSON. */
async function serveEcho(): Promise<TestServer & { hits: Captured[] }> {
  const hits: Captured[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      hits.push({ headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  return { ...(await listen(server)), hits }
}

/** Outer server whose every request is proxied with the given inner credential. */
async function serveProxyWithAuth(port: number, auth: InnerAuth): Promise<TestServer> {
  const server: Server = createServer((req, res) => { proxyLoopbackHttp(req, res, port, req.url ?? '/', auth) })
  return await listen(server)
}

/** One POST through the proxy with explicit request headers. */
function post(port: number, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

/**
 * The re-issue forwards the caller headers it does not own: a plugin that
 * authenticates its calls with a marker of its own reaches its route through
 * the channel (issue #1925), while the authority, the tripwire marker, the
 * caller cookie, its device credential and the forwarding marks stay here.
 */
describe('loopback proxy request headers', () => {
  it('user keeps a plugin marker header on the re-issued request', async () => {
    // Given a plugin route that only answers when its own marker arrives
    const upstream = await serveEcho()
    const proxy = await serveProxy(upstream.port)
    try {
      // When a paired client posts through the channel with that marker
      const result = await post(proxy.port, '/api/dsh-im-connect/sessions/ensure', {
        'content-type': 'application/json',
        'x-dsh-im-connect-client': '1',
      }, '{"channel":"im-1"}')
      // Then the upstream route receives the marker and the body untouched
      expect(result.status).toBe(200)
      expect(upstream.hits).toHaveLength(1)
      expect(upstream.hits[0].headers['x-dsh-im-connect-client']).toBe('1')
      expect(upstream.hits[0].headers['content-type']).toBe('application/json')
      expect(upstream.hits[0].body).toBe('{"channel":"im-1"}')
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('user keeps the loopback authority, the same-origin marker and the inner credential', async () => {
    // Given a channel whose inner credential resolved and a client that sent
    // its own authority, origin, cookie and a cross-site marker
    const upstream = await serveEcho()
    const auth: InnerAuth = { ready: async () => 'dsh-auth-abc=v1', invalidate: () => undefined }
    const proxy = await serveProxyWithAuth(upstream.port, auth)
    try {
      // When the request is re-issued to loopback
      await post(proxy.port, '/api/session.list', {
        host: 'tunnel.example.com',
        origin: 'https://tunnel.example.com',
        referer: 'https://tunnel.example.com/app',
        cookie: 'dsh_pair=device-1',
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      }, '{}')
      // Then the upstream sees the rewritten authority, the synthetic marker,
      // and the process credential in place of the pairing cookie
      const seen = upstream.hits[0].headers
      expect(seen.host).toBe(`127.0.0.1:${String(upstream.port)}`)
      expect(seen['sec-fetch-site']).toBe('same-origin')
      expect(seen.cookie).toBe('dsh-auth-abc=v1')
      expect(seen.origin).toBeUndefined()
      expect(seen.referer).toBeUndefined()
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })

  it('user device credential and forwarding marks never reach the upstream', async () => {
    // Given an edge that stamped forwarding marks and a client carrying its
    // own device credential, a hop-by-hop nomination, and a custom header
    const upstream = await serveEcho()
    const proxy = await serveProxy(upstream.port)
    try {
      // When the request is re-issued to loopback
      await post(proxy.port, '/api/pet/state', {
        'x-dsh-remote-device': 'device-1',
        'x-forwarded-for': '203.0.113.7',
        'cf-connecting-ip': '203.0.113.7',
        'x-real-ip': '203.0.113.7',
        'accept-encoding': 'gzip',
        'range': 'bytes=0-1',
        'sec-fetch-mode': 'navigate',
        connection: 'x-dsh-hop',
        'x-dsh-hop': '1',
        'x-dsh-pass': '2',
        'content-type': 'application/json',
      }, '{}')
      // Then only the header this channel does not own is forwarded
      const seen = upstream.hits[0].headers
      expect(seen['x-dsh-remote-device']).toBeUndefined()
      expect(seen['x-forwarded-for']).toBeUndefined()
      expect(seen['cf-connecting-ip']).toBeUndefined()
      expect(seen['x-real-ip']).toBeUndefined()
      expect(seen['accept-encoding']).toBeUndefined()
      expect(seen.range).toBeUndefined()
      expect(seen['sec-fetch-mode']).toBeUndefined()
      expect(seen['x-dsh-hop']).toBeUndefined()
      expect(seen['x-dsh-pass']).toBe('2')
      expect(seen['content-type']).toBe('application/json')
    } finally {
      await proxy.close()
      await upstream.close()
    }
  })
})
