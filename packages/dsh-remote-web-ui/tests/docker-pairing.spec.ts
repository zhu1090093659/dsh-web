/**
 * Verification of Docker container bridged network and reverse-proxy pairing.
 * In containerized environments, internal network cards (e.g. 172.22.0.5) differ
 * from external host LAN addresses (e.g. 192.168.1.100:3080) or custom local domains.
 * This test suite guarantees tokens can pair directly from external hosts and that
 * dynamic trusted hosts and security boundaries work as designed.
 */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PairingService } from '../src/pairing.ts'
import { makeRoutes } from '../src/routes.ts'

function makeDockerService(): PairingService {
  const service = new PairingService({
    tokenTtlMs: 60_000,
    offlineAfterMs: 10_000,
    maxDevices: 4,
    cookieName: 'dsh_pair',
  }, {
    now: () => 1_000_000,
    randomToken: () => 'docker-tok-1',
  })
  // Internal container interface sampled by the node host
  service.setLanBases([{ address: '172.22.0.5', base: 'http://172.22.0.5:3080' }])
  return service
}

interface TestServer {
  port: number
  close: () => Promise<void>
}

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

async function call(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  opts: { host?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; cookies: string[]; location?: string }> {
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
          try { body = JSON.parse(raw) as Record<string, unknown> } catch {}
          resolve({
            status: response.statusCode ?? 0,
            body,
            cookies: setCookie,
            location: response.headers['location'],
          })
        })
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

describe('docker & reverse-proxy pairing adaptation', () => {
  it('accepts token directly from external host and dynamically trusts the host for subsequent calls', async () => {
    const service = makeDockerService()
    const { port, close } = await serve(makeRoutes({ service }))
    try {
      // 1. Issue a token from desktop loopback
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      expect(issued.status).toBe(200)
      expect(issued.body.token).toBe('docker-tok-1')

      const externalHost = '192.168.1.100:3080'

      // 2. Unpaired heartbeat from external host is rejected before pairing
      const initialHeartbeat = await call(port, 'POST', '/api/pair/heartbeat', {
        host: externalHost,
        cookie: 'dsh_pair=unknown-device',
      })
      expect(initialHeartbeat.status).toBe(403)

      // 3. Client uses token to pair with Host: 192.168.1.100:3080
      const acceptRes = await call(port, 'POST', '/api/pair/accept', {
        host: externalHost,
        body: { token: 'docker-tok-1' },
      })
      expect(acceptRes.status).toBe(200)
      expect(acceptRes.body.ok).toBe(true)
      const deviceId = acceptRes.body.deviceId as string
      expect(deviceId).toBeDefined()
      expect(acceptRes.cookies.length).toBeGreaterThan(0)
      expect(acceptRes.cookies[0]).toContain(`dsh_pair=${deviceId}`)

      // 4. Subsequent heartbeat from the newly trusted external host now passes
      const pairedHeartbeat = await call(port, 'POST', '/api/pair/heartbeat', {
        host: externalHost,
        cookie: `dsh_pair=${deviceId}`,
      })
      expect(pairedHeartbeat.status).toBe(200)
      expect(pairedHeartbeat.body.ok).toBe(true)
    } finally {
      await close()
    }
  })

  it('handles GET /pair-accept from external host and dynamically trusts it', async () => {
    const service = makeDockerService()
    const { port, close } = await serve(makeRoutes({ service }))
    try {
      // Issue token first
      const issued = await call(port, 'POST', '/api/pair/issue', {})
      expect(issued.status).toBe(200)

      const externalHost = '10.0.0.50:8080'
      const res = await call(port, 'GET', '/pair-accept?pair=docker-tok-1', {
        host: externalHost,
      })
      // Should redirect to app landing page
      expect(res.status).toBe(303)
      expect(res.location).toMatch(/pair-app\?grant=/)

      // Status check from the dynamically trusted host now passes lanFence
      const statusRes = await call(port, 'GET', '/api/pair/status', {
        host: externalHost,
      })
      expect(statusRes.status).toBe(200)
    } finally {
      await close()
    }
  })

  it('rejects cross-site attempts even if private LAN IP is targeted', async () => {
    const service = makeDockerService()
    const { port, close } = await serve(makeRoutes({ service }))
    try {
      await call(port, 'POST', '/api/pair/issue', {})
      const externalHost = '192.168.1.100:3080'

      // Sec-Fetch-Site: cross-site must be refused
      const crossSiteRes = await call(port, 'POST', '/api/pair/accept', {
        host: externalHost,
        body: { token: 'docker-tok-1' },
        headers: { 'sec-fetch-site': 'cross-site' },
      })
      expect(crossSiteRes.status).toBe(403)

      // Origin mismatch must be refused
      const originMismatchRes = await call(port, 'POST', '/api/pair/accept', {
        host: externalHost,
        body: { token: 'docker-tok-1' },
        headers: { origin: 'http://malicious-site.com' },
      })
      expect(originMismatchRes.status).toBe(403)
    } finally {
      await close()
    }
  })

  it('rejects non-private external hosts when not in trusted whitelist', async () => {
    const service = makeDockerService()
    const { port, close } = await serve(makeRoutes({ service }))
    try {
      await call(port, 'POST', '/api/pair/issue', {})
      // Public domain attempting accept without being configured in trusted hosts or publicBaseUrl
      const publicRes = await call(port, 'POST', '/api/pair/accept', {
        host: 'random-internet-host.org',
        body: { token: 'docker-tok-1' },
      })
      expect(publicRes.status).toBe(403)
    } finally {
      await close()
    }
  })

  it('supports explicit trustedHosts configuration', async () => {
    const service = makeDockerService()
    const customTrusted = ['dsh.homelab.internal:3080', '192.168.50.2:3080']
    const { port, close } = await serve(makeRoutes({
      service,
      trustedHosts: customTrusted,
    }))
    try {
      await call(port, 'POST', '/api/pair/issue', {})

      // Even before pairing, status request from pre-configured trusted host passes lanFence
      const statusRes = await call(port, 'GET', '/api/pair/status', {
        host: 'dsh.homelab.internal:3080',
      })
      expect(statusRes.status).toBe(200)

      // Token accept works smoothly on configured trusted host
      const acceptRes = await call(port, 'POST', '/api/pair/accept', {
        host: 'dsh.homelab.internal:3080',
        body: { token: 'docker-tok-1' },
      })
      expect(acceptRes.status).toBe(200)
    } finally {
      await close()
    }
  })
})
