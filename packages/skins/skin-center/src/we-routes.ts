/**
 * Wallpaper Engine HTTP routes for the skin center — the browser half talks
 * to the host through same-origin endpoints under /api/skin-center/we:
 *
 *   GET  /inventory           → JSON wallpaper list (library + import store)
 *   GET  /media/<token>       → video stream (Range supported)
 *   GET  /preview/<token>     → preview image
 *   GET  /web/<token>/<path>  → web-wallpaper project files (HTML is served
 *                               with the WE API shim injected)
 *   GET  /shim.js             → the WE API shim source (we-shim-source.ts)
 *   GET  /scene-frame/<token> → PNG of a scene wallpaper's main texture,
 *                               decoded in-process (pkg-extract.ts), cached
 *                               under the import store's .cache directory
 *   POST /import              → copy a library wallpaper into the import
 *                               store (<harnessHome>/skin-center/wallpapers)
 *   POST /reimport            → refresh an imported copy from its source
 *   POST /remove              → delete an imported copy
 *
 * Tokens are base64url of an absolute path, issued only by the inventory
 * handler, so a crafted token can never reach a path the library scan did
 * not already expose. Every route rides the skin-center same-origin fence
 * (routes.ts) — wallpaper imports must not be triggerable cross-site.
 *
 * Compliance note: this module only ever reads files already present on the
 * user's machine (their own Wallpaper Engine library) or copies them within
 * it. Nothing is downloaded, uploaded, or redistributed.
 * @module @linxin666/dsh-client-ui-skin-center/we-routes
 */

import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, join as joinPath, resolve as resolvePath, sep } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { json, readJsonBody, requireSameOrigin } from './routes.ts'
import {
  buildInventory,
  type WallpaperEntry,
  type WallpaperType,
} from './we-library.ts'
import { WE_SHIM_JS } from './we-shim-source.ts'

/** Browser-facing base path of the wallpaper API. */
export const WE_API_PREFIX = '/api/skin-center/we'

/** The slice of the skin-wallpaper settings these routes read. */
export interface WeRouteConfig {
  /** Manual library folders (settings field weLibraryDirs). */
  weLibraryDirs?: string[]
}

/** Dependencies the route family needs from the host plugin. */
export interface WeRouteDeps {
  /** Live getter for the skin-wallpaper settings (scope-backed). */
  getConfig: () => WeRouteConfig
  /** Import-store root (<harnessHome>/skin-center/wallpapers). */
  storeDir: string
}

/** Sanitize a wallpaper id into a safe store directory name. */
export function safeStoreId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Minimal mime map for wallpaper payloads. */
function mimeFor(absPath: string): string {
  const ext = extname(absPath).slice(1).toLowerCase()
  return {
    mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    avi: 'video/x-msvideo', mov: 'video/quicktime',
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    wasm: 'application/wasm',
  }[ext] || 'application/octet-stream'
}

/** Stream one file with Range support (video seeking needs 206). */
function serveFile(absPath: string, req: IncomingMessage, res: ServerResponse): void {
  if (!existsSync(absPath) || !statSync(absPath).isFile()) {
    json(res, 404, { ok: false, error: 'not-found' })
    return
  }
  const size = statSync(absPath).size
  res.setHeader('Content-Type', mimeFor(absPath))
  res.setHeader('Accept-Ranges', 'bytes')
  const range = req.headers.range
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    let start = match && match[1] ? parseInt(match[1], 10) : 0
    let end = match && match[2] ? parseInt(match[2], 10) : size - 1
    if (Number.isNaN(start)) start = 0
    if (Number.isNaN(end) || end >= size) end = size - 1
    if (start > end) {
      res.statusCode = 416
      res.setHeader('Content-Range', 'bytes */' + String(size))
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', 'bytes ' + String(start) + '-' + String(end) + '/' + String(size))
    res.setHeader('Content-Length', String(end - start + 1))
    createReadStream(absPath, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', String(size))
  createReadStream(absPath).pipe(res)
}

/** The JSON shape of one wallpaper entry sent to the browser. */
interface WallpaperJson {
  id: string
  title: string
  type: WallpaperType
  source: WallpaperEntry['source']
  playable: boolean
  updateAvailable: boolean
  videoUrl: string | null
  webUrl: string | null
  frameUrl: string | null
  previewUrl: string | null
}

/** Build the route family. */
export function makeWeRoutes(deps: WeRouteDeps): WebRoute[] {
  // token -> absolute path, issued by the inventory handler only.
  const mediaMap = new Map<string, string>()
  const tokenFor = (absPath: string): string => {
    const token = Buffer.from(absPath, 'utf8').toString('base64url')
    mediaMap.set(token, absPath)
    return token
  }

  const freshInventory = () => buildInventory({
    manualDirs: deps.getConfig().weLibraryDirs ?? [],
    storeDir: deps.storeDir,
  })

  const entryToJson = (entry: WallpaperEntry): WallpaperJson => {
    const hasFile = existsSync(entry.fileAbs)
    // Scene frames are decoded from a PKG container. A scene whose main file
    // is the loose scene.json (Wallpaper Engine bundled projects) has no
    // container to decode, so no frameUrl is issued and the browser half
    // falls back to the preview image.
    const isPkg = hasFile && entry.fileAbs.toLowerCase().endsWith('.pkg')
    return {
      id: entry.id,
      title: entry.title,
      type: entry.type,
      source: entry.source,
      playable: entry.playable,
      updateAvailable: entry.updateAvailable,
      videoUrl: entry.type === 'video' && hasFile ? WE_API_PREFIX + '/media/' + tokenFor(entry.fileAbs) : null,
      webUrl: entry.type === 'web' && hasFile ? WE_API_PREFIX + '/web/' + tokenFor(entry.fileAbs) + '/' : null,
      frameUrl: entry.type === 'scene' && isPkg ? WE_API_PREFIX + '/scene-frame/' + tokenFor(entry.fileAbs) : null,
      previewUrl: entry.previewAbs ? WE_API_PREFIX + '/preview/' + tokenFor(entry.previewAbs) : null,
    }
  }

  /** Resolve a token from a prefix route, or answer 404. */
  const resolveToken = (req: IncomingMessage, res: ServerResponse, prefix: string): string | null => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    const token = decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? '')
    const abs = mediaMap.get(token)
    if (!abs) {
      json(res, 404, { ok: false, error: 'unknown-token' })
      return null
    }
    return abs
  }

  const routes: WebRoute[] = []

  // GET /inventory — the wallpaper list; also (re)issues all media tokens.
  routes.push({
    kind: 'exact',
    path: WE_API_PREFIX + '/inventory',
    handler: (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      if (!requireSameOrigin(req, res)) return
      try {
        const inventory = freshInventory()
        json(res, 200, {
          ok: true,
          installDir: inventory.installDir,
          total: inventory.total,
          portableCount: inventory.portableCount,
          wallpapers: inventory.wallpapers.map(entryToJson),
        })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  // GET /shim.js — the WE API shim for web wallpaper iframes.
  routes.push({
    kind: 'exact',
    path: WE_API_PREFIX + '/shim.js',
    handler: (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(WE_SHIM_JS)
    },
  })

  // GET /media/<token> and /preview/<token> — streamed files.
  for (const seg of ['media', 'preview']) {
    const prefix = WE_API_PREFIX + '/' + seg + '/'
    routes.push({
      kind: 'prefix',
      path: WE_API_PREFIX + '/' + seg,
      handler: (req, res) => {
        if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        const abs = resolveToken(req, res, prefix)
        if (abs) serveFile(abs, req, res)
      },
    })
  }

  // GET /web/<token>/<subpath> — web-wallpaper project files. The token maps
  // to the entry HTML; subpaths resolve inside its directory only. HTML
  // responses carry the WE API shim ahead of the document.
  const webPrefix = WE_API_PREFIX + '/web/'
  routes.push({
    kind: 'prefix',
    path: WE_API_PREFIX + '/web',
    handler: (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      const pathname = new URL(req.url || '/', 'http://localhost').pathname
      const rest = decodeURIComponent(pathname.slice(webPrefix.length))
      const token = rest.split('/')[0] ?? ''
      const entryAbs = mediaMap.get(token)
      if (!entryAbs) { json(res, 404, { ok: false, error: 'unknown-token' }); return }
      const root = dirname(entryAbs)
      const sub = rest.slice(token.length).replace(/^\/+/, '') || basename(entryAbs)
      const abs = resolvePath(root, sub)
      if (abs !== root && !abs.startsWith(root + sep)) {
        json(res, 403, { ok: false, error: 'path-escape-rejected' })
        return
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) { json(res, 404, { ok: false, error: 'not-found' }); return }
      if (/\.html?$/i.test(abs)) {
        const html = readFileSync(abs, 'utf8')
        const tag = '<script src="' + WE_API_PREFIX + '/shim.js"></script>'
        const injected = /<head[^>]*>/i.test(html)
          ? html.replace(/<head[^>]*>/i, (m) => m + tag)
          : tag + html
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(injected)
        return
      }
      serveFile(abs, req, res)
    },
  })

  // GET /scene-frame/<token> — decode the scene pkg's main texture to PNG,
  // cached under <store>/.cache/frames (keyed by path + mtime).
  const framePrefix = WE_API_PREFIX + '/scene-frame/'
  routes.push({
    kind: 'prefix',
    path: WE_API_PREFIX + '/scene-frame',
    handler: (req, res) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
      const abs = resolveToken(req, res, framePrefix)
      if (!abs) return
      // Defense in depth: only PKG containers are decodable. Stale tokens
      // pointing at a loose scene.json answer a readable error instead of a
      // raw parser stack (inventory no longer issues such tokens).
      if (!abs.toLowerCase().endsWith('.pkg')) {
        json(res, 422, { ok: false, error: 'scene-frame: not a PKG container' })
        return
      }
      void (async () => {
        let mtime = 0
        try { mtime = statSync(abs).mtimeMs } catch { /* stays 0 */ }
        const cacheDir = joinPath(deps.storeDir, '.cache', 'frames')
        const key = Buffer.from(abs, 'utf8').toString('base64url') + '_' + String(Math.round(mtime)) + '.png'
        const cachePath = joinPath(cacheDir, key)
        if (!existsSync(cachePath)) {
          const { extractSceneMainImage } = await import('./pkg-extract.ts')
          const frame = extractSceneMainImage(new Uint8Array(readFileSync(abs)))
          mkdirSync(cacheDir, { recursive: true })
          writeFileSync(cachePath, frame.png)
        }
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(cachePath).pipe(res)
      })().catch((error: unknown) => {
        json(res, 422, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  })

  /** Read the {id} field of a wallpaper POST body. */
  const readId = (body: unknown): string => {
    if (typeof body !== 'object' || body === null) return ''
    const id = (body as Record<string, unknown>).id
    return typeof id === 'string' ? id : ''
  }

  /** Copy one library entry into the import store; dest must not exist. */
  const copyIntoStore = (entry: WallpaperEntry, dest: string): void => {
    mkdirSync(dest, { recursive: true })
    cpSync(entry.dir, joinPath(dest, 'project'), { recursive: true })
    const manifest = {
      sourceId: entry.id,
      title: entry.title,
      type: entry.type,
      srcMtime: entry.srcMtime,
      srcSize: entry.srcSize,
      importedAt: Date.now(),
      file: joinPath('project', entry.file),
      preview: entry.preview ? joinPath('project', entry.preview) : null,
    }
    writeFileSync(joinPath(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  }

  /** Register one JSON POST route with the standard error envelope. */
  const postJson = (path: string, run: (id: string, res: ServerResponse) => void): void => {
    routes.push({
      kind: 'exact',
      path,
      handler: (req, res) => {
        if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
        if (!requireSameOrigin(req, res)) return
        readJsonBody(req).then((body) => run(readId(body), res)).catch((error: unknown) => {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      },
    })
  }

  // POST /import — copy a library wallpaper project into the import store.
  postJson(WE_API_PREFIX + '/import', (id, res) => {
    if (id === '' || id.startsWith('imported/')) { json(res, 400, { ok: false, error: 'bad-id' }); return }
    const entry = freshInventory().wallpapers.find((w) => w.id === id)
    if (!entry) { json(res, 404, { ok: false, error: 'wallpaper-not-found' }); return }
    const dest = joinPath(deps.storeDir, safeStoreId(id))
    if (existsSync(dest)) { json(res, 409, { ok: false, error: 'already-imported' }); return }
    copyIntoStore(entry, dest)
    json(res, 200, { ok: true, id: 'imported/' + entry.id })
  })

  // POST /reimport — refresh an imported copy from its (still present) source.
  postJson(WE_API_PREFIX + '/reimport', (id, res) => {
    if (!id.startsWith('imported/')) { json(res, 400, { ok: false, error: 'bad-id' }); return }
    const sourceId = id.slice('imported/'.length)
    const dest = joinPath(deps.storeDir, safeStoreId(sourceId))
    if (!existsSync(dest)) { json(res, 404, { ok: false, error: 'import-not-found' }); return }
    const source = freshInventory().wallpapers.find((w) => w.id === sourceId && w.source !== 'imported')
    if (!source) { json(res, 410, { ok: false, error: 'source-gone' }); return }
    rmSync(dest, { recursive: true, force: true })
    copyIntoStore(source, dest)
    json(res, 200, { ok: true, id })
  })

  // POST /remove — delete an imported copy (never touches the library).
  postJson(WE_API_PREFIX + '/remove', (id, res) => {
    if (!id.startsWith('imported/')) { json(res, 400, { ok: false, error: 'bad-id' }); return }
    const dest = joinPath(deps.storeDir, safeStoreId(id.slice('imported/'.length)))
    if (!existsSync(dest)) { json(res, 404, { ok: false, error: 'import-not-found' }); return }
    rmSync(dest, { recursive: true, force: true })
    json(res, 200, { ok: true })
  })

  return routes
}
