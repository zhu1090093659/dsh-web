/**
 * we-routes tests: real HTTP server over a synthetic wallpaper library,
 * asserting the inventory payload and token issuance, media streaming with
 * Range, the web route's shim injection and path-escape fence, the import /
 * reimport / remove lifecycle against a temp import store, and the
 * same-origin fence on POST routes.
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { TexFormat } from '../src/pkg-extract.ts'
import { makeWeRoutes, WE_API_PREFIX } from '../src/we-routes.ts'

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

let root: string
let library: string
let store: string
let server: Server
let port: number

function makeProject(dir: string, project: Record<string, unknown>, files: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project), 'utf8')
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8')
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
  const routes = makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store })
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

  it('404s on unknown tokens', async () => {
    const res = await call('GET', WE_API_PREFIX + '/media/bm9wZXJl')
    expect(res.status).toBe(404)
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
