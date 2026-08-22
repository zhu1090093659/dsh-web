/**
 * Skin-center v2 HTTP routes (issue #506, M2) — the loading/serving half of
 * the new architecture. Pure read-only asset serving plus the active-skin
 * selection write; the actual switch happens browser-side (atomic swap, no
 * reload, no cordis.patch.yml rewrite).
 *
 * Endpoints (all under /api/skin-center/v2):
 *  - GET  /catalog                     catalog snapshot (skins + diagnostics)
 *  - GET  /skins/<id>/stylesheet       transformed + scoped skin.css
 *  - GET  /skins/<id>/patches          transformed + scoped patches.css (404 when absent)
 *  - GET  /skins/<id>/hooks.mjs        the escape-hatch entry (404 when absent)
 *  - GET  /skins/<id>/assets/<path>    static in-directory assets (incl. preview/)
 *  - GET  /active                      the persisted active skin id + background preferences
 *  - POST /active                      persist the active skin id and/or the
 *                                      background preferences (same-origin fenced;
 *                                      omitted fields preserve the stored value)
 *
 * The stylesheet/patches responses pass through the CSS safety pipeline
 * (force-scoped under html[data-dsh-skin="<id>"], whitelist fail-closed), so
 * the browser can inject them blindly. hooks.mjs is served verbatim — it is
 * trusted, same-review same-release code (high sensitivity, see contracts/).
 * @module @linxin666/dsh-client-ui-skin-center/routes-v2
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { json, requireSameOrigin } from './http-utils.ts'
import { defaultActiveStatePath, readActiveState, writeActiveState } from './active-state.ts'
import { parseBackgroundConfig, type SkinBackgroundConfig } from './core/background.ts'
import { transformSkinCss, SkinCssSafetyError } from './core/css-safety/transform.ts'
import { findSkin, loadSkinCatalog, resolveInsideSkin } from './skin-repo.ts'
import type { SkinCatalog, SkinCatalogEntry } from './skin-repo.ts'

export const SKIN_CENTER_V2_PREFIX = '/api/skin-center/v2'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
}

export interface RoutesV2Deps {
  /** Catalog loader (defaults to the real dual-source scan). */
  loadCatalog?: () => SkinCatalog
  /** Where the active-skin selection persists (defaults under $DSH_HOME). */
  activeStatePath?: string
  /** Now function for catalog capture. */
  now?: () => number
}

function sendCss(res: ServerResponse, status: number, code: string): void {
  res.writeHead(status, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-store' })
  res.end(code)
}

/** Serve one manifest-referenced stylesheet through the safety pipeline. */
function serveStylesheet(
  res: ServerResponse,
  entry: SkinCatalogEntry,
  relPath: string,
  filename: string,
): void {
  const abs = resolveInsideSkin(entry, relPath)
  if (!abs || !existsSync(abs)) {
    json(res, 404, { ok: false, error: 'stylesheet-not-found' })
    return
  }
  try {
    // Warnings are diagnostic surface (catalog/CLI), not transport: HTTP
    // headers reject non-Latin1 bytes and skin warnings can embed selector
    // fragments with CJK text.
    const { code } = transformSkinCss(readFileSync(abs, 'utf8'), {
      skinId: entry.manifest.id,
      filename,
      // Only the main stylesheet derives fallback tints; patches re-deriving
      // from their partial token view would override the skin's real values.
      deriveFallbacks: filename === 'skin.css',
    })
    sendCss(res, 200, code)
  } catch (error) {
    if (error instanceof SkinCssSafetyError) {
      json(res, 422, { ok: false, error: 'css-whitelist-violation', violations: error.violations })
      return
    }
    json(res, 500, { ok: false, error: 'css-transform-failed', detail: (error as Error)?.message ?? String(error) })
  }
}

/** Serve one static file from inside the skin directory (fail-closed). */
function serveAsset(res: ServerResponse, entry: SkinCatalogEntry, relPath: string): void {
  const abs = resolveInsideSkin(entry, relPath)
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
    json(res, 404, { ok: false, error: 'asset-not-found' })
    return
  }
  const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' })
  res.end(readFileSync(abs))
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Build the v2 route set. Registration is the caller's job (the host entry
 * keeps the mount-once discipline).
 */
export function makeSkinCenterV2Routes(deps: RoutesV2Deps = {}): WebRoute[] {
  const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog())
  const activeStatePath = deps.activeStatePath ?? defaultActiveStatePath()

  const catalogHandler: WebRoute['handler'] = (_req, res) => {
    const catalog = loadCatalog()
    json(res, 200, {
      ok: true,
      capturedAt: catalog.capturedAt,
      skins: catalog.skins.map((s) => ({
        origin: s.origin,
        warnings: s.warnings,
        manifest: s.manifest,
      })),
      diagnostics: catalog.diagnostics,
    })
  }

  const skinPrefix = `${SKIN_CENTER_V2_PREFIX}/skins/`

  const skinsHandler: WebRoute['handler'] = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const rest = url.pathname.slice(skinPrefix.length)
    const [id, ...tail] = rest.split('/')
    const sub = tail.join('/')
    const catalog = loadCatalog()
    const entry = id ? findSkin(catalog, id) : null
    if (!entry) {
      json(res, 404, { ok: false, error: 'skin-not-found' })
      return
    }
    if (sub === 'stylesheet') {
      serveStylesheet(res, entry, entry.manifest.contributes.stylesheet, 'skin.css')
      return
    }
    if (sub === 'patches') {
      const patches = entry.manifest.contributes.patches
      if (!patches) {
        json(res, 404, { ok: false, error: 'no-patches' })
        return
      }
      serveStylesheet(res, entry, patches, 'patches.css')
      return
    }
    if (sub === 'hooks.mjs') {
      const facet = entry.manifest.facets?.client
      if (!facet) {
        json(res, 404, { ok: false, error: 'no-hooks' })
        return
      }
      // Trust model (contracts/README.md): hooks are trusted code that shares
      // THIS repository's review and release. A user-directory skin never
      // went through that review, so its hooks are refused even though its
      // declarative parts load fine.
      if (entry.origin !== 'builtin') {
        json(res, 403, { ok: false, error: 'hooks-require-review', origin: entry.origin })
        return
      }
      const abs = resolveInsideSkin(entry, facet.entry)
      if (!abs || !existsSync(abs)) {
        json(res, 404, { ok: false, error: 'hooks-not-found' })
        return
      }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(readFileSync(abs))
      return
    }
    if (sub.startsWith('assets/') || sub.startsWith('preview/')) {
      serveAsset(res, entry, sub)
      return
    }
    json(res, 404, { ok: false, error: 'unknown-skin-resource' })
  }

  const activeGetHandler: WebRoute['handler'] = (_req, res) => {
    const state = readActiveState(activeStatePath)
    json(res, 200, { ok: true, active: state.active, background: state.background })
  }

  const activePostHandler: WebRoute['handler'] = async (req, res) => {
    if (!requireSameOrigin(req, res)) return
    let body: unknown
    try {
      body = await readBody(req)
    } catch {
      json(res, 400, { ok: false, error: 'invalid-body' })
      return
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      json(res, 400, { ok: false, error: 'invalid-body' })
      return
    }
    const record = body as Record<string, unknown>
    const hasActive = 'active' in record
    const hasBackground = 'background' in record
    if (!hasActive && !hasBackground) {
      json(res, 400, { ok: false, error: 'invalid-body' })
      return
    }
    // Both fields merge over the stored state: an omitted field preserves
    // the current value, an explicit null clears it.
    const state = readActiveState(activeStatePath)
    let nextActive = state.active
    if (hasActive) {
      const active = record.active
      if (active !== null && typeof active !== 'string') {
        json(res, 400, { ok: false, error: 'active-must-be-string-or-null' })
        return
      }
      if (typeof active === 'string' && !findSkin(loadCatalog(), active)) {
        json(res, 404, { ok: false, error: 'skin-not-found' })
        return
      }
      nextActive = active as string | null
    }
    let nextBackground: SkinBackgroundConfig | null | undefined
    if (hasBackground) {
      const background = record.background
      if (background === null) {
        nextBackground = null
      } else {
        // Clamp-then-validate: out-of-range numbers narrow into range, wrong
        // types or shapes stay invalid and reject the request.
        const parsed = parseBackgroundConfig(background)
        if (parsed === null) {
          json(res, 400, { ok: false, error: 'invalid-background' })
          return
        }
        nextBackground = parsed
      }
    }
    writeActiveState(activeStatePath, nextActive, nextBackground)
    const after = readActiveState(activeStatePath)
    json(res, 200, { ok: true, active: after.active, background: after.background })
  }

  return [
    { kind: 'exact', path: `${SKIN_CENTER_V2_PREFIX}/catalog`, handler: catalogHandler },
    { kind: 'prefix', path: skinPrefix.replace(/\/$/, ''), handler: skinsHandler },
    { kind: 'exact', path: `${SKIN_CENTER_V2_PREFIX}/active`, handler: (req, res) => {
      if (req.method === 'GET') return activeGetHandler(req, res)
      if (req.method === 'POST') return activePostHandler(req, res)
      json(res, 405, { ok: false, error: 'method-not-allowed' })
    } },
  ]
}
