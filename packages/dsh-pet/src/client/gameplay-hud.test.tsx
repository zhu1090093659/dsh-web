// @vitest-environment jsdom
/**
 * GameplayHud behavior tests: menu pages, touch taps through the bus, the
 * idle director, the work/sleep loops and shop purchases — all with a mock
 * verb API and fake timers so every roll is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the defineStore
// the pet store needs (same fake-store pattern as PetDockEntry.test.tsx).
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: {
    init: () => unknown
    actions: Record<string, (draft: never, ...args: never[]) => void>
  }) => ({
    create: () => {
      let value = spec.init()
      const listeners = new Set<() => void>()
      const actions: Record<string, (...args: unknown[]) => void> = {}
      for (const [name, fn] of Object.entries(spec.actions)) {
        actions[name] = (...args: unknown[]) => {
          fn(value as never, ...(args as never[]))
          // Re-identity the root so useSyncExternalStore actually re-renders
          // (the real engine store produces a fresh state per action).
          value = { ...(value as Record<string, unknown>) }
          for (const listener of listeners) listener()
        }
      }
      return {
        getSnapshot: () => value,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        actions,
      }
    },
  }),
}))
import { GameplayHud, type GameplayApi, type GameplayBus } from './gameplay-hud.tsx'
import { createPetStore, type PetStoreInstance } from './pet-store.ts'
import { createDragStream } from './drag-stream.ts'
import { t } from './locales.ts'
import type { PetDefinition } from '../registry.ts'
import type { PetGameplayStateView, PetGameplayVerbResult, PetStateView } from '../service.ts'
import type { ActivityPhase } from '../state.ts'

const VIEW: PetGameplayStateView = {
  stats: { hunger: 100, mood: 100, energy: 100, affection: 100 },
  mode: null,
}

function gameplayView(patch?: Partial<PetGameplayStateView>): PetGameplayStateView {
  return { stats: { ...VIEW.stats }, mode: null, ...patch }
}

function petDefinition(): PetDefinition {
  return {
    id: 'miku',
    displayName: 'Miku',
    description: 'frames2d gameplay pet',
    renderer: 'frames2d',
    cell: { width: 100, height: 100 },
    columns: 8,
    rows: [6, 8, 8, 4, 5, 8, 6, 6, 6],
    atlasRows: 9,
    tracks: {} as PetDefinition['tracks'],
    atlasUrl: '/pet/miku/thumb/idle/idle_1_200.webp',
    manifestUrl: '/pet/miku/pet.json',
    frames2d: {
      tracks: {
        idle: { frames: ['/pet/miku/thumb/idle/idle_1_200.webp'], durations: [200], loop: true },
        happy: { frames: ['/pet/miku/thumb/happy/happy_1_200.webp'], durations: [200], loop: false, fallback: 'idle' },
        work: { frames: ['/pet/miku/thumb/work/work_1_200.webp'], durations: [200], loop: true },
        success: { frames: ['/pet/miku/thumb/success/success_1_200.webp'], durations: [200], loop: false, fallback: 'idle' },
        fail: { frames: ['/pet/miku/thumb/fail/fail_1_200.webp'], durations: [200], loop: false, fallback: 'idle' },
        sleep: { frames: ['/pet/miku/thumb/sleep/sleep_1_200.webp'], durations: [200], loop: true },
        eat: { frames: ['/pet/miku/thumb/eat/eat_1_200.webp'], durations: [200], loop: false, fallback: 'idle' },
      },
      phases: { idle: 'idle', done: 'success', failed: 'fail' },
    },
    gameplay: {
      idleDirector: { intervalMs: 5000, maxMiss: 2, idleWeight: 0, acts: [{ track: 'eat', weight: 1 }] },
      stats: {
        hunger: { max: 100 },
        mood: { max: 100 },
        energy: { max: 100 },
        affection: { max: 500, initial: 100 },
      },
      hitBox: { x0: 0, y0: 0, x1: 1, y1: 1 },
      touch: {
        zones: [
          { name: 'head', y0: 0, y1: 0.55, branches: [{ probability: 1, effects: [{ stat: 'affection', amount: 5 }], state: 'happy', stateMs: 3000, phrases: ['happy!'] }] },
        ],
        clickBoost: { stat: 'mood', min: 0, max: 3 },
      },
      work: {
        state: 'work', successState: 'success', failState: 'fail', tickMs: 10_000,
        resultMs: { success: 1300, fail: 1900 }, successProbability: 0.5,
        success: { effects: [{ currency: 'treats', amount: 1 }] },
      },
      sleep: { state: 'sleep', restore: { stat: 'energy', amount: 4, intervalMs: 30_000 } },
      shop: {
        items: [
          { id: 'food1', label: 'Bread', image: '/pet/miku/thumb/shop/food.webp', price: 2, currency: 'treats', effects: [{ stat: 'hunger', amount: 40 }] },
          { id: 'lottery', label: 'Ticket', price: 3, currency: 'treats', lottery: { currency: 'treats', tiers: [{ probability: 1, prize: 5 }] } },
        ],
      },
    },
  }
}

function snapshot(view: PetGameplayStateView, skin?: string, phase: ActivityPhase = 'idle'): PetStateView {
  return {
    animation: 'idle',
    phase,
    sessionActive: false,
    sessions: [],
    affinity: { points: 0, rank: '幼鲸', rankEmoji: '*', pets: 0, feeds: 0, turns: 0, petCooldown: false, feedCooldown: false },
    display: { visible: true, size: 160, right: 24, bottom: 20, bubbleScale: 1 },
    pet: { id: 'miku', displayName: 'Miku', description: '' },
    name: 'Miku',
    treats: { stocked: 0, max: 5 },
    ...(skin === undefined ? {} : { skin }),
    gameplay: view,
  }
}

interface Harness {
  store: PetStoreInstance
  bus: GameplayBus
  api: GameplayApi & { touch: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn>; workTick: ReturnType<typeof vi.fn>; buy: ReturnType<typeof vi.fn>; setSkin: ReturnType<typeof vi.fn> }
  setTrack: ReturnType<typeof vi.fn>
  drag: ReturnType<typeof createDragStream>
  setView: (view: PetGameplayStateView) => void
}

function harness(view: PetGameplayStateView = gameplayView(), definition: PetDefinition = petDefinition()): Harness {
  const store = createPetStore().create()
  store.actions.setSnapshot(snapshot(view))
  const bus: GameplayBus = {}
  const setTrack = vi.fn()
  bus.setTrack = setTrack
  const drag = createDragStream()
  const ok = (patch?: Partial<PetGameplayVerbResult>): PetGameplayVerbResult => ({ ok: true, ...patch })
  const api = {
    touch: vi.fn(async () => ok({ hit: true, state: 'happy', stateMs: 3000, phrase: 'happy!', view: gameplayView({ stats: { ...VIEW.stats, affection: 105 } }) })),
    setMode: vi.fn(async (mode: string | null) => ok({ view: gameplayView({ mode }) })),
    workTick: vi.fn(async () => ok({ outcome: 'success' as const, view: gameplayView({ mode: 'work' }) })),
    buy: vi.fn(async () => ok({ view: gameplayView() })),
    setSkin: vi.fn(async () => ({ ok: true })),
  }
  const setView = (next: PetGameplayStateView): void => store.actions.setSnapshot(snapshot(next))
  render(<GameplayHud definition={definition} store={store} api={api} bus={bus} drag={drag} t={t} />)
  return { store, bus, api, setTrack, drag, setView }
}

describe('GameplayHud', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('roams on its interval: walks through the bus and holds the walk track', () => {
    const definition = petDefinition()
    definition.gameplay = {
      ...definition.gameplay,
      // Park the director far away so this test isolates the roam roll (an act
      // firing on the same tick owns the visual and skips the roam).
      idleDirector: { intervalMs: 60_000, maxMiss: 2, idleWeight: 0, acts: [{ track: 'eat', weight: 1 }] },
      roam: { state: 'happy', intervalMs: 5000, probability: 1, distanceMin: 100, distanceMax: 100, speed: 100 },
    }
    const h = harness(gameplayView(), definition)
    const walk = vi.fn((_direction: string, _distance: number, _speed: number) => 100)
    h.bus.walk = walk
    act(() => { vi.advanceTimersByTime(5000) })
    expect(walk).toHaveBeenCalledTimes(1)
    const first = walk.mock.calls[0] ?? ['left', 0, 0]
    expect(['up', 'down', 'left', 'right']).toContain(first[0])
    expect(first[1]).toBe(100)
    expect(first[2]).toBe(100)
    expect(h.setTrack).toHaveBeenCalledWith('happy')
    // The hold is exactly the travel time (100 px at 100 px/s), then released.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(h.setTrack).toHaveBeenLastCalledWith(undefined)
    // A pet with no room to move does not hold the walk art at all (the
    // idle director's own setTrack calls are ignored here).
    walk.mockReturnValue(0)
    act(() => { vi.advanceTimersByTime(5000) })
    expect(walk).toHaveBeenCalledTimes(2)
    expect(h.setTrack.mock.calls.filter(call => call[0] === 'happy')).toHaveLength(1)
  })

  it('roams outside the idle phase too (ambient wandering)', () => {
    const definition = petDefinition()
    definition.gameplay = {
      ...definition.gameplay,
      idleDirector: { intervalMs: 60_000, maxMiss: 2, idleWeight: 0, acts: [{ track: 'eat', weight: 1 }] },
      roam: { state: 'happy', intervalMs: 5000, probability: 1, distanceMin: 100, distanceMax: 100, speed: 100 },
    }
    const h = harness(gameplayView(), definition)
    // The agent is mid-tool-call: the pet still wanders (only the director's
    // acts are idle-gated).
    h.store.actions.setSnapshot(snapshot(gameplayView(), undefined, 'tool'))
    const walk = vi.fn((_direction: string, _distance: number, _speed: number) => 100)
    h.bus.walk = walk
    act(() => { vi.advanceTimersByTime(5000) })
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('never lets a finished walk release a track another owner took over', () => {
    const definition = petDefinition()
    definition.gameplay = {
      ...definition.gameplay,
      idleDirector: { intervalMs: 60_000, maxMiss: 2, idleWeight: 0, acts: [{ track: 'eat', weight: 1 }] },
      roam: { state: 'happy', intervalMs: 5000, probability: 1, distanceMin: 100, distanceMax: 100, speed: 100 },
    }
    const h = harness(gameplayView(), definition)
    h.bus.walk = vi.fn((_direction: string, _distance: number, _speed: number) => 100)
    // The staggered first roam tick starts a 1 s walk and holds the track.
    act(() => { vi.advanceTimersByTime(2500) })
    expect(h.setTrack).toHaveBeenCalledWith('happy')
    // The user enters sleep mid-walk: the mode loop takes the slot.
    act(() => { h.store.actions.setSnapshot(snapshot(gameplayView({ mode: 'sleep' }))) })
    expect(h.setTrack).toHaveBeenLastCalledWith('sleep')
    // The walk's hold window elapses: it must not clear the sleep track.
    act(() => { vi.advanceTimersByTime(3000) })
    expect(h.setTrack).toHaveBeenLastCalledWith('sleep')
  })

  it('keeps the roam from cutting into an idle-director act', () => {
    const definition = petDefinition()
    definition.frames2d!.tracks.eat!.durations = [60_000]
    definition.gameplay = {
      ...definition.gameplay,
      idleDirector: { intervalMs: 2000, maxMiss: 2, idleWeight: 0, acts: [{ track: 'eat', weight: 1 }] },
      roam: { state: 'happy', intervalMs: 6000, probability: 1, distanceMin: 100, distanceMax: 100, speed: 100 },
    }
    const h = harness(gameplayView(), definition)
    const walk = vi.fn((_direction: string, _distance: number, _speed: number) => 100)
    h.bus.walk = walk
    // 2 s: the director fires its act, which owns the visual for its duration.
    act(() => { vi.advanceTimersByTime(2000) })
    expect(h.setTrack).toHaveBeenCalledWith('eat')
    // 3 s: the roam's staggered first tick lands, but the act still owns the pet.
    act(() => { vi.advanceTimersByTime(1000) })
    expect(walk).not.toHaveBeenCalled()
  })

  it('opens the menu card through the bus openCard channel and shows the shop page', () => {
    const h = harness()
    expect(h.bus.openCard).toBeDefined()
    act(() => { h.bus.openCard?.() })
    expect(screen.getByText('饱食')).toBeDefined()
    expect(screen.getByText('好感')).toBeDefined()
    fireEvent.click(screen.getByText('商店'))
    expect(screen.getByText('Bread')).toBeDefined()
    fireEvent.click(screen.getByText('返回'))
    expect(screen.getByText('打工')).toBeDefined()
    // The wallet page is gone: no wallet action anywhere in the card.
    expect(screen.queryByText('钱包')).toBeNull()
  })


  it('opens the card beside the pet, on the right when the space allows', () => {
    // The parent float box (160x160) sits away from the viewport edges, so
    // the right side fits the measured card width and the card anchors to
    // the sprite's right edge, clamped to the sprite height.
    const rect = (w: number, h: number, x: number, y: number): DOMRect => ({
      top: y, right: x + w, bottom: y + h, left: x, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.className.includes('gameplayHud')) return rect(0, 0, 300, 600)
      if (this.className.includes('gameplayCard')) return rect(240, 150, 0, 600)
      return rect(160, 160, 300, 600)
    })
    const h = harness()
    act(() => { h.bus.openCard?.() })
    const card = document.querySelector('[data-page]') as HTMLElement
    // Right side: sprite width + 8px gap; vertically centered (up by half
    // the sprite height); clamped to the sprite height (scrolls inside).
    expect(card.style.transform).toContain('translate(168px, -80px)')
    expect(card.style.maxHeight).toBe('160px')
  })

  it('flips the card to the left when the pet is parked near the right edge', () => {
    const rect = (w: number, h: number, x: number, y: number): DOMRect => ({
      top: y, right: x + w, bottom: y + h, left: x, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.className.includes('gameplayHud')) return rect(0, 0, 1080, 600)
      if (this.className.includes('gameplayCard')) return rect(240, 150, 0, 600)
      return rect(160, 160, 1080, 600)
    })
    const h = harness()
    act(() => { h.bus.openCard?.() })
    const card = document.querySelector('[data-page]') as HTMLElement
    // Only 40px remain to the right of the pet: the card opens to the left
    // of the sprite (measured card width + 8px gap).
    expect(card.style.transform).toContain('translate(-248px, -80px)')
  })

  it('toggles the card through openCard and closes with the close button', () => {
    const h = harness()
    act(() => { h.bus.openCard?.() })
    expect(screen.getByText('饱食')).toBeDefined()
    // A no-argument call toggles (the panel 玩法 button is a toggle).
    act(() => { h.bus.openCard?.() })
    expect(screen.queryByText('饱食')).toBeNull()
    // An explicit boolean pins the state; the card close button still works.
    act(() => { h.bus.openCard?.(true) })
    expect(screen.getByText('饱食')).toBeDefined()
    fireEvent.click(screen.getByLabelText('返回'))
    expect(screen.queryByText('饱食')).toBeNull()
  })

  it('runs a touch tap through the bus: zone verb, track hold, phrase bubble', async () => {
    const h = harness()
    expect(h.bus.tap).toBeDefined()
    await act(async () => {
      h.bus.tap!(0.5, 0.3)
    })
    expect(h.api.touch).toHaveBeenCalledWith('head')
    expect(h.setTrack).toHaveBeenCalledWith('happy')
    expect(h.store.getSnapshot().feedback?.text).toBe('happy!')
    expect(h.store.getSnapshot().snapshot?.gameplay?.stats.affection).toBe(105)
    // The hold releases after stateMs.
    await act(async () => {
      vi.advanceTimersByTime(3100)
    })
    expect(h.setTrack).toHaveBeenCalledWith(undefined)
    // A tap during the hold is the plain-click boost (no zone argument).
    await act(async () => {
      h.bus.tap!(0.5, 0.3)
      h.bus.tap!(0.5, 0.3)
    })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    // Second tap landed inside the lock window? First tap re-locked; third is the boost.
    const calls = h.api.touch.mock.calls.map(args => args[0])
    expect(calls[0]).toBe('head')
  })

  it('ignores taps outside the hit box', async () => {
    const def = petDefinition()
    def.gameplay!.hitBox = { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 }
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView()))
    const api = { touch: vi.fn(), setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn() } as unknown as Harness['api']
    const bus: GameplayBus = { setTrack: vi.fn() }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    await act(async () => {
      bus.tap!(0.9, 0.9)
    })
    expect(api.touch).not.toHaveBeenCalled()
  })

  it('skin taps never fall through to the default touch zones', async () => {
    // A skinned pet whose skin has no click actions: taps must resolve to
    // the plain click boost (touch() without a zone) instead of playing the
    // default pet's touch reactions (safety: skin ≠ default gameplay).
    const def = petDefinition()
    def.frames2d!.skins = [
      { id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle' },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView()))
    const api = {
      touch: vi.fn(async () => ({ ok: true, view: gameplayView() })),
      setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(),
      setSkin: vi.fn(async () => ({ ok: true })),
    } as unknown as Harness['api']
    const setTrack = vi.fn()
    const bus: GameplayBus = { setTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    // Select the skin through the menu card so skinIdRef is active.
    await act(async () => {
      bus.openCard?.()
    })
    fireEvent.click(screen.getByText('皮肤'))
    fireEvent.click(screen.getByText('蓝海霓裳'))
    await act(async () => {
      bus.tap!(0.5, 0.3) // head zone → default would be the 'happy' state
    })
    // No zone verb, no default track: the tap is a plain boost only.
    expect(api.touch).toHaveBeenCalledWith()
    expect(api.touch).not.toHaveBeenCalledWith('head')
    expect(setTrack).not.toHaveBeenCalledWith('happy')
  })

  it('plays the skin click action on a rolled hit and skips the default touch', async () => {
    const def = petDefinition()
    def.frames2d!.skins = [
      {
        id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle',
        clickActions: [{ track: 'lanhainishang-lift-skirt', probability: 0.3 }],
      },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView()))
    const api = {
      touch: vi.fn(async () => ({ ok: true, view: gameplayView() })),
      setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(),
      setSkin: vi.fn(async () => ({ ok: true })),
    } as unknown as Harness['api']
    const setTrack = vi.fn()
    const bus: GameplayBus = { setTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    await act(async () => {
      bus.openCard?.()
    })
    fireEvent.click(screen.getByText('皮肤'))
    fireEvent.click(screen.getByText('蓝海霓裳'))
    // Force a hit (roll < 0.3).
    vi.spyOn(Math, 'random').mockReturnValue(0.1)
    await act(async () => {
      bus.tap!(0.5, 0.3)
    })
    vi.restoreAllMocks()
    expect(setTrack).toHaveBeenCalledWith('lanhainishang-lift-skirt')
    expect(api.touch).not.toHaveBeenCalledWith('head')
  })

  it('restores the host-persisted skin and pushes its idle track on mount', () => {
    // Reload / client restart: the state view carries the last choice, so the
    // renderer repaints the selected skin without any interaction.
    const def = petDefinition()
    def.frames2d!.skins = [
      { id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle' },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView(), 'lanhainishang'))
    const setSkin = vi.fn(async () => ({ ok: true }))
    const api = { touch: vi.fn(), setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(), setSkin } as unknown as Harness['api']
    const setIdleTrack = vi.fn()
    const bus: GameplayBus = { setTrack: vi.fn(), setIdleTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    expect(setIdleTrack).toHaveBeenLastCalledWith('lanhainishang-idle')
    // Latched on the bus too, so a later (re)mount re-applies it.
    expect(bus.idleTrack).toBe('lanhainishang-idle')
    // Restoring is read-only: mounting never writes the choice back.
    expect(setSkin).not.toHaveBeenCalled()
  })

  it('persists the skin selection through the host API', async () => {
    const def = petDefinition()
    def.frames2d!.skins = [
      { id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle' },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView()))
    const setSkin = vi.fn(async () => ({ ok: true }))
    const api = { touch: vi.fn(), setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(), setSkin } as unknown as Harness['api']
    const setIdleTrack = vi.fn()
    const bus: GameplayBus = { setTrack: vi.fn(), setIdleTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    await act(async () => {
      bus.openCard?.()
    })
    fireEvent.click(screen.getByText('皮肤'))
    await act(async () => {
      fireEvent.click(screen.getByText('蓝海霓裳'))
    })
    expect(setIdleTrack).toHaveBeenLastCalledWith('lanhainishang-idle')
    expect(setSkin).toHaveBeenCalledWith('lanhainishang')
  })

  it('clears the persisted skin when the default look is picked', async () => {
    const def = petDefinition()
    def.frames2d!.skins = [
      { id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle' },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView(), 'lanhainishang'))
    const setSkin = vi.fn(async () => ({ ok: true }))
    const api = { touch: vi.fn(), setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(), setSkin } as unknown as Harness['api']
    const setIdleTrack = vi.fn()
    const bus: GameplayBus = { setTrack: vi.fn(), setIdleTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    await act(async () => {
      bus.openCard?.()
    })
    fireEvent.click(screen.getByText('皮肤'))
    await act(async () => {
      fireEvent.click(screen.getByText('默认'))
    })
    expect(setSkin).toHaveBeenCalledWith(undefined)
    expect(setIdleTrack).toHaveBeenLastCalledWith(undefined)
  })

  it('falls back to the served skin when the host rejects the choice', async () => {
    const def = petDefinition()
    def.frames2d!.skins = [
      { id: 'lanhainishang', label: '蓝海霓裳', idleTrack: 'lanhainishang-idle' },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView()))
    const setSkin = vi.fn(async () => ({ ok: false, error: 'unknown-skin' }))
    const api = { touch: vi.fn(), setMode: vi.fn(), workTick: vi.fn(), buy: vi.fn(), setSkin } as unknown as Harness['api']
    const setIdleTrack = vi.fn()
    const bus: GameplayBus = { setTrack: vi.fn(), setIdleTrack }
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    await act(async () => {
      bus.openCard?.()
    })
    fireEvent.click(screen.getByText('皮肤'))
    await act(async () => {
      fireEvent.click(screen.getByText('蓝海霓裳'))
      // The rejected write settles on a later microtask; flush it so the
      // rollback render reaches the bus before the assertion.
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(setSkin).toHaveBeenCalledWith('lanhainishang')
    // The rejected optimistic swap rolls back to what the host still serves.
    expect(setIdleTrack).toHaveBeenLastCalledWith(undefined)
  })

  it('runs the idle director: weighted act rolls on the interval', async () => {
    const h = harness()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(h.setTrack).toHaveBeenCalledWith('eat')
    // Ambient acts are not phase-gated: while the agent works (thinking/tool)
    // the roll still fires, otherwise she would only ever act when nobody is
    // busy -- the idle phase is rare while an active session is running.
    h.setTrack.mockClear()
    const busy = snapshot(gameplayView())
    busy.phase = 'thinking'
    await act(async () => {
      h.store.actions.setSnapshot(busy)
    })
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(h.setTrack).toHaveBeenCalledWith('eat')
  })

  it('drives the work loop: work track, adjudicated ticks, result hold', async () => {
    const h = harness(gameplayView({ mode: 'work' }))
    expect(h.setTrack).toHaveBeenCalledWith('work')
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(h.api.workTick).toHaveBeenCalled()
    expect(h.setTrack).toHaveBeenCalledWith('success')
    // Result hold (1300ms) then back to the work loop track.
    await act(async () => {
      vi.advanceTimersByTime(1400)
    })
    expect(h.setTrack).toHaveBeenLastCalledWith('work')
    // The tick view lands in the store (treats ride the panel ledger, not the view).
    expect(h.store.getSnapshot().snapshot?.gameplay?.mode).toBe('work')
  })

  it('drops a late work adjudication once the mode has been left', async () => {
    // #1495: the tick RPC can still be in flight when the user exits work mode;
    // its result must not write the work view back or play the result track.
    const h = harness(gameplayView({ mode: 'work' }))
    let resolveTick: ((result: PetGameplayVerbResult) => void) | undefined
    h.api.workTick.mockImplementationOnce(() => new Promise<PetGameplayVerbResult>((resolve) => { resolveTick = resolve }))
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(h.api.workTick).toHaveBeenCalledTimes(1)
    await act(async () => {
      h.setView(gameplayView({ mode: null }))
    })
    await act(async () => {
      resolveTick?.({ ok: true, outcome: 'success', view: gameplayView({ mode: 'work' }) })
      await Promise.resolve()
    })
    expect(h.store.getSnapshot().snapshot?.gameplay?.mode).toBeNull()
    expect(h.setTrack).not.toHaveBeenCalledWith('success')
  })

  it('drives the skin work loop and its skin result animation on the shared 10s rule', async () => {
    // A skin supplies its own work / result art, but the adjudication rule
    // (10s tick, 50% roll, result hold) stays the pet-level gameplay.work rule.
    const def = petDefinition()
    def.frames2d!.tracks['skin-work'] = { frames: ['/pet/miku/skin-work_1.webp'], durations: [200], loop: true }
    def.frames2d!.tracks['skin-success'] = { frames: ['/pet/miku/skin-ok_1.webp'], durations: [200], loop: false, fallback: 'skin-work' }
    def.frames2d!.skins = [
      {
        id: 'skin', label: 'Skin', idleTrack: 'idle',
        // The override key is the manifest's successState ('success' in this fixture).
        gameplayTracks: { work: 'skin-work', success: 'skin-success' },
      },
    ]
    const store = createPetStore().create()
    store.actions.setSnapshot(snapshot(gameplayView({ mode: 'work' }), 'skin'))
    const setTrack = vi.fn()
    const bus: GameplayBus = { setTrack }
    const api = {
      touch: vi.fn(), setMode: vi.fn(),
      workTick: vi.fn(async () => ({ ok: true, outcome: 'success' as const, view: gameplayView({ mode: 'work' }) })),
      buy: vi.fn(), setSkin: vi.fn(async () => ({ ok: true })),
    } as unknown as Harness['api']
    render(<GameplayHud definition={def} store={store} api={api} bus={bus} drag={createDragStream()} t={t} />)
    // The mode hold uses the skin's own work loop, not the manifest track.
    expect(setTrack).toHaveBeenCalledWith('skin-work')
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    // One adjudication per 10s window, then the skin's own result animation.
    expect(api.workTick).toHaveBeenCalledTimes(1)
    expect(setTrack).toHaveBeenCalledWith('skin-success')
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    // The result holds for resultMs, then the skin work loop resumes ...
    expect(setTrack).toHaveBeenLastCalledWith('skin-work')
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    // ... and the next 10s round adjudicates again.
    expect(api.workTick).toHaveBeenCalledTimes(2)
  })

  it('holds the sleep track and wakes on drag', async () => {
    const h = harness(gameplayView({ mode: 'sleep' }))
    expect(h.setTrack).toHaveBeenCalledWith('sleep')
    await act(async () => {
      h.drag.push(true)
    })
    expect(h.api.setMode).toHaveBeenCalledWith(null)
    expect(h.store.getSnapshot().snapshot?.gameplay?.mode).toBeNull()
  })

  it('buys shop items and floats the lottery prize', async () => {
    const h = harness()
    h.api.buy.mockResolvedValueOnce({ ok: false, error: 'insufficient-funds', view: gameplayView() })
    h.api.buy.mockResolvedValueOnce({ ok: true, prize: { amount: 5, currency: 'treats' }, view: gameplayView() })
    act(() => { h.bus.openCard?.() })
    fireEvent.click(screen.getByText('商店'))
    expect(screen.getByText('Bread')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByText('Bread'))
    })
    expect(h.api.buy).toHaveBeenCalledWith('food1')
    expect(screen.getByText('小鱼干不足')).toBeDefined()
    await act(async () => {
      fireEvent.click(screen.getByText('Ticket'))
    })
    expect(screen.getByText('中奖 +5 小鱼干')).toBeDefined()
  })
})
