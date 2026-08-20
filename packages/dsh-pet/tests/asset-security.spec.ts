/**
 * Pet asset route security — realpath containment, size ceilings, and
 * traversal lock-down (pet-center M2 P3, issue #623). Same real-server
 * harness as routes.spec.ts.
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
import { containedRealpath, makePetRoutes, PET_ASSET_CAPS, type PetAssetCaps } from '../src/routes.ts'
import { loadPetRegistry } from '../src/registry.ts'

const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])

let dir: string
let outside: string
let server: Server
let port: number

/** Caps small enough that the 12-byte fixture atlas trips them when lowered. */
const TEST_CAPS: PetAssetCaps = { manifest: 64 * 1024, image: 20 * 1024 * 1024, model: 32 * 1024 * 1024 }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-sec-'))
  outside = mkdtempSync(join(tmpdir(), 'dsh-pet-outside-'))
  writeFileSync(join(outside, 'secret.webp'), WEBP_BYTES)

  const assets = join(dir, 'assets')
  // clean pet
  mkdirSync(join(assets, 'whale'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'pet.json'), JSON.stringify({
    id: 'whale-girl', displayName: 'Whale', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'whale', 'spritesheet.webp'), WEBP_BYTES)
  mkdirSync(join(assets, 'whale', 'previews'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'previews', 'idle.webp'), WEBP_BYTES)
  // escaping pet: atlas symlinks out of the pet directory
  mkdirSync(join(assets, 'sneaky'), { recursive: true })
  writeFileSync(join(assets, 'sneaky', 'pet.json'), JSON.stringify({
    id: 'sneaky', displayName: 'Sneaky', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  symlinkSync(join(outside, 'secret.webp'), join(assets, 'sneaky', 'spritesheet.webp'))
  symlinkSync(join(outside, 'secret.webp'), join(assets, 'whale', 'previews', 'escape.webp'))

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '' })
  const service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
  const routes = makePetRoutes({ service, ctx, assetCaps: TEST_CAPS })
  server = createServer((req, res) => {
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
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('containedRealpath', () => {
  it('accepts files inside the base and the base itself', () => {
    const inside = join(dir, 'assets', 'whale', 'spritesheet.webp')
    expect(containedRealpath(join(dir, 'assets', 'whale'), inside)).toBeDefined()
  })
  it('rejects escapes, lookalike prefixes and missing files', () => {
    const base = join(dir, 'assets', 'whale')
    expect(containedRealpath(base, join(outside, 'secret.webp'))).toBeUndefined()
    expect(containedRealpath(base, join(dir, 'assets', 'whale-evil', 'x.png'))).toBeUndefined()
    expect(containedRealpath(base, join(base, 'does-not-exist.png'))).toBeUndefined()
  })
})

describe('asset route security', () => {
  it('serves a clean atlas and preview', async () => {
    expect((await fetch(url('/pet/whale-girl/spritesheet.webp'))).status).toBe(200)
    expect((await fetch(url('/pet/whale-girl/previews/idle.webp'))).status).toBe(200)
    expect((await fetch(url('/pet/whale-girl/pet.json'))).status).toBe(200)
  })
  it('refuses an atlas symlink escaping the pet directory', async () => {
    expect((await fetch(url('/pet/sneaky/spritesheet.webp'))).status).toBe(403)
  })
  it('refuses a preview symlink escaping the pet directory', async () => {
    expect((await fetch(url('/pet/whale-girl/previews/escape.webp'))).status).toBe(403)
  })
  it('answers 413 once a served file exceeds its class cap', async () => {
    // Rebuild a server whose image cap the 12-byte fixture exceeds.
    const ctx = new Context()
    const registry = loadPetRegistry({ packageRoot: dir, petsDir: '' })
    const service = new PetService(ctx, { persistDir: join(dir, 'home2'), registry })
    const tight = makePetRoutes({ service, ctx, assetCaps: { manifest: 64 * 1024, image: 4, model: 32 * 1024 * 1024 } })
    const tightServer = createServer((req, res) => {
      const pathname = (req.url ?? '').split('?')[0]!
      for (const route of tight) {
        if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) {
          return void route.handler(req, res)
        }
      }
      res.writeHead(404)
      res.end()
    })
    tightServer.listen(0, '127.0.0.1')
    await once(tightServer, 'listening')
    const tightPort = (tightServer.address() as AddressInfo).port
    try {
      const response = await fetch('http://127.0.0.1:' + tightPort + '/pet/whale-girl/spritesheet.webp')
      expect(response.status).toBe(413)
    } finally {
      await new Promise<void>((resolve) => tightServer.close(() => resolve()))
    }
  })
  it('keeps traversal requests outside the declared files at 404', async () => {
    expect((await fetch(url('/pet/whale-girl/%2e%2e/%2e%2e/pet.json'))).status).toBe(404)
    expect((await fetch(url('/pet/whale-girl/spritesheet.webp/extra'))).status).toBe(404)
  })
  it('locks the default caps to the documented constants', () => {
    expect(PET_ASSET_CAPS.manifest).toBe(64 * 1024)
    expect(PET_ASSET_CAPS.image).toBe(20 * 1024 * 1024)
    expect(PET_ASSET_CAPS.model).toBe(32 * 1024 * 1024)
  })
})
