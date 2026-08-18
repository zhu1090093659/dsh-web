// @vitest-environment jsdom
/**
 * Maid Atelier skin apply spec — the template contract: the body
 * attribute the stylesheet is scoped on is set on apply and retracted on
 * dispose, and every injected chrome element (marked data-skin-chrome) is
 * removed. Extend with assertions specific to your surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { apply } from '../src/client/index.ts'

const CSS = readFileSync(resolve(process.cwd(), 'src/client/maid-atelier.module.css'), 'utf8')

let fiber: Fiber | undefined

async function mount(): Promise<Fiber> {
  const f = new Context().plugin({ apply })
  await f.await()
  return f
}

/** Let jsdom deliver the current MutationObserver checkpoint. */
async function flushMutations(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(async () => {
  await fiber?.dispose()
  fiber = undefined
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.title = ''
})

describe('Maid Atelier skin apply', () => {
  it('declares the current client manifest without runtime peers', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))
    expect(manifest.dsh.client).toEqual({ inject: [], platform: 'web' })
    expect(manifest.dsh).not.toHaveProperty('bundle')
    expect(manifest.license).toBe('CC-BY-NC-SA-4.0')
    expect(manifest).not.toHaveProperty('dshClient')
    expect(manifest.peerDependencies).toEqual({})
  })

  it('sets the body attribute and retracts it on dispose', async () => {
    fiber = await mount()
    expect(document.body.hasAttribute('data-dsh-maid-atelier')).toBe(true)
    await fiber.dispose()
    expect(document.body.hasAttribute('data-dsh-maid-atelier')).toBe(false)
  })

  it('registers cleanup before a later CSSOM initialization failure', () => {
    let dispose: (() => void) | undefined
    const ctx = {
      effect(factory: () => () => void): void {
        dispose = factory()
      },
    } as unknown as Context
    const insertRule = vi.spyOn(CSSStyleSheet.prototype, 'insertRule')
      .mockImplementationOnce(() => {
        throw new Error('fixture CSSOM failure')
      })

    expect(() => apply(ctx)).toThrow('fixture CSSOM failure')
    expect(dispose).toBeTypeOf('function')
    dispose?.()

    expect(document.body.hasAttribute('data-dsh-maid-atelier')).toBe(false)
    expect(document.querySelector("[data-skin-owner='maid-atelier']")).toBeNull()
    insertRule.mockRestore()
  })

  it('colors the installed Web-app system controls navy and restores the presenter color', async () => {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    meta.content = '#ffffff'
    document.head.append(meta)

    fiber = await mount()
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(meta.content).toBe('#0b193f')

    meta.content = '#dce6f5'
    await flushMutations()
    expect(meta.content).toBe('#0b193f')

    await fiber.dispose()
    expect(meta.content).toBe('#ffffff')
    meta.remove()
  })

  it('injects chrome and retracts every element on dispose', async () => {
    fiber = await mount()
    expect(document.body.querySelectorAll('[data-skin-chrome]').length).toBeGreaterThan(0)
    expect(document.body.querySelectorAll('[data-skin-trim-layer]')).toHaveLength(2)
    await fiber.dispose()
    expect(document.body.querySelectorAll('[data-skin-chrome]').length).toBe(0)
    expect(document.body.querySelectorAll('[data-skin-trim-layer]')).toHaveLength(0)
  })

  it('does not remove a foreign node that happens to reuse the owner marker', async () => {
    fiber = await mount()
    const foreign = document.createElement('div')
    foreign.dataset.skinOwner = 'maid-atelier'
    document.body.append(foreign)

    await fiber.dispose()
    expect(foreign.isConnected).toBe(true)
    foreign.remove()
  })

  it('keeps the mascot independent and leaves the native vector brand intact', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div>
          <div class="fixture_logoRow">
            <button class="fixture_brand"><svg aria-hidden="true"></svg></button>
          </div>
        </div>
      </div>
    `
    fiber = await mount()

    const mascot = document.querySelector<HTMLImageElement>("[data-skin-chrome='sidebar-mascot']")
    expect(mascot?.src).toContain('data:image/webp;base64,')
    const corners = document.querySelector("[data-skin-chrome='sidebar-corners']")
    expect(corners?.querySelectorAll('[data-skin-corner]')).toHaveLength(4)
    const brand = document.querySelector("button[class*='brand'] > svg")
    expect(brand).not.toBeNull()
    expect(document.querySelector("[data-skin-chrome='brand-lockup']")).toBeNull()

    await fiber.dispose()
    expect(document.querySelector("[data-skin-owner='maid-atelier']")).toBeNull()
  })

  it('decorates a sidebar mounted after the skin', async () => {
    fiber = await mount()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-pane="sidebar"><div><button class="fixture_brand"><svg></svg></button></div></div>',
    )
    await flushMutations()

    expect(document.querySelector("[data-skin-chrome='sidebar-mascot']")).not.toBeNull()
    expect(document.querySelector("button[class*='brand'] > svg")).not.toBeNull()
    expect(document.querySelector("[data-skin-chrome='brand-lockup']")).toBeNull()
  })

  it('does not rescan the sidebar when ordinary conversation content changes', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar"><div></div></div>
      <main data-phase="active"></main>
    `
    fiber = await mount()
    const sidebar = document.querySelector<HTMLElement>("[data-pane='sidebar']")!
    const querySelectorAll = vi.spyOn(sidebar, 'querySelectorAll')
    const querySelector = vi.spyOn(document, 'querySelector')

    document.querySelector('main')!.append(document.createElement('article'))
    await flushMutations()

    expect(querySelectorAll).not.toHaveBeenCalled()
    expect(querySelector).not.toHaveBeenCalledWith(
      "[data-slot='sidebar.settings'] > :is(button, [role='button'])[aria-expanded='true']",
    )
  })

  it('projects relational page state onto skin-owned attributes', async () => {
    document.body.innerHTML = `
      <header><div role="tablist"></div></header>
      <main data-phase="active"><div data-chat-flow></div></main>
      <div data-dsh-better-sidebar></div>
      <div data-cordis-panel></div>
      <div data-slot="sidebar.settings"><button aria-expanded="true"></button></div>
    `
    fiber = await mount()

    expect(document.body.hasAttribute('data-maid-chat-active')).toBe(true)
    expect(document.body.hasAttribute('data-maid-conversation-active')).toBe(true)
    expect(document.body.hasAttribute('data-maid-workspace')).toBe(true)
    expect(document.body.hasAttribute('data-maid-better-sidebar-open')).toBe(true)
    expect(document.body.hasAttribute('data-maid-cordis-panel-open')).toBe(true)
    expect(document.body.hasAttribute('data-maid-settings-open')).toBe(true)

    document.querySelector('header')!.remove()
    document.querySelector('main')!.remove()
    document.querySelector('[data-cordis-panel]')!.remove()
    document.querySelector('[aria-expanded]')!.setAttribute('aria-expanded', 'false')
    document.body.setAttribute('data-dsh-sidebar-collapsed', '')
    await flushMutations()

    expect(document.body.hasAttribute('data-maid-chat-active')).toBe(false)
    expect(document.body.hasAttribute('data-maid-conversation-active')).toBe(false)
    expect(document.body.hasAttribute('data-maid-workspace')).toBe(false)
    expect(document.body.hasAttribute('data-maid-better-sidebar-open')).toBe(false)
    expect(document.body.hasAttribute('data-maid-cordis-panel-open')).toBe(false)
    expect(document.body.hasAttribute('data-maid-settings-open')).toBe(false)

    await fiber.dispose()
    document.body.removeAttribute('data-dsh-sidebar-collapsed')
  })

  it('restores pre-existing projected state attributes on dispose', async () => {
    document.body.setAttribute('data-maid-workspace', 'presenter')
    fiber = await mount()
    expect(document.body.hasAttribute('data-maid-workspace')).toBe(false)

    await fiber.dispose()
    expect(document.body.getAttribute('data-maid-workspace')).toBe('presenter')
    document.body.removeAttribute('data-maid-workspace')
  })

  it('ignores better-sidebar terminal row mutations', async () => {
    document.body.innerHTML = `
      <div data-dsh-better-sidebar><div class="xterm"><span data-terminal-row></span></div></div>
    `
    fiber = await mount()
    await flushMutations()
    const querySelector = vi.spyOn(document, 'querySelector')

    document.querySelector('[data-terminal-row]')!.textContent = 'x'.repeat(32)
    querySelector.mockClear()
    await flushMutations()

    expect(querySelector).not.toHaveBeenCalled()
  })

  it('uses the public desktop frame marker without a private window global', async () => {
    document.body.innerHTML = '<div class="fixture_frame" data-desktop></div>'
    fiber = await mount()

    const sheet = document.querySelector<HTMLStyleElement>(
      "style[data-skin-chrome='sidebar-width-rule']",
    )!.sheet!
    const variables = sheet.cssRules[0] as CSSStyleRule
    expect(variables.style.getPropertyValue('--maid-titlebar-height')).toBe('32px')
  })

  it('seats a sidebar frame copy beneath the open settings mask', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div>
          <div><div data-slot="sidebar.settings"><button aria-expanded="false">Settings</button></div></div>
        </div>
      </div>
    `
    fiber = await mount()
    const trigger = document.querySelector<HTMLButtonElement>("[data-slot='sidebar.settings'] > button")!
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'presentation')
    const mask = document.createElement('div')
    mask.className = 'fixture_mask'
    overlay.append(mask)
    document.body.append(overlay)
    trigger.setAttribute('aria-expanded', 'true')
    await flushMutations()

    const copy = document.querySelector<HTMLElement>('[data-maid-settings-backdrop-frame]')
    expect(copy?.parentElement).toBe(overlay)
    expect(copy?.nextElementSibling).toBe(mask)
    expect(copy?.querySelectorAll('[data-skin-corner]')).toHaveLength(4)

    trigger.setAttribute('aria-expanded', 'false')
    await flushMutations()
    expect(document.querySelector('[data-maid-settings-backdrop-frame]')).toBeNull()
  })

  it('anchors the public rc.6 settings slot to the real sidebar footer', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div>
          <div class="fixture_footArea fixture_header"></div>
          <div class="fixture_footer">
            <div data-slot="sidebar.footer.action"></div>
            <div><div data-slot="sidebar.settings" style="display: contents">
              <button><div data-slot="settings.trigger">设置</div></button>
            </div></div>
          </div>
        </div>
      </div>
    `
    fiber = await mount()

    expect(document.querySelector('.fixture_header')?.hasAttribute('data-maid-sidebar-footer')).toBe(false)
    expect(document.querySelector('.fixture_footer')?.hasAttribute('data-maid-sidebar-footer')).toBe(true)

    await fiber.dispose()
    expect(document.querySelector('[data-maid-sidebar-footer]')).toBeNull()
  })

  it('marks the active workspace group and its session tree, then retracts every hook', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div>
          <div role="tree">
            <div role="treeitem" aria-expanded="false"><span class="fixture_folder"></span></div>
            <div role="treeitem" aria-expanded="true"><span class="fixture_folder"></span></div>
            <div role="treeitem" aria-selected="true"><span class="fixture_title">Current</span></div>
            <div role="treeitem" aria-selected="false"><span class="fixture_title">Other</span></div>
          </div>
        </div>
      </div>
    `
    fiber = await mount()

    const workspace = document.querySelectorAll<HTMLElement>("[role='treeitem'][aria-expanded]")[1]!
    const group = workspace.parentElement!
    const sessions = group.querySelectorAll<HTMLElement>("[role='treeitem'][aria-selected]")
    expect(group.hasAttribute('data-maid-workspace-group')).toBe(true)
    expect(workspace.hasAttribute('data-maid-workspace-row')).toBe(true)
    expect(workspace.hasAttribute('data-maid-workspace-active')).toBe(true)
    expect([...sessions].every(session => session.hasAttribute('data-maid-session-row'))).toBe(true)
    expect(sessions[0]!.hasAttribute('data-maid-session-first')).toBe(true)
    expect(sessions[1]!.hasAttribute('data-maid-session-last')).toBe(true)

    sessions[0]!.setAttribute('aria-selected', 'false')
    await flushMutations()
    expect(workspace.hasAttribute('data-maid-workspace-active')).toBe(false)

    await fiber.dispose()
    expect(document.querySelector('[data-maid-workspace-group]')).toBeNull()
    expect(document.querySelector('[data-maid-workspace-row]')).toBeNull()
    expect(document.querySelector('[data-maid-session-row]')).toBeNull()
    expect(document.querySelector('[data-maid-session-first]')).toBeNull()
    expect(document.querySelector('[data-maid-session-last]')).toBeNull()
  })

  it('marks every Session row in the flat list without inventing a Workspace group', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div class="fixture_flatList" role="tree" aria-label="Sessions">
          <div role="treeitem" aria-selected="true"><span class="fixture_title">Current</span></div>
          <div role="treeitem" aria-selected="false"><span class="fixture_title">Other</span></div>
        </div>
      </div>
    `
    fiber = await mount()

    const sessions = document.querySelectorAll<HTMLElement>("[role='treeitem'][aria-selected]")
    expect([...sessions].every(session => session.hasAttribute('data-maid-session-row'))).toBe(true)
    expect([...sessions].every(session => session.hasAttribute('data-maid-session-flat'))).toBe(true)
    expect(document.querySelector('[data-maid-workspace-row]')).toBeNull()

    await fiber.dispose()
    expect(document.querySelector('[data-maid-session-flat]')).toBeNull()
  })

  it('pins the skin title and restores the original on dispose', async () => {
    document.title = 'original'
    fiber = await mount()
    expect(document.title).not.toBe('original')
    await fiber.dispose()
    expect(document.title).toBe('original')
  })

  it('installs an inlined background and restores prior body styles', async () => {
    document.body.style.setProperty('background-position', 'left bottom')
    fiber = await mount()
    expect(document.body.style.backgroundImage).toContain('data:image/webp;base64,')
    expect(document.body.style.backgroundImage).not.toContain('linear-gradient')
    expect(document.body.style.backgroundPosition).toBe('center top')
    expect(document.body.style.backgroundSize).toBe('cover')
    expect(document.body.style.backgroundAttachment).toBe('scroll')
    await fiber.dispose()
    expect(document.body.style.backgroundImage).toBe('')
    expect(document.body.style.backgroundPosition).toBe('left bottom')
  })

  it('keeps both original-resolution characters independent from the palace backdrop', async () => {
    fiber = await mount()
    const stage = document.querySelector("[data-skin-chrome='character-stage']")
    const characters = stage?.querySelectorAll<HTMLImageElement>('[data-maid-character]')
    expect(characters).toHaveLength(2)
    expect(characters?.[0]?.dataset.maidCharacter).toBe('left')
    expect(characters?.[1]?.dataset.maidCharacter).toBe('right')
    expect([...characters ?? []].every(character => character.src.startsWith('data:image/webp;base64,'))).toBe(true)
    await fiber.dispose()
    expect(document.querySelector("[data-skin-chrome='character-stage']")).toBeNull()
  }, 10_000)

  it('follows live viewport resizing without transition lag and restores the marker', async () => {
    fiber = await mount()
    const resizeRule = CSS.match(
      /\[data-maid-viewport-resizing\]\s*\[data-maid-character\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(resizeRule).toContain('transition: none')
    expect(resizeRule).toContain('filter: none')

    vi.useFakeTimers()
    try {
      window.dispatchEvent(new Event('resize'))
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(true)
      vi.advanceTimersByTime(120)
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(false)

      window.dispatchEvent(new Event('resize'))
      await fiber.dispose()
      fiber = undefined
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(false)
      window.dispatchEvent(new Event('resize'))
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses a CPU-safe character path without accelerated WebGL and restores overrides', async () => {
    fiber = await mount()
    const lowPowerRule = CSS.match(
      /\[data-maid-low-power\]\s*\[data-maid-character\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(document.body.hasAttribute('data-maid-low-power')).toBe(true)
    expect(lowPowerRule).toContain('filter: none')
    expect(lowPowerRule).toContain('transition: opacity 180ms ease')

    await fiber.dispose()
    fiber = undefined
    expect(document.body.hasAttribute('data-maid-low-power')).toBe(false)

    document.body.setAttribute('data-maid-low-power', 'manual')
    fiber = await mount()
    await fiber.dispose()
    fiber = undefined
    expect(document.body.getAttribute('data-maid-low-power')).toBe('manual')
    document.body.removeAttribute('data-maid-low-power')
  })

  it('keeps resize and low-power markers owned across overlapping activations', async () => {
    const originalBodyStyle = document.body.getAttribute('style')
    const first = await mount()
    const second = await mount()
    vi.useFakeTimers()
    try {
      window.dispatchEvent(new Event('resize'))
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(true)
      expect(document.body.hasAttribute('data-maid-low-power')).toBe(true)

      await first.dispose()
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(true)
      expect(document.body.hasAttribute('data-maid-low-power')).toBe(true)

      vi.advanceTimersByTime(120)
      expect(document.body.hasAttribute('data-maid-viewport-resizing')).toBe(false)
      expect(document.body.hasAttribute('data-maid-low-power')).toBe(true)

      await second.dispose()
      expect(document.body.hasAttribute('data-maid-low-power')).toBe(false)
    } finally {
      await first.dispose()
      await second.dispose()
      if (originalBodyStyle === null) document.body.removeAttribute('style')
      else document.body.setAttribute('style', originalBodyStyle)
      vi.useRealTimers()
    }
  })

  it('keeps full character effects when accelerated WebGL is available', async () => {
    vi.stubGlobal('WebGLRenderingContext', class WebGLRenderingContext {})
    const loseContext = vi.fn()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        getExtension: () => ({ loseContext }),
      } as unknown as WebGL2RenderingContext)
    try {
      fiber = await mount()
      expect(document.body.hasAttribute('data-maid-low-power')).toBe(false)
      expect(getContext).toHaveBeenCalledWith('webgl2', {
        failIfMajorPerformanceCaveat: true,
      })
      expect(loseContext).toHaveBeenCalledOnce()
    } finally {
      getContext.mockRestore()
    }
  })

  it('installs and restores the raster control plates', async () => {
    document.body.style.setProperty('--maid-new-session-art', 'legacy')
    document.body.style.setProperty('--maid-workspace-ribbon-art', 'legacy-ribbon')
    fiber = await mount()
    expect(document.body.style.getPropertyValue('--maid-top-trim-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-bottom-trim-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-bottom-crest-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-bow-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-new-session-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-sidebar-swag-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-sidebar-corner-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-composer-frame-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-settings-frame-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-workspace-crest-art')).toContain('data:image/webp;base64,')
    expect(document.body.style.getPropertyValue('--maid-workspace-ribbon-art')).toContain('data:image/webp;base64,')
    expect(document.querySelector("[data-skin-ornament='crest']")).toBeNull()
    await fiber.dispose()
    expect(document.body.style.getPropertyValue('--maid-top-trim-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-bottom-trim-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-bottom-crest-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-bow-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-new-session-art')).toBe('legacy')
    expect(document.body.style.getPropertyValue('--maid-sidebar-swag-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-sidebar-corner-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-composer-frame-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-settings-frame-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-workspace-crest-art')).toBe('')
    expect(document.body.style.getPropertyValue('--maid-workspace-ribbon-art')).toBe('legacy-ribbon')
  })

  it('overlaps the composer backing plate beneath the hollow raster frame', () => {
    const backingRule = [...CSS.matchAll(/\[data-composer-card\]::after\s*\{([^}]*)\}/g)]
      .map(match => match[1] ?? '')
      .find(rule => rule.includes("content: ''")) ?? ''
    expect(backingRule).toContain("content: ''")
    expect(backingRule).toContain('inset: 0 -0.52% -2%')
    expect(backingRule).toContain('background: inherit')
    expect(backingRule).toContain('pointer-events: none')
  })

  it('masks transcript content without duplicating character art', () => {
    const seatRule = CSS.match(
      /\[data-phase='active'\]\s*\[data-composer-seat\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(seatRule).toContain('--dsw-alias-bg-base: transparent')
    expect(seatRule).toContain('background: none')
    expect(CSS).not.toContain("[data-skin-chrome='character-stage']::before")
    expect(CSS).toMatch(/\[data-maid-character\]\s*\{[^}]*z-index: 1/s)
    expect(CSS).toMatch(/@media \(max-width: 700px\)[\s\S]*?\[data-maid-character='left'\]\s*\{[^}]*translate: var\(--maid-sidebar-width\) 0/s)
    expect(CSS).toMatch(/@media \(max-width: 700px\)[\s\S]*?\[data-maid-character='right'\]\s*\{[^}]*translate: 0/s)
    expect(CSS).not.toContain('left: -82px')
    expect(CSS).not.toContain('right: -82px')
    expect(CSS).not.toContain('--maid-character-left-art')
    expect(CSS).not.toContain('--maid-character-right-art')
    expect(CSS).not.toContain('maidAtelierComposerBackdropDock')
    expect(CSS).not.toContain('[data-composer-seat]::before')
  })

  it('recolors the native vector wordmark without replacing it with raster art', () => {
    expect(CSS).toMatch(/button\[class\*='brand'\]\s*\{[^}]*color: #f3e3c0/s)
    expect(CSS).toMatch(/button\[class\*='brand'\]\s*\{[^}]*--dsw-alias-label-primary-inverted: #10204d/s)
    expect(CSS).toMatch(/button\[class\*='brand'\] > svg\s*\{[^}]*width: min\(182px, 100%\)/s)
    expect(CSS).toMatch(/button\[class\*='brand'\] > svg > rect\s*\{[^}]*fill: #d7b46a/s)
    expect(CSS).not.toContain("[data-skin-chrome='brand-lockup']")
  })

  it('keeps question and todo copy paired with readable skin surfaces', () => {
    expect(CSS).toMatch(/\[data-question-key\]\s*\{[^}]*--dsw-alias-label-primary: #142044/s)
    expect(CSS).toMatch(/\[data-question-key\] > section\s*\{[^}]*rgba\(255, 254, 250, 0\.97\)/s)
    expect(CSS).toMatch(/\[data-question-key\] \[aria-checked='true'\]\s*\{[^}]*background: linear-gradient/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[data-question-key\]\s*\{[^}]*--dsw-alias-label-primary: #edf1fa/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[data-question-key\] > section\s*\{[^}]*rgba\(19, 35, 76, 0\.98\)/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[data-question-key\] \[aria-checked='true'\]\s*\{[^}]*rgba\(74, 99, 163, 0\.5\)/s)
    expect(CSS).toMatch(/\[data-testid='todo-panel'\]\s*\{[^}]*--dsw-alias-label-primary: #172347/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[data-testid='todo-panel'\]\s*\{[^}]*--dsw-alias-label-primary: #f4ead3/s)
  })

  it('aligns docked composer controls and paints context usage gold over blue', () => {
    expect(CSS).toMatch(/\[data-phase='active'\] \[data-composer-card\] > \[class\*='row'\]\s*\{[^}]*padding: 2px 14px 10px/s)
    expect(CSS).toMatch(/button\[class\*='add'\][\s\S]*?width: 38px[\s\S]*?border-radius: 50%/)
    expect(CSS).toMatch(/\[class\*='modes'\] button\[class\*='trigger'\]:has\(\[class\*='triggerIcon'\]\)/)
    expect(CSS).toMatch(/button\[aria-haspopup='dialog'\] \[class\*='track'\]\s*\{[^}]*stroke: #4d6bab/s)
    expect(CSS).toMatch(/button\[aria-haspopup='dialog'\] \[class\*='fill'\]\s*\{[^}]*stroke: #d3a957/s)
    expect(CSS).toMatch(/\[role='dialog'\] \[class\*='header'\][\s\S]*?color: #172347/)
    expect(CSS).toMatch(/\[class\*='triggerEffort'\]\s*\{[^}]*color: #a77c36/s)
  })

  it('nine-slices one composer frame across hero and workspace heights', () => {
    const frameRule = CSS.match(/\[data-composer-card\]::before\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(frameRule).toContain('inset: -20px -14px -18px')
    expect(frameRule).toContain('z-index: 1')
    expect(frameRule).toContain('border-width: 72px 54px 52px')
    expect(frameRule).toContain('border-image-source: var(--maid-composer-frame-art)')
    expect(frameRule).toContain('border-image-slice: 170 120 115 120')
    expect(frameRule).toContain('border-image-width: 72px 54px 52px 54px')
    expect(frameRule).toContain('border-image-repeat: stretch')
    expect(frameRule).not.toContain('100% 100%')
  })

  it('three-slices the new-session plate without stretching its ornamental ends', () => {
    const plateRule = CSS.match(/button\[class\*='newSession'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const hoverRule = CSS.match(
      /button\[class\*='newSession'\]:hover\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const collapsedRule = [...CSS.matchAll(/button\[class\*='newSession'\]\s*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .find((rule) => rule.includes('border-image: none')) ?? ''
    const narrowRule = [...CSS.matchAll(/button\[class\*='newSession'\]\s*\{([^}]*)\}/g)]
      .map((match) => match[1] ?? '')
      .find((rule) => rule.includes('border-image-width: 0 32px')) ?? ''
    expect(plateRule).toContain('border-image-source: var(--maid-new-session-art)')
    expect(plateRule).toContain('border-image-slice: 0 210 0 210 fill')
    expect(plateRule).toContain('border-image-width: 0 40px')
    expect(plateRule).toContain('border-image-repeat: stretch')
    expect(plateRule).not.toContain('100% 100%')
    expect(hoverRule).not.toContain('background:')
    expect(narrowRule).toContain('padding-inline: 0')
    expect(narrowRule).toContain('border-width: 0 32px')
    expect(collapsedRule).toContain('border-image: none')
  })

  it('uses dedicated circular controls on the collapsed sidebar rail', () => {
    const toggleRule = CSS.match(
      /\[class\*='logoRow'\] \[class\*='toggle'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const collapsedSessionIconRule = [...CSS.matchAll(
      /button\[class\*='newSession'\] svg\s*\{([^}]*)\}/g,
    )].map(match => match[1] ?? '').find(rule => rule.includes('#efd7a1')) ?? ''
    const collapsedFootRule = [...CSS.matchAll(
      /\[data-slot='sidebar\.settings'\][\s\S]*?> :is\(button, \[role='button'\]\)\s*\{([^}]*)\}/g,
    )].map(match => match[1] ?? '').find(rule => rule.includes('border-image: none')) ?? ''
    const collapsedSessionRule = [...CSS.matchAll(/button\[class\*='newSession'\]\s*\{([^}]*)\}/g)]
      .map(match => match[1] ?? '').find(rule => rule.includes('border-image: none')) ?? ''
    const collapsedFootAreaRule = [...CSS.matchAll(/\[data-maid-sidebar-footer\]\s*\{([^}]*)\}/g)]
      .map(match => match[1] ?? '').find(rule => rule.includes('display: flex')) ?? ''
    const sharedRailRule = CSS.match(
      /:is\(\s*\[class\*='logoRow'\] \[class\*='toggle'\],[\s\S]*?\[data-slot='sidebar\.settings'\] > :is\(button, \[role='button'\]\)\s*\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sharedRailHoverRule = CSS.match(
      /:is\(\s*\[class\*='logoRow'\] \[class\*='toggle'\],[\s\S]*?\[data-slot='sidebar\.settings'\] > :is\(button, \[role='button'\]\)\s*\):is\(:hover, :focus-visible\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(toggleRule).toContain('border-radius: 50%')
    expect(sharedRailRule).toContain('width: var(--maid-rail-control-size)')
    expect(sharedRailRule).toContain('height: var(--maid-rail-control-size)')
    expect(sharedRailRule).toContain('flex: 0 0 var(--maid-rail-control-size)')
    expect(sharedRailRule).toContain('border-image: none')
    expect(sharedRailRule).toContain('overflow: visible')
    expect(sharedRailHoverRule).toContain('transform: none')
    expect(collapsedSessionIconRule).toContain('color: #efd7a1')
    expect(collapsedSessionRule).toContain('align-self: center')
    expect(collapsedSessionRule).toContain('margin: 6px 0 10px')
    expect(collapsedFootAreaRule).toContain('justify-content: center')
    expect(collapsedFootRule).toContain('width: 38px')
    expect(collapsedFootRule).toContain('margin: 0')
    expect(collapsedFootRule).toContain('border-radius: 50%')
    expect(CSS).toMatch(/\[data-maid-sidebar-size='rail'\] \[class\*='sectionHeader'\]\s*\{[^}]*justify-content: center/)
    expect(CSS).toMatch(/\[class\*='search'\]:has\(> \[class\*='searchButton'\]\)\s*\{[^}]*justify-content: center/)
    expect(CSS).toMatch(/\[class\*='regionArea'\]\)\s*\{[^}]*overflow: visible/)
  })

  it('keeps settings content independent from collapsed sidebar icon chrome', () => {
    const railIconSelectors = [...CSS.matchAll(
      /body\[data-dsh-maid-atelier\]\[data-maid-sidebar-size='rail'\][^{]+:is\(\[class\*='iconButton'\], \[class\*='searchButton'\]\)[^{]+\{/g,
    )].map(match => match[0] ?? '')
    const centeredSettingsContentRule = CSS.match(
      /:not\(\[data-maid-sidebar-size='rail'\]\)[\s\S]*?\[data-slot='sidebar\.settings'\][\s\S]*?> :is\(button, \[role='button'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const centeredSettingsLabelRule = CSS.match(
      /\[data-slot='settings\.trigger'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(railIconSelectors.length).toBeGreaterThan(0)
    expect(railIconSelectors.every(selector => selector.includes(":not([role='dialog'] *)"))).toBe(true)
    // The icon and label travel as one pair: a fixed gap binds them (like the
    // New Session button) and the pair stays centered, so resizing the sidebar
    // never stretches the space between the gear and the text.
    expect(centeredSettingsContentRule).toContain('position: relative')
    expect(centeredSettingsContentRule).toContain('flex: 1 1 auto')
    expect(centeredSettingsContentRule).toContain('justify-content: center')
    expect(centeredSettingsContentRule).toContain('gap: 8px')
    expect(centeredSettingsLabelRule).not.toContain('position: absolute')
    expect(centeredSettingsLabelRule).not.toContain('left: 50%')
    expect(centeredSettingsLabelRule).toContain('line-height: 1')
  })

  it('never hides title-bar controls by DOM position', () => {
    expect(CSS).not.toMatch(
      /\[class\*='titlebar'\] > \[class\*='button'\]:first-of-type\s*\{[^}]*display:\s*none/s,
    )
  })

  it('places a text label in the frameless title bar', async () => {
    fiber = await mount()
    document.body.insertAdjacentHTML('beforeend', '<div class="fixture_titlebar"></div>')
    await flushMutations()
    const titlebar = document.querySelector<HTMLElement>("[class*='titlebar']")
    const brand = titlebar?.querySelector<HTMLElement>("[data-skin-chrome='titlebar-brand']")
    expect(brand).not.toBeNull()
    expect(brand?.textContent).toBe('DeepSeek Harness')
    expect(brand?.querySelector('svg')).toBeNull()
    await fiber.dispose()
    expect(document.querySelector("[data-skin-chrome='titlebar-brand']")).toBeNull()
  })

  it('styles the title-bar label centered on the window, always visible', () => {
    expect(CSS).toMatch(/\[data-skin-chrome='titlebar-brand'\]\s*\{[^}]*left: 50%/s)
    expect(CSS).toMatch(/\[data-skin-chrome='titlebar-brand'\]\s*\{[^}]*transform: translate\(-50%, -50%\)/s)
    expect(CSS).toMatch(/\[data-skin-chrome='titlebar-brand'\]\s*\{[^}]*pointer-events: none/s)
    expect(CSS).toMatch(/\[data-skin-chrome='titlebar-brand'\]\s*\{[^}]*line-height: 18px/s)
    // The wordmark must not hide with the rail: it is decorative and centered.
    expect(CSS).not.toMatch(/\[data-maid-sidebar-size='rail'\]\s*\[data-skin-chrome='titlebar-brand'\]\s*\{[^}]*display: none/s)
  })

  it('re-asserts the frameless frame rows through CSSOM env(), bypassing the module pipeline', async () => {
    fiber = await mount()
    const sheet = document.querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")
    const cssText = [...(sheet?.sheet?.cssRules ?? [])].map(rule => rule.cssText).join(' ')
    // jsdom's CSS parser drops the env() declaration body (the real browser
    // keeps `grid-template-rows: env(titlebar-area-height, 40px) 1fr`), so
    // assert the repaired selectors and the handle boundary instead.
    expect(cssText).toContain('[data-wco]')
    expect(cssText).toContain('[data-desktop]')
    expect(cssText).toContain('handle"]')
    expect(cssText).toContain('top: var(--maid-titlebar-height, 0px)')
  })

  it('starts the top curtain below the frameless title-bar row', () => {
    // The offset height must come from the runtime variable, never from env():
    // the CSS-modules pipeline rewrites env() identifiers, so a hardcoded
    // env() rule would silently fall back to 0 and paint over the title bar.
    const trimOffsetRule = CSS.match(
      /\[data-skin-chrome='top-trim'\]\s*\{\s*top: var\(--maid-titlebar-height, 0px\)/s,
    )?.[1] ?? ''
    expect(trimOffsetRule).not.toBeNull()
    expect(CSS).not.toMatch(/env\(titlebar-area-height/)
  })

  it('falls back to zero title-bar height when no sidebar column is laid out', async () => {
    fiber = await mount()
    const sheet = document.querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")
    expect(sheet?.sheet?.cssRules[0]?.cssText ?? '').toMatch(/--maid-titlebar-height\s*:\s*0px/)
    await fiber.dispose()
    expect(document.querySelector("[data-skin-chrome='sidebar-width-rule']")).toBeNull()
  })

  it('mirrors the sidebar column top as the curtain offset when a column exists', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div class="fixture_logoRow"><button class="fixture_brand"><svg></svg></button></div>
      </div>
    `
    const column = document.querySelector<HTMLElement>("[data-pane='sidebar']")!
    // jsdom has no layout; pretend the column sits 40px below the viewport top.
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({
      top: 40, left: 0, right: 280, bottom: 760, width: 280, height: 720,
      x: 0, y: 40, toJSON: () => ({}),
    })
    fiber = await mount()
    const sheet = document.querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")
    expect(sheet?.sheet?.cssRules[0]?.cssText ?? '').toContain('--maid-titlebar-height: 40px')
    await fiber.dispose()
  })

  it('dresses the frameless title bar with the sidebar navy gradient', () => {
    const titlebarRule = CSS.match(/\[class\*='titlebar'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(titlebarRule).toContain('linear-gradient')
    // Vertical gradient, deepest at the bottom where it meets the sidebar and
    // the trim band, lightening toward the top edge.
    expect(titlebarRule).toContain('to top')
    expect(titlebarRule).toContain('rgba(197, 164, 104, 0.42)')
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[class\*='titlebar'\]\s*\{[^}]*to top/s)
    expect(CSS).toMatch(/\[class\*='titlebar'\] \[class\*='button'\]\s*\{[^}]*color: #d9bd83/s)
  })

  it('keeps delayed sidebar tooltips out of the rail flex layout', () => {
    const sidebarLayerSelector = CSS.match(
      /body\[data-dsh-maid-atelier\] :is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\) > div > :not\(([\s\S]*?)\)\s*\{/,
    )?.[1] ?? ''
    expect(sidebarLayerSelector).toContain("[role='tooltip']")
  })

  it('paints the sidebar double rule without shrinking the collapsed rail', () => {
    const sidebarRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(sidebarRule).toContain('border-right: 0')
    expect(sidebarRule).toContain('inset -1px 0 rgba(255, 245, 215, 0.82)')
    expect(sidebarRule).toContain('inset -3px 0 rgba(226, 207, 166, 0.72)')
  })

  it('restores the large hero text floor without fixing the workspace height', () => {
    const mirrorRule = CSS.match(/\[data-input-mirror\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const heroMirrorRule = CSS.match(
      /\[data-phase='hero'\] \[data-input-mirror\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(mirrorRule).toContain('min-height: 0')
    expect(heroMirrorRule).toContain('min-height: clamp(72px, 9vh, 118px)')
    expect(mirrorRule).toContain('transition: min-height 520ms')
    expect(CSS).not.toMatch(/\[data-phase='hero'\] \[data-composer-card\][^{]*\{[^}]*min-height/s)
  })

  it('scales and translucently backs the landing composer through official width hooks', () => {
    const heroRule = CSS.match(/\[data-phase='hero'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const heroCardRule = CSS.match(
      /\[data-phase='hero'\] \[data-composer-card\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const heroBackingRule = CSS.match(
      /\[data-phase='hero'\]\s*\[data-composer-card\]::after\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(heroRule).toContain('--dsh-chat-content-width: clamp(560px, 41vw, 740px)')
    expect(heroRule).toContain('--dsh-composer-card-max-width')
    expect(heroCardRule).toContain('rgba(255, 254, 250, 0.94)')
    expect(heroCardRule).toContain('backdrop-filter: blur(8px)')
    expect(heroBackingRule).toContain('rgba(248, 250, 255, 0.2)')
  })

  it('keeps composer placeholder text readable in both themes', () => {
    expect(CSS).toMatch(/textarea::placeholder\s*\{[^}]*color: #4d5d7f[^}]*opacity: 1/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\] \[data-composer-card\] textarea::placeholder\s*\{[^}]*color: #d5dff3[^}]*opacity: 1/s)
  })

  it('keeps hero workspace, permission, and model controls in the official composer flow', () => {
    const permissionRule = CSS.match(
      /\[class\*='modes'\] button\[class\*='trigger'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const modelRule = CSS.match(
      /\[class\*='trailing'\] button\[class\*='trigger'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(CSS).not.toMatch(
      /\[data-phase='hero'\]\s*:has\(> \[data-composer-card\]\)\s*\{[^}]*transform/s,
    )
    expect(permissionRule).toContain('justify-content: center')
    expect(permissionRule).toContain('gap: 0')
    expect(modelRule).toContain('width: auto')
    expect(modelRule).toContain('max-width: 220px')
    expect(modelRule).toContain('padding: 0 4px 0 8px')
    expect(CSS).not.toMatch(
      /\[class\*='trailing'\][\s\S]*?:is\(\[class\*='triggerLabel'\], \[class\*='triggerEffort'\]\)\s*\{[^}]*display: none/s,
    )
  })

  it('rebuilds the hero logo surround, caption rule, and embedded circular controls', () => {
    const headlineRule = CSS.match(
      /\[class\*='headline'\]:has\(> \[class\*='fish'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const medallionRule = CSS.match(
      /\[class\*='headline'\]:has\(> \[class\*='fish'\]\) > \[class\*='fish'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const captionRule = CSS.match(
      /\[class\*='headline'\]:has\(> \[class\*='fish'\]\)::after\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const addRule = CSS.match(
      /\[data-composer-card\] button\[class\*='add'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sendRule = CSS.match(
      /\[data-composer-card\] button\[class\*='primary'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const titleRule = CSS.match(
      /\[data-phase='hero'\] \[class\*='headlineText'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const previewRule = CSS.match(
      /\[data-phase='hero'\] \[class\*='previewBadge'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(headlineRule).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)')
    expect(titleRule).toContain('grid-column: 2')
    expect(previewRule).toContain('grid-column: 3')
    expect(previewRule).toContain('justify-self: start')
    expect(medallionRule).toContain('width: 70px')
    expect(medallionRule).toContain('outline: 1px solid')
    expect(captionRule).toContain('linear-gradient(45deg')
    expect(addRule).toContain('width: 42px')
    expect(addRule).toContain('border-radius: 50%')
    expect(sendRule).toContain('width: 44px')
    expect(sendRule).toContain('linear-gradient(145deg, #6079b5, #294587)')
  })

  it('keeps the dark hero title and preview badge legible over the night palace', () => {
    const titleRule = CSS.match(
      /body\[data-dsh-maid-atelier\]\[data-ds-dark-theme\]\s*\[data-phase='hero'\] \[class\*='headlineText'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const badgeRule = CSS.match(
      /body\[data-dsh-maid-atelier\]\[data-ds-dark-theme\]\s*\[data-phase='hero'\] \[class\*='previewBadge'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(titleRule).toContain('color: #fffaf0')
    expect(titleRule).toContain('-webkit-text-stroke: 0.35px')
    expect(titleRule).toContain('0 3px 7px rgba(0, 0, 0, 0.86)')
    expect(badgeRule).toContain('color: #f0dfba')
    expect(badgeRule).toContain('rgba(7, 18, 52, 0.58)')
  })

  it('moves character art only for active Chat and preserves inspection-page composition', () => {
    const stageRule = CSS.match(
      /\[data-skin-chrome='character-stage'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const chatLeftRule = CSS.match(
      /\[data-maid-chat-active\]\s*\[data-maid-character='left'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const chatRightRule = CSS.match(
      /\[data-maid-chat-active\]\s*\[data-maid-character='right'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sharedRule = CSS.match(
      /\[data-maid-character\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const baseLeftRule = CSS.match(
      /\[data-maid-character='left'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const baseRightRule = CSS.match(
      /\[data-maid-character='right'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(stageRule).toContain('position: fixed')
    expect(stageRule).toContain('contain: strict')
    expect(sharedRule).toContain('translate 620ms')
    expect(sharedRule).not.toContain('left 620ms')
    expect(sharedRule).not.toContain('right 620ms')
    expect(sharedRule).not.toContain('filter 420ms')
    expect(baseLeftRule).toContain('left: 0')
    expect(baseLeftRule).toContain('translate: calc(var(--maid-sidebar-width) + clamp(')
    expect(baseRightRule).toContain('right: 0')
    expect(baseRightRule).toContain('translate: clamp(-8px, -0.2vw, 0px) 0')
    expect(chatLeftRule).toContain('translate: calc(var(--maid-sidebar-width) + clamp(')
    expect(chatLeftRule).toContain('height: clamp(420px, 64vh, 760px)')
    expect(chatRightRule).toContain('translate: clamp(-8px, -0.5vw, 0px) 0')
    expect(CSS).not.toMatch(/\[data-maid-character='(?:left|right)'\]\s*\{[^}]*(?:left|right):\s*-/s)
    expect(CSS).not.toMatch(/\[data-maid-conversation-active\]\s*\[data-maid-character/s)
  })

  it('recovers the rc.6 rail search after its stale click collapses the wide field', async () => {
    document.body.innerHTML = `
      <div data-pane="sidebar">
        <div class="fixture_search">
          <button class="fixture_searchButton" type="button">search</button>
        </div>
      </div>
    `
    fiber = await mount()
    document.querySelector<HTMLButtonElement>('.fixture_searchButton')!.click()

    const sidebar = document.querySelector<HTMLElement>("[data-pane='sidebar']")!
    sidebar.innerHTML = `
      <div class="fixture_search">
        <input class="fixture_searchInput" />
      </div>
    `
    const searchRoot = sidebar.querySelector<HTMLElement>('.fixture_search')!
    const input = sidebar.querySelector<HTMLInputElement>('.fixture_searchInput')!
    let reopened = 0
    searchRoot.addEventListener('click', () => { reopened += 1 })

    await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))

    expect(reopened).toBe(1)
    expect(document.activeElement).toBe(input)
  })

  it('themes Cordis footer actions and approval panels without displacing settings', () => {
    expect(CSS).toMatch(
      /:not\(\[data-maid-sidebar-size='rail'\]\)[\s\S]*?\[data-slot='sidebar\.settings'\][\s\S]*?> :is\(button, \[role='button'\]\)\s*\{[^}]*margin-inline: 0/s,
    )
    expect(CSS).toMatch(
      /\[data-maid-sidebar-footer\]\s*\{[^}]*flex: 0 0 auto[^}]*min-height: calc\(var\(--maid-sidebar-swag-height\) \+ 82px\)/s,
    )
    expect(CSS).toMatch(
      /\[data-maid-sidebar-size='rail'\][\s\S]*?\[data-maid-sidebar-footer\]:has\(\[data-cordis-badge\]\)\s*\{[^}]*flex-basis: 100px/s,
    )
    expect(CSS).toMatch(
      /\[data-maid-cordis-panel-open\][\s\S]*?> :has\(\[data-cordis-panel\]\)\s*\{[^}]*z-index: 40/s,
    )
    expect(CSS).toMatch(/\[data-cordis-badge\]\s*\{[^}]*border: 1px solid[^}]*linear-gradient/s)
    expect(CSS).toMatch(
      /\[data-cordis-panel\]\s*\{[^}]*left: calc\(var\(--maid-sidebar-width\) \+ 12px\)[^}]*--dsw-alias-bg-base: rgba\(230, 237, 250, 0\.96\)[^}]*backdrop-filter: blur\(16px\)/s,
    )
    expect(CSS).toMatch(/\[data-cordis-row\]\s*\{[^}]*rgba\(247, 249, 254, 0\.72\)/s)
    expect(CSS).toContain('[data-cordis-approve-plugin]')
    expect(CSS).toMatch(
      /\[data-ds-dark-theme\] \[data-cordis-panel\]\s*\{[^}]*--dsw-alias-bg-base: rgba\(10, 22, 54, 0\.96\)/s,
    )
  })

  it('isolates dsh-better-sidebar from transparent skin tokens', () => {
    expect(CSS).toMatch(
      /\[data-dsh-better-sidebar\]\s*\{[^}]*--dsw-specific-sidebar-fill: rgba\(230, 237, 250, 0\.96\)/s,
    )
    expect(CSS).toMatch(
      /\[data-ds-dark-theme\] \[data-dsh-better-sidebar\]\s*\{[^}]*--dsw-specific-sidebar-fill: rgba\(10, 22, 54, 0\.96\)/s,
    )
    expect(CSS).toMatch(
      /\[data-maid-better-sidebar-open\][\s\S]*?\[data-maid-character='right'\]\s*\{[^}]*translate: clamp\(-460px, -24vw, -320px\) 0/s,
    )
  })

  it('keeps root-level relational selectors out of the skin scope', () => {
    expect(CSS).not.toMatch(
      /body\[data-dsh-maid-atelier\](?:\[[^\]]+\]|:not\([^)]*\))*:has\(/,
    )
  })

  it('coordinates composer docking and rising with the curtain duration', () => {
    expect(CSS).toContain("data-maid-composer-motion='dock'")
    expect(CSS).toContain("data-maid-composer-motion='rise'")
    expect(CSS).toContain('animation: maidAtelierComposerDock 520ms')
    expect(CSS).toContain('animation: maidAtelierComposerRise 520ms')
    expect(CSS).toContain('@keyframes maidAtelierComposerDock')
    expect(CSS).toContain('@keyframes maidAtelierComposerRise')
    expect(CSS).toMatch(/\[data-maid-composer-motion\][^{]*\{[^}]*will-change: transform, opacity/s)
  })

  it('styles assistant Markdown blocks through the stable flow-kind hook', () => {
    const bubbleRule = CSS.match(
      /\[data-chat-flow-kind='assistant-step'\] > \* > \* > \* > div\[class\*='markdown'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(bubbleRule).toContain('max-width: min(680px, 96%)')
    expect(bubbleRule).toContain('padding: 14px 18px')
    expect(bubbleRule).toContain('border-radius: 18px 18px 18px 7px')
    expect(bubbleRule).not.toContain('backdrop-filter')
    expect(CSS).not.toContain("div:not([data-variant])")
    expect(CSS).toContain("[data-variant='think']")
  })

  it('keeps reasoning and command-style assistant blocks outside Markdown bubbles', () => {
    document.body.innerHTML = `
      <div data-chat-flow-kind="assistant-step">
        <div class="renderer-seat">
          <div class="assistant-root">
            <div class="assistant-body">
              <div class="hash_markdown_hash" data-fixture="markdown"></div>
              <div data-variant="think" data-fixture="think"></div>
              <div data-variant="others" data-fixture="command"></div>
            </div>
          </div>
        </div>
      </div>
    `
    const matches = document.querySelectorAll(
      "[data-chat-flow-kind='assistant-step'] > * > * > * > div[class*='markdown']",
    )
    expect([...matches].map((element) => element.getAttribute('data-fixture'))).toEqual(['markdown'])
  })

  it('stabilizes light-theme disclosure text over the illustrated backdrop', () => {
    const variantRule = CSS.match(
      /:not\(\[data-ds-dark-theme\]\)\s+:is\(\[data-variant\], \[data-chat-flow-kind='context'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const rowRule = CSS.match(
      /:not\(\[data-ds-dark-theme\]\)[\s\S]*?:is\(\[data-variant\], \[data-chat-flow-kind='context'\]\) \[data-disclosure-row='true'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(variantRule).toContain('--dsw-alias-label-secondary: #2f4778')
    expect(variantRule).toContain('--dsw-alias-label-tertiary: #405273')
    expect(rowRule).toContain('rgba(248, 250, 255, 0.32)')
    expect(rowRule).not.toContain('backdrop-filter')
    expect(CSS).toContain(":is([data-variant], [data-chat-flow-kind='context'])")
    expect(CSS).toContain("[data-chat-flow-kind='context'] > [data-slot='conversation.chat.node'] > [data-open='true']")
    expect(CSS).toMatch(/:is\(\s*\[data-variant\](?::not\(\[data-variant='think'\]\))? > \[data-open='true'\],[\s\S]*?\)\s*\{[^}]*rgba\(248, 250, 255, 0\.5\)/)
    expect(CSS).not.toMatch(/\[data-variant\] > \[data-open='true'\][^{}]*backdrop-filter: blur\(3px\)/)
    expect(CSS).toMatch(/:is\([\s\S]*?\) > \[data-disclosure-row='true'\]\s*\{[^}]*background: transparent[^}]*backdrop-filter: none/s)
    expect(CSS).toMatch(/\[data-variant='think'\][^{]*\[data-disclosure-row='true'\] \+ \*\s*\{[^}]*color: #34486f[^}]*line-height: 1\.65/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\]\s+:is\(\[data-variant\], \[data-chat-flow-kind='context'\]\)\s*\{[^}]*#d3ddf2[^}]*#b8c5e1/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\][\s\S]*?:is\(\[data-variant\], \[data-chat-flow-kind='context'\]\) \[data-disclosure-row='true'\]\s*\{[^}]*rgba\(10, 20, 48, 0\.58\)/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\][\s\S]*?\[data-variant='think'\][^{]*\+ \*\s*\{[^}]*color: #c7d2e9/s)
  })

  it('keeps the light-theme composer statistics legible over the backdrop', () => {
    const dockRule = CSS.match(
      /:not\(\[data-ds-dark-theme\]\)[\s\S]*?\[data-slot='conversation\.composer\.dock'\] > \*\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(dockRule).toContain('color: #4a5d82')
    expect(dockRule).toContain('rgba(248, 250, 255, 0.3)')
    expect(dockRule).toContain('backdrop-filter: blur(2px)')
    expect(CSS).toMatch(/\[data-slot='conversation\.composer\.dock'\] > \* \[class\*='sep'\]\s*\{[^}]*rgba\(74, 93, 130, 0\.55\)/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\][\s\S]*?\[data-slot='conversation\.composer\.dock'\] > \*\s*\{[^}]*color: #aebdde[^}]*rgba\(10, 20, 48, 0\.48\)/s)
  })

  it('resets the light-theme subagent catalog inherited from the navy header', () => {
    const catalogRule = CSS.match(
      /:not\(\[data-ds-dark-theme\]\)[\s\S]*?\[data-slot='conversation\.session\.header\.actions'\] \[role='tree'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(catalogRule).toContain('--dsw-alias-label-primary: #233763')
    expect(catalogRule).toContain('--dsw-alias-label-tertiary: #596b8e')
    expect(catalogRule).toContain('rgba(248, 250, 255, 0.93)')
    expect(catalogRule).toContain('text-shadow: none')
    expect(catalogRule).toContain('backdrop-filter: blur(8px) saturate(0.92)')
    expect(CSS).toMatch(/\[role='tree'\][^{]*:is\(\[role='treeitem'\], \[class\*='label'\]\)\s*\{[^}]*color: #233763/s)
    expect(CSS).toMatch(/\[role='tree'\][^{]*:is\(\[class\*='summary'\], \[class\*='metrics'\], \[class\*='notice'\]\)\s*\{[^}]*color: #596b8e/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\][\s\S]*?\[data-slot='conversation\.session\.header\.actions'\] \[role='tree'\]\s*\{[^}]*rgba\(10, 20, 48, 0\.93\)[^}]*rgba\(18, 31, 67, 0\.89\)[^}]*backdrop-filter: blur\(8px\) saturate\(0\.92\)/s)
    expect(CSS).toMatch(/\[data-ds-dark-theme\][\s\S]*?\[role='tree'\][^{]*:is\(\[class\*='summary'\], \[class\*='metrics'\], \[class\*='notice'\]\)\s*\{[^}]*color: #b8c5e1/s)
  })

  it('marks only phase changes for composer motion', async () => {
    document.body.innerHTML = '<div data-phase="hero"></div>'
    fiber = await mount()
    expect(document.body.hasAttribute('data-maid-composer-motion')).toBe(false)

    const phaseRoot = document.querySelector<HTMLElement>('[data-phase]')!
    phaseRoot.dataset.phase = 'active'
    await flushMutations()
    expect(document.body.dataset.maidComposerMotion).toBe('dock')

    document.querySelector<HTMLElement>('[data-phase]')!.dataset.phase = 'hero'
    await flushMutations()
    expect(document.body.dataset.maidComposerMotion).toBe('rise')
    await fiber.dispose()
    expect(document.body.hasAttribute('data-maid-composer-motion')).toBe(false)
  })

  it('preserves mirror-driven composer sizing and clears the statistics dock', () => {
    const cardRule = CSS.match(/\[data-composer-card\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const textareaRule = CSS.match(/\[data-composer-card\] textarea\s*\{([^}]*)\}/s)?.[1] ?? ''
    const footerClearanceRule = CSS.match(
      /\[data-phase='active'\] \[data-composer-card\]:has\(\+ \*\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(cardRule).toContain('min-height: 0')
    expect(cardRule).not.toContain('min-height: 210px')
    expect(textareaRule).not.toContain('min-height: 112px')
    expect(footerClearanceRule).toContain('margin-block-end: 12px')
  })

  it('keeps the composer caret legible in dark mode without washing out light mode', () => {
    expect(CSS).toMatch(
      /\[data-composer-card\] textarea\s*\{[^}]*caret-color: #405a99/s,
    )
    expect(CSS).toMatch(
      /\[data-ds-dark-theme\] \[data-composer-card\] textarea\s*\{[^}]*caret-color: #bcd2ff/s,
    )
  })

  it('gives inspect-only overlay views the full canvas without the composer seat', () => {
    const inspectRule = CSS.match(
      /\[data-phase='active'\]\s*\[data-conversation-scroll\]:not\(:has\(\[data-chat-flow\]\)\)\s*> \[data-composer-seat\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(inspectRule).toContain('display: none')
  })

  it('lets the lower sidebar swag own the bottom boundary without a rectangular tint seam', () => {
    const innerFrameRule = CSS.match(/\:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\) > div::before\s*\{([^}]*)\}/s)?.[1] ?? ''
    const fadeRule = CSS.match(/\:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\) \[class\*='fade'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(innerFrameRule).toContain('inset: 9px 7px 0')
    expect(innerFrameRule).toContain('border: 0')
    expect(innerFrameRule).not.toContain('box-shadow')
    expect(fadeRule).toContain('background: none')
  })

  it('keeps internal tool-card headers out of the navy page-header treatment', () => {
    const pageHeaderRule = CSS.match(
      /:is\(\[data-pane='conversation'\], \[class\*='centerCol'\]\) header\[class\*='header'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const terminalRule = CSS.match(/\[data-terminal\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const darkTerminalRule = CSS.match(
      /\[data-ds-dark-theme\] \[data-terminal\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(pageHeaderRule).toContain('color: #f8f3e8')
    expect(CSS).not.toMatch(
      /:is\(\[data-pane='conversation'\], \[class\*='centerCol'\]\) \[class\*='header'\]\s*\{/,
    )
    expect(terminalRule).toContain('--dsw-alias-markdown-code-block: rgba(249, 250, 253, 0.97)')
    expect(terminalRule).toContain('--dsw-alias-label-primary: #172347')
    expect(terminalRule).toContain('text-shadow: none')
    expect(darkTerminalRule).toContain('--dsw-alias-markdown-code-block: rgba(10, 20, 48, 0.97)')
    expect(darkTerminalRule).toContain('--dsw-alias-label-primary: #edf1fa')
  })

  it('scales the lower sidebar swag at its source aspect ratio', () => {
    const sidebarInnerRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\) > div\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const footRule = CSS.match(/\[data-maid-sidebar-footer\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const swagRule = CSS.match(/\[data-maid-sidebar-footer\]::before\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(sidebarInnerRule).not.toContain('container-type')
    expect(footRule).toContain('box-sizing: border-box')
    expect(footRule).toContain('position: relative')
    expect(footRule).toContain('flex: 0 0 auto')
    expect(footRule).toContain('min-height: calc(var(--maid-sidebar-swag-height) + 82px)')
    expect(footRule).toContain('padding: calc(var(--maid-sidebar-swag-height) + 2px) 18px 22px')
    expect(swagRule).toContain('height: var(--maid-sidebar-swag-height)')
    expect(swagRule).toContain('background: var(--maid-sidebar-swag-art) center top / 100% 100% no-repeat')
    expect(swagRule).toContain('brightness(1.1)')
  })

  it('keeps generated corner ornaments fixed while the sidebar frame can resize', () => {
    const frameRule = CSS.match(
      /\[data-skin-chrome='sidebar-corners'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const cornerRule = CSS.match(
      /\[data-skin-chrome='sidebar-corners'\] > \[data-skin-corner\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(CSS).toContain('--maid-sidebar-corner-art')
    expect(frameRule).toContain('--maid-sidebar-frame-line-x: 1.35px')
    expect(frameRule).toContain('--maid-sidebar-frame-line-y: 1.25px')
    expect(frameRule).toContain('left 62px top 8.875px / calc(100% - 124px) var(--maid-sidebar-frame-line-y) no-repeat')
    expect(frameRule).toContain('left 62px bottom 8.875px / calc(100% - 124px) var(--maid-sidebar-frame-line-y) no-repeat')
    expect(frameRule).toContain('left 8.05px top 62px / var(--maid-sidebar-frame-line-x) calc(100% - 124px) no-repeat')
    expect(frameRule).toContain('right 8.05px top 62px / var(--maid-sidebar-frame-line-x) calc(100% - 124px) no-repeat')
    expect(cornerRule).toContain('width: 62px')
    expect(cornerRule).toContain('height: 62px')
    expect(cornerRule).toContain('background: var(--maid-sidebar-corner-art) top right / 130px 130px no-repeat')
    expect(CSS).toContain("[data-skin-corner='bottom-left']")
    expect(CSS).toContain('transform: scale(-1)')
  })

  it('styles the workspace heading, search field, and settings surround in antique gold', () => {
    const headingRule = CSS.match(/\[class\*='sectionHeader'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const searchRule = CSS.match(
      /\[class\*='search'\]\[class\*='searchExpanded'\]:has\(> input\[class\*='searchInput'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const expandedHeaderRule = CSS.match(
      /\[class\*='sectionHeader'\]:has\(\[class\*='searchSlotExpanded'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const settingsRule = CSS.match(
      /\[data-slot='sidebar\.settings'\]\s*> :is\(button, \[role='button'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(headingRule).toContain('color: #d9bd83')
    expect(searchRule).toContain('border: 1px solid rgba(225, 191, 124, 0.72)')
    expect(searchRule).toContain('--dsh-search-input-fill: transparent')
    expect(searchRule).toContain('margin: 0 2px')
    expect(expandedHeaderRule).toContain('height: 46px')
    expect(expandedHeaderRule).toContain('overflow: visible')
    expect(CSS).not.toMatch(/\[class\*='search'\]:has\(> input\[class\*='searchInput'\]\)\s*\{/)
    expect(settingsRule).toContain('min-height: 50px')
    expect(settingsRule).toContain('border-image-source: var(--maid-settings-frame-art)')
    expect(settingsRule).toContain('border-image-slice: 0 220 0 220 fill')
    expect(settingsRule).toContain('border-image-width: 0 34px')
  })

  it('lets the official settings mask blur every skin-owned layer', () => {
    const sidebarRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sidebarInnerRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\) > div\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sidebarContentRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\)\s*> div > :has\(\[data-maid-sidebar-footer\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const footerRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\)\s*> div > \[data-maid-sidebar-footer\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const topTrimRule = CSS.match(/\[data-skin-chrome='top-trim'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const bottomTrimRule = CSS.match(/\[data-skin-chrome='bottom-trim'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const obscuredComposerRule = CSS.match(
      /\[data-maid-settings-open\] \[data-composer-card\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const promotedSettingsRootRule = CSS.match(
      /:is\(\[data-pane='sidebar'\], \[class\*='sidebarCol'\]\)\s*> div\s*> :has\(\s*\[data-slot='sidebar\.settings'\]\s*> :is\(button, \[role='button'\]\)\[aria-expanded='true'\]\s*\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const preservedSidebarFrameRule = CSS.match(
      /:has\(\s*\[data-slot='sidebar\.settings'\]\s*> :is\(button, \[role='button'\]\)\[aria-expanded='true'\]\s*\) \[data-skin-chrome='sidebar-corners'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(sidebarRule).toContain('z-index: auto')
    expect(sidebarInnerRule).toContain('isolation: auto')
    expect(sidebarInnerRule).not.toContain('container-type')
    expect(sidebarContentRule).toBe('')
    expect(footerRule).toContain('z-index: auto')
    expect(topTrimRule).toContain('z-index: 20')
    expect(bottomTrimRule).toContain('z-index: 19')
    expect(promotedSettingsRootRule).toContain('z-index: 1000')
    expect(preservedSidebarFrameRule).toBe('')
    expect(obscuredComposerRule).toContain('z-index: 0')
    expect(obscuredComposerRule).toContain('opacity: 0.75')
    expect(obscuredComposerRule).toContain('pointer-events: none')
  })

  it('keeps the settings panel translucent above the dimmed composer', () => {
    const settingsSurfaceRule = CSS.match(
      /\[data-slot='sidebar\.settings'\]\s+\[role='presentation'\]\s*> \[role='dialog'\]\[aria-modal='true'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const darkSettingsSurfaceRule = CSS.match(
      /\[data-ds-dark-theme\]\s+\[data-slot='sidebar\.settings'\]\s+\[role='presentation'\]\s*> \[role='dialog'\]\[aria-modal='true'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(settingsSurfaceRule).toContain('--dsw-alias-bg-layer-2: rgba(235, 240, 250, 0.68)')
    expect(settingsSurfaceRule).toContain('backdrop-filter: blur(6px) saturate(0.9)')
    expect(darkSettingsSurfaceRule).toContain('--dsw-alias-bg-layer-2: rgba(24, 40, 80, 0.82)')
    expect(CSS).not.toMatch(
      /body\[data-dsh-maid-atelier\]\s+\[role='presentation'\]\s*> \[role='dialog'\]\[aria-modal='true'\]/s,
    )
  })

  it('renders the active workspace as a crested ribbon with a connected session tree', () => {
    const ribbonShapeRule = CSS.match(/\[data-maid-workspace-active\]::before\s*\{([^}]*)\}/s)?.[1] ?? ''
    const shieldRule = CSS.match(
      /\[data-maid-workspace-row\] > \[class\*='folder'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const selectedSessionRule = CSS.match(
      /\[data-maid-session-row\]\[aria-selected='true'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sessionBranchRule = CSS.match(
      /\[data-maid-session-row\]::before\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const selectedSessionPlaqueRule = CSS.match(
      /\[data-maid-session-row\]:not\(\[data-maid-session-flat\]\)\[aria-selected='true'\]::after\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(CSS).toContain('--maid-workspace-crest-art')
    expect(CSS).toContain('--maid-workspace-ribbon-art')
    expect(shieldRule).toContain('background: var(--maid-workspace-crest-art)')
    expect(shieldRule).not.toContain('clip-path')
    expect(ribbonShapeRule).toContain('border-image-source: var(--maid-workspace-ribbon-art)')
    expect(ribbonShapeRule).toContain('border-image-slice: 0 145 0 140 fill')
    expect(ribbonShapeRule).toContain('border-image-width: 0 36px 0 35px')
    expect(ribbonShapeRule).toContain('border-image-repeat: stretch')
    expect(ribbonShapeRule).toContain('inset: -3px 0 -3px -12px')
    expect(ribbonShapeRule).toContain('animation: maidAtelierWorkspaceRibbonEnter 420ms')
    expect(ribbonShapeRule).not.toContain('background-size')
    expect(ribbonShapeRule).not.toContain('clip-path')
    expect(CSS).toContain('@keyframes maidAtelierWorkspaceRibbonEnter')
    expect(CSS).toContain('clip-path: inset(0 100% 0 0)')
    expect(CSS).toContain('clip-path: inset(0 12% 0 0)')
    expect(CSS).toContain('@keyframes maidAtelierWorkspaceRibbonContentEnter')
    expect(selectedSessionRule).toContain('background: transparent')
    expect(selectedSessionRule).toContain('color: #fff8e8')
    expect(selectedSessionPlaqueRule).toContain('inset: 0 0 0 18px')
    expect(selectedSessionPlaqueRule).toContain('border-radius: 8px')
    expect(selectedSessionPlaqueRule).toContain('rgba(226, 190, 112, 0.72)')
    expect(selectedSessionPlaqueRule).toContain('rgba(82, 111, 184, 0.74)')
    expect(sessionBranchRule).toContain('repeating-linear-gradient')
    expect(sessionBranchRule).toContain('left: 8px')
    expect(sessionBranchRule).toContain('width: 10px')
    expect(CSS).toMatch(/\[data-maid-session-last\]::before\s*\{[^}]*1px 50% no-repeat/s)
  })

  it('renders the selected flat-list Session as a complete gold-edged plaque', () => {
    const flatRule = CSS.match(/\[data-maid-session-flat\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const selectedRule = CSS.match(
      /\[data-maid-session-flat\]\[aria-selected='true'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const accentRule = CSS.match(
      /\[data-maid-session-flat\]\[aria-selected='true'\]::before\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(flatRule).toContain('box-sizing: border-box')
    expect(flatRule).toContain('border-radius: 7px')
    expect(selectedRule).toContain('rgba(226, 190, 112, 0.72)')
    expect(selectedRule).toContain('rgba(82, 111, 184, 0.74)')
    expect(accentRule).toContain('linear-gradient(#fff0c5, #d4a951)')
    expect(accentRule).toContain('inset: 7px auto 7px 5px')
  })

  it('skins the official running StateDot as a recognizable atelier jewel chase', () => {
    const runningDotRule = CSS.match(
      /\[data-maid-session-row\] svg\[data-state='ongoing'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const runningCellRule = CSS.match(
      /\[data-maid-session-row\] svg\[data-state='ongoing'\] > rect\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const reducedMotionRules = [...CSS.matchAll(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g,
    )].map(match => match[1]).join('\n')
    expect(runningDotRule).toContain('width: 12px')
    expect(runningDotRule).toContain('radial-gradient')
    expect(runningDotRule).toContain('shape-rendering: geometricPrecision')
    expect(runningCellRule).toContain('fill: currentColor')
    expect(runningCellRule).toContain('animation: maidAtelierSessionJewelChase 1s linear infinite')
    expect(CSS).toContain('@keyframes maidAtelierSessionJewelChase')
    expect(reducedMotionRules).toContain("svg[data-state='ongoing'] > rect")
    expect(reducedMotionRules).toContain('animation: none')
  })

  it('moves the running reasoning sweep on the compositor instead of relayout', () => {
    const sweepRule = CSS.match(
      /\[data-variant='think'\]\[data-state='running'\] \[class\*='row'\]::after\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const sweepKeyframes = CSS.match(
      /@keyframes maid-atelier-reasoning-sweep\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? ''
    expect(sweepRule).toContain('left: -240px')
    expect(sweepRule).toContain('will-change: transform, opacity')
    expect(sweepKeyframes).toContain('transform: translate3d(')
    expect(sweepKeyframes).not.toMatch(/\bleft\s*:/)
  })

  it('keeps the sidebar mascot subordinate to navigation and behind the lower ornament', () => {
    const mascotRule = CSS.match(/\[data-skin-chrome='sidebar-mascot'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(mascotRule).toContain('bottom: calc(var(--maid-sidebar-swag-height) + 94px)')
    expect(mascotRule).toContain('width: var(--maid-sidebar-mascot-width)')
    expect(mascotRule).toContain('max-height: 38%')
    expect(mascotRule).toContain('z-index: 1')
    expect(mascotRule).toContain('opacity: 0.22')
    expect(mascotRule).toContain('saturate(1)')
    expect(mascotRule).toContain('brightness(1.08)')
    expect(CSS).toMatch(/:has\(\[role='tree'\]\)[^{]*\[data-skin-chrome='sidebar-mascot'\]\s*\{[^}]*display: none/s)
  })

  it('keeps independently sized landing and workspace trim layers', () => {
    const topTrimRule = CSS.match(/\[data-skin-chrome='top-trim'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const landingTrimRule = CSS.match(/\[data-skin-trim-layer='landing'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const workspaceTrimRule = CSS.match(/\[data-skin-trim-layer='workspace'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(topTrimRule).toContain('height: 76px')
    expect(topTrimRule).toContain('overflow: hidden')
    expect(landingTrimRule).toContain('height: 48px')
    expect(landingTrimRule).toContain('background: var(--maid-top-trim-art) left -2px / auto 51px repeat-x')
    expect(workspaceTrimRule).toContain('height: 76px')
    expect(workspaceTrimRule).toContain('background: var(--maid-top-trim-art) left -4px / auto 149px repeat-x')
    expect(CSS).not.toMatch(/var\(--maid-top-trim-art\)[^;]*100% 100%/)
    expect(topTrimRule).toContain('inset: 0 0 auto 0')
    expect(topTrimRule).toContain('translate: var(--maid-sidebar-width) 0')
    expect(topTrimRule).not.toContain('box-shadow')
  })

  it('tiles the bottom border while keeping its center crest independently sized', () => {
    const bottomTrimRule = CSS.match(/\[data-skin-chrome='bottom-trim'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const crestRule = CSS.match(/\[data-skin-chrome='bottom-trim'\]::after\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(bottomTrimRule).toContain('inset: auto 0 0 0')
    expect(bottomTrimRule).toContain('translate: var(--maid-sidebar-width) 0')
    expect(bottomTrimRule).toContain('background: var(--maid-bottom-trim-art) left bottom / auto 30px repeat-x')
    expect(bottomTrimRule).not.toContain('100% 100%')
    expect(crestRule).toContain('left: calc((100% - var(--maid-sidebar-width) - 8px) / 2)')
    expect(crestRule).toContain('transform: translateX(-50%)')
    expect(crestRule).toContain('background: var(--maid-bottom-crest-art) center / contain no-repeat')
  })

  it('moves the bottom embroidery with the composer phase', () => {
    const bottomTrimRule = CSS.match(/\[data-skin-chrome='bottom-trim'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const activeTrimRule = CSS.match(
      /\[data-maid-conversation-active\] \[data-skin-chrome='bottom-trim'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const movingTrimRule = CSS.match(
      /body\[data-dsh-maid-atelier\]\[data-maid-composer-motion\]\s*\[data-skin-chrome='bottom-trim'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(bottomTrimRule).toContain('translate: var(--maid-sidebar-width) 0')
    expect(bottomTrimRule).toContain('transform: translateY(0)')
    expect(bottomTrimRule).toContain('transition: transform 520ms')
    expect(bottomTrimRule).not.toContain('transition: translate 520ms')
    expect(activeTrimRule).toContain('transform: translateY(100%)')
    expect(activeTrimRule).not.toContain('--maid-sidebar-width')
    expect(movingTrimRule).toContain('will-change: transform')
  })

  it('slides the landing trim upward while the workspace trim drops from above', () => {
    const trimLayerRule = CSS.match(/\[data-skin-trim-layer\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const landingTrimRule = CSS.match(/\[data-skin-trim-layer='landing'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const workspaceTrimRule = CSS.match(/\[data-skin-trim-layer='workspace'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    const activeLandingRule = CSS.match(
      /\[data-maid-workspace\][\s\S]*?\[data-skin-trim-layer='landing'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const activeWorkspaceRule = CSS.match(
      /\[data-maid-workspace\][\s\S]*?\[data-skin-trim-layer='workspace'\]\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(trimLayerRule).toContain('transition: transform 520ms')
    expect(landingTrimRule).toContain('transform: translateY(0)')
    expect(workspaceTrimRule).toContain('transform: translateY(-100%)')
    expect(activeLandingRule).toContain('transform: translateY(-100%)')
    expect(activeWorkspaceRule).toContain('transform: translateY(0)')
  })

  it('keeps the bow on the landing trim and leaves the workspace band plain', () => {
    const landingBowRule = CSS.match(
      /\[data-skin-trim-layer='landing'\]::after\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(landingBowRule).toContain("content: ''")
    expect(landingBowRule).toContain('left: calc((100% - var(--maid-sidebar-width) - 8px) / 2)')
    expect(landingBowRule).toContain('background: var(--maid-bow-art) center / contain no-repeat')
    expect(CSS).not.toMatch(/\[data-skin-trim-layer='workspace'\]::after/)
  })

  it('keeps the animated workspace trim above its tablist without reserving lace space', () => {
    const workspaceHeaderRule = CSS.match(
      /body\[data-dsh-maid-atelier\] header:has\(\[role='tablist'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    expect(workspaceHeaderRule).toContain('position: relative')
    expect(workspaceHeaderRule).toContain('z-index: 21')
    expect(workspaceHeaderRule).not.toContain('padding-bottom')
    expect(workspaceHeaderRule).toContain('border-bottom: 0')
    const rootRule = CSS.match(/\[id='root'\]\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(rootRule).toContain('position: relative')
    expect(rootRule).not.toContain('z-index')
  })

  it('does not reserve or paint a lace field in active conversation and inspection views', () => {
    expect(CSS).not.toContain('padding-bottom: 66px')
    expect(CSS).not.toContain('padding-bottom: 28px')
    expect(CSS).not.toMatch(
      /:has\(header \[role='tablist'\]\):not\(:has\(\[data-conversation-scroll\] \[data-chat-flow\]\)\)[\s\S]*?background-color:/s,
    )
    expect(CSS).not.toMatch(
      /:has\(\[role='toolbar'\]\[aria-label='Trajectory toolbar'\]\)[\s\S]*?background-color:/s,
    )
  })

  it('softens workspace entry and disables decorative motion when requested', () => {
    const workspaceHeaderRule = CSS.match(
      /body\[data-dsh-maid-atelier\] header:has\(\[role='tablist'\]\)\s*\{([^}]*)\}/s,
    )?.[1] ?? ''
    const reducedMotionRule = CSS.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    )?.[1] ?? ''
    const workspaceHeaderKeyframes = CSS.match(
      /@keyframes maidAtelierWorkspaceHeaderEnter\s*\{[\s\S]*?\r?\n\}/,
    )?.[0] ?? ''
    expect(workspaceHeaderRule).toContain('animation: maidAtelierWorkspaceHeaderEnter 320ms 110ms both')
    expect(workspaceHeaderKeyframes).toContain('@keyframes maidAtelierWorkspaceHeaderEnter')
    expect(workspaceHeaderKeyframes).not.toContain('padding-bottom:')
    expect(reducedMotionRule).toContain('transition: none')
    expect(reducedMotionRule).toContain('animation: none')
    expect(reducedMotionRule).toContain('[data-maid-workspace-active]::before')
  })

  it('keeps the skin chrome aligned to the live sidebar width and restores the prior value', async () => {
    document.body.style.setProperty('--maid-sidebar-width', 'legacy')
    document.body.innerHTML = '<div data-pane="sidebar"><div></div></div>'
    const sidebar = document.querySelector<HTMLElement>("[data-pane='sidebar']")
    sidebar!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 312,
      height: 900,
      top: 0,
      right: 312,
      bottom: 900,
      left: 0,
      toJSON: () => ({}),
    })

    fiber = await mount()
    const widthRule = document.head
      .querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")!
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-width: 312px')
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-swag-height: 80.34px')
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-mascot-width: 255.84px')
    expect(document.body.dataset.maidSidebarSize).toBe('wide')
    await fiber.dispose()
    expect(document.body.style.getPropertyValue('--maid-sidebar-width')).toBe('legacy')
    expect(document.head.querySelector("[data-skin-chrome='sidebar-width-rule']")).toBeNull()
  })

  it('tracks animated sidebar width without mutating the body style attribute', async () => {
    let resize: ResizeObserverCallback | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }

      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    document.body.innerHTML = '<div data-pane="sidebar"><div></div></div>'

    fiber = await mount()
    const bodyStyle = document.body.getAttribute('style')
    resize?.([
      { contentRect: { width: 96 } as DOMRectReadOnly } as ResizeObserverEntry,
    ], {} as ResizeObserver)

    const widthRule = document.head
      .querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")!
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-width: 96px')
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-swag-height: 54px')
    expect(document.body.dataset.maidSidebarSize).toBe('rail')
    expect(document.body.getAttribute('style')).toBe(bodyStyle)
  })

  it('marks narrow and missing sidebars so Chat can reclaim the left gutter', async () => {
    document.body.innerHTML = '<div data-pane="sidebar"><div></div></div>'
    const sidebar = document.querySelector<HTMLElement>("[data-pane='sidebar']")!
    sidebar.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 80,
      height: 900,
      top: 0,
      right: 80,
      bottom: 900,
      left: 0,
      toJSON: () => ({}),
    })

    fiber = await mount()
    expect(document.body.dataset.maidSidebarCompact).toBe('')
    expect(document.body.dataset.maidSidebarSize).toBe('rail')
    const widthRule = document.head
      .querySelector<HTMLStyleElement>("[data-skin-chrome='sidebar-width-rule']")!
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-width: 80px')
    sidebar.remove()
    await flushMutations()
    expect(widthRule.sheet!.cssRules[0].cssText).toContain('--maid-sidebar-width: 0px')
    await fiber.dispose()
    expect(document.body.hasAttribute('data-maid-sidebar-compact')).toBe(false)
    expect(document.body.hasAttribute('data-maid-sidebar-size')).toBe(false)
  })

  it('switches between matched day and night backgrounds with the base theme', async () => {
    fiber = await mount()
    const light = document.body.style.backgroundImage
    document.body.dataset.dsDarkTheme = ''
    await flushMutations()
    const dark = document.body.style.backgroundImage
    expect(dark).not.toBe(light)
    expect(dark).toContain('data:image/webp;base64,')
    expect(dark).not.toContain('linear-gradient')
    delete document.body.dataset.dsDarkTheme
    await flushMutations()
    expect(document.body.style.backgroundImage).toBe(light)
  })
})
