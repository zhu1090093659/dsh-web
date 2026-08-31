/** @vitest-environment jsdom */

/**
 * Pet settings card diagnostics (pet-center M2 P7, issue #623): the card
 * projects host-served registry diagnostics (v1 migration hints, invalid
 * entries) next to the pet chooser; a failed diagnostics fetch degrades to an
 * empty list, never an error state.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the one value
// member the card chain needs (same pattern as pet-section.spec.tsx).
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: (init: unknown) => {
    let value = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => value,
      set: (next: unknown) => { value = next; for (const listener of listeners) listener() },
      update: (mutator: (draft: never) => void) => { mutator(value as never); for (const listener of listeners) listener() },
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  },
}))
import { PetSettingsCardController, type PetSettings } from '../src/client/PetSettingsCard.tsx'

/** Minimal in-memory scope backing the card controller. */
function fakeScope(): SettingsScope<PetSettings> {
  return {
    subscribe: () => () => {},
    getSnapshot: () => ({ value: {}, base: {}, user: {}, writable: true }),
    set: async () => {},
    unset: async () => {},
  } as unknown as SettingsScope<PetSettings>
}

function stubFetch(diagnostics: Array<{ level: string; message: string }> | 'fail') {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input === '/api/pet/diagnostics') {
      if (diagnostics === 'fail') return new Response('x', { status: 500 })
      return new Response(JSON.stringify({ diagnostics }), { status: 200 })
    }
    return new Response(JSON.stringify([{ id: 'whale-girl', displayName: '鲸鱼娘' }]), { status: 200 })
  }))
}

/** Flush the controller's async loaders. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('PetSettingsCardController diagnostics', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('projects host diagnostics into the card state', async () => {
    stubFetch([{ level: 'warning', message: 'pet x: v1 compat read' }])
    const controller = new PetSettingsCardController(fakeScope())
    await settle()
    const state = controller.inject().hooks.petSettingsCard.getSnapshot()
    expect(state.petDiagnostics).toEqual([{ level: 'warning', message: 'pet x: v1 compat read' }])
    expect(state.petChoices).toEqual([{ value: 'whale-girl', label: '鲸鱼娘' }])
    controller.dispose()
  })

  it('degrades to an empty diagnostics list when the endpoint fails', async () => {
    stubFetch('fail')
    const controller = new PetSettingsCardController(fakeScope())
    await settle()
    const state = controller.inject().hooks.petSettingsCard.getSnapshot()
    expect(state.petDiagnostics).toEqual([])
    expect(state.petChoices).toEqual([{ value: 'whale-girl', label: '鲸鱼娘' }])
    controller.dispose()
  })
})
