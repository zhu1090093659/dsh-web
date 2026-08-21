/**
 * we-routes tests: real HTTP server over a synthetic wallpaper library,
 * asserting the inventory payload and token issuance, media streaming with
 * Range, the web route's shim injection and path-escape fence, the import /
 * reimport / remove lifecycle against a temp import store, and the
 * same-origin fence on POST routes.
 */
import { createServer, request as httpRequest, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { TexFormat } from '../src/pkg-extract.ts'
import { makeWeRoutes, SCENE_EXTRACTOR_VERSION, WE_API_PREFIX } from '../src/we-routes.ts'

// The probe path reads scene payloads through node:fs/promises; spy on it so
// the cache tests can assert exactly when a payload is (not) re-read.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
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

  it('withholds the live scene runtime from scripted scenes (dino_run pattern)', async () => {
    // dino_run drives everything through embedded WE scripts - a property
    // value object like visible: { script: 'engine.registerAsset(...)' }
    // playing the whole game (hidden characters, scrolling, particles).
    // The WebGL player has no script engine: it would render exactly the
    // initial static composition while burning GPU, so the probe must not
    // advertise a sceneUrl for such scenes; the static frame stays.
    makeProject(join(library, '999'), { title: 'Scripted', type: 'scene', file: 'scene.json' }, {
      'scene.json': JSON.stringify({
        objects: [
          { name: 'sky', image: 'models/sky.json' },
          {
            name: 'hero',
            image: 'models/hero.json',
            visible: { script: "'use strict';\nengine.registerAsset('particles/spark.json');" },
          },
        ],
      }),
      'models/sky.json': JSON.stringify({ material: 'materials/sky.json' }),
      'models/hero.json': JSON.stringify({ material: 'materials/hero.json' }),
      'materials/sky.json': JSON.stringify({ passes: [{ textures: ['materials/sky.tex'] }] }),
      'materials/hero.json': JSON.stringify({ passes: [{ textures: ['materials/hero.tex'] }] }),
    })
    mkdirSync(join(library, '999', 'materials'), { recursive: true })
    writeFileSync(join(library, '999', 'materials', 'sky.tex'), tex64Red)
    writeFileSync(join(library, '999', 'materials', 'hero.tex'), tex64Red)

    const probe = await call('GET', WE_API_PREFIX + '/scene-probe?id=999')
    expect(probe.status).toBe(200)
    expect(probe.body.ok).toBe(true)
    expect(probe.body.videoUrl).toBe(null)
    // The live runtime is withheld; the static frame URL from the inventory
    // stays the only render path for this scene.
    expect(probe.body.sceneUrl).toBe(null)
    const inventory = await call('GET', WE_API_PREFIX + '/inventory')
    const entry = (inventory.body.wallpapers as Array<Record<string, unknown>>).find(w => w.id === '999')
    expect(String(entry?.frameUrl)).toContain(WE_API_PREFIX + '/scene-frame/')
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

    // The probe result landed in the persisted cache, stamped with the
    // current probe-logic version.
    const persistedPath = join(store, '.cache', 'we-scene-probes.json')
    expect(existsSync(persistedPath)).toBe(true)
    const persisted = JSON.parse(readFileSync(persistedPath, 'utf8')) as Record<string, unknown>
    const key = Object.keys(persisted)[0] ?? ''
    expect(key).toContain('scene.pkg')
    expect(persisted[key]).toEqual({ hasVideo: false, hasSceneWebGL: false, v: 2 })

    // Simulate a host restart: a fresh route family must serve the same
    // result from the persisted cache without re-reading the payload.
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    await serve(makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store, autoDetect: false }))
    ;(vi.mocked(readFile) as unknown as { mockClear: () => void }).mockClear()
    const second = await call('GET', WE_API_PREFIX + '/scene-probe?id=444')
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(probeReads()).toBe(0)

    // Entries persisted by an older build (no probe-logic version stamp)
    // must be ignored, not trusted: a probe-rules change (the scripted-
    // scene withholding) has to reach installs that already cached
    // hasSceneWebGL=true under the old rules.
    const cached = JSON.parse(readFileSync(persistedPath, 'utf8')) as Record<string, unknown>
    cached[key] = { hasVideo: false, hasSceneWebGL: true }
    writeFileSync(persistedPath, JSON.stringify(cached), 'utf8')
    await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())))
    await serve(makeWeRoutes({ getConfig: () => ({ weLibraryDirs: [library] }), storeDir: store, autoDetect: false }))
    const third = await call('GET', WE_API_PREFIX + '/scene-probe?id=444')
    expect(third.status).toBe(200)
    expect(third.body).toEqual(first.body)
    expect(probeReads()).toBeGreaterThanOrEqual(1)
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
    const keys = Object.keys(persisted)
    expect(keys.length).toBe(256)
    expect(keys.filter(k => k.includes('/s000/') || k.includes('/s001/'))).toHaveLength(0)
    expect(keys.some(k => k.includes('/s257/'))).toBe(true)
  })
})
