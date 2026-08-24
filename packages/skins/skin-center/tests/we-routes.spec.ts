/**
 * we-routes tests: real HTTP server over a synthetic wallpaper library,
 * asserting the inventory payload and token issuance, media streaming with
 * Range, the web route's shim injection and path-escape fence, the import /
 * reimport / remove lifecycle against a temp import store, and the
 * same-origin fence on POST routes.
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { TexFormat, decodePngToRgba } from '../src/pkg-extract.ts'
import { makeWeRoutes, SCENE_EXTRACTOR_VERSION, WE_API_PREFIX } from '../src/we-routes.ts'

// The probe path reads scene payloads through node:fs/promises; spy on it so
// the cache tests can assert exactly when a payload is (not) re-read.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

// The inventory cache must serve repeated /inventory calls without re-reading
// project.json or re-listing roots; wrap the sync fs readers so the cache
// tests can assert exactly when a full scan happens.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    readdirSync: vi.fn(actual.readdirSync),
  }
})

/** Minimal 1x1 RGBA8888 TEX (container v2, uncompressed) for scene decode tests. */
const tex1x1Red = ((): Buffer => {
  const enc = new TextEncoder()
  const nstr = (s: string): number[] => [...enc.encode(s), 0]
  const i32 = (v: number): number[] => {
    const b = new DataView(new ArrayBuffer(4))
    b.setInt32(0, v, true)
    return [...new Uint8Array(b.buffer)]
  }
  return Buffer.from([
    ...nstr('TEXV0005'), ...nstr('TEXI0001'),
    ...i32(TexFormat.RGBA8888), ...i32(0),
    ...i32(1), ...i32(1), ...i32(1), ...i32(1), ...i32(0),
    ...nstr('TEXB0002'), ...i32(1),
    ...i32(1), ...i32(1), ...i32(1),
    ...i32(0), ...i32(4), ...i32(4), 255, 0, 0, 255,
  ])
})()

/** 64x64 RGBA8888 TEX (scene layers below 64px are skipped as helpers). */
const tex64Red = ((): Buffer => {
  const enc = new TextEncoder()
  const nstr = (s: string): number[] => [...enc.encode(s), 0]
  const i32 = (v: number): number[] => {
    const b = new DataView(new ArrayBuffer(4))
    b.setInt32(0, v, true)
    return [...new Uint8Array(b.buffer)]
  }
  const px = 64 * 64 * 4
  const pixels: number[] = []
  for (let i = 0; i < 64 * 64; i++) pixels.push(255, 0, 0, 255)
  return Buffer.from([
    ...nstr('TEXV0005'), ...nstr('TEXI0001'),
    ...i32(TexFormat.RGBA8888), ...i32(0),
    ...i32(64), ...i32(64), ...i32(64), ...i32(64), ...i32(0),
    ...nstr('TEXB0002'), ...i32(1),
    ...i32(1), ...i32(64), ...i32(64),
    ...i32(0), ...i32(px), ...i32(px), ...pixels,
  ])
})()

/** Minimal 4x4 DXT1 TEX (one all-red block) for the /media .tex -> PNG path. */
const texDxt1Red = ((): Buffer => {
  const enc = new TextEncoder()
  const nstr = (s: string): number[] => [...enc.encode(s), 0]
  const i32 = (v: number): number[] => {
    const b = new DataView(new ArrayBuffer(4))
    b.setInt32(0, v, true)
    return [...new Uint8Array(b.buffer)]
  }
  return Buffer.from([
    ...nstr('TEXV0005'), ...nstr('TEXI0001'),
    ...i32(TexFormat.DXT1), ...i32(0),
    ...i32(4), ...i32(4), ...i32(4), ...i32(4), ...i32(0),
    ...nstr('TEXB0002'), ...i32(1),
    ...i32(1), ...i32(4), ...i32(4),
    ...i32(0), ...i32(8), ...i32(8),
    // c0 = 0xF800 (red), c1 = 0x07E0 (green), all 16 indices select c0
    0x00, 0xf8, 0xe0, 0x07, 0x00, 0x00, 0x00, 0x00,
  ])
})()

/** Minimal 4x4 BC7 TEX (recognized format with no decoder here) for
 *  unsupported-format scene-frame tests (#906). */
const texBc7 = ((): Buffer => {
  const enc = new TextEncoder()
  const nstr = (s: string): number[] => [...enc.encode(s), 0]
  const i32 = (v: number): number[] => {
    const b = new DataView(new ArrayBuffer(4))
    b.setInt32(0, v, true)
    return [...new Uint8Array(b.buffer)]
  }
  return Buffer.from([
    ...nstr('TEXV0005'), ...nstr('TEXI0001'),
    ...i32(TexFormat.BC7), ...i32(0),
    ...i32(4), ...i32(4), ...i32(4), ...i32(4), ...i32(0),
    ...nstr('TEXB0002'), ...i32(1),
    ...i32(1), ...i32(4), ...i32(4),
    ...i32(0), ...i32(16), ...i32(16), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ])
})()

let root: string
let library: string
let store: string
let server: Server
let port: number

function makeProject(dir: string, project: Record<string, unknown>, files: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project), 'utf8')
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

async function serve(routes: WebRoute[]): Promise<void> {
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(r => r.kind === 'exact'
      ? r.path === pathname
      : pathname === r.path || pathname.startsWith(r.path + '/'))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
}

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown>; raw: string; headers: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    // connection: close keeps server.close() in afterEach instant (an idle
    // keep-alive socket would otherwise hold it for seconds).
    const headers: Record<string, string> = { connection: 'close', ...opts.headers }
    let payload: string | undefined
    if (opts.body !== undefined) {
      payload = JSON.stringify(opts.body)
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* binary payload */ }
        resolve({ status: response.statusCode ?? 0, body, raw, headers: response.headers })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** Binary-safe HTTP GET for PNG payload assertions (call() decodes utf8). */
async function callRaw(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Buffer; headers: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method, headers: { connection: 'close', ...headers } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks), headers: response.headers }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'we-routes-'))
  library = join(root, 'library')
  store = join(root, 'store')
  makeProject(join(library, '111'), { title: 'Ocean', type: 'video', file: 'sea.mp4', preview: 'sea.jpg' }, {
    'sea.mp4': 'FAKE-VIDEO-BYTES',
    'sea.jpg': 'FAKE-IMAGE',
  })
  makeProject(join(library, '222'), { title: 'Particles', type: 'web', file: 'index.html' }, {
    'index.html': '<html><head><title>w</title></head><body>hi</body></html>',
    'app.js': 'console.log(1)',
  })
  makeProject(join(library, '333'), { title: 'Scene', type: 'scene', file: 'scene.pkg' }, {
    'scene.pkg': 'NOT-A-REAL-PKG',
  })
  const routes = makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store, autoDetect: false })
  await serve(routes)
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
  rmSync(root, { recursive: true, force: true })
})

describe('inventory', () => {
  it('lists the manual library with typed urls', async () => {
    const res = await call('GET', WE_API_PREFIX + '/inventory')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    const wallpapers = res.body.wallpapers as Array<Record<string, unknown>>
    expect(wallpapers).toHaveLength(3)
    const video = wallpapers.find(w => w.id === '111')
    expect(video?.type).toBe('video')
    expect(video?.playable).toBe(true)
    expect(String(video?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    const web = wallpapers.find(w => w.id === '222')
    expect(String(web?.webUrl)).toContain(WE_API_PREFIX + '/web/')
    const scene = wallpapers.find(w => w.id === '333')
    expect(scene?.playable).toBe(false)
    expect(String(scene?.frameUrl)).toContain(WE_API_PREFIX + '/scene-frame/')
  })

  it('probes scene capabilities lazily and fails closed on unreadable pkg', async () => {
    const inv = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (inv.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '333')
    expect(scene?.videoUrl).toBe(null)
    expect(scene?.sceneUrl).toBe(null)
    // scene.pkg in the fixture is not a real PKG: the probe fails closed.
    const probe = await call('GET', WE_API_PREFIX + '/scene-probe?id=333')
    expect(probe.status).toBe(200)
    expect(probe.body.ok).toBe(true)
    expect(probe.body.videoUrl).toBe(null)
    expect(probe.body.sceneUrl).toBe(null)
    // Unknown id 404s; missing id 400s; cross-site is fenced.
    expect((await call('GET', WE_API_PREFIX + '/scene-probe?id=999')).status).toBe(404)
    expect((await call('GET', WE_API_PREFIX + '/scene-probe')).status).toBe(400)
    expect((await call('GET', WE_API_PREFIX + '/scene-probe?id=333', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
  })

  it('rejects cross-site requests', async () => {
    const res = await call('GET', WE_API_PREFIX + '/inventory', { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })
})

describe('media and preview', () => {
  it('streams the file with Range support', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    const full = await call('GET', String(video?.videoUrl))
    expect(full.status).toBe(200)
    expect(full.raw).toBe('FAKE-VIDEO-BYTES')
    const partial = await call('GET', String(video?.videoUrl), { headers: { range: 'bytes=0-3' } })
    expect(partial.status).toBe(206)
    expect(partial.raw).toBe('FAKE')
    expect(String(partial.headers['content-range'])).toContain('bytes 0-3/')
  })

  it('destroys the source stream when the client disconnects', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    expect(String(video?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))

    let source: Readable | undefined
    let sent = false
    const routes = makeWeRoutes({
      getConfig: () => ({ weLibraryDirs: [library] }),
      storeDir: store,
      autoDetect: false,
      openReadStream: () => {
        source = new Readable({
          read() {
            if (!sent) {
              sent = true
              this.push(Buffer.from('x'))
            }
          },
        })
        return source
      },
    })
    await serve(routes)

    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: String(video?.videoUrl), method: 'GET' }, (response) => {
        response.once('data', () => response.destroy())
        response.once('close', resolve)
        response.once('error', reject)
      })
      req.once('error', reject)
      req.end()
    })
    if (!source?.destroyed) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('source stream stayed open after disconnect')), 1000)
        source?.once('close', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }

    expect(source?.destroyed).toBe(true)
  })

  it('contains source stream errors and keeps the server responsive', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    expect(String(video?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))

    let openCalls = 0
    const routes = makeWeRoutes({
      getConfig: () => ({ weLibraryDirs: [library] }),
      storeDir: store,
      autoDetect: false,
      openReadStream: () => {
        openCalls++
        return new Readable({
          read() { this.destroy(new Error('synthetic-read-failure')) },
        })
      },
    })
    await serve(routes)

    const outcome = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('stream error did not close the response')), 1000)
      const settle = (value: string) => {
        clearTimeout(timeout)
        resolve(value)
      }
      const req = httpRequest({ host: '127.0.0.1', port, path: String(video?.videoUrl), method: 'GET' }, (response) => {
        response.resume()
        response.once('aborted', () => settle('response-aborted'))
        response.once('close', () => settle('response-closed'))
        response.once('error', () => settle('response-error'))
      })
      req.once('error', () => settle('request-error'))
      req.end()
    })

    expect(openCalls).toBe(1)
    expect(['response-aborted', 'response-closed', 'response-error', 'request-error']).toContain(outcome)
    expect((await call('GET', WE_API_PREFIX + '/inventory')).status).toBe(200)
  })

  it('does not open a source after the response has already closed', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    expect(String(video?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))

    let openCalls = 0
    const routes = makeWeRoutes({
      getConfig: () => ({ weLibraryDirs: [library] }),
      storeDir: store,
      autoDetect: false,
      openReadStream: () => {
        openCalls++
        return Readable.from('unused')
      },
    })
    let handled!: () => void
    const handlerDone = new Promise<void>(resolve => { handled = resolve })
    server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const route = routes.find(r => r.kind === 'exact'
        ? r.path === pathname
        : pathname === r.path || pathname.startsWith(r.path + '/'))
      response.destroy()
      setImmediate(() => {
        if (route !== undefined) void route.handler(request, response)
        handled()
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port

    await Promise.all([
      handlerDone,
      new Promise<void>(resolve => {
        const req = httpRequest({ host: '127.0.0.1', port, path: String(video?.videoUrl), method: 'GET' })
        req.once('error', () => resolve())
        req.end()
      }),
    ])

    expect(openCalls).toBe(0)
  })

  it('404s on unknown tokens', async () => {
    const res = await call('GET', WE_API_PREFIX + '/media/bm9wZXJl')
    expect(res.status).toBe(404)
  })

  it('404s on crafted tokens for existing but never-issued paths (no decode fallback)', async () => {
    // app.js exists inside the web project, but tokens are only issued for
    // the entry HTML. Under the removed base64url-path fallback this request
    // would have streamed the file.
    const neverIssued = join(library, '222', 'app.js')
    const token = Buffer.from(neverIssued, 'utf8').toString('base64url')
    const res = await call('GET', WE_API_PREFIX + '/media/' + token)
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it('rejects cross-site media requests', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    const res = await call('GET', String(video?.videoUrl), { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(res.status).toBe(403)
  })

  it('serves issued tokens after a route-family restart (persisted token store)', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    const url = String(video?.videoUrl)
    // Rebuild the route family from scratch (fresh process-local state, same
    // store dir): the persisted token store must make the old URL work.
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    const routes = makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store, autoDetect: false })
    await serve(routes)
    const res = await call('GET', url)
    expect(res.status).toBe(200)
    expect(res.raw).toBe('FAKE-VIDEO-BYTES')
  })

  it('converts .tex wallpapers to PNG through /media (decodeTex path)', async () => {
    makeProject(join(library, '444'), { title: 'TexArt', type: 'video', file: 'art.tex' }, { 'art.tex': texDxt1Red })
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const tex = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '444')
    expect(String(tex?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    const res = await callRaw('GET', String(tex?.videoUrl))
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toBe('image/png')
    expect(String(res.headers['cache-control'])).toContain('max-age=86400')
    const decoded = decodePngToRgba(new Uint8Array(res.body))
    expect(decoded.width).toBe(4)
    expect(decoded.height).toBe(4)
    expect([...decoded.rgba.slice(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it('serves raw .tex bytes when decodeTex cannot decode the format (fallback preserved)', async () => {
    makeProject(join(library, '445'), { title: 'TexBc7', type: 'video', file: 'art.tex' }, { 'art.tex': texBc7 })
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const tex = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '445')
    expect(String(tex?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    const res = await callRaw('GET', String(tex?.videoUrl))
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toBe('application/octet-stream')
    expect(res.body.equals(texBc7)).toBe(true)
  })
})

describe('web route', () => {
  it('injects the shim into html and serves project files', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const web = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '222')
    const html = await call('GET', String(web?.webUrl))
    expect(html.status).toBe(200)
    expect(html.raw).toContain(WE_API_PREFIX + '/shim.js')
    expect(html.raw).toContain('<body>hi</body>')
    const js = await call('GET', String(web?.webUrl) + 'app.js')
    expect(js.status).toBe(200)
    expect(js.raw).toBe('console.log(1)')
  })

  it('rejects path escapes', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const web = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '222')
    const res = await call('GET', String(web?.webUrl) + '..%2F..%2F..%2Fetc%2Fpasswd')
    expect([403, 404]).toContain(res.status)
  })
})

describe('shim', () => {
  it('serves the WE API shim as javascript', async () => {
    const res = await call('GET', WE_API_PREFIX + '/shim.js')
    expect(res.status).toBe(200)
    expect(res.raw).toContain('wallpaperRegisterAudioListener')
    expect(String(res.headers['content-type'])).toContain('javascript')
  })
})

describe('scene-frame', () => {
  it('answers 422 when the pkg cannot be decoded', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '333')
    const res = await call('GET', String(scene?.frameUrl))
    expect(res.status).toBe(422)
    expect(res.body.ok).toBe(false)
  })

  it('answers a structured unsupported-tex-format 422 for BC7-only scenes (#906)', async () => {
    makeProject(join(library, '999'), { title: 'BC7Scene', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({ objects: [{ image: 'materials/art.tex' }] }),
    })
    mkdirSync(join(library, '999', 'materials'), { recursive: true })
    writeFileSync(join(library, '999', 'materials', 'art.tex'), texBc7)
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '999')
    const res = await call('GET', String(scene?.frameUrl))
    expect(res.status).toBe(422)
    expect(res.body).toMatchObject({ ok: false, error: 'unsupported-tex-format', format: 12, formatName: 'BC7' })
  })
})

describe('scene container resolution (#521)', () => {
  it('exposes a frame url when only scene.pkg exists under a scene.json declaration', async () => {
    makeProject(join(library, '444'), { title: 'PkgScene', type: 'scene', file: 'scene.json' }, {
      'scene.pkg': 'NOT-A-REAL-PKG',
    })
    const res = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (res.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '444')
    expect(scene?.type).toBe('scene')
    expect(String(scene?.frameUrl)).toContain(WE_API_PREFIX + '/scene-frame/')
  })

  it('records the resolved scene container in the import manifest', async () => {
    makeProject(join(library, '444'), { title: 'PkgScene', type: 'scene', file: 'scene.json' }, {
      'scene.pkg': 'NOT-A-REAL-PKG',
    })
    const imported = await call('POST', WE_API_PREFIX + '/import', { body: { id: '444' } })
    expect(imported.status).toBe(200)
    const manifest = JSON.parse(readFileSync(join(store, '444', 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.file).toBe(join('project', 'scene.pkg'))
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const entry = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'imported/444')
    expect(String(entry?.frameUrl)).toContain(WE_API_PREFIX + '/scene-frame/')
  })

  it('decodes a loose scene directory (scene.json + .tex) into a PNG frame', async () => {
    makeProject(join(library, '555'), { title: 'Loose', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({ objects: [{ image: 'materials/red.tex' }] }),
    })
    mkdirSync(join(library, '555', 'materials'), { recursive: true })
    writeFileSync(join(library, '555', 'materials', 'red.tex'), tex1x1Red)
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '555')
    const res = await call('GET', String(scene?.frameUrl))
    expect(res.status).toBe(200)
    expect(String(res.headers['content-type'])).toContain('image/png')
    // PNG signature survives the utf8 decode except the 0x89 lead byte.
    expect(res.raw.slice(1, 4)).toBe('PNG')
  })

  it('keys the frame cache by extractor version and prunes stale entries (#792)', async () => {
    makeProject(join(library, '888'), { title: 'Cache', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({ objects: [{ image: 'materials/red.tex' }] }),
    })
    mkdirSync(join(library, '888', 'materials'), { recursive: true })
    writeFileSync(join(library, '888', 'materials', 'red.tex'), tex1x1Red)

    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const scene = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '888')
    const frameUrl = String(scene?.frameUrl)

    // Pre-seed the cache the way older builds wrote it (path + mtime, no
    // version segment), plus an older-version entry and a stale-mtime entry.
    const sceneAbs = join(library, '888', 'scene.json')
    const mtime = Math.round(statSync(sceneAbs).mtimeMs)
    const base = Buffer.from(sceneAbs, 'utf8').toString('base64url')
    const cacheDir = join(store, '.cache', 'frames')
    mkdirSync(cacheDir, { recursive: true })
    const versionless = base + '_' + String(mtime) + '.png'
    const oldVersion = base + '_v1_' + String(mtime) + '.png'
    const oldMtime = base + '_v' + String(SCENE_EXTRACTOR_VERSION) + '_111111.png'
    writeFileSync(join(cacheDir, versionless), 'STALE-VERSIONLESS')
    writeFileSync(join(cacheDir, oldVersion), 'STALE-V1')
    writeFileSync(join(cacheDir, oldMtime), 'STALE-MTIME')

    const res = await call('GET', frameUrl)
    expect(res.status).toBe(200)

    // The regenerated entry carries the current extractor version and every
    // stale entry for this wallpaper (versionless, old version, old mtime)
    // has been pruned instead of piling up.
    const entries = readdirSync(cacheDir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toBe(base + '_v' + String(SCENE_EXTRACTOR_VERSION) + '_' + String(mtime) + '.png')
    expect(existsSync(join(cacheDir, versionless))).toBe(false)
    expect(existsSync(join(cacheDir, oldVersion))).toBe(false)
    expect(existsSync(join(cacheDir, oldMtime))).toBe(false)

    // A second request is served from the regenerated cache entry.
    const again = await call('GET', frameUrl)
    expect(again.status).toBe(200)
    expect(again.raw).toBe(res.raw)
  })

  it('serves scene-runtime, scene-manifest, and scene-resource for WebGL playback', async () => {
    makeProject(join(library, '666'), { title: 'SceneWebGL', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({
        objects: [
          { name: 'sky', image: 'models/sky.json' },
          { name: 'Reflection', effects: [{ file: 'effects/reflection/effect.json' }] },
        ],
      }),
      'models/sky.json': JSON.stringify({ material: 'materials/sky.json' }),
      'materials/sky.json': JSON.stringify({ passes: [{ textures: ['materials/sky.tex'] }] }),
    })
    mkdirSync(join(library, '666', 'materials'), { recursive: true })
    writeFileSync(join(library, '666', 'materials', 'sky.tex'), tex64Red)
    writeFileSync(join(library, '666', 'materials', 'reflection_mask.tex'), tex1x1Red)

    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const entry = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '666')
    // Scene capabilities are probed lazily: the inventory never reads packed
    // payloads, so the selected wallpaper asks the probe route.
    expect(entry?.sceneUrl).toBe(null)
    const probe = await call('GET', WE_API_PREFIX + '/scene-probe?id=666')
    expect(probe.status).toBe(200)
    expect(probe.body.ok).toBe(true)
    expect(probe.body.videoUrl).toBe(null)
    expect(String(probe.body.sceneUrl)).toContain(WE_API_PREFIX + '/scene-runtime/')

    // Scene runtime HTML
    const runtimeRes = await call('GET', String(probe.body.sceneUrl))
    expect(runtimeRes.status).toBe(200)
    expect(String(runtimeRes.headers['content-type'])).toContain('text/html')
    expect(runtimeRes.raw).toContain('<canvas id="canvas"></canvas>')

    // Scene manifest JSON
    const token = String(probe.body.sceneUrl).split('/').pop()
    const manifestRes = await call('GET', WE_API_PREFIX + '/scene-manifest/' + token)
    expect(manifestRes.status).toBe(200)
    expect(manifestRes.body.ok).toBe(true)
    expect(manifestRes.body.manifest.layers.length).toBeGreaterThanOrEqual(1)

    // Scene resource
    const resRes = await call('GET', WE_API_PREFIX + '/scene-resource/' + token + '/materials/sky.tex')
    expect(resRes.status).toBe(200)
    expect(String(resRes.headers['content-type'])).toContain('image/png')
  })

  it('keeps supported water and particle passes live when embedded scripts are ignored', async () => {
    makeProject(join(library, '777'), { title: 'Scripted water and meteors', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({
        general: { orthogonalprojection: { width: 1000, height: 800 } },
        objects: [
          {
            name: 'water',
            image: 'models/water.json',
            origin: '500 400 0',
            effects: [{
              file: 'effects/reflection/effect.json',
              overrides: [{ visible: { value: false, script: 'engine.registerAsset(1)' } }],
            }],
          },
          { name: 'meteor emitter' },
        ],
      }),
      'models/water.json': JSON.stringify({ material: 'materials/water.json', width: 64, height: 64 }),
      'materials/water.json': JSON.stringify({ passes: [{ textures: ['materials/water.tex'] }] }),
    })
    mkdirSync(join(library, '777', 'materials'), { recursive: true })
    writeFileSync(join(library, '777', 'materials', 'water.tex'), tex64Red)
    writeFileSync(join(library, '777', 'materials', 'reflection_mask.tex'), tex1x1Red)
    const probe = await call('GET', WE_API_PREFIX + '/scene-probe?id=777')
    expect(probe.status).toBe(200)
    expect(String(probe.body.sceneUrl)).toContain(WE_API_PREFIX + '/scene-runtime/')
    expect(probe.body.compatibility).toBe('partial')
    expect(probe.body.unsupportedFeatures).toEqual(['embedded-script'])

    const manifestResponse = await call('GET', String(probe.body.sceneUrl).replace('/scene-runtime/', '/scene-manifest/'))
    const manifest = manifestResponse.body.manifest as Record<string, unknown>
    const layers = manifest.layers as Array<Record<string, unknown>>
    expect(manifest.scripted).toBe(true)
    expect(manifest.hasMeteors).toBe(true)
    expect(layers.some(layer => layer.isReflection === true && typeof layer.waterLine === 'number')).toBe(true)
    expect(layers.some(layer => layer.name === 'water' && layer.isReflection !== true)).toBe(true)
  })
})

describe('import lifecycle', () => {
  it('imports, reports updates, reimports and removes', async () => {
    const imported = await call('POST', WE_API_PREFIX + '/import', { body: { id: '111' } })
    expect(imported.status).toBe(200)
    expect(imported.body.id).toBe('imported/111')
    expect(existsSync(join(store, '111', 'project', 'sea.mp4'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(store, '111', 'manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.sourceId).toBe('111')
    expect(manifest.type).toBe('video')

    // Duplicate import conflicts.
    const dup = await call('POST', WE_API_PREFIX + '/import', { body: { id: '111' } })
    expect(dup.status).toBe(409)

    // The inventory now carries the imported entry.
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const entry = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'imported/111')
    expect(entry?.source).toBe('imported')

    // Reimport refreshes the copy from the source.
    const reimported = await call('POST', WE_API_PREFIX + '/reimport', { body: { id: 'imported/111' } })
    expect(reimported.status).toBe(200)

    // Remove deletes only the store copy.
    const removed = await call('POST', WE_API_PREFIX + '/remove', { body: { id: 'imported/111' } })
    expect(removed.status).toBe(200)
    expect(existsSync(join(store, '111'))).toBe(false)
    expect(existsSync(join(library, '111'))).toBe(true)
  })

  it('rejects bad ids and cross-site posts', async () => {
    expect((await call('POST', WE_API_PREFIX + '/import', { body: { id: '' } })).status).toBe(400)
    expect((await call('POST', WE_API_PREFIX + '/import', { body: { id: 'imported/x' } })).status).toBe(400)
    expect((await call('POST', WE_API_PREFIX + '/remove', { body: { id: '111' } })).status).toBe(400)
    const cross = await call('POST', WE_API_PREFIX + '/import', {
      body: { id: '111' },
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(cross.status).toBe(403)
  })

  it('410s on reimport when the source is gone', async () => {
    await call('POST', WE_API_PREFIX + '/import', { body: { id: '222' } })
    rmSync(join(library, '222'), { recursive: true, force: true })
    const res = await call('POST', WE_API_PREFIX + '/reimport', { body: { id: 'imported/222' } })
    expect(res.status).toBe(410)
  })
})

describe('scene-probe cache (#817)', () => {
  const probeReads = (): number =>
    (vi.mocked(readFile) as unknown as { mock: { calls: unknown[][] } }).mock.calls.length

  it('persists probe results and reuses them after a route-family restart', async () => {
    makeProject(join(library, '444'), { title: 'Packed Scene', type: 'scene', file: 'scene.pkg' }, {
      'scene.pkg': 'NOT-A-REAL-PKG',
    })
    ;(vi.mocked(readFile) as unknown as { mockClear: () => void }).mockClear()
    const first = await call('GET', WE_API_PREFIX + '/scene-probe?id=444')
    expect(first.status).toBe(200)
    expect(first.body.ok).toBe(true)
    expect(probeReads()).toBeGreaterThanOrEqual(1)

    // The probe result landed in the persisted cache.
    const persistedPath = join(store, '.cache', 'we-scene-probes.json')
    expect(existsSync(persistedPath)).toBe(true)
    const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as Record<string, unknown>
    const key = Object.keys(persisted)[0] ?? ''
    expect(key).toContain('scene.pkg')
    expect(persisted[key]).toEqual({
      v: 4,
      hasVideo: false,
      hasSceneWebGL: false,
      compatibility: 'full',
      unsupportedFeatures: [],
    })

    // Simulate a host restart: a fresh route family must serve the same
    // result from the persisted cache without re-reading the payload.
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    await serve(makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store, autoDetect: false }))
    ;(vi.mocked(readFile) as unknown as { mockClear: () => void }).mockClear()
    const second = await call('GET', WE_API_PREFIX + '/scene-probe?id=444')
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(probeReads()).toBe(0)
  })

  it('re-probes when the pkg changes (mtime+size key invalidation)', async () => {
    makeProject(join(library, '555'), { title: 'Changed Scene', type: 'scene', file: 'scene.pkg' }, {
      'scene.pkg': 'NOT-A-REAL-PKG',
    })
    const first = await call('GET', WE_API_PREFIX + '/scene-probe?id=555')
    expect(first.status).toBe(200)
    ;(vi.mocked(readFile) as unknown as { mockClear: () => void }).mockClear()
    writeFileSync(join(library, '555', 'scene.pkg'), 'DIFFERENT-BYTES')
    const second = await call('GET', WE_API_PREFIX + '/scene-probe?id=555')
    expect(second.status).toBe(200)
    expect(probeReads()).toBeGreaterThanOrEqual(1)
  })

  // 258 real HTTP probes with a full library scan each: slow runners can
  // exceed the default 5s timeout, so budget this case explicitly.
  it('evicts the oldest probe entries instead of clearing the whole cache at the cap', { timeout: 30000 }, async () => {
    for (let i = 0; i < 258; i++) {
      const name = 's' + String(i).padStart(3, '0')
      makeProject(join(library, name), { title: name, type: 'scene', file: 'scene.pkg' }, {
        'scene.pkg': 'NOT-A-REAL-PKG',
      })
    }
    for (let i = 0; i < 258; i++) {
      const res = await call('GET', WE_API_PREFIX + '/scene-probe?id=s' + String(i).padStart(3, '0'))
      expect(res.status).toBe(200)
    }
    const persisted = JSON.parse(
      readFileSync(join(store, '.cache', 'we-scene-probes.json'), 'utf8',
    )) as Record<string, unknown>
    const keys = Object.keys(persisted).map(key => key.replaceAll('\\', '/'))
    expect(keys.length).toBe(256)
    expect(keys.filter(k => k.includes('/s000/') || k.includes('/s001/'))).toHaveLength(0)
    expect(keys.some(k => k.includes('/s257/'))).toBe(true)
  })
})

describe('sandboxed wallpaper loads (T1-1)', () => {
  it('serves web assets and the shim to sandboxed frames (cross-site Sec-Fetch-Site, Origin null)', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const web = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '222')
    const headers = { 'sec-fetch-site': 'cross-site', origin: 'null' }
    const html = await call('GET', String(web?.webUrl), { headers })
    expect(html.status).toBe(200)
    expect(String(html.headers['access-control-allow-origin'])).toBe('null')
    expect(html.raw).toContain(WE_API_PREFIX + '/shim.js')
    const js = await call('GET', String(web?.webUrl) + 'app.js', { headers })
    expect(js.status).toBe(200)
    expect(String(js.headers['access-control-allow-origin'])).toBe('null')
    expect(js.raw).toBe('console.log(1)')
    const shim = await call('GET', WE_API_PREFIX + '/shim.js', { headers })
    expect(shim.status).toBe(200)
    expect(String(shim.headers['access-control-allow-origin'])).toBe('null')
  })

  it('serves scene manifest and resources to the sandboxed player (Origin null, ACAO null)', async () => {
    makeProject(join(library, 'sbox'), { title: 'Sbox Scene', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({ objects: [{ name: 'sky', image: 'models/sky.json' }] }),
      'models/sky.json': JSON.stringify({ material: 'materials/sky.json' }),
      'materials/sky.json': JSON.stringify({ passes: [{ textures: ['materials/sky.tex'] }] }),
    })
    mkdirSync(join(library, 'sbox', 'materials'), { recursive: true })
    writeFileSync(join(library, 'sbox', 'materials', 'sky.tex'), tex64Red)
    const probe = await call('GET', WE_API_PREFIX + '/scene-probe?id=sbox')
    expect(probe.status).toBe(200)
    const sceneUrl = String(probe.body.sceneUrl)
    expect(sceneUrl).toContain(WE_API_PREFIX + '/scene-runtime/')
    const token = sceneUrl.split('/').pop()
    const headers = { 'sec-fetch-site': 'cross-site', origin: 'null' }
    const manifest = await call('GET', WE_API_PREFIX + '/scene-manifest/' + token, { headers })
    expect(manifest.status).toBe(200)
    expect(manifest.body.ok).toBe(true)
    expect(String(manifest.headers['access-control-allow-origin'])).toBe('null')
    expect(String(manifest.headers['referrer-policy'])).toBe('no-referrer')
    const resource = await call('GET', WE_API_PREFIX + '/scene-resource/' + token + '/materials/sky.tex', { headers })
    expect(resource.status).toBe(200)
    expect(String(resource.headers['access-control-allow-origin'])).toBe('null')
  })

  it('still rejects foreign real origins on the content routes', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const web = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '222')
    const foreign = { origin: 'http://evil.example' }
    expect((await call('GET', String(web?.webUrl), { headers: foreign })).status).toBe(403)
    expect((await call('GET', WE_API_PREFIX + '/shim.js', { headers: foreign })).status).toBe(403)
  })

  it('keeps the strict same-origin fence on GUI-side routes', async () => {
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    const cross = { 'sec-fetch-site': 'cross-site' }
    expect((await call('GET', String(video?.videoUrl), { headers: cross })).status).toBe(403)
    expect((await call('GET', WE_API_PREFIX + '/inventory', { headers: cross })).status).toBe(403)
    expect((await call('GET', WE_API_PREFIX + '/scene-probe?id=111', { headers: cross })).status).toBe(403)
  })
})

describe('inventory cache (#T2-10)', () => {
  const readsEnding = (name: string): number =>
    (vi.mocked(readFileSync) as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .filter((call) => String(call[0]).endsWith(name)).length

  it('serves repeated inventories from the cache and re-scans when the library changes', async () => {
    // Steady state: the store .cache dir exists (the routes create it on
    // first use and it persists; a fresh store would see one extra scan
    // while the .cache dir appears).
    mkdirSync(join(store, '.cache'), { recursive: true })
    ;(vi.mocked(readFileSync) as unknown as { mockClear: () => void }).mockClear()
    ;(vi.mocked(readdirSync) as unknown as { mockClear: () => void }).mockClear()
    const first = await call('GET', WE_API_PREFIX + '/inventory')
    expect(first.status).toBe(200)
    expect(first.body.wallpapers as Array<Record<string, unknown>>).toHaveLength(3)
    // The first request performs the full scan: one project.json per project.
    expect(readsEnding('project.json')).toBeGreaterThanOrEqual(3)

    ;(vi.mocked(readFileSync) as unknown as { mockClear: () => void }).mockClear()
    ;(vi.mocked(readdirSync) as unknown as { mockClear: () => void }).mockClear()
    const second = await call('GET', WE_API_PREFIX + '/inventory')
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    // Cache hit: no project.json read and no root listing.
    expect(readsEnding('project.json')).toBe(0)
    expect((vi.mocked(readdirSync) as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0)

    // A new project under the library root changes the root mtime: re-scan.
    makeProject(join(library, '444'), { title: 'New', type: 'video', file: 'v.mp4' }, { 'v.mp4': 'x' })
    ;(vi.mocked(readFileSync) as unknown as { mockClear: () => void }).mockClear()
    const third = await call('GET', WE_API_PREFIX + '/inventory')
    expect(third.status).toBe(200)
    expect((third.body.wallpapers as Array<Record<string, unknown>>).some(w => w.id === '444')).toBe(true)
    expect(readsEnding('project.json')).toBeGreaterThanOrEqual(4)
  })

  it('makes an import visible even when the store mtime does not advance (write-through invalidation)', async () => {
    // Prime the cache with an inventory made before the import.
    mkdirSync(store, { recursive: true })
    const storeMtime = Math.round(statSync(store).mtimeMs)
    utimesSync(store, new Date(storeMtime), new Date(storeMtime))
    const before = await call('GET', WE_API_PREFIX + '/inventory')
    expect(before.status).toBe(200)
    expect((before.body.wallpapers as Array<Record<string, unknown>>)).toHaveLength(3)

    const imported = await call('POST', WE_API_PREFIX + '/import', { body: { id: '111' } })
    expect(imported.status).toBe(200)
    // Roll the store directory mtime back to the pre-import value: only the
    // explicit write-through invalidation (not the mtime fingerprint) can
    // make the next inventory see the imported copy.
    utimesSync(store, new Date(storeMtime), new Date(storeMtime))
    const after = await call('GET', WE_API_PREFIX + '/inventory')
    expect((after.body.wallpapers as Array<Record<string, unknown>>).map(w => w.id)).toContain('imported/111')
  })

  it('invalidates the cache after reimport and remove', async () => {
    await call('POST', WE_API_PREFIX + '/import', { body: { id: '111' } })
    const reimported = await call('POST', WE_API_PREFIX + '/reimport', { body: { id: 'imported/111' } })
    expect(reimported.status).toBe(200)
    const afterReimport = await call('GET', WE_API_PREFIX + '/inventory')
    expect((afterReimport.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'imported/111')).toBeDefined()

    const removed = await call('POST', WE_API_PREFIX + '/remove', { body: { id: 'imported/111' } })
    expect(removed.status).toBe(200)
    const afterRemove = await call('GET', WE_API_PREFIX + '/inventory')
    expect((afterRemove.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'imported/111')).toBeUndefined()
  })

  it('re-scans when the manual library dirs setting changes', async () => {
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    const second = join(root, 'second')
    makeProject(join(second, '777'), { title: 'Second', type: 'video', file: 's.mp4' }, { 's.mp4': 'x' })
    let dirs = [library]
    const routes = makeWeRoutes({ getConfig: () => ({ weLibraryDirs: dirs }), storeDir: store, autoDetect: false })
    await serve(routes)
    const before = await call('GET', WE_API_PREFIX + '/inventory')
    expect((before.body.wallpapers as Array<Record<string, unknown>>)).toHaveLength(3)
    dirs = [second]
    const after = await call('GET', WE_API_PREFIX + '/inventory')
    expect((after.body.wallpapers as Array<Record<string, unknown>>).map(w => w.id)).toEqual(['777'])
  })
})

/** Raw-string POST for body-contract cases (call() serializes JSON objects). */
async function postRawText(
  path: string,
  payload: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          connection: 'close',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body: Record<string, unknown> = {}
          try { body = JSON.parse(raw) as Record<string, unknown> } catch { /* non-JSON */ }
          resolve({ status: response.statusCode ?? 0, body })
        })
      },
    )
    req.on('error', reject)
    if (payload !== '') req.write(payload)
    req.end()
  })
}

describe('import POST body contract (shared readJsonBody migration)', () => {
  it('answers 400 invalid-body to a body that is not JSON (was 500)', async () => {
    const res = await postRawText(WE_API_PREFIX + '/import', 'not-json')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'invalid-body' })
  })

  it('answers 400 invalid-body to an empty POST body (was 400 bad-id)', async () => {
    const res = await postRawText(WE_API_PREFIX + '/import', '')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'invalid-body' })
  })

  it('destroys the connection on an over-limit body instead of answering JSON', async () => {
    await expect(
      postRawText(WE_API_PREFIX + '/import', '{"id":"' + 'x'.repeat(64 * 1024) + '"}'),
    ).rejects.toThrow()
  })
})


describe('macOS system wallpapers', () => {
  /** Build temp aerial + Desktop Pictures roots and serve routes over them. */
  async function serveMacos(convertImage?: (src: string, dest: string) => Promise<void>): Promise<{ aerialRoot: string; pictureRoot: string }> {
    const aerialRoot = join(root, 'com.apple.wallpaper', 'aerials')
    const pictureRoot = join(root, 'Desktop Pictures')
    mkdirSync(join(aerialRoot, 'videos'), { recursive: true })
    mkdirSync(join(aerialRoot, 'thumbnails'), { recursive: true })
    mkdirSync(join(aerialRoot, 'manifest'), { recursive: true })
    // Magic bytes must pass the scanner's format validation.
    writeFileSync(join(aerialRoot, 'videos', 'AAAA-1.mov'), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypqt  '), Buffer.from('FAKE-AERIAL')]))
    writeFileSync(join(aerialRoot, 'thumbnails', 'AAAA-1.png'), 'FAKE-THUMB', 'utf8')
    writeFileSync(join(aerialRoot, 'manifest', 'entries.json'), JSON.stringify({
      assets: [{ id: 'AAAA-1', accessibilityLabel: 'Sonoma from Above' }],
    }), 'utf8')
    mkdirSync(pictureRoot, { recursive: true })
    writeFileSync(join(pictureRoot, 'Tahoe Day.heic'), Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypheic'), Buffer.from('FAKE-HEIC')]))
    writeFileSync(join(pictureRoot, 'Plain Photo.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('FAKE-JPEG')]))
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    await serve(makeWeRoutes({
      getConfig: () => ({}),
      storeDir: store,
      autoDetect: false,
      macosRoots: { aerials: [aerialRoot], pictures: [pictureRoot] },
      convertImage,
      platform: 'darwin',
    }))
    return { aerialRoot, pictureRoot }
  }

  it('lists aerials and Desktop Pictures as system entries with titles and count', async () => {
    await serveMacos()
    const res = await call('GET', WE_API_PREFIX + '/inventory')
    expect(res.status).toBe(200)
    expect(res.body.systemCount).toBe(3)
    const wallpapers = res.body.wallpapers as Array<Record<string, unknown>>
    const aerial = wallpapers.find(w => w.id === 'macos-aerial/AAAA-1')
    expect(aerial?.title).toBe('Sonoma from Above')
    expect(aerial?.type).toBe('video')
    expect(aerial?.source).toBe('system')
    expect(String(aerial?.videoUrl)).toContain(WE_API_PREFIX + '/media/')
    expect(String(aerial?.previewUrl)).toContain(WE_API_PREFIX + '/preview/')
    const heic = wallpapers.find(w => w.id === 'macos-image/Tahoe Day')
    expect(heic?.type).toBe('image')
    expect(heic?.source).toBe('system')
    expect(heic?.playable).toBe(false)
    expect(String(heic?.previewUrl)).toContain(WE_API_PREFIX + '/image/')
    const jpg = wallpapers.find(w => w.id === 'macos-image/Plain Photo')
    expect(jpg?.type).toBe('image')
    expect(String(jpg?.previewUrl)).toContain(WE_API_PREFIX + '/image/')
  })

  it('converts heic through the injected converter once and serves the cache', async () => {
    let conversions = 0
    await serveMacos(async (_src, dest) => {
      conversions++
      writeFileSync(dest, 'JPEG-BYTES', 'utf8')
    })
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const heic = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'macos-image/Tahoe Day')
    const first = await callRaw('GET', String(heic?.previewUrl))
    expect(first.status).toBe(200)
    expect(first.headers['content-type']).toBe('image/jpeg')
    expect(first.body.toString('utf8')).toBe('JPEG-BYTES')
    const second = await callRaw('GET', String(heic?.previewUrl))
    expect(second.status).toBe(200)
    expect(conversions).toBe(1)
  })

  it('rejects import of macOS-managed entries', async () => {
    await serveMacos()
    const res = await call('POST', WE_API_PREFIX + '/import', { body: { id: 'macos-aerial/AAAA-1' } })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'not-importable' })
  })

  it('serves jpg directly without invoking the converter', async () => {
    let conversions = 0
    await serveMacos(async () => { conversions++ })
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const jpg = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === 'macos-image/Plain Photo')
    const res = await callRaw('GET', String(jpg?.previewUrl))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(conversions).toBe(0)
  })

  it('answers 400 for a non-image token on the image route', async () => {
    // The default beforeEach library holds sea.mp4: its media token exists
    // but the image route only serves or converts image formats.
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const video = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '111')
    const token = String(video?.videoUrl).split('/media/')[1]
    const res = await call('GET', WE_API_PREFIX + '/image/' + token)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'not-an-image' })
  })
})
