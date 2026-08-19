// @vitest-environment jsdom
/**
 * Lightweight mount smoke test for the annotate panel: renders the panel
 * inside jsdom, checks the semantic root/parts appear, and verifies the
 * URL bar drives the iframe without throwing (canvas is unavailable in
 * jsdom and the draw path degrades to no-op by design).
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnnotatePanel } from '../src/client/panel/AnnotatePanel.tsx'
import type { SessionScopeLike } from '../src/client/better-sidebar.ts'

// jsdom lacks ResizeObserver; the panel measures the stage with it.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  container.remove()
  vi.unstubAllGlobals()
})

function renderPanel(options: { path?: string } = {}): void {
  const root = createRoot(container)
  act(() => {
    root.render(
      <AnnotatePanel
        ctx={{}}
        scope={{ sessionId: 's1', cwd: '/tmp' } as SessionScopeLike}
        tab={{ id: 'page-annotate', type: 'page-annotate', path: options.path ?? '' }}
        visible
      />,
    )
  })
}

describe('AnnotatePanel', () => {
  it('renders the semantic root and the URL bar', () => {
    renderPanel()
    const panel = container.querySelector('[data-dsh-plugin="page-annotate"]')
    expect(panel).not.toBeNull()
    const urlBar = container.querySelector('[data-dsh-part="url-bar"]')
    expect(urlBar).not.toBeNull()
    const stage = container.querySelector('[data-dsh-part="stage"]')
    expect(stage).not.toBeNull()
  })

  it('pre-fills the URL bar from tab.path', () => {
    const root = createRoot(container)
    act(() => {
      root.render(
        <AnnotatePanel
          ctx={{}}
          scope={{ sessionId: 's1' } as SessionScopeLike}
          tab={{ id: 't', type: 'page-annotate', path: 'https://example.com/orders' }}
          visible
        />,
      )
    })
    const input = container.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('https://example.com/orders')
  })

  it('shows the browse placeholder before any URL', () => {
    renderPanel()
    expect(container.textContent).toContain('批注')
    expect(container.textContent).toContain('浏览')
  })

  it('opens a persistent interactive browser only after an explicit click', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, value: { url: 'https://example.com/' } }) })
    vi.stubGlobal('fetch', fetchMock)
    renderPanel({ path: 'https://example.com' })

    const button = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === '交互浏览')
    expect(button).toBeDefined()
    await act(async () => button?.click())

    expect(fetchMock).toHaveBeenCalledWith('/page-annotate/browser/open', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    }))
  })

  it('navigates the browser on Enter without taking a screenshot', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    const input = container.querySelector('[data-dsh-part="url-bar"] input') as HTMLInputElement

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'https://example.com/login')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'https://example.com/login' }))
    })
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const frame = container.querySelector('iframe') as HTMLIFrameElement | null
    expect(frame?.getAttribute('src')).toBe('https://example.com/login')
    expect(frame?.getAttribute('sandbox')).toContain('allow-same-origin')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
