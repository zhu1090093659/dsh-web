// @vitest-environment jsdom
/** The portrait-touch adaptation: install, portrait apply, desktop revert. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMobileAdapt } from '../src/client/mobile-adapt.ts'

/** jsdom lacks matchMedia; script it from a mutable descriptor. */
const media = { portrait: false, coarse: false }
function stubMatchMedia(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('portrait') ? media.portrait : query.includes('coarse') ? media.coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }))
}

/** The adaptation reads viewport width from window.innerWidth. */
function setWidth(px: number): void {
  vi.stubGlobal('innerWidth', px)
}

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  window.sessionStorage.clear()
  // jsdom's localStorage in this vitest build lacks clear(); the adapt layer
  // only reads it (inside try/catch), so stale keys are harmless here.
  stubMatchMedia()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * A fresh module instance: startMobileAdapt is a page-lifetime singleton
 * guarded by a window flag, and its closure keeps DOM references that
 * beforeEach's body wipe detaches — new-layer tests reset both.
 */
async function freshStart(): Promise<() => void> {
  delete (window as unknown as Record<string, unknown>).__dshRemoteAdaptInstalled
  delete (window as unknown as Record<string, unknown>).__dshRemoteAdapt
  vi.resetModules()
  const mod = await import('../src/client/mobile-adapt.ts')
  return mod.startMobileAdapt
}

describe('startMobileAdapt', () => {
  it('installs the global and stays inert on a desktop viewport', () => {
    media.portrait = false
    media.coarse = false
    setWidth(1400)
    startMobileAdapt()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void; toggleSidebar: null } }).__dshRemoteAdapt
    expect(adapt).toBeDefined()
    expect(adapt?.toggleSidebar).toBeNull()
    adapt?.evaluate()
    expect(document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toBeNull()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
    expect(document.getElementById('dshRemoteWhale')).toBeNull()
  })

  it('applies the layer in portrait touch viewports and reverts off-portrait', () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    // A pre-existing viewport meta is what the layer mutates (appends
    // viewport-fit=cover for the safe-area insets) and restores on revert.
    const meta = document.createElement('meta')
    meta.name = 'viewport'
    meta.content = 'width=device-width, initial-scale=1'
    document.head.appendChild(meta)
    startMobileAdapt()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt
    adapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(true)
    const tag = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')
    expect(tag).not.toBeNull()
    // 16px input rule (iOS focus zoom) and the collapsed-rail pin ride along.
    expect(tag?.textContent).toContain('font-size:16px')
    expect(tag?.textContent).toContain('grid-template-columns:0 minmax(0,1fr) 0')
    expect(meta.getAttribute('content')).toContain('viewport-fit=cover')
    // The desktop-only suppressors stay, including the pet: the mobile
    // remote mirror is deliberately free of the desktop decoration (user
    // requirement - the phone surface must not show the floating pet).
    expect(tag?.textContent).toContain('data-dsh-plugin="usage"')
    expect(tag?.textContent).toContain('data-dsh-plugin="pet"')
    // Back to desktop: the layer reverts cleanly, viewport meta included.
    media.portrait = false
    adapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
    expect(document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toBeNull()
    expect(meta.getAttribute('content')).not.toContain('viewport-fit')
  })

  it('clamps a restored whale position back into the viewport', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    vi.stubGlobal('innerHeight', 700)
    // This jsdom build's localStorage lacks working methods; a stub also
    // keeps the dragged position isolated from other tests.
    const store: Record<string, string> = { 'dsh-remote-whale-pos': JSON.stringify({ x: 5000, y: 4000 }) }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    })
    // The whale is shown only while the official sidebar is collapsed.
    const frame = document.createElement('div')
    frame.className = 'app_frame'
    frame.setAttribute('data-sidebar-collapsed', '')
    document.body.appendChild(frame)
    const start = await freshStart()
    start()
    const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
    expect(whale).not.toBeNull()
    expect(parseFloat(whale?.style.left ?? 'NaN')).toBeLessThanOrEqual(390 - 38)
    expect(parseFloat(whale?.style.top ?? 'NaN')).toBeLessThanOrEqual(700 - 38)
  })

  it('Enter inserts a newline but an IME-confirm Enter (keyCode 229) does not', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const execCommand = vi.fn()
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand
    const target = document.createElement('textarea')
    target.className = 'chat_input'
    document.body.appendChild(target)
    const press = (keyCode: number | undefined, isComposing = false): boolean => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      Object.defineProperty(event, 'keyCode', { value: keyCode })
      Object.defineProperty(event, 'isComposing', { value: isComposing })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(press(13)).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '\n')
    execCommand.mockClear()
    expect(press(229)).toBe(false)
    expect(press(13, true)).toBe(false)
    expect(execCommand).not.toHaveBeenCalled()
  })

  it('setEnabled(false) reverts the layer; true re-applies it', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { setEnabled: (on: boolean) => void } }).__dshRemoteAdapt
    adapt?.setEnabled(false)
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
    expect(document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toBeNull()
    adapt?.setEnabled(true)
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(true)
  })

  it('the manual opt-out keeps the layer off', () => {
    sessionStorage.setItem('dsh-remote-force-desktop', '1')
    media.portrait = true
    media.coarse = true
    setWidth(390)
    startMobileAdapt()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    expect(document.body.classList.contains('dsh-remote-portrait')).toBe(false)
  })

  it('is idempotent: a second install does not double-apply', () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    startMobileAdapt()
    startMobileAdapt()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt
    adapt?.evaluate()
    expect(document.querySelectorAll('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')).toHaveLength(1)
  })

  it('re-asserts the stylesheet within one sync tick after external removal', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const start = await freshStart()
      start()
      const selector = 'style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]'
      expect(document.querySelector(selector)).not.toBeNull()
      // External DOM cleanup (observed live on the phone mirror) strips the
      // tag while the body class stays; the suppressions must come back.
      document.querySelector(selector)?.remove()
      expect(document.querySelector(selector)).toBeNull()
      await vi.advanceTimersByTimeAsync(600)
      const restored = document.querySelector(selector)
      expect(restored).not.toBeNull()
      expect(document.querySelectorAll(selector)).toHaveLength(1)
      expect(document.body.classList.contains('dsh-remote-portrait')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('injects the picker bottom sheet, the workbench suppression, and no body gap', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    const tag = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')
    expect(tag).not.toBeNull()
    const css = tag?.textContent ?? ''
    // The picker sheet: free the seat transform (fixed-position containing
    // block), pin seat menus to the viewport bottom, touch-sized cells.
    expect(css).toContain('[class$="_composerSeat"]{transform:none !important}')
    expect(css).toContain('[class$="_composerSeat"] [class$="_menu"]{position:fixed')
    expect(css).toContain('[class$="_menu"] [class$="_cell"]{height:44px')
    // The workbench suppression is scoped to the workbench panel: the same
    // portal layer hosts the settings modal, which must stay reachable.
    expect(css).toContain('[class$="_overlayLayer"] [class$="_workbench"]{display:none !important}')
    expect(css).not.toContain('[class$="_overlayLayer"]{display:none')
    // The compact picker: icon entries for model/effort inline in the tools
    // row (parallel to the permission trigger); the trailing line collapses.
    expect(css).toContain('body.dsh-remote-compact-picker [class$="_composerSeat"] [class$="_trailing"] [class$="_trigger"]')
    expect(css).toContain('body.dsh-remote-compact-picker [class$="_composerSeat"] [class$="_trailing"]{flex-basis:auto;position:static;min-height:0;padding:0;width:0}')
    expect(css).toContain('#dshRemoteModelPick,#dshRemoteEffortPick{width:26px;height:32px')
    // The dsh-LAN _body gap compaction must stay out: it clips message text.
    expect(css).not.toContain('_body"]{gap:6px}')
  })

  it('falls back to the official rail toggle when the wired face is inert', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      // A collapsed frame + the official logo toggle button (the fallback target).
      const frame = document.createElement('div')
      frame.className = 'app_frame'
      frame.setAttribute('data-sidebar-collapsed', '')
      document.body.appendChild(frame)
      const logoRow = document.createElement('div')
      logoRow.className = 'x_logoRow'
      const logoToggle = document.createElement('button')
      logoToggle.className = 'x_iconButton x_toggle'
      const clickSpy = vi.spyOn(logoToggle, 'click')
      logoRow.appendChild(logoToggle)
      document.body.appendChild(logoRow)
      const start = await freshStart()
      start()
      // Wire an inert face: mounted, callable, but a silent no-op — the
      // observed LayoutController state on the running local build.
      const adapt = (window as unknown as { __dshRemoteAdapt?: { toggleSidebar: () => void } }).__dshRemoteAdapt
      adapt!.toggleSidebar = () => {}
      const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
      expect(whale).not.toBeNull()
      whale!.click()
      expect(clickSpy).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(200)
      // The frame never flipped, so the official rail toggle took over.
      expect(clickSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fall back when the wired face flips the frame', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const frame = document.createElement('div')
      frame.className = 'app_frame'
      frame.setAttribute('data-sidebar-collapsed', '')
      document.body.appendChild(frame)
      const logoRow = document.createElement('div')
      logoRow.className = 'x_logoRow'
      const logoToggle = document.createElement('button')
      logoToggle.className = 'x_iconButton x_toggle'
      const clickSpy = vi.spyOn(logoToggle, 'click')
      logoRow.appendChild(logoToggle)
      document.body.appendChild(logoRow)
      const start = await freshStart()
      start()
      // A healthy face: the call itself flips the frame out of collapsed.
      const adapt = (window as unknown as { __dshRemoteAdapt?: { toggleSidebar: () => void } }).__dshRemoteAdapt
      adapt!.toggleSidebar = () => { frame.removeAttribute('data-sidebar-collapsed') }
      const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
      whale!.click()
      await vi.advanceTimersByTimeAsync(200)
      expect(clickSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
