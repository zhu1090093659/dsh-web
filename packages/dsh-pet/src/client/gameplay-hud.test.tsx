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

function snapshot(view: PetGameplayStateView): PetStateView {
  return {
    animation: 'idle',
    phase: 'idle',
    sessionActive: false,
    sessions: [],
    affinity: { points: 0, rank: '幼鲸', rankEmoji: '*', pets: 0, feeds: 0, turns: 0, petCooldown: false, feedCooldown: false },
    display: { visible: true, size: 160, right: 24, bottom: 20 },
    pet: { id: 'miku', displayName: 'Miku', description: '' },
    name: 'Miku',
    treats: { stocked: 0, max: 5 },
    gameplay: view,
  }
}

interface Harness {
  store: PetStoreInstance
  bus: GameplayBus
  api: GameplayApi & { touch: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn>; workTick: ReturnType<typeof vi.fn>; buy: ReturnType<typeof vi.fn> }
  setTrack: ReturnType<typeof vi.fn>
  drag: ReturnType<typeof createDragStream>
  setView: (view: PetGameplayStateView) => void
}

function harness(view: PetGameplayStateView = gameplayView()): Harness {
  const store = createPetStore().create()
  store.actions.setSnapshot(snapshot(view))
  const bus: GameplayBus = {}
  const setTrack = vi.fn()
  bus.setTrack = setTrack
  const drag = createDragStream()
  const ok = (patch?: Partial<PetGameplayVerbResult>): PetGameplayVerbResult => ({ ok: true, ...patch })
  const api = {
    touch: vi.fn(async () => ok({ hit: true, state: 'happy', stateMs: 3000, phrase: 'happy!', view: gameplayView({ stats: { ...VIEW.stats, affection: 105 } }) })),
    setMode: vi.fn(async (mode: 'work' | 'sleep' | null) => ok({ view: gameplayView({ mode }) })),
    workTick: vi.fn(async () => ok({ outcome: 'success' as const, view: gameplayView({ mode: 'work' }) })),
    buy: vi.fn(async () => ok({ view: gameplayView() })),
  }
  const setView = (next: PetGameplayStateView): void => store.actions.setSnapshot(snapshot(next))
  render(<GameplayHud definition={petDefinition()} store={store} api={api} bus={bus} drag={drag} t={t} />)
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

  it('runs the idle director: weighted act rolls on the interval', async () => {
    const h = harness()
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(h.setTrack).toHaveBeenCalledWith('eat')
    // A non-idle phase suppresses the roll.
    h.store.actions.setSnapshot(snapshot(gameplayView()))
    h.setTrack.mockClear()
    const busy = snapshot(gameplayView())
    busy.phase = 'thinking'
    await act(async () => {
      h.store.actions.setSnapshot(busy)
    })
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })
    expect(h.setTrack).not.toHaveBeenCalled()
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
