/**
 * Browser half of the GitHub provider extension: the dictionaries it registers,
 * the rendering seats it installs while the board runs, and the configuration
 * section it contributes into the board's own settings card. The configuration
 * section must outlive the extension's own switch — it is where that switch
 * lives, so a section gated by the switch could never turn it back on.
 */
import { describe, expect, it } from 'vitest'
import { apply, NS } from '../src/client/index.ts'

/** The board's settings seat, restated (this package may not import the board). */
const SETTINGS_SECTION = 'task-board.settings.section'
/** The board's task-detail seat. */
const DETAIL_SECTION = 'task-board.detail.section'
/** The board's card-decoration seat. */
const CARD_DECORATION = 'task-board.card.decoration'

/**
 * Settings-form double that applies the batched writes the section submits, so
 * the staged form's read-back judgment settles on the same values the Host
 * would hold.
 */
function form(initial: Record<string, unknown>) {
  const user: Record<string, unknown> = { ...initial }
  const ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }> = []
  const scope = {
    getSnapshot: () => ({
      status: 'ready' as const,
      value: { ...user },
      base: undefined,
      user: { ...user },
      revision: 1,
      writable: true as const,
    }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: async (batch: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>) => {
      ops.push(...batch)
      for (const op of batch) {
        if (op.op === 'set') user[op.path[0]!] = op.value
        else delete user[op.path[0]!]
      }
      return true
    },
  }
  return { scope, ops }
}

/**
 * Browser context double over the services the browser half reads: the slot
 * registry, the locale catalog, the family settings binder, and the board's
 * client face. `inject` runs the dependency callback the way cordis does once
 * the board serves its service, so the seats register into the recorded list.
 */
function context(options: { enabled?: boolean; declarationFace?: boolean; groupingFace?: boolean } = {}) {
  const registrations: Array<Record<string, unknown>> = []
  const grouping: unknown[] = []
  const dictionaries: string[] = []
  /** Seat keys the section subscribed to through the declaration-tracking face. */
  const followedSeats: string[] = []
  const { scope } = form({ enabled: options.enabled !== false })
  const face = {
    dispatch: async () => true,
    registerVisibility: () => () => {},
    ...(options.groupingFace === false ? {} : {
      registerGrouping: (selector: unknown) => {
        grouping.push(selector)
        return () => { grouping.splice(grouping.indexOf(selector), 1) }
      },
    }),
    subscribe: () => () => {},
    snapshot: () => ({ enabled: true, tasks: [], extensions: {} }),
  }
  const slots: Record<string, unknown> = {
    register: (entry: Record<string, unknown>) => {
      registrations.push(entry)
      return () => {}
    },
  }
  if (options.declarationFace !== false) {
    // The seat's declaration lifecycle: the renderer's face runs the callback
    // once the seat is declared and re-runs it whenever the declaration
    // changes, which is what keeps the section alive across the board card
    // moving between plugin-card seats.
    slots.inject = (key: string, callback: () => () => void) => {
      followedSeats.push(key)
      const dispose = callback()
      return () => { dispose() }
    }
  }
  const ctx = {
    get: (name: string) => {
      if (name === 'taskBoard') return face
      if (name === 'webUiSettings') return { bind: () => scope }
      return undefined
    },
    on: () => () => {},
    effect: (callback: () => unknown) => { callback(); return () => {} },
    inject: (_services: readonly string[], callback: (scoped: unknown) => void) => {
      callback({
        get: ctx.get,
        slots,
        effect: (registered: () => unknown) => { registered(); return () => {} },
      })
      return { dispose: () => {} }
    },
    slots,
    locale: {
      register: (namespace: string, catalog: Record<string, unknown>) => {
        dictionaries.push(namespace + ':' + Object.keys(catalog).join(','))
        return () => {}
      },
    },
    configForms: {
      get: () => scope,
      describe: () => ({ getSnapshot: () => ({ view: undefined }), subscribe: () => () => {} }),
    },
  }
  return { ctx, registrations, dictionaries, followedSeats, grouping }
}

describe('task-board GitHub extension browser half', () => {
  it('operator opening the board settings card gets the GitHub configuration inside it', () => {
    // Given a page whose settings group publishes its family binder and whose board serves its service
    const harness = context({ enabled: true })

    // When the browser half applies
    apply(harness.ctx as never)

    // Then the configuration section is registered into the BOARD's own card seat,
    // under this extension's id and its own locale namespace
    const section = harness.registrations.find(entry => entry.name === SETTINGS_SECTION)
    expect(section).toMatchObject({ name: SETTINGS_SECTION, id: 'github', locale: NS })
    // And both dictionaries of that namespace were registered for the page
    expect(harness.dictionaries).toEqual(['task-board-github:zh,en'])
  })

  it('operator whose board card moves between seats keeps the GitHub section in it', () => {
    // Given a page whose slot registry tracks declarations
    const harness = context({ enabled: true })

    // When the browser half applies
    apply(harness.ctx as never)

    // Then the section followed the seat's declaration instead of registering once:
    // a one-shot entry is released the moment the board card re-declares the seat
    expect(harness.followedSeats).toEqual([SETTINGS_SECTION])
    expect(harness.registrations.map(entry => entry.name)).toContain(SETTINGS_SECTION)
  })

  it('operator on a shell without the declaration face still gets the section registered', () => {
    // Given a page whose slot registry has no declaration-tracking face
    const harness = context({ enabled: true, declarationFace: false })

    // When the browser half applies
    apply(harness.ctx as never)

    // Then the section is registered directly, so the configuration is reachable
    expect(harness.followedSeats).toEqual([])
    expect(harness.registrations.map(entry => entry.name)).toContain(SETTINGS_SECTION)
  })

  it('operator turning the extension off keeps the section that turns it back on', () => {
    // Given the same page with the extension's master switch off
    const harness = context({ enabled: false })

    // When the browser half applies
    apply(harness.ctx as never)

    // Then the configuration section is still registered ...
    expect(harness.registrations.map(entry => entry.name)).toContain(SETTINGS_SECTION)
    // ... while the board's rendering seats are gone, because the extension is not running
    expect(harness.registrations.map(entry => entry.name)).not.toContain(DETAIL_SECTION)
    expect(harness.registrations.map(entry => entry.name)).not.toContain(CARD_DECORATION)
  })

  it('operator running the extension gets both board rendering seats under one extension id', () => {
    // Given a page whose board serves its service and an enabled extension
    const harness = context({ enabled: true })

    // When the browser half applies
    apply(harness.ctx as never)

    // Then the detail section and the card decoration are registered under the extension id
    const seats = harness.registrations.filter(entry => entry.name === DETAIL_SECTION || entry.name === CARD_DECORATION)
    expect(seats).toHaveLength(2)
    for (const seat of seats) expect(seat.id).toBe('github')
  })

  it('operator gets repository grouping when offered and keeps the seats on an older board without it', () => {
    // Given a current board and an older board without the optional method
    const current = context({ enabled: true })
    const older = context({ enabled: true, groupingFace: false })

    // When the provider installs on both
    apply(current.ctx as never)
    expect(() => { apply(older.ctx as never) }).not.toThrow()

    // Then the current board receives one selector and the older board keeps every seat
    expect(current.grouping).toHaveLength(1)
    expect(older.grouping).toHaveLength(0)
    expect(older.registrations.map(entry => entry.name)).toEqual(expect.arrayContaining([DETAIL_SECTION, CARD_DECORATION]))
  })
})
