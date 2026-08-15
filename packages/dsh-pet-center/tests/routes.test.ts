import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePetCenterRoutes, PET_CENTER_API_PREFIX } from '../src/routes.ts'
import { MANAGED_START, MANAGED_END } from '../src/pet-switch.ts'

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'pet-center-routes-test-'))
}

/** Minimal ServerResponse stub capturing the JSON body. */
function fakeRes(): { res: any; body: () => unknown } {
  const state: { status: number; body: unknown } = { status: 0, body: undefined }
  return {
    res: {
      writeHead(status: number) { state.status = status },
      end(body: unknown) { if (typeof body === 'string') state.body = JSON.parse(body) },
    },
    body: () => state.body,
  }
}

/** A GET/POST IncomingMessage stub with same-origin headlines. */
function fakeReq(method: string, body?: unknown): any {
  const req = { method, headers: { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3080' } }
  if (method === 'POST') {
    const payload = JSON.stringify(body ?? {})
    req.headers['content-type'] = 'application/json'
    req.headers['content-length'] = String(payload.length)
    ;(req as any).on = (event: 'data' | 'end', cb: (chunk?: Buffer) => void) => {
      if (event === 'data') { cb(Buffer.from(payload)); return req }
      if (event === 'end') { cb(); return req }
      return req
    }
  }
  return req
}

describe('makePetCenterRoutes', () => {
  it('exposes the state and apply routes under the api prefix', () => {
    const routes = makePetCenterRoutes({ home: tempHome() })
    expect(routes.map(route => route.path)).toEqual([
      `${PET_CENTER_API_PREFIX}/state`,
      `${PET_CENTER_API_PREFIX}/apply`,
    ])
  })

  it('state reports the default pet and apply switches it through a throwaway home', async () => {
    const home = tempHome()
    try {
      const routes = makePetCenterRoutes({ home })
      const [stateRoute, applyRoute] = routes

      // state
      const s = fakeRes()
      await (stateRoute.handler as any)(fakeReq('GET'), s.res)
      expect(s.body()).toMatchObject({ ok: true, active: 'pet', pets: ['pet', 'pet-maid'] })

      // apply -> pet-maid
      const a = fakeRes()
      await (applyRoute.handler as any)(fakeReq('POST', { pet: 'pet-maid' }), a.res)
      expect(a.body()).toMatchObject({ ok: true, active: 'pet-maid' })

      const patch = readFileSync(join(home, '.dsh', 'cordis.patch.yml'), 'utf8')
      expect(patch).toContain('- id: pet\n  disabled: true')
      expect(patch.indexOf(MANAGED_START)).toBeGreaterThan(-1)
      expect(patch.indexOf(MANAGED_END)).toBeGreaterThan(-1)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('apply rejects an unknown pet', async () => {
    const home = tempHome()
    try {
      const applyRoute = makePetCenterRoutes({ home })[1]
      const a = fakeRes()
      await (applyRoute.handler as any)(fakeReq('POST', { pet: 'bogus' }), a.res)
      expect(a.body()).toMatchObject({ ok: false, error: 'invalid-pet: pass pet: "pet" or "pet-maid"' })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
