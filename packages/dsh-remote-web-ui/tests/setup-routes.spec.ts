import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it } from 'vitest'
import { SetupPlanError } from '../src/cloudflare-plan.ts'
import {
  SETUP_MAX_BODY_BYTES,
  SETUP_PATHS,
  type SetupErrorCode,
  type SetupPlanRequest,
  type SetupPlanResponse,
  type SetupPreflightResponse,
} from '../src/setup-contract.ts'
import { isTrustedLocalControlRequest } from '../src/local-control.ts'
import { REMOTE_SETUP_PATH } from '../src/remote-methods.ts'
import { makeSetupRoutes, type SetupReadService } from '../src/setup-routes.ts'

const LOCAL_ORIGIN = 'http://127.0.0.1:3080'
const LOCAL_HOST = '127.0.0.1:3080'
const TOKEN = 'request-token-value-1234567890'

const PREFLIGHT_RESPONSE: SetupPreflightResponse = {
  ok: true,
  readOnly: true,
  executionAvailable: false,
  preflight: {
    platform: 'darwin',
    dsh: {
      host: '127.0.0.1',
      port: 3080,
      localOrigin: LOCAL_ORIGIN,
      loopbackOnly: true,
    },
    cloudflared: { found: true, version: '2026.8.0' },
    serviceMode: 'launchd-preview',
    autoTunnelEnabled: false,
  },
}

const PLAN_RESPONSE: SetupPlanResponse = {
  ok: true,
  readOnly: true,
  executionAvailable: false,
  plan: {
    planId: 'plan-read-only',
    readOnly: true,
    executionAvailable: false,
    canApply: false,
    hostname: 'remote.valid-domain.com',
    publicBaseUrl: 'https://remote.valid-domain.com',
    localOrigin: LOCAL_ORIGIN,
    zoneName: 'valid-domain.com',
    tunnelName: 'dsh-remote',
    accessAppName: 'DSH Remote',
    includeRemote: false,
    publishedPaths: ['/m'],
    preservesExternalHost: true,
    cloudflarePermissions: { read: 'verified', write: 'unverified' },
    ingress: {
      rules: [
        { path: '/m', service: LOCAL_ORIGIN, purpose: 'mobile-pairing' },
        { service: 'http_status:404', purpose: 'deny-all-other-paths' },
      ],
      finalCatchAll: 'http_status:404',
    },
    service: {
      mode: 'launchd-preview',
      platform: 'darwin',
      summary: 'read-only preview',
      steps: [{ id: 'preview', detail: 'No service is installed.' }],
    },
    actions: [],
    blockers: [{ code: 'execution-unavailable', message: 'PR1 cannot execute this plan.' }],
    warnings: [],
  },
}

const VALID_REQUEST = {
  hostname: 'remote.valid-domain.com',
  email: 'owner@valid-domain.com',
  credential: { source: 'request', token: TOKEN },
} as const

interface Calls {
  preflight: number
  plans: SetupPlanRequest[]
}

function fakeService(overrides: Partial<SetupReadService> = {}): { service: SetupReadService; calls: Calls } {
  const calls: Calls = { preflight: 0, plans: [] }
  const service: SetupReadService = {
    localOrigin: LOCAL_ORIGIN,
    preflight: async () => {
      calls.preflight += 1
      return PREFLIGHT_RESPONSE
    },
    plan: async (input) => {
      calls.plans.push(input)
      return PLAN_RESPONSE
    },
    ...overrides,
  }
  return { service, calls }
}

interface TestServer {
  port: number
  close(): Promise<void>
}

async function serve(routes: WebRoute[]): Promise<TestServer> {
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://x').pathname
    const route = routes.find(candidate => candidate.kind === 'exact' && candidate.path === pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    close: async () => await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined || error === null) resolve()
        else reject(error)
      })
    }),
  }
}

interface CallOptions {
  host?: string
  origin?: string
  body?: string
  contentType?: string
  secFetchSite?: string
}

async function call(
  port: number,
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; raw: string; body: Record<string, unknown>; headers: IncomingHttpHeaders }> {
  return await new Promise((resolve, reject) => {
    const headers: Record<string, string> = { host: options.host ?? LOCAL_HOST }
    if (options.origin !== undefined) headers.origin = options.origin
    if (options.secFetchSite !== undefined) headers['sec-fetch-site'] = options.secFetchSite
    if (options.body !== undefined) {
      headers['content-type'] = options.contentType ?? 'application/json'
      headers['content-length'] = String(Buffer.byteLength(options.body))
    }
    const request = httpRequest({ hostname: '127.0.0.1', port, method, path, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk as Buffer))
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve({
          status: response.statusCode ?? 0,
          raw,
          body: raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>,
          headers: response.headers,
        })
      })
    })
    request.on('error', reject)
    request.end(options.body)
  })
}

function expectPrivateJson(result: { headers: IncomingHttpHeaders }): void {
  expect(result.headers['content-type']).toContain('application/json')
  expect(result.headers['cache-control']).toBe('no-store')
  expect(result.headers['referrer-policy']).toBe('no-referrer')
}

function requestShape(remoteAddress: string, host: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers: { host, ...headers },
    socket: { remoteAddress },
  } as unknown as IncomingMessage
}

describe('local control request classification', () => {
  it('requires both the socket and Host to be loopback and ignores forwarded-address claims', () => {
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST))).toBe(true)
    expect(isTrustedLocalControlRequest(requestShape('192.0.2.10', LOCAL_HOST, {
      'x-forwarded-for': '127.0.0.1',
    }))).toBe(false)
    expect(isTrustedLocalControlRequest(requestShape('::1', 'remote.valid-domain.com'))).toBe(false)
  })

  it('rejects malformed Host values whose extra URL components would otherwise normalize away', () => {
    for (const host of [
      `user@${LOCAL_HOST}`,
      `${LOCAL_HOST}/unexpected-path`,
      `${LOCAL_HOST}?unexpected=query`,
      `${LOCAL_HOST}#unexpected-fragment`,
    ]) {
      expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', host)), host).toBe(false)
    }
  })

  it('uses exact Origin as the POST gate and Sec-Fetch-Site as an explicit cross-site veto', () => {
    const options = { expectedOrigin: LOCAL_ORIGIN, requireOrigin: true }
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST, {
      origin: LOCAL_ORIGIN,
    }), options)).toBe(true)
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST, {
      origin: LOCAL_ORIGIN,
      'sec-fetch-site': 'cross-site',
    }), options)).toBe(false)
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST, {
      origin: 'http://127.0.0.1:9999',
    }), options)).toBe(false)
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST, {
      origin: `${LOCAL_ORIGIN}/unexpected-path`,
    }), options)).toBe(false)
    expect(isTrustedLocalControlRequest(requestShape('127.0.0.1', LOCAL_HOST, {
      origin: `${LOCAL_ORIGIN}/`,
    }), options)).toBe(false)
  })
})

describe('read-only setup route registration', () => {
  it('registers only the two exact preflight and plan paths', async () => {
    const { service } = fakeService()
    const routes = makeSetupRoutes({ service })
    expect(routes.map(route => ({ kind: route.kind, path: route.path }))).toEqual([
      { kind: 'exact', path: SETUP_PATHS.preflight },
      { kind: 'exact', path: SETUP_PATHS.plan },
    ])
    expect(Object.values(SETUP_PATHS).every(path => path.startsWith(`${REMOTE_SETUP_PATH}/`))).toBe(true)

    const server = await serve(routes)
    try {
      expect((await call(server.port, 'POST', '/api/remote-setup/apply', {
        origin: LOCAL_ORIGIN,
        body: JSON.stringify(VALID_REQUEST),
      })).status).toBe(404)
      expect((await call(server.port, 'POST', '/api/remote-setup/rollback', {
        origin: LOCAL_ORIGIN,
        body: '{}',
      })).status).toBe(404)
    } finally {
      await server.close()
    }
  })
})

describe('read-only setup route fence and parsing order', () => {
  it('allows loopback preflight, rejects a public Host, and marks every response private', async () => {
    const { service, calls } = fakeService()
    const server = await serve(makeSetupRoutes({ service }))
    try {
      const allowed = await call(server.port, 'GET', SETUP_PATHS.preflight)
      expect(allowed.status).toBe(200)
      expect(allowed.body).toEqual(PREFLIGHT_RESPONSE)
      expectPrivateJson(allowed)
      expect(calls.preflight).toBe(1)

      const denied = await call(server.port, 'GET', SETUP_PATHS.preflight, { host: 'remote.valid-domain.com' })
      expect(denied.status).toBe(403)
      expect(denied.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expectPrivateJson(denied)
      expect(calls.preflight).toBe(1)
    } finally {
      await server.close()
    }
  })

  it('rejects POST trust failures before malformed token-bearing JSON reaches the service', async () => {
    const { service, calls } = fakeService()
    const server = await serve(makeSetupRoutes({ service }))
    const malformedSecretBody = `{"credential":{"source":"request","token":"${TOKEN}"}`
    try {
      const cases: CallOptions[] = [
        { body: malformedSecretBody },
        { origin: 'http://127.0.0.1:9999', body: malformedSecretBody },
        { origin: LOCAL_ORIGIN, secFetchSite: 'cross-site', body: malformedSecretBody },
        { host: 'remote.valid-domain.com', origin: 'http://remote.valid-domain.com', body: malformedSecretBody },
      ]
      for (const options of cases) {
        const denied = await call(server.port, 'POST', SETUP_PATHS.plan, options)
        expect(denied.status).toBe(403)
        expect(denied.body).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(denied.raw).not.toContain(TOKEN)
        expectPrivateJson(denied)
      }
      expect(calls.plans).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('requires JSON, a bounded body, and the strict contract before service dispatch', async () => {
    const { service, calls } = fakeService()
    const server = await serve(makeSetupRoutes({ service }))
    const validBody = JSON.stringify(VALID_REQUEST)
    const invalidBodies: Array<{ body: string; contentType?: string }> = [
      { body: validBody, contentType: 'text/plain' },
      { body: '{"hostname":' },
      { body: JSON.stringify({ ...VALID_REQUEST, extra: true }) },
      { body: JSON.stringify({ ...VALID_REQUEST, credential: { ...VALID_REQUEST.credential, extra: true } }) },
      { body: JSON.stringify({ ...VALID_REQUEST, credential: { source: 'request', token: 'x'.repeat(SETUP_MAX_BODY_BYTES) } }) },
    ]
    try {
      for (const invalid of invalidBodies) {
        const rejected = await call(server.port, 'POST', SETUP_PATHS.plan, {
          origin: LOCAL_ORIGIN,
          secFetchSite: 'same-site',
          ...invalid,
        })
        expect(rejected.status).toBe(400)
        expect(rejected.body).toMatchObject({ ok: false, error: { code: 'bad-payload' } })
        expectPrivateJson(rejected)
      }
      expect(calls.plans).toHaveLength(0)
    } finally {
      await server.close()
    }
  })

  it('passes normalized strict input to the planner and returns its complete wire response', async () => {
    const { service, calls } = fakeService()
    const server = await serve(makeSetupRoutes({ service }))
    try {
      const result = await call(server.port, 'POST', SETUP_PATHS.plan, {
        origin: LOCAL_ORIGIN,
        secFetchSite: 'same-site',
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ...VALID_REQUEST,
          hostname: 'REMOTE.VALID-DOMAIN.COM',
          email: 'OWNER@VALID-DOMAIN.COM',
        }),
      })
      expect(result.status).toBe(200)
      expect(result.body).toEqual(PLAN_RESPONSE)
      expectPrivateJson(result)
      expect(calls.plans).toEqual([{
        ...VALID_REQUEST,
        hostname: 'remote.valid-domain.com',
        email: 'owner@valid-domain.com',
        includeRemote: false,
      }])
    } finally {
      await server.close()
    }
  })

  it('returns private 405 responses without dispatching either service method', async () => {
    const { service, calls } = fakeService()
    const server = await serve(makeSetupRoutes({ service }))
    try {
      const preflight = await call(server.port, 'POST', SETUP_PATHS.preflight, {
        body: '{not-json',
        origin: LOCAL_ORIGIN,
      })
      expect(preflight.status).toBe(405)
      expect(preflight.headers.allow).toBe('GET')
      expectPrivateJson(preflight)

      const plan = await call(server.port, 'GET', SETUP_PATHS.plan)
      expect(plan.status).toBe(405)
      expect(plan.headers.allow).toBe('POST')
      expectPrivateJson(plan)
      expect(calls).toEqual({ preflight: 0, plans: [] })
    } finally {
      await server.close()
    }
  })

  it('never reflects an unexpected planner error', async () => {
    const secret = 'never-reflect-this-token'
    const { service } = fakeService({
      plan: async () => { throw new Error(`planner failed with ${secret}`) },
    })
    const server = await serve(makeSetupRoutes({ service }))
    try {
      const result = await call(server.port, 'POST', SETUP_PATHS.plan, {
        origin: LOCAL_ORIGIN,
        body: JSON.stringify(VALID_REQUEST),
      })
      expect(result.status).toBe(500)
      expect(result.body).toMatchObject({ ok: false, error: { code: 'internal-error', retryable: true } })
      expect(result.raw).not.toContain(secret)
      expectPrivateJson(result)
    } finally {
      await server.close()
    }
  })

  it('maps stable planner errors without changing their safe wire code', async () => {
    let failure = new SetupPlanError('bad-payload', 'Safe planner failure.')
    const { service } = fakeService({
      plan: async () => { throw failure },
    })
    const server = await serve(makeSetupRoutes({ service }))
    const cases: Array<{ code: SetupErrorCode; status: number }> = [
      { code: 'bad-payload', status: 400 },
      { code: 'cloudflare-auth-failed', status: 401 },
      { code: 'forbidden', status: 403 },
      { code: 'cloudflare-permission-denied', status: 403 },
      { code: 'zone-not-found', status: 404 },
      { code: 'unsupported-platform', status: 412 },
      { code: 'dsh-not-loopback', status: 412 },
      { code: 'cloudflared-not-found', status: 412 },
      { code: 'keychain-unavailable', status: 412 },
      { code: 'cloudflare-unavailable', status: 502 },
      { code: 'internal-error', status: 500 },
    ]
    try {
      for (const entry of cases) {
        failure = new SetupPlanError(entry.code, 'Safe planner failure.', entry.code === 'cloudflare-unavailable')
        const result = await call(server.port, 'POST', SETUP_PATHS.plan, {
          origin: LOCAL_ORIGIN,
          body: JSON.stringify(VALID_REQUEST),
        })
        expect(result.status, entry.code).toBe(entry.status)
        expect(result.body, entry.code).toMatchObject({ ok: false, error: { code: entry.code } })
        expectPrivateJson(result)
      }
    } finally {
      await server.close()
    }
  })
})
