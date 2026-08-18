import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  const ctx = new Context()
  const registry = loadPetRegistry({ packageRoot: dir, petsDir: '' })
  const service = new PetService(ctx, { persistDir: join(dir, 'home'), registry })
  routes = makePetRoutes({ service })
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
})
