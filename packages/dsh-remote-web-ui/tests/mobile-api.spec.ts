/**
 * The /m data channel: every allowlisted unary method must answer with the
 * transport envelope the phone's callUnary requires
 * ({ type: 'server-response', rpcId, result }) — regressions here surface as
 * a dead "加载中…" mobile surface.
 */
import { createServer, request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { makeMobileApiRoutes } from '../src/mobile-api.ts'

interface TestServer {
  port: number
  close: () => Promise<void>
}

const cookieName = 'dsh_pair'

/** A pairing service stub that recognizes every cookie value. */
const service = {
  config: { cookieName },
  hasDevice: () => true,
  touchDevice: () => true,
} as never

/** The resolved mobile composer preference (tests flip it per case). */
const mobileEnterToSend = () => true

/** An ApiProxy stub answering each method with the internal response shape. */
const apiProxy = {
  workspace: {
    list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
  },
  sessions: {
    list: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    create: async () => ({ rpcId: 'r', result: { ok: true, value: { sessionId: 's-created' } } }),
    history: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    search: async () => ({ rpcId: 'r', result: { ok: true, value: { items: [] } } }),
    prompt: async () => ({ rpcId: 'r', result: { ok: true, value: { queued: true } } }),
    models: async () => ({ rpcId: 'r', result: { ok: true, value: { current: { provider: 'fx', model: 'fx-1' } } } }),
    selectModel: async () => ({ rpcId: 'r', result: { ok: true, value: { ok: true } } }),
    rename: async () => ({ rpcId: 'r', result: { ok: true, value: { ok: true } } }),
  },
  events: { mux: () => (async function* () {})() },
} as unknown as ApiProxy

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
    const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

async function call(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${cookieName}=device-1`, 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

async function callNoCookie(port: number, method: string): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probe-1', method, payload: {} })
    const req = httpRequest({
      host: '127.0.0.1', port, path: `/m/api/${method}`, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('mobile api envelope', () => {
  it('wraps every allowlisted unary method in the server-response envelope', async () => {
    const server = await serve(makeMobileApiRoutes({ service, apiProxy, mobileEnterToSend }))
    try {
      for (const method of [
        'workspace.list',
        'session.create',
        'session.list',
        'session.history',
        'session.search',
        'session.prompt',
        'session.models',
        'session.selectModel',
        'session.rename',
      ]) {
        const { status, body } = await call(server.port, method)
        expect(status).toBe(200)
        const envelope = JSON.parse(body) as { type?: string; rpcId?: string; result?: { ok?: boolean } }
        expect(envelope.type, method).toBe('server-response')
        expect(envelope.rpcId, method).toBe('probe-1')
        expect(envelope.result?.ok, method).toBe(true)
      }
    } finally {
      await server.close()
    }
  })

  it('answers mobile.preferences locally from the plugin config', async () => {
    let mobileEnterToSend = true
    const server = await serve(makeMobileApiRoutes({
      service,
      apiProxy,
      mobileEnterToSend: () => mobileEnterToSend,
    }))
    try {
      const first = await call(server.port, 'mobile.preferences')
      expect(first.status).toBe(200)
      expect(JSON.parse(first.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: true } },
      })

      mobileEnterToSend = false
      const second = await call(server.port, 'mobile.preferences')
      expect(second.status).toBe(200)
      expect(JSON.parse(second.body)).toEqual({
        type: 'server-response',
        rpcId: 'probe-1',
        result: { ok: true, value: { mobileEnterToSend: false } },
      })
    } finally {
      await server.close()
    }
  })

  it('heartbeat keep-alive reuses the single SSE connection (no new socket)', async () => {
    const blockingProxy = {
      ...apiProxy,
      events: { mux: () => (async function* () { while (true) { await new Promise(() => {}) } })() },
    } as unknown as ApiProxy
    const routes = makeMobileApiRoutes({ service, apiProxy: blockingProxy, mobileEnterToSend, eventsHeartbeatMs: 25 })
    let connections = 0
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    server.on('connection', () => { connections += 1 })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let sseData = ''
    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, (response) => {
      response.on('data', (chunk) => {
        sseData += (chunk as Buffer).toString('utf8')
        // Two keep-alive pings prove the heartbeat is writing to this stream.
        if ((sseData.match(/: ping/g) ?? []).length >= 2) resolveDone?.()
      })
    })
    req.on('error', () => { resolveDone?.() })
    req.end()

    await done
    // The heartbeat wrote two pings onto the SAME open SSE connection; no
    // additional socket was opened for keep-alive (reuse of the single stream).
    expect((sseData.match(/: ping/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(connections).toBe(1)

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('refreshes device presence on every gated unary request', async () => {
    // The mobile surface has no /api/pair/heartbeat sender, so any gated RPC
    // must count as presence (touchDevice) — otherwise an idle phone ages past
    // offlineAfterMs and the desktop panel reports it as disconnected while it
    // is still actively connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(200)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('refreshes device presence on every SSE keep-alive while the stream stays open', async () => {
    // The core scenario: an idle phone keeps its SSE stream open but sends no
    // RPC traffic. The keep-alive interval must keep calling touchDevice so the
    // device never ages past offlineAfterMs — without this the desktop panel
    // reports "disconnected" while the phone is still connected.
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const blockingProxy = {
      ...apiProxy,
      events: { mux: () => (async function* () { while (true) { await new Promise(() => {}) } })() },
    } as unknown as ApiProxy
    const routes = makeMobileApiRoutes({ service: spyService, apiProxy: blockingProxy, mobileEnterToSend, eventsHeartbeatMs: 20 })
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? '/', 'http://x').pathname
      const exact = routes.find(r => r.kind === 'exact' && r.path === pathname)
      const route = exact ?? routes.find(r => r.kind === 'prefix' && pathname.startsWith(r.path))
      if (route === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      void route.handler(request, response)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo

    let resolveDone: (() => void) | undefined
    const done = new Promise<void>(resolve => { resolveDone = resolve })
    const req = httpRequest({
      host: '127.0.0.1', port: address.port, path: '/m/api/events.mux', method: 'GET',
      headers: { cookie: 'dsh_pair=device-1' },
    }, () => {})
    req.on('error', () => { resolveDone?.() })
    req.end()

    // Wait until the keep-alive interval has fired enough times (>= 2 touches).
    const deadline = Date.now() + 2000
    while (touchDevice.mock.calls.length < 2 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10))
    }
    resolveDone?.()

    expect(touchDevice.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Each keep-alive refreshes presence for the paired device cookie.
    for (const callArgs of touchDevice.mock.calls) {
      expect(callArgs[0]).toBe('device-1')
    }

    req.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('vetoes when touchDevice returns false despite a present cookie', async () => {
    // hasDevice may be true while touchDevice is false (e.g. the service was
    // stopped). The gate must still refuse and must not leak the request.
    const touchDevice = vi.fn(() => false)
    const spyService = { config: { cookieName }, hasDevice: () => true, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      const { status } = await call(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).toHaveBeenCalledWith('device-1')
    } finally {
      await server.close()
    }
  })

  it('does not refresh presence when the device cookie is absent', async () => {
    const touchDevice = vi.fn(() => true)
    const spyService = { config: { cookieName }, hasDevice: () => false, touchDevice } as never
    const server = await serve(makeMobileApiRoutes({ service: spyService, apiProxy, mobileEnterToSend }))
    try {
      // A request without the pairing cookie must be vetoed and must not
      // touchDevice (there is no device id to refresh).
      const { status } = await callNoCookie(server.port, 'session.list')
      expect(status).toBe(403)
      expect(touchDevice).not.toHaveBeenCalled()
    } finally {
      await server.close()
    }
  })
})
