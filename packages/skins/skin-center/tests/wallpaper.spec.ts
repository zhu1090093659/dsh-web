// @vitest-environment jsdom
/**
 * WallpaperController tests (jsdom): layer mounting and z-order, dim/blur
 * application, mode switching, try-on/exit restoration, selection
 * persistence, pause-on-hidden, and full dispose — driven by a fake
 * SettingsScope so no real settings surface is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  WallpaperController,
  defaultWallpaperSurface,
  installBootRestore,
  resolveSelection,
  type WallpaperDescriptor,
  type WallpaperHandle,
} from '../src/client/wallpaper.ts'
import { setSceneBackdropActive } from '../src/client/runtime/backdrop-scene.ts'

interface Section {
  enabled?: boolean
  selection?: string
  mode?: 'live' | 'frame'
  pauseOnHidden?: boolean
  dim?: number
  wallpaperBlur?: number
  wallpaperOpacity?: number
  sound?: boolean
  volume?: number
  weLibraryDirs?: string[]
}

/** A fake SettingsScope recording every set() call. */
function fakeScope(initial: Partial<Section> = {}): {
  scope: SettingsScope<Section>
  calls: Array<{ field: string; value: unknown }>
} {
  let value = { ...initial } as Section
  const calls: Array<{ field: string; value: unknown }> = []
  const listeners = new Set<() => void>()
  const snapshot: SettingsScopeSnapshot<Section> = {
    status: 'ready',
    value,
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const scope: SettingsScope<Section> = {
    getSnapshot: () => ({ ...snapshot, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, val) => {
      calls.push({ field, value: val })
      value = { ...value, [field]: val as never }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      value = { ...value }
      delete value[field as keyof Section]
      for (const listener of listeners) listener()
    },
  }
  return { scope, calls }
}

const video: WallpaperDescriptor = {
  id: '111',
  title: 'Ocean',
  type: 'video',
  videoUrl: '/api/skin-center/we/media/aaa',
  webUrl: null,
  frameUrl: null,
  previewUrl: '/api/skin-center/we/preview/bbb',
}

const scene: WallpaperDescriptor = {
  id: '333',
  title: 'Neon',
  type: 'scene',
  videoUrl: null,
  webUrl: null,
  frameUrl: '/api/skin-center/we/scene-frame/ccc',
  previewUrl: '/api/skin-center/we/preview/ddd',
}

/** Wait until the observer-driven marker reaches an expected state. */
async function waitForContentMarker(expected: boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(document.body.hasAttribute('data-dsh-conversation-content')).toBe(expected)
    expect(document.documentElement.hasAttribute('data-dsh-conversation-content')).toBe(expected)
  })
}

/** The fixed wallpaper layers, in mount order. */
function layers(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')]
    .filter(el => el.style.position === 'fixed')
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('WallpaperController', () => {
  it('neutralizes the opaque app-root background while a wallpaper is mounted (#505)', () => {
    const neutralizers = (): HTMLStyleElement[] =>
      [...document.head.querySelectorAll<HTMLStyleElement>('style[data-dsh-wallpaper-root]')]
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    expect(neutralizers()).toHaveLength(0)
    controller.applySelection(video)
    expect(neutralizers()).toHaveLength(1)
    expect(neutralizers()[0]!.textContent).toContain('[id="root"] { background: transparent; }')
    // Tearing the wallpaper down restores the stock shell background.
    controller.clearSelection()
    expect(neutralizers()).toHaveLength(0)
    // Re-applying and disposing behaves the same way.
    controller.applySelection(video)
    expect(neutralizers()).toHaveLength(1)
    controller.dispose()
    expect(neutralizers()).toHaveLength(0)
  })

  it('mounts media + scrim layers under the app for a video selection', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media, scrim] = layers()
    expect(media.style.zIndex).toBe('-3')
    expect(scrim.style.zIndex).toBe('-2')
    expect(media.querySelector('video')).not.toBeNull()
    expect(scrim.style.background).toContain('rgba(0, 0, 0')
    expect(controller.activeId()).toBe('111')
    controller.dispose()
    expect(layers()).toHaveLength(0)
  })

  it('persists the selection through the scope', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    expect(calls.some(c => c.field === 'selection' && c.value === '111')).toBe(true)
    controller.clearSelection()
    expect(calls.some(c => c.field === 'selection' && c.value === '')).toBe(true)
    expect(layers()).toHaveLength(0)
    controller.dispose()
  })

  it('mounts a static frame image for scene wallpapers', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(scene)
    const [media] = layers()
    const image = media.querySelector('img')
    expect(image).not.toBeNull()
    expect(image?.src).toContain('/api/skin-center/we/scene-frame/ccc')
    controller.dispose()
  })

  it('falls back to the preview when the scene frame fails to load (#521)', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(scene)
    const [media] = layers()
    const image = media.querySelector('img')
    expect(image?.src).toContain('/api/skin-center/we/scene-frame/ccc')
    image?.dispatchEvent(new Event('error'))
    expect(image?.src).toContain('/api/skin-center/we/preview/ddd')
    controller.dispose()
  })

  it('applies fit mode (cover / contain / fill) and updates media objectFit', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media] = layers()
    const vid = media.querySelector('video')
    expect(vid?.style.objectFit).toBe('cover')
    controller.setFit('contain')
    expect(controller.fit()).toBe('contain')
    expect(calls.some(c => c.field === 'fit' && c.value === 'contain')).toBe(true)
    const [media2] = layers()
    const vid2 = media2.querySelector('video')
    expect(vid2?.style.objectFit).toBe('contain')
    controller.dispose()
  })

  it('keeps the media element across fit changes instead of rebuilding (#717 follow-up)', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media] = layers()
    const vid = media.querySelector('video')
    expect(vid).not.toBeNull()
    controller.setFit('fill')
    const [media2] = layers()
    const vid2 = media2.querySelector('video')
    expect(vid2).toBe(vid) // same element: only objectFit updated
    expect(vid2?.style.objectFit).toBe('fill')
    controller.dispose()
  })

  it('mounts video for scene wallpaper when videoUrl is present in live mode', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    const sceneWithVideo: WallpaperDescriptor = {
      id: 'scene-vid',
      title: 'Scene with MP4',
      type: 'scene',
      videoUrl: '/api/skin-center/we/scene-video/eee',
      webUrl: null,
      frameUrl: '/api/skin-center/we/scene-frame/eee',
      previewUrl: '/api/skin-center/we/preview/eee',
    }
    controller.applySelection(sceneWithVideo)
    const [media] = layers()
    const vid = media.querySelector('video')
    expect(vid).not.toBeNull()
    expect(vid?.src).toContain('/api/skin-center/we/scene-video/eee')
    controller.dispose()
  })

  it('keeps a preview backdrop beneath live scenes when WebGL clears', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection({
      ...scene,
      id: 'live-backed',
      sceneUrl: '/api/skin-center/we/scene-runtime/live-backed',
    })
    const [media] = layers()
    expect(media.querySelector('iframe')).not.toBeNull()
    expect(media.style.backgroundImage).toContain('/api/skin-center/we/scene-frame/ccc')
    expect(media.style.backgroundSize).toBe('cover')
    controller.setFit('fill')
    expect(media.style.backgroundSize).toBe('100% 100%')
    controller.dispose()
  })

  it('keeps the live composition visible for scripted partial scenes and de-duplicates their probe', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-manifest/')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            manifest: {
              width: 3840,
              height: 2160,
              layers: [
                { x: 1920, y: 1080, w: 3840, h: 2160, texUrl: '/api/skin-center/we/scene-resource/scripted/artwork.tex' },
                { x: 2000, y: 1100, w: 7200, h: 4800, texUrl: '/api/skin-center/we/scene-resource/scripted/gradient.tex' },
              ],
            },
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({
          ok: true,
          videoUrl: null,
          sceneUrl: '/api/skin-center/we/scene-runtime/scripted',
          compatibility: 'partial',
          unsupportedFeatures: ['embedded-script'],
        }),
      }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope, { fetchImpl, doc: document })
    controller.applySelection({ ...scene, id: 'scripted' })
    expect(document.body.querySelector('img')?.src).toContain('/scene-frame/')
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    const [media] = layers()
    const player = media.querySelector('iframe')
    expect(player?.src).toContain('/api/skin-center/we/scene-runtime/scripted')
    expect(player?.style.opacity).toBe('0')
    expect(media.style.backgroundImage).toContain('/api/skin-center/we/scene-resource/scripted/artwork.tex')
    expect(media.querySelector('img')).toBeNull()

    // A later inventory sync retains the completed partial probe and must not
    // start another probe or replace the stable frame.
    controller.sync({ ...scene, id: 'scripted', title: 'Refreshed scripted scene' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(media.querySelector('iframe')).toBe(player)
    controller.dispose()
  })

  it('keeps the live player visible for scripted scenes with a supported time schedule', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => input.includes('/scene-manifest/')
        ? ({
          ok: true,
          manifest: {
            width: 3840,
            height: 2160,
            timeSchedule: { morning: 4, day: 9, dusk: 17, night: 20 },
            // Time-varying scenes carry one fullscreen layer per period; none of
            // them may replace the live player as a static base.
            layers: [
              { x: 1920, y: 1080, w: 3840, h: 2160, texUrl: '/api/skin-center/we/scene-resource/timed/day.tex' },
              { x: 1920, y: 1080, w: 3840, h: 2160, texUrl: '/api/skin-center/we/scene-resource/timed/night.tex' },
            ],
          },
        })
        : ({ ok: true, videoUrl: null, sceneUrl: '/api/skin-center/we/scene-runtime/timed', compatibility: 'partial', unsupportedFeatures: ['embedded-script'] }),
    })) as unknown as typeof fetch
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope, { fetchImpl, doc: document })
    controller.applySelection({ ...scene, id: 'timed' })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    const [media] = layers()
    const player = media.querySelector('iframe')
    expect(player?.src).toContain('/scene-runtime/timed')
    expect(player?.style.opacity).not.toBe('0')
    // The backdrop stays the host-decoded frame; a single period layer would
    // freeze the wallpaper to one time of day while the player loads.
    expect(media.style.backgroundImage).toContain('/scene-frame/ccc')
    controller.dispose()
  })

  it('never picks a video-backed layer as the static scene base', async () => {
    const fetchImpl = vi.fn(async (input: string) => ({
      ok: true,
      json: async () => input.includes('/scene-manifest/')
        ? ({
          ok: true,
          manifest: {
            width: 3840,
            height: 2160,
            layers: [
              // Video layers serve MP4 bytes that a CSS background cannot paint.
              { x: 1920, y: 1080, w: 3840, h: 2160, texUrl: '/api/skin-center/we/scene-resource/vid/backdrop.tex', videoUrl: '/api/skin-center/we/scene-resource/vid/backdrop.tex' },
              { x: 1920, y: 1080, w: 3840, h: 2160, texUrl: '/api/skin-center/we/scene-resource/vid/still.tex' },
            ],
          },
        })
        : ({ ok: true, videoUrl: null, sceneUrl: '/api/skin-center/we/scene-runtime/vid', compatibility: 'partial', unsupportedFeatures: ['embedded-script'] }),
    })) as unknown as typeof fetch
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope, { fetchImpl, doc: document })
    controller.applySelection({ ...scene, id: 'vid' })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 0))
    const [media] = layers()
    expect(media.style.backgroundImage).toContain('/scene-resource/vid/still.tex')
    expect(media.style.backgroundImage).not.toContain('backdrop.tex')
    controller.dispose()
  })

  it('applySelection probes scene capabilities lazily and mounts live video', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-probe')) {
        return { ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/lazy', sceneUrl: null }) }
      }
      return { ok: true, json: async () => ({ ok: true, wallpapers: [] }) }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope, { fetchImpl, doc: document })
      controller.applySelection({ ...scene, id: 'lazy', frameUrl: '/api/skin-center/we/scene-frame/lazy' })
      // Before the probe resolves, the static frame is mounted.
      expect(document.body.querySelector('img')).not.toBeNull()
      await new Promise((r) => setTimeout(r, 10))
      expect(fetchImpl).toHaveBeenCalledWith('/api/skin-center/we/scene-probe?id=lazy')
      const [media] = layers()
      const vid = media.querySelector('video')
      expect(vid).not.toBeNull()
      expect(vid?.src).toContain('/api/skin-center/we/scene-video/lazy')
    } finally {
      controller?.dispose()
    }
  })

  it('tryOn probes scene capabilities and mounts live video for the preview', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-probe')) {
        return { ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/preview', sceneUrl: null }) }
      }
      return { ok: true, json: async () => ({ ok: true, wallpapers: [] }) }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope, { fetchImpl, doc: document })
      controller.tryOn({ ...scene, id: 'preview', frameUrl: '/api/skin-center/we/scene-frame/preview' })
      await new Promise((r) => setTimeout(r, 10))
      expect(fetchImpl).toHaveBeenCalledWith('/api/skin-center/we/scene-probe?id=preview')
      const [media] = layers()
      const vid = media.querySelector('video')
      expect(vid).not.toBeNull()
      expect(vid?.src).toContain('/api/skin-center/we/scene-video/preview')
    } finally {
      controller?.dispose()
    }
  })

  it('stale probe responses never overwrite a newer selection', async () => {
    const probes = new Map<string, (value: unknown) => void>()
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-probe')) {
        const id = input.split('id=')[1]
        return new Promise((resolve) => { probes.set(id, resolve) })
      }
      return { ok: true, json: async () => ({ ok: true, wallpapers: [] }) }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope, { fetchImpl, doc: document })
      controller.tryOn({ ...scene, id: 'slow-a', frameUrl: '/api/skin-center/we/scene-frame/slow-a' })
      await new Promise((r) => setTimeout(r, 5))
      // Switch to a different wallpaper before slow-a's probe answers.
      controller.tryOn({ ...scene, id: 'slow-b', frameUrl: '/api/skin-center/we/scene-frame/slow-b' })
      probes.get('slow-b')?.({ ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/slow-b', sceneUrl: null }) })
      await new Promise((r) => setTimeout(r, 5))
      const [media] = layers()
      expect(media.querySelector('video')?.src).toContain('/api/skin-center/we/scene-video/slow-b')
      // slow-a's stale probe resolves late: the preview now belongs to slow-b,
      // so the response must be dropped, not merged.
      probes.get('slow-a')?.({ ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/stale', sceneUrl: null }) })
      await new Promise((r) => setTimeout(r, 10))
      expect(media.querySelector('video')?.src).toContain('/api/skin-center/we/scene-video/slow-b')
      expect(media.querySelector('video')?.src).not.toContain('/api/skin-center/we/scene-video/stale')
    } finally {
      controller?.dispose()
    }
  })

  it('dedupes concurrent scene probes for the same id across entry points', async () => {
    let probeCalls = 0
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-probe')) {
        probeCalls++
        await new Promise((r) => setTimeout(r, 30))
        return { ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/dedup', sceneUrl: null }) }
      }
      return { ok: true, json: async () => ({ ok: true, wallpapers: [] }) }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope, { fetchImpl, doc: document })
      controller.tryOn({ ...scene, id: 'dedup', frameUrl: '/api/skin-center/we/scene-frame/dedup' })
      controller.applySelection({ ...scene, id: 'dedup', frameUrl: '/api/skin-center/we/scene-frame/dedup' })
      controller.sync({ ...scene, id: 'dedup', frameUrl: '/api/skin-center/we/scene-frame/dedup' })
      await new Promise((r) => setTimeout(r, 10))
      expect(probeCalls).toBe(1)
      await new Promise((r) => setTimeout(r, 50))
      controller.tryOn({ ...scene, id: 'dedup', videoUrl: '/api/skin-center/we/scene-video/dedup', frameUrl: '/api/skin-center/we/scene-frame/dedup' })
      await new Promise((r) => setTimeout(r, 10))
      expect(probeCalls).toBe(1)
      const [media] = layers()
      expect(media.querySelector('video')?.src).toContain('/api/skin-center/we/scene-video/dedup')
    } finally {
      controller?.dispose()
    }
  })

  it('keeps a live scene player mounted when Skin Center refreshes bare inventory data', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    const enriched: WallpaperDescriptor = {
      ...scene,
      id: 'persistent-scene',
      sceneUrl: '/api/skin-center/we/scene-runtime/persistent-scene',
    }
    controller.applySelection(enriched)
    const [media] = layers()
    const player = media.querySelector('iframe')
    expect(player).not.toBeNull()

    // Inventory omits lazy scene capabilities on every panel open. Syncing it
    // must update metadata in place without replacing/reloading the iframe.
    controller.sync({ ...enriched, title: 'Refreshed title', sceneUrl: null })
    expect(media.querySelector('iframe')).toBe(player)
    expect(media.querySelector('img')).toBeNull()
    controller.dispose()
  })

  it('applied capabilities survive exiting a try-on that probed the same wallpaper', async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      if (input.includes('/scene-probe')) {
        return { ok: true, json: async () => ({ ok: true, videoUrl: '/api/skin-center/we/scene-video/shared', sceneUrl: null }) }
      }
      return { ok: true, json: async () => ({ ok: true, wallpapers: [] }) }
    }) as unknown as typeof fetch
    const { scope } = fakeScope()
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope, { fetchImpl, doc: document })
      const desc = { ...scene, id: 'shared', frameUrl: '/api/skin-center/we/scene-frame/shared' }
      controller.applySelection(desc)
      controller.tryOn(desc)
      await new Promise((r) => setTimeout(r, 10))
      controller.exitTryOn()
      await new Promise((r) => setTimeout(r, 10))
      const [media] = layers()
      const vid = media.querySelector('video')
      expect(vid).not.toBeNull()
      expect(vid?.src).toContain('/api/skin-center/we/scene-video/shared')
    } finally {
      controller?.dispose()
    }
  })

  it('releases the capture video on error before loadeddata', () => {
    const { scope } = fakeScope()
    const origCreate = document.createElement.bind(document)
    const createdVideos: HTMLVideoElement[] = []
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'video') createdVideos.push(el as HTMLVideoElement)
      return el
    })
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope)
      controller.setMode('frame')
      controller.applySelection({ ...video, id: 'cap-err', previewUrl: '/api/skin-center/we/preview/cap-err' })
      const capture = createdVideos.find((v) => v.getAttribute('src') !== null)
      expect(capture).not.toBeNull()
      // A decode/network failure fires error before loadeddata: the src must
      // still be released instead of keeping preload=auto buffering.
      capture?.dispatchEvent(new Event('error'))
      expect(capture?.hasAttribute('src')).toBe(false)
    } finally {
      controller?.dispose()
      createSpy.mockRestore()
    }
  })

  it('releases the capture video on teardown when loadeddata never fires', () => {
    const { scope } = fakeScope()
    const origCreate = document.createElement.bind(document)
    const createdVideos: HTMLVideoElement[] = []
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'video') createdVideos.push(el as HTMLVideoElement)
      return el
    })
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope)
      controller.setMode('frame')
      controller.applySelection({ ...video, id: 'cap-teardown', previewUrl: '/api/skin-center/we/preview/cap-teardown' })
      const capture = createdVideos.find((v) => v.getAttribute('src') !== null)
      expect(capture).not.toBeNull()
      // Mode switch / dispose before any media event: teardown must release.
      controller.dispose()
      controller = null
      expect(capture?.hasAttribute('src')).toBe(false)
    } finally {
      controller?.dispose()
      createSpy.mockRestore()
    }
  })

  it('releases the capture video on a media-key transition before loadeddata', () => {
    const { scope } = fakeScope()
    const origCreate = document.createElement.bind(document)
    const createdVideos: HTMLVideoElement[] = []
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'video') createdVideos.push(el as HTMLVideoElement)
      return el
    })
    let controller: WallpaperController | null = null
    try {
      controller = new WallpaperController(scope)
      controller.setMode('frame')
      controller.applySelection({ ...video, id: 'cap-switch', previewUrl: '/api/skin-center/we/preview/cap-switch' })
      const capture = createdVideos.find((v) => v.getAttribute('src') !== null)
      expect(capture).not.toBeNull()
      // frame -> live rebuilds the media layer and must release the
      // abandoned capture instead of leaving it buffering.
      controller.setMode('live')
      expect(capture?.hasAttribute('src')).toBe(false)
      const [media] = layers()
      expect(media.querySelector('video')).not.toBeNull()
    } finally {
      controller?.dispose()
      createSpy.mockRestore()
    }
  })

  it('keeps videos muted by default and applies sound/volume live (#580)', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media] = layers()
    const el = media.querySelector('video')
    expect(el?.muted).toBe(true)
    controller.setSound(true)
    expect(el?.muted).toBe(false)
    expect(el?.volume).toBe(1)
    expect(calls.some(c => c.field === 'sound' && c.value === true)).toBe(true)
    controller.setVolume(40)
    expect(el?.volume).toBeCloseTo(0.4)
    expect(calls.some(c => c.field === 'volume' && c.value === 40)).toBe(true)
    controller.setSound(false)
    expect(el?.muted).toBe(true)
    controller.dispose()
  })

  it('restores persisted sound/volume into newly mounted videos (#580)', () => {
    const { scope } = fakeScope({ sound: true, volume: 30 })
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media] = layers()
    const el = media.querySelector('video')
    expect(el?.muted).toBe(false)
    expect(el?.volume).toBeCloseTo(0.3)
    controller.dispose()
  })

  it('frame mode renders the video preview instead of the video element', () => {
    const { scope } = fakeScope({ mode: 'frame' })
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const [media] = layers()
    expect(media.querySelector('video')).toBeNull()
    expect(media.querySelector('img')).not.toBeNull()
    controller.dispose()
  })

  it('try-on mounts a preview and exit restores the applied selection', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    controller.tryOn(scene)
    expect(controller.trying()).toBe(true)
    expect(controller.activeId()).toBe('333')
    controller.exitTryOn()
    expect(controller.trying()).toBe(false)
    expect(controller.activeId()).toBe('111')
    // The persisted selection never changed during try-on.
    expect(controller.selection()).toBe('111')
    controller.dispose()
  })

  it('keeps the owned dim scrim out of shell-surface neutralization', async () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope, {
      // Force every non-owned added element through the surface path so this
      // catches a future observer regression even though jsdom has no layout.
      declareSurface: () => true,
    })
    controller.applySelection(video)
    controller.setDim(60)
    controller.setBlur(10)
    const [media, scrim] = layers()
    expect(media.dataset.dshWallpaperLayer).toBe('media')
    expect(scrim.dataset.dshWallpaperLayer).toBe('scrim')
    expect(scrim.style.background).toContain('0.6')
    expect(media.style.filter).toContain('blur(10px)')
    expect(media.style.transform).toContain('scale')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(media.hasAttribute('data-dsh-wallpaper-surface')).toBe(false)
    expect(scrim.hasAttribute('data-dsh-wallpaper-surface')).toBe(false)
    expect(scrim.style.background).toContain('0.6')
    controller.dispose()
  })

  it('drops the layers when disabled and restores them when re-enabled', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    controller.setEnabled(false)
    expect(layers()).toHaveLength(0)
    controller.setEnabled(true)
    expect(layers()).toHaveLength(2)
    controller.dispose()
  })

  it('manages manual library folders with trim/dedupe/remove persistence', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope)
    expect(controller.dirs()).toEqual([])
    controller.addDir('  ~/Movies/wallpapers  ')
    controller.addDir('/data/we')
    controller.addDir('~/Movies/wallpapers') // duplicate: ignored
    controller.addDir('   ') // blank: ignored
    expect(controller.dirs()).toEqual(['~/Movies/wallpapers', '/data/we'])
    controller.removeDir('/data/we')
    expect(controller.dirs()).toEqual(['~/Movies/wallpapers'])
    const writes = calls.filter(c => c.field === 'weLibraryDirs')
    expect(writes).toHaveLength(3)
    expect(writes[2].value).toEqual(['~/Movies/wallpapers'])
    controller.dispose()
  })

  it('reads initial manual folders from the scope', () => {
    const { scope } = fakeScope({ weLibraryDirs: ['/a', '', '  ', '/b'] })
    const controller = new WallpaperController(scope)
    expect(controller.dirs()).toEqual(['/a', '/b'])
    controller.dispose()
  })

  it('sync(null) unmounts a selection that vanished from the library', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    controller.sync(null)
    expect(layers()).toHaveLength(0)
    controller.dispose()
  })

  it('fetchAndSync loads wallpaper inventory on boot when selection is set (#604)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        wallpapers: [video, scene],
      }),
    })) as unknown as typeof fetch
    const { scope } = fakeScope({ enabled: true, selection: '111' })
    const controller = new WallpaperController(scope, {
      fetchImpl,
      doc: document,
    })

    // Allow promise microtasks in fetchAndSync to resolve
    await new Promise((r) => setTimeout(r, 10))

    expect(fetchImpl).toHaveBeenCalledWith('/api/skin-center/we/inventory')
    expect(controller.activeId()).toBe('111')
    expect(document.body.dataset.dshWallpaperActive).toBe('true')
    expect(document.documentElement.dataset.dshWallpaperActive).toBe('true')
    const [media] = layers()
    expect(media.querySelector('video')).not.toBeNull()
    controller.dispose()
  })

  it('fetchAndSync triggers on scope selection update when descriptor not yet loaded', async () => {
    let inventory = [video]
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        wallpapers: inventory,
      }),
    })) as unknown as typeof fetch
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope, {
      fetchImpl,
      doc: document,
    })

    expect(controller.activeId()).toBeNull()
    inventory = [video, scene]
    await scope.set('selection', '333')

    await new Promise((r) => setTimeout(r, 10))

    expect(controller.activeId()).toBe('333')
    const [media] = layers()
    expect(media.querySelector('img')?.src).toContain('/api/skin-center/we/scene-frame/ccc')
    controller.dispose()
  })

  it('stops reacting to settings publishes after dispose (unsubscribe)', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, wallpapers: [video, scene] }),
    })) as unknown as typeof fetch
    const { scope } = fakeScope({ enabled: true, selection: '111' })
    const controller = new WallpaperController(scope, { fetchImpl, doc: document })
    await vi.waitFor(() => expect(controller.activeId()).toBe('111'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    controller.dispose()
    expect(layers()).toHaveLength(0)
    const fetchesBefore = fetchImpl.mock.calls.length
    // A later settings publish (e.g. the card or another session) must not
    // wake the disposed controller or issue another /inventory request.
    await scope.set('selection', '333')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(fetchImpl).toHaveBeenCalledTimes(fetchesBefore)
    expect(document.body.hasAttribute('data-dsh-wallpaper-active')).toBe(false)
    expect(controller.activeId()).toBeNull()
  })

  it('neutralizer CSS contains background-image none and removes on teardown', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const style = document.head.querySelector('style[data-dsh-wallpaper-root]')
    expect(style?.textContent).toContain('background-image: none !important;')
    expect(style?.textContent).toContain('background-color: transparent !important;')
    expect(document.body.dataset.dshWallpaperActive).toBe('true')
    expect(document.documentElement.dataset.dshWallpaperActive).toBe('true')

    controller.dispose()
    expect(document.head.querySelector('style[data-dsh-wallpaper-root]')).toBeNull()
    expect(document.body.dataset.dshWallpaperActive).toBeUndefined()
    expect(document.documentElement.dataset.dshWallpaperActive).toBeUndefined()
  })

  it('reports the unified backdrop-active marker and installs the shared composer-seat neutralizer (#777)', async () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    expect(document.body.hasAttribute('data-dsh-backdrop-active')).toBe(false)
    // A painted skin and a WE/WebGL wallpaper may report the shared scene at
    // the same time; removing either source must not clobber the other.
    setSceneBackdropActive(document, 'skin', true)
    controller.applySelection(video)
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')
    expect(document.documentElement.getAttribute('data-dsh-backdrop-active')).toBe('true')
    const neutralizer = document.head.querySelector('style[data-dsh-scene-neutralizer]')
    expect(neutralizer).not.toBeNull()
    // Remove the seat-wide bottom gradient in both active and hero phases so
    // backdrop art remains visible down to the viewport edge.
    expect(neutralizer?.textContent).toContain('html[data-dsh-backdrop-active] [data-composer-seat],')
    expect(neutralizer?.textContent).toContain('html[data-dsh-backdrop-active] [data-composer-seat]::before')
    expect(neutralizer?.textContent).not.toContain('html[data-dsh-backdrop-active] [data-phase="hero"] [data-composer-seat]')
    expect(neutralizer?.textContent).not.toContain('[data-slot="conversation.composer.dock"] > *')
    expect(neutralizer?.textContent).not.toContain('--dsh-composer-accessory-bg')
    expect(neutralizer?.textContent).toContain('background: none !important;')
    expect(neutralizer?.textContent).toContain('-webkit-backdrop-filter: none !important;')
    expect(neutralizer?.textContent).not.toContain('html[data-dsh-backdrop-active][data-dsh-conversation-content] [data-composer-seat] {')
    expect(neutralizer?.textContent).not.toContain('var(--dsw-alias-bg-overlay) 36px')
    expect(neutralizer?.textContent).toContain('html[data-dsh-backdrop-active][data-dsh-conversation-content] [data-composer-card]')
    expect(neutralizer?.textContent).toContain('backdrop-filter: blur(var(--dsh-input-card-blur, 10px)) !important;')
    // Empty conversation: the content marker is absent, so the frost is off.
    expect(document.body.hasAttribute('data-dsh-conversation-content')).toBe(false)
    // A topic-picker or outgoing-session row outside the active scrollport
    // must not enable the composer frost during a topic switch.
    const staleRow = document.createElement('div')
    staleRow.setAttribute('data-chat-anchor-key', 'stale-topic-row')
    document.body.appendChild(staleRow)
    await waitForContentMarker(false)
    // A row inside the official active scrollport flips the marker on.
    const outgoingScrollport = document.createElement('div')
    outgoingScrollport.setAttribute('data-conversation-scroll', '')
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', 'active-turn')
    outgoingScrollport.appendChild(row)
    document.body.appendChild(outgoingScrollport)
    await waitForContentMarker(true)
    // Topic switching can leave stale rows elsewhere while replacing the
    // active scrollport. The empty incoming topic must clear the marker.
    const incomingScrollport = document.createElement('div')
    incomingScrollport.setAttribute('data-conversation-scroll', '')
    outgoingScrollport.replaceWith(incomingScrollport)
    await waitForContentMarker(false)
    // Older shell row suffixes remain supported, but only in the scrollport.
    const fallbackRow = document.createElement('div')
    fallbackRow.className = 'hash_userRow'
    incomingScrollport.appendChild(fallbackRow)
    await waitForContentMarker(true)
    incomingScrollport.remove()
    await waitForContentMarker(false)
    // Wallpaper hardening removes the seat-wide pseudo; the shared rounded
    // composer-dock row owns transcript occlusion instead.
    const root = document.head.querySelector('style[data-dsh-wallpaper-root]')
    expect(root?.textContent).toContain('html[data-dsh-wallpaper-active] [data-composer-seat]::before')
    expect(root?.textContent).not.toContain('html[data-dsh-wallpaper-active] [data-composer-seat],')
    expect(root?.textContent).toContain('backdrop-filter: none !important;')
    // Wallpaper teardown leaves the marker active for the painted skin.
    controller.clearSelection()
    expect(document.body.getAttribute('data-dsh-backdrop-active')).toBe('true')
    expect(document.documentElement.getAttribute('data-dsh-backdrop-active')).toBe('true')
    // Removing the final source clears the shared marker; the neutralizer style
    // remains safely inert in the head.
    setSceneBackdropActive(document, 'skin', false)
    expect(document.body.hasAttribute('data-dsh-backdrop-active')).toBe(false)
    expect(document.documentElement.hasAttribute('data-dsh-backdrop-active')).toBe(false)
    controller.dispose()
  })

  it('tags full-viewport shell surfaces and untags on teardown (#734)', () => {
    const { scope } = fakeScope()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    const shellSurface = document.createElement('div')
    const other = document.createElement('div')
    shellSurface.style.height = '100%'
    other.style.height = '100%'
    root.append(shellSurface, other)
    document.body.appendChild(root)
    const controller = new WallpaperController(scope, {
      doc: document,
      // Simulate the computed-style heuristic (jsdom cannot resolve token vars).
      declareSurface: (el) => el === shellSurface,
    })
    controller.applySelection(video)
    expect(shellSurface.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    expect(other.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
    const style = document.head.querySelector('style[data-dsh-wallpaper-root]')
    expect(style?.textContent).toContain('html[data-dsh-wallpaper-active] [data-dsh-wallpaper-surface]')
    expect(style?.textContent).toContain('background-color: transparent !important;')
    controller.dispose()
    expect(shellSurface.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
  })

  it('defaultWallpaperSurface matches tall visible shell surfaces without theme-token equality (#712)', () => {
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const surface = document.createElement('div')
    surface.style.backgroundColor = '#f6f7f8'
    const alternate = document.createElement('div')
    alternate.style.backgroundColor = '#101010'
    const translucent = document.createElement('div')
    translucent.style.backgroundColor = 'rgba(21, 21, 23, 0.42)'
    const short = document.createElement('div')
    short.style.backgroundColor = '#101010'
    const transparent = document.createElement('div')
    transparent.style.backgroundColor = 'transparent'
    const modal = document.createElement('dialog')
    const ariaModal = document.createElement('div')
    ariaModal.setAttribute('aria-modal', 'true')
    const shellOverlay = document.createElement('div')
    shellOverlay.setAttribute('data-shell-overlay', '')
    const slotOverlay = document.createElement('div')
    slotOverlay.setAttribute('data-slot', 'shell.overlay')
    const pluginSurface = document.createElement('div')
    pluginSurface.setAttribute('data-dsh-plugin', 'skin-center')
    const sidebarSlot = document.createElement('div')
    sidebarSlot.setAttribute('data-slot', 'sidebar')
    const sidebarSurface = document.createElement('div')
    sidebarSurface.setAttribute('data-dsh-surface', 'sidebar')
    const sidebarAside = document.createElement('aside')
    const detailsSlot = document.createElement('div')
    detailsSlot.setAttribute('data-slot', 'details')
    const detailsSurface = document.createElement('div')
    detailsSurface.setAttribute('data-dsh-surface', 'details')
    const detailsPane = document.createElement('div')
    detailsPane.setAttribute('data-pane', 'details')
    const excluded = [modal, ariaModal, shellOverlay, slotOverlay, pluginSurface, sidebarSlot, sidebarSurface, sidebarAside, detailsSlot, detailsSurface, detailsPane]
    for (const element of excluded) element.style.backgroundColor = '#101010'
    const hidden = document.createElement('div')
    hidden.style.display = 'none'
    hidden.style.height = '100%'
    hidden.style.backgroundColor = '#101010'
    root.append(surface, alternate, translucent, short, transparent, ...excluded, hidden)
    const rect = (height: number): DOMRect => ({ height } as DOMRect)
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(rect(1000))
    vi.spyOn(alternate, 'getBoundingClientRect').mockReturnValue(rect(1000))
    vi.spyOn(translucent, 'getBoundingClientRect').mockReturnValue(rect(1000))
    vi.spyOn(short, 'getBoundingClientRect').mockReturnValue(rect(500))
    vi.spyOn(transparent, 'getBoundingClientRect').mockReturnValue(rect(1000))
    for (const element of excluded) vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(1000))
    const doc = { defaultView: window, documentElement: { clientHeight: 1000 } } as unknown as Document
    expect(defaultWallpaperSurface(surface, doc)).toBe(true)
    expect(defaultWallpaperSurface(alternate, doc)).toBe(true)
    expect(defaultWallpaperSurface(translucent, doc)).toBe(true)
    expect(defaultWallpaperSurface(short, doc)).toBe(false)
    expect(defaultWallpaperSurface(transparent, doc)).toBe(false)
    for (const element of excluded) expect(defaultWallpaperSurface(element, doc)).toBe(false)
    expect(defaultWallpaperSurface(hidden, doc)).toBe(false)
  })

  it('defaultWallpaperSurface accepts 90% rendered height and excludes high overlays (#712)', () => {
    const html = { clientHeight: 1000 }
    const shell = { getBoundingClientRect: () => ({ height: 900 }) } as unknown as HTMLElement
    const short = { getBoundingClientRect: () => ({ height: 899 }) } as unknown as HTMLElement
    const transparent = { getBoundingClientRect: () => ({ height: 1000 }) } as unknown as HTMLElement
    const cssTransparent = { getBoundingClientRect: () => ({ height: 1000 }) } as unknown as HTMLElement
    const cssTranslucent = { getBoundingClientRect: () => ({ height: 1000 }) } as unknown as HTMLElement
    const boundary = { getBoundingClientRect: () => ({ height: 1000 }) } as unknown as HTMLElement
    const overlay = { getBoundingClientRect: () => ({ height: 1000 }) } as unknown as HTMLElement
    const win = {
      innerHeight: 1000,
      getComputedStyle: (target: unknown) => {
        if (target === transparent) return { height: '1000px', backgroundColor: 'rgba(21, 21, 23, 0)', zIndex: 'auto' }
        if (target === cssTransparent) return { height: '1000px', backgroundColor: 'color(srgb 1 0 0 / 0)', zIndex: 'auto' }
        if (target === cssTranslucent) return { height: '1000px', backgroundColor: 'color(srgb 1 0 0 / 0.5)', zIndex: 'auto' }
        if (target === boundary) return { height: '1000px', backgroundColor: 'rgb(21, 21, 23)', zIndex: '100' }
        if (target === overlay) return { height: '1000px', backgroundColor: 'rgb(21, 21, 23)', zIndex: '101' }
        return { height: '900px', backgroundColor: 'rgba(21, 21, 23, 0.42)', zIndex: 'auto' }
      },
    } as unknown as Window
    const doc = {
      defaultView: win,
      documentElement: html,
    } as unknown as Document
    expect(defaultWallpaperSurface(shell, doc)).toBe(true)
    expect(defaultWallpaperSurface(short, doc)).toBe(false)
    expect(defaultWallpaperSurface(transparent, doc)).toBe(false)
    expect(defaultWallpaperSurface(cssTransparent, doc)).toBe(false)
    expect(defaultWallpaperSurface(cssTranslucent, doc)).toBe(true)
    expect(defaultWallpaperSurface(boundary, doc)).toBe(true)
    expect(defaultWallpaperSurface(overlay, doc)).toBe(false)
  })

  it('tags the sidebar workspaces fade while a wallpaper is mounted (#734)', () => {
    const { scope } = fakeScope()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const slot = document.createElement('div')
    slot.setAttribute('data-slot', 'sidebar.workspaces')
    const fade = document.createElement('span')
    const other = document.createElement('span')
    slot.append(fade, other)
    root.appendChild(slot)
    const controller = new WallpaperController(scope, {
      doc: document,
      declareWorkspaceFade: (el) => el === fade,
    })
    controller.applySelection(video)
    expect(fade.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    expect(other.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
    // The existing surface neutralization rule clears the fade's gradient too.
    const style = document.head.querySelector('style[data-dsh-wallpaper-root]')
    expect(style?.textContent).toContain('background-image: none !important;')
    controller.dispose()
    expect(fade.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
  })

  it('tags only added subtrees without rescanning the existing tree (incremental observer)', async () => {
    const { scope } = fakeScope()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const existing = document.createElement('div')
    existing.setAttribute('data-surface', '')
    root.appendChild(existing)
    for (let i = 0; i < 40; i++) root.appendChild(document.createElement('div'))
    let detectorCalls = 0
    const controller = new WallpaperController(scope, {
      doc: document,
      declareSurface: (el) => {
        detectorCalls++
        return el.hasAttribute('data-surface')
      },
    })
    controller.applySelection(video)
    expect(existing.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    // Drain observer callbacks queued by applySelection's own media-layer
    // mutations before counting the incremental scan.
    await new Promise((resolve) => setTimeout(resolve, 0))
    detectorCalls = 0
    const added = document.createElement('div')
    const addedSurface = document.createElement('div')
    addedSurface.setAttribute('data-surface', '')
    added.appendChild(addedSurface)
    root.appendChild(added)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(addedSurface.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    expect(added.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
    expect(detectorCalls).toBeLessThanOrEqual(3)
    controller.dispose()
  })

  it('untags removed subtrees and drops their references', async () => {
    const { scope } = fakeScope()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const surface = document.createElement('div')
    surface.setAttribute('data-surface', '')
    root.appendChild(surface)
    const controller = new WallpaperController(scope, {
      doc: document,
      declareSurface: (el) => el.hasAttribute('data-surface'),
    })
    controller.applySelection(video)
    expect(surface.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    surface.remove()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(surface.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
    const internal = controller as unknown as { taggedSurfaces: Set<HTMLElement> }
    expect(internal.taggedSurfaces.size).toBe(0)
    controller.dispose()
  })

  it('re-tags only the new subtree after a navigation-style #root rebuild', async () => {
    const { scope } = fakeScope()
    document.body.innerHTML = ''
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const oldSurface = document.createElement('div')
    oldSurface.setAttribute('data-surface', '')
    root.appendChild(oldSurface)
    const controller = new WallpaperController(scope, {
      doc: document,
      declareSurface: (el) => el.hasAttribute('data-surface'),
    })
    controller.applySelection(video)
    expect(oldSurface.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    const newSurface = document.createElement('div')
    newSurface.setAttribute('data-surface', '')
    root.replaceChildren(newSurface)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(oldSurface.getAttribute('data-dsh-wallpaper-surface')).toBeNull()
    expect(newSurface.getAttribute('data-dsh-wallpaper-surface')).toBe('')
    const internal = controller as unknown as { taggedSurfaces: Set<HTMLElement> }
    expect(internal.taggedSurfaces.size).toBe(1)
    controller.dispose()
  })

  it('defaults wallpaperOpacity to 100 and applies setOpacity', () => {
    // Provide dim to prevent applyThemeDefaults from overriding the default.
    const { scope, calls } = fakeScope({ dim: 25 })
    const controller = new WallpaperController(scope)
    expect(controller.wallpaperOpacity()).toBe(100)
    controller.applySelection(video)
    controller.setOpacity(60)
    expect(controller.wallpaperOpacity()).toBe(60)
    expect(calls.some(c => c.field === 'wallpaperOpacity' && c.value === 60)).toBe(true)
    controller.dispose()
  })

  it('clamps wallpaperOpacity to 0-100', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    controller.setOpacity(-10)
    expect(controller.wallpaperOpacity()).toBe(0)
    controller.setOpacity(150)
    expect(controller.wallpaperOpacity()).toBe(100)
    controller.dispose()
  })

  it('applies opacity to mediaLayer.style.opacity', () => {
    const { scope } = fakeScope()
    // Dark theme seeds opacity=100, so the initial state has no explicit style.
    const controller = new WallpaperController(scope, { themeGet: () => 'dark' })
    controller.applySelection(video)
    const [media] = layers()
    // Default 100 means no explicit opacity style (avoid compositing overhead).
    expect(media.style.opacity).toBe('')
    controller.setOpacity(40)
    expect(media.style.opacity).toBe('0.4')
    controller.setOpacity(0)
    expect(media.style.opacity).toBe('0')
    controller.setOpacity(100)
    expect(media.style.opacity).toBe('')
    controller.dispose()
  })

  it('reads persisted wallpaperOpacity from the scope', () => {
    const { scope } = fakeScope({ wallpaperOpacity: 55 })
    const controller = new WallpaperController(scope)
    expect(controller.wallpaperOpacity()).toBe(55)
    controller.dispose()
  })

  it('applies light-theme defaults (dim=0, opacity=40) when both are untouched', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope, { themeGet: () => 'light' })
    expect(controller.dim()).toBe(0)
    expect(controller.wallpaperOpacity()).toBe(40)
    expect(calls.some(c => c.field === 'dim' && c.value === 0)).toBe(true)
    expect(calls.some(c => c.field === 'wallpaperOpacity' && c.value === 40)).toBe(true)
    controller.dispose()
  })

  it('applies dark-theme defaults (dim=40, opacity=100) when both are untouched', () => {
    const { scope, calls } = fakeScope()
    const controller = new WallpaperController(scope, { themeGet: () => 'dark' })
    expect(controller.dim()).toBe(40)
    expect(controller.wallpaperOpacity()).toBe(100)
    expect(calls.some(c => c.field === 'dim' && c.value === 40)).toBe(true)
    expect(calls.some(c => c.field === 'wallpaperOpacity' && c.value === 100)).toBe(true)
    controller.dispose()
  })

  it('does not override user-set dim/opacity with theme defaults', () => {
    const { scope, calls } = fakeScope({ dim: 50 })
    const controller = new WallpaperController(scope, { themeGet: () => 'light' })
    // User explicitly set dim=50, so theme defaults must not fire.
    expect(controller.dim()).toBe(50)
    expect(controller.wallpaperOpacity()).toBe(100)
    expect(calls.every(c => c.field !== 'wallpaperOpacity')).toBe(true)
    controller.dispose()
  })

})

/** A minimal fake WallpaperHandle recording every sync() call. */
function fakeHandle(selection: string): {
  handle: WallpaperHandle
  synced: Array<WallpaperDescriptor | null>
  listeners: Set<() => void>
} {
  const synced: Array<WallpaperDescriptor | null> = []
  const listeners = new Set<() => void>()
  const handle: WallpaperHandle = {
    enabled: () => true,
    selection: () => selection,
    mode: () => 'live',
    dim: () => 25,
    wallpaperBlur: () => 0,
    wallpaperOpacity: () => 100,
    pauseOnHidden: () => true,
    sound: () => false,
    volume: () => 100,
    dirs: () => [],
    addDir: () => {},
    removeDir: () => {},
    activeId: () => null,
    trying: () => false,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setEnabled: () => {},
    setMode: () => {},
    setFit: () => {},
    setDim: () => {},
    setBlur: () => {},
    setOpacity: () => {},
    setPauseOnHidden: () => {},
    setSound: () => {},
    setVolume: () => {},
    applySelection: () => {},
    clearSelection: () => {},
    sync: descriptor => { synced.push(descriptor) },
    tryOn: () => {},
    exitTryOn: () => {},
    recoverScenePlayer: () => {},
    dispose: () => {},
  }
  return { handle, synced, listeners }
}

/** Stub global fetch with one JSON payload. */
function stubInventory(wallpapers: WallpaperDescriptor[], ok = true): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(JSON.stringify({ ok, wallpapers }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('resolveSelection', () => {
  it('matches the exact id', () => {
    expect(resolveSelection([video, scene], '111')).toBe(video)
    expect(resolveSelection([video, scene], '333')).toBe(scene)
  })

  it('falls back to the imported copy when the id lacks the prefix', () => {
    const imported: WallpaperDescriptor = { ...scene, id: 'imported/333' }
    expect(resolveSelection([imported], '333')).toBe(imported)
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveSelection([video], 'missing')).toBeUndefined()
    expect(resolveSelection([], '111')).toBeUndefined()
  })
})

describe('installBootRestore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts the persisted selection at boot from the inventory', async () => {
    stubInventory([video, scene])
    const { handle, synced } = fakeHandle('333')
    installBootRestore(handle)
    await vi.waitFor(() => expect(synced).toHaveLength(1))
    expect(synced[0]).toEqual(scene)
  })

  it('resolves the imported copy for a bare id', async () => {
    const imported: WallpaperDescriptor = { ...scene, id: 'imported/333' }
    stubInventory([imported])
    const { handle, synced } = fakeHandle('333')
    installBootRestore(handle)
    await vi.waitFor(() => expect(synced).toHaveLength(1))
    expect(synced[0]).toEqual(imported)
  })

  it('does nothing without a persisted selection', async () => {
    const fetchMock = stubInventory([video])
    const { handle, synced } = fakeHandle('')
    installBootRestore(handle)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(synced).toHaveLength(0)
  })

  it('skips sync when the selection is not in the inventory', async () => {
    const fetchMock = stubInventory([video])
    const { handle, synced } = fakeHandle('missing')
    installBootRestore(handle)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(synced).toHaveLength(0)
  })

  it('skips sync when the inventory errors', async () => {
    const fetchMock = stubInventory([], false)
    const { handle, synced } = fakeHandle('333')
    installBootRestore(handle)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(synced).toHaveLength(0)
  })

  it('stays silent when the inventory fetch rejects', async () => {
    const mock = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', mock)
    const { handle, synced } = fakeHandle('333')
    installBootRestore(handle)
    await vi.waitFor(() => expect(mock).toHaveBeenCalled())
    expect(synced).toHaveLength(0)
  })

  it('syncs only once even when the selection arrives later', async () => {
    stubInventory([video, scene])
    const { handle, synced, listeners } = fakeHandle('')
    installBootRestore(handle)
    // A later settings publish now reports the persisted selection.
    handle.selection = () => '333'
    for (const listener of listeners) listener()
    await vi.waitFor(() => expect(synced).toHaveLength(1))
    expect(synced[0]).toEqual(scene)
  })
})

describe('wallpaper iframe sandbox (T1-1)', () => {
  const web: WallpaperDescriptor = {
    id: 'web-sandbox',
    title: 'Web wallpaper',
    type: 'web',
    videoUrl: null,
    webUrl: '/api/skin-center/we/web/sandbox/',
    frameUrl: null,
    sceneUrl: null,
    previewUrl: '/api/skin-center/we/preview/sandbox',
  }

  it('mounts live web wallpapers in a script-only sandbox (no same-origin)', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(web)
    const [media] = layers()
    const iframe = media.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    controller.dispose()
  })

  it('mounts live scene players in a script-only sandbox (no same-origin)', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection({
      ...scene,
      id: 'scene-sandbox',
      sceneUrl: '/api/skin-center/we/scene-runtime/sandbox',
    })
    const [media] = layers()
    const iframe = media.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(iframe?.dataset.dshScenePlayer).toBe('')
    controller.dispose()
  })

  it('steers the sandboxed scene player through a wildcard target origin', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection({
      ...scene,
      id: 'steer',
      sceneUrl: '/api/skin-center/we/scene-runtime/steer',
    })
    const player = layers()[0].querySelector('iframe')
    const contentWindow = player?.contentWindow ?? null
    expect(contentWindow).not.toBeNull()
    if (contentWindow === null) { controller.dispose(); return }
    const spy = vi.spyOn(contentWindow, 'postMessage')
    controller.setFit('fill')
    expect(spy).toHaveBeenCalledWith({ type: 'dsh-set-fit', fit: 'fill' }, '*')
    controller.dispose()
  })

  it('validates scene reload messages by sender identity instead of origin', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection({
      ...scene,
      id: 'identity',
      sceneUrl: '/api/skin-center/we/scene-runtime/identity',
    })
    const player = layers()[0].querySelector('iframe')
    const contentWindow = player?.contentWindow ?? null
    expect(contentWindow).not.toBeNull()
    const win = document.defaultView
    expect(win).not.toBeNull()
    if (contentWindow === null || win === null) { controller.dispose(); return }
    // Record src writes so the reload branch is observable (jsdom reloads
    // nothing for an unchanged src).
    const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
    expect(srcDescriptor).toBeDefined()
    const writes: string[] = []
    Object.defineProperty(player, 'src', {
      configurable: true,
      get() { return (srcDescriptor!.get as () => string).call(player) },
      set(value: string) { writes.push(String(value)) },
    })
    const fire = (source: unknown, origin: string): void => {
      const event = new win.MessageEvent('message', { data: { type: 'dsh-scene-needs-reload' }, origin })
      Object.defineProperty(event, 'source', { value: source, configurable: true })
      win.dispatchEvent(event)
    }
    // A message from any other window is ignored even with matching data.
    fire(win, win.location.origin)
    expect(writes).toHaveLength(0)
    // The mounted player's message is honored even though its opaque origin
    // surfaces as the literal string "null".
    fire(contentWindow, 'null')
    expect(writes.length).toBeGreaterThanOrEqual(1)
    controller.dispose()
  })
})
