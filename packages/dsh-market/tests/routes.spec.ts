/**
 * Market install gateway body contract. The loopback-gated POST endpoints
 * parse the client body with the shared lenient reader (16 KiB cap): an empty
 * body keeps the legacy {} pipeline (id validator answers 400 invalid-id),
 * invalid JSON also lands on {} and is rejected by the id validator, and an
 * over-limit body destroys the connection instead of answering JSON.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeMarketRoutes } from '../src/routes.ts'

let dir: string
let server: Server
let port: number

/** Manifest+file fetch stub mirroring the installer unit-test mock. */
function mockFetch(): typeof fetch {
  const manifest = {
    skins: {
      items: [{ id: 'whale-song', files: ['skin.json', 'skin.css', 'assets/whale-art.webp'] }],
    },
    pets: {
      items: [{ id: 'whale-girl', files: ['pet.json', 'spritesheet.webp'] }],
    },
  }
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const m = url.match(/\/manifest\/(skins|pets)\.json$/)
    if (m) return new Response(JSON.stringify(manifest[m[1] as 'skins' | 'pets']), { status: 200 })
    const file = url.split('/').pop() ?? ''
    return new Response('data-' + file, { status: 200 })
  }) as typeof fetch
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-market-routes-'))
  const routes = makeMarketRoutes({ dshHome: dir, fetchImpl: mockFetch() })
  server = createServer((req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
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
  await new Promise<void>((resolve) => server.close(() => resolve()))
  rmSync(dir, { recursive: true, force: true })
})

function url(path: string): string {
  return 'http://127.0.0.1:' + port + path
}

describe('market install body contract', () => {
  it('installs a skin with a valid JSON object body', async () => {
    const res = await fetch(url('/api/market/install-skin'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'whale-song' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; files: number }
    expect(body.ok).toBe(true)
    expect(body.files).toBe(3)
  })

  it('answers 400 invalid-id for a body that is not JSON', async () => {
    const res = await fetch(url('/api/market/install-skin'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-id' })
  })

  it('keeps the empty-body {} pipeline on the id validator', async () => {
    const res = await fetch(url('/api/market/install-skin'), { method: 'POST' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false, error: 'invalid-id' })
  })

  it('destroys the connection on an over-limit body instead of answering JSON', async () => {
    await expect(fetch(url('/api/market/install-skin'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"id":"' + 'x'.repeat(16 * 1024) + '"}',
    })).rejects.toThrow()
  })

  it('writes family JSON headers through the shared writer with no-store preserved', async () => {
    const res = await fetch(url('/api/market/install-skin'), { method: 'POST' })
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
