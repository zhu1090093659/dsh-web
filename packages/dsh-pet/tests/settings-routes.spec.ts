import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makePetSettingsRoutes } from '../src/routes.ts'
import type { PetService, PetSettingsView } from '../src/service.ts'

const view: PetSettingsView = {
  value: {
    enabled: true,
    visible: true,
    size: 160,
    right: 24,
    bottom: 20,
    petId: 'whale-girl',
    desktopEnabled: false,
  },
  base: { desktopEnabled: false },
  user: {},
  revision: 4,
  writable: true,
}

describe('standalone pet settings routes', () => {
  const close: Array<() => Promise<void>> = []

  afterEach(async () => {
    for (const dispose of close.splice(0).reverse()) await dispose()
  })

  it('serves and mutates only the pet namespace over same-origin loopback HTTP', async () => {
    const service = {
      settingsView: vi.fn(async () => view),
      mutateSettings: vi.fn(async () => ({
        ...view,
        value: { ...view.value, desktopEnabled: true },
        user: { desktopEnabled: true },
        revision: 5,
      })),
    } as unknown as PetService
    const routes = makePetSettingsRoutes(service)
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

    const described = await fetch(`${origin}/api/pet/settings`).then(response => response.json())
    expect(described).toMatchObject({ revision: 4, value: { desktopEnabled: false } })

    const mutated = await fetch(`${origin}/api/pet/settings/mutate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({
        expectedRevision: 4,
        ops: [{ op: 'set', path: ['desktopEnabled'], value: true }],
      }),
    }).then(response => response.json())
    expect(mutated).toMatchObject({ revision: 5, value: { desktopEnabled: true } })
    expect(service.mutateSettings).toHaveBeenCalledWith(
      [{ op: 'set', path: ['desktopEnabled'], value: true }],
      4,
    )

    for (const body of [
      { ops: [{ op: 'set', path: ['not-pet'], value: true }] },
      { ops: [{ op: 'set', path: ['desktopEnabled'] }] },
      { ops: [{ op: 'unset', path: ['desktopEnabled'], value: false }] },
      { expectedRevision: -1, ops: [{ op: 'unset', path: ['desktopEnabled'] }] },
      { extra: true, ops: [{ op: 'unset', path: ['desktopEnabled'] }] },
    ]) {
      const invalid = await fetch(`${origin}/api/pet/settings/mutate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(body),
      })
      expect(invalid.status).toBe(400)
    }
    expect(service.mutateSettings).toHaveBeenCalledOnce()

    const crossSite = await fetch(`${origin}/api/pet/settings`, {
      headers: { origin: 'http://example.test', 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)
  })
})
