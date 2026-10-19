/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, RESPONSIVE_CSS } from '../src/client/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-dsh-compat="responsive"]').forEach(style => style.remove())
})

describe('aggregate responsive compat contract', () => {
  it('stamps new content in the shared frame without queueing a second frame', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id })
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame) })
    document.body.innerHTML = '<main><aside class="sidebarCol"></aside><section class="centerCol"></section></main>'
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)
    try {
      const code = document.createElement('pre')
      document.querySelector('.centerCol')!.appendChild(code)
      await Promise.resolve()
      expect(frames.size).toBe(1)
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(0))
      expect(code.getAttribute('data-dsh-responsive-part')).toBe('code')
      expect(frames.size).toBe(0)

      document.querySelector('.centerCol')!.appendChild(document.createElement('pre'))
      await Promise.resolve()
      expect(frames.size).toBe(1)
      cleanup?.()
      cleanup = undefined
      expect(frames.size).toBe(0)
    } finally {
      cleanup?.()
    }
  })

  it('user toggling a conversation disclosure bar keeps the page inside the viewport', () => {
    // Every conversation disclosure bar calls focus() on itself when toggled
    // (ui-chat ChatGroupSeat's ProcessGroupHeader, TurnProcessNodeView). A
    // focused element below document overflow scrolls the page down by that
    // overflow, which reads as the page being stretched downward. The
    // skin-center copy of this lock is inert with no active visual, so the
    // aggregate owns the unconditional one.
    // Given the aggregate responsive stylesheet, when the shell frame is up,
    // then the scrolling root is locked so focus() has no overflow to scroll.
    const lock = RESPONSIVE_CSS.match(/html:has\(\[data-dsh-frame\]\)[^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(lock).toContain('overflow: hidden')
    expect(lock).toContain('height: 100%')
    // Scoped to the frame so it stays inert before the shell mounts.
    expect(RESPONSIVE_CSS).toContain('html:has([data-dsh-frame]) > body')
    // Never lock the app root: its own lock clipped content (#1222/#1225).
    expect(RESPONSIVE_CSS).not.toContain('[id="root"]')
    expect(RESPONSIVE_CSS).not.toMatch(/#root\b/)
  })

  it('user on the macOS desktop keeps window dragging and double-click zoom', () => {
    // The official base stylesheet marks every direct body child as
    // `-webkit-app-region: no-drag` ("html[data-platform=darwin]
    // body>:not(#root)"). A body-level element spanning the viewport therefore
    // subtracts the whole window from the macOS draggable region and cancels the
    // official [data-window-drag] chrome rows along with it - the window stops
    // dragging by its title bar and macOS stops running the system double-click
    // action (zoom to fit the screen). `pointer-events: none` does not exempt an
    // element from that computation, so the family's non-interactive body-level
    // decorations (the skin center's fixed decoration layers and backdrop-blur
    // veil, the aggregate's boot splash) must opt out declaratively.
    // Given the aggregate compat stylesheet, when it is served on the desktop,
    // then every non-interactive family overlay directly under body leaves the
    // app-region computation alone.
    const rule = RESPONSIVE_CSS.match(/html\[data-platform="darwin"\] body > :is\(([\s\S]*?)\)\s*\{([^}]*)\}/)
    const selectors = rule?.[1] ?? ''
    const declarations = rule?.[2] ?? ''
    expect(selectors).toContain('[data-dsh-skin-layer]')
    expect(selectors).toContain('[data-dsh-boot-splash]')
    expect(selectors).toContain('[aria-hidden="true"]')
    expect(declarations).toContain('-webkit-app-region: initial !important')
    // Desktop-only: every other platform keeps the official computation.
    expect(RESPONSIVE_CSS.match(/body > :is\(/g)).toHaveLength(1)
    expect(RESPONSIVE_CSS).toContain('html[data-platform="darwin"] body > :is(')
  })

  it('user on a phone with a home indicator keeps the frame inside the viewport', () => {
    // Given env(safe-area-inset-bottom) is content-box padding by default, when
    // it is non-zero, then 100dvh of CONTENT plus the inset would overflow the
    // viewport and stretch the page downward by the inset.
    const mobile = RESPONSIVE_CSS.match(/@media \(max-width: 768px\) \{\s*\[data-dsh-frame\] \[data-dsh-responsive-part="sidebar-toggle"\][^@]*?\[data-dsh-frame\] \{([^}]*)\}/s)?.[1] ?? ''
    expect(mobile).toContain('box-sizing: border-box')
    expect(mobile).toContain('height: 100dvh')
    expect(mobile).toContain('max-height: 100dvh')
    expect(mobile).toContain('padding-bottom: env(safe-area-inset-bottom)')
  })

  it('uses stable semantic hooks and a bounded mobile breakpoint', () => {
    expect(RESPONSIVE_CSS).toContain('[data-dsh-frame]')
    expect(RESPONSIVE_CSS).toContain('[data-pane="sidebar"]')
    expect(RESPONSIVE_CSS).toContain('[data-pane="conversation"]')
    expect(RESPONSIVE_CSS).toContain('@media (max-width: 768px)')
    expect(RESPONSIVE_CSS.match(/@media \(max-width: 768px\)/g)).toHaveLength(2)
    expect(RESPONSIVE_CSS).not.toContain('@media (max-width: 480px)')
    expect(RESPONSIVE_CSS).toContain('100dvh')
    expect(RESPONSIVE_CSS).toContain('env(safe-area-inset-bottom)')
    expect(RESPONSIVE_CSS).not.toMatch(/class\*=/)
  })

  it('keeps an open settings dialog reachable in the collapsed narrow rail (#1510)', () => {
    // The official settings panel renders inside the sidebar foot, which the
    // collapse rule hides and the collapsed pane freezes with pointer-events:
    // none; the shell must restore exactly the subtree carrying a dialog.
    expect(RESPONSIVE_CSS).toContain(':has([role="dialog"], [aria-modal="true"])')
    const rule = RESPONSIVE_CSS.match(/:has\(\[role="dialog"\], \[aria-modal="true"\]\)\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toContain('display: flex !important')
    expect(rule).toContain('pointer-events: auto')
  })

  it('stamps the session header from its stable slot wrapper', () => {
    document.body.innerHTML = `
      <main class="shell_frame">
        <aside class="hash_sidebarCol"><div data-slot="sidebar"><div><div><button>toggle</button></div></div></div></aside>
        <section class="hash_centerCol">
          <div data-slot="conversation.session">
            <div data-slot="conversation.session.header">
              <header>
                <div><div><nav aria-label="Hierarchy"><button>Session title</button></nav><div></div></div><div><button aria-label="Session utility"></button></div></div>
                <div role="tablist"><button role="tab">Chat</button><button role="tab">Files</button></div>
              </header>
            </div>
            <div data-conversation-scroll></div>
          </div>
        </section>
        <aside class="hash_detailsCol"></aside>
      </main>`
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)
    const conversation = document.querySelector('[data-pane="conversation"]')
    expect(conversation?.querySelector('[data-dsh-responsive-part="conversation-header"]')).not.toBeNull()
    expect(conversation?.querySelector('[data-dsh-responsive-part="session-title-row"]')).not.toBeNull()
    expect(conversation?.querySelector('[data-dsh-responsive-part="session-title-cluster"] nav')?.textContent).toBe('Session title')
    expect(conversation?.querySelector('[data-dsh-responsive-part="session-utilities"] button')?.getAttribute('aria-label')).toBe('Session utility')
    expect(conversation?.querySelector('[data-dsh-responsive-part="session-tablist"]')?.getAttribute('role')).toBe('tablist')
    cleanup?.()
  })

  it('allocates disjoint mobile rows and reserves the collapsed rail at 360px', () => {
    expect(RESPONSIVE_CSS).toContain('padding: 8px 8px 0 60px !important')
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-responsive-part="session-title-row"\]\s*\{\s*display:\s*contents;/)
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-responsive-part="session-title-cluster"\]\s*\{[^}]*box-sizing:\s*border-box;[^}]*padding-inline-end:\s*44px;/s)
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-responsive-part="session-tablist"\]\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s)
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-responsive-part="session-utilities"\]\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s)
    expect(RESPONSIVE_CSS).toContain('max-width: 42vw')

    const viewportWidth = 360
    const collapsedRailEnd = 52
    const headerContentStart = 60
    const headerContentEnd = viewportWidth - 8
    const gridGap = 8
    const utilitiesMaxWidth = viewportWidth * 0.42
    const utilitiesStart = headerContentEnd - utilitiesMaxWidth
    const tabsEnd = utilitiesStart - gridGap
    expect(headerContentStart).toBeGreaterThan(collapsedRailEnd)
    expect(tabsEnd).toBeLessThan(utilitiesStart)
  })

  it('keeps the collapsed rail toggle reachable and cleans up on dispose', () => {
    expect(RESPONSIVE_CSS).toContain('[data-dsh-frame][data-sidebar-collapsed]')
    expect(RESPONSIVE_CSS).toContain('[data-dsh-responsive-part="sidebar-toggle"]')
    expect(RESPONSIVE_CSS).toContain('min-width: 44px')
    expect(RESPONSIVE_CSS).toContain('pointer-events: none')
    expect(RESPONSIVE_CSS).toContain('background: transparent !important')
    expect(RESPONSIVE_CSS).toContain(':not(:first-child)')
    expect(RESPONSIVE_CSS).toContain('[data-dsh-part="summon-button"] {')
    expect(RESPONSIVE_CSS).toContain('z-index: 40 !important')
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-frame\]:not\(\[data-sidebar-collapsed\]\)::after\s*\{[^}]*z-index:\s*1050;[^}]*background:/s)
    expect(RESPONSIVE_CSS).toMatch(/\[data-dsh-frame\]\[data-sidebar-collapsed\] \[data-dsh-center-view-back\]\s*\{[^}]*margin-inline-start:\s*52px;/s)
    document.body.innerHTML = `
      <main class="shell_frame" data-sidebar-collapsed>
        <aside class="hash_sidebarCol"><div data-slot="sidebar"><div><div><button>brand</button><button>toggle</button></div><nav><button>nav</button></nav><footer><button>footer</button></footer></div></div></aside>
        <section class="hash_centerCol"><div data-slot="conversation.composer"><textarea data-phase="input"></textarea></div><pre>code</pre></section>
        <aside class="hash_detailsCol"><div>details</div></aside>
      </main>`
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)
    const frame = document.querySelector('[data-dsh-frame]')
    expect(frame?.querySelector('[data-pane="sidebar"] [data-dsh-responsive-part="sidebar-toggle"]')?.textContent).toBe('toggle')
    expect(frame?.querySelector('[data-pane="sidebar"] nav button')?.hasAttribute('data-dsh-part')).toBe(false)
    expect(frame?.querySelector('[data-pane="conversation"] [data-dsh-responsive-part="composer"]')).not.toBeNull()
    expect(frame?.querySelector('[data-pane="conversation"] [data-dsh-responsive-part="code"]')).not.toBeNull()
    cleanup?.()
    expect(document.head.querySelector('style[data-dsh-compat="responsive"]')).toBeNull()
  })

  it('dismisses the mobile drawer after a sidebar entry click only', async () => {
    document.body.innerHTML = `<main data-dsh-frame><aside data-pane="sidebar"><div data-slot="sidebar"><div><div><button data-dsh-responsive-part="sidebar-toggle">toggle</button></div><button data-dsh-part="sidebar-entry">task board</button></div></div></aside><section data-pane="conversation"></section></main>`
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const toggle = document.querySelector<HTMLButtonElement>('[data-dsh-responsive-part="sidebar-toggle"]')!
    const clicked = vi.fn(() => document.querySelector('[data-dsh-frame]')?.setAttribute('data-sidebar-collapsed', ''))
    toggle.addEventListener('click', clicked)
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)
    document.querySelector<HTMLElement>('[data-dsh-part="sidebar-entry"]')!.click()
    expect(clicked).toHaveBeenCalledOnce()
    document.querySelector('[data-dsh-frame]')?.removeAttribute('data-sidebar-collapsed')
    toggle.click()
    expect(clicked).toHaveBeenCalledTimes(2)
    cleanup?.()
  })

  // #1716: a workspace group row and its row-actions menu are not selections.
  // The group row toggles aria-expanded in place, so folding the drawer on that
  // click reads as "the group will not open"; the same click on the row's
  // ellipsis discarded the menu before it could be used.
  it('operator tapping a group row or its actions keeps the mobile drawer open', () => {
    document.body.innerHTML = `<main data-dsh-frame><aside data-pane="sidebar"><div data-slot="sidebar"><div><div><button data-dsh-responsive-part="sidebar-toggle">toggle</button></div></div>
      <div class="hash_projectRow" role="treeitem" aria-expanded="true"><span>workspace</span>
        <span class="hash_rowActions"><button aria-label="actions">dots</button><button aria-label="new session">plus</button></span>
        <button class="hash_sessionRow" role="treeitem"><span>session inside</span></button>
      </div>
      <button class="hash_sessionRow" role="treeitem">session</button>
    </div></aside><section data-pane="conversation"></section></main>`
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const frame = document.querySelector<HTMLElement>('[data-dsh-frame]')!
    const toggle = document.querySelector<HTMLButtonElement>('[data-dsh-responsive-part="sidebar-toggle"]')!
    toggle.addEventListener('click', () => { frame.setAttribute('data-sidebar-collapsed', '') })
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)

    // Given the drawer open on a narrow viewport with a group row that has a
    // menu trigger and a new-session button beside its label
    // When the operator taps the group row to expand it
    document.querySelector<HTMLElement>('[class*="projectRow"] > span')!.click()
    // Then the drawer stays open for the rows the expansion just revealed
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)

    // When the operator taps the row-actions menu trigger
    document.querySelector<HTMLElement>('[class*="rowActions"] button')!.click()
    // Then the drawer stays open so the menu can be used
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)

    // When the operator taps the group's new-session button
    document.querySelectorAll<HTMLElement>('[class*="rowActions"] button')[1]!.click()
    // Then the drawer folds, because that tap leaves this list for a new session
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    frame.removeAttribute('data-sidebar-collapsed')

    // When the operator taps a session row inside the group, the selection still folds
    document.querySelector<HTMLElement>('[class*="projectRow"] [class*="sessionRow"]')!.click()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)

    // When the operator taps a top-level session row, the selection still folds
    frame.removeAttribute('data-sidebar-collapsed')
    document.querySelector<HTMLElement>('[class*="projectRow"] + [class*="sessionRow"]')!.click()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    cleanup?.()
  })

  it('captures an outside drawer click without activating the underlay', () => {
    document.body.innerHTML = `<main data-dsh-frame><aside data-pane="sidebar"><div data-slot="sidebar"><div><div><button data-dsh-responsive-part="sidebar-toggle">toggle</button></div></div></div></aside><section data-pane="conversation"><button id="underlay">underlay</button></section></main>`
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const frame = document.querySelector<HTMLElement>('[data-dsh-frame]')!
    const toggle = document.querySelector<HTMLButtonElement>('[data-dsh-responsive-part="sidebar-toggle"]')!
    const underlay = document.querySelector<HTMLButtonElement>('#underlay')!
    const toggleHandler = vi.fn(() => { frame.toggleAttribute('data-sidebar-collapsed') })
    const underlayHandler = vi.fn()
    toggle.addEventListener('click', toggleHandler)
    underlay.addEventListener('click', underlayHandler)
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)

    const outsideClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(underlay.dispatchEvent(outsideClick)).toBe(false)
    expect(outsideClick.defaultPrevented).toBe(true)
    expect(toggleHandler).toHaveBeenCalledOnce()
    expect(underlayHandler).not.toHaveBeenCalled()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)

    underlay.click()
    expect(toggleHandler).toHaveBeenCalledOnce()
    expect(underlayHandler).toHaveBeenCalledOnce()
    cleanup?.()
  })

  it('mounts boot shield overlay and dismisses once frame is stamped (#1301)', () => {
    expect(RESPONSIVE_CSS).toContain('[data-dsh-boot-splash]')
    expect(RESPONSIVE_CSS).toContain('[data-dsh-boot-splash][data-ready]')
    document.body.innerHTML = `
      <main class="shell_frame">
        <aside class="hash_sidebarCol"><div data-slot="sidebar"><div><div><button>toggle</button></div></div></div></aside>
        <section class="hash_centerCol"><div data-slot="conversation.session"></div></section>
      </main>`
    let cleanup: (() => void) | undefined
    apply({ effect: (effect: () => (() => void) | void) => { cleanup = effect() ?? undefined } } as never)
    const splash = document.querySelector<HTMLElement>('[data-dsh-boot-splash]')
    expect(splash).not.toBeNull()
    expect(splash?.hasAttribute('data-ready')).toBe(true)
    cleanup?.()
    expect(document.querySelector('[data-dsh-boot-splash]')).toBeNull()
  })

  // The drawer contract is not a skin decision. The skin-center loader
  // force-scopes every skin selector under html[data-dsh-skin="<id>"], so a
  // skin's `body [data-pane='sidebar'] { position: relative; }` (rainy-night,
  // shuimo-danqing, whale-fantasy, xinghai-heart) is served as
  // `html[data-dsh-skin="..."] body [data-pane='sidebar']` - 0-2-2 against a
  // plain 0-2-0 - and `div:has(> [data-slot="sidebar"]) { position: relative
  // !important; }` (last-exile, porco-rosso, white-snake) is served as
  // `html[data-dsh-skin="..."] body div:has(...)` - 0-2-3. Without the
  // important declaration the first shape wins; with it alone the second still
  // does, because two important declarations fall back to specificity. The
  // drawer rule therefore carries both: !important AND the redundant :is()
  // that lifts it to 0-3-0. Either half alone regresses a real skin.
  it('user on a narrow viewport keeps the drawer contract above any skin override', () => {
    // Given the mobile breakpoint block declares the sidebar pane as a drawer
    const mobile = RESPONSIVE_CSS.slice(RESPONSIVE_CSS.indexOf('@media (max-width: 768px)'))
    const selector = mobile.match(/([^{}]*)\{[^}]*position: absolute !important/)?.[1] ?? ''
    const drawer = mobile.match(/\[data-dsh-frame\] \[data-pane="sidebar"\][^{]*\{([^}]*)\}/)?.[1] ?? ''

    // When a skin ships its sidebar rule under the loader's scope, then the
    // drawer must outrank BOTH shapes it can take: 0-2-2 (a plain skin
    // declaration, beaten by !important) and 0-2-3 (an important skin
    // declaration, beaten only on specificity)
    expect(drawer).toContain('position: absolute !important')

    // The :is() is what supplies the third attribute selector, lifting the
    // rule to 0-3-0 so an equally-important 0-2-3 skin rule loses. It is
    // redundant as a matcher by construction: it repeats an attribute the
    // rule already requires. Count across the whole selector - the frame
    // attribute is a separate ancestor compound, not part of the subject.
    expect(selector).toContain(':is(')
    const attributeCount = (selector.match(/\[[^\]]+\]/g) ?? []).length
    expect(attributeCount).toBeGreaterThanOrEqual(3)

    // The stable substring every other assertion and the shell rely on stays.
    expect(RESPONSIVE_CSS).toContain('[data-dsh-frame] [data-pane="sidebar"]')

    // The remaining drawer declarations stay as they are
    expect(drawer).toContain('inset-block: 0')
    expect(drawer).toContain('z-index: 1100')
    expect(drawer).toContain('width: min(88vw, 320px) !important')
  })
})
