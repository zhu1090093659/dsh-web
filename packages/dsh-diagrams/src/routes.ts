/**
 * The vendor route: `GET /api/dsh-diagrams/vendor/mermaid.js` serves the
 * vendored mermaid IIFE bundle the browser half loads on demand.
 *
 * The asset ships beside the built entry (`lib/assets/mermaid.min.js`, copied
 * at build time from `node_modules/mermaid/dist`), so it is read once and kept
 * in memory: it is immutable for a given package version, hence the far-future
 * cache header. A missing asset answers 404 instead of throwing — the browser
 * half then leaves mermaid fences as ordinary code blocks.
 *
 * Every response passes the family trust fence first (loopback always; a live
 * paired-device cookie when remote-web-ui is loaded), the same fence the other
 * family route families carry.
 * @module @linxin666/dsh-client-ui-diagrams/routes
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isPairedOrLoopbackAllowed } from './host/pair-access.ts'
import { RUNTIME_ROUTE } from './core/contract.ts'

/** Built location of the vendored runtime, beside the emitted host entry. */
export const DEFAULT_ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'mermaid.min.js')

/** Route family dependencies (tests inject fakes). */
export interface DiagramRouteDeps {
  /** Absolute path of the vendored runtime bundle. */
  assetPath?: string
}

/** Method gate: the bundle is read-only. */
const ALLOWED_METHODS = new Set(['GET', 'HEAD'])

/** Write a small JSON error the browser half ignores (it just falls back). */
function writeError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: message }))
}

/**
 * Build the diagram route family.
 * @param ctx - Host context, used by the shared trust fence.
 * @param deps - Asset path override for tests.
 * @returns The vendor route, ready for `ctx.webServer.register`.
 */
export function makeRoutes(ctx: Context, deps: DiagramRouteDeps = {}): WebRoute[] {
  const assetPath = deps.assetPath ?? DEFAULT_ASSET_PATH
  /** Read-once cache; `null` records "the asset is absent" so 404s stay cheap. */
  let cached: Buffer | null | undefined

  const readAsset = (): Buffer | null => {
    if (cached !== undefined) return cached
    try {
      cached = readFileSync(assetPath)
    } catch (error) {
      cached = null
      ctx.logger.warn(`diagrams: mermaid runtime asset is missing (${assetPath}): ${error instanceof Error ? error.message : String(error)}`)
    }
    return cached
  }

  return [
    {
      kind: 'exact',
      path: RUNTIME_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!isPairedOrLoopbackAllowed(ctx, req)) {
          writeError(res, 403, 'forbidden: loopback-only')
          return
        }
        if (!ALLOWED_METHODS.has(req.method ?? '')) {
          writeError(res, 405, `method not allowed: ${req.method ?? ''}`)
          return
        }
        const asset = readAsset()
        if (asset === null) {
          writeError(res, 404, 'mermaid runtime asset unavailable')
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.setHeader('Content-Length', String(asset.byteLength))
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        if ((req.method ?? '') === 'HEAD') {
          res.end()
          return
        }
        res.end(asset)
      },
    },
  ]
}
