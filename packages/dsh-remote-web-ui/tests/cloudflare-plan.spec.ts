import { describe, expect, it } from 'vitest'
import {
  buildCloudflareSetupPlan,
  CloudflareHttpReadApi,
  createCloudflareSetupPlanner,
  SetupPlanError,
  type BuildCloudflareSetupPlanInput,
  type CloudflareInspectionSnapshot,
  type CloudflareReadApi,
} from '../src/cloudflare-plan.ts'
import type { SetupPlanRequest, SetupPreflightResponse } from '../src/setup-contract.ts'

const TOKEN = 'cf_read_token_12345678901234567890'
const EMAIL = 'owner@acme.com'

function preflight(overrides: Partial<SetupPreflightResponse['preflight']> = {}): SetupPreflightResponse['preflight'] {
  return {
    platform: 'darwin',
    dsh: {
      host: '127.0.0.1',
      port: 3080,
      localOrigin: 'http://127.0.0.1:3080',
      loopbackOnly: true,
    },
    cloudflared: { found: true, version: '2026.8.0' },
    serviceMode: 'launchd-preview',
    autoTunnelEnabled: false,
    ...overrides,
  }
}

function inspection(overrides: Partial<CloudflareInspectionSnapshot> = {}): CloudflareInspectionSnapshot {
  return {
    zone: { id: 'zone-1', name: 'acme.com', accountId: 'account-1' },
    tunnels: [],
    dnsRecords: [],
    identityProviders: [],
    accessApps: [],
    policies: [],
    ...overrides,
  }
}

function buildInput(overrides: Partial<BuildCloudflareSetupPlanInput> = {}): BuildCloudflareSetupPlanInput {
  return {
    preflight: preflight(),
    target: {
      hostname: 'remote.acme.com',
      tunnelName: 'dsh-remote-acme',
      accessAppName: 'DSH Remote - remote.acme.com',
      includeRemote: false,
      emailHash: 'secret-free-email-fingerprint',
    },
    inspection: inspection(),
    ...overrides,
  }
}

function request(credential: SetupPlanRequest['credential'] = { source: 'request', token: TOKEN }): SetupPlanRequest {
  return {
    hostname: 'remote.acme.com',
    email: EMAIL,
    credential,
    includeRemote: false,
  }
}

function fakeReadApi(overrides: Partial<CloudflareReadApi> = {}): CloudflareReadApi {
  return {
    verifyToken: async () => {},
    listZones: async () => [{ id: 'zone-1', name: 'acme.com', accountId: 'account-1' }],
    listTunnels: async () => [],
    listDnsRecords: async () => [],
    listIdentityProviders: async () => [],
    listAccessApps: async () => [],
    listAccessPolicies: async () => [],
    ...overrides,
  }
}

describe('pure Cloudflare setup planning', () => {
  it('defaults to /m, preserves Host, ends in 404, and stays non-executable', () => {
    const plan = buildCloudflareSetupPlan(buildInput())

    expect(plan).toMatchObject({
      readOnly: true,
      executionAvailable: false,
      canApply: false,
      includeRemote: false,
      publishedPaths: ['/m'],
      preservesExternalHost: true,
      cloudflarePermissions: { read: 'verified', write: 'unverified' },
    })
    expect(plan.ingress.rules).toEqual([
      {
        hostname: 'remote.acme.com',
        path: '^/m($|/.*)',
        service: 'http://127.0.0.1:3080',
        purpose: 'mobile-pairing',
      },
      { service: 'http_status:404', purpose: 'deny-all-other-paths' },
    ])
    expect(plan.ingress.finalCatchAll).toBe('http_status:404')
    expect(plan.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'execution-unavailable',
      'mobile-ingress-not-ready',
    ]))
    expect(plan.blockers.find(blocker => blocker.code === 'mobile-ingress-not-ready')?.message)
      .toContain('/api/pair/accept')
    expect(plan.actions.find(action => action.id === 'credentials')?.operation).toBe('write')
  })

  it('adds /remote only as an explicit transport-only opt-in', () => {
    const input = buildInput()
    input.target.includeRemote = true
    const plan = buildCloudflareSetupPlan(input)

    expect(plan.publishedPaths).toEqual(['/m', '/remote'])
    expect(plan.ingress.rules[1]).toMatchObject({
      path: '^/remote($|/.*)',
      purpose: 'remote-transport-only',
    })
    expect(plan.blockers.map(blocker => blocker.code)).toContain('remote-transport-only')
    expect(plan.ingress.rules.at(-1)).toEqual({ service: 'http_status:404', purpose: 'deny-all-other-paths' })
  })

  it('keeps autoTunnel unchanged and reports local readiness blockers', () => {
    const plan = buildCloudflareSetupPlan(buildInput({
      preflight: preflight({
        dsh: { host: '0.0.0.0', port: 3080, localOrigin: 'http://127.0.0.1:3080', loopbackOnly: false },
        cloudflared: { found: false },
        autoTunnelEnabled: true,
      }),
    }))

    expect(plan.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'dsh-not-loopback',
      'cloudflared-not-found',
      'auto-tunnel-active',
    ]))
    expect(plan.warnings.join(' ')).toContain('does not stop or reconfigure autoTunnel')
  })

  it('previews launchd on Darwin and structured manual service steps on Windows', () => {
    const darwin = buildCloudflareSetupPlan(buildInput())
    const windows = buildCloudflareSetupPlan(buildInput({
      preflight: preflight({ platform: 'win32', serviceMode: 'manual-preview' }),
    }))

    expect(darwin.service).toMatchObject({ mode: 'launchd-preview', platform: 'darwin' })
    expect(darwin.service.steps.map(step => step.id)).toContain('write-plist')
    expect(windows.service).toMatchObject({ mode: 'manual-preview', platform: 'win32' })
    expect(windows.service.steps.map(step => step.id)).toEqual([
      'write-config-manually',
      'install-service-manually',
      'verify-manually',
    ])
  })

  it('makes planId stable for canonical facts and sensitive to inspection changes', () => {
    const facts = inspection({
      tunnels: [
        { id: 'tunnel-b', name: 'other', configSrc: 'local' },
        { id: 'tunnel-a', name: 'dsh-remote-acme', configSrc: 'local' },
      ],
      identityProviders: [
        { id: 'idp-b', name: 'Other', type: 'github' },
        { id: 'idp-a', name: 'PIN', type: 'onetimepin' },
      ],
    })
    const reordered = inspection({
      tunnels: [...facts.tunnels].reverse(),
      identityProviders: [...facts.identityProviders].reverse(),
    })
    const first = buildCloudflareSetupPlan(buildInput({ inspection: facts }))
    const second = buildCloudflareSetupPlan(buildInput({ inspection: reordered }))
    const changed = buildCloudflareSetupPlan(buildInput({
      inspection: inspection({
        ...facts,
        tunnels: facts.tunnels.map(tunnel => tunnel.id === 'tunnel-a' ? { ...tunnel, id: 'tunnel-new' } : tunnel),
      }),
    }))

    expect(first.planId).toMatch(/^[a-f0-9]{64}$/)
    expect(second.planId).toBe(first.planId)
    expect(changed.planId).not.toBe(first.planId)
  })

  it('never treats a tunnel with an unknown management source as reusable', () => {
    const plan = buildCloudflareSetupPlan(buildInput({
      inspection: inspection({ tunnels: [{ id: 'tunnel-1', name: 'dsh-remote-acme' }] }),
    }))

    expect(plan.actions.find(action => action.id === 'tunnel')?.operation).toBe('manual')
    expect(plan.actions.find(action => action.id === 'credentials')?.operation).toBe('manual')
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: 'resource-conflict' }))
  })

  it('reuses only one exact local tunnel, CNAME, OTP provider, Access app, and policy', () => {
    const plan = buildCloudflareSetupPlan(buildInput({
      inspection: inspection({
        tunnels: [{ id: 'tunnel-1', name: 'dsh-remote-acme', configSrc: 'local' }],
        dnsRecords: [{
          id: 'dns-1',
          type: 'CNAME',
          name: 'remote.acme.com',
          content: 'tunnel-1.cfargotunnel.com',
          proxied: true,
        }],
        identityProviders: [{ id: 'idp-1', name: 'One-time PIN', type: 'onetimepin' }],
        accessApps: [{
          id: 'app-1',
          name: 'DSH Remote - remote.acme.com',
          domain: 'remote.acme.com',
          type: 'self_hosted',
          destinations: [{ type: 'public', uri: 'remote.acme.com' }],
          allowedIdps: ['idp-1'],
          autoRedirectToIdentity: true,
        }],
        policies: [{
          appId: 'app-1',
          id: 'policy-1',
          name: 'Exact owner OTP',
          fingerprint: 'policy-fingerprint',
          exactEmailOtpId: 'idp-1',
        }],
      }),
    }))

    expect(Object.fromEntries(plan.actions.map(action => [action.id, action.operation]))).toMatchObject({
      tunnel: 'reuse',
      credentials: 'manual',
      dns: 'reuse',
      'otp-idp': 'reuse',
      'access-app': 'reuse',
      'access-policy': 'reuse',
    })
    expect(plan.blockers.map(blocker => blocker.code)).not.toContain('resource-conflict')
  })

  it('marks existing non-exact DNS, app, and policy resources for manual resolution', () => {
    const plan = buildCloudflareSetupPlan(buildInput({
      inspection: inspection({
        tunnels: [{ id: 'tunnel-1', name: 'dsh-remote-acme', configSrc: 'local' }],
        dnsRecords: [{
          id: 'dns-wrong-host',
          type: 'CNAME',
          name: 'other.acme.com',
          content: 'tunnel-1.cfargotunnel.com',
          proxied: true,
        }],
        identityProviders: [
          { id: 'idp-1', name: 'One-time PIN A', type: 'onetimepin' },
          { id: 'idp-2', name: 'One-time PIN B', type: 'onetimepin' },
        ],
        accessApps: [{
          id: 'app-1',
          name: 'Existing app',
          domain: 'remote.acme.com',
          type: 'self_hosted',
          destinations: [{ type: 'public', uri: 'remote.acme.com' }],
          allowedIdps: [],
          autoRedirectToIdentity: false,
        }],
        policies: [{
          appId: 'app-1',
          id: 'policy-1',
          name: 'Wrong policy',
          fingerprint: 'wrong-policy',
        }],
      }),
    }))
    const operations = Object.fromEntries(plan.actions.map(action => [action.id, action.operation]))

    expect(operations).toMatchObject({ dns: 'manual', 'otp-idp': 'manual', 'access-app': 'manual', 'access-policy': 'manual' })
    expect(plan.blockers.map(blocker => blocker.code)).toContain('resource-conflict')
  })

  it('propagates ambiguous prerequisites without previewing dependent creates', () => {
    const plan = buildCloudflareSetupPlan(buildInput({
      inspection: inspection({
        tunnels: [
          { id: 'tunnel-1', name: 'dsh-remote-acme', configSrc: 'local' },
          { id: 'tunnel-2', name: 'dsh-remote-acme', configSrc: 'local' },
        ],
        identityProviders: [
          { id: 'idp-1', name: 'One-time PIN A', type: 'onetimepin' },
          { id: 'idp-2', name: 'One-time PIN B', type: 'onetimepin' },
        ],
      }),
    }))
    const operations = Object.fromEntries(plan.actions.map(action => [action.id, action.operation]))

    expect(operations).toMatchObject({
      tunnel: 'manual',
      credentials: 'manual',
      dns: 'manual',
      'otp-idp': 'manual',
      'access-app': 'manual',
      'access-policy': 'manual',
    })
  })
})

describe('read-only collector and factory', () => {
  it.each([
    ['0.0.0.0', 'http://127.0.0.1:3080', false],
    ['::', 'http://127.0.0.1:3080', false],
    ['localhost', 'http://localhost:3080', true],
    ['127.0.0.2', 'http://127.0.0.2:3080', true],
    ['::1', 'http://[::1]:3080', true],
    ['[::1]', 'http://[::1]:3080', true],
  ] as const)('builds an accessible loopback authority for host %s', async (host, origin, loopbackOnly) => {
    const planner = createCloudflareSetupPlanner({
      host,
      port: 3080,
      config: () => ({}),
      platform: 'linux',
      cloudflaredProbe: async () => ({ found: true }),
      readApiFactory: () => fakeReadApi(),
    })

    expect(planner.localOrigin).toBe(origin)
    await expect(planner.preflight()).resolves.toMatchObject({
      preflight: { dsh: { localOrigin: origin, loopbackOnly } },
    })
  })

  it('normalizes the default HTTP port for the browser Origin fence', () => {
    const planner = createCloudflareSetupPlanner({
      host: '127.0.0.1',
      port: 80,
      config: () => ({}),
      platform: 'linux',
      cloudflaredProbe: async () => ({ found: true }),
      readApiFactory: () => fakeReadApi(),
    })

    expect(planner.localOrigin).toBe('http://127.0.0.1')
  })

  it('uses the request token only to build the read client and omits token/email from the response', async () => {
    const calls: string[] = []
    let collectedToken = ''
    const api = fakeReadApi({
      verifyToken: async () => { calls.push('verify') },
      listZones: async () => { calls.push('zones'); return [{ id: 'zone-1', name: 'acme.com', accountId: 'account-1' }] },
      listTunnels: async () => { calls.push('tunnels'); return [] },
      listDnsRecords: async () => { calls.push('dns'); return [] },
      listIdentityProviders: async () => { calls.push('idps'); return [] },
      listAccessApps: async () => { calls.push('apps'); return [] },
    })
    const planner = createCloudflareSetupPlanner({
      host: '127.0.0.1',
      port: 3080,
      config: () => ({ autoTunnel: true }),
      platform: 'darwin',
      cloudflaredProbe: async () => ({ found: false }),
      readApiFactory: token => { collectedToken = token; return api },
    })

    const response = await planner.plan(request())
    expect(collectedToken).toBe(TOKEN)
    expect(calls).toEqual(expect.arrayContaining(['verify', 'zones', 'tunnels', 'dns', 'idps', 'apps']))
    expect(response.plan.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining([
      'cloudflared-not-found',
      'auto-tunnel-active',
    ]))
    const wire = JSON.stringify(response)
    expect(wire).not.toContain(TOKEN)
    expect(wire).not.toContain(EMAIL)
  })

  it('keeps planId stable when only the in-memory request token changes', async () => {
    const planner = createCloudflareSetupPlanner({
      host: '127.0.0.1',
      port: 3080,
      config: () => ({}),
      platform: 'darwin',
      cloudflaredProbe: async () => ({ found: true }),
      readApiFactory: () => fakeReadApi(),
    })

    const first = await planner.plan(request({ source: 'request', token: TOKEN }))
    const second = await planner.plan(request({ source: 'request', token: 'cf_other_token_12345678901234567890' }))
    expect(second.plan.planId).toBe(first.plan.planId)
  })

  it('resolves a Keychain reference before constructing the token-holding read client', async () => {
    const references: Array<{ service: string; account?: string }> = []
    let collectedToken = ''
    const planner = createCloudflareSetupPlanner({
      host: '127.0.0.1',
      port: 3080,
      config: () => ({}),
      platform: 'darwin',
      cloudflaredProbe: async () => ({ found: true }),
      keychainReader: async reference => { references.push(reference); return TOKEN },
      readApiFactory: token => { collectedToken = token; return fakeReadApi() },
    })

    const response = await planner.plan(request({ source: 'keychain', service: 'dsh-cloudflare', account: 'setup' }))
    expect(references).toEqual([{ service: 'dsh-cloudflare', account: 'setup' }])
    expect(collectedToken).toBe(TOKEN)
    expect(JSON.stringify(response)).not.toContain(TOKEN)
  })

  it('uses fixed security argv for the default macOS Keychain reader', async () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = []
    const planner = createCloudflareSetupPlanner({
      host: '127.0.0.1',
      port: 3080,
      config: () => ({}),
      platform: 'darwin',
      cloudflaredProbe: async () => ({ found: true }),
      processRunner: async (executable, args) => {
        calls.push({ executable, args })
        return { code: 0, stdout: `${TOKEN}\n`, stderr: '' }
      },
      readApiFactory: () => fakeReadApi(),
    })

    await planner.plan(request({ source: 'keychain', service: 'dsh-cloudflare', account: 'setup' }))
    expect(calls).toEqual([{
      executable: '/usr/bin/security',
      args: ['find-generic-password', '-s', 'dsh-cloudflare', '-a', 'setup', '-w'],
    }])
  })

  it('throws a stable API error only when a Cloudflare snapshot cannot be formed', async () => {
    const planner = createCloudflareSetupPlanner({
      host: '0.0.0.0',
      port: 3080,
      config: () => ({ autoTunnel: true }),
      platform: 'win32',
      cloudflaredProbe: async () => ({ found: false }),
      readApiFactory: () => fakeReadApi({ listZones: async () => [] }),
    })

    const failure = planner.plan(request())
    await expect(failure).rejects.toBeInstanceOf(SetupPlanError)
    await expect(failure).rejects.toMatchObject({
      code: 'zone-not-found',
      field: 'hostname',
      retryable: false,
    })
  })
})

describe('Cloudflare GET-only client', () => {
  it('uses GET and paginates from total_count/per_page without total_pages', async () => {
    const calls: Array<{ url: string; method: string | undefined; authorization: string | undefined }> = []
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url, method: init?.method, authorization: headers.get('authorization') ?? undefined })
      if (url.endsWith('/user/tokens/verify')) {
        return Response.json({ success: true, result: { status: 'active' } })
      }
      const page = new URL(url).searchParams.get('page')
      return Response.json({
        success: true,
        result: [{ id: `tunnel-${page ?? '1'}`, name: 'dsh-remote-acme', config_src: 'local' }],
        result_info: { page: Number(page ?? '1'), per_page: 1, count: 1, total_count: 2 },
      })
    }) as typeof fetch
    const api = new CloudflareHttpReadApi(TOKEN, fetchFn)

    await api.verifyToken()
    const tunnels = await api.listTunnels('account-1', 'dsh-remote-acme')
    await Promise.all([
      api.listZones(),
      api.listDnsRecords('zone-1', 'remote.acme.com'),
      api.listIdentityProviders('account-1'),
      api.listAccessApps('account-1'),
      api.listAccessPolicies('account-1', 'app-1'),
    ])

    expect(tunnels.map(tunnel => tunnel.id)).toEqual(['tunnel-1', 'tunnel-2'])
    expect(calls).toHaveLength(13)
    expect(calls.every(call => call.method === 'GET')).toBe(true)
    expect(calls.every(call => call.authorization === `Bearer ${TOKEN}`)).toBe(true)
    expect(calls.some(call => call.url.includes('/zones?'))).toBe(true)
    expect(calls.some(call => call.url.includes('/cfd_tunnel?'))).toBe(true)
    expect(calls.some(call => call.url.includes('/dns_records?'))).toBe(true)
    expect(calls.some(call => call.url.includes('/access/identity_providers?'))).toBe(true)
    expect(calls.some(call => call.url.includes('/access/apps?'))).toBe(true)
    expect(calls.some(call => call.url.includes('/access/apps/app-1/policies?'))).toBe(true)
    expect(calls.filter(call => call.url.includes('/cfd_tunnel?')).at(-1)?.url).toContain('page=2')
  })

  it('fails instead of planning from a snapshot truncated at the pagination safety limit', async () => {
    let calls = 0
    const fetchFn = (async (): Promise<Response> => {
      calls += 1
      return Response.json({
        success: true,
        result: [{ id: `zone-${String(calls)}`, name: 'acme.com', account: { id: 'account-1' } }],
        result_info: { page: calls, per_page: 100, count: 1, total_count: 5_001 },
      })
    }) as typeof fetch
    const api = new CloudflareHttpReadApi(TOKEN, fetchFn)

    const failure = api.listZones()
    await expect(failure).rejects.toBeInstanceOf(SetupPlanError)
    await expect(failure).rejects.toMatchObject({ code: 'cloudflare-unavailable', retryable: true })
    expect(calls).toBe(50)
  })
})
