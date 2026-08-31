/** @vitest-environment jsdom */

/**
 * Compatibility scope state machine: the official scope stays authoritative
 * while it serves the namespace; the bridge controller takes over its
 * unavailable state over same-origin fetch; writes route to the active
 * transport; and a missing fetch keeps the official unavailable behavior.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCompatScope } from '../src/client/compat-settings-scope.ts'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../src/protocol.ts'

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** A manual primary scope: a snapshot store plus recorded writes and loads. */
function fakePrimary<T>(initial: SettingsScopeSnapshot<T>) {
  const store = createSnapshotStore<SettingsScopeSnapshot<T>>(initial)
  const sets: Array<[string, unknown]> = []
  const loads: number[] = []
  return {
    scope: {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener: () => void) => store.subscribe(listener),
      set: async (field: string, value: unknown) => { sets.push([field, value]) },
      unset: async () => {},
      mutate: async () => {},
      load: async () => { loads.push(1) },
    } satisfies SettingsScope<T> & { load(): Promise<void> },
    update: (patch: Partial<SettingsScopeSnapshot<T>>) => { store.set({ ...store.getSnapshot(), ...patch }) },
    sets,
    loads,
  }
}

/** A bridge describe payload for one namespace. */
function bridgeView(ns: string, value: unknown, revision: number) {
  return { ns, schema: {}, value, revision }
}

/** The describe result the fake host bridge answers. */
function describeResult(namespaces: ReturnType<typeof bridgeView>[]) {
  return { ok: true, value: { namespaces, writable: true } }
}

/** A fetch stub serving the bridge route pair (the spy counts calls). */
function fakeFetch(handler: (url: string, init: RequestInit) => Promise<unknown> | unknown) {
  const spy = vi.fn(handler)
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const payload = await spy(url, init ?? {})
    return { ok: true, status: 200, json: async () => payload } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchFn, handler: spy }
}

const ready = <T>(value: T, revision = 1): SettingsScopeSnapshot<T> => ({
  status: 'ready',
  value,
  base: undefined,
  user: undefined,
  revision,
  writable: true,
  mode: 'host',
})

const unavailable = (): SettingsScopeSnapshot<never> => ({
  status: 'unavailable',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
})

describe('createCompatScope', () => {
  it('passes the official scope through while it serves the namespace', () => {
    const primary = fakePrimary<{ enabled: boolean }>(ready({ enabled: true }))
    const { fetchFn, handler } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    expect(scope.getSnapshot().status).toBe('ready')
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(handler).not.toHaveBeenCalled()
  })

  it('bridges the namespace when the official scope reports unavailable', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(unavailable())
    const { fetchFn, handler } = fakeFetch(async () => describeResult([bridgeView('task-board', { enabled: true }, 3)]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(scope.getSnapshot().revision).toBe(3)
    expect(scope.getSnapshot().writable).toBe(true)
    expect(handler).toHaveBeenCalled()
  })

  it('stays unavailable when the bridge does not serve the namespace', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(unavailable())
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('never builds a bridge when the caller provides no fetch', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(unavailable())
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('routes writes to the official scope while it is ready', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(ready({ enabled: true }))
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    await scope.set('enabled', false)
    expect(primary.sets).toEqual([['enabled', false]])
  })

  it('routes writes through the bridge when it took over', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(unavailable())
    const mutateCalls: Array<{ url: string; body: Record<string, unknown> }> = []
    const { fetchFn } = fakeFetch(async (url, init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') return describeResult([bridgeView('task-board', { enabled: true }, 3)])
      mutateCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return { ok: true, value: bridgeView('task-board', { enabled: false }, 4) }
    })
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    await scope.set('enabled', false)
    expect(mutateCalls).toHaveLength(1)
    expect(mutateCalls[0].url).toBe(WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate')
    expect(mutateCalls[0].body.ns).toBe('task-board')
    expect(mutateCalls[0].body.expectedRevision).toBe(3)
  })

  it('turns a dropped bridge call into a quiet unavailable', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(unavailable())
    const { fetchFn } = fakeFetch(async () => { throw new Error('network down') })
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
  })
})

/** A batch-capable bridge view: user layer plus redacted-secret markers. */
function batchView(ns: string, value: unknown, revision: number, extra: { user?: Record<string, unknown>; secrets?: { path: string[]; set: boolean }[] } = {}) {
  return {
    ns,
    schema: {},
    value,
    revision,
    ...extra.user === undefined ? {} : { user: extra.user },
    ...extra.secrets === undefined ? {} : { secrets: extra.secrets },
  }
}

describe('createCompatScope batch mutate', () => {
  it('exposes no batch result surface while the official scope serves the namespace without an official wire face', async () => {
    const primary = fakePrimary<{ enabled: boolean }>(ready({ enabled: true }))
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', primary: primary.scope, fetchFn })
    expect(scope.getSnapshot().status).toBe('ready')
    expect(typeof (scope as unknown as { mutateBatch?: unknown }).mutateBatch).not.toBe('function')
  })

  it('batches through the official wire while the official scope serves the namespace', async () => {
    const primary = fakePrimary<{ baseURL: string; model: string }>(ready({ baseURL: 'https://a/v1', model: 'm' }, 7))
    const calls: Array<Record<string, unknown>> = []
    const official = {
      mutate: async (request: Record<string, unknown>) => {
        calls.push(request)
        return {
          result: {
            ok: true as const,
            value: batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 8, { user: { baseURL: 'https://a/v1', model: 'm' } }),
          },
        }
      },
    }
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', primary: primary.scope, official })
    expect(scope.getSnapshot().status).toBe('ready')
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<unknown> }).mutateBatch
    expect(typeof mutateBatch).toBe('function')
    const result = await (mutateBatch as (writes: { field: string; op: 'set'; value: unknown }[]) => Promise<{ ok: boolean; fields: { field: string; landed: boolean }[] }>)([
      { field: 'baseURL', op: 'set', value: 'https://a/v1' },
      { field: 'model', op: 'set', value: 'm' },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].ns).toBe('describe-image')
    expect(calls[0].expectedRevision).toBe(7)
    expect(calls[0].ops).toEqual([
      { op: 'set', path: ['baseURL'], value: 'https://a/v1' },
      { op: 'set', path: ['model'], value: 'm' },
    ])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([
      { field: 'baseURL', landed: true },
      { field: 'model', landed: true },
    ])
    expect(primary.loads.length).toBeGreaterThan(0)
  })

  it('judges a redacted secret field by its secret-set marker on the official wire', async () => {
    const primary = fakePrimary<{ baseURL: string; apiKey?: string }>(ready({ baseURL: 'https://a/v1' }, 7))
    const official = {
      mutate: async () => ({
        result: {
          ok: true as const,
          value: batchView('describe-image', { baseURL: 'https://a/v1' }, 8, { user: { baseURL: 'https://a/v1' }, secrets: [{ path: ['apiKey'], set: true }] }),
        },
      }),
    }
    const scope = createCompatScope<{ baseURL: string; apiKey?: string }>({ namespace: 'describe-image', primary: primary.scope, official })
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<{ ok: boolean; fields: { field: string; landed: boolean }[] }> }).mutateBatch
    const result = await mutateBatch!([{ field: 'apiKey', op: 'set', value: 'sk-x' }])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([{ field: 'apiKey', landed: true }])
  })

  it('surfaces refusal code and message from the official error envelope', async () => {
    const primary = fakePrimary<{ baseURL: string; model: string }>(ready({ baseURL: 'https://a/v1', model: 'm' }, 7))
    const official = {
      mutate: async () => ({
        result: {
          ok: false as const,
          error: { code: 'settings-rejected', message: 'describe-image: baseURL must be an absolute http(s) URL' },
        },
      }),
    }
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', primary: primary.scope, official })
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<{ ok: boolean; code?: string; message?: string; fields: { field: string; landed: boolean }[] }> }).mutateBatch
    const result = await mutateBatch!([{ field: 'baseURL', op: 'set', value: 'ftp://x' }])
    expect(result.ok).toBe(false)
    expect(result.code).toBe('settings-rejected')
    expect(result.message).toBe('describe-image: baseURL must be an absolute http(s) URL')
    expect(primary.loads.length).toBeGreaterThan(0)
  })

  it('posts every op in one /mutate and reports per-field success', async () => {
    const primary = fakePrimary<{ baseURL: string; model: string }>(unavailable())
    const calls: Array<{ body: Record<string, unknown> }> = []
    const { fetchFn } = fakeFetch(async (url, init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 3, { user: { baseURL: 'https://a/v1', model: 'm' } })])
      }
      calls.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return { ok: true, value: batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 4, { user: { baseURL: 'https://a/v1', model: 'm' } }) }
    })
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<unknown> }).mutateBatch
    expect(typeof mutateBatch).toBe('function')
    const result = await (mutateBatch as (writes: { field: string; op: 'set'; value: unknown }[]) => Promise<{ ok: boolean; fields: { field: string; landed: boolean }[] }>)([
      { field: 'baseURL', op: 'set', value: 'https://a/v1' },
      { field: 'model', op: 'set', value: 'm' },
    ])
    expect(calls).toHaveLength(1)
    const body = calls[0].body
    expect(body.ns).toBe('describe-image')
    expect(body.expectedRevision).toBe(3)
    expect(body.ops).toEqual([
      { op: 'set', path: ['baseURL'], value: 'https://a/v1' },
      { op: 'set', path: ['model'], value: 'm' },
    ])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([
      { field: 'baseURL', landed: true },
      { field: 'model', landed: true },
    ])
  })

  it('judges a redacted secret field by its secret-set marker', async () => {
    const primary = fakePrimary<{ baseURL: string; apiKey: string }>(unavailable())
    const { fetchFn } = fakeFetch(async (url, _init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1' }, 3, { user: { baseURL: 'https://a/v1' } })])
      }
      // The apiKey secret is redacted from the user layer, but its set marker
      // is reported in the view.
      return { ok: true, value: batchView('describe-image', { baseURL: 'https://a/v1' }, 4, { user: { baseURL: 'https://a/v1' }, secrets: [{ path: ['apiKey'], set: true }] }) }
    })
    const scope = createCompatScope<{ baseURL: string; apiKey: string }>({ namespace: 'describe-image', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<{ ok: boolean; fields: { field: string; landed: boolean }[] }> }).mutateBatch
    const result = await mutateBatch!([{ field: 'apiKey', op: 'set', value: 'sk-x' }])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([{ field: 'apiKey', landed: true }])
  })

  it('surfaces refusal code and message for a rejected batch', async () => {
    const primary = fakePrimary<{ baseURL: string; model: string }>(unavailable())
    const { fetchFn } = fakeFetch(async (url, _init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 3, { user: {} })])
      }
      return { ok: false, code: 'settings-rejected', message: 'describe-image: incoherent baseURL/model pair' }
    })
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', primary: primary.scope, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const mutateBatch = (scope as unknown as { mutateBatch?: (writes: unknown[]) => Promise<{ ok: boolean; code?: string; message?: string; fields: { field: string; landed: boolean }[] }> }).mutateBatch
    const result = await mutateBatch!([{ field: 'baseURL', op: 'set', value: 'ftp://x' }])
    expect(result.ok).toBe(false)
    expect(result.code).toBe('settings-rejected')
    expect(result.message).toBe('describe-image: incoherent baseURL/model pair')
  })
})
