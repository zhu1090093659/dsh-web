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

/**
 * Interval ids the layer started. freshStart() builds a new module instance per
 * test while the previous one keeps its page-lifetime listeners and sync tick,
 * so without this teardown a stale layer would keep re-suppressing rows on the
 * shared document (and the suite would accumulate live timers).
 */
let adaptTimers: number[] = []

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  // The header-actions reserve rides <html>, which the head/body wipe above
  // does not touch; clear it so one test cannot inherit another's value.
  document.documentElement.removeAttribute('style')
  window.sessionStorage.clear()
  // jsdom's localStorage in this vitest build lacks clear(); the adapt layer
  // only reads it (inside try/catch), so stale keys are harmless here.
  stubMatchMedia()
  adaptTimers = []
  const realSetInterval = globalThis.setInterval
  vi.stubGlobal('setInterval', (fn: () => void, ms?: number, ...args: unknown[]): number => {
    const id = realSetInterval(fn, ms, ...args) as unknown as number
    adaptTimers.push(id)
    return id
  })
})

afterEach(() => {
  for (const id of adaptTimers) globalThis.clearInterval(id)
  adaptTimers = []
  // The layer patches HTMLElement.prototype.focus globally; restore the page's
  // own function so one test's patch cannot stack onto the next one's.
  HTMLElement.prototype.focus = TRUE_FOCUS
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The page's own focus function (captured before any layer instance patches it). */
const TRUE_FOCUS = HTMLElement.prototype.focus

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

/**
 * One rule of the injected portrait sheet, read as it ships. The composer's
 * geometry rules are CSS contracts, and what such a rule must NOT declare
 * matters as much as what it does, so the lookup hands back the whole
 * declaration block.
 */
function adaptRule(selector: string): string {
  const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''
  return css.split('}').find(rule => rule.includes(selector)) ?? ''
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
    // The collapsed sidebar is an absolute overlay (out of grid flow); the
    // in-flow center would auto-place into the now-0px first track and
    // collapse to zero width. The columns are pinned explicitly so the
    // center always owns the 1fr track (regression: blank center on mobile).
    expect(tag?.textContent).toContain('[class$="_centerCol"]{grid-column:2/3}')
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
    // The app frame is identified by the aggregate compat stamp (or, without
    // it, by the layout center column it contains) — a bare `_frame` suffix
    // also matches unrelated official surfaces, so the fixture carries the
    // stamp the running GUI has.
    const frame = document.createElement('div')
    frame.className = 'app_frame'
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-sidebar-collapsed', '')
    document.body.appendChild(frame)
    const start = await freshStart()
    start()
    const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
    expect(whale).not.toBeNull()
    expect(parseFloat(whale?.style.left ?? 'NaN')).toBeLessThanOrEqual(390 - 38)
    expect(parseFloat(whale?.style.top ?? 'NaN')).toBeLessThanOrEqual(700 - 38)
  })

  it('user keeps the whale reachable after the viewport shrinks', async () => {
    // Given a visible whale positioned against a 390px-wide portrait viewport.
    media.portrait = true
    media.coarse = true
    setWidth(390)
    vi.stubGlobal('innerHeight', 700)
    const store: Record<string, string> = { 'dsh-remote-whale-pos': JSON.stringify({ x: 352, y: 100 }) }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value },
      removeItem: (key: string) => { delete store[key] },
    })
    const frame = document.createElement('div')
    frame.className = 'app_frame'
    frame.setAttribute('data-dsh-frame', '')
    frame.setAttribute('data-sidebar-collapsed', '')
    document.body.appendChild(frame)
    const start = await freshStart()
    start()
    const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
    expect(parseFloat(whale?.style.left ?? 'NaN')).toBe(352)
    // When the viewport shrinks while the whale stays visible (split-screen).
    setWidth(200)
    window.dispatchEvent(new Event('resize'))
    // Then it is re-clamped into the new viewport instead of parking off-screen,
    // where it would be unreachable (the only portrait sidebar entry).
    expect(parseFloat(whale?.style.left ?? 'NaN')).toBe(200 - 38)
  })

  it('user keeps the original focus behavior when the layer is disabled', async () => {
    // Given a portrait touch viewport and the page's own focus function.
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const original = HTMLElement.prototype.focus
    const start = await freshStart()
    start()
    const adapt = (window as unknown as { __dshRemoteAdapt?: { setEnabled: (on: boolean) => void } }).__dshRemoteAdapt
    // When the layer is active, then the composer-focus guard is installed.
    expect(HTMLElement.prototype.focus).not.toBe(original)
    // And disabling it hands the prototype back (a re-enable installs it again).
    adapt?.setEnabled(false)
    expect(HTMLElement.prototype.focus).toBe(original)
    adapt?.setEnabled(true)
    expect(HTMLElement.prototype.focus).not.toBe(original)
  })

  it('Enter inserts a newline but an IME-confirm Enter (keyCode 229) does not', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const execCommand = vi.fn()
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand
    // The composer seat is the scope of the rewrite: the same `_input` class
    // also sits on settings/plugin text fields, where a swallowed Enter left
    // the key dead (a newline in a single-line input is discarded).
    const seat = document.createElement('div')
    seat.className = 'chat_composerSeat'
    document.body.appendChild(seat)
    const target = document.createElement('textarea')
    target.className = 'chat_input'
    seat.appendChild(target)
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
    // The v79 compact picker is removed: the portrait composer keeps the
    // official text trigger, so no synthesized button ids and no
    // compact-picker body class may reappear in the sheet.
    expect(css).not.toContain('dsh-remote-compact-picker')
    expect(css).not.toContain('dshRemoteModelPick')
    expect(css).not.toContain('dshRemoteEffortPick')
    // The dsh-LAN _body gap compaction must stay out: it clips message text.
    expect(css).not.toContain('_body"]{gap:6px}')
  })

  it('user in portrait gets the settings-modal column switch gated to the portrait body class', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    // Given the layer is installed in a portrait touch viewport, when it
    // injects the adaptation stylesheet, then the settings-modal column
    // switch is unreachable without the portrait body class.
    start()
    const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''
    // The v68 settings-modal rules reshape the official two-column panel. The
    // overlay portal is shared with every other dialog, so an unscoped rule
    // collapsed the DESKTOP settings panel into a stacked column while the tag
    // sat in <head>. Each rule must carry the portrait gate.
    // Parse the sheet into (selector, block) pairs and assert on the selector
    // ALONE: a substring check would also match the longer gated selectors,
    // so one reverted rule could hide behind its six scoped siblings.
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1]!.trim(), m[2]!] as const)
    const overlayRules = rules.filter(([selector]) => selector.includes('[class$="_overlay"]'))
    // The 7 settings-modal rules. The workbench suppression keys on
    // _overlayLayer (a different portal) and is checked by the test above.
    expect(overlayRules.length).toBe(7)
    for (const [selector] of overlayRules) {
      expect(selector, selector).toMatch(/^body\.dsh-remote-portrait /)
    }
  })

  it('treats only the application frame as the app frame, not a nested _frame surface', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    // A nested official _frame (the chat turn rail / message thumbnail) must
    // not be mistaken for the layout frame: the injected viewport rule and the
    // whale visibility both key on the app frame.
    const nested = document.createElement('div')
    nested.className = 'chat_frame'
    document.body.appendChild(nested)
    const start = await freshStart()
    start()
    const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''
    expect(css).toContain('[class*="_frame"]:has([class*="_centerCol"]){width:100%;height:100dvh}')
    expect(css).not.toContain('[class$="_frame"]{width:100%;height:100dvh}')
    // With only the nested frame present the sidebar state is unknown, so the
    // whale (the collapsed-rail entry) stays hidden.
    const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
    expect(whale).not.toBeNull()
    expect(whale?.style.display).toBe('none')
    // The aggregate compat stamp is the fast path and works without a column.
    nested.setAttribute('data-dsh-frame', '')
    nested.setAttribute('data-sidebar-collapsed', '')
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    await vi.waitFor(() => { expect(whale?.style.display).not.toBe('none') })
  })

  it('user tapping an open portrait drawer hits the drawer rows, not the app frame', async () => {
    // Given the adaptation layer installed on a portrait phone
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()

    // When the injected sheet is read, then the drawer ladder is declared by
    // this layer itself. In its own drawer mode the official layout paints
    // _sidebarCol at z-index:71 over its _drawerMask at 70, and any stylesheet
    // that lands after the official one puts another layer above the drawer -
    // the app frame then answers every tap meant for an open drawer, which is
    // what the phone mirror reported (#2012/#2014: elementFromPoint returned
    // _frame and the drawer folded on its first tap). The ladder must not lean
    // on the aggregate compat sheet: this package also ships alone.
    const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''
    expect(css).toContain('[class*="_sidebarCol"]{z-index:1100 !important}')
    expect(css).toContain('[class*="_drawerMask"]{z-index:1050 !important}')
    const drawerZ = Number(/\[class\*="_sidebarCol"\]\{z-index:(\d+)/.exec(css)?.[1])
    const maskZ = Number(/\[class\*="_drawerMask"\]\{z-index:(\d+)/.exec(css)?.[1])
    // The dimming sits under the drawer it dims and above the content it darkens.
    expect(drawerZ).toBeGreaterThan(maskZ)
    expect(maskZ).toBeGreaterThan(0)
  })

  it('scopes the Enter rewrite to the composer, not every _input field', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const execCommand = vi.fn()
    ;(document as unknown as { execCommand: unknown }).execCommand = execCommand
    const settingsField = document.createElement('input')
    settingsField.className = 'settings_input'
    document.body.appendChild(settingsField)
    const press = (el: HTMLElement): boolean => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      el.dispatchEvent(event)
      return event.defaultPrevented
    }
    // A settings/plugin text field: Enter must reach the official handler.
    expect(press(settingsField)).toBe(false)
    expect(execCommand).not.toHaveBeenCalled()
    // The composer field (contenteditable input root) still gets the newline.
    const seat = document.createElement('div')
    seat.className = 'chat_composerSeat'
    const composer = document.createElement('div')
    composer.className = 'chat_input'
    composer.setAttribute('data-composer-input', '')
    seat.appendChild(composer)
    document.body.appendChild(seat)
    expect(press(composer)).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '\n')
  })

  it('keeps rows draggable-suppressed only while active and restores them on revert', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const sidebar = document.createElement('div')
    sidebar.className = 'app_sidebarCol'
    // The flat-list rows carry a state modifier after the semantic class, so a
    // suffix match missed every one of them.
    const row = document.createElement('div')
    row.className = 'x_sessionRow x_flatSessionRowWithoutStatus'
    row.setAttribute('draggable', 'true')
    sidebar.appendChild(row)
    document.body.appendChild(sidebar)
    const start = await freshStart()
    start()
    await vi.waitFor(() => { expect(row.getAttribute('draggable')).toBe('false') })
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    media.portrait = false
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    expect(row.getAttribute('draggable')).toBe('true')
  })

  it('user does not retain a detached session row for the page lifetime', async () => {
    // Given a portrait touch viewport with one draggable official session row.
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const sidebar = document.createElement('div')
    sidebar.className = 'app_sidebarCol'
    const row = document.createElement('div')
    row.className = 'x_sessionRow x_flatSessionRowWithoutStatus'
    row.setAttribute('draggable', 'true')
    sidebar.appendChild(row)
    document.body.appendChild(sidebar)
    const start = await freshStart()
    start()
    // When the layer suppresses the row's native drag.
    await vi.waitFor(() => { expect(row.getAttribute('draggable')).toBe('false') })
    // And React then replaces it (the detached node can never be restored by a
    // later revert, so tracking it would retain the whole detached subtree).
    sidebar.remove()
    // Then the detached node is forgotten and hands its official state back.
    await vi.waitFor(() => { expect(row.getAttribute('draggable')).toBe('true') })
    // And a node React re-attaches is recorded again and restores on revert.
    document.body.appendChild(sidebar)
    await vi.waitFor(() => { expect(row.getAttribute('draggable')).toBe('false') })
    media.portrait = false
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    expect(row.getAttribute('draggable')).toBe('true')
  })

  it('takes the header actions out of flow only while seated, without moving them', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''
    const seatRule = '[class$="_header"] [class$="_titleCluster"] [class$="_headerActions"]{position:absolute'
    const at = css.indexOf(seatRule)
    expect(at).toBeGreaterThan(-1)
    // The rule exists only behind the seat body class, and it never hides the
    // node: the actions stay in their React-owned slot and are painted over
    // the tabs row by the transform (re-parenting them would break React's
    // later insertBefore/removeChild anchors).
    expect(css.slice(Math.max(0, at - 40), at)).toContain('body.dsh-remote-header-seated')
    expect(css).not.toContain('[class$="_titleCluster"] [class$="_headerActions"]{display:none}')
    // No tabs row (single-tab session) means no seat: the body class stays off.
    expect(document.body.classList.contains('dsh-remote-header-seated')).toBe(false)
  })

  it('paints the header actions over the tabs row without re-parenting the React node', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    const header = document.createElement('div')
    header.className = 'chat_header'
    const cluster = document.createElement('div')
    cluster.className = 'chat_titleCluster'
    const actions = document.createElement('div')
    actions.className = 'chat_headerActions'
    cluster.appendChild(actions)
    const tabs = document.createElement('div')
    tabs.className = 'chat_tabs'
    const tab = document.createElement('button')
    tab.className = 'chat_tab'
    tab.textContent = 'Chat'
    tabs.appendChild(tab)
    header.append(cluster, tabs)
    document.body.appendChild(header)
    await vi.waitFor(() => { expect(document.body.classList.contains('dsh-remote-header-seated')).toBe(true) })
    // The node stays in its React-owned slot; only the injected CSS and the
    // transform move it visually (a re-parented node breaks React's anchors).
    expect(actions.parentElement).toBe(cluster)
    expect(actions.style.transform).toBe('translate(0px, 0px)')
    // v80: the painted width is reserved through a CSS variable on <html>, so
    // the row caps its own width with it (and scrolls) instead of reserving
    // padding that a nowrap flex row overflows anyway.
    expect(document.documentElement.style.getPropertyValue('--dsh-remote-header-actions-reserve')).toBe('8px')
  })

  it('user in portrait gets the tabs row capped against the painted actions and the reserve released', async () => {
    // Given a portrait coarse-pointer viewport
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()

    // When the adaptation layer installs
    start()
    const css = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')?.textContent ?? ''

    // Then the row caps its own width and scrolls: issue #1635 showed padding
    // alone does not move the labels out from under the painted actions,
    // because a nowrap flex row overflows its own padding box
    expect(css).toContain('max-width:max(0px,calc(100% - var(--dsh-remote-header-actions-reserve,0px)))')
    expect(css).toContain('overflow-x:auto')
    const header = document.createElement('div')
    header.className = 'chat_header'
    const cluster = document.createElement('div')
    cluster.className = 'chat_titleCluster'
    const actions = document.createElement('div')
    actions.className = 'chat_headerActions'
    cluster.appendChild(actions)
    const tabs = document.createElement('div')
    tabs.className = 'chat_tabs'
    tabs.innerHTML = '<button class="chat_tab">Chat</button>'
    header.append(cluster, tabs)
    document.body.appendChild(header)
    await vi.waitFor(() => { expect(document.body.classList.contains('dsh-remote-header-seated')).toBe(true) })
    expect(document.documentElement.style.getPropertyValue('--dsh-remote-header-actions-reserve')).toBe('8px')
    // Reverting the layer releases the reserve, so a portrait-to-desktop flip
    // leaves the official row width untouched.
    const adapt = (window as unknown as { __dshRemoteAdapt?: { setEnabled: (on: boolean) => void } }).__dshRemoteAdapt
    adapt?.setEnabled(false)
    expect(document.documentElement.style.getPropertyValue('--dsh-remote-header-actions-reserve')).toBe('')
  })

  it('injects no compact picker buttons into the composer tools row', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const start = await freshStart()
      start()
      // Given a composer seat whose trailing trigger the removed compact picker
      // used to wire against, when the sync tick runs, then the tools row stays
      // free of the synthesized model/effort icon buttons and the body carries
      // no compact-picker gate.
      const seat = document.createElement('div')
      seat.className = 'app_composerSeat'
      const tools = document.createElement('div')
      tools.className = 'x_tools'
      const trailing = document.createElement('div')
      trailing.className = 'x_trailing'
      trailing.innerHTML = '<div class="x_trigger"><div class="x_triggerEffort"></div></div>'
      seat.append(tools, trailing)
      document.body.appendChild(seat)
      await vi.advanceTimersByTimeAsync(1200)
      expect(document.getElementById('dshRemoteModelPick')).toBeNull()
      expect(document.getElementById('dshRemoteEffortPick')).toBeNull()
      expect(tools.querySelectorAll('button')).toHaveLength(0)
      expect(document.body.classList.contains('dsh-remote-compact-picker')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('operator gets the send button contained by the composer card on a narrow phone', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    ;(window as unknown as { __dshRemoteAdapt?: { evaluate: () => void } }).__dshRemoteAdapt?.evaluate()
    // Given the trailing line is forced onto its own row at flex-basis:100% and
    // carries 116px of side padding (38 left for the command button, 78 right
    // for the send button), when the sheet is read, then that line is
    // border-box: under the default content-box the padding is added to the
    // 100% basis, the line overflows the card by exactly 116px, and the
    // absolutely-positioned send button is dragged outside the card and past
    // the viewport edge (issue #1818). The card geometry itself must stay
    // untouched - the button moves back in, the card does not grow.
    const tag = document.querySelector('style[data-plugin-css="dsh-remote-web-ui/mobile-adapt.css"]')
    const css = tag?.textContent ?? ''
    const trailing = css.split('}').find(rule => rule.includes('[class$="_composerSeat"] [class$="_trailing"]{'))
    expect(trailing).toContain('box-sizing:border-box')
    expect(trailing).toContain('flex-basis:100%')
    expect(trailing).toContain('padding-right:78px')
    // The button keeps its in-card right edge offset, so it lands inside the
    // padded content box rather than at the screen edge.
    expect(css).toContain('[class$="_composerSeat"] [class$="_primary"]{position:absolute;right:8px')
  })

  it('operator gets the send button centered over both composer lines', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    // Given the control row wraps the tools line and the trailing line into one
    // two-line box and the send button plus the context meter float over it,
    // when the sheet is read, then that row is their only containing block.
    // Positioned, the trailing line took the role from both, so each centered
    // inside the last line alone and the send button rode the input's bottom
    // edge, out of line with the attach button (issue #1829).
    expect(adaptRule('[class$="_composerSeat"] [class$="_row"]{')).toContain('position:relative')
    expect(adaptRule('[class$="_composerSeat"] [class$="_trailing"]{')).not.toMatch(/position:\s*(relative|absolute|sticky|fixed)/)
    // Both floats keep the anchors that put them on that one shared middle.
    expect(adaptRule('[class$="_composerSeat"] [class$="_primary"]{')).toContain('top:50%;transform:translateY(-50%)')
    expect(adaptRule('[class$="_trailing"] > [class$="_root"]:has([class$="_track"]){')).toContain('top:50%;transform:translateY(-50%)')
  })

  it('operator can open the file picker from the attach button on a portrait phone', async () => {
    media.portrait = true
    media.coarse = true
    setWidth(390)
    const start = await freshStart()
    start()
    // Given the attach button floats out of flow at the left edge of the same
    // two-line box, when the sheet is read, then it keeps the row-relative
    // anchors that center it over both lines and owns an explicit hit layer.
    // While the trailing line was positioned it painted after this button and
    // covered its lower half, so the taps there reached nothing at all
    // (issue #1829) - the attach button is the only file-picker entry on the
    // portrait composer.
    const add = adaptRule('[class$="_composerSeat"] [class$="_add"]{')
    expect(add).toContain('position:absolute;left:8px;top:50%;transform:translateY(-50%)')
    expect(add).toContain('z-index:10')
  })

  it('reads injected-surface labels from the wired translate seat, not the browser language', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const start = await freshStart()
      start()
      const adapt = (window as unknown as { __dshRemoteAdapt?: { translate: ((key: string) => string) | null; evaluate: () => void } }).__dshRemoteAdapt
      // Before the plugin apply wires the seat, the labels use the English
      // fallback (never the navigator-language pick the layer used to make).
      const whale = document.getElementById('dshRemoteWhale')
      expect(whale?.title).toBe('Open sidebar')
      // Wire the seat the way the plugin apply does once ctx.locale is bound.
      const labels: Record<string, string> = {
        'mobile.whale.open': 'Открыть боковую панель',
      }
      adapt!.translate = (key) => labels[key] ?? key
      await vi.advanceTimersByTimeAsync(600)
      expect(whale?.title).toBe(labels['mobile.whale.open'])
      expect(whale?.getAttribute('aria-label')).toBe(labels['mobile.whale.open'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('drives the official toggle first and never waits on the inert layout face', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const frame = document.createElement('div')
      frame.className = 'app_frame'
      frame.setAttribute('data-dsh-frame', '')
      frame.setAttribute('data-sidebar-collapsed', '')
      document.body.appendChild(frame)
      const logoRow = document.createElement('div')
      logoRow.className = 'x_logoRow'
      const logoToggle = document.createElement('button')
      logoToggle.className = 'x_iconButton x_toggle'
      const clickSpy = vi.spyOn(logoToggle, 'click').mockImplementation(() => {
        frame.removeAttribute('data-sidebar-collapsed')
      })
      logoRow.appendChild(logoToggle)
      document.body.appendChild(logoRow)
      const start = await freshStart()
      start()
      // The wired face is a silent no-op on the installed cohort; it must not
      // be needed at all when the official toggle exists.
      const faceSpy = vi.fn()
      const adapt = (window as unknown as { __dshRemoteAdapt?: { toggleSidebar: () => void } }).__dshRemoteAdapt
      adapt!.toggleSidebar = faceSpy
      const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
      expect(whale).not.toBeNull()
      whale!.click()
      expect(clickSpy).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(600)
      expect(faceSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the wired face when the official toggle does not flip the frame', async () => {
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const frame = document.createElement('div')
      frame.className = 'app_frame'
      frame.setAttribute('data-dsh-frame', '')
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
      const faceSpy = vi.fn(() => { frame.removeAttribute('data-sidebar-collapsed') })
      const adapt = (window as unknown as { __dshRemoteAdapt?: { toggleSidebar: () => void } }).__dshRemoteAdapt
      adapt!.toggleSidebar = faceSpy
      const whale = document.getElementById('dshRemoteWhale') as HTMLElement | null
      whale!.click()
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(faceSpy).not.toHaveBeenCalled()
      // The toggle click never flipped the frame, so the face takes over.
      await vi.advanceTimersByTimeAsync(400)
      expect(faceSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('user gets an overlay arriving while the layer is active picked up on the next tick', async () => {
    // Given an active portrait layer with the sidebar collapsed, so the whale
    // (the only portrait sidebar entry) is showing.
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const frame = document.createElement('div')
      frame.className = 'app_frame'
      frame.setAttribute('data-dsh-frame', '')
      frame.setAttribute('data-sidebar-collapsed', '')
      document.body.appendChild(frame)
      const start = await freshStart()
      start()
      const whale = document.getElementById('dshRemoteWhale') as HTMLElement
      await vi.advanceTimersByTimeAsync(600)
      expect(whale.style.display).not.toBe('none')

      // When an official overlay appears (a class whose token ends in _overlay).
      const overlay = document.createElement('div')
      overlay.className = 'pI_x6G_overlay'
      document.body.appendChild(overlay)

      // Then the whale yields to it within one tick, not after a TTL.
      await vi.advanceTimersByTimeAsync(600)
      expect(whale.style.display).toBe('none')
    } finally {
      vi.useRealTimers()
    }
  })

  it('user gets a header that appeared while the layer was reverted seated on the first tick back', async () => {
    // Given an active layer whose tick has already learned that no header
    // exists (a session that has not rendered one yet caches the miss).
    vi.useFakeTimers()
    try {
      media.portrait = true
      media.coarse = true
      setWidth(390)
      const start = await freshStart()
      start()
      await vi.advanceTimersByTimeAsync(600)
      expect(document.body.classList.contains('dsh-remote-header-seated')).toBe(false)
      const adapt = (window as unknown as { __dshRemoteAdapt?: { setEnabled: (on: boolean) => void } }).__dshRemoteAdapt

      // When the layer is reverted — nothing observes the document from here on
      // — and the header then appears inside that blind window.
      adapt?.setEnabled(false)
      const header = document.createElement('div')
      header.className = 'chat_header'
      const cluster = document.createElement('div')
      cluster.className = 'chat_titleCluster'
      const actions = document.createElement('div')
      actions.className = 'chat_headerActions'
      cluster.appendChild(actions)
      const tabs = document.createElement('div')
      tabs.className = 'chat_tabs'
      tabs.innerHTML = '<button class="chat_tab">Chat</button>'
      header.append(cluster, tabs)
      document.body.appendChild(header)

      // Then re-enabling seats it on the first tick rather than serving the
      // absent verdict recorded before the observer gap.
      adapt?.setEnabled(true)
      await vi.advanceTimersByTimeAsync(600)
      expect(document.body.classList.contains('dsh-remote-header-seated')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
