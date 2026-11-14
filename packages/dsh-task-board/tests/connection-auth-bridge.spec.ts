/**
 * Host connection authentication bridge (issue #1930).
 *
 * A deployment whose GUI is served through a reverse proxy or ingress (DSH
 * started with `--trusted-host`) reaches the API through the Host's
 * `connection` service: that service runs the Host/Origin fence and verifies
 * the authority-bound signed `dsh-auth-*` browser session. The board used to
 * fence every route on the loopback socket alone, so a proxy request from a
 * gateway address was refused with 403 even though the rest of the GUI loaded.
 * These checks pin the bridge: the connection verdict admits a request ahead of
 * the loopback fence, and the pre-existing fence remains the fallback when the
 * service is absent, mounts late, or declines the request.
 */
import { createServer, request, type IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  makeTaskBoardRoutes,
  type TaskBoardConnectionTrust,
  type TaskBoardRouteAccess,
} from '../src/host-routes.ts'
import type { TaskBoardHostService } from '../src/host-service.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'
import { resolveConnectionTrust } from '../src/index.ts'

const snapshot: TaskBoardSnapshot = {
  schemaVersion: 7,
  revision: 0,
  tasks: [],
  scheduler: { timeZone: 'UTC' },
  power: {
    platform: 'linux', phase: 'unsupported', enabled: false,
    runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
  },
}

/** The trusted authority the operator reached through the proxy. */
const PROXY_HOST = 'dsh.example.internal'

/** The address a container or gateway peer presents to the Host socket. */
const GATEWAY_ADDRESS = '192.168.1.120'

/** A browser request as the proxy presents it upstream, credentials included. */
const PROXY_BROWSER = {
  host: PROXY_HOST,
  origin: `https://${PROXY_HOST}`,
  'sec-fetch-site': 'same-origin',
  cookie: 'dsh-auth-ZHNoLmV4YW1wbGUuaW50ZXJuYWw=v1.body.signature',
}

/** A board action body the route accepts once its fence admits the request. */
const CREATE_BODY = JSON.stringify({
  requestId: 'request-1930',
  action: { kind: 'create', id: 'task-1930', input: { title: 'Proxy task', description: '', prompt: '' } },
})

/** One board bound to a real loopback listener, closed by the caller. */
interface BoardUnderTest {
  base: string
  applied: () => number
  close: () => Promise<void>
}

/**
 * Serve the task-board routes on a loopback listener.
 * @param access - the route access the fence resolves.
 * @param remoteAddress - the socket address the handler reports, overriding the real loopback peer to model a gateway.
 * @returns the board URL, its applied-action count, and its teardown.
 */
async function startBoard(access: TaskBoardRouteAccess, remoteAddress?: string): Promise<BoardUnderTest> {
  let applied = 0
  const service = {
    snapshot: () => snapshot,
    apply: () => {
      applied += 1
      return snapshot
    },
    applyVerified: () => {
      applied += 1
      return snapshot
    },
    ledger: { allTasks: () => [] },
    subscribe: () => () => undefined,
  } as unknown as TaskBoardHostService
  const routes = makeTaskBoardRoutes(service, access)
  const server = createServer((req, res) => {
    if (remoteAddress !== undefined) Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true })
    const route = routes.find(candidate => candidate.path === new URL(req.url ?? '/', 'http://local').pathname)
    if (route === undefined) { res.writeHead(404); res.end(); return }
    void route.handler(req, res)
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind')
  return {
    base: `http://127.0.0.1:${address.port}`,
    applied: () => applied,
    close: async () => { await new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve() }) }) },
  }
}

/**
 * Send one request and read the status the route answered with.
 * @param url - the route URL.
 * @param headers - request headers, including the upstream Host the proxy presents.
 * @param body - JSON body for a POST; omitted for a GET.
 * @returns the HTTP status.
 */
async function send(url: string, headers: Record<string, string>, body?: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const outgoing = request(url, { method: body === undefined ? 'GET' : 'POST', headers }, response => {
      response.resume()
      response.once('end', () => { resolve(response.statusCode ?? 0) })
    })
    outgoing.once('error', reject)
    outgoing.end(body)
  })
}

/**
 * The Host connection trust face, answering one fixed verdict.
 * @param rejection - undefined to admit, 401/403 to decline.
 * @param seen - receives the headers of every request the service judged.
 * @returns the trust face the route bridge consumes.
 */
function connectionAnswering(rejection: 401 | 403 | undefined, seen: Array<IncomingMessage['headers']> = []): TaskBoardConnectionTrust {
  return {
    requestRejection: (candidate) => {
      seen.push(candidate.headers)
      return rejection
    },
  }
}

describe('task-board connection authentication bridge', () => {
  it('operator behind a trusted reverse proxy reaches the board when the Host connection accepts the session', async () => {
    // Given a board behind a proxy whose gateway address is not loopback, and the Host connection service mounted
    const seen: Array<IncomingMessage['headers']> = []
    const board = await startBoard({ connection: () => connectionAnswering(undefined, seen) }, GATEWAY_ADDRESS)
    try {
      // When the proxy forwards the browser's state request on the trusted authority
      const status = await send(`${board.base}/api/task-board/state`, PROXY_BROWSER)
      // Then the connection verdict admits it, and the service judged the very request the board received
      expect(status).toBe(200)
      expect(seen[0]?.host).toBe(PROXY_HOST)
      expect(seen[0]?.cookie).toBe(PROXY_BROWSER.cookie)
    } finally {
      await board.close()
    }
  })

  it('operator behind a trusted reverse proxy mutates the board only through an accepted connection session', async () => {
    // Given a board behind a proxy, with the connection service declining the unauthenticated caller
    const unauthenticated = await startBoard({ connection: () => connectionAnswering(401) }, GATEWAY_ADDRESS)
    try {
      // When that caller posts an action through the proxy
      const status = await send(`${unauthenticated.base}/api/task-board/action`, {
        ...PROXY_BROWSER,
        'content-type': 'application/json',
      }, CREATE_BODY)
      // Then the board refuses it and applies nothing
      expect(status).toBe(403)
      expect(unauthenticated.applied()).toBe(0)
    } finally {
      await unauthenticated.close()
    }
    // And when the same action arrives with a session the service accepts
    const authenticated = await startBoard({ connection: () => connectionAnswering(undefined) }, GATEWAY_ADDRESS)
    try {
      const status = await send(`${authenticated.base}/api/task-board/action`, {
        ...PROXY_BROWSER,
        'content-type': 'application/json',
      }, CREATE_BODY)
      // Then the action reaches the Host ledger exactly once
      expect(status).toBe(200)
      expect(authenticated.applied()).toBe(1)
    } finally {
      await authenticated.close()
    }
  })

  it('operator whose deployment mounts no connection service keeps the loopback-only fence', async () => {
    // Given a board with no connection service at all, reached on a loopback socket
    const board = await startBoard({})
    try {
      // When a request arrives on a foreign proxy authority
      const throughProxy = await send(`${board.base}/api/task-board/state`, PROXY_BROWSER)
      // Then nothing admits it, while the direct loopback session keeps working
      expect(throughProxy).toBe(403)
      expect(await send(`${board.base}/api/task-board/state`, { 'sec-fetch-site': 'same-origin' })).toBe(200)
    } finally {
      await board.close()
    }
  })

  it('operator whose direct loopback session is declined by the connection service keeps the pre-existing admission', async () => {
    // Given the connection service mounted but declining the request on a loopback socket
    const board = await startBoard({ connection: () => connectionAnswering(401) })
    try {
      // When the browser reaches the board directly over loopback with its same-origin marker
      const status = await send(`${board.base}/api/task-board/state`, { 'sec-fetch-site': 'same-origin' })
      // Then the loopback fence still admits it: the bridge is an additional path, not a replacement
      expect(status).toBe(200)
    } finally {
      await board.close()
    }
  })

  it('operator whose connection service mounts after the routes sees the next proxy request follow it', async () => {
    // Given a board mounted before the connection service exists
    let mounted = false
    const board = await startBoard({
      connection: () => (mounted ? connectionAnswering(undefined) : undefined),
    }, GATEWAY_ADDRESS)
    try {
      // When the proxy request arrives before the service mounts, then after
      const early = await send(`${board.base}/api/task-board/state`, PROXY_BROWSER)
      mounted = true
      const late = await send(`${board.base}/api/task-board/state`, PROXY_BROWSER)
      // Then the fence asks again per request and follows the newly mounted service
      expect(early).toBe(403)
      expect(late).toBe(200)
    } finally {
      await board.close()
    }
  })
})

describe('connection trust resolution', () => {
  it('operator whose composition serves no usable connection service gets no trust face', () => {
    // Given contexts that serve nothing, an object without the request check, or fail the lookup
    const missing = { get: () => undefined }
    const incomplete = { get: () => ({ requestRejection: 'not-a-function' }) }
    const broken = { get: () => { throw new Error('service unavailable') } }
    // When the board resolves the trust face
    // Then each answers undefined so the routes keep the pre-existing fence
    expect(resolveConnectionTrust(missing as never)).toBeUndefined()
    expect(resolveConnectionTrust(incomplete as never)).toBeUndefined()
    expect(resolveConnectionTrust(broken as never)).toBeUndefined()
  })

  it('operator whose composition serves the connection service gets that exact request check', () => {
    // Given a context whose connection service exposes the request check
    const service = connectionAnswering(undefined)
    const ctx = { get: (name: string) => (name === 'connection' ? service : undefined) }
    // When the board resolves the trust face
    const resolved = resolveConnectionTrust(ctx as never)
    // Then it bridges the mounted service itself, so its Host/Origin fence and signed cookie decide
    expect(resolved).toBe(service)
  })

  it('operator resolves peer-auth connection.admit and routes admit or reject accordingly', async () => {
    // Given a peer-auth host connection exposing only admit(request)
    const admitService: TaskBoardConnectionTrust = {
      admit: () => ({ peer: { kind: 'browser-session', id: 'sess-1' } }),
    }
    const rejectService: TaskBoardConnectionTrust = {
      admit: () => ({ rejection: 401 }),
    }
    const resolved = resolveConnectionTrust({ get: (name: string) => (name === 'connection' ? admitService : undefined) } as never)
    const admittedBoard = await startBoard({ connection: () => admitService }, GATEWAY_ADDRESS)
    const rejectedBoard = await startBoard({ connection: () => rejectService }, GATEWAY_ADDRESS)
    try {
      // When requests arrive through a trusted proxy for admitted vs rejected peer sessions
      const admittedStatus = await send(`${admittedBoard.base}/api/task-board/state`, PROXY_BROWSER)
      const rejectedStatus = await send(`${rejectedBoard.base}/api/task-board/action`, {
        ...PROXY_BROWSER,
        'content-type': 'application/json',
      }, CREATE_BODY)

      // Then resolveConnectionTrust returns the admit service, admitted requests succeed, and rejected requests fail closed
      expect(resolved).toBe(admitService)
      expect(admittedStatus).toBe(200)
      expect(rejectedStatus).toBe(403)
      expect(rejectedBoard.applied()).toBe(0)
    } finally {
      await admittedBoard.close()
      await rejectedBoard.close()
    }
  })

  it('operator whose connection bridge throws keeps the loopback fence instead of failing the route', async () => {
    // Given a host whose connection service is mounted but cannot answer from this
    // fiber (post-#8266 admit() reads connection.authentication without an inject)
    const broken: TaskBoardConnectionTrust = {
      admit: () => {
        throw new Error('cannot get property "connection.authentication" without inject')
      },
    }
    const board = await startBoard({ connection: () => broken })
    try {
      // When the browser reaches the board directly over loopback
      const direct = await send(`${board.base}/api/task-board/state`, { 'sec-fetch-site': 'same-origin' })
      // Then the bridge failure is not an admission decision: the pre-existing
      // loopback fence still answers, and the route never escapes as a 400
      expect(direct).toBe(200)
      // And it is not an admission either: a foreign proxy authority stays refused
      const proxied = await send(`${board.base}/api/task-board/state`, PROXY_BROWSER)
      expect(proxied).toBe(403)
    } finally {
      await board.close()
    }
  })

  it('operator registers every task-board route with anonymous webServer auth policy', () => {
    // Given task-board routes wired with the plugin's own trust fence
    const service = {
      snapshot: () => snapshot,
      apply: () => snapshot,
      applyVerified: () => snapshot,
      ledger: { allTasks: () => [] },
      subscribe: () => () => undefined,
    } as unknown as TaskBoardHostService
    const routes = makeTaskBoardRoutes(service)

    // When checking the declared webServer auth policy across all board routes
    const policies = routes.map((route) => (route as { readonly auth?: string }).auth)

    // Then every route explicitly sets auth to anonymous
    expect(policies.length).toBeGreaterThan(0)
    expect(policies.every((policy) => policy === 'anonymous')).toBe(true)
  })
})
