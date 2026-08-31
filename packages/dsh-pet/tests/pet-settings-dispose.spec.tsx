/** @vitest-environment jsdom */

/**
 * Pet settings card timer cleanup (T3-2): the controller defers its first
 * registry request and retries a failed load after 3s; both timers and any
 * in-flight loader must stop once dispose() runs, so a settings-section
 * teardown (fiber disposal, plugin hot reload) never fires a store update
 * on a disposed controller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      set: vi.fn((next: unknown) => { value = next; for (const listener of listeners) listener() }),
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

/** The set spy on the controller's bound snapshot store (mock above). */
function setSpyOf(controller: PetSettingsCardController) {
  return (controller.inject().hooks.petSettingsCard as unknown as { set: ReturnType<typeof vi.fn> }).set
}

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PetSettingsCardController timer cleanup', () => {
  it('cancels the deferred first registry load on dispose', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: 'whale-girl', displayName: '鲸鱼娘（原版）' },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new PetSettingsCardController(fakeScope())
    controller.dispose()

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels the pending retry timer on dispose', async () => {
    const fetchMock = vi.fn(async () => new Response('x', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const controller = new PetSettingsCardController(fakeScope())
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    controller.dispose()
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not publish a fetch that settles after dispose', async () => {
    let resolvePets: (response: Response) => void = () => {}
    const fetchMock = vi.fn((input: string) => {
      if (input === '/api/pet/pets') return new Promise<Response>(resolve => { resolvePets = resolve })
      return Promise.resolve(new Response(JSON.stringify({ diagnostics: [] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = new PetSettingsCardController(fakeScope())
    const setSpy = setSpyOf(controller)
    await vi.advanceTimersByTimeAsync(0)
    const publishedBeforeDispose = setSpy.mock.calls.length
    expect(publishedBeforeDispose).toBeGreaterThan(0)

    controller.dispose()
    resolvePets(new Response(JSON.stringify([
      { id: 'whale-girl', displayName: '鲸鱼娘（原版）' },
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await vi.advanceTimersByTimeAsync(0)

    expect(setSpy.mock.calls.length).toBe(publishedBeforeDispose)
    const state = controller.inject().hooks.petSettingsCard.getSnapshot()
    expect(state.petChoices).toEqual([])
  })
})
