// @vitest-environment jsdom
/**
 * Cross-dimension try-on exclusivity (#792 follow-up): the skin and wallpaper
 * try-on sessions must retire each other when the user starts a try-on or an
 * apply in the other dimension, so two exit-try-on rows can never show at
 * once and no preview session outlives the user's move to the other list.
 *
 * The wallpaper side of the wiring lives in the injected bridge built by
 * apply() in src/client/index.ts; the skin side lives in SkinCenter's card
 * handlers. These tests exercise the exact wrapper semantics both sides
 * rely on, against the real WallpaperController + a real controller-shaped
 * skin runtime stub.
 */
import { describe, expect, it, vi } from 'vitest'
import { WallpaperController, type WallpaperDescriptor } from '../src/client/wallpaper.ts'

/** A wallpaper descriptor stub. */
const desc = (id: string): WallpaperDescriptor => ({
  id,
  title: id,
  type: 'scene',
  videoUrl: null,
  webUrl: null,
  frameUrl: '/f.png',
  previewUrl: null,
})

/** A settings-scope stub recording writes. */
const fakeScope = () => {
  const writes: Array<[string, unknown]> = []
  return {
    writes,
    scope: {
      getSnapshot: () => ({ value: {} }),
      set: (k: string, v: unknown) => { writes.push([k, v]) },
      subscribe: () => () => {},
    } as never,
  }
}

/** A controller-shaped runtime stub with an observable preview state. */
const fakeRuntime = () => {
  let previewing = false
  const calls: string[] = []
  return {
    calls,
    controller: {
      tryOn: vi.fn(async () => { previewing = true }),
      exitTryOn: vi.fn(async () => { previewing = false }),
      getState: () => ({ active: null, trying: previewing ? 'x' : null, previewing }),
    },
  }
}

/** The exact wallpaper-side wrappers apply() builds in index.ts. */
const wallpaperBridge = (wallpaper: WallpaperController, runtime: ReturnType<typeof fakeRuntime>) => ({
  tryOn: (d: WallpaperDescriptor): void => {
    if (runtime.controller.getState().previewing) void runtime.controller.exitTryOn()
    wallpaper.tryOn(d)
  },
  applySelection: (d: WallpaperDescriptor): void => {
    if (runtime.controller.getState().previewing) void runtime.controller.exitTryOn()
    wallpaper.applySelection(d)
  },
})

describe('cross-dimension try-on exclusivity', () => {
  it('a wallpaper try-on retires a live skin preview', async () => {
    const { scope } = fakeScope()
    const wallpaper = new WallpaperController(scope, { doc: document })
    const runtime = fakeRuntime()
    await runtime.controller.tryOn(null, null as never)
    expect(runtime.controller.getState().previewing).toBe(true)

    const bridge = wallpaperBridge(wallpaper, runtime)
    bridge.tryOn(desc('w1'))
    expect(runtime.controller.exitTryOn).toHaveBeenCalledTimes(1)
    expect(wallpaper.trying()).toBe(true)
    wallpaper.dispose()
  })

  it('a wallpaper apply retires a live skin preview', () => {
    const { scope } = fakeScope()
    const wallpaper = new WallpaperController(scope, { doc: document })
    const runtime = fakeRuntime()
    return runtime.controller.tryOn(null as never, null).then(() => {
      const bridge = wallpaperBridge(wallpaper, runtime)
      bridge.applySelection(desc('w2'))
      expect(runtime.controller.exitTryOn).toHaveBeenCalledTimes(1)
      expect(wallpaper.selection()).toBe('w2')
      wallpaper.dispose()
    })
  })

  it('a wallpaper action with no live skin preview never calls exitTryOn', () => {
    const { scope } = fakeScope()
    const wallpaper = new WallpaperController(scope, { doc: document })
    const runtime = fakeRuntime()
    const bridge = wallpaperBridge(wallpaper, runtime)
    bridge.applySelection(desc('w3'))
    expect(runtime.controller.exitTryOn).not.toHaveBeenCalled()
    wallpaper.dispose()
  })

  it('the skin-card handler symmetrically retires a wallpaper try-on (handler shape)', () => {
    // The exact guard SkinCenter's card handlers run before starting a skin
    // preview: a live wallpaper try-on is retired first.
    const wallpaper = {
      trying: () => true,
      exitTryOn: vi.fn(),
    }
    const controller = { tryOn: vi.fn(async () => 'x') }
    const skinTryOn = (): void => {
      if (wallpaper.trying()) wallpaper.exitTryOn()
      void controller.tryOn('blue-fantasy', null as never)
    }
    skinTryOn()
    expect(wallpaper.exitTryOn).toHaveBeenCalledTimes(1)
    expect(controller.tryOn).toHaveBeenCalledTimes(1)
  })
})
