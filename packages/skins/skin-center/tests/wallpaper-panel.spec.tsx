// @vitest-environment jsdom
/**
 * Wallpaper thumb fallback: a video wallpaper without a preview image
 * (a bare .mp4 in a manual library folder has no project.json preview)
 * renders its first frame through a <video preload="metadata"> thumb
 * instead of a blank box; entries with a real preview keep the <img>.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WallpaperPanel } from '../src/client/WallpaperPanel.tsx'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'
import type { WallpaperHandle } from '../src/client/wallpaper.ts'

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

const t = (key: SkinCenterKey): string => zh[key] ?? key

// Cached snapshot: useSyncExternalStore loops when getSnapshot returns a
// fresh object on every call.
const NO_DIRS: string[] = []

const stubWallpaper = (overrides: Partial<WallpaperHandle> = {}): WallpaperHandle => ({
  enabled: () => true,
  selection: () => '',
  mode: () => 'live',
  fit: () => 'cover',
  dim: () => 0,
  wallpaperBlur: () => 0,
  wallpaperOpacity: () => 100,
  pauseOnHidden: () => false,
  sound: () => false,
  volume: () => 100,
  dirs: () => NO_DIRS,
  addDir: () => {},
  removeDir: () => {},
  pickDir: async () => null,
  activeId: () => null,
  trying: () => false,
  subscribe: () => () => {},
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
  sync: () => {},
  tryOn: () => {},
  exitTryOn: () => {},
  recoverScenePlayer: () => {},
  dispose: () => {},
  ...overrides,
})

const inventory = (wallpapers: unknown[]) => ({
  ok: true,
  installDir: null,
  total: wallpapers.length,
  portableCount: wallpapers.length,
  wallpapers,
})

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>'
  host = document.getElementById('root') as HTMLDivElement
})

afterEach(() => {
  act(() => { root.unmount() })
  vi.unstubAllGlobals()
})

/** Render the panel against one stubbed inventory payload. */
async function render(wallpapers: unknown[], wallpaper: WallpaperHandle = stubWallpaper()): Promise<void> {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => inventory(wallpapers),
  })))
  root = createRoot(host)
  await act(async () => {
    root.render(<WallpaperPanel t={t as never} wallpaper={wallpaper} />)
  })
}

/** The browse button of the manual-folder row. */
function browseButton(): HTMLButtonElement | null {
  const buttons = Array.from(host.querySelectorAll('button'))
  return (buttons.find((button) => button.textContent === zh.wallpaperDirBrowse) ?? null) as HTMLButtonElement | null
}

describe('WallpaperPanel thumbs', () => {
  it('falls back to a muted first-frame <video> when no preview image exists', async () => {
    await render([{
      id: 'lib/aurora.mp4',
      title: 'aurora',
      type: 'video',
      source: 'local',
      playable: true,
      updateAvailable: false,
      videoUrl: '/api/skin-center/we/media/AAA',
      webUrl: null,
      frameUrl: null,
      previewUrl: null,
    }])
    const video = host.querySelector('video')
    expect(video).not.toBeNull()
    expect(video?.getAttribute('src')).toBe('/api/skin-center/we/media/AAA')
    expect(video?.getAttribute('preload')).toBe('metadata')
    expect(video?.muted).toBe(true)
    expect(host.querySelector('img')).toBeNull()
  })

  it('keeps the <img> thumb when the wallpaper has a real preview', async () => {
    await render([{
      id: 'workshop/123',
      title: 'sunset',
      type: 'video',
      source: 'workshop',
      playable: true,
      updateAvailable: false,
      videoUrl: '/api/skin-center/we/media/BBB',
      webUrl: null,
      frameUrl: null,
      previewUrl: '/api/skin-center/we/preview/CCC',
    }])
    const img = host.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/skin-center/we/preview/CCC')
    expect(host.querySelector('video')).toBeNull()
  })
})

describe('WallpaperPanel directory picker', () => {
  it('adds the picked folder directly through the native picker', async () => {
    const added: string[] = []
    await render([], stubWallpaper({
      pickDir: async () => '/Users/demo/Pictures/wallpapers',
      addDir: (dir) => { added.push(dir) },
    }))
    const button = browseButton()
    expect(button).not.toBeNull()
    await act(async () => { button!.click() })
    expect(added).toEqual(['/Users/demo/Pictures/wallpapers'])
  })

  it('does nothing when the picker is cancelled', async () => {
    const added: string[] = []
    await render([], stubWallpaper({
      pickDir: async () => null,
      addDir: (dir) => { added.push(dir) },
    }))
    await act(async () => { browseButton()!.click() })
    expect(added).toEqual([])
    expect(host.textContent).not.toContain(zh.wallpaperDirBrowseFailed)
  })

  it('shows the fallback error when the native picker is unavailable', async () => {
    await render([], stubWallpaper({
      pickDir: async () => { throw new Error('directory picker failed: no native capability') },
    }))
    await act(async () => { browseButton()!.click() })
    expect(host.textContent).toContain(zh.wallpaperDirBrowseFailed)
    // The manual input remains usable as the fallback.
    expect(host.querySelector('input')).not.toBeNull()
  })

  it('hides the browse button when the face provides no picker', async () => {
    const stub = stubWallpaper()
    delete (stub as { pickDir?: unknown }).pickDir
    await render([], stub)
    expect(browseButton()).toBeNull()
  })
})

describe('WallpaperPanel macOS system wallpapers', () => {
  const item = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    title: id,
    type: 'video',
    source: 'local',
    playable: true,
    updateAvailable: false,
    videoUrl: '/api/skin-center/we/media/' + id,
    webUrl: null,
    frameUrl: null,
    previewUrl: '/api/skin-center/we/preview/' + id,
    ...overrides,
  })

  it('pages the grid instead of mounting every thumbnail at once', async () => {
    const many = Array.from({ length: 25 }, (_, i) => item('w' + String(i)))
    await render(many)
    // Every item carries a previewUrl, so mounted cards are countable via
    // their thumbnail images.
    const cards = (): number => host.querySelectorAll('img').length
    expect(cards()).toBe(12)
    const more = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.startsWith(zh.wallpaperLoadMore)) as HTMLButtonElement
    expect(more.textContent).toContain('13')
    await act(async () => { more.click() })
    expect(cards()).toBe(24)
    const moreAgain = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.startsWith(zh.wallpaperLoadMore)) as HTMLButtonElement
    await act(async () => { moreAgain.click() })
    expect(cards()).toBe(25)
    expect(Array.from(host.querySelectorAll('button'))
      .some((button) => button.textContent?.startsWith(zh.wallpaperLoadMore))).toBe(false)
  })

  it('shows the static-image badge and no import button for macOS system entries', async () => {
    await render([item('macos-image/Tahoe Day', {
      type: 'image',
      source: 'system',
      playable: false,
      videoUrl: null,
      previewUrl: '/api/skin-center/we/image/AAA',
    })])
    expect(host.textContent).toContain(zh.wallpaperTypeImage)
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/api/skin-center/we/image/AAA')
    const labels = Array.from(host.querySelectorAll('button')).map((button) => button.textContent)
    expect(labels).not.toContain(zh.wallpaperImport)
  })

  it('reports the macOS library status line when system wallpapers exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        installDir: null,
        total: 1,
        portableCount: 1,
        systemCount: 1,
        wallpapers: [item('macos-aerial/AAAA-1', { source: 'system' })],
      }),
    })))
    root = createRoot(host)
    await act(async () => {
      root.render(<WallpaperPanel t={t as never} wallpaper={stubWallpaper()} />)
    })
    expect(host.textContent).toContain(zh.wallpaperLibrarySystem)
  })
})
