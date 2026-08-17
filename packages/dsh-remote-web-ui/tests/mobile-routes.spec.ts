/** PWA routes for the standalone /m mobile surface. */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { makeMobileRoutes } from '../src/mobile-routes.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

interface GetResponse {
  status: number
  type: string
  headers: IncomingHttpHeaders
  body: string
}

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server = createServer((request, response) => {
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

async function get(port: number, path: string): Promise<GetResponse> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        const contentType = response.headers['content-type']
        resolve({
          status: response.statusCode ?? 0,
          type: typeof contentType === 'string' ? contentType : '',
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

async function getBytes(port: number, path: string): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('error', reject)
    req.end()
  })
}

function expectPngDimensions(body: Buffer, width: number, height: number): void {
  expect(Array.from(body.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(body.readUInt32BE(16)).toBe(width)
  expect(body.readUInt32BE(20)).toBe(height)
}

describe('mobile routes', () => {
  it('canonicalizes the legacy /m route and preserves workspace deep links', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const legacy = await get(server.port, '/m?workspace=ws-7')
      expect(legacy.status).toBe(308)
      expect(legacy.headers.location).toBe('/m/?workspace=ws-7')
      expect(legacy.headers['cache-control']).toBe('no-store')
    } finally {
      await server.close()
    }
  })

  it('serves the standalone PWA page shell at /m/', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const page = await get(server.port, '/m/')
      expect(page.status).toBe(200)
      expect(page.type).toContain('text/html')
      expect(page.body).toContain('<div id="root"></div>')
      expect(page.body).toContain('src="/m/mobile.js"')
      expect(page.body).toContain('viewport')
      expect(page.body).toContain('<link rel="manifest" href="/m/manifest.webmanifest">')
      expect(page.body).toContain('<link rel="apple-touch-icon" href="/m/apple-touch-icon.png">')
    } finally {
      await server.close()
    }
  })

  it('serves an installable manifest scoped to the canonical mobile route', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const response = await get(server.port, '/m/manifest.webmanifest')
      expect(response.status).toBe(200)
      expect(response.type).toContain('application/manifest+json')
      expect(JSON.parse(response.body)).toEqual(expect.objectContaining({
        id: '/m/',
        name: 'DSH Remote',
        short_name: 'DSH Remote',
        start_url: '/m/',
        scope: '/m/',
        display: 'standalone',
        icons: [
          expect.objectContaining({ src: '/m/icon-192.png', sizes: '192x192', purpose: 'any' }),
          expect.objectContaining({ src: '/m/icon-512.png', sizes: '512x512', purpose: 'any maskable' }),
        ],
      }))
    } finally {
      await server.close()
    }
  })

  it('serves the scoped worker with explicit cache and safety boundaries', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const worker = await get(server.port, '/m/service-worker.js')
      expect(worker.status).toBe(200)
      expect(worker.type).toContain('text/javascript')
      expect(worker.headers['cache-control']).toBe('no-cache')
      expect(worker.headers['service-worker-allowed']).toBe('/m/')
      expect(worker.body).toContain("url.pathname === '/m/api'")
      expect(worker.body).toContain("url.pathname === '/api'")
      expect(worker.body).toContain('networkFirst(request, OFFLINE_URL, false)')
      expect(worker.body).toContain('response.status >= 500')
      expect(worker.body).not.toContain('skipWaiting')
      expect(worker.body).not.toContain('clients.claim')
      expect(worker.body).not.toContain('BackgroundSync')
    } finally {
      await server.close()
    }
  })

  it('serves a static offline page without mobile data channels', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const offline = await get(server.port, '/m/offline.html')
      expect(offline.status).toBe(200)
      expect(offline.type).toContain('text/html')
      expect(offline.body).toContain('Cannot reach the running DSH host')
      expect(offline.body).not.toContain('/m/api')
      expect(offline.body).not.toContain('mobile.js')
    } finally {
      await server.close()
    }
  })

  it('serves the built mobile bundle at /m/mobile.js', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const bundle = await get(server.port, '/m/mobile.js')
      expect(bundle.status).toBe(200)
      expect(bundle.type).toContain('text/javascript')
      expect(bundle.body.length).toBeGreaterThan(1_000)
    } finally {
      await server.close()
    }
  })

  it('serves the iOS and PWA icon assets as valid PNGs', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      for (const icon of [
        { path: '/m/apple-touch-icon.png', width: 180, height: 180 },
        { path: '/m/icon-192.png', width: 192, height: 192 },
        { path: '/m/icon-512.png', width: 512, height: 512 },
      ]) {
        const response = await get(server.port, icon.path)
        expect(response.status).toBe(200)
        expect(response.type).toContain('image/png')
        expectPngDimensions(await getBytes(server.port, icon.path), icon.width, icon.height)
      }
    } finally {
      await server.close()
    }
  })

  it('answers 404 outside the mobile PWA route family', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const other = await get(server.port, '/m/other.js')
      expect(other.status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
