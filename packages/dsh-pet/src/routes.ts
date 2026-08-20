/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints ('/api/pet/*') and loads pet assets from
 * '/pet/<id>/*'. The '/plugins/' endpoint only serves client bundles and RPC
 * domains are platform-registered, so the pet serves its own API and media —
 * the same pattern as dsh-remote-web-ui's '/api/pair' family. The asset route
 * is one prefix registration serving every registry entry (manifest, atlas,
 * optional previews), so adding a pet never touches route wiring. Both the
 * JSON API, the asset prefix, and the Live2D runtime prefix are loopback-only
 * by default; a live paired-device cookie is an extra allow path when
 * remote-web-ui is loaded.
 * @module @linxin666/dsh-pet/routes
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'
import type { PetInteraction } from './affinity.ts'
import { DECORATION_ASSET_PREFIX, petEntryView, petPackageRoot, type PetEntry, type PetRegistry } from './registry.ts'
import { isPetAllowed } from './access.ts'
import { dshHome } from './dsh-home.ts'

/** Browser-facing base path of the pet API. */
export const PET_API_PREFIX = '/api/pet'

/** Browser-facing base path of the pet asset routes ('/pet/<id>/...'). */
export const PET_ASSET_PREFIX = '/pet'

const MANIFEST_FILE = 'pet.json'
const PREVIEW_DIR = 'previews'
const PREVIEW_PATTERN = /^[A-Za-z0-9._-]+$/

/**
 * Per-class size ceilings for served pet assets, in bytes (pet-center M2 P3,
 * issue #623). Constants are tested directly; makePetRoutes accepts an
 * override so tests can exercise the 413 path with tiny caps.
 */
export const PET_ASSET_CAPS = {
  /** pet.json manifest. */
  manifest: 64 * 1024,
  /** Atlas, preview and Live2D texture imagery. */
  image: 20 * 1024 * 1024,
  /** Live2D model closure files (.moc3, motion/physics/expression JSON; M3). */
  model: 32 * 1024 * 1024,
} as const

/** Size-cap profile the asset route enforces (test seam). */
export interface PetAssetCaps {
  manifest: number
  image: number
  model: number
}

/** Imagery extensions classify into the image cap; everything else served from a closure is model-class. */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.webp', '.png', '.gif', '.jpg', '.jpeg'])

/** Lowercased file extension ('' when none). */
function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot < 0 ? '' : file.slice(dot).toLowerCase()
}

/**
 * realpath containment: resolve both sides and require the candidate to stay
 * inside the base directory. A pet directory (or an atlas/preview inside it)
 * that is a symlink escaping its root is rejected, never followed.
 */
export function containedRealpath(base: string, candidate: string): string | undefined {
  try {
    const realBase = realpathSync(base)
    const realCandidate = realpathSync(candidate)
    return realCandidate === realBase || realCandidate.startsWith(realBase + sep)
      ? realCandidate
      : undefined
  } catch {
    return undefined
  }
}

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
}

/** Content type by file extension (safe fallback: octet-stream). */
function mimeFor(file: string): string {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  return MIME_BY_EXT[file.slice(dot).toLowerCase()] ?? 'application/octet-stream'
}

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Require the method or answer 405. */
function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/** Read a JSON request body (bounded). */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        queueMicrotask(() => req.destroy())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/** Shared route fence: loopback always passes; a live paired-device cookie is an extra allow path. */
function guard(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  if (isPetAllowed(ctx, req)) return true
  json(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** Wrap one async service call as a GET JSON route. */
function getRoute(ctx: Context, path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!guard(ctx, req, res)) return
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(ctx: Context, path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!guard(ctx, req, res)) return Promise.resolve()
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      return readJsonBody(req).then((body) => {
        const record = (typeof body === 'object' && body !== null) ? body as Record<string, unknown> : {}
        return run(record).then(
          (value) => json(res, 200, value),
          (error) => {
            json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          },
        )
      }, (error) => {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Legacy URL aliases: each entry's directory basename (e.g. 'whale'). */
function dirAliases(registry: PetRegistry): Map<string, PetEntry> {
  const aliases = new Map<string, PetEntry>()
  for (const entry of registry.entries) {
    const alias = entry.dir.split(/[\\/]/).pop() ?? ''
    if (alias !== '' && !aliases.has(alias)) aliases.set(alias, entry)
  }
  return aliases
}

/**
 * The one asset handler behind the '/pet' prefix. Resolves the pet by id (or
 * legacy directory alias), then serves exactly the files a manifest declares:
 * pet.json, the entry's servable set (the sprite2d atlas, or the live2d
 * model3.json plus its reference closure — pet-center M3), and optional
 * 'previews/<name>' media. The servable match is an exact string comparison
 * against scan-time normalized paths, so crafted '..' or '.' segments never
 * match; containedRealpath stays as the second layer. Composed pets without
 * a manifest file get a synthesized pet.json.
 */
function assetHandler(ctx: Context, registry: PetRegistry, caps: PetAssetCaps): WebRoute['handler'] {
  const aliases = dirAliases(registry)
  return ((req: IncomingMessage, res: ServerResponse) => {
    if (!guard(ctx, req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://pet.local').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const segments = pathname.split('/').filter(segment => segment !== '')
    if (segments[0] !== 'pet' || segments[1] === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    let id: string
    try {
      id = decodeURIComponent(segments[1])
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const entry = registry.byId(id) ?? aliases.get(id)
    if (entry === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    const rest: string[] = []
    for (const segment of segments.slice(2)) {
      let decoded: string
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      rest.push(decoded)
    }
    const rel = rest.join('/')
    let file: string | undefined
    let synthesized = false
    if (rest.length === 1 && rest[0] === MANIFEST_FILE) {
      const manifestFile = join(entry.dir, MANIFEST_FILE)
      file = existsSync(manifestFile) ? manifestFile : undefined
      if (file === undefined) synthesized = true
    } else if (rest.length > 0 && entry.servable.includes(rel)) {
      file = join(entry.dir, rel)
    } else if (rest.length === 2 && rest[0] === PREVIEW_DIR && PREVIEW_PATTERN.test(rest[1]!)) {
      const preview = join(entry.dir, PREVIEW_DIR, rest[1]!)
      file = existsSync(preview) ? preview : undefined
    }
    if (synthesized) {
      const body = Buffer.from(JSON.stringify(petEntryView(entry, registry.globalVoice), null, 2), 'utf8')
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
      return
    }
    if (file === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    // realpath containment: a symlink escaping the pet directory is refused.
    const resolved = containedRealpath(entry.dir, file)
    if (resolved === undefined) {
      res.writeHead(403)
      res.end()
      return
    }
    // Enforce the size ceiling before the file is read into memory.
    const cap = rest.length === 1 && rest[0] === MANIFEST_FILE
      ? caps.manifest
      : IMAGE_EXTENSIONS.has(extensionOf(rel)) ? caps.image : caps.model
    try {
      if (statSync(resolved).size > cap) {
        res.writeHead(413)
        res.end()
        return
      }
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    return readFile(resolved).then((body) => {
      res.writeHead(200, {
        'content-type': mimeFor(resolved),
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
    }, () => {
      res.writeHead(404)
      res.end()
    })
  }) as WebRoute['handler']
}

/** Browser-facing base path of the plugin runtime files (pet-center M3). */
export const PET_RUNTIME_PREFIX = PET_API_PREFIX + '/runtime'

/**
 * The runtime files the route may serve, by exact name (no slashes, no
 * user-controlled path segments, so traversal is structurally impossible):
 * the user-supplied Cubism Core from the pet runtime directory (the plugin
 * never bundles or downloads it — issue #623 M1 §0) and the plugin-shipped
 * MIT vendor bundle from the package lib directory.
 */
const RUNTIME_FILES: Readonly<Record<string, { root: 'runtimeDir' | 'vendorDir' }>> = {
  'live2dcubismcore.min.js': { root: 'runtimeDir' },
  'live2d-vendor.js': { root: 'vendorDir' },
  'live2d-vendor.js.map': { root: 'vendorDir' },
}

/** Size ceiling for one runtime file (the Cubism Core is ~200 KB today). */
export const PET_RUNTIME_CAP = 16 * 1024 * 1024

/** Runtime file roots (test seam; defaults resolve from the environment). */
export interface PetRuntimeRoots {
  /** User-supplied runtime directory (defaults to '$DSH_HOME/pets/.runtime'). */
  runtimeDir?: string
  /** Plugin vendor bundle directory (defaults to the package 'lib'). */
  vendorDir?: string
}

/**
 * The runtime handler behind '/api/pet/runtime/<name>'. A missing file
 * answers 404 with a JSON marker the client renderer turns into install
 * guidance (the Cubism Core is user-supplied, so its absence is a normal
 * state, not an error).
 */
function runtimeHandler(ctx: Context, roots: { runtimeDir: string; vendorDir: string }): WebRoute['handler'] {
  return ((req: IncomingMessage, res: ServerResponse) => {
    if (!guard(ctx, req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://pet.local').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const rest = pathname.slice(PET_RUNTIME_PREFIX.length).replace(/^\/+/, '')
    let name: string
    try {
      name = decodeURIComponent(rest)
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const spec = RUNTIME_FILES[name]
    // Exact-name allow-list: anything with a path separator never matches.
    if (spec === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    const base = spec.root === 'runtimeDir' ? roots.runtimeDir : roots.vendorDir
    const file = join(base, name)
    if (!existsSync(file)) {
      json(res, 404, { ok: false, error: 'runtime-file-missing', file: name })
      return
    }
    const resolved = containedRealpath(base, file)
    if (resolved === undefined) {
      res.writeHead(403)
      res.end()
      return
    }
    try {
      if (statSync(resolved).size > PET_RUNTIME_CAP) {
        res.writeHead(413)
        res.end()
        return
      }
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    return readFile(resolved).then((body) => {
      res.writeHead(200, {
        'content-type': name.endsWith('.map') ? 'application/json' : 'application/javascript; charset=utf-8',
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
    }, () => {
      res.writeHead(404)
      res.end()
    })
  }) as WebRoute['handler']
}

/**
 * The decoration asset handler behind '/api/pet/decoration/<id>/<file>'
 * (pet-center M5, #567). Serves exactly the files a decoration descriptor
 * declares — decoration.json and the PNG/WebP strip — by exact allow-list
 * match, with realpath containment and the same size ceilings as pet
 * assets. Crafted '..' or '.' segments never match the normalized closure.
 */
function decorationHandler(ctx: Context, registry: PetRegistry, caps: PetAssetCaps): WebRoute['handler'] {
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (!guard(ctx, req, res)) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://pet.local').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const segments = pathname.split('/').filter(segment => segment !== '')
    const prefixSegments = DECORATION_ASSET_PREFIX.split('/').filter(segment => segment !== '')
    if (segments.length < prefixSegments.length + 2) {
      res.writeHead(404)
      res.end()
      return
    }
    for (let i = 0; i < prefixSegments.length; i += 1) {
      if (segments[i] !== prefixSegments[i]) {
        res.writeHead(404)
        res.end()
        return
      }
    }
    let id: string
    try {
      id = decodeURIComponent(segments[prefixSegments.length])
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const entry = registry.decorationById?.(id)
    if (entry === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    const rest: string[] = []
    for (const segment of segments.slice(prefixSegments.length + 1)) {
      let decoded: string
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      rest.push(decoded)
    }
    const rel = rest.join('/')
    if (!entry.servable.includes(rel)) {
      res.writeHead(404)
      res.end()
      return
    }
    const file = join(entry.dir, rel)
    const resolved = containedRealpath(entry.dir, file)
    if (resolved === undefined) {
      res.writeHead(403)
      res.end()
      return
    }
    const cap = rel === 'decoration.json' ? caps.manifest : caps.image
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(resolved)
      if (stat.size > cap) {
        res.writeHead(413)
        res.end()
        return
      }
    } catch {
      res.writeHead(404)
      res.end()
      return
    }
    // Weak ETag from size + mtime: 'no-cache' forces revalidation, and the
    // validator lets repeat requests settle as 304 — the ornament remounts
    // on whisper and display-session flips, and without a validator each
    // remount would re-download the full strip body.
    const etag = '"' + stat.size.toString(16) + '-' + Math.round(stat.mtimeMs).toString(16) + '"'
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'no-cache' })
      res.end()
      return
    }
    readFile(resolved).then((body) => {
      res.writeHead(200, {
        'content-type': mimeFor(resolved),
        'content-length': String(body.byteLength),
        'cache-control': 'no-cache',
        etag,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      res.end(body)
    }, () => {
      res.writeHead(404)
      res.end()
    })
  }
}

/** Build the full route family (API + assets + runtime) for one service. */
export function makePetRoutes(deps: { service: PetService; ctx: Context; assetCaps?: PetAssetCaps } & PetRuntimeRoots): WebRoute[] {
  const { service, ctx } = deps
  const apiRoutes: WebRoute[] = [
    getRoute(ctx, PET_API_PREFIX + '/state', () => service.state()),
    getRoute(ctx, PET_API_PREFIX + '/pets', () => service.pets()),
    getRoute(ctx, PET_API_PREFIX + '/diagnostics', () => service.diagnostics()),
    postRoute(ctx, PET_API_PREFIX + '/interact', (body) => {
      const kind = body.kind as PetInteraction | undefined
      if (kind !== 'pet' && kind !== 'feed') return Promise.reject(new Error('invalid-kind'))
      return service.interact(kind)
    }),
    postRoute(ctx, PET_API_PREFIX + '/set-visible', (body) => {
      const visible = body.visible
      if (typeof visible !== 'boolean') return Promise.reject(new Error('invalid-visible'))
      return service.setVisible(visible)
    }),
    postRoute(ctx, PET_API_PREFIX + '/set-config', (body) => service.setConfig({
      ...(typeof body.size === 'number' ? { size: body.size } : {}),
      ...(typeof body.right === 'number' ? { right: body.right } : {}),
      ...(typeof body.bottom === 'number' ? { bottom: body.bottom } : {}),
      ...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
    })),
    postRoute(ctx, PET_API_PREFIX + '/set-name', (body) => {
      const name = body.name
      if (typeof name !== 'string') return Promise.reject(new Error('invalid-name'))
      return service.setName(name)
    }),
    postRoute(ctx, PET_API_PREFIX + '/set-pet', (body) => {
      const petId = body.petId
      if (typeof petId !== 'string') return Promise.reject(new Error('invalid-pet'))
      return service.setPetId(petId)
    }),
  ]

  const assetRoute: WebRoute = {
    kind: 'prefix',
    path: PET_ASSET_PREFIX,
    handler: assetHandler(ctx, service.registrySnapshot(), deps.assetCaps ?? PET_ASSET_CAPS),
  }

  const runtimeRoute: WebRoute = {
    kind: 'prefix',
    path: PET_RUNTIME_PREFIX,
    handler: runtimeHandler(ctx, {
      runtimeDir: deps.runtimeDir ?? join(dshHome(), 'pets', '.runtime'),
      vendorDir: deps.vendorDir ?? join(petPackageRoot(import.meta.url), 'lib'),
    }),
  }

  const decorationRoute: WebRoute = {
    kind: 'prefix',
    path: DECORATION_ASSET_PREFIX,
    handler: decorationHandler(ctx, service.registrySnapshot(), deps.assetCaps ?? PET_ASSET_CAPS),
  }

  return [...apiRoutes, assetRoute, runtimeRoute, decorationRoute]
}

// Re-exported for the package surface (the registry owns the definition now).
export { petPackageRoot } from './registry.ts'
