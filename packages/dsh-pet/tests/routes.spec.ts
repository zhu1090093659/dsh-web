import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { PetService } from '../src/service.ts'
import { makePetRoutes } from '../src/routes.ts'
import { loadPetRegistry } from '../src/registry.ts'

const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
const GIF_BYTES = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

let dir: string
let server: Server
let port: number
let service: PetService
let routes: ReturnType<typeof makePetRoutes>

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-pet-routes-'))
  const assets = join(dir, 'assets')
  mkdirSync(join(assets, 'whale'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'pet.json'), JSON.stringify({
    id: 'whale-girl', displayName: '鲸鱼娘', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'whale', 'spritesheet.webp'), WEBP_BYTES)
  mkdirSync(join(assets, 'whale', 'previews'), { recursive: true })
  writeFileSync(join(assets, 'whale', 'previews', 'idle.gif'), GIF_BYTES)
  mkdirSync(join(assets, 'otter'), { recursive: true })
  writeFileSync(join(assets, 'otter', 'pet.json'), JSON.stringify({
    id: 'otter', displayName: '水獭', spritesheetPath: 'spritesheet.webp',
  }), 'utf8')
  writeFileSync(join(assets, 'otter', 'spritesheet.webp'), WEBP_BYTES)
  // Built-in status decoration (M5, #567).
  mkdirSync(join(assets, 'decorations', 'whale'), { recursive: true })
  writeFileSync(join(assets, 'decorations', 'whale', 'decoration.json'), JSON.stringify({
    decorationManifestVersion: 1,
    id: 'whale',
    displayName: '喷水鲸鱼',
    license: 'MIT',
    entry: 'whale-frames.png',
    cell: { width: 64, height: 48 },
    columns: 4,
    frameMs: 140,
    phases: { idle: 'hide', waiting: { from: 0, to: 1 }, thinking: { from: 0, to: 3 } },
  }), 'utf8')
  writeFileSync(join(assets, 'decorations', 'whale', 'whale-frames.png'), WEBP_BYTES)

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '', dshPetsDir: '' })
  service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
  routes = makePetRoutes({ service, ctx })
  server = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    for (const route of routes) {
      if (route.kind === 'exact' && pathname === route.path) {
        void route.handler(req, res)
        return
      }
    }
    for (const route of routes) {
      if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) {
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

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('pet routes', () => {
  it('lists the registry and the selected state', async () => {
    const pets = await fetch(url('/api/pet/pets')).then(res => res.json()) as Array<{ id: string; atlasUrl: string }>
    expect(pets.map(entry => entry.id)).toEqual(['otter', 'whale-girl'])
    expect(pets.find(entry => entry.id === 'whale-girl')!.atlasUrl).toBe('/pet/whale-girl/spritesheet.webp')

    const state = await fetch(url('/api/pet/state')).then(res => res.json()) as { pet: { id: string }; name: string }
    expect(state.pet.id).toBe('whale-girl')
    expect(state.name).toBe('鲸鱼娘')
  })

  it('serves structured registry diagnostics (#623)', async () => {
    const res = await fetch(url('/api/pet/diagnostics'))
    expect(res.status).toBe(200)
    const body = await res.json() as { diagnostics: Array<{ level: string; source: string; message: string }> }
    expect(Array.isArray(body.diagnostics)).toBe(true)
    // The two fixture pets are v1 manifests: each yields one migration hint.
    const v1Notes = body.diagnostics.filter(d => d.message.includes('treated as renderer'))
    expect(v1Notes.length).toBe(2)
    expect(v1Notes[0]!.level).toBe('warning')
  })

  it('serves the atlas under the pet id and the legacy directory alias', async () => {
    for (const path of ['/pet/whale-girl/spritesheet.webp', '/pet/whale/spritesheet.webp']) {
      const res = await fetch(url(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(Buffer.from(await res.arrayBuffer())).toEqual(WEBP_BYTES)
    }
  })

  it('serves the manifest and optional preview media', async () => {
    const manifest = await fetch(url('/pet/whale-girl/pet.json')).then(res => res.json()) as { id: string; spritesheetPath: string }
    expect(manifest.id).toBe('whale-girl')
    expect(manifest.spritesheetPath).toBe('spritesheet.webp')

    const preview = await fetch(url('/pet/whale-girl/previews/idle.gif'))
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('image/gif')
    expect(Buffer.from(await preview.arrayBuffer())).toEqual(GIF_BYTES)
  })

  it('answers HEAD on assets and 404s unknown pets and undeclared files', async () => {
    const head = await fetch(url('/pet/whale-girl/spritesheet.webp'), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/webp')

    expect((await fetch(url('/pet/dragon/spritesheet.webp'))).status).toBe(404)
    expect((await fetch(url('/pet/whale-girl/evil.txt'))).status).toBe(404)
    expect((await fetch(url('/pet/whale-girl/spritesheet.png'))).status).toBe(404)
  })

  it('switches pets and renames per pet through the API', async () => {
    const setPet = await fetch(url('/api/pet/set-pet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId: 'otter' }),
    }).then(res => res.json()) as { ok: boolean }
    expect(setPet.ok).toBe(true)

    const renamed = await fetch(url('/api/pet/set-name'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '阿獭' }),
    }).then(res => res.json()) as { ok: boolean; name: string }
    expect(renamed).toMatchObject({ ok: true, name: '阿獭' })

    const state = await fetch(url('/api/pet/state')).then(res => res.json()) as { pet: { id: string }; name: string }
    expect(state).toMatchObject({ pet: { id: 'otter' }, name: '阿獭' })

    const back = await fetch(url('/api/pet/set-pet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ petId: 'whale-girl' }),
    }).then(res => res.json()) as { ok: boolean }
    expect(back.ok).toBe(true)
    const whaleState = await fetch(url('/api/pet/state')).then(res => res.json()) as { name: string }
    expect(whaleState.name).toBe('鲸鱼娘')
  })

  it('fences LAN clients out of the API and asset routes', () => {
    const probe = () => {
      let status = 0
      let body = ''
      return {
        res: {
          writeHead: (code: number) => { status = code },
          end: (chunk?: string) => { body = chunk ?? '' },
        },
        status: () => status,
        body: () => body,
      }
    }
    const lanRequest = { method: 'GET', socket: { remoteAddress: '192.168.1.9' }, headers: { host: '192.168.1.9:3080' } }
    const api = probe()
    const apiRoute = routes.find(route => route.kind === 'exact' && route.path === '/api/pet/state')
    apiRoute!.handler(lanRequest as never, api.res as never)
    expect(api.status()).toBe(403)
    expect(api.body()).toContain('loopback-only')

    const asset = probe()
    const assetRoute = routes.find(route => route.kind === 'prefix' && route.path === '/pet')
    assetRoute!.handler({ ...lanRequest, url: '/pet/whale-girl/pet.json' } as never, asset.res as never)
    expect(asset.status()).toBe(403)
    expect(asset.body()).toContain('loopback-only')
  })

  it('allows a LAN client with a live paired-device cookie on API and assets', async () => {
    const probe = () => {
      let status = 0
      let body = ''
      return {
        res: {
          writeHead: (code: number) => { status = code },
          end: (chunk?: string | Buffer) => { body = typeof chunk === 'string' ? chunk : chunk === undefined ? '' : 'ok' },
        },
        status: () => status,
        body: () => body,
      }
    }
    const pairedCtx = { get: () => ({ isPairedDevice: () => true }) }
    const pairedRoutes = makePetRoutes({ service, ctx: pairedCtx as never })
    const lanRequest = {
      method: 'GET',
      socket: { remoteAddress: '192.168.1.9' },
      headers: { host: 'dsh.thinkmoon.cn', cookie: 'dsh_pair=dev-1' },
    }
    const api = probe()
    const apiRoute = pairedRoutes.find(route => route.kind === 'exact' && route.path === '/api/pet/state')
    await apiRoute!.handler(lanRequest as never, api.res as never)
    expect(api.status()).toBe(200)

    const asset = probe()
    const assetRoute = pairedRoutes.find(route => route.kind === 'prefix' && route.path === '/pet')
    await assetRoute!.handler({ ...lanRequest, url: '/pet/whale-girl/pet.json' } as never, asset.res as never)
    expect(asset.status()).toBe(200)
  })
})
describe('decoration routes (pet-center M5, #567)', () => {
  it('serves the strip and descriptor from the declaration allow-list', async () => {
    const strip = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/whale-frames.png`)
    expect(strip.status).toBe(200)
    expect(await strip.arrayBuffer()).toHaveProperty('byteLength', 12)
    const manifest = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/decoration.json`)
    expect(manifest.status).toBe(200)
    expect((await manifest.json()).id).toBe('whale')
  })

  it('refuses files outside the declaration closure', async () => {
    const extra = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/secret.png`)
    expect(extra.status).toBe(404)
    const crafted = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/whale/%2e%2e/whale-frames.png`)
    expect(crafted.status).toBe(404)
  })

  it('404s unknown decoration ids', async () => {
    const missing = await fetch(`http://127.0.0.1:${port}/api/pet/decoration/nope/whale-frames.png`)
    expect(missing.status).toBe(404)
  })

  it('serves the decoration block in the state view', async () => {
    const state = await fetch(`http://127.0.0.1:${port}/api/pet/state`)
    const body = await state.json()
    expect(body.decoration.apiVersion).toBe('x-org.linxin666.pet-center/status-decoration-v1')
    expect(body.decoration.id).toBe('whale')
    expect(body.decoration.entryUrl).toBe('/api/pet/decoration/whale/whale-frames.png')
    expect(body.decoration.phases.thinking).toEqual({ from: 0, to: 3 })
  })

  it('serves the strip and descriptor with correct content types', async () => {
    const strip = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png')
    expect(strip.headers.get('content-type')).toBe('image/png')
    const manifest = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/decoration.json')
    expect(manifest.headers.get('content-type')).toContain('application/json')
  })

  it('answers 405 to POST and 200 with an empty body to HEAD', async () => {
    const post = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', { method: 'POST' })
    expect(post.status).toBe(405)
    const head = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.arrayBuffer()).toHaveProperty('byteLength', 0)
  })

  it('revalidates with the ETag instead of re-downloading the strip', async () => {
    const first = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png')
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    expect(etag).not.toBeNull()
    const cached = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', {
      headers: { 'if-none-match': etag! },
    })
    expect(cached.status).toBe(304)
    expect(await cached.arrayBuffer()).toHaveProperty('byteLength', 0)
    const stale = await fetch('http://127.0.0.1:' + port + '/api/pet/decoration/whale/whale-frames.png', {
      headers: { 'if-none-match': '"bogus"' },
    })
    expect(stale.status).toBe(200)
  })

  it('enforces the size ceiling and refuses symlink escapes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pet-deco-caps-'))
    try {
      mkdirSync(join(root, 'assets', 'pet'), { recursive: true })
      writeFileSync(join(root, 'assets', 'pet', 'pet.json'), JSON.stringify({
        id: 'plain-pet', displayName: 'Plain', spritesheetPath: 'spritesheet.webp',
      }), 'utf8')
      writeFileSync(join(root, 'assets', 'pet', 'spritesheet.webp'), WEBP_BYTES)
      const assets = join(root, 'assets', 'decorations', 'whale')
      mkdirSync(assets, { recursive: true })
      writeFileSync(join(assets, 'decoration.json'), JSON.stringify({
        decorationManifestVersion: 1,
        id: 'whale',
        license: 'MIT',
        entry: 'whale-frames.png',
        cell: { width: 64, height: 48 },
        columns: 4,
        phases: { thinking: { from: 0, to: 3 } },
      }), 'utf8')
      writeFileSync(join(assets, 'whale-frames.png'), Buffer.alloc(128, 1))
      const ctx = new Context()
      const registry = loadPetRegistry({ packageRoot: root, petsDir: '', dshPetsDir: '' })
      const capped = new PetService(ctx, { persistDir: join(root, 'home'), registry })
      const tinyRoutes = makePetRoutes({ service: capped, ctx, assetCaps: { manifest: 64, image: 64, model: 64 } })
      const srv = createServer((req, res) => {
        const pathname = (req.url ?? '').split('?')[0]!
        for (const route of tinyRoutes) {
          if (route.kind === 'exact' && pathname === route.path) { void route.handler(req, res); return }
        }
        for (const route of tinyRoutes) {
          if (route.kind === 'prefix' && (pathname === route.path || pathname.startsWith(route.path + '/'))) { void route.handler(req, res); return }
        }
        res.writeHead(404)
        res.end()
      })
      srv.listen(0, '127.0.0.1')
      await once(srv, 'listening')
      try {
        const capPort = (srv.address() as AddressInfo).port
        const oversized = await fetch('http://127.0.0.1:' + capPort + '/api/pet/decoration/whale/whale-frames.png')
        expect(oversized.status).toBe(413)
        // A strip symlinked outside the decoration directory is refused.
        rmSync(join(assets, 'whale-frames.png'))
        const outside = join(root, 'outside.png')
        writeFileSync(outside, Buffer.alloc(4, 1))
        symlinkSync(outside, join(assets, 'whale-frames.png'))
        const escaped = await fetch('http://127.0.0.1:' + capPort + '/api/pet/decoration/whale/whale-frames.png')
        expect(escaped.status).toBe(403)
      } finally {
        await new Promise<void>((resolve) => srv.close(() => resolve()))
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
