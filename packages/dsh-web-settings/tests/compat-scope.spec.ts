/** @vitest-environment jsdom */

/**
 * Compatibility form state machine: the native shared form (`ctx.configForms`)
 * becomes authoritative once the bridge resolves the profile entry id that
 * owns the namespace; the loopback bridge controller answers while no entry id
 * is known (or no shared forms service is served); writes route to the active
 * transport; and a page with no fetch keeps the unavailable behavior.
 *
 * test-standards-allow: settings transport unit tests over synthetic wire fixtures
 */

import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot, ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCompatScope } from '../src/client/compat-settings-scope.ts'
import { WEB_UI_SETTINGS_BRIDGE_PREFIX } from '../src/protocol.ts'

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One namespace row the fake shared mirror reports. */
interface FakeMirrorRow {
  ns: string
  secrets?: { path: string[]; set: boolean }[]
}

/** A manual native form: a snapshot store plus recorded writes. */
function fakeForm<T>(initial: ConfigFormSnapshot<T>) {
  const store = createSnapshotStore<ConfigFormSnapshot<T>>(initial)
  const sets: Array<[string, unknown]> = []
  const mutations: Array<readonly unknown[]> = []
  let accepts = true
  return {
    form: {
      getSnapshot: () => store.getSnapshot(),
      subscribe: (listener: () => void) => store.subscribe(listener),
      set: async (field: string, value: unknown) => { sets.push([field, value]); return accepts },
      unset: async () => accepts,
      mutate: async (ops: readonly unknown[]) => { mutations.push(ops); return accepts },
    } as unknown as ConfigForm<T>,
    update: (patch: Partial<ConfigFormSnapshot<T>>) => { store.set({ ...store.getSnapshot(), ...patch }) },
    sets,
    mutations,
    refuse: () => { accepts = false },
  }
}

/**
 * A fake shared forms service: `get` answers the one fake form and records the
 * entry id it was asked for; `describe` serves the mirror rows the landed
 * checks and the entry-id promotion read.
 */
function fakeConfigForms<T>(form: ConfigForm<T>, rows: FakeMirrorRow[]) {
  const requests: string[] = []
  const store = createSnapshotStore({
    status: 'ready',
    view: {
      namespaces: rows.map(row => ({
        autoGenerate: true,
        ns: row.ns,
        schema: {},
        value: {},
        applies: 'live',
        secrets: row.secrets ?? [],
        revision: 1,
      })),
      writable: true,
      hasDocument: true,
    },
    error: null,
  })
  const describe = {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener: () => void) => store.subscribe(listener),
    ensure: async () => {},
    acceptView: () => {},
  }
  const service = {
    get: (entryId: string) => { requests.push(entryId); return form },
    describe: () => describe,
  }
  return { service: service as unknown as ConfigForms, requests }
}

/** A bridge describe payload for one namespace. */
function bridgeView(ns: string, value: unknown, revision: number, entryId?: string) {
  return { ns, schema: {}, value, revision, ...entryId === undefined ? {} : { entryId } }
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

const ready = <T>(value: T, revision = 1): ConfigFormSnapshot<T> => ({
  status: 'ready',
  value,
  base: undefined,
  user: undefined,
  revision,
  writable: true,
  mode: 'host',
})

const unavailable = (): ConfigFormSnapshot<never> => ({
  status: 'unavailable',
  value: undefined,
  base: undefined,
  user: undefined,
  revision: undefined,
  writable: false,
  mode: 'host',
})

describe('createCompatScope transport', () => {
  it('binds the native form once the bridge resolves its profile entry id', async () => {
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: false }, 9))
    const { service, requests } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn, handler } = fakeFetch(async () => describeResult([bridgeView('task-board', { enabled: true }, 3, 'web-ui-task-board')]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', configForms: service, fetchFn })
    await vi.waitFor(() => { expect(requests).toEqual(['web-ui-task-board']) })
    expect(handler).toHaveBeenCalled()
    // The native form is the transport; the bridge only resolved the entry id.
    await vi.waitFor(() => { expect(scope.getSnapshot().value).toEqual({ enabled: false }) })
    expect(scope.getSnapshot().status).toBe('ready')
    expect(scope.getSnapshot().revision).toBe(9)
    expect(scope.entryId()).toBe('web-ui-task-board')
    // One describe read resolved the id: the view is never re-read for data.
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('binds a namespace that already names a served profile entry id', async () => {
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: true }))
    const { service, requests } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn, handler } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    expect(requests).toEqual(['web-ui-task-board'])
    expect(scope.getSnapshot().status).toBe('ready')
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    // No bridge read is needed once the entry id is known.
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps the bridge controller when the bridge serves no entry id', async () => {
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: false }))
    const { service, requests } = fakeConfigForms(native.form, [])
    const { fetchFn } = fakeFetch(async () => describeResult([bridgeView('task-board', { enabled: true }, 3)]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', configForms: service, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(scope.getSnapshot().revision).toBe(3)
    expect(scope.entryId()).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('keeps the bridge controller when the mirror lacks the resolved entry id', async () => {
    // The native form would only report the namespace unavailable, so the
    // bridge stays the transport.
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: false }))
    const { service, requests } = fakeConfigForms(native.form, [{ ns: 'web-ui-someone-else' }])
    const { fetchFn } = fakeFetch(async () => describeResult([bridgeView('task-board', { enabled: true }, 3, 'web-ui-task-board')]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', configForms: service, fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(requests).toEqual([])
  })

  it('keeps the bridge controller when the page serves no shared forms', async () => {
    const { fetchFn } = fakeFetch(async () => describeResult([bridgeView('task-board', { enabled: true }, 3, 'web-ui-task-board')]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(scope.getSnapshot().writable).toBe(true)
  })

  it('stays unavailable when the bridge does not serve the namespace', async () => {
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('never reads a bridge when the caller provides no fetch', async () => {
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board' })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
    expect(scope.entryId()).toBeUndefined()
  })

  it('routes writes to the native form while it serves the namespace', async () => {
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: true }))
    const { service } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    expect(await scope.set('enabled', false)).toBe(true)
    expect(native.sets).toEqual([['enabled', false]])
  })

  it('answers false when neither transport serves the namespace', async () => {
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board' })
    expect(await scope.set('enabled', false)).toBe(false)
    expect(await scope.unset('enabled')).toBe(false)
    expect(await scope.mutate([{ op: 'set', path: ['enabled'], value: true }])).toBe(false)
  })

  it('routes writes through the bridge when it took over', async () => {
    const mutateCalls: Array<{ url: string; body: Record<string, unknown> }> = []
    const { fetchFn } = fakeFetch(async (url, init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') return describeResult([bridgeView('task-board', { enabled: true }, 3)])
      mutateCalls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return { ok: true, value: bridgeView('task-board', { enabled: false }, 4) }
    })
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(await scope.set('enabled', false)).toBe(true)
    expect(mutateCalls).toHaveLength(1)
    expect(mutateCalls[0].url).toBe(WEB_UI_SETTINGS_BRIDGE_PREFIX + '/mutate')
    expect(mutateCalls[0].body.ns).toBe('task-board')
    expect(mutateCalls[0].body.expectedRevision).toBe(3)
  })

  it('answers false when the bridge refuses the write', async () => {
    const { fetchFn } = fakeFetch(async (url) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') return describeResult([bridgeView('task-board', { enabled: true }, 3)])
      return { ok: false, code: 'settings-rejected', message: 'the Host validator refused the write' }
    })
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    expect(await scope.set('enabled', false)).toBe(false)
  })

  it('turns a dropped bridge call into a quiet unavailable', async () => {
    const { fetchFn } = fakeFetch(async () => { throw new Error('network down') })
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('unavailable') })
    expect(scope.getSnapshot().status).toBe('unavailable')
  })

  it('dispose releases the bridge and the native subscriptions', async () => {
    const native = fakeForm<{ enabled: boolean }>(ready({ enabled: true }))
    const { service } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    const seen: number[] = []
    scope.subscribe(() => { seen.push(1) })
    scope.dispose()
    native.update({ revision: 2 })
    expect(seen).toEqual([])
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

type BatchReader = (writes: { field: string; op: 'set' | 'unset'; value?: unknown }[]) => Promise<{ ok: boolean; code?: string; message?: string; fields: { field: string; landed: boolean }[] }>

/** Read the compatibility batch surface of one scope. */
function batchOf(scope: unknown): BatchReader | undefined {
  return (scope as { mutateBatch?: BatchReader }).mutateBatch
}

describe('createCompatScope batch mutate', () => {
  it('exposes no batch surface when neither transport serves the namespace', () => {
    const scope = createCompatScope<{ enabled: boolean }>({ namespace: 'task-board' })
    expect(batchOf(scope)).toBeUndefined()
  })

  it('batches through the native form once it serves the namespace', async () => {
    const native = fakeForm<Record<string, unknown>>({
      ...ready({ baseURL: 'https://a/v1', model: 'm' }, 7),
      user: { baseURL: 'https://a/v1', model: 'm' },
    })
    const { service } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<Record<string, unknown>>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    const result = await batchOf(scope)!([
      { field: 'baseURL', op: 'set', value: 'https://a/v1' },
      { field: 'model', op: 'set', value: 'm' },
    ])
    // One atomic mutate carrying every op, fenced on the form's revision.
    expect(native.mutations).toEqual([[
      { op: 'set', path: ['baseURL'], value: 'https://a/v1' },
      { op: 'set', path: ['model'], value: 'm' },
    ]])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([
      { field: 'baseURL', landed: true },
      { field: 'model', landed: true },
    ])
  })

  it('judges a redacted secret field by its secret-set marker on the native path', async () => {
    const native = fakeForm<Record<string, unknown>>({
      ...ready({ baseURL: 'https://a/v1' }, 7),
      user: { baseURL: 'https://a/v1' },
    })
    const { service } = fakeConfigForms(native.form, [
      { ns: 'web-ui-task-board', secrets: [{ path: ['apiKey'], set: true }] },
    ])
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<Record<string, unknown>>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    const result = await batchOf(scope)!([{ field: 'apiKey', op: 'set', value: 'sk-x' }])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([{ field: 'apiKey', landed: true }])
  })

  it('surfaces a native refusal as a batch failure', async () => {
    const native = fakeForm<Record<string, unknown>>({ ...ready({ baseURL: 'https://a/v1', model: 'm' }, 7), user: {} })
    native.refuse()
    const { service } = fakeConfigForms(native.form, [{ ns: 'web-ui-task-board' }])
    const { fetchFn } = fakeFetch(async () => describeResult([]))
    const scope = createCompatScope<Record<string, unknown>>({ namespace: 'web-ui-task-board', configForms: service, fetchFn })
    const result = await batchOf(scope)!([{ field: 'baseURL', op: 'set', value: 'ftp://x' }])
    expect(result.ok).toBe(false)
    expect(result.code).toBe('settings-rejected')
    expect(result.fields).toEqual([])
  })

  it('posts every op in one /mutate and reports per-field success', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    const { fetchFn } = fakeFetch(async (url, init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 3, { user: { baseURL: 'https://a/v1', model: 'm' } })])
      }
      calls.push({ body: JSON.parse(String(init.body)) as Record<string, unknown> })
      return { ok: true, value: batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 4, { user: { baseURL: 'https://a/v1', model: 'm' } }) }
    })
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const mutateBatch = batchOf(scope)
    expect(typeof mutateBatch).toBe('function')
    const result = await mutateBatch!([
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
    const { fetchFn } = fakeFetch(async (url, _init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1' }, 3, { user: { baseURL: 'https://a/v1' } })])
      }
      // The apiKey secret is redacted from the user layer, but its set marker
      // is reported in the view.
      return { ok: true, value: batchView('describe-image', { baseURL: 'https://a/v1' }, 4, { user: { baseURL: 'https://a/v1' }, secrets: [{ path: ['apiKey'], set: true }] }) }
    })
    const scope = createCompatScope<{ baseURL: string; apiKey: string }>({ namespace: 'describe-image', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const result = await batchOf(scope)!([{ field: 'apiKey', op: 'set', value: 'sk-x' }])
    expect(result.ok).toBe(true)
    expect(result.fields).toEqual([{ field: 'apiKey', landed: true }])
  })

  it('surfaces refusal code and message for a rejected batch', async () => {
    const { fetchFn } = fakeFetch(async (url, _init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('describe-image', { baseURL: 'https://a/v1', model: 'm' }, 3, { user: {} })])
      }
      return { ok: false, code: 'settings-rejected', message: 'describe-image: incoherent baseURL/model pair' }
    })
    const scope = createCompatScope<{ baseURL: string; model: string }>({ namespace: 'describe-image', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const result = await batchOf(scope)!([{ field: 'baseURL', op: 'set', value: 'ftp://x' }])
    expect(result.ok).toBe(false)
    expect(result.code).toBe('settings-rejected')
    expect(result.message).toBe('describe-image: incoherent baseURL/model pair')
  })

  it('preserves multi-segment path array when mutating through bridge fallback', async () => {
    const calls: { url: string; body: any }[] = []
    const { fetchFn } = fakeFetch(async (url, init) => {
      if (url === WEB_UI_SETTINGS_BRIDGE_PREFIX + '/describe') {
        return describeResult([batchView('skin-background', {}, 1, { user: {} })])
      }
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true, value: batchView('skin-background', {}, 2, { user: { 'skin-wallpaper': { enabled: true } } }) }
    })
    const scope = createCompatScope({ namespace: 'skin-background', fetchFn })
    await vi.waitFor(() => { expect(scope.getSnapshot().status).toBe('ready') })
    const accepted = await scope.mutate([{ op: 'set', path: ['skin-wallpaper', 'enabled'], value: true }])
    expect(accepted).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].body.ops).toEqual([
      { op: 'set', path: ['skin-wallpaper', 'enabled'], value: true },
    ])
  })
})
