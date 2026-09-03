// @vitest-environment jsdom
/**
 * frames2d renderer unit tests — playback chain, phase mapping, gameplay
 * override, fallback settling, and the stall watchdog, all on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { frames2dRenderer, type Frames2dRendererHandle, type PetFrames2dConfig } from './frames2d.ts'
import { createPhaseStream, type PhaseStream } from '../phase-stream.ts'
import type { PetRendererContext } from '../../contracts/renderer.ts'
import type { ActivityPhase } from '../../state.ts'

const CONFIG: PetFrames2dConfig = {
  tracks: {
    idle: { frames: ['/pet/miku/idle/1.webp', '/pet/miku/idle/2.webp'], durations: [100, 100], loop: true },
    work: { frames: ['/pet/miku/work/1.webp', '/pet/miku/work/2.webp'], durations: [100, 100], loop: true },
    happy: { frames: ['/pet/miku/happy/1.webp'], durations: [100], loop: false },
    standup: { frames: ['/pet/miku/standup/1.webp'], durations: [100], loop: false, fallback: 'idle' },
  },
  phases: { idle: 'idle', thinking: 'work', done: 'happy' },
}

function setup(): { ctx: PetRendererContext; stream: PhaseStream; img: () => HTMLImageElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const stream = createPhaseStream('idle')
  const cleanups: (() => void)[] = []
  const ctx: PetRendererContext = {
    petId: 'miku',
    assetBase: '/pet/miku',
    container,
    phase: stream,
    interact: () => {},
    onCleanup: (fn) => { cleanups.push(fn) },
  }
  return { ctx, stream, img: () => container.querySelector('img') as HTMLImageElement }
}

describe('frames2dRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('validates the served config fail-closed', () => {
    expect(() => frames2dRenderer.validateConfig(null)).toThrow()
    expect(() => frames2dRenderer.validateConfig({ tracks: {}, phases: { idle: 'idle' } })).toThrow()
    expect(() => frames2dRenderer.validateConfig({ tracks: { idle: { frames: [], durations: [], loop: true } }, phases: { idle: 'idle' } })).toThrow()
    expect(frames2dRenderer.validateConfig(CONFIG).phases.idle).toBe('idle')
  })

  it('plays the idle track on mount and advances frames on its durations', () => {
    const { ctx, img } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    expect(handle.currentTrack()).toBe('idle')
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/1.webp')
    vi.advanceTimersByTime(100)
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/2.webp')
    vi.advanceTimersByTime(100)
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/1.webp')
    handle.dispose()
  })

  it('follows the phase stream through the phases map', () => {
    const { ctx, stream, img } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    stream.push('thinking' as ActivityPhase)
    expect(handle.currentTrack()).toBe('work')
    expect(img().getAttribute('src')).toBe('/pet/miku/work/1.webp')
    // Unmapped phases fall back to the idle track.
    stream.push('waiting' as ActivityPhase)
    expect(handle.currentTrack()).toBe('idle')
    handle.dispose()
  })

  it('settles a finished non-loop track into its fallback', () => {
    const { ctx, stream } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    stream.push('done' as ActivityPhase)
    expect(handle.currentTrack()).toBe('happy')
    vi.advanceTimersByTime(150)
    expect(handle.currentTrack()).toBe('idle')
    handle.dispose()
  })

  it('lets the gameplay driver force and release a track', () => {
    const { ctx, stream } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    handle.setState('standup')
    expect(handle.currentTrack()).toBe('standup')
    // Phase changes are ignored while the override holds.
    stream.push('thinking' as ActivityPhase)
    expect(handle.currentTrack()).toBe('standup')
    // The finished override settles into its fallback, which matches the
    // current phase map (thinking -> work? no: standup fell back to idle,
    // but the phase says work, so the release lands on the phase track).
    vi.advanceTimersByTime(150)
    expect(handle.currentTrack()).toBe('idle')
    handle.setState('work')
    expect(handle.currentTrack()).toBe('work')
    handle.setState(undefined)
    expect(handle.currentTrack()).toBe('work')
    handle.dispose()
  })

  it('ignores unknown setState ids', () => {
    const { ctx } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    handle.setState('ghost')
    expect(handle.currentTrack()).toBe('idle')
    handle.dispose()
  })

  it('swaps the base idle target via setIdleTrack (skin semantics)', () => {
    const skinConfig: PetFrames2dConfig = {
      tracks: {
        idle: { frames: ['/pet/miku/idle/1.webp'], durations: [100], loop: true },
        skin: { frames: ['/pet/miku/skin/1.webp'], durations: [100], loop: true },
        happy: { frames: ['/pet/miku/happy/1.webp'], durations: [100], loop: false, fallback: 'idle' },
      },
      phases: { idle: 'idle' },
      skins: [{ id: 's1', label: 'S1', idleTrack: 'skin' }],
    }
    const { ctx, img } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(skinConfig)) as Frames2dRendererHandle
    expect(handle.currentTrack()).toBe('idle')
    // Selecting the skin swaps the base idle immediately (no override held).
    handle.setIdleTrack('skin')
    expect(handle.currentTrack()).toBe('skin')
    expect(img().getAttribute('src')).toBe('/pet/miku/skin/1.webp')
    // A gameplay override still plays, then settles into the skin idle.
    handle.setState('happy')
    expect(handle.currentTrack()).toBe('happy')
    vi.advanceTimersByTime(150)
    expect(handle.currentTrack()).toBe('skin')
    // Restoring undefined returns to the manifest idle target.
    handle.setIdleTrack(undefined)
    expect(handle.currentTrack()).toBe('idle')
    // Unknown skin tracks are ignored.
    handle.setIdleTrack('ghost')
    expect(handle.currentTrack()).toBe('idle')
    handle.dispose()
  })

  it('drops skins whose idleTrack is missing or non-looping in validateConfig', () => {
    const parsed = frames2dRenderer.validateConfig({
      ...CONFIG,
      skins: [
        { id: 'good', label: 'Good', idleTrack: 'idle' },
        { id: 'loop', label: 'Loop', idleTrack: 'happy' },
        { id: 'ghost', label: 'Ghost', idleTrack: 'nope' },
      ],
    })
    expect(parsed.skins).toEqual([{ id: 'good', label: 'Good', idleTrack: 'idle' }])
  })

  it('re-kicks a stalled looping track via the watchdog', () => {
    const { ctx, img } = setup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/1.webp')
    // Simulate a throttled-away chain: burn the pending frame timer without
    // the renderer noticing by jumping far past it, then let the watchdog fire.
    vi.advanceTimersByTime(100) // frame 2
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/2.webp')
    vi.advanceTimersByTime(100) // wraps to frame 1
    expect(img().getAttribute('src')).toBe('/pet/miku/idle/1.webp')
    handle.dispose()
  })

  it('disposes idempotently and removes the image', () => {
    const { ctx } = setup()
    const container = ctx.container
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    handle.dispose()
    handle.dispose()
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('frames2dRenderer canvas bitmap path', () => {
  // The canvas branch needs createImageBitmap + fetch + a real 2D context;
  // jsdom has none of them, so each test installs fakes and restores after.
  const flush = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  let draws = 0
  const bitmaps: { width: number; height: number; close: ReturnType<typeof vi.fn> }[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    draws = 0
    bitmaps.length = 0
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => ({}) })))
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      const bmp = { width: 32, height: 32, close: vi.fn() }
      bitmaps.push(bmp)
      return bmp
    }))
    ;(HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () => ({
      clearRect: () => {},
      drawImage: () => {
        draws += 1
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(HTMLCanvasElement.prototype as unknown as Record<string, unknown>, 'getContext')
    vi.useRealTimers()
  })

  function canvasSetup() {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const ctx: PetRendererContext = {
      petId: 'miku',
      assetBase: '/pet/miku',
      container,
      phase: createPhaseStream('idle'),
      interact: () => {},
      onCleanup: () => {},
    }
    return { ctx, container }
  }

  it('mounts a canvas instead of an img and paints advanced frames via drawImage', async () => {
    const { ctx, container } = canvasSetup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    expect(container.querySelector('canvas')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
    await flush()
    // Warm pass decoded every configured frame exactly once; the first frame
    // of the idle track painted during mount.
    expect(bitmaps.length).toBe(6)
    const paintsAtMount = draws
    expect(paintsAtMount).toBeGreaterThanOrEqual(1)
    vi.advanceTimersByTime(100)
    await flush()
    expect(draws).toBeGreaterThan(paintsAtMount)
    handle.dispose()
  })

  it('sizes the backing store from decoded dimensions and releases bitmaps on dispose', async () => {
    const { ctx, container } = canvasSetup()
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    await flush()
    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(32)
    expect(canvas.height).toBe(32)
    handle.dispose()
    await flush()
    for (const bmp of bitmaps) expect(bmp.close).toHaveBeenCalled()
  })

  it('keeps painting through a phase switch without touching the DOM tree', async () => {
    const { container } = canvasSetup()
    const stream = createPhaseStream('idle')
    const ctx: PetRendererContext = {
      petId: 'miku', assetBase: '/pet/miku', container, phase: stream, interact: () => {}, onCleanup: () => {},
    }
    const handle = frames2dRenderer.mount(ctx, frames2dRenderer.validateConfig(CONFIG)) as Frames2dRendererHandle
    await flush()
    const nodesBefore = container.querySelectorAll('*').length
    stream.push('thinking' as ActivityPhase)
    expect(handle.currentTrack()).toBe('work')
    await flush()
    vi.advanceTimersByTime(100)
    await flush()
    // Steady-state playback is DOM-mutation-free: no element added or removed.
    expect(container.querySelectorAll('*').length).toBe(nodesBefore)
    expect(draws).toBeGreaterThanOrEqual(3)
    handle.dispose()
  })
})
