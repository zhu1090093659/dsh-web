/**
 * Skin-center v2 HTTP routes (issue #506, M2) — the loading/serving half of
 * the new architecture. Pure read-only asset serving plus the active-skin
 * selection write; the actual switch happens browser-side (atomic swap, no
 * reload, no cordis.patch.yml rewrite).
 *
 * Endpoints (all under /api/skin-center/v2):
 *  - GET  /catalog                     catalog snapshot (installed skins + diagnostics)
 *  - GET  /skins/<id>/stylesheet       transformed + scoped skin.css
 *  - GET  /skins/<id>/patches          transformed + scoped patches.css (404 when absent)
 *  - GET  /skins/<id>/hooks.mjs        the escape-hatch entry (404 when absent)
 *  - GET  /skins/<id>/assets/<path>    static in-directory assets (incl. preview/)
 *  - GET  /active                      the persisted active skin id + background preferences
 *  - POST /active                      persist active id and/or background (same-origin fenced)
 *
 * The stylesheet/patches responses pass through the CSS safety pipeline
 * (force-scoped under html[data-dsh-skin="<id>"], whitelist fail-closed), so
 * the browser can inject them blindly. hooks.mjs is served verbatim — it is
 * trusted, same-review same-release code (high sensitivity, see contracts/),
 * served for built-in skins and for user-directory skins whose install
 * provenance pins the bytes to the official DSH Market (issue #1073).
 * @module @linxin666/dsh-client-ui-skin-center/routes-v2
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import { writeJson, requireSameOrigin } from './http-utils.ts'
import { readJsonBody } from './http.ts'
import { defaultActiveStatePath, readActiveState, writeActiveState } from './active-state.ts'
import { sanitizeSkinBackground, type SkinBackgroundConfig } from './core/background.ts'
import { transformSkinCss, SkinCssSafetyError } from './core/css-safety/transform.ts'
import { findSkin, loadSkinCatalog, resolveInsideSkin, shippedSkinIds } from './skin-repo.ts'
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
  /** Shipped builtin id set (defaults to the package.json files whitelist). */
  shippedSkinIds?: () => Set<string>
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
    writeJson(res, 404, { ok: false, error: 'stylesheet-not-found' })
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
      writeJson(res, 422, { ok: false, error: 'css-whitelist-violation', violations: error.violations })
      return
    }
    writeJson(res, 500, { ok: false, error: 'css-transform-failed', detail: (error as Error)?.message ?? String(error) })
  }
}

/** Serve one static file from inside the skin directory (fail-closed). */
function serveAsset(res: ServerResponse, entry: SkinCatalogEntry, relPath: string): void {
  const abs = resolveInsideSkin(entry, relPath)
  if (!abs || !existsSync(abs) || !statSync(abs).isFile()) {
    writeJson(res, 404, { ok: false, error: 'asset-not-found' })
    return
  }
  const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' })
  res.end(readFileSync(abs))
}

/**
 * Build the v2 route set. Registration is the caller's job (the host entry
 * keeps the mount-once discipline).
 */
export function makeSkinCenterV2Routes(deps: RoutesV2Deps = {}): WebRoute[] {
  const loadCatalog = deps.loadCatalog ?? (() => loadSkinCatalog())
  const activeStatePath = deps.activeStatePath ?? defaultActiveStatePath()
  // Installed-only catalog (market/store separation): user dirs are always
  // installed, builtins only when the package ships them (files whitelist).
  const shippedSet = (deps.shippedSkinIds ?? shippedSkinIds)()

  const catalogHandler: WebRoute['handler'] = (_req, res) => {
    const catalog = loadCatalog()
    writeJson(res, 200, {
      ok: true,
      capturedAt: catalog.capturedAt,
      skins: catalog.skins
        .filter((s) => s.origin === 'user' || shippedSet.has(s.manifest.id))
        .map((s) => ({
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
      writeJson(res, 404, { ok: false, error: 'skin-not-found' })
      return
    }
    if (sub === 'stylesheet') {
      serveStylesheet(res, entry, entry.manifest.contributes.stylesheet, 'skin.css')
      return
    }
    if (sub === 'patches') {
      const patches = entry.manifest.contributes.patches
      if (!patches) {
        writeJson(res, 404, { ok: false, error: 'no-patches' })
        return
      }
      serveStylesheet(res, entry, patches, 'patches.css')
      return
    }
    if (sub === 'hooks.mjs') {
      const facet = entry.manifest.facets?.client
      if (!facet) {
        writeJson(res, 404, { ok: false, error: 'no-hooks' })
        return
      }
      // Trust model (contracts/README.md): hooks are trusted code that shares
      // THIS repository's review and release. A user-directory skin never
      // went through that review, so its hooks are refused even though its
      // declarative parts load fine — UNLESS it was installed from the
      // official DSH Market and its skin.json + hooks bytes hash-match the
      // recorded install provenance, which proves they are exactly the
      // same-review content this repository published (issue #1073).
      if (entry.origin !== 'builtin' && entry.hooksTrusted !== true) {
        writeJson(res, 403, { ok: false, error: 'hooks-require-review', origin: entry.origin })
        return
      }
      const abs = resolveInsideSkin(entry, facet.entry)
      if (!abs || !existsSync(abs)) {
        writeJson(res, 404, { ok: false, error: 'hooks-not-found' })
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
    writeJson(res, 404, { ok: false, error: 'unknown-skin-resource' })
  }

  const activeGetHandler: WebRoute['handler'] = (_req, res) => {
    const state = readActiveState(activeStatePath)
    writeJson(res, 200, { ok: true, active: state.active, background: state.background })
  }

  // POST accepts { active?, background? } with merge semantics (issue #996):
  // a key left out keeps its stored value, so a remote background write never
  // disturbs the active selection and vice versa.
  const activePostHandler: WebRoute['handler'] = async (req, res) => {
    if (!requireSameOrigin(req, res)) return
    // Shared lenient reader (16 KiB cap): invalid JSON, an over-limit body
    // (destroyed) and an empty body all yield null and answer the same 400
    // invalid-body envelope the old reader's rejection branch used.
    let body: unknown
    try {
      body = await readJsonBody(req, { maxBytes: 16 * 1024 })
    } catch {
      writeJson(res, 400, { ok: false, error: 'invalid-body' })
      return
    }
    if (body === null) {
      writeJson(res, 400, { ok: false, error: 'invalid-body' })
      return
    }
    const hasActive = typeof body === 'object' && body !== null && 'active' in body
    const hasBackground = typeof body === 'object' && body !== null && 'background' in body
    if (!hasActive && !hasBackground) {
      writeJson(res, 400, { ok: false, error: 'nothing-to-update' })
      return
    }
    const active = (body as { active?: unknown }).active
    if (hasActive && active !== null && typeof active !== 'string') {
      writeJson(res, 400, { ok: false, error: 'active-must-be-string-or-null' })
      return
    }
    if (typeof active === 'string' && !findSkin(loadCatalog(), active)) {
      writeJson(res, 404, { ok: false, error: 'skin-not-found' })
      return
    }
    const update: { active?: string | null; background?: SkinBackgroundConfig | null } = {}
    if (hasActive) update.active = active as string | null
    if (hasBackground) {
      const background = sanitizeSkinBackground((body as { background?: unknown }).background)
      if (background === null) {
        writeJson(res, 400, { ok: false, error: 'invalid-background' })
        return
      }
      update.background = background
    }
    writeActiveState(activeStatePath, update)
    const state = readActiveState(activeStatePath)
    writeJson(res, 200, { ok: true, active: state.active, background: state.background })
  }

  return [
    { kind: 'exact', path: `${SKIN_CENTER_V2_PREFIX}/catalog`, handler: catalogHandler },
    { kind: 'prefix', path: skinPrefix.replace(/\/$/, ''), handler: skinsHandler },
    { kind: 'exact', path: `${SKIN_CENTER_V2_PREFIX}/active`, handler: (req, res) => {
      if (req.method === 'GET') return activeGetHandler(req, res)
      if (req.method === 'POST') return activePostHandler(req, res)
      writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
    } },
  ]
}
