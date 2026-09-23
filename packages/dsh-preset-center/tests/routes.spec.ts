/**
 * Preset-center gateway contract over a real loopback server: the library
 * state read, the declaration confirmation gate, the reserved-id and
 * default-preset refusals, and the broken-declaration rollback.
 */

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { makePresetCenterRoutes } from '../src/routes.ts'
import { LIBRARY_DIR, PROVENANCE_FILENAME } from '../src/core/paths.ts'
import { PresetDeclarations, type PresetRegistry } from '../src/host/declarations.ts'

let home: string
let server: Server
let port: number
let registry: FakeRegistry

interface FakeRegistry extends Omit<PresetRegistry, 'defaultId'> {
  /** The test edits this between requests to model the registry policy. */
  defaultId: string
  presets: Map<string, { id: string; name?: string; broken?: string }>
  brokenIds: Set<string>
  unregisters: number
  listFails: boolean
}

/** A map-backed registry stand-in; `brokenIds` makes a declared preset report an activation failure. */
function fakeRegistry(): FakeRegistry {
  const presets = new Map<string, { id: string; name?: string; broken?: string }>()
  const state = {
    presets,
    brokenIds: new Set<string>(),
    unregisters: 0,
    listFails: false,
    defaultId: 'standard',
    async register(definition: PresetDefinition): Promise<() => Promise<void>> {
      if (presets.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
      presets.set(definition.id, {
        id: definition.id,
        ...(definition.name === undefined ? {} : { name: definition.name }),
        ...(state.brokenIds.has(definition.id) ? { broken: 'row names a missing module' } : {}),
      })
      return async () => {
        state.unregisters += 1
        presets.delete(definition.id)
      }
    },
    async list() {
      if (state.listFails) throw new Error('registry unavailable')
      return [...presets.values()]
    },
  }
  return state
}

/** Write one workshop-installed preset into the library. */
function writeLibraryPreset(id: string, composition = '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n'): void {
  const dir = join(home, LIBRARY_DIR, id)
  mkdirSync(dir, { recursive: true })
  const files: Record<string, string> = { 'agent.cordis.yml': composition, 'preset.yml': 'name: ' + id + '\n' }
  const hashes: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) {
    writeFileSync(join(dir, rel), text)
    hashes[rel] = createHash('sha256').update(text).digest('hex')
  }
  writeFileSync(join(dir, PROVENANCE_FILENAME), JSON.stringify({
    version: 1, source: 'https://dsh-market.com', kind: 'preset', id,
    installedAt: '2026-09-09T00:00:00.000Z', assetVersion: '1.0.0', files: hashes,
  }, null, 2) + '\n')
}

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch('http://127.0.0.1:' + port + path, init)
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  return { status: res.status, body }
}

function post(path: string, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-preset-center-routes-'))
  registry = fakeRegistry()
  const declarations = new PresetDeclarations(() => registry)
  const routes = makePresetCenterRoutes({ dshHome: home, registry: () => registry, declarations })
  server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]!
    for (const route of routes) {
      if (route.kind === 'exact' && pathname === route.path) {
        void route.handler(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterEach(async () => {
  server.close()
  await once(server, 'close')
  rmSync(home, { recursive: true, force: true })
})

describe('preset-center routes', () => {
  it('operator reads the library state, the registry default and occupied ids', async () => {
    // Given one installed preset and one id another plugin declares, When the
    // operator reads the state, Then both are reported with their source.
    writeLibraryPreset('demo')
    registry.presets.set('ptc', { id: 'ptc' })

    const { status, body } = await call('/api/preset-center/state')

    expect(status).toBe(200)
    expect(body.defaultId).toBe('standard')
    expect(body.occupied).toEqual(['ptc'])
    expect(body.rosterAvailable).toBe(true)
    const presets = body.presets as { id: string; installed: boolean; enabled: boolean; profile: { codeExecution: string } }[]
    expect(presets).toHaveLength(1)
    expect(presets[0]).toMatchObject({ id: 'demo', installed: true, enabled: false })
    expect(presets[0]!.profile.codeExecution).toBe('none')
  })

  it('operator must confirm before declaring executable content', async () => {
    // Given a downloaded preset that ships a local module, When the operator
    // declares it without a confirmation, Then nothing is registered until
    // the explicit confirmation arrives.
    writeLibraryPreset('demo', '- id: hook\n  name: ./hook.mjs\n')
    writeFileSync(join(home, LIBRARY_DIR, 'demo', 'hook.mjs'), 'export const x = 1\n')

    const refused = await post('/api/preset-center/install', { id: 'demo' })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toBe('confirmation-required')
    expect(registry.presets.size).toBe(0)

    const allowed = await post('/api/preset-center/install', { id: 'demo', confirm: true })
    expect(allowed.status).toBe(200)
    expect((allowed.body.state as { enabled: boolean }).enabled).toBe(true)
    expect(registry.presets.get('demo')).toEqual({ id: 'demo', name: 'demo' })
  })

  it('operator declares a clean preset and uninstalls it again', async () => {
    // Given a downloaded preset without executable content, When the operator
    // declares it and then uninstalls, Then the registry and the library are
    // both emptied.
    writeLibraryPreset('demo')

    const declared = await post('/api/preset-center/install', { id: 'demo' })
    expect(declared.status).toBe(200)
    expect((declared.body.state as { enabled: boolean }).enabled).toBe(true)

    const removed = await post('/api/preset-center/uninstall', { id: 'demo' })
    expect(removed.status).toBe(200)
    expect(registry.presets.size).toBe(0)
    expect(existsSync(join(home, LIBRARY_DIR, 'demo'))).toBe(false)
  })

  it('operator disabling a declared preset keeps the installed files', async () => {
    // Given a declared preset, When the operator disables it, Then the
    // declaration is gone while the library directory stays.
    writeLibraryPreset('demo')
    await post('/api/preset-center/install', { id: 'demo' })

    const disabled = await post('/api/preset-center/disable', { id: 'demo' })

    expect(disabled.status).toBe(200)
    expect((disabled.body.state as { installed: boolean; enabled: boolean })).toMatchObject({ installed: true, enabled: false })
    expect(registry.presets.size).toBe(0)
    expect(existsSync(join(home, LIBRARY_DIR, 'demo', 'agent.cordis.yml'))).toBe(true)
  })

  it('operator is refused an id another declaration already supplies', async () => {
    // Given an id the registry already holds from another plugin, When the
    // operator declares it, Then the request is refused and nothing changes.
    writeLibraryPreset('ptc')
    registry.presets.set('ptc', { id: 'ptc' })

    const { status, body } = await post('/api/preset-center/install', { id: 'ptc' })

    expect(status).toBe(409)
    expect(body.error).toBe('shadowed')
    expect(existsSync(join(home, LIBRARY_DIR, 'ptc', 'agent.cordis.yml'))).toBe(true)
  })

  it('operator is refused a declaration whose composition cannot be read', async () => {
    // Given a downloaded composition outside the supported subset, When the
    // operator declares it, Then the preset stays inert and the reason is
    // reported.
    writeLibraryPreset('demo', '- name: cordis:group\n  config: [a, b]\n')

    const { status, body } = await post('/api/preset-center/install', { id: 'demo', confirm: true })

    expect(status).toBe(409)
    expect(body.error).toBe('invalid-composition')
    expect(registry.presets.size).toBe(0)
  })

  it('operator cannot disable or uninstall the current default preset', async () => {
    // Given the default names the preset, When the operator disables or
    // uninstalls it, Then both are refused and the declaration survives.
    writeLibraryPreset('demo')
    await post('/api/preset-center/install', { id: 'demo' })
    registry.defaultId = 'demo'

    const disabled = await post('/api/preset-center/disable', { id: 'demo' })
    expect(disabled.status).toBe(409)
    expect(disabled.body.error).toBe('default-preset')

    const removed = await post('/api/preset-center/uninstall', { id: 'demo' })
    expect(removed.status).toBe(409)
    expect(registry.presets.has('demo')).toBe(true)
    expect(existsSync(join(home, LIBRARY_DIR, 'demo'))).toBe(true)
  })

  it('operator gets a rolled-back declaration when the registry reports the preset broken', async () => {
    // Given a preset the registry cannot activate, When the operator declares
    // it, Then the declaration is withdrawn, the reason is reported and the
    // installed files stay for inspection.
    writeLibraryPreset('demo')
    registry.brokenIds.add('demo')

    const { status, body } = await post('/api/preset-center/install', { id: 'demo' })

    expect(status).toBe(409)
    expect(body.error).toBe('broken')
    expect(String(body.message)).toContain('missing module')
    expect(registry.presets.size).toBe(0)
    expect(existsSync(join(home, LIBRARY_DIR, 'demo', 'agent.cordis.yml'))).toBe(true)
  })

  it('operator gets 503 when the registry service is absent or unreachable', async () => {
    // Given no registry service and then a registry whose read fails, When the
    // operator declares a preset, Then both answer 503.
    writeLibraryPreset('demo')
    const routes = makePresetCenterRoutes({ dshHome: home, registry: () => undefined })
    const absent = await respondWith(routes, '/api/preset-center/state')
    expect(absent.body.rosterAvailable).toBe(false)

    registry.listFails = true
    const { status, body } = await post('/api/preset-center/install', { id: 'demo' })
    expect(status).toBe(503)
    expect(body.error).toBe('roster-unavailable')
  })

  it('operator is refused unknown ids and non-POST methods', async () => {
    expect((await post('/api/preset-center/install', { id: 'Bad_Id' })).body.error).toBe('invalid-id')
    expect((await post('/api/preset-center/disable', {})).body.error).toBe('invalid-id')
    expect((await post('/api/preset-center/state', {})).status).toBe(405)
    expect((await call('/api/preset-center/nope')).status).toBe(404)
  })

  it('operator is refused a declaration for a preset that is not installed', async () => {
    const { status, body } = await post('/api/preset-center/install', { id: 'ghost' })
    expect(status).toBe(404)
    expect(body.error).toBe('not-installed')
  })

  it('operator reads the composition text and the profile', async () => {
    writeLibraryPreset('demo')
    const { status, body } = await call('/api/preset-center/composition?id=demo')
    expect(status).toBe(200)
    expect(String(body.text)).toContain('@deepseek-ai/dsh-persona')
    expect((body.profile as { plugins: string[] }).plugins).toEqual(['@deepseek-ai/dsh-persona'])
    expect((await call('/api/preset-center/composition?id=ghost')).status).toBe(404)
  })
})

/** Send one request through a freshly built route list (for per-test seams). */
async function respondWith(routes: ReturnType<typeof makePresetCenterRoutes>, path: string): Promise<{ body: Record<string, unknown> }> {
  const local = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]!
    const route = routes.find((entry) => entry.kind === 'exact' && entry.path === pathname)
    if (route === undefined) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  local.listen(0, '127.0.0.1')
  await once(local, 'listening')
  const localPort = (local.address() as AddressInfo).port
  const res = await fetch('http://127.0.0.1:' + localPort + path)
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  local.close()
  await once(local, 'close')
  return { body }
}
