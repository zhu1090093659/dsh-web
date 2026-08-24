/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, RESPONSIVE_CSS } from '../src/client/index.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.head.querySelectorAll('style[data-dsh-compat="responsive"]').forEach(style => style.remove())
})

describe('aggregate responsive compat contract', () => {
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
})
