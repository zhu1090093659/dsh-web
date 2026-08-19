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
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import {
  PET_DESKTOP_SCALE_MAX,
  PET_DESKTOP_SCALE_MIN,
  type PetDesktopSettings,
  type PetService,
  type PetSettingsSection,
} from './service.ts'
import type { PetInteraction } from './affinity.ts'
import {
  authorizePetNativeRequest,
  isPetNativeToken,
} from './adapters/web/native-auth.ts'
import { petEntryView, type PetEntry, type PetRegistry } from './registry.ts'
import { isLoopbackRequest } from './loopback.ts'
import type { StandaloneRuntimeManager } from './adapters/standalone/runtime-manager.ts'

/** Browser-facing base path of the pet API. */
export const PET_API_PREFIX = '/api/pet'

/** Standalone settings bridge; always mount it even while the pet is disabled. */
export const PET_SETTINGS_API_PREFIX = `${PET_API_PREFIX}/settings`

/** Browser-facing, loopback-only Electron runtime installer. */
export const PET_RUNTIME_API_PREFIX = `${PET_API_PREFIX}/runtime`

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

const PET_SETTINGS_FIELDS = new Set<keyof PetSettingsSection>([
  'petId',
  'visible',
  'size',
  'right',
  'bottom',
  'enabled',
  'desktopEnabled',
  'desktopVisible',
  'desktopAlwaysOnTop',
  'desktopLocked',
  'desktopScale',
])

interface PetSettingsMutationRequest {
  ops: SettingsPathOp[]
  expectedRevision?: number
}

/** Accept only single-field operations inside this plugin's settings namespace. */
function parseSettingsMutation(body: Record<string, unknown>): PetSettingsMutationRequest | undefined {
  if (Object.keys(body).some(key => key !== 'ops' && key !== 'expectedRevision')) return undefined
  const expectedRevision = body.expectedRevision
  if (expectedRevision !== undefined
    && (typeof expectedRevision !== 'number'
      || !Number.isInteger(expectedRevision)
      || expectedRevision < 0)) return undefined
  if (!Array.isArray(body.ops) || body.ops.length === 0) return undefined
  const ops: SettingsPathOp[] = []
  for (const candidate of body.ops) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
    const op = candidate as Record<string, unknown>
    if ((op.op !== 'set' && op.op !== 'unset')
      || !Array.isArray(op.path)
      || op.path.length !== 1
      || typeof op.path[0] !== 'string'
      || !PET_SETTINGS_FIELDS.has(op.path[0] as keyof PetSettingsSection)) return undefined
    if (op.op === 'set') {
      if (!Object.hasOwn(op, 'value')
        || Object.keys(op).some(key => key !== 'op' && key !== 'path' && key !== 'value')) return undefined
      ops.push({ op: 'set', path: [op.path[0]], value: op.value })
    } else {
      if (Object.hasOwn(op, 'value')
        || Object.keys(op).some(key => key !== 'op' && key !== 'path')) return undefined
      ops.push({ op: 'unset', path: [op.path[0]] })
    }
  }
  return {
    ops,
    ...(typeof expectedRevision === 'number' ? { expectedRevision } : {}),
  }
}

/** Settings routes remain reachable while the plugin master switch is off. */
export function makePetSettingsRoutes(service: PetService): WebRoute[] {
  return [
    getRoute(PET_SETTINGS_API_PREFIX, () => service.settingsView()),
    postRoute(`${PET_SETTINGS_API_PREFIX}/mutate`, (body) => {
      const request = parseSettingsMutation(body)
      if (request === undefined) return Promise.reject(new Error('invalid-pet-settings-mutation'))
      return service.mutateSettings(request.ops, request.expectedRevision)
    }),
  ]
}

/** Runtime installation routes remain reachable before a desktop presentation exists. */
export function makePetRuntimeRoutes(runtime: StandaloneRuntimeManager): WebRoute[] {
  return [
    getRoute(PET_RUNTIME_API_PREFIX, async () => runtime.state()),
    postRoute(`${PET_RUNTIME_API_PREFIX}/install`, async body => runtime.startInstall({
      source: body.source,
      ...(body.customMirror === undefined ? {} : { customMirror: body.customMirror }),
    })),
    postRoute(`${PET_RUNTIME_API_PREFIX}/cancel`, async () => runtime.cancelInstall()),
  ]
}

const DESKTOP_SETTINGS_KEYS = new Set<keyof PetDesktopSettings>([
  'enabled',
  'visible',
  'alwaysOnTop',
  'locked',
  'scale',
])
const NATIVE_SOURCE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

export interface PetNativeReadyAck {
  sourceId: string
  desktopPid: number
}

function parseNativeReadyAck(body: Record<string, unknown>): PetNativeReadyAck | undefined {
  if (Object.keys(body).some(key => key !== 'sourceId' && key !== 'desktopPid')) return undefined
  const { sourceId, desktopPid } = body
  if (typeof sourceId !== 'string' || !NATIVE_SOURCE_ID_PATTERN.test(sourceId)) return undefined
  if (typeof desktopPid !== 'number'
    || !Number.isSafeInteger(desktopPid)
    || desktopPid <= 0
    || desktopPid > 0x7fff_ffff) return undefined
  return { sourceId, desktopPid }
}

/** Strictly parse the native surface patch before it reaches Host settings. */
function parseDesktopSettingsPatch(body: Record<string, unknown>): Partial<PetDesktopSettings> | undefined {
  const keys = Object.keys(body)
  if (keys.length === 0 || keys.some(key => !DESKTOP_SETTINGS_KEYS.has(key as keyof PetDesktopSettings))) {
    return undefined
  }
  const patch: Partial<PetDesktopSettings> = {}
  for (const key of ['enabled', 'visible', 'alwaysOnTop', 'locked'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') return undefined
    patch[key] = value
  }
  if (body.scale !== undefined) {
    if (typeof body.scale !== 'number'
      || !Number.isFinite(body.scale)
      || body.scale < PET_DESKTOP_SCALE_MIN
      || body.scale > PET_DESKTOP_SCALE_MAX) return undefined
    patch.scale = body.scale
  }
  return patch
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
export function makePetRoutes(deps: {
  service: PetService
  nativeToken?: string
  onNativeReady?: (ack: PetNativeReadyAck) => boolean
}): WebRoute[] {
  const { service, nativeToken, onNativeReady } = deps
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
        postRoute(`${PET_NATIVE_API_PREFIX}/surface-settings`, (body) => {
          const patch = parseDesktopSettingsPatch(body)
          if (patch === undefined) return Promise.reject(new Error('invalid-desktop-settings'))
          return service.setDesktopSettings(patch)
        }, nativeGuard),
        ...(onNativeReady === undefined
          ? []
          : [postRoute(`${PET_NATIVE_API_PREFIX}/ready`, async (body) => {
              const ack = parseNativeReadyAck(body)
              if (ack === undefined) throw new Error('invalid-native-ready')
              if (!onNativeReady(ack)) throw new Error('unknown-native-ready-source')
              return { ok: true }
            }, nativeGuard)]),
      ]

  return [...apiRoutes, ...nativeRoutes, assetRoute]
}

// Re-exported for the package surface (the registry owns the definition now).
export { petPackageRoot } from './registry.ts'
