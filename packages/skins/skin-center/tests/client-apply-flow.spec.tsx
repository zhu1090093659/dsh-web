// @vitest-environment jsdom
/**
 * One-click apply regression (issue #447): when the patch write is
 * confirmed active but the boot manifest never regenerates (no host hot
 * reload), the card must say "restart dsh" instead of the misleading
 * "applied but unconfirmed — dsh-skin use <skin>" hint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SkinCenter } from '../src/client/SkinCenter.tsx'
import { resetHotOverride, TryOnController } from '../src/client/try-on.ts'
import { zh, type SkinCenterKey } from '../src/client/locales.ts'

vi.mock('../src/client/WallpaperPanel.tsx', () => ({ WallpaperPanel: () => null }))

;((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) = true

const jsonRes = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
})
const textRes = (body: string) => ({
  ok: true,
  status: 200,
  json: async () => { throw new Error('not json') },
  text: async () => body,
})

const noopBackground = {
  enabled: () => true,
  opacity: () => 0,
  blurEmpty: () => 0,
  blurContent: () => 0,
  bubbleOpacity: () => 50,
  subscribe: () => () => {},
  setEnabled: () => {},
  setOpacity: () => {},
  setBlurEmpty: () => {},
  setBlurContent: () => {},
  setBubbleOpacity: () => {},
}
// Cached snapshot: useSyncExternalStore loops when getSnapshot returns a
// fresh object on every call.
const themeSnapshot = { active: { colorScheme: 'light' } }
const theme = {
  getTheme: () => themeSnapshot,
  subscribe: () => () => {},
  setTheme: () => {},
}

const staleHtml = '<html><head></head><body>stale document without the target skin</body></html>'

beforeEach(() => {
  resetHotOverride()
  document.body.innerHTML = '<div id="root"></div>'
  document.head.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('skin-center apply flow', () => {
  it('hints a restart when the write is confirmed but the manifest never regenerates', async () => {
    vi.useFakeTimers()
    let applied: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input)
      if (url.endsWith('/api/skin-center/apply')) {
        // Learn the applied skin from the POST body so /state echoes it active.
        const body = JSON.parse(String(init?.body ?? '{}')) as { skin?: string; official?: boolean }
        applied = body.skin ?? null
        return jsonRes({ ok: true })
      }
      if (url.endsWith('/api/skin-center/state')) return jsonRes({ ok: true, active: applied })
      return textRes(staleHtml)
    }))
    const controller = new TryOnController({
      loadBundle: async () => { throw new Error('no bundle in test') },
    })
    const t = (key: SkinCenterKey) => zh[key] ?? key
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => {
      root.render(<SkinCenter t={t} controller={controller} theme={theme as never} background={noopBackground as never} wallpaper={{} as never} />)
    })
    const applyButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent === zh.apply)
    expect(applyButton).toBeDefined()
    act(() => { applyButton!.click() })
    // Apply POST resolves; confirmActive polls /state (active echo) and
    // resolves true; controller.commit rejects (no bundle) and falls back
    // to manifestReady, whose document poll never sees the skin.
    await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
    expect(host.textContent).toContain(zh.appliedNeedRestart)
    expect(host.textContent).not.toContain('dsh-skin use')
    expect(host.textContent).not.toContain(zh.appliedUnconfirmed)
  })
})