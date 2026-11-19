// @vitest-environment jsdom
/**
 * The board's registrations validated against the REAL slot core.
 *
 * Every other spec in this package drives a fake seats service, so it checks
 * the wiring but not the registry's own rules: that a keyed slot admits one
 * entry per key, that a list entry carries the id/order/label shape its kind
 * requires, and that disposal releases what was registered. This spec runs
 * `registerTaskBoardPanel` against the genuine `SlotCore` the running shell
 * installs, so an option shape the registry rejects fails here instead of in
 * the GUI.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerTaskBoardPanel } from '../src/client/native-panel.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'

/** A controller whose open state the registration reads; no panel face needed here. */
function fakeController(open = false): BoardController {
  return {
    getSnapshot: (): Partial<ControllerSnapshot> => ({ boardOpen: open }),
    subscribe: () => () => {},
  } as unknown as BoardController
}

/**
 * A client context whose slots service is the real SlotCore. The delegate
 * records nothing and `inject` answers immediately (the real one defers until
 * ui-layout / ui-sidebar declare the seats), which is exactly the point: the
 * core itself validates the option shapes below.
 *
 * The core only admits a registration into a DECLARED seat, so the harness
 * declares the two seats the way the shell does: ui-layout's root entry
 * declares `main` as keyed, and ui-sidebar's declares `sidebar.panellist` as
 * a root-scoped list. Registration through an undeclared seat throws
 * (`slot "..." is not declared`), which is what makes `ctx.slots.inject` the
 * required path in production.
 */
function realCoreContext() {
  const core = new SlotCore()
  const slots = {
    register: (options: never, component: never) => core.register(options, component as never),
    inject: (_key: string, callback: () => () => void) => callback(),
  }
  const ctx = {
    effect(callback: () => void | (() => void)) { callback() },
    get: () => undefined,
    on: () => () => {},
    slots,
  }
  return { ctx: ctx as never, core, declare: () => {
    core.register({
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        sidebar: { kind: 'single', scope: 'root' },
      },
    } as never, (() => null) as never)
    core.register({
      name: 'sidebar',
      children: {
        'sidebar.panellist': { kind: 'list', scope: 'root' },
      },
    } as never, (() => null) as never)
  } }
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })

describe('task-board registrations against the real slot core', () => {
  it('operator sees the board occupy the keyed main seat and a list row seat', () => {
    // Given the genuine slot registry the shell installs
    const { ctx, core, declare } = realCoreContext()
    declare()

    // When the board registers its panel
    const dispose = registerTaskBoardPanel(ctx, fakeController())

    // Then the registry holds one keyed main entry and one list row entry
    const main = core.entries('main')
    const rows = core.entries('sidebar.panellist')
    expect(main).toHaveLength(1)
    expect(main[0]!.options.key).toBe('task-board')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.options.id).toBe('task-board')
    expect(rows[0]!.options.order).toBe(20)

    dispose()
    // And disposal clears both, so a rebuilt bundle re-registers cleanly
    expect(core.entries('main')).toHaveLength(0)
    expect(core.entries('sidebar.panellist')).toHaveLength(0)
  })

  it('operator switching language sees the row label resolve through the registry', () => {
    // Given a registered board whose row carries a function label
    const { ctx, core, declare } = realCoreContext()
    declare()
    const dispose = registerTaskBoardPanel(ctx, fakeController())

    // When the shell resolves the row label
    const label = core.entries('sidebar.panellist')[0]!.options.label

    // Then it is a function, so the shell re-resolves it on every locale
    // change instead of freezing the mount-time copy (a string label would),
    // and it renders the active language rather than the dictionary key
    expect(typeof label).toBe('function')
    const text = (label as () => string)()
    expect(text).not.toBe('entry.label')
    expect(text.length).toBeGreaterThan(0)

    dispose()
  })

  it('operator sees a provider row admitted into the new-card seat the board declares', () => {
    // Given the genuine slot registry with the board's panel registration in it
    const { ctx, core, declare } = realCoreContext()
    declare()
    registerTaskBoardPanel(ctx, fakeController())

    // When a provider registers its own new-card section, which the core only
    // admits while the board's entry declares that child seat
    const dispose = core.register(
      { name: 'task-board.compose.section', id: 'alpha' } as never,
      (() => null) as never,
    )

    // Then the registry holds it, so the seat is real for a provider instead of
    // failing at its own install time
    expect(core.entries('task-board.compose.section').map(entry => entry.options.id)).toEqual(['alpha'])

    dispose()
    expect(core.entries('task-board.compose.section')).toHaveLength(0)
  })

  it('operator sees a duplicate panel registration refused, never silently duplicated', () => {
    // Given a registered board
    const { ctx, declare } = realCoreContext()
    declare()
    registerTaskBoardPanel(ctx, fakeController())

    // When a second registration claims the same panel seats
    // Then the registry refuses it rather than silently shadowing the first,
    // which is why the id/key pair must stay stable across a bundle rebuild
    expect(() => registerTaskBoardPanel(ctx, fakeController())).toThrow(/already has an entry/)
  })
})
