import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { createPetNativeToken } from '../src/adapters/web/native-auth.ts'
import { makePetRoutes, PET_NATIVE_API_PREFIX } from '../src/routes.ts'
import { PetService } from '../src/service.ts'

let context: Context
let directory: string
let server: Server
let port: number
let token: string
let service: PetService
const nativeReady = vi.fn(() => true)

beforeAll(async () => {
  context = new Context()
  directory = mkdtempSync(join(tmpdir(), 'dsh-pet-native-routes-'))
  service = new PetService(context, { persistDir: directory })
  token = createPetNativeToken()
  const routes = makePetRoutes({ service, nativeToken: token, onNativeReady: nativeReady })
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const route = routes.find(candidate => candidate.kind === 'exact' && candidate.path === pathname)
    if (route === undefined) {
      response.writeHead(404).end()
      return
    }
    void route.handler(request, response)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(directory, { recursive: true, force: true })
})

function url(path: string): string {
  return `http://127.0.0.1:${String(port)}${path}`
}

function authorization(value: string = token): HeadersInit {
  return { authorization: `Bearer ${value}` }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let body = ''
  while (!body.includes('\n\n')) {
    const next = await reader.read()
    if (next.done) break
    body += decoder.decode(next.value, { stream: true })
  }
  return body
}

describe('native pet routes', () => {
  it('mounts no native route without a boot token and rejects malformed tokens', () => {
    const service = new PetService(new Context(), { persistDir: directory })
    expect(makePetRoutes({ service }).some(route => route.path.startsWith(PET_NATIVE_API_PREFIX))).toBe(false)
    expect(() => makePetRoutes({ service, nativeToken: 'short' })).toThrow('invalid pet native token')
  })

  it('requires the exact bearer credential', async () => {
    const missing = await fetch(url(`${PET_NATIVE_API_PREFIX}/state`))
    expect(missing.status).toBe(401)
    await expect(missing.json()).resolves.toMatchObject({ error: 'NATIVE_AUTH_REQUIRED' })

    const invalid = await fetch(url(`${PET_NATIVE_API_PREFIX}/state`), {
      headers: authorization('wrong'),
    })
    expect(invalid.status).toBe(401)
    await expect(invalid.json()).resolves.toMatchObject({ error: 'NATIVE_AUTH_INVALID' })

    const accepted = await fetch(url(`${PET_NATIVE_API_PREFIX}/state`), {
      headers: authorization(),
    })
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toMatchObject({ animation: 'idle' })
  })

  it('returns renderer-neutral interaction intents', async () => {
    const response = await fetch(url(`${PET_NATIVE_API_PREFIX}/interact`), {
      method: 'POST',
      headers: { ...authorization(), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'pet' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      intent: {
        version: 2,
        source: 'interaction',
        motion: 'pet',
        playback: 'once',
      },
    })
  })

  it('authenticates and strictly validates desktop surface settings', async () => {
    const update = vi.spyOn(service, 'setDesktopSettings').mockResolvedValue({
      ok: true,
      companion: {
        enabled: false,
        visible: true,
        alwaysOnTop: true,
        locked: false,
        scale: 1.5,
      },
    })
    try {
      const accepted = await fetch(url(`${PET_NATIVE_API_PREFIX}/surface-settings`), {
        method: 'POST',
        headers: { ...authorization(), 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false, scale: 1.5 }),
      })
      expect(accepted.status).toBe(200)
      expect(update).toHaveBeenCalledWith({ enabled: false, scale: 1.5 })

      for (const body of [
        {},
        { enabled: 'false' },
        { scale: 0.75 },
        { scale: 2.01 },
        { enabled: false, unknown: true },
      ]) {
        const rejected = await fetch(url(`${PET_NATIVE_API_PREFIX}/surface-settings`), {
          method: 'POST',
          headers: { ...authorization(), 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        expect(rejected.status).toBe(400)
      }
      expect(update).toHaveBeenCalledOnce()

      const unauthenticated = await fetch(url(`${PET_NATIVE_API_PREFIX}/surface-settings`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      })
      expect(unauthenticated.status).toBe(401)
    } finally {
      update.mockRestore()
    }
  })

  it('accepts only an authenticated generation-scoped desktop readiness acknowledgement', async () => {
    nativeReady.mockClear()
    const accepted = await fetch(url(`${PET_NATIVE_API_PREFIX}/ready`), {
      method: 'POST',
      headers: { ...authorization(), 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: 'dsh-pet:web:42:generation', desktopPid: 6_200 }),
    })
    expect(accepted.status).toBe(200)
    expect(nativeReady).toHaveBeenCalledWith({
      sourceId: 'dsh-pet:web:42:generation',
      desktopPid: 6_200,
    })

    for (const body of [
      { sourceId: '', desktopPid: 6_200 },
      { sourceId: 'valid', desktopPid: 0 },
      { sourceId: 'valid', desktopPid: 1.5 },
      { sourceId: 'valid', desktopPid: 6_200, extra: true },
    ]) {
      const rejected = await fetch(url(`${PET_NATIVE_API_PREFIX}/ready`), {
        method: 'POST',
        headers: { ...authorization(), 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      expect(rejected.status).toBe(400)
    }
    expect(nativeReady).toHaveBeenCalledOnce()

    const unauthenticated = await fetch(url(`${PET_NATIVE_API_PREFIX}/ready`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: 'valid', desktopPid: 6_200 }),
    })
    expect(unauthenticated.status).toBe(401)
  })

  it('pushes the initial snapshot and later state changes over authenticated SSE', async () => {
    const controller = new AbortController()
    const response = await fetch(url(`${PET_NATIVE_API_PREFIX}/events`), {
      headers: authorization(),
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    const reader = response.body?.getReader()
    if (reader === undefined) throw new Error('missing SSE body')
    const initial = await readEvent(reader)
    expect(initial).toContain('data: ')
    expect(initial).toContain('"animation":"idle"')

    await fetch(url(`${PET_NATIVE_API_PREFIX}/interact`), {
      method: 'POST',
      headers: { ...authorization(), 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'pet' }),
    })
    const updated = await readEvent(reader)
    expect(updated).toContain('data: ')
    expect(updated).toContain('"affinity"')

    service.setEnabled(false)
    const final = await readEvent(reader)
    expect(final).toContain('data: ')
    await expect(reader.read()).resolves.toMatchObject({ done: true })
    controller.abort()
  })
})
