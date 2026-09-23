/**
 * Preset-center host HTTP routes — the loopback-only library gateway the
 * Workshop's Presets panel calls. Endpoints (all under /api/preset-center):
 *  - GET  /api/preset-center/state             library state + declarations
 *  - GET  /api/preset-center/composition?id=   one preset's composition text
 *  - POST /api/preset-center/install           { id, confirm? } declare it live
 *  - POST /api/preset-center/disable           { id } drop the declaration
 *  - POST /api/preset-center/uninstall         { id } undeclare and delete it
 *
 * Install is the consent boundary: the harness no longer discovers presets on
 * disk, so a declaration is what makes the composition load inside the host
 * process. The panel therefore shows the composition profile and requires an
 * explicit confirmation before anything executable is declared.
 *
 * The route layer is the only place that reads the roster, so it owns the two
 * policies the library cannot express: a preset whose id another declaration
 * already supplies is refused (the registry rejects a duplicate, which would
 * otherwise look like a successful install), and the preset the registry's
 * default names is never disabled or uninstalled (a default naming a missing
 * preset fails every new session).
 * @module @linxin666/dsh-client-ui-preset-center/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import { dshHome } from './dsh-home.ts'
import { guardedHandler } from './host/run-guarded.ts'
import { DeclarationError, PresetDeclarations, type PresetRegistry } from './host/declarations.ts'
import { isLoopbackRequest } from './loopback.ts'
import { readJsonBody, writeJson } from './http.ts'
import { COMPOSITION_FILE, isPresetId } from './core/paths.ts'
import { CompositionError } from './core/yaml.ts'
import { readPresetDefinition } from './core/definition.ts'
import { profilePresetDir, needsConfirmation, type CompositionProfile } from './core/profile.ts'
import {
  listPresetStates,
  readPresetState,
  uninstallPreset,
  PresetOperationError,
  type PresetStateRow,
} from './core/library.ts'

export const PRESET_CENTER_API_PREFIX = '/api/preset-center'

/** Composition viewer size cap (bytes). */
export const COMPOSITION_MAX_BYTES = 256 * 1024

/** Dependencies of the route family (all injectable for tests). */
export interface PresetCenterRouteDeps {
  /** Plugin context; used only to resolve the registry service. */
  ctx?: Context
  /** DSH home root (defaults to the live $DSH_HOME resolution). */
  dshHome?: string
  /** Registry accessor (test seam); defaults to `ctx.get('agentPresets')`. */
  registry?: () => PresetRegistry | undefined
  /** Live declarations (test seam); defaults to a fresh set over `registry`. */
  declarations?: PresetDeclarations
}

interface RouteError {
  status: number
  error: string
  message?: string
}

const ERRORS: Record<string, RouteError> = {
  'invalid-id': { status: 400, error: 'invalid-id', message: 'invalid preset id' },
  'invalid-body': { status: 400, error: 'invalid-body' },
  'loopback-only': { status: 403, error: 'loopback-only' },
  'method-not-allowed': { status: 405, error: 'method-not-allowed' },
  'not-installed': { status: 404, error: 'not-installed' },
  'not-enabled': { status: 404, error: 'not-enabled' },
  'not-managed': { status: 409, error: 'not-managed' },
  'shadowed': { status: 409, error: 'shadowed' },
  'confirmation-required': { status: 409, error: 'confirmation-required' },
  'broken': { status: 409, error: 'broken' },
  'invalid-composition': { status: 409, error: 'invalid-composition' },
  'default-preset': { status: 409, error: 'default-preset' },
  'roster-unavailable': { status: 503, error: 'roster-unavailable' },
  'write': { status: 500, error: 'write' },
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  writeJson(res, status, payload, { 'cache-control': 'no-store' })
}

function sendError(res: ServerResponse, err: RouteError, message?: string): void {
  send(res, err.status, { ok: false, error: err.error, ...(message === undefined && err.message === undefined ? {} : { message: message ?? err.message }) })
}

/** One state row enriched with the composition profile. */
function rowPayload(home: string, row: PresetStateRow): PresetStateRow & { profile: CompositionProfile } {
  return { ...row, profile: profilePresetDir(row.dir) }
}

/** Build the preset-center routes. */
export function makePresetCenterRoutes(deps: PresetCenterRouteDeps = {}): WebRoute[] {
  const home = deps.dshHome ?? dshHome()
  const registryOf = deps.registry ?? (() => deps.ctx?.get('agentPresets') as AgentPresetRegistry | undefined)
  const declarations = deps.declarations ?? new PresetDeclarations(registryOf)
  const declared = (): ReadonlySet<string> => declarations.declared()
  const stateOf = (id: string): PresetStateRow => readPresetState(home, id, declared())

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      sendError(res, ERRORS['loopback-only'])
      return false
    }
    if (req.method !== method) {
      sendError(res, ERRORS['method-not-allowed'])
      return false
    }
    return true
  }

  const readId = async (req: IncomingMessage, res: ServerResponse): Promise<{ id: string; confirm: boolean } | null> => {
    let body: { id?: unknown; confirm?: unknown }
    try {
      body = ((await readJsonBody(req, { maxBytes: 16 * 1024 })) ?? {}) as { id?: unknown; confirm?: unknown }
    } catch {
      sendError(res, ERRORS['invalid-body'])
      return null
    }
    if (!isPresetId(body.id)) {
      sendError(res, ERRORS['invalid-id'])
      return null
    }
    return { id: body.id, confirm: body.confirm === true }
  }

  const handleState = guardedHandler('preset-center/state', async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req, res, 'GET')) return
    const registry = registryOf()
    const ours = declared()
    let occupied: string[] | null = null
    if (registry !== undefined) {
      try {
        occupied = (await registry.list()).map((row) => row.id).filter((id) => !ours.has(id)).sort()
      } catch {
        occupied = null
      }
    }
    send(res, 200, {
      ok: true,
      defaultId: defaultIdOf(registry),
      occupied: occupied ?? [],
      rosterAvailable: occupied !== null,
      presets: listPresetStates(home, ours).map((row) => rowPayload(home, row)),
    })
  })

  const handleComposition = guardedHandler('preset-center/composition', async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req, res, 'GET')) return
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const id = url.searchParams.get('id')
    if (!isPresetId(id)) {
      sendError(res, ERRORS['invalid-id'])
      return
    }
    const row = stateOf(id)
    if (!row.installed) {
      sendError(res, ERRORS['not-installed'])
      return
    }
    const file = join(row.dir, COMPOSITION_FILE)
    try {
      if (statSync(file).size > COMPOSITION_MAX_BYTES) {
        send(res, 200, { ok: true, id, text: '', truncated: true, profile: profilePresetDir(row.dir) })
        return
      }
      const text = readFileSync(file, 'utf8')
      send(res, 200, { ok: true, id, text, truncated: false, profile: profilePresetDir(row.dir) })
    } catch {
      sendError(res, ERRORS['not-installed'], 'composition file is missing')
    }
  })

  const handleInstall = guardedHandler('preset-center/install', async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req, res, 'POST')) return
    const parsed = await readId(req, res)
    if (parsed === null) return
    const { id, confirm } = parsed
    const state = stateOf(id)
    if (!state.installed) {
      sendError(res, ERRORS['not-installed'])
      return
    }
    if (!state.managed) {
      sendError(res, ERRORS['not-managed'])
      return
    }
    if (state.enabled) {
      send(res, 200, { ok: true, state: rowPayload(home, state) })
      return
    }
    const registry = registryOf()
    if (registry === undefined) {
      sendError(res, ERRORS['roster-unavailable'], 'the agent-preset registry is unavailable')
      return
    }
    try {
      const occupied = (await registry.list()).map((row) => row.id)
      if (occupied.includes(id)) {
        sendError(res, ERRORS['shadowed'], `preset id is already declared by another plugin: ${id}`)
        return
      }
    } catch {
      sendError(res, ERRORS['roster-unavailable'], 'the agent-preset registry is unavailable')
      return
    }
    const profile = profilePresetDir(state.dir)
    if (needsConfirmation(profile) && !confirm) {
      send(res, 409, { ok: false, error: 'confirmation-required', message: 'preset carries executable content', profile })
      return
    }
    let definition
    try {
      definition = readPresetDefinition(id, state.dir)
    } catch (err) {
      if (err instanceof CompositionError) {
        sendError(res, ERRORS['invalid-composition'], err.message)
        return
      }
      throw err
    }
    try {
      await declarations.declare(definition)
    } catch (err) {
      if (err instanceof DeclarationError) {
        sendError(res, err.code === 'unavailable' ? ERRORS['roster-unavailable'] : ERRORS[err.code] ?? ERRORS.write, err.message)
        return
      }
      throw err
    }
    const broken = await brokenReason(registry, id)
    if (broken !== undefined) {
      try {
        await declarations.undeclare(id)
      } catch {
        /* the preset stays declared and the registry keeps reporting it broken */
      }
      send(res, 409, { ok: false, error: 'broken', message: broken })
      return
    }
    send(res, 200, { ok: true, state: rowPayload(home, stateOf(id)) })
  })

  const handleDisable = guardedHandler('preset-center/disable', async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req, res, 'POST')) return
    const parsed = await readId(req, res)
    if (parsed === null) return
    const { id } = parsed
    const refusal = refusalForProtected(registryOf(), id)
    if (refusal !== null) {
      sendError(res, ERRORS['default-preset'], refusal)
      return
    }
    if (!(await declarations.undeclare(id))) {
      sendError(res, ERRORS['not-enabled'])
      return
    }
    send(res, 200, { ok: true, state: rowPayload(home, stateOf(id)) })
  })

  const handleUninstall = guardedHandler('preset-center/uninstall', async (req: IncomingMessage, res: ServerResponse) => {
    if (!guard(req, res, 'POST')) return
    const parsed = await readId(req, res)
    if (parsed === null) return
    const { id } = parsed
    const refusal = refusalForProtected(registryOf(), id)
    if (refusal !== null) {
      sendError(res, ERRORS['default-preset'], refusal)
      return
    }
    try {
      await declarations.undeclare(id)
    } catch (err) {
      if (err instanceof DeclarationError) {
        sendError(res, ERRORS[err.code] ?? ERRORS.write, err.message)
        return
      }
      throw err
    }
    try {
      uninstallPreset(home, id)
    } catch (err) {
      if (err instanceof PresetOperationError) {
        sendError(res, ERRORS[err.code] ?? ERRORS.write, err.message)
        return
      }
      throw err
    }
    send(res, 200, { ok: true, id })
  })

  // guardedHandler consumes rejections and returns undefined; the wrapper
  // narrows that to the void signature WebRoute declares.
  const route = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => unknown): WebRoute => ({
    kind: 'exact',
    path,
    handler: (req, res) => { void handler(req, res) },
  })

  return [
    route(`${PRESET_CENTER_API_PREFIX}/state`, handleState),
    route(`${PRESET_CENTER_API_PREFIX}/composition`, handleComposition),
    route(`${PRESET_CENTER_API_PREFIX}/install`, handleInstall),
    route(`${PRESET_CENTER_API_PREFIX}/disable`, handleDisable),
    route(`${PRESET_CENTER_API_PREFIX}/uninstall`, handleUninstall),
  ]
}

/** Why a disable/uninstall of `id` is refused, or null when it is allowed. */
function refusalForProtected(registry: PresetRegistry | undefined, id: string): string | null {
  const current = defaultIdOf(registry)
  if (current !== null && current === id) {
    return `preset is the current default; change the default in Settings - Agent presets first: ${id}`
  }
  return null
}

/** The registry's current default preset id, or null when it is unavailable. */
function defaultIdOf(registry: PresetRegistry | undefined): string | null {
  if (registry === undefined) return null
  try {
    return registry.defaultId
  } catch {
    return null
  }
}

/** The registry's broken reason for `id`, or undefined when healthy or unknown. */
async function brokenReason(registry: PresetRegistry | undefined, id: string): Promise<string | undefined> {
  if (registry === undefined) return undefined
  try {
    const rows = await registry.list()
    return rows.find((entry) => entry.id === id)?.broken
  } catch {
    return undefined
  }
}
