/** PWA routes for the standalone /m mobile surface. */
import { createServer, request as httpRequest } from 'node:http'
import { inflateSync } from 'node:zlib'
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

interface DecodedPng {
  width: number
  height: number
  channels: number
  pixels: Buffer
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

/** Decode the 8-bit RGB/RGBA icons without adding a native image dependency. */
function decodePng(body: Buffer): DecodedPng {
  let width = 0
  let height = 0
  let channels = 0
  const compressed: Buffer[] = []
  for (let offset = 8; offset < body.length;) {
    const length = body.readUInt32BE(offset)
    const type = body.toString('ascii', offset + 4, offset + 8)
    const data = body.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data[8]).toBe(8)
      expect(data[12]).toBe(0)
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0
      expect(channels).toBeGreaterThan(0)
    } else if (type === 'IDAT') {
      compressed.push(data)
    }
    offset += length + 12
    if (type === 'IEND') break
  }

  const packed = inflateSync(Buffer.concat(compressed))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0, sourceOffset = 0; y < height; y++) {
    const filter = packed[sourceOffset++]
    for (let x = 0; x < stride; x++) {
      const encoded = packed[sourceOffset++] ?? 0
      const left = x >= channels ? pixels[y * stride + x - channels] ?? 0 : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] ?? 0 : 0
      const upperLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] ?? 0 : 0
      const predictor = filter === 0
        ? 0
        : filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? Math.floor((left + up) / 2)
              : paethPredictor(left, up, upperLeft)
      pixels[y * stride + x] = (encoded + predictor) & 0xff
    }
  }
  return { width, height, channels, pixels }
}

function expectVisibleMarkCentered(body: Buffer, maskable = false): void {
  const { width, height, channels, pixels } = decodePng(body)
  let count = 0
  let sumX = 0
  let sumY = 0
  let furthest = 0
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * channels
      const alpha = channels === 4 ? pixels[offset + 3] ?? 0 : 255
      const brightness = ((pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0)) / 3
      if (alpha < 128 || brightness < 128) continue
      count++
      sumX += x
      sumY += y
      furthest = Math.max(furthest, Math.hypot(x - centerX, y - centerY))
    }
  }
  expect(count).toBeGreaterThan(1_000)
  expect(Math.abs(sumX / count - centerX)).toBeLessThanOrEqual(1)
  expect(Math.abs(sumY / count - centerY)).toBeLessThanOrEqual(1)
  if (maskable) expect(furthest).toBeLessThanOrEqual(width * 0.4)
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
      expect(page.body).toContain('<link rel="apple-touch-icon" href="/m/apple-touch-icon-v2.png">')
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
          expect.objectContaining({ src: '/m/icon-192-v2.png', sizes: '192x192', purpose: 'any' }),
          expect.objectContaining({ src: '/m/icon-512-v2.png', sizes: '512x512', purpose: 'any' }),
          expect.objectContaining({ src: '/m/icon-maskable-512-v2.png', sizes: '512x512', purpose: 'maskable' }),
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
        { path: '/m/apple-touch-icon-v2.png', width: 180, height: 180 },
        { path: '/m/icon-192-v2.png', width: 192, height: 192 },
        { path: '/m/icon-512-v2.png', width: 512, height: 512 },
        { path: '/m/icon-maskable-512-v2.png', width: 512, height: 512 },
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

  it('keeps each visible DSH mark centered and the maskable mark inside its safe zone', async () => {
    const server = await serve(makeMobileRoutes())
    try {
      for (const icon of [
        { path: '/m/apple-touch-icon-v2.png', maskable: false },
        { path: '/m/icon-192-v2.png', maskable: false },
        { path: '/m/icon-512-v2.png', maskable: false },
        { path: '/m/icon-maskable-512-v2.png', maskable: true },
      ]) {
        expectVisibleMarkCentered(await getBytes(server.port, icon.path), icon.maskable)
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
