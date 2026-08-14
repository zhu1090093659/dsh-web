/**
 * Skin-center HTTP routes — the browser half talks to the host through plain
 * same-origin endpoints: JSON for state/apply, plus the bundle route serving
 * each skin's prebuilt `lib/client.js` as a same-origin script for live
 * try-on (the GUI never embeds the ~700KB of art base64 in its own bundle).
 * The host half switches skins in-process (src/skin-switch.ts) — an ESM port
 * of the `dsh-skin` CLI that owns the `dsh-skin managed` section of
 * `~/.dsh/cordis.patch.yml` and the profile symlink, exactly like
 * `dsh-skin use <name>` — so no `dsh-skin` binary is required on PATH
 * (the bug zhu1090093659/dsh-web-ui#5). The config watcher hot-reloads the
 * patch within seconds and the frontend reloads the page to pick up the new
 * boot graph. Same pattern as dsh-pet's `/api/pet` family.
 *
 * Unlike pet's behavioral endpoints, `/apply` writes the user's boot config,
 * so every route also rejects cross-site requests (Sec-Fetch-Site / Origin
 * fence) — a malicious webpage must not be able to switch the user's skin
 * through a localhost CSRF post.
 * @module @linxin666/dsh-client-ui-skin-center/routes
 */

import { readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join as joinPath } from 'node:path'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { currentSkin, useSkin, SKINS_DIR, listSkinDirCandidates } from './skin-switch.ts'

/** Browser-facing base path of the skin-center API. */
export const SKIN_CENTER_API_PREFIX = '/api/skin-center'

/** One JSON response. */
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

/**
 * Same-origin fence. Browsers send `Sec-Fetch-Site` on every fetch: same-site
 * and cross-site pages both resolve their `Origin` here, so the checks are:
 * a `cross-site` fetch is always rejected, and an `Origin` that does not
 * match the request `Host` is rejected. Requests without either header
 * (curl, node http, old browsers) pass — this is a local single-user tool,
 * and the fence only targets the cross-site browser vector.
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

/** Reject cross-site requests with 403. */
function requireSameOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isSameOriginRequest(req)) return true
  json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
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

/**
 * In-process runner fulfilling the `dsh-skin <args>` contract used by the
 * routes (`['use', <name>]` and `['current']`). It never spawns a PATH
 * binary — it calls the embedded port of the CLI (src/skin-switch.ts), which
 * writes the boot patch and the profile symlink directly. Returns the same
 * stdout text the CLI would print, and rejects with the same error messages.
 * @param args - command arguments (e.g. `['use', 'qq98']`).
 */
function runDshSkin(args: string[]): Promise<string> {
  const [command, argument] = args
  switch (command) {
    case 'use':
      return Promise.resolve(useSkin(argument))
    case 'current':
      return Promise.resolve(currentSkin(undefined))
    default:
      return Promise.reject(new Error(`unexpected dsh-skin command: ${args.join(' ')}`))
  }
}

/** A GET route wrapping one async call, fenced to same-origin requests. */
function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      if (!requireSameOrigin(req, res)) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** A POST JSON route wrapping one async call, fenced to same-origin requests. */
function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!requireMethod(req, res, 'POST')) return Promise.resolve()
      if (!requireSameOrigin(req, res)) return Promise.resolve()
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

/** Injectable runner (tests substitute a stub); defaults to the in-process CLI port. */
export interface SkinCenterRoutesDeps {
  /** Run `['use', <name>]` / `['current']`, resolving the CLI-equivalent stdout. */
  run?: (args: string[]) => Promise<string>
}

/**
 * Map skin id -> directory under the skins root, scanned from each
 * skin.json. The id is validated against this map (never used as a raw
 * path) so the bundle route cannot be walked off the skins tree. The root
 * resolves per install layout (monorepo packages/skins/, npm
 * node_modules/@linxin666/) and candidates include the bundled dsh-skins
 * carrier (npm layout) — see skin-switch resolveSkinsDir /
 * listSkinDirCandidates.
 * @returns skin id -> directory name.
 */
/** Memoized id -> dir map; invalidated when the skins root (or the bundled
 * carrier dir) changes on disk, so a skin added mid-session still appears
 * without restarting. */
let directoriesCache: { key: string; map: Map<string, string> } | null = null

function skinDirectories(): Map<string, string> {
  const rootStat = statSync(SKINS_DIR, { throwIfNoEntry: false })
  const carrierStat = statSync(joinPath(SKINS_DIR, 'dsh-skins', 'skins'), { throwIfNoEntry: false })
  const key = `${rootStat?.mtimeMs ?? -1}|${carrierStat?.mtimeMs ?? -1}`
  if (directoriesCache !== null && directoriesCache.key === key) return directoriesCache.map
  const out = new Map<string, string>()
  for (const dir of listSkinDirCandidates(SKINS_DIR)) {
    let meta: { id?: unknown }
    try {
      meta = JSON.parse(readFileSync(joinPath(dir, 'skin.json'), 'utf8'))
    } catch {
      continue
    }
    if (typeof meta.id === 'string' && /^[a-z0-9-]+$/.test(meta.id)) out.set(meta.id, dir)
  }
  directoriesCache = { key, map: out }
  return out
}

/**
 * The on-demand bundle route: serve packages/skins/<id>/lib/client.js as a
 * same-origin script. Try-on loads it through a script tag (the kernel's
 * own bundle-loading mechanism), so the body registers the skin factory on
 * `window.__ModuleLoader__` without any eval.
 * @returns the prefix route (matches /api/skin-center/bundle/<id>).
 */
function bundleRoute(): WebRoute {
  const prefix = `${SKIN_CENTER_API_PREFIX}/bundle`
  return {
    kind: 'prefix',
    path: prefix,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      if (!requireSameOrigin(req, res)) return
      let id: string
      try {
        id = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(prefix.length + 1))
      } catch {
        json(res, 400, { ok: false, error: 'invalid-skin-id' })
        return
      }
      if (!/^[a-z0-9-]+$/.test(id)) {
        json(res, 400, { ok: false, error: 'invalid-skin-id' })
        return
      }
      try {
        // skinDirectories maps id -> ABSOLUTE candidate dir (see
        // listSkinDirCandidates): direct skin dirs or bundled
        // dsh-skins/skins/<id> carriers.
        const dir = skinDirectories().get(id)
        if (dir === undefined) {
          json(res, 404, { ok: false, error: 'skin-not-found' })
          return
        }
        const bundle = joinPath(dir, 'lib', 'client.js')
        if (!statSync(bundle, { throwIfNoEntry: false })) {
          json(res, 404, { ok: false, error: 'skin-bundle-missing' })
          return
        }
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        res.end(readFileSync(bundle, 'utf8'))
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

/**
 * Build the skin-center route family.
 * @param deps - optional runner override (tests).
 */
export function makeSkinCenterRoutes(deps: SkinCenterRoutesDeps = {}): WebRoute[] {
  const run = deps.run ?? runDshSkin
  const current = (): Promise<string> => run(['current']).then(out => out.trim() || 'none')
  return [
    getRoute(`${SKIN_CENTER_API_PREFIX}/state`, async () => ({
      ok: true,
      active: await current(),
    })),
    bundleRoute(),
    postRoute(`${SKIN_CENTER_API_PREFIX}/apply`, async (body) => {
      const official = body.official === true
      const skin = body.skin
      if (official) {
        // official = stock look; a skin name alongside it is a contradiction.
        if (skin !== undefined) throw new Error('invalid-skin: skin and official are mutually exclusive')
      } else if (typeof skin !== 'string' || skin === '') {
        throw new Error('invalid-skin: pass a skin name or official: true')
      }
      const target = official ? 'official' : skin as string
      const out = await run(['use', target])
      return {
        ok: true,
        active: await current(),
        message: out.trim(),
      }
    }),
  ]
}