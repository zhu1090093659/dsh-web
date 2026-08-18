/**
 * Pet HTTP routes — the browser half talks to the host through plain
 * same-origin JSON endpoints ('/api/pet/*') and loads pet assets from
 * '/pet/<id>/*'. The '/plugins/' endpoint only serves client bundles and RPC
 * domains are platform-registered, so the pet serves its own API and media —
 * the same pattern as dsh-remote-web-ui's '/api/pair' family. The asset route
 * is one prefix registration serving every registry entry (manifest, atlas,
 * optional previews), so adding a pet never touches route wiring.
 * @module @linxin666/dsh-pet/routes
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PetService } from './service.ts'
import type { PetInteraction } from './affinity.ts'
import {
  authorizePetNativeRequest,
  isPetNativeToken,
} from './adapters/web/native-auth.ts'
import { petEntryView, type PetEntry, type PetRegistry } from './registry.ts'
import { isLoopbackRequest } from './loopback.ts'

/** Browser-facing base path of the pet API. */
export const PET_API_PREFIX = '/api/pet'

/** Authenticated loopback bridge consumed only by a managed desktop child. */
export const PET_NATIVE_API_PREFIX = `${PET_API_PREFIX}/native`
export const PET_SSE_HEARTBEAT_MS = 15_000

/** Browser-facing base path of the pet asset routes ('/pet/<id>/...'). */
export const PET_ASSET_PREFIX = '/pet'

const MANIFEST_FILE = 'pet.json'
const PREVIEW_DIR = 'previews'
const PREVIEW_PATTERN = /^[A-Za-z0-9._-]+$/

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

/** Reject remote peers and requests that do not carry this Host boot's token. */
function requireNative(req: IncomingMessage, res: ServerResponse, token: string): boolean {
  const denial = authorizePetNativeRequest(req, token)
  if (denial === undefined) return true
  json(res, denial === 'NATIVE_LOOPBACK_REQUIRED' ? 403 : 401, { ok: false, error: denial })
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

/** Shared route fence: the browser UI is a loopback client; LAN hosts stay out. */
function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackRequest(req)) return true
  json(res, 403, { ok: false, error: 'forbidden: loopback-only' })
  return false
}

/** Wrap one async service call as a GET JSON route. */
type RequestGuard = (req: IncomingMessage, res: ServerResponse) => boolean

function getRoute(
  path: string,
  run: () => Promise<unknown>,
  authorize: RequestGuard = guard,
): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!authorize(req, res)) return
      if (!requireMethod(req, res, 'GET')) return
      run().then((value) => json(res, 200, value), (error) => {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      })
    },
  }
}

/** Wrap one async service call as a POST JSON route (body passed through). */
function postRoute(
  path: string,
  run: (body: Record<string, unknown>) => Promise<unknown>,
  authorize: RequestGuard = guard,
): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      if (!authorize(req, res)) return Promise.resolve()
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

/** Push every Host-owned state change to one authenticated desktop process. */
function eventStreamRoute(service: PetService, nativeToken: string): WebRoute {
  return {
    kind: 'exact',
    path: `${PET_NATIVE_API_PREFIX}/events`,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireNative(req, res, nativeToken) || !requireMethod(req, res, 'GET')) return
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.flushHeaders?.()

      let closed = false
      let heartbeat: NodeJS.Timeout | undefined
      let unsubscribe = (): void => undefined
      const onRequestClose = (): void => { close(false) }
      const close = (endResponse: boolean): void => {
        if (closed) return
        closed = true
        if (heartbeat !== undefined) clearInterval(heartbeat)
        unsubscribe()
        req.off('close', onRequestClose)
        if (endResponse && !res.writableEnded) res.end()
      }
      const send = (snapshot: Awaited<ReturnType<PetService['state']>>): void => {
        if (closed) return
        try {
          res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
          if (!service.isEnabled()) close(true)
        } catch {
          close(false)
        }
      }
      req.once('close', onRequestClose)
      const disposeSubscription = service.subscribeState(send)
      if (closed) {
        disposeSubscription()
        return
      }
      unsubscribe = disposeSubscription
      heartbeat = setInterval(() => {
        if (closed) return
        try {
          res.write(': heartbeat\n\n')
        } catch {
          close(false)
        }
      }, PET_SSE_HEARTBEAT_MS)
      heartbeat.unref?.()
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
 * pet.json, the declared spritesheet path, and optional 'previews/<name>'
 * media. Composed pets without a manifest file get a synthesized pet.json.
 */
function assetHandler(registry: PetRegistry): WebRoute['handler'] {
  const aliases = dirAliases(registry)
  return (req: IncomingMessage, res: ServerResponse): void => {
    if (!guard(req, res)) return
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
    } else if (rest.length > 0 && rel === entry.spritesheetPath) {
      file = join(entry.dir, entry.spritesheetPath)
    } else if (rest.length === 2 && rest[0] === PREVIEW_DIR && PREVIEW_PATTERN.test(rest[1]!)) {
      const preview = join(entry.dir, PREVIEW_DIR, rest[1]!)
      file = existsSync(preview) ? preview : undefined
    }
    if (synthesized) {
      const body = Buffer.from(JSON.stringify(petEntryView(entry), null, 2), 'utf8')
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
    const resolved = file
    readFile(resolved).then((body) => {
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
  }
}

/** Build the full route family (browser API, optional native bridge, and assets). */
export function makePetRoutes(deps: { service: PetService; nativeToken?: string }): WebRoute[] {
  const { service, nativeToken } = deps
  if (nativeToken !== undefined && !isPetNativeToken(nativeToken)) {
    throw new TypeError('invalid pet native token')
  }
  const apiRoutes: WebRoute[] = [
    getRoute(PET_API_PREFIX + '/state', () => service.state()),
    getRoute(PET_API_PREFIX + '/pets', () => service.pets()),
    postRoute(PET_API_PREFIX + '/interact', (body) => {
      const kind = body.kind as PetInteraction | undefined
      if (kind !== 'pet' && kind !== 'feed') return Promise.reject(new Error('invalid-kind'))
      return service.interact(kind)
    }),
    postRoute(PET_API_PREFIX + '/set-visible', (body) => {
      const visible = body.visible
      if (typeof visible !== 'boolean') return Promise.reject(new Error('invalid-visible'))
      return service.setVisible(visible)
    }),
    postRoute(PET_API_PREFIX + '/set-config', (body) => service.setConfig({
      ...(typeof body.size === 'number' ? { size: body.size } : {}),
      ...(typeof body.right === 'number' ? { right: body.right } : {}),
      ...(typeof body.bottom === 'number' ? { bottom: body.bottom } : {}),
      ...(typeof body.visible === 'boolean' ? { visible: body.visible } : {}),
    })),
    postRoute(PET_API_PREFIX + '/set-name', (body) => {
      const name = body.name
      if (typeof name !== 'string') return Promise.reject(new Error('invalid-name'))
      return service.setName(name)
    }),
    postRoute(PET_API_PREFIX + '/set-pet', (body) => {
      const petId = body.petId
      if (typeof petId !== 'string') return Promise.reject(new Error('invalid-pet'))
      return service.setPetId(petId)
    }),
  ]

  const assetRoute: WebRoute = {
    kind: 'prefix',
    path: PET_ASSET_PREFIX,
    handler: assetHandler(service.registrySnapshot()),
  }

  const nativeGuard: RequestGuard | undefined = nativeToken === undefined
    ? undefined
    : (req, res) => requireNative(req, res, nativeToken)
  const nativeRoutes: WebRoute[] = nativeGuard === undefined || nativeToken === undefined
    ? []
    : [
        getRoute(`${PET_NATIVE_API_PREFIX}/state`, () => service.state(), nativeGuard),
        eventStreamRoute(service, nativeToken),
        postRoute(`${PET_NATIVE_API_PREFIX}/interact`, (body) => {
          const kind = body.kind as PetInteraction | undefined
          if (kind !== 'pet' && kind !== 'feed') return Promise.reject(new Error('invalid-kind'))
          return service.interact(kind)
        }, nativeGuard),
      ]

  return [...apiRoutes, ...nativeRoutes, assetRoute]
}

// Re-exported for the package surface (the registry owns the definition now).
export { petPackageRoot } from './registry.ts'
