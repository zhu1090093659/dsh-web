import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { makeDoctorRoutes } from '../src/host/routes.ts'
import type { SupervisorClient } from '../src/host/client.ts'
import type { DoctorLifecycle } from '../src/host/ensure.ts'
import type { SupervisorResponse } from '../src/core/protocol.ts'

const okResponse: SupervisorResponse = { ok: true, snapshot: { protocol: 1, phase: 'armed', version: '9.9.9', profiles: [], incidents: [], updatedAt: '2026-01-01T00:00:00Z' } }

function bodyReq(body: string): IncomingMessage {
  // Real IncomingMessage chunks are Buffers; the shared body reader needs them.
  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
  Object.assign(req, { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } })
  return req
}

function statusReq(): IncomingMessage {
  return { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage
}

function fakeRes(): { res: ServerResponse; read: () => { status: number; body: string; headers: Record<string, string> } } {
  let status = 0
  let body = ''
  let headers: Record<string, string> = {}
  const res = {
    writeHead: (code: number, head: Record<string, string> = {}) => { status = code; headers = { ...head } },
    end: (value?: unknown) => { body = String(value ?? '') },
  } as unknown as ServerResponse
  return { res, read: () => ({ status, body, headers }) }
}

function routes(overrides?: { statusError?: Error; provisioned?: boolean; call?: ReturnType<typeof vi.fn> }): {
  client: SupervisorClient
  webRoutes: ReturnType<typeof makeDoctorRoutes>
  lifecycle: DoctorLifecycle
  ensure: ReturnType<typeof vi.fn>
  uninstall: ReturnType<typeof vi.fn>
} {
  const status = vi.fn(async () => {
    if (overrides?.statusError !== undefined) throw overrides.statusError
    return okResponse
  })
  const call = overrides?.call ?? vi.fn(async () => okResponse)
  const client = { status, call } as unknown as SupervisorClient
  const ensure = vi.fn(async () => ({ ok: true as const, code: 'OK', steps: ['service'] }))
  const uninstall = vi.fn(async () => ({ ok: true as const, code: 'OK', steps: ['service'] }))
  const lifecycle: DoctorLifecycle = { ensure, uninstall }
  const webRoutes = makeDoctorRoutes(client, 'web', {
    hostVersion: '9.9.9',
    lifecycle,
    provisioned: overrides?.provisioned === undefined ? undefined : async () => overrides.provisioned!,
  })
  return { client, webRoutes, lifecycle, ensure, uninstall }
}

describe('doctor host routes lifecycle', () => {
  it('serves status with the host version', async () => {
    const { webRoutes } = routes()
    const { res, read } = fakeRes()
    await webRoutes[0]!.handler(statusReq() as never, res)
    const settled = read()
    expect(settled.status).toBe(200)
    const parsed = JSON.parse(settled.body) as { ok: boolean; hostVersion: string; snapshot?: unknown }
    expect(parsed.ok).toBe(true)
    expect(parsed.hostVersion).toBe('9.9.9')
    expect(parsed.snapshot).toBeDefined()
  })

  it('maps a missing state dir to SUPERVISOR_UNPROVISIONED', async () => {
    const { webRoutes } = routes({ statusError: new Error('ENOENT token'), provisioned: false })
    const { res, read } = fakeRes()
    await webRoutes[0]!.handler(statusReq() as never, res)
    const parsed = JSON.parse(read().body) as { ok: boolean; error: { code: string } }
    expect(read().status).toBe(503)
    expect(parsed.ok).toBe(false)
    expect(parsed.error.code).toBe('SUPERVISOR_UNPROVISIONED')
  })

  it('maps a present state with a silent daemon to SUPERVISOR_DOWN', async () => {
    const { webRoutes } = routes({ statusError: new Error('ECONNREFUSED'), provisioned: true })
    const { res, read } = fakeRes()
    await webRoutes[0]!.handler(statusReq() as never, res)
    const parsed = JSON.parse(read().body) as { error: { code: string } }
    expect(parsed.error.code).toBe('SUPERVISOR_DOWN')
  })

  it('intercepts provision into the lifecycle ensure verb', async () => {
    const { webRoutes, ensure, client } = routes()
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(bodyReq(JSON.stringify({ action: 'provision' })), res)
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(client.call).not.toHaveBeenCalled()
    const parsed = JSON.parse(read().body) as { ok: boolean; hostVersion: string }
    expect(parsed.ok).toBe(true)
    expect(parsed.hostVersion).toBe('9.9.9')
  })

  it('intercepts uninstall into the lifecycle uninstall verb', async () => {
    const { webRoutes, uninstall } = routes()
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(bodyReq(JSON.stringify({ action: 'uninstall' })), res)
    expect(uninstall).toHaveBeenCalledTimes(1)
    expect(JSON.parse(read().body).ok).toBe(true)
  })

  it('reports lifecycle failures with the failure code', async () => {
    const { webRoutes, ensure } = routes()
    ensure.mockResolvedValue({ ok: false, code: 'PROVISION_FAILED', message: 'boom', steps: ['service'] })
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(bodyReq(JSON.stringify({ action: 'provision' })), res)
    const parsed = JSON.parse(read().body) as { error: { code: string; message: string } }
    expect(parsed.error.code).toBe('PROVISION_FAILED')
    expect(parsed.error.message).toBe('boom')
  })

  it('relays non-lifecycle actions to the supervisor', async () => {
    const call = vi.fn(async () => okResponse)
    const { webRoutes, ensure, client } = routes({ call })
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(bodyReq(JSON.stringify({ action: 'diagnose', incidentId: 'i1' })), res)
    expect(call).toHaveBeenCalledTimes(1)
    expect(ensure).not.toHaveBeenCalled()
    const relayArgs = call.mock.calls[0] as unknown as [{ action: string }]
    expect(relayArgs[0]!.action).toBe('diagnose')
    const parsed = JSON.parse(read().body) as { ok: boolean }
    expect(parsed.ok).toBe(true)
    expect(client).toBeDefined()
  })

  it('rejects unknown actions before the lifecycle check', async () => {
    const { webRoutes, ensure } = routes()
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(bodyReq(JSON.stringify({ action: 'explode' })), res)
    expect(ensure).not.toHaveBeenCalled()
    expect(JSON.parse(read().body).error.code).toBe('INVALID_ACTION')
  })

  it('fences non-loopback callers', async () => {
    const { webRoutes, ensure } = routes()
    const req = Readable.from(['{}']) as unknown as IncomingMessage
    Object.assign(req, { headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '10.0.0.5' } })
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(req, res)
    const settled = read()
    expect(settled.status).toBe(403)
    expect(JSON.parse(settled.body)).toEqual({ ok: false, error: 'forbidden: loopback-only' })
    expect(settled.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(settled.headers['referrer-policy']).toBe('no-referrer')
    expect(ensure).not.toHaveBeenCalled()
  })
})
