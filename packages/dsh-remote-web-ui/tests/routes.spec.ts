/** The /api/pair route family over a real HTTP server: fences, token flow, cookies. */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PairingService } from '../src/pairing.ts'
import { makeRoutes } from '../src/routes.ts'

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

interface TestServer {
  port: number
  close: () => Promise<void>
}

/** Serve the route family from a real server. */
async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const route = routes.find(r => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      return r.kind === 'exact' && r.path === pathname
    })
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

/** One JSON call; host spoofs the authority a browser would send. */
async function call(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  opts: { host?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; cookies: string[] }> {
  return await new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const headers: Record<string, string> = { host: opts.host ?? `127.0.0.1:${String(port)}` }
    for (const [name, value] of Object.entries(opts.headers ?? {})) {
      if (name.toLowerCase() !== 'host') headers[name] = value
    }
    if (payload !== undefined) headers['content-type'] = 'application/json'
    if (opts.cookie !== undefined) headers.cookie = opts.cookie
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks: Buffer[] = []
        const setCookie = response.headers['set-cookie'] ?? []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: Record<string, unknown> = {}
          try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* empty body */ }
          resolve({ status: response.statusCode ?? 0, body, cookies: setCookie })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** Read the first SSE `data:` frame then abort the stream. */
async function readFirstSse(port: number, path: string): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host: `127.0.0.1:${String(port)}` } },
      (response) => {
        let buf = ''
        response.on('data', (chunk) => {
          buf += String(chunk)
          const match = /data: (.+)\n\n/.exec(buf)
          if (match?.[1] === undefined) return
          try {
            const parsed = JSON.parse(match[1]) as Record<string, unknown>
            req.destroy()
            resolve(parsed)
          } catch (error) {
            req.destroy()
            reject(error)
          }
        })
      },
    )
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET' || error.message.includes('aborted')) return
      reject(error)
    })
    req.end()
  })
}

describe('/api/pair routes', () => {
  it('runs the full flow: issue (loopback) → accept (LAN) → cookie → reuse refused', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      // The LAN authority cannot issue (loopback-only control plane).
      const lanIssue = await call(port, 'POST', '/api/pair/issue', { host: '192.168.1.5:3080' })
      expect(lanIssue.status).toBe(403)
      // Loopback issues; the URL embeds the token and workspace target.
      const issued = await call(port, 'POST', '/api/pair/issue', { body: { workspaceId: 'ws-7' } })
      expect(issued.status).toBe(200)
      expect(issued.body.url).toMatch(/^http:\/\/192\.168\.1\.5:3080\/m\/\?pair=tok-1&workspace=ws-7$/)
      expect(issued.body.lanAddresses).toEqual(['192.168.1.5'])
      // A LAN phone accepts: sets the HttpOnly device cookie.
      const accepted = await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 'tok-1' } })
      expect(accepted.status).toBe(200)
      expect(accepted.cookies[0]).toMatch(/^dsh_pair=tok-1; Path=\/; HttpOnly; SameSite=Lax/)
      // The same token is one-time: reuse is refused.
      const reused = await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 'tok-1' } })
      expect(reused.status).toBe(409)
      expect(reused.body.code).toBe('used')
      // The paired cookie heartbeats and reports status.
      const heartbeat = await call(port, 'POST', '/api/pair/heartbeat', { host: '192.168.1.5:3080', cookie: 'dsh_pair=tok-1' })
      expect(heartbeat.status).toBe(200)
      const status = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080', cookie: 'dsh_pair=tok-1' })
      expect(status.body).toMatchObject({ ok: true, paired: true, phase: 'connected' })
    } finally {
      await close()
    }
  })

  it('refuses unknown/expired tokens and unpaired heartbeats', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      const bad = await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 'nope' } })
      expect(bad.status).toBe(404)
      const noCookie = await call(port, 'POST', '/api/pair/heartbeat', { host: '192.168.1.5:3080' })
      expect(noCookie.status).toBe(401)
    } finally {
      await close()
    }
  })

  it('issues against a requested LAN address and refuses unknown literals', async () => {
    const service = makeService()
    service.setLanBases([
      { address: '192.168.1.5', base: 'http://192.168.1.5:3080' },
      { address: '10.0.0.3', base: 'http://10.0.0.3:3080' },
    ])
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5', '10.0.0.3'] }))
    try {
      const chosen = await call(port, 'POST', '/api/pair/issue', { body: { address: '10.0.0.3' } })
      expect(chosen.status).toBe(200)
      expect(chosen.body.url).toMatch(/^http:\/\/10\.0\.0\.3:3080\/m\/\?pair=tok-1$/)
      expect(chosen.body.lanAddresses).toEqual(['192.168.1.5', '10.0.0.3'])
      const unknown = await call(port, 'POST', '/api/pair/issue', { body: { address: '192.0.2.1' } })
      expect(unknown.status).toBe(400)
      expect(unknown.body.code).toBe('unknown-address')
    } finally {
      await close()
    }
  })

  it('stop revokes devices and the token from the control plane', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      const token = issued.body.token as string
      await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token } })
      const stopped = await call(port, 'POST', '/api/pair/stop', {})
      expect(stopped.status).toBe(200)
      // The consumed token cannot be re-accepted after stop (invalid, not used).
      const after = await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token } })
      expect(after.status).toBe(404)
      // The paired cookie no longer heartbeats.
      const heartbeat = await call(port, 'POST', '/api/pair/heartbeat', { host: '192.168.1.5:3080', cookie: `dsh_pair=${token}` })
      expect(heartbeat.status).toBe(401)
    } finally {
      await close()
    }
  })

  it('reports lan-required without a LAN bind (no dead QR)', async () => {
    const service = makeService()
    service.setLanBases([])
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: [] }))
    try {
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      expect(issued.status).toBe(409)
      expect(issued.body.code).toBe('lan-required')
    } finally {
      await close()
    }
  })

  it('publicBaseUrl: issues a public link and trusts the tunneled host on the phone fence', async () => {
    const service = makeService()
    service.setPublicBaseUrl('https://phone.example.com')
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      // Loopback issues; the default URL is now built from the public base.
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      expect(issued.status).toBe(200)
      expect(issued.body.url).toMatch(/^https:\/\/phone\.example\.com\/m\/\?pair=tok-1$/)
      expect(issued.body.publicBaseUrl).toBe('https://phone.example.com')
      expect(issued.body.lanAddresses).toEqual(['192.168.1.5'])
      // An explicit LAN address still mints a LAN URL (in-network fallback).
      const lan = await call(port, 'POST', '/api/pair/issue', { body: { address: '192.168.1.5' } })
      expect(lan.body.url).toMatch(/^http:\/\/192\.168\.1\.5:3080\/m\/\?pair=tok-1$/)
      // The tunneled host passes the phone-facing fence: accept + status work.
      const accepted = await call(port, 'POST', '/api/pair/accept', { host: 'phone.example.com', body: { token: 'tok-1' } })
      expect(accepted.status).toBe(200)
      expect(accepted.cookies[0]).toMatch(/^dsh_pair=tok-1; Path=\//)
      const heartbeat = await call(port, 'POST', '/api/pair/heartbeat', { host: 'phone.example.com', cookie: 'dsh_pair=tok-1' })
      expect(heartbeat.status).toBe(200)
      const status = await call(port, 'GET', '/api/pair/status', { host: 'phone.example.com', cookie: 'dsh_pair=tok-1' })
      expect(status.body).toMatchObject({ ok: true, paired: true, phase: 'connected' })
      // The tunneled host is NOT trusted on the loopback-only control plane.
      const publicIssue = await call(port, 'POST', '/api/pair/issue', { host: 'phone.example.com' })
      expect(publicIssue.status).toBe(403)
      const publicStop = await call(port, 'POST', '/api/pair/stop', { host: 'phone.example.com' })
      expect(publicStop.status).toBe(403)
    } finally {
      await close()
    }
  })

  it('publicBaseUrl alone satisfies the reachable-bind requirement (loopback-only server)', async () => {
    const service = makeService()
    service.setLanBases([])
    service.setPublicBaseUrl('https://phone.example.com:8443')
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: [] }))
    try {
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      expect(issued.status).toBe(200)
      expect(issued.body.url).toMatch(/^https:\/\/phone\.example\.com:8443\/m\/\?pair=tok-1$/)
      // The fence matches the authority verbatim, port included.
      const accepted = await call(port, 'POST', '/api/pair/accept', { host: 'phone.example.com:8443', body: { token: 'tok-1' } })
      expect(accepted.status).toBe(200)
      const wrongPort = await call(port, 'POST', '/api/pair/heartbeat', { host: 'phone.example.com:9999', cookie: 'dsh_pair=tok-1' })
      expect(wrongPort.status).toBe(403)
    } finally {
      await close()
    }
  })

  it('publishes the live desktop gate policy without exposing sensitive state', async () => {
    const service = makeService()
    let requirePairingForLan = false
    const { port, close } = await serve(makeRoutes({
      service,
      lanAddresses: ['192.168.1.5'],
      requirePairingForLan: () => requirePairingForLan,
    }))
    try {
      const disabled = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080' })
      expect(disabled.body).toMatchObject({ ok: true, paired: false, requirePairingForLan: false })
      requirePairingForLan = true
      const enabled = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080' })
      expect(enabled.body).toMatchObject({ ok: true, paired: false, requirePairingForLan: true })
      expect(enabled.body).not.toHaveProperty('deviceCount')
    } finally {
      await close()
    }
  })

  it('redacts the pairing oracle fields from unpaired status callers', async () => {
    const service = makeService()
    service.setPublicBaseUrl('https://phone.example.com')
    service.setTunnelStatus({ state: 'running', url: 'https://xyz.trycloudflare.com' })
    service.issue('ws-7', undefined)
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      // No cookie: only pairing-relevant fields, no token/device/tunnel oracle.
      const unpaired = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080' })
      expect(unpaired.status).toBe(200)
      expect(unpaired.body).toMatchObject({ ok: true, paired: false, requirePairingForLan: true, phase: 'waiting', lanAvailable: true })
      expect(unpaired.body).not.toHaveProperty('tokenId')
      expect(unpaired.body).not.toHaveProperty('tokenExpiresAt')
      expect(unpaired.body).not.toHaveProperty('deviceCount')
      expect(unpaired.body).not.toHaveProperty('onlineCount')
      expect(unpaired.body).not.toHaveProperty('publicUrl')
      expect(unpaired.body).not.toHaveProperty('tunnel')
      // A live device cookie sees the full snapshot.
      await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 'tok-1' } })
      const paired = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080', cookie: 'dsh_pair=tok-1' })
      expect(paired.body).toMatchObject({ ok: true, paired: true, phase: 'connected' })
      expect(paired.body).toHaveProperty('deviceCount')
      expect(paired.body).toHaveProperty('onlineCount')
      expect(paired.body).toHaveProperty('tokenExpiresAt')
    } finally {
      await close()
    }
  })

  it('partitions the accept rate-limit buckets by the client-visible XFF hop', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      // Distinct XFF clients each get their own bucket: none trips the limit.
      for (let index = 0; index < 12; index += 1) {
        const attempt = await call(port, 'POST', '/api/pair/accept', {
          host: '192.168.1.5:3080',
          body: { token: 'nope' },
          headers: { 'x-forwarded-for': '203.0.113.' + String(index) },
        })
        expect(attempt.status).not.toBe(429)
      }
      // One client exhausting its bucket is rate-limited from attempt 12 on.
      for (let index = 0; index < 11; index += 1) {
        await call(port, 'POST', '/api/pair/accept', {
          host: '192.168.1.5:3080',
          body: { token: 'nope' },
          headers: { 'x-forwarded-for': '198.51.100.7' },
        })
      }
      const limited = await call(port, 'POST', '/api/pair/accept', {
        host: '192.168.1.5:3080',
        body: { token: 'nope' },
        headers: { 'x-forwarded-for': '198.51.100.7' },
      })
      expect(limited.status).toBe(429)
    } finally {
      await close()
    }
  })

  it('rejects non-GET/POST methods with 405', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      const status = await call(port, 'GET', '/api/pair/issue', {})
      expect(status.status).toBe(405)
    } finally {
      await close()
    }
  })

  it('malformed payloads are refused with the existing error shape', async () => {
    const service = makeService()
    service.setLanBases([{ address: '192.168.1.5', base: 'http://192.168.1.5:3080' }])
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      const badIssue = await call(port, 'POST', '/api/pair/issue', { body: { address: 42 } })
      expect(badIssue.status).toBe(400)
      expect(badIssue.body).toEqual({ ok: false, code: 'bad-payload' })
      const badAccept = await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 7 } })
      expect(badAccept.status).toBe(400)
      expect(badAccept.body).toEqual({ ok: false, code: 'bad-payload' })
    } finally {
      await close()
    }
  })

  it('omits the device roster from status even for a paired cookie', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      await call(port, 'POST', '/api/pair/issue', {})
      await call(port, 'POST', '/api/pair/accept', {
        host: '192.168.1.5:3080',
        body: { token: 'tok-1' },
        headers: { 'user-agent': 'Mozilla/5.0 TestPhone' },
      })
      const status = await call(port, 'GET', '/api/pair/status', { host: '192.168.1.5:3080', cookie: 'dsh_pair=tok-1' })
      expect(status.body).toMatchObject({ ok: true, paired: true, deviceCount: 1 })
      expect(status.body).not.toHaveProperty('devices')
    } finally {
      await close()
    }
  })

  it('pushes the device roster on the loopback events stream', async () => {
    const service = makeService()
    service.issue()
    service.accept('tok-1', 'Mozilla/5.0 TestPhone')
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      const frame = await readFirstSse(port, '/api/pair/events')
      expect(frame.type).toBe('state')
      expect(frame.devices).toEqual([
        expect.objectContaining({ id: 'tok-1', online: true, userAgent: 'Mozilla/5.0 TestPhone' }),
      ])
    } finally {
      await close()
    }
  })

  it('revokes one device from loopback and refuses LAN revoke', async () => {
    const service = makeService()
    const { port, close } = await serve(makeRoutes({ service, lanAddresses: ['192.168.1.5'] }))
    try {
      await call(port, 'POST', '/api/pair/issue', {})
      await call(port, 'POST', '/api/pair/accept', { host: '192.168.1.5:3080', body: { token: 'tok-1' } })
      const lanRevoke = await call(port, 'POST', '/api/pair/revoke', {
        host: '192.168.1.5:3080',
        body: { deviceId: 'tok-1' },
      })
      expect(lanRevoke.status).toBe(403)
      expect(service.hasDevice('tok-1')).toBe(true)
      const revoked = await call(port, 'POST', '/api/pair/revoke', { body: { deviceId: 'tok-1' } })
      expect(revoked.status).toBe(200)
      expect(service.hasDevice('tok-1')).toBe(false)
      const missing = await call(port, 'POST', '/api/pair/revoke', { body: { deviceId: 'tok-1' } })
      expect(missing.status).toBe(404)
    } finally {
      await close()
    }
  })
})
