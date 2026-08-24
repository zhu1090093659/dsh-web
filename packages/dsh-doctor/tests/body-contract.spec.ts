/**
 * Route-level JSON body failure contract: /action and /client-failure answer
 * an empty, malformed, non-object, or oversized body with their 400
 * validation responses instead of the old 500 (the local reader used to
 * throw and the guard caught it), and an oversized body destroys the request
 * instead of draining it (shared readJsonBody no-drain contract). Valid
 * object bodies keep their unchanged paths.
 */
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { makeDoctorRoutes } from '../src/host/routes.ts'
import type { SupervisorClient } from '../src/host/client.ts'
import type { DoctorLifecycle } from '../src/host/ensure.ts'
import type { SupervisorResponse } from '../src/core/protocol.ts'

const okResponse: SupervisorResponse = { ok: true, snapshot: { protocol: 1, phase: 'armed', version: '9.9.9', profiles: [], incidents: [], updatedAt: '2026-01-01T00:00:00Z' } }

/**
 * Async-readable loopback request stand-in built from byte chunks; counts
 * destroy calls exactly (the shared reader abandons the iterator on overflow).
 */
function fakeRequest(chunks: Buffer[] = []): { request: IncomingMessage; destroyCalls: () => number } {
  let destroyCalls = 0
  const request = {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        next: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
      }
    },
    destroy() {
      destroyCalls += 1
    },
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3080' },
  } as unknown as IncomingMessage
  return { request, destroyCalls: () => destroyCalls }
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

function routes(): { webRoutes: ReturnType<typeof makeDoctorRoutes>; call: ReturnType<typeof vi.fn> } {
  const status = vi.fn(async () => okResponse)
  const call = vi.fn(async () => okResponse)
  const client = { status, call } as unknown as SupervisorClient
  const lifecycle: DoctorLifecycle = {
    ensure: vi.fn(async () => ({ ok: true as const, code: 'OK', steps: ['service'] })),
    uninstall: vi.fn(async () => ({ ok: true as const, code: 'OK', steps: ['service'] })),
  }
  const webRoutes = makeDoctorRoutes(client, 'web', { hostVersion: '9.9.9', lifecycle })
  return { webRoutes, call }
}

const invalidPayloads: Array<[string, Buffer]> = [
  ['an empty body', Buffer.alloc(0)],
  ['an invalid JSON body', Buffer.from('not json')],
  ['a non-object body', Buffer.from('[1,2]')],
]

describe('doctor body failure contract', () => {
  for (const [label, payload] of invalidPayloads) {
    it(`answers ${label} on /action with 400 INVALID_ACTION`, async () => {
      const { request, destroyCalls } = fakeRequest([payload])
      const { webRoutes, call } = routes()
      const { res, read } = fakeRes()
      await webRoutes[1]!.handler(request as never, res)
      expect(read().status).toBe(400)
      expect(JSON.parse(read().body).error.code).toBe('INVALID_ACTION')
      expect(call).not.toHaveBeenCalled()
      expect(destroyCalls()).toBe(0)
    })
    it(`answers ${label} on /client-failure with 400 INVALID_FAILURE`, async () => {
      const { request, destroyCalls } = fakeRequest([payload])
      const { webRoutes, call } = routes()
      const { res, read } = fakeRes()
      await webRoutes[2]!.handler(request as never, res)
      expect(read().status).toBe(400)
      expect(JSON.parse(read().body).error.code).toBe('INVALID_FAILURE')
      expect(call).not.toHaveBeenCalled()
      expect(destroyCalls()).toBe(0)
    })
  }

  it('answers an oversized body on /action with 400 and destroys the request', async () => {
    const { request, destroyCalls } = fakeRequest([Buffer.from('{"action":"' + 'x'.repeat(64 * 1024) + '"}')])
    const { webRoutes } = routes()
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(request as never, res)
    expect(read().status).toBe(400)
    expect(JSON.parse(read().body).error.code).toBe('INVALID_ACTION')
    expect(destroyCalls()).toBe(1)
  })

  it('answers an oversized body on /client-failure with 400 and destroys the request', async () => {
    const { request, destroyCalls } = fakeRequest([Buffer.from('{"message":"' + 'x'.repeat(64 * 1024) + '"}')])
    const { webRoutes } = routes()
    const { res, read } = fakeRes()
    await webRoutes[2]!.handler(request as never, res)
    expect(read().status).toBe(400)
    expect(JSON.parse(read().body).error.code).toBe('INVALID_FAILURE')
    expect(destroyCalls()).toBe(1)
  })

  it('keeps a valid action body on the relay path', async () => {
    const { request } = fakeRequest([Buffer.from('{"action":"diagnose","incidentId":"i1"}')])
    const { webRoutes, call } = routes()
    const { res, read } = fakeRes()
    await webRoutes[1]!.handler(request as never, res)
    expect(call).toHaveBeenCalledTimes(1)
    expect(read().status).toBe(200)
    expect(JSON.parse(read().body).ok).toBe(true)
  })

  it('keeps a valid client-failure body', async () => {
    const { request } = fakeRequest([Buffer.from('{"message":"boom"}')])
    const { webRoutes, call } = routes()
    const { res, read } = fakeRes()
    await webRoutes[2]!.handler(request as never, res)
    expect(call).toHaveBeenCalledTimes(1)
    expect(read().status).toBe(200)
    expect(JSON.parse(read().body).ok).toBe(true)
  })

  it('writes family JSON headers and keeps no-store on the status response', async () => {
    const { request } = fakeRequest()
    const { webRoutes } = routes()
    const { res, read } = fakeRes()
    await webRoutes[0]!.handler(request as never, res)
    expect(read().status).toBe(200)
    expect(read().headers['content-type']).toBe('application/json; charset=utf-8')
    expect(read().headers['referrer-policy']).toBe('no-referrer')
    expect(read().headers['cache-control']).toBe('no-store')
  })
})
