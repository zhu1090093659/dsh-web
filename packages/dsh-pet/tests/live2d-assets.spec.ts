/**
 * Live2D asset closure serving and the plugin runtime route (pet-center M3,
 * issue #623). The asset route serves exactly the scan-time closure
 * (model3.json + referenced files); the runtime route serves the
 * user-supplied Cubism Core and the plugin-shipped vendor bundle by exact
 * name. Same real-server harness as asset-security.spec.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { PetService } from '../src/service.ts'
import { makePetRoutes, type PetAssetCaps } from '../src/routes.ts'
import { loadPetRegistry } from '../src/registry.ts'

const MOC_BYTES = Buffer.from([0x6d, 0x6f, 0x63, 0x33])
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const TEST_CAPS: PetAssetCaps = { manifest: 64 * 1024, image: 20 * 1024 * 1024, model: 32 * 1024 * 1024 }

let dir: string
let runtimeDir: string
let vendorDir: string
let outside: string
let server: Server
let port: number

function serve(routes: ReturnType<typeof makePetRoutes>): Promise<Server> {
  const s = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    for (const route of routes) {
      if (route.kind === 'exact' && pathname === route.path) return void route.handler(req, res)
    }
    for (const route of routes) {
      if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) {
        return void route.handler(req, res)
      }
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-l2d-'))
  runtimeDir = mkdtempSync(join(tmpdir(), 'dsh-pet-runtime-'))
  vendorDir = mkdtempSync(join(tmpdir(), 'dsh-pet-vendor-'))
  outside = mkdtempSync(join(tmpdir(), 'dsh-pet-outside-'))

  // A live2d pet whose model3.json declares a moc, a texture and one motion.
  const pet = join(dir, 'assets', 'hiyori')
  mkdirSync(join(pet, 'motions'), { recursive: true })
  mkdirSync(join(pet, 'textures'), { recursive: true })
  writeFileSync(join(pet, 'pet.json'), JSON.stringify({
    petManifestVersion: 2, id: 'hiyori', displayName: 'Hiyori', license: 'Live2D-Sample',
    renderer: 'live2d', live2d: { model: 'hiyori.model3.json', motions: { idle: 'Idle' } },
  }), 'utf8')
  writeFileSync(join(pet, 'hiyori.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'hiyori.moc3',
      Textures: ['textures/tex.png'],
      Motions: { Idle: [{ File: 'motions/idle_00.motion3.json' }] },
    },
  }), 'utf8')
  writeFileSync(join(pet, 'hiyori.moc3'), MOC_BYTES)
  writeFileSync(join(pet, 'textures', 'tex.png'), PNG_BYTES)
  writeFileSync(join(pet, 'motions', 'idle_00.motion3.json'), '{}', 'utf8')
  // A file inside the pet directory that the model never references.
  writeFileSync(join(pet, 'notes.txt'), 'author notes', 'utf8')

  // Runtime roots: the vendor dir holds the plugin bundle; the runtime dir
  // starts WITHOUT the user-supplied core (the not-installed state).
  writeFileSync(join(vendorDir, 'live2d-vendor.js'), 'window.__dshPetLive2d={};', 'utf8')
  writeFileSync(join(outside, 'escaped-core.js'), '/* escaped */', 'utf8')

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '', dshPetsDir: '' })
  const service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
  server = await serve(makePetRoutes({ service, ctx, assetCaps: TEST_CAPS, runtimeDir, vendorDir }))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  for (const d of [dir, runtimeDir, vendorDir, outside]) rmSync(d, { recursive: true, force: true })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('live2d closure serving', () => {
  it('serves the model3.json, its moc, textures and motions from the closure', async () => {
    const model = await fetch(url('/pet/hiyori/hiyori.model3.json'))
    expect(model.status).toBe(200)
    expect(model.headers.get('content-type')).toContain('application/json')
    const moc = await fetch(url('/pet/hiyori/hiyori.moc3'))
    expect(moc.status).toBe(200)
    expect(moc.headers.get('content-type')).toBe('application/octet-stream')
    expect((await fetch(url('/pet/hiyori/textures/tex.png'))).status).toBe(200)
    expect((await fetch(url('/pet/hiyori/motions/idle_00.motion3.json'))).status).toBe(200)
  })
  it('keeps non-closure files and traversal at 404', async () => {
    expect((await fetch(url('/pet/hiyori/notes.txt'))).status).toBe(404)
    // The WHATWG URL parser resolves dot segments BEFORE the allow-list sees
    // the path: a '..' request collapses onto its normalized target, which
    // the exact-match closure still gates. Collapsing onto a closure file
    // serves it (that IS the file); collapsing anywhere else stays 404.
    expect((await fetch(url('/pet/hiyori/%2e%2e/hiyori/notes.txt'))).status).toBe(404)
    expect((await fetch(url('/pet/hiyori/%2e%2e/%2e%2e/pet.json'))).status).toBe(404)
    expect((await fetch(url('/pet/hiyori/%2e%2e/hiyori/hiyori.moc3'))).status).toBe(200)
  })
  it('answers 413 once a closure file exceeds the model cap', async () => {
    const ctx = new Context()
    const registry = loadPetRegistry({ packageRoot: dir, petsDir: '', dshPetsDir: '' })
    const service = new PetService(ctx, { persistDir: join(dir, 'home-tight'), registry })
    const tight = await serve(makePetRoutes({
      service,
      ctx,
      assetCaps: { manifest: 64 * 1024, image: 20 * 1024 * 1024, model: 2 },
      runtimeDir,
      vendorDir,
    }))
    try {
      const moc = await fetch('http://127.0.0.1:' + (tight.address() as AddressInfo).port + '/pet/hiyori/hiyori.moc3')
      expect(moc.status).toBe(413)
    } finally {
      await new Promise<void>((resolve) => tight.close(() => resolve()))
    }
  })
})

describe('runtime route', () => {
  it('serves the plugin vendor bundle from the vendor directory', async () => {
    const response = await fetch(url('/api/pet/runtime/live2d-vendor.js'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/javascript')
    expect(await response.text()).toContain('__dshPetLive2d')
  })
  it('answers a JSON marker when the user-supplied core is not installed', async () => {
    const response = await fetch(url('/api/pet/runtime/live2dcubismcore.min.js'))
    expect(response.status).toBe(404)
    const body = await response.json() as { ok: boolean; error: string; file: string }
    expect(body.ok).toBe(false)
    expect(body.error).toBe('runtime-file-missing')
    expect(body.file).toBe('live2dcubismcore.min.js')
  })
  it('serves the core once the user installs it', async () => {
    writeFileSync(join(runtimeDir, 'live2dcubismcore.min.js'), 'window.Live2DCubismCore={};', 'utf8')
    try {
      const response = await fetch(url('/api/pet/runtime/live2dcubismcore.min.js'))
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('Live2DCubismCore')
    } finally {
      rmSync(join(runtimeDir, 'live2dcubismcore.min.js'), { force: true })
    }
  })
  it('rejects unknown names, nested paths and symlink escapes', async () => {
    expect((await fetch(url('/api/pet/runtime/evil.js'))).status).toBe(404)
    expect((await fetch(url('/api/pet/runtime/sub/dir.js'))).status).toBe(404)
    expect((await fetch(url('/api/pet/runtime/%2e%2e/live2d-vendor.js'))).status).toBe(404)
    symlinkSync(join(outside, 'escaped-core.js'), join(runtimeDir, 'live2dcubismcore.min.js'))
    try {
      expect((await fetch(url('/api/pet/runtime/live2dcubismcore.min.js'))).status).toBe(403)
    } finally {
      rmSync(join(runtimeDir, 'live2dcubismcore.min.js'), { force: true })
    }
  })
})
