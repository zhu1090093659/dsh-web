/**
 * Skin-center HTTP routes — the browser half talks to the host through plain
 * same-origin endpoints: JSON for state/apply, plus the bundle route serving
 * each skin's prebuilt `lib/client.js` as a same-origin script for live
 * try-on (the GUI never embeds the ~700KB of art base64 in its own bundle).
 * The host half delegates skin switching to the `dsh-skin` CLI
 * (the single authority over the `dsh-skin managed` section of
 * `~/.dsh/cordis.patch.yml` and the profile symlink), so switching skins from
 * the GUI is exactly `dsh-skin use <name>` — the config watcher hot-reloads
 * the patch within seconds and the frontend reloads the page to pick up the
 * new boot graph. Same pattern as dsh-pet's `/api/pet` family.
 *
 * Unlike pet's behavioral endpoints, `/apply` writes the user's boot config,
 * so every route also rejects cross-site requests (Sec-Fetch-Site / Origin
 * fence) — a malicious webpage must not be able to switch the user's skin
 * through a localhost CSRF post.
 * @module @linxin666/dsh-client-ui-skin-center/routes
 */

import { execFile } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Browser-facing base path of the skin-center API. */
export const SKIN_CENTER_API_PREFIX = '/api/skin-center'

/** Cap a dsh-skin invocation; a hung CLI must never block the server. */
const DSH_SKIN_TIMEOUT_MS = 15000

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
 * Run `dsh-skin <args>` and resolve with its stdout.
 * @param args - CLI arguments (e.g. `['use', 'qq98']`).
 * @returns stdout on exit code 0.
 * @throws the CLI's stderr (or the spawn error) on any failure.
 */
function runDshSkin(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    // On Windows, `execFile` cannot spawn a bare-name .cmd shim (ENOENT/EINVAL);
    // route through the shell so cmd.exe resolves `dsh-skin.cmd` on PATH.
    const win = process.platform === 'win32'
    execFile('dsh-skin', args, { timeout: DSH_SKIN_TIMEOUT_MS, shell: win }, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      const spawnError = error as NodeJS.ErrnoException
      if (spawnError.code === 'ENOENT') {
        reject(new Error('dsh-skin CLI not found on PATH — install it from dsh-web-ui/scripts/dsh-skin'))
        return
      }
      const detail = (stderr ?? '').trim() || spawnError.message
      reject(new Error(detail || `dsh-skin ${args.join(' ')} failed`))
    })
  })
}

/** The active skin as the CLI sees it ('none' = official stock look). */
function activeName(): Promise<string> {
  return runDshSkin(['current']).then(out => out.trim() || 'none')
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

/** Injectable dsh-skin runner (tests substitute a stub). */
export interface SkinCenterRoutesDeps {
  /** Run `dsh-skin <args>`, resolving stdout; defaults to the real CLI. */
  run?: (args: string[]) => Promise<string>
}

/** Repo layout: skin bundles live at packages/skins/<id>/lib/client.js. */
const SKINS_DIR = fileURLToPath(new URL('../../../skins/', import.meta.url))

/**
 * Map skin id -> directory under packages/skins/, scanned from each
 * skin.json. The id is validated against this map (never used as a raw
 * path) so the bundle route cannot be walked off the skins tree.
 * @returns skin id -> directory name.
 */
function skinDirectories(): Map<string, string> {
  const out = new Map<string, string>()
  for (const dir of readdirSync(SKINS_DIR)) {
    const metaFile = joinPath(SKINS_DIR, dir, 'skin.json')
    if (!statSync(metaFile, { throwIfNoEntry: false })) continue
    let meta: { id?: unknown }
    try {
      meta = JSON.parse(readFileSync(metaFile, 'utf8'))
    } catch {
      continue
    }
    if (typeof meta.id === 'string' && /^[a-z0-9-]+$/.test(meta.id)) out.set(meta.id, dir)
  }
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
        const dir = skinDirectories().get(id)
        if (dir === undefined) {
          json(res, 404, { ok: false, error: 'skin-not-found' })
          return
        }
        const bundle = joinPath(SKINS_DIR, dir, 'lib', 'client.js')
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
      const skin = body.skin
      const official = body.official === true
      if (typeof skin !== 'string' || skin === '') {
        if (!official) throw new Error('invalid-skin: pass a skin name or official: true')
      } else if (official) {
        throw new Error('invalid-skin: skin and official are mutually exclusive')
      }
      const target = official ? 'official' : skin
      const out = await run(['use', target])
      return {
        ok: true,
        active: await current(),
        message: out.trim(),
      }
    }),
  ]
}