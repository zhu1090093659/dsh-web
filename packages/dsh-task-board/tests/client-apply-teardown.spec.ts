// @vitest-environment jsdom
/**
 * Fiber ownership of the board's slot registrations.
 *
 * The client module system replaces a rebuilt bundle IN PLACE: it disposes the
 * old fiber and re-applies the new code in the same document, without a page
 * reload. The board contributes a sidebar panel row and a center-column page
 * through the official slots system, so both registrations must die with the
 * fiber and be re-established by the rebuilt bundle — a row that outlives its
 * fiber would render through a dead module's dictionaries (the reported
 * 2026-09-24 zombie entry: a live "entry.label" row beside a translated shell).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

/** The two official seats the board's own panel surfaces register into. */
const PANEL_SEATS = new Set(['main', 'sidebar.panellist'])

/** An unavailable settings namespace: the composition default (enabled) mounts the UI. */
function unavailableSettingsForm() {
  return {
    getSnapshot: () => ({
      status: 'unavailable',
      value: undefined,
      base: undefined,
      user: undefined,
      revision: undefined,
      writable: false,
    }),
    subscribe: () => () => {},
    mutate: async () => false,
    set: async () => false,
    unset: async () => false,
  }
}

/** One live slot registration recorded by the fake seats service. */
interface Registration {
  name: string
  options: Record<string, unknown>
  live: boolean
}

/**
 * Minimal client context: the seats apply() reads, plus the fiber effect
 * collector. The fake slots service records every registration and drops them
 * when the fiber effect that owns them disposes, mirroring the real registry
 * (which installs both `register` and the injected callback under ctx.effect).
 */
function applyContext() {
  const disposers: Array<() => void> = []
  const registrations: Registration[] = []
  const services: Record<string, unknown> = {
    sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} } },
    workspaces: {
      list: { getSnapshot: () => ({ items: [] }), subscribe: () => () => {} },
      create: async () => ({ workspaceId: 'w1' }),
    },
    remote: {},
    connection: { api: {} },
    // The layout face is served, so the board wires panel navigation and the
    // panel-info subscription the reconciled view state rides.
    layout: {
      selectPanel: () => {},
      panelInfo: { getSnapshot: () => ({ activePanelId: null }), subscribe: () => () => {} },
    },
  }
  const slots = {
    register: (options: Record<string, unknown>) => {
      const record: Registration = { name: String(options.name), options, live: true }
      registrations.push(record)
      const release = (): void => { record.live = false }
      // The real registry installs every registration under the CALLER's
      // ctx.effect, so a fiber unload collects it without the plugin asking.
      disposers.push(release)
      return release
    },
    // The real inject defers until the owning shell entry declares the seat and
    // installs its callback under ctx.effect too; this harness answers
    // immediately so the spec observes both registrations.
    inject: (_key: string, callback: () => () => void) => {
      const release = callback()
      disposers.push(release)
      return release
    },
  }
  const ctx = {
    effect(callback: () => void | (() => void)) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    get: (name: string) => services[name],
    on: () => () => {},
    // The preset roster namespace mounts with the official api-remotes
    // assembly; this harness serves none, so the scoped feed stays parked
    // (cordis would run the callback only once the service exists).
    inject: (_names: readonly string[], _callback: unknown) => ({ dispose: async () => {} }),
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      subscribe: () => () => {},
    },
    configForms: {
      get: () => unavailableSettingsForm(),
      // The describe mirror may answer late; a throwing probe is the documented
      // "nothing served yet" path and binds the aggregate entry id.
      describe: () => { throw new Error('no describe mirror') },
    },
    slots,
  }
  return { ctx: ctx as never, disposers, registrations }
}

describe('task-board client apply fiber ownership', () => {
  beforeEach(() => {
    // The cross-module apply guard is a globalThis flag; each case starts fresh.
    delete (globalThis as { __dshTaskboardApplied?: boolean }).__dshTaskboardApplied
    // Every host call (telemetry, ledger bootstrap) fails fast: this spec is
    // about registration lifetime, not transport.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('operator sees both panel seats registered while the fiber lives, and released when it disposes', () => {
    // Given a client context whose fiber the loader can dispose
    const { ctx, disposers, registrations } = applyContext()

    // When the plugin applies
    apply(ctx)

    // Then the sidebar row and the center-column page are both contributed into
    // the official seats (beside the settings card apply() also installs), and
    // every registration is live
    const panelSeats = registrations.filter(entry => PANEL_SEATS.has(entry.name))
    expect(panelSeats.map(entry => entry.name).sort()).toEqual(['main', 'sidebar.panellist'])
    expect(registrations.every(entry => entry.live)).toBe(true)

    // When the fiber disposes like a replaced bundle
    for (const dispose of disposers.splice(0).reverse()) dispose()

    // Then no registration outlives it
    expect(registrations.some(entry => entry.live)).toBe(false)
    expect(disposers).toHaveLength(0)
  })

  it('operator sees the seats return when the task board applies again after a fiber teardown', () => {
    // Given a mounted board whose fiber the loader unloaded
    const first = applyContext()
    apply(first.ctx)
    for (const dispose of first.disposers.splice(0).reverse()) dispose()
    expect(first.registrations.some(entry => entry.live)).toBe(false)

    // When the rebuilt bundle applies into the same document
    const second = applyContext()
    apply(second.ctx)

    // Then exactly one live row/page pair is registered again, not a stale one
    const live = second.registrations.filter(entry => PANEL_SEATS.has(entry.name))
    expect(live.map(entry => entry.name).sort()).toEqual(['main', 'sidebar.panellist'])
    expect(second.registrations.filter(entry => entry.name === 'sidebar.panellist')).toHaveLength(1)
  })

  it('operator switching language sees the sidebar row label follow', () => {
    // Given a live registration
    const { ctx, registrations } = applyContext()
    apply(ctx)

    // When the shell reads the row label (resolveSlotLabel calls a function label)
    const row = registrations.find(entry => entry.name === 'sidebar.panellist')
    const label = row?.options.label

    // Then it is a function, so the shell re-resolves it on every locale change
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('entry.label')
  })
})
