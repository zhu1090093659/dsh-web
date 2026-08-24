/**
 * Bridge handler behavior: allowlist-gated describe, allowlist-gated mutate,
 * revision conflicts, and the official-shaped refusal envelopes the client
 * controller understands.
 */

import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace, SettingsProvider } from '@deepseek-ai/dsh-settings'
import { isTrustedBridgeRequest, makeBridgeHandlers, WEB_UI_SETTINGS_PROXY_TOKEN_HEADER } from '../src/bridge.ts'

/** One fake settings registration the fake seam serves. */
interface FakeRegistration {
  value: Record<string, unknown>
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  revision: number
}

/** A minimal in-memory settings seam shaped like the official provider. */
function fakeSettings(registrations: Record<string, FakeRegistration>) {
  let nextFailure: Error | undefined
  const writes: Array<{ ns: string; ops: unknown[]; expectedRevision?: number }> = []
  const seam = {
    writable: true,
    describe: () => Object.entries(registrations).map(([ns, entry]) => ({
      ns,
      schema: { type: 'object' },
      value: entry.value,
      revision: entry.revision,
      ...entry.base === undefined ? {} : { base: entry.base },
      ...entry.user === undefined ? {} : { user: entry.user },
      applies: 'immediate',
    })),
    mutate: async (ns: SettingsNamespace, ops: unknown[], expectedRevision?: number) => {
      writes.push({ ns: String(ns), ops, expectedRevision })
      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        throw failure
      }
      const entry = registrations[String(ns)]
      if (entry === undefined) throw new Error('settings namespace "' + String(ns) + '" is not registered')
      entry.revision += 1
      for (const op of ops as Array<{ op: string; path: string[]; value?: unknown }>) {
        const parent = op.path.slice(0, -1).reduce((acc: Record<string, unknown>, key) => acc[key] as Record<string, unknown>, entry.value)
        if (op.op === 'set') parent[op.path[op.path.length - 1]] = op.value
        else delete parent[op.path[op.path.length - 1]]
      }
    },
    armFailure: (error: Error) => { nextFailure = error },
  }
  return { seam, writes }
}

const userYaml = (): string => [
  'web_settings_namespaces:',
  '  - dsh-client-ui-task-board',
  '  - dsh-skins',
  '  - dsh-web',
].join('\n')

/** Minimal request facts consumed by the bridge trust fence. */
function request(options: {
  address?: string
  host?: string
  origin?: string
  fetchSite?: string
  proxyToken?: string
} = {}): IncomingMessage {
  const headers: Record<string, string> = { host: options.host ?? '127.0.0.1:3080' }
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.fetchSite !== undefined) headers['sec-fetch-site'] = options.fetchSite
  if (options.proxyToken !== undefined) headers[WEB_UI_SETTINGS_PROXY_TOKEN_HEADER] = options.proxyToken
  return {
    socket: { remoteAddress: options.address ?? '127.0.0.1' },
    headers,
  } as unknown as IncomingMessage
}

describe('bridge request trust', () => {
  const proxyAccess = { trustedProxyHosts: ['dsh.example.test'], proxyToken: 'test-proxy-token' }

  it('keeps direct loopback access without proxy config', () => {
    expect(isTrustedBridgeRequest(request())).toBe(true)
    expect(isTrustedBridgeRequest(request({ host: 'localhost:3080', origin: 'http://localhost:3080' }))).toBe(true)
  })

  it('denies a domain Host by default', () => {
    expect(isTrustedBridgeRequest(request({
      host: 'dsh.example.test',
      origin: 'https://dsh.example.test',
      proxyToken: 'test-proxy-token',
    }))).toBe(false)
  })

  it('admits an authenticated same-origin request from the local proxy', () => {
    expect(isTrustedBridgeRequest(request({
      host: 'dsh.example.test',
      origin: 'https://dsh.example.test',
      fetchSite: 'same-origin',
      proxyToken: 'test-proxy-token',
    }), proxyAccess)).toBe(true)
  })

  it.each([
    ['non-loopback proxy socket', { address: '192.0.2.10', host: 'dsh.example.test', origin: 'https://dsh.example.test', proxyToken: 'test-proxy-token' }],
    ['unknown Host', { host: 'other.example.test', origin: 'https://other.example.test', proxyToken: 'test-proxy-token' }],
    ['mismatched Origin', { host: 'dsh.example.test', origin: 'https://other.example.test', proxyToken: 'test-proxy-token' }],
    ['cross-site marker', { host: 'dsh.example.test', origin: 'https://dsh.example.test', fetchSite: 'cross-site', proxyToken: 'test-proxy-token' }],
    ['missing proxy token', { host: 'dsh.example.test', origin: 'https://dsh.example.test' }],
    ['wrong proxy token', { host: 'dsh.example.test', origin: 'https://dsh.example.test', proxyToken: 'wrong-token' }],
  ])('denies %s', (_label, options) => {
    expect(isTrustedBridgeRequest(request(options), proxyAccess)).toBe(false)
  })

  it('rejects non-canonical trusted proxy authorities at mount time', () => {
    for (const authority of [
      'https://dsh.example.test/path',
      'user@dsh.example.test',
      'dsh.example.test:08080',
      'dsh.example.test/path',
    ]) {
      expect(() => isTrustedBridgeRequest(request(), {
        trustedProxyHosts: [authority],
        proxyToken: 'test-proxy-token',
      })).toThrow(/canonical host\[:port\] authority/)
    }
  })

  it('rejects a non-canonical request Host even when it normalizes to a trusted Host', () => {
    expect(isTrustedBridgeRequest(request({
      host: 'dsh.example.test:08080',
      origin: 'https://dsh.example.test:8080',
      proxyToken: 'test-proxy-token',
    }), {
      trustedProxyHosts: ['dsh.example.test:8080'],
      proxyToken: 'test-proxy-token',
    })).toBe(false)
  })

  it('requires a token whenever proxy Hosts are configured', () => {
    expect(() => isTrustedBridgeRequest(request(), { trustedProxyHosts: ['dsh.example.test'] })).toThrow(/require a non-empty proxy token/)
  })
})

describe('bridge describe', () => {
  it('serves the built-in family allowlist when the user configured none', async () => {
    const { seam } = fakeSettings({
      'task-board': { value: { enabled: true }, revision: 1 },
      pet: { value: { visible: true }, revision: 2 },
      'web-search-deepseek': { value: { provider: 'exa' }, revision: 3 },
    })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.namespaces.map(view => view.ns)).toEqual(['pet', 'task-board'])
    expect(result.value.writable).toBe(true)
  })

  it('maps user package names onto their namespaces', async () => {
    const { seam } = fakeSettings({
      'task-board': { value: { enabled: true }, revision: 1 },
      'skin-background': { value: { backgroundOpacity: 0.5 }, revision: 2 },
      pet: { value: { visible: true }, revision: 3 },
    })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: userYaml })
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // dsh-web owns no namespace and must be ignored.
    expect(result.value.namespaces.map(view => view.ns)).toEqual(['skin-background', 'task-board'])
  })

  it('returns an empty list when nothing on the allowlist is registered', async () => {
    const { seam } = fakeSettings({ 'web-search-deepseek': { value: {}, revision: 1 } })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.namespaces).toEqual([])
  })
})

describe('bridge mutate', () => {
  it('refuses a namespace outside the allowlist with settings-not-exposed', async () => {
    const { seam, writes } = fakeSettings({
      'web-search-deepseek': { value: { provider: 'exa' }, revision: 1 },
    })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.mutate({ ns: 'web-search-deepseek', ops: [{ op: 'set', path: ['provider'], value: 'x' }] })
    expect(result).toEqual({
      ok: false,
      code: 'settings-not-exposed',
      message: 'settings namespace "web-search-deepseek" is not exposed to configuration clients',
    })
    expect(writes).toEqual([])
  })

  it('writes an allowlisted namespace and returns its fresh view', async () => {
    const { seam, writes } = fakeSettings({
      'task-board': { value: { enabled: true }, revision: 4 },
    })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.mutate({
      ns: 'task-board',
      ops: [{ op: 'set', path: ['enabled'], value: false }],
      expectedRevision: 4,
    })
    expect(writes).toEqual([{ ns: 'task-board', ops: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 4 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ns).toBe('task-board')
    expect(result.value.value).toEqual({ enabled: false })
    expect(result.value.revision).toBe(5)
  })

  it('maps a revision conflict onto the settings-conflict envelope', async () => {
    const { seam } = fakeSettings({
      'task-board': { value: { enabled: true }, revision: 4 },
    })
    seam.armFailure(new SettingsConflictError('task-board' as unknown as SettingsNamespace, 4, 6))
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.mutate({ ns: 'task-board', ops: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 4 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('settings-conflict')
  })

  it('rejects a malformed body', async () => {
    const { seam, writes } = fakeSettings({ 'task-board': { value: {}, revision: 1 } })
    const handlers = makeBridgeHandlers({ settings: seam as unknown as SettingsProvider, readSettingsYaml: () => '' })
    const result = await handlers.mutate({ ns: 42 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('settings-rejected')
    expect(writes).toEqual([])
  })
})
