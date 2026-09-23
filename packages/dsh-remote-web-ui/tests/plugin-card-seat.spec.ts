import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FAMILY_PLUGIN_CARD_SEAT,
  OFFICIAL_PLUGIN_CARD_SEAT,
  familyGroupLoaded,
  installPluginCard,
} from '../src/client/plugin-card-seat.ts'

/**
 * Minimal client context double. `group` models a page whose settings group is
 * loaded (the `webUiSettings` service is provided); `refuse` makes the seat
 * registration throw, the shape a host with an undeclared slot produces.
 */
function context(options: { group?: boolean; refuse?: boolean } = {}): {
  ctx: unknown
  listeners: Array<() => void>
  registrations: Array<Record<string, unknown>>
  warnings: string[]
} {
  const listeners: Array<() => void> = []
  const registrations: Array<Record<string, unknown>> = []
  const warnings: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(String(args[0]))
  })
  const ctx = {
    get: (name: string) => (options.group === true && name === 'webUiSettings' ? { bind: () => ({}) } : undefined),
    on: (_event: string, listener: () => void) => {
      listeners.push(listener)
      return () => {}
    },
    slots: {
      register: (entry: Record<string, unknown>) => {
        if (options.refuse === true) throw new Error('slot "' + String(entry.name) + '" is not declared')
        registrations.push(entry)
        return () => {}
      },
    },
  }
  return { ctx, listeners, registrations, warnings }
}

const Card = (): null => null

/** One card contribution; cases override the fields they exercise. */
function seat(overrides: Record<string, unknown> = {}): never {
  return {
    bundle: '@linxin666/dsh-remote-web-ui',
    id: 'remote-web-ui',
    order: 90,
    locale: 'remote',
    inject: () => ({ ready: true }),
    component: Card,
    ...overrides,
  } as never
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installPluginCard seat selection', () => {
  it('contributes to the family list seat while the group is loaded, even though the host declares the official seat', () => {
    const harness = context({ group: true })
    installPluginCard(harness.ctx as never, seat())
    expect(harness.registrations).toHaveLength(1)
    expect(harness.registrations[0]).toMatchObject({ name: FAMILY_PLUGIN_CARD_SEAT, id: 'remote-web-ui', order: 90 })
    expect(harness.registrations[0]).not.toHaveProperty('key')
  })

  it('contributes to the official bundle-configuration seat, keyed by the bundle package, when the group is absent', () => {
    const harness = context()
    installPluginCard(harness.ctx as never, seat())
    expect(harness.registrations).toHaveLength(1)
    expect(harness.registrations[0]).toMatchObject({ name: OFFICIAL_PLUGIN_CARD_SEAT, key: '@linxin666/dsh-remote-web-ui' })
    expect(harness.registrations[0]).not.toHaveProperty('id')
  })

  it('moves the card from the official seat to the family seat when the group applies later', () => {
    const harness = context()
    let disposed = 0
    const registered: string[] = []
    const ctx = harness.ctx as {
      slots: { register: (entry: Record<string, unknown>) => () => void }
      get: (name: string) => unknown
    }
    ctx.slots.register = (entry) => {
      registered.push(String(entry.name))
      return () => { disposed += 1 }
    }
    let group: unknown
    ctx.get = (name: string) => (name === 'webUiSettings' ? group : undefined)

    installPluginCard(harness.ctx as never, seat({ bundle: '@linxin666/dsh-client-ui-task-board', id: 'task-board' }))
    expect(registered).toEqual([OFFICIAL_PLUGIN_CARD_SEAT])

    // The group applies and publishes its service.
    group = { bind: () => ({}) }
    for (const listener of harness.listeners) listener()

    expect(registered).toEqual([OFFICIAL_PLUGIN_CARD_SEAT, FAMILY_PLUGIN_CARD_SEAT])
    expect(disposed).toBe(1)
  })

  it('does not re-register while the seat is unchanged', () => {
    const harness = context({ group: true })
    installPluginCard(harness.ctx as never, seat({ bundle: '@linxin666/dsh-client-ui-task-board', id: 'task-board' }))
    for (let i = 0; i < 4; i += 1) for (const listener of harness.listeners) listener()
    expect(harness.registrations).toHaveLength(1)
  })

  it('reports a refused registration instead of leaving the card silently missing', () => {
    const harness = context({ group: true, refuse: true })
    installPluginCard(harness.ctx as never, seat())
    expect(harness.registrations).toHaveLength(0)
    expect(harness.warnings).toHaveLength(1)
    expect(harness.warnings[0]).toContain(FAMILY_PLUGIN_CARD_SEAT)
  })

  it('treats a context without the group service as "group absent"', () => {
    expect(familyGroupLoaded({ slots: {} } as never)).toBe(false)
    expect(familyGroupLoaded({ slots: {}, get: () => undefined } as never)).toBe(false)
    expect(familyGroupLoaded({
      slots: {},
      get: () => { throw new Error('context inactive') },
    } as never)).toBe(false)
    expect(familyGroupLoaded({ slots: {}, get: (name: string) => (name === 'webUiSettings' ? {} : undefined) } as never)).toBe(true)
  })
})
