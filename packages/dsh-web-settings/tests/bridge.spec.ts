/**
 * Bridge handler behavior: allowlist-gated describe, allowlist-gated mutate,
 * revision conflicts, the official-shaped refusal envelopes the client
 * controller understands, and the profile-entry-id mapping the new settings
 * surface needs (its descriptors are keyed by entry id, the family plugins
 * bind by settings namespace).
 *
 * test-standards-allow: bridge handler and route unit tests over synthetic settings surfaces
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import type { SettingsForms, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { isTrustedBridgeRequest, makeBridgeHandlers, makeBridgeRoutes, WEB_UI_SETTINGS_PROXY_TOKEN_HEADER } from '../src/bridge.ts'
import type { BridgeProfileEntry } from '../src/bridge.ts'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../src/protocol.ts'

/** One fake settings registration the fake surface serves, keyed by profile entry id. */
interface FakeRegistration {
  value: Record<string, unknown>
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  revision: number
}

/** One fake profile row: the shape the Host config editor reports. */
interface FakeRow {
  /** Profile entry id (the settings namespace of the new surface). */
  id: string
  /** Package the row loads, as the profile patch spells it. */
  name?: string
  /** Client package an aggregate row carries. */
  plugin?: string
}

/** The rows a family aggregate install produces (one per mounted subplugin). */
const AGGREGATE_ROWS: FakeRow[] = [
  { id: 'web-ui-task-board', name: '@linxin666/dsh-web-all/task-board', plugin: '@linxin666/dsh-client-ui-task-board' },
  { id: 'web-ui-skin-center', name: '@linxin666/dsh-web-all/skin-center', plugin: '@linxin666/dsh-client-ui-skin-center' },
  { id: 'web-ui-pet', name: '@linxin666/dsh-web-all/pet', plugin: '@linxin666/dsh-client-ui-pet' },
]

/** Project fake rows onto the shape the bridge reads. */
function rows(entries: FakeRow[]): BridgeProfileEntry[] {
  return entries.map(row => ({
    options: {
      id: row.id,
      ...row.name === undefined ? {} : { name: row.name },
      ...row.plugin === undefined ? {} : { config: { plugin: row.plugin } },
    },
  }))
}

/** A minimal in-memory settings surface shaped like the official SettingsForms service. */
function fakeSettings(registrations: Record<string, FakeRegistration>) {
  let nextFailure: Error | undefined
  const writes: Array<{ ns: string; ops: unknown[]; expectedRevision?: number }> = []
  const seam = {
    writable: true,
    describe: (_options?: { redactSecrets?: boolean }) => Object.entries(registrations).map(([ns, entry]) => ({
      ns,
      autoGenerate: true,
      schema: { type: 'object' },
      value: entry.value,
      revision: entry.revision,
      applies: 'live' as const,
      ...entry.base === undefined ? {} : { base: entry.base },
      ...entry.user === undefined ? {} : { user: entry.user },
    })),
    mutate: async (ns: string, ops: unknown[], expectedRevision?: number) => {
      writes.push({ ns, ops, expectedRevision })
      if (nextFailure !== undefined) {
        const failure = nextFailure
        nextFailure = undefined
        throw failure
      }
      const entry = registrations[ns]
      if (entry === undefined) throw new Error('No configurable plugin entry "' + ns + '"')
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

/** Build the bridge deps for one fake surface and profile roster. */
function deps(seam: unknown, entries: FakeRow[] | undefined, readSettingsYaml: () => string = () => '') {
  return {
    settings: seam as SettingsForms,
    readSettingsYaml,
    ...entries === undefined ? {} : { entries: () => rows(entries) },
  }
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
      'web-ui-task-board': { value: { enabled: true }, revision: 1 },
      'web-ui-pet': { value: { visible: true }, revision: 2 },
      'web-search-deepseek': { value: { provider: 'exa' }, revision: 3 },
    })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.namespaces.map(view => [view.ns, view.entryId])).toEqual([
      ['pet', 'web-ui-pet'],
      ['task-board', 'web-ui-task-board'],
    ])
    expect(result.value.writable).toBe(true)
  })

  it('maps user package names onto their namespaces', async () => {
    const { seam } = fakeSettings({
      'web-ui-task-board': { value: { enabled: true }, revision: 1 },
      'web-ui-skin-center': { value: { backgroundOpacity: 0.5 }, revision: 2 },
      'web-ui-pet': { value: { visible: true }, revision: 3 },
    })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS, userYaml))
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // dsh-web owns no namespace and must be ignored.
    expect(result.value.namespaces.map(view => [view.ns, view.entryId])).toEqual([
      ['skin-background', 'web-ui-skin-center'],
      ['task-board', 'web-ui-task-board'],
    ])
  })

  it('traces a standalone install through the row package name alone', async () => {
    const { seam } = fakeSettings({ 'ui-task-board': { value: { enabled: true }, revision: 1 } })
    const handlers = makeBridgeHandlers(deps(seam, [{ id: 'ui-task-board', name: '@linxin666/dsh-client-ui-task-board' }]))
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.namespaces.map(view => [view.ns, view.entryId])).toEqual([['task-board', 'ui-task-board']])
  })

  it('serves a namespace already keyed by its family name without an entry id', async () => {
    // A Host whose descriptors are still keyed by the family namespace
    // (no profile entry id to resolve): the namespace stays served, and the
    // client keeps the bridge transport.
    const { seam } = fakeSettings({ 'task-board': { value: { enabled: true }, revision: 1 } })
    for (const entries of [undefined, [] as FakeRow[]]) {
      const handlers = makeBridgeHandlers(deps(seam, entries))
      const result = await handlers.describe()
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.namespaces).toHaveLength(1)
      expect(result.value.namespaces[0].ns).toBe('task-board')
      expect(result.value.namespaces[0].entryId).toBeUndefined()
    }
  })

  it('serves every sub-namespace one entry declares, not only the first (#1755)', async () => {
    // The skin center registers ONE profile row whose Config nests three
    // sub-namespaces. The Host serves one descriptor for that row, keyed by the
    // entry id, so the family cards addressing 'skin-wallpaper' and
    // 'skin-custom-theme' must resolve through the same entry id — otherwise
    // the allowlist could never intersect them in and every write to them was
    // refused as settings-not-exposed.
    const { seam } = fakeSettings({
      'web-ui-skin-center': {
        value: {
          'skin-background': { enabled: true, backgroundOpacity: 0 },
          'skin-custom-theme': { version: 1, applied: false },
          'skin-wallpaper': { enabled: true, selection: '2907017628' },
        },
        revision: 1,
      },
    })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.describe()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.namespaces.map(view => [view.ns, view.entryId])).toEqual([
      ['skin-background', 'web-ui-skin-center'],
      ['skin-custom-theme', 'web-ui-skin-center'],
      ['skin-wallpaper', 'web-ui-skin-center'],
    ])
  })

  it('writes a declared sub-namespace through its own entry id (#1755)', async () => {
    const { seam, writes } = fakeSettings({
      'web-ui-skin-center': {
        value: {
          'skin-background': { enabled: true },
          'skin-wallpaper': { enabled: true, selection: '2907017628' },
        },
        revision: 2,
      },
    })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.mutate({
      ns: 'skin-wallpaper',
      ops: [{ op: 'set', path: ['skin-wallpaper', 'enabled'], value: false }],
      expectedRevision: 2,
    })
    // The Host knows only the entry id; the bridge owns the namespace prefix.
    expect(writes).toEqual([{
      ns: 'web-ui-skin-center',
      ops: [{ op: 'set', path: ['skin-wallpaper', 'enabled'], value: false }],
      expectedRevision: 2,
    }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ns).toBe('skin-wallpaper')
    expect(result.value.entryId).toBe('web-ui-skin-center')
  })

  it('returns an empty list when nothing on the allowlist is registered', async () => {
    const { seam } = fakeSettings({ 'web-search-deepseek': { value: {}, revision: 1 } })
    const handlers = makeBridgeHandlers(deps(seam, []))
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
    const handlers = makeBridgeHandlers(deps(seam, []))
    const result = await handlers.mutate({ ns: 'web-search-deepseek', ops: [{ op: 'set', path: ['provider'], value: 'x' }] })
    expect(result).toEqual({
      ok: false,
      code: 'settings-not-exposed',
      message: 'settings namespace "web-search-deepseek" is not exposed to configuration clients',
    })
    expect(writes).toEqual([])
  })

  it('writes through the resolved profile entry id and returns the namespace view', async () => {
    const { seam, writes } = fakeSettings({
      'web-ui-task-board': { value: { enabled: true }, revision: 4 },
    })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.mutate({
      ns: 'task-board',
      ops: [{ op: 'set', path: ['enabled'], value: false }],
      expectedRevision: 4,
    })
    // The Host writes by entry id, never by the family namespace.
    expect(writes).toEqual([{ ns: 'web-ui-task-board', ops: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 4 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ns).toBe('task-board')
    expect(result.value.entryId).toBe('web-ui-task-board')
    expect(result.value.value).toEqual({ enabled: false })
    expect(result.value.revision).toBe(5)
  })

  it('maps a revision conflict onto the settings-conflict envelope', async () => {
    const { seam } = fakeSettings({
      'web-ui-task-board': { value: { enabled: true }, revision: 4 },
    })
    seam.armFailure(new SettingsConflictError('web-ui-task-board' as unknown as SettingsNamespace, 4, 6))
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.mutate({ ns: 'task-board', ops: [{ op: 'set', path: ['enabled'], value: false }], expectedRevision: 4 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('settings-conflict')
  })

  it('maps a disposed entry onto the settings-rejected envelope', async () => {
    const { seam } = fakeSettings({ 'web-ui-task-board': { value: {}, revision: 1 } })
    seam.armFailure(new Error('No configurable plugin entry "web-ui-task-board"'))
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.mutate({ ns: 'task-board', ops: [{ op: 'unset', path: ['enabled'] }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('settings-rejected')
    expect(result.message).toContain('No configurable plugin entry')
  })

  it('rejects a malformed body', async () => {
    const { seam, writes } = fakeSettings({ 'web-ui-task-board': { value: {}, revision: 1 } })
    const handlers = makeBridgeHandlers(deps(seam, AGGREGATE_ROWS))
    const result = await handlers.mutate({ ns: 42 })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('settings-rejected')
    expect(writes).toEqual([])
  })
})

/** One fake IncomingMessage: loopback socket + Host, optional raw body. */
function fakeRouteRequest(rawBody?: string): { req: IncomingMessage; destroy: ReturnType<typeof vi.fn> } {
  const destroy = vi.fn()
  const req = {
    method: 'POST',
    url: WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {
      host: '127.0.0.1:3080',
      ...(rawBody === undefined ? {} : { 'content-type': 'application/json' }),
    },
    destroy,
    ...(rawBody === undefined ? {} : {
      [Symbol.asyncIterator]: async function* iterate() {
        if (rawBody !== '') yield Buffer.from(rawBody)
      },
    }),
  } as unknown as IncomingMessage
  return { req, destroy }
}

/** One fake ServerResponse capturing status/headers/body. */
function fakeRouteResponse(): { res: ServerResponse; state: { status: number; headers: Record<string, unknown>; body: string } } {
  const state = { status: 0, headers: {} as Record<string, unknown>, body: '' }
  const res = {
    writeHead(status: number, headers: Record<string, unknown> = {}) {
      state.status = status
      state.headers = headers
    },
    end(payload?: string) { state.body = payload ?? '' },
  } as unknown as ServerResponse
  return { res, state }
}

/** The /mutate route of a bridge table over a surface that always accepts writes. */
function mutateRoute() {
  const routes = makeBridgeRoutes({
    settings: { describe: () => [], writable: true, mutate: async () => {} } as unknown as SettingsForms,
    readSettingsYaml: () => '',
  })
  return routes.find(route => route.path === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate')!
}

describe('mutate route json body failure contract', () => {
  it('user posting invalid JSON gets 400 settings-rejected and the request is not destroyed', async () => {
    // Given: a loopback /mutate request whose body is not JSON
    const { req, destroy } = fakeRouteRequest('{not json')

    // When: the route handler reads the body
    const { res, state } = fakeRouteResponse()
    await mutateRoute().handler(req, res)

    // Then: the refusal envelope answers and the connection stays up
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('user posting an empty body gets 400 settings-rejected and the request is not destroyed', async () => {
    // Given: a loopback /mutate request with no bytes to read
    const { req, destroy } = fakeRouteRequest('')

    // When: the route handler reads the body
    const { res, state } = fakeRouteResponse()
    await mutateRoute().handler(req, res)

    // Then: the refusal envelope answers and the connection stays up
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).not.toHaveBeenCalled()
  })

  it('user posting a body past the 64 KiB default cap gets 400 and the request is destroyed', async () => {
    // Given: a loopback /mutate request one byte past the reader's default cap
    const { req, destroy } = fakeRouteRequest('x'.repeat(64 * 1024 + 1))

    // When: the route handler reads the body
    const { res, state } = fakeRouteResponse()
    await mutateRoute().handler(req, res)

    // Then: the refusal envelope answers and the shared reader tore the connection down
    expect(state.status).toBe(400)
    expect(JSON.parse(state.body)).toEqual({ ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('user reading the 400 refusal sees the family JSON headers', async () => {
    // Given: a loopback /mutate request with an unreadable body
    const { req, destroy } = fakeRouteRequest('{not json')

    // When: the route handler answers it
    const { res, state } = fakeRouteResponse()
    await mutateRoute().handler(req, res)

    // Then: the shared writer's family headers are on the response
    expect(state.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(state.headers['referrer-policy']).toBe('no-referrer')
    expect(destroy).not.toHaveBeenCalled()
  })

  it('operator exposes the bridge routes with anonymous webserver auth so its own fence decides', () => {
    // Given: the settings bridge routes with their own loopback and proxy-token fence
    const deps = {
      settings: { describe: () => [], writable: true, mutate: async () => {} } as unknown as SettingsForms,
      readSettingsYaml: () => '',
    }

    // When: the bridge route table is constructed
    const routes = makeBridgeRoutes(deps)

    // Then: every route opts out of webserver default auth: required so trusted proxy requests reach the fence
    expect(routes.map(route => route.auth)).toEqual(['anonymous', 'anonymous'])
  })
})
