/**
 * PanelLayoutController DOM integration tests (issues #374 / #292 / #315):
 * drive the controller against a jsdom frame element and assert the real
 * DOM outcomes — the maximized takeover grid, the narrow-screen overlay
 * class, Esc restore (with the editing-surface exemption), and the floating
 * button docking at the top-right chevron row under a mocked Window
 * Controls Overlay.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PanelLayoutController } from '../src/client/layout.ts'
import { createLayoutStore, layoutSetRoot, type LayoutStore } from '../src/client/store.ts'
import { COLLAPSE_CHEVRON_TOP_PX, FLOATING_HEADER_GAP_PX } from '../src/client/floating.ts'

/** jsdom lacks ResizeObserver; the controller only needs a silent stub. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function domRect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, bottom: height, right: width, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
}

let frame: HTMLElement
let layout: LayoutStore
let controller: PanelLayoutController

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = SilentResizeObserver
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
  Object.defineProperty(navigator, 'windowControlsOverlay', { value: undefined, configurable: true })

  frame = document.createElement('div')
  frame.setAttribute('data-dsh-frame', '')
  frame.style.gridTemplateColumns = '240px minmax(0, 1fr) 0px'
  frame.getBoundingClientRect = () => domRect(1280, 900)
  document.body.appendChild(frame)

  layout = createLayoutStore()
  layoutSetRoot(layout, '/w', false)
  controller = new PanelLayoutController(layout)
  controller.mount()
})

afterEach(() => {
  controller.dispose()
  document.body.innerHTML = ''
})

const grid = (): string => frame.style.gridTemplateColumns
const explorerCol = (): HTMLElement => document.querySelector('[data-aionui-explorer-col]') as HTMLElement
const previewCol = (): HTMLElement => document.querySelector('[data-aionui-preview-col]') as HTMLElement
const floatingButton = (): HTMLButtonElement => document.querySelector('.aionui-floating-expand') as HTMLButtonElement

describe('maximize (issue #315)', () => {
  it('writes the normal five tracks on mount', () => {
    expect(grid()).toBe('240px minmax(0, 1fr) 0px 0px 260px')
  })

  it('takes over the whole row while maximized and restores on Esc', () => {
    layout.update((prev) => ({ ...prev, maximized: 'explorer' }))
    expect(grid()).toBe('0px 0px 0px 0px 1280px')
    expect(explorerCol().style.visibility).toBe('visible')
    expect(previewCol().style.visibility).toBe('hidden')
    expect(floatingButton().style.display).toBe('none')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(layout.getSnapshot().maximized).toBeNull()
    expect(grid()).toBe('240px minmax(0, 1fr) 0px 0px 260px')
  })

  it('leaves Esc to focused editing surfaces', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    layout.update((prev) => ({ ...prev, maximized: 'preview' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(layout.getSnapshot().maximized).toBe('preview')
  })

  it('switches to the fixed full-screen overlay on narrow rows', () => {
    layout.update((prev) => ({ ...prev, availableWidth: 500, maximized: 'explorer' }))
    expect(explorerCol().classList.contains('aionui-maximized')).toBe(true)
    expect(previewCol().classList.contains('aionui-maximized')).toBe(false)
    // The takeover grid is skipped in overlay mode: the fixed column covers.
    expect(grid()).toBe('240px minmax(0, 1fr) 0px 0px 260px')

    layout.update((prev) => ({ ...prev, maximized: null }))
    expect(explorerCol().classList.contains('aionui-maximized')).toBe(false)
  })

  it('resets maximized on a root switch', () => {
    layout.update((prev) => ({ ...prev, maximized: 'explorer' }))
    layoutSetRoot(layout, '/other', false)
    expect(layout.getSnapshot().maximized).toBeNull()
  })
})

describe('floating expand button (issues #374 / #292)', () => {
  const collapse = (): void => { layout.update((prev) => ({ ...prev, explorerCollapsed: true })) }

  it('docks at the chevron row below the WCO titlebar', () => {
    Object.defineProperty(navigator, 'windowControlsOverlay', {
      value: { visible: true, getTitlebarAreaRect: () => ({ height: 36 }) }, configurable: true,
    })
    collapse()
    const top = parseFloat(floatingButton().style.top)
    expect(top).toBe(36 + COLLAPSE_CHEVRON_TOP_PX)
    expect(floatingButton().style.transform).toBe('none')
  })

  it('docks at the chevron row in a plain browser tab', () => {
    collapse()
    expect(parseFloat(floatingButton().style.top)).toBe(COLLAPSE_CHEVRON_TOP_PX)
  })

  it('docks just below the shell header divider when one is present', () => {
    const center = document.createElement('div')
    center.className = 'centerCol'
    const header = document.createElement('header')
    header.getBoundingClientRect = () => domRect(800, 76)
    center.appendChild(header)
    frame.appendChild(center)
    collapse()
    expect(parseFloat(floatingButton().style.top)).toBe(76 + FLOATING_HEADER_GAP_PX)
  })

  it('keeps plain clicks toggling the explorer', () => {
    collapse()
    floatingButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(layout.getSnapshot().explorerCollapsed).toBe(false)

    floatingButton().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(layout.getSnapshot().explorerCollapsed).toBe(true)
  })

  it('hides while the explorer is expanded', () => {
    expect(floatingButton().style.display).toBe('none')
    collapse()
    expect(floatingButton().style.display).toBe('flex')
    layout.update((prev) => ({ ...prev, explorerCollapsed: false }))
    expect(floatingButton().style.display).toBe('none')
  })
})

describe('dispose restores the shell grid (issue #499)', () => {
  it('returns the frame to the native 3-track grid after unmount', () => {
    expect(grid()).toBe('240px minmax(0, 1fr) 0px 0px 260px')
    controller.dispose()
    expect(grid()).toBe('240px minmax(0, 1fr) 0px')
    expect(explorerCol()).toBeNull()
    expect(previewCol()).toBeNull()
  })
})
