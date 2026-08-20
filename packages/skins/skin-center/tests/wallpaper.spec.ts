// @vitest-environment jsdom
/**
 * WallpaperController tests (jsdom): layer mounting and z-order, dim/blur
 * application, mode switching, try-on/exit restoration, selection
 * persistence, pause-on-hidden, and full dispose — driven by a fake
 * SettingsScope so no real settings surface is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  WallpaperController,
  installBootRestore,
  resolveSelection,
  type WallpaperDescriptor,
  type WallpaperHandle,
} from '../src/client/wallpaper.ts'

interface Section {
  enabled?: boolean
  selection?: string
  mode?: 'live' | 'frame'
  pauseOnHidden?: boolean
  dim?: number
  wallpaperBlur?: number
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

  it('applies dim and blur to the layers', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    controller.setDim(60)
    controller.setBlur(10)
    const [media, scrim] = layers()
    expect(scrim.style.background).toContain('0.6')
    expect(media.style.filter).toContain('blur(10px)')
    expect(media.style.transform).toContain('scale')
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

  it('removes the composer seat mask while a wallpaper is mounted (#734)', () => {
    const { scope } = fakeScope()
    const controller = new WallpaperController(scope)
    controller.applySelection(video)
    const style = document.head.querySelector('style[data-dsh-wallpaper-root]')
    expect(style?.textContent).toContain('html[data-dsh-wallpaper-active] [data-composer-seat]')
    expect(style?.textContent).toContain('background: none !important;')
    // The rule exists only while a wallpaper is mounted: teardown removes it.
    controller.clearSelection()
    expect(document.head.querySelector('style[data-dsh-wallpaper-root]')).toBeNull()
    expect(document.documentElement.dataset.dshWallpaperActive).toBeUndefined()
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
    setDim: () => {},
    setBlur: () => {},
    setPauseOnHidden: () => {},
    setSound: () => {},
    setVolume: () => {},
    applySelection: () => {},
    clearSelection: () => {},
    sync: descriptor => { synced.push(descriptor) },
    tryOn: () => {},
    exitTryOn: () => {},
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
