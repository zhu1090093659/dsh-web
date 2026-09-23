/**
 * Lever controller over a fake client runtime: which preset a gesture selects,
 * what a refusal maps to, and when the burst counter advances. The controller
 * is the only place that talks to the host, so this is where the switch
 * semantics are pinned.
 */

import { describe, expect, it } from 'vitest'

import { LeverController } from '../src/client/lever-controller.ts'

interface FakeOptions {
  readonly?: { current?: string, blank?: boolean, agentPreset?: string }
  presets?: { id: string, isDefault?: boolean, name?: string, broken?: string }[]
  select?: (sessionId: string, presetId: string) => { ok: true, value: string } | { ok: false, error: { code: string, message: string, details?: unknown } }
}

function fakeCtx(options: FakeOptions = {}) {
  // `readonly.current` names the Session the main view owns: the catalog carries
  // no global selection since 0.1.6-alpha.2, so the row itself carries the
  // main-view ownership marker the controller derives from.
  const current = options.readonly?.current ?? 'session-1'
  const byId: Record<string, unknown> = {
    [current]: {
      id: current,
      blank: options.readonly?.blank ?? true,
      projectionValues: { agentPreset: options.readonly?.agentPreset ?? 'standard' },
      retainedBy: { mainView: 1 },
    },
  }
  const state = { ids: [current as never], byId: byId as never }
  const rows = (options.presets ?? [
    { id: 'standard', isDefault: true, name: 'Standard' },
    { id: 'liangshen', name: '梁神模式' },
  ]).map(row => ({ isDefault: false, ...row }))
  const selections: [string, string][] = []
  const documentEvents: ((ns: string) => void)[] = []
  const ctx = {
    sessions: {
      list: {
        getSnapshot: () => state,
        subscribe: () => () => {},
      },
    },
    remote: {
      agentPresets: {
        list: async () => ({ ok: true as const, value: { presets: rows, modeSelectionEnabled: true } }),
        select: async (sessionId: string, presetId: string) => {
          selections.push([sessionId, presetId])
          if (options.select !== undefined) return options.select(sessionId, presetId)
          return { ok: true as const, value: presetId }
        },
      },
      $on: (event: string, listener: (ns: string) => void) => {
        if (event === 'settings/document-updated') documentEvents.push(listener)
        return () => {}
      },
    },
    locale: { bind: () => (key: string, vars?: Record<string, unknown>) => (vars === undefined ? key : `${key}${JSON.stringify(vars)}`) },
  }
  return { ctx: ctx as never, selections, state, rows, documentEvents }
}

async function started(options: FakeOptions = {}) {
  const fake = fakeCtx(options)
  const controller = new LeverController(fake.ctx)
  controller.start()
  await Promise.resolve()
  await Promise.resolve()
  return { ...fake, controller }
}

describe('LeverController', () => {
  it('reports off on a blank session running another preset', async () => {
    const { controller } = await started()
    expect(controller.snapshot().getSnapshot().state).toBe('off')
    expect(controller.snapshot().getSnapshot().restoreLabel).toBe('Standard')
  })

  it('reports on when the session already runs the LiangShen preset', async () => {
    const { controller } = await started({ readonly: { agentPreset: 'liangshen' } })
    expect(controller.snapshot().getSnapshot().state).toBe('on')
  })

  it('reports locked once the session has started', async () => {
    const { controller } = await started({ readonly: { blank: false } })
    expect(controller.snapshot().getSnapshot().state).toBe('locked')
  })

  it('reports missing when the roster supplies no LiangShen preset', async () => {
    const { controller } = await started({ presets: [{ id: 'standard', isDefault: true }] })
    expect(controller.snapshot().getSnapshot().state).toBe('missing')
  })

  it('selects the LiangShen preset on a pull and remembers where to return', async () => {
    const { controller, selections } = await started()
    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    expect(selections).toEqual([['session-1', 'liangshen']])
    expect(controller.snapshot().getSnapshot().busy).toBe(false)
    expect(controller.snapshot().getSnapshot().burst).toBe(1)
    // The state itself still comes from the session projection, not the call.
    expect(controller.snapshot().getSnapshot().state).toBe('off')
  })

  it('restores the remembered preset on a push', async () => {
    const { controller, selections, state } = await started()
    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    // The host records the switch; the next session read reports it.
    state.byId['session-1'] = {
      id: 'session-1', blank: true, projectionValues: { agentPreset: 'liangshen' }, retainedBy: { mainView: 1 },
    } as never
    controller.refresh()
    expect(controller.snapshot().getSnapshot().state).toBe('on')
    controller.face().push()
    await Promise.resolve()
    await Promise.resolve()
    expect(selections).toEqual([['session-1', 'liangshen'], ['session-1', 'standard']])
  })

  it('falls back to the deployment default when nothing was remembered', async () => {
    const { controller, selections } = await started({ readonly: { agentPreset: 'liangshen' } })
    controller.face().push()
    await Promise.resolve()
    await Promise.resolve()
    expect(selections).toEqual([['session-1', 'standard']])
  })

  it('maps the locked refusal to the locked error', async () => {
    const { controller } = await started({
      select: () => ({ ok: false, error: { code: 'agent-preset/locked', message: 'locked' } }),
    })
    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().getSnapshot().error).toEqual({ kind: 'locked' })
    expect(controller.snapshot().getSnapshot().busy).toBe(false)
  })

  it('maps a not-found refusal and carries any other reason through', async () => {
    const missing = await started({
      select: () => ({ ok: false, error: { code: 'agent-preset/not-found', message: 'nope' } }),
    })
    missing.controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    expect(missing.controller.snapshot().getSnapshot().error).toEqual({ kind: 'missing' })

    const other = await started({
      select: () => ({ ok: false, error: { code: 'agent-preset/invalid', message: 'boom', details: { reason: 'composition unusable' } } }),
    })
    other.controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    expect(other.controller.snapshot().getSnapshot().error).toEqual({ kind: 'failed', reason: 'composition unusable' })
  })

  it('reports a switch that never answers as a timeout instead of staying busy', async () => {
    const fake = fakeCtx({ select: () => new Promise(() => {}) as never })
    const controller = new LeverController(fake.ctx, { selectTimeoutMs: 5 })
    controller.start()
    await Promise.resolve()
    controller.face().pull()
    expect(controller.snapshot().getSnapshot().busy).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(controller.snapshot().getSnapshot().busy).toBe(false)
    expect(controller.snapshot().getSnapshot().error).toEqual({ kind: 'timeout' })
    // The wait is not a landed switch, so it must not celebrate either.
    expect(controller.snapshot().getSnapshot().burst).toBe(0)
  })

  it('never celebrates a refused switch', async () => {
    const { controller } = await started({
      select: () => ({ ok: false, error: { code: 'agent-preset/locked', message: 'locked' } }),
    })
    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().getSnapshot().burst).toBe(0)
  })

  it('ignores a gesture the state cannot serve', async () => {
    const { controller, selections } = await started({ readonly: { blank: false } })
    controller.face().pull()
    controller.face().push()
    await Promise.resolve()
    expect(selections).toEqual([])
  })

  it('does not re-select the preset a gesture is already on', async () => {
    const { controller, selections } = await started({ readonly: { agentPreset: 'liangshen' } })
    controller.face().pull()
    await Promise.resolve()
    expect(selections).toEqual([])
  })

  it('translates through its own namespace', async () => {
    const { controller } = await started()
    expect(controller.face().t('lever.a11y')).toBe('lever.a11y')
    expect(controller.face().t('lever.hint.push', { preset: 'Standard' })).toBe('lever.hint.push{"preset":"Standard"}')
  })

  it('operator sees the roster re-read when a committed write can move it', async () => {
    // Given a lever following a roster, When the operator commits a settings
    // write to an entry that can move it, Then the lever re-reads the roster
    // while a write to any other namespace leaves what it reports alone.
    const fake = fakeCtx({ presets: [{ id: 'standard', isDefault: true }] })
    const controller = new LeverController(fake.ctx)
    controller.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().getSnapshot().state).toBe('missing')

    fake.rows.push({ id: 'liangshen', isDefault: false, name: '梁神模式' })
    for (const listener of fake.documentEvents) listener('settings-other')
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().getSnapshot().state).toBe('missing')

    for (const listener of fake.documentEvents) listener('agent-preset-registry')
    await Promise.resolve()
    await Promise.resolve()
    expect(controller.snapshot().getSnapshot().state).toBe('off')
    controller.dispose()
  })

  it('user restores previous preset from remembered state across multiple pulls without regressing to fallback', async () => {
    // Given a blank session running an explicit non-default preset
    const { controller, selections, state } = await started({
      presets: [
        { id: 'standard', isDefault: true, name: 'Standard' },
        { id: 'command-code', name: 'Command Code' },
        { id: 'liangshen', name: '梁神模式' },
      ],
      readonly: { agentPreset: 'command-code' },
    })

    // When the user pulls down into LiangShen mode and pushes back up
    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    state.byId['session-1'] = {
      id: 'session-1', blank: true, projectionValues: { agentPreset: 'liangshen' }, retainedBy: { mainView: 1 },
    } as never
    controller.refresh()
    expect(controller.snapshot().getSnapshot().state).toBe('on')

    controller.face().push()
    await Promise.resolve()
    await Promise.resolve()

    // Then the original non-default preset is restored
    expect(selections).toEqual([['session-1', 'liangshen'], ['session-1', 'command-code']])

    // When the user repeats the pull and push cycle
    state.byId['session-1'] = {
      id: 'session-1', blank: true, projectionValues: { agentPreset: 'command-code' }, retainedBy: { mainView: 1 },
    } as never
    controller.refresh()
    expect(controller.snapshot().getSnapshot().state).toBe('off')

    controller.face().pull()
    await Promise.resolve()
    await Promise.resolve()
    state.byId['session-1'] = {
      id: 'session-1', blank: true, projectionValues: { agentPreset: 'liangshen' }, retainedBy: { mainView: 1 },
    } as never
    controller.refresh()

    controller.face().push()
    await Promise.resolve()
    await Promise.resolve()

    // Then the remembered preset is still restored instead of falling back to default
    expect(selections).toEqual([
      ['session-1', 'liangshen'],
      ['session-1', 'command-code'],
      ['session-1', 'liangshen'],
      ['session-1', 'command-code'],
    ])
  })
})

/**
 * The browser context is a proxy that THROWS on any service the fiber did not
 * inject ("cannot get property ... without inject"), and reading a nested
 * remote namespace needs its parent declared too. A controller that reads an
 * unavailable service must leave the lever inert instead of taking the composer
 * row down with it.
 */
describe('LeverController service resolution', () => {
  it('stays inert instead of throwing when the remote service is refused', async () => {
    const ctx = {
      get sessions() {
        return {
          list: {
            getSnapshot: () => ({ byId: { 'session-1': { id: 'session-1', retainedBy: { mainView: 1 } } } }),
            subscribe: () => () => {},
          },
        }
      },
      get remote(): never { throw new Error('cannot get property "remote" without inject') },
      locale: { bind: () => (key: string) => key },
    } as never
    const controller = new LeverController(ctx)
    expect(() => { controller.start() }).not.toThrow()
    expect(() => { controller.face().pull(); controller.face().push() }).not.toThrow()
    await Promise.resolve()
    // No roster read landed, so the lever reports the preset as missing.
    expect(controller.snapshot().getSnapshot().state).toBe('missing')
    expect(controller.face().t('lever.a11y')).toBe('lever.a11y')
  })

  it('stays inert when the sessions service is refused', async () => {
    const roster = { presets: [{ id: 'liangshen', isDefault: false }], modeSelectionEnabled: false }
    const ctx = {
      get sessions(): never { throw new Error('cannot get property "sessions" without inject') },
      remote: {
        agentPresets: {
          list: async () => ({ ok: true as const, value: roster }),
          select: async () => ({ ok: true as const, value: 'liangshen' }),
        },
        $on: () => () => {},
      },
      locale: { bind: () => (key: string) => key },
    } as never
    const controller = new LeverController(ctx)
    controller.start()
    await Promise.resolve()
    await Promise.resolve()
    expect(() => { controller.face().pull() }).not.toThrow()
    // No session to read means no switchable window, which reads as locked.
    expect(controller.snapshot().getSnapshot().state).toBe('locked')
  })
})
