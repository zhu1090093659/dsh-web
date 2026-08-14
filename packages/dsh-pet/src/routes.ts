/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints (`/api/pet/*`) and loads the whale-girl atlas
 * from `/pet/whale/*`. The `/plugins/` endpoint only serves client bundles
 * and RPC domains are platform-registered, so the pet serves its own API
 * and media — the same pattern as dsh-remote-web-ui's `/api/pair` family.
 * @module @linxin666/dsh-pet/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'
import type { PetInteraction } from './affinity.ts'

/** Browser-facing base path of the pet API. */
export const PET_API_PREFIX = '/api/pet'

/** Browser-facing base path of the pet asset routes. */
export const PET_ASSET_PREFIX = '/pet/whale'

/** Relative (to package root) asset files exposed under the prefix. */
const ASSET_FILES = [
  { name: 'spritesheet.webp', mime: 'image/webp' },
  { name: 'pet.json', mime: 'application/json' },
] as const

/** Absolute package root, resolved from this module's own location (lib/). */
export function petPackageRoot(importMetaUrl: string): string {
  return fileURLToPath(new URL('../', importMetaUrl))
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
        // Reject first so the error handler can write the 400 response,
        // then close the connection once the response is flushed.
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

/** Wrap one async service call as a GET JSON route. */
function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(path: string, run: (body: Record<string, unknown>) => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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

/** Build the full route family (API + assets) for one service + package root. */
export function makePetRoutes(deps: { service: PetService; packageRoot: string }): WebRoute[] {
  const { service, packageRoot } = deps
  const apiRoutes: WebRoute[] = [
    getRoute(`${PET_API_PREFIX}/state`, () => service.state()),
    postRoute(`${PET_API_PREFIX}/interact`, (body) => {
      const kind = body.kind as PetInteraction | undefined
      if (kind !== 'pet' && kind !== 'feed') return Promise.reject(new Error('invalid-kind'))
      return service.interact(kind)
    }),
    postRoute(`${PET_API_PREFIX}/set-visible`, (body) => {
      const visible = body.visible
      if (typeof visible !== 'boolean') return Promise.reject(new Error('invalid-visible'))
      return service.setVisible(visible)
    }),
    postRoute(`${PET_API_PREFIX}/set-config`, (body) => service.setConfig({
      ...(typeof body.size === 'number' ? { size: body.size } : {}),
      ...(typeof body.right === 'number' ? { right: body.right } : {}),
      ...(typeof body.bottom === 'number' ? { bottom: body.bottom } : {}),
      ...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
    })),
    postRoute(`${PET_API_PREFIX}/set-name`, (body) => {
      const name = body.name
      if (typeof name !== 'string') return Promise.reject(new Error('invalid-name'))
      return service.setName(name)
    }),
  ]

  const assetRoutes: WebRoute[] = ASSET_FILES.map((file): WebRoute => ({
    kind: 'exact',
    path: `${PET_ASSET_PREFIX}/${file.name}`,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> | void => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      return readFile(join(packageRoot, 'assets', 'whale', file.name)).then((body) => {
        res.writeHead(200, {
          'content-type': file.mime,
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
    },
  }))

  return [...apiRoutes, ...assetRoutes]
}
