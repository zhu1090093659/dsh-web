/** The /m page routes: HTML shell served, the built mobile bundle served when present. */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { makeMobileRoutes } from '../src/mobile-routes.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
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

async function get(port: number, path: string): Promise<{ status: number; type: string; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          type: response.headers['content-type'] ?? '',
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('mobile routes', () => {
  it('serves the standalone page shell at /m with the bundle script tag', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const page = await get(server.port, '/m')
      expect(page.status).toBe(200)
      expect(page.type).toContain('text/html')
      expect(page.body).toContain('<div id="root"></div>')
      expect(page.body).toContain('src="/m/mobile.js"')
      expect(page.body).toContain('viewport')
    } finally {
      await server.close()
    }
  })

  it('declares the apple-touch-icon link in the page shell', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const page = await get(server.port, '/m')
      expect(page.status).toBe(200)
      expect(page.body).toContain('<link rel="apple-touch-icon" href="/m/apple-touch-icon.png">')
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

  it('serves the apple-touch-icon as a binary PNG at /m/apple-touch-icon.png', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const icon = await get(server.port, '/m/apple-touch-icon.png')
      expect(icon.status).toBe(200)
      expect(icon.type).toContain('image/png')
      // A valid PNG starts with the 8-byte signature; decode the PNG header to
      // confirm it is a real 180x180 image rather than a text error body.
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port: server.port, path: '/m/apple-touch-icon.png', method: 'GET' }, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          response.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.on('error', reject)
        req.end()
      })
      expect(Array.from(raw.subarray(0, 8))).toEqual(signature)
      // IHDR: width/height at byte offsets 16..23 (big-endian).
      expect(raw.readUInt32BE(16)).toBe(180)
      expect(raw.readUInt32BE(20)).toBe(180)
    } finally {
      await server.close()
    }
  })

  it('answers 404 outside the three mobile paths', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      const other = await get(server.port, '/m/other.js')
      expect(other.status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
