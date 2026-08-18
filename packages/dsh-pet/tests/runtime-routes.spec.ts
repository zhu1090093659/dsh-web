import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePetRuntimeRoutes } from '../src/routes.ts'
import type {
  StandaloneRuntimeManager,
  StandaloneRuntimeView,
} from '../src/adapters/standalone/runtime-manager.ts'

const missing: StandaloneRuntimeView = {
  version: '43.4.0',
  platform: 'win32',
  arch: 'x64',
  phase: 'not-installed',
  installed: false,
  managed: false,
  source: 'official',
}

describe('desktop runtime routes', () => {
  const close: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const dispose of close.splice(0).reverse()) await dispose()
  })

  it('exposes status, explicit install and cancellation only to the loopback Web UI', async () => {
    const runtime = {
      state: vi.fn(() => missing),
      startInstall: vi.fn(() => ({ ...missing, phase: 'downloading', source: 'npmmirror' })),
      cancelInstall: vi.fn(() => missing),
    } as unknown as StandaloneRuntimeManager
    const routes = makePetRuntimeRoutes(runtime)
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      const route = routes.find(candidate => candidate.path === pathname)
      if (route === undefined) {
        response.writeHead(404).end()
        return
      }
      void route.handler(request, response)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    close.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    const address = server.address() as AddressInfo
    const origin = `http://127.0.0.1:${String(address.port)}`

    const status = await fetch(`${origin}/api/pet/runtime`).then(response => response.json())
    expect(status).toMatchObject({ phase: 'not-installed', installed: false })

    const installing = await fetch(`${origin}/api/pet/runtime/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ source: 'npmmirror' }),
    }).then(response => response.json())
    expect(installing).toMatchObject({ phase: 'downloading', source: 'npmmirror' })
    expect(runtime.startInstall).toHaveBeenCalledWith({ source: 'npmmirror' })

    await fetch(`${origin}/api/pet/runtime/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: '{}',
    })
    expect(runtime.cancelInstall).toHaveBeenCalledOnce()

    const crossSite = await fetch(`${origin}/api/pet/runtime`, {
      headers: { origin: 'https://example.test', 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)
  })

})
