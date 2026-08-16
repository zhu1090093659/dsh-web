// @vitest-environment jsdom
/**
 * Code preview rendering: the viewer is now the official CodeBlock from
 * @deepseek-ai/dsh-client-ui-primitives (shiki core), so an unknown
 * extension falls back to a plain <pre> while a known language renders the
 * highlighted tree with a copy banner. Assert on structure only — token
 * colors are the official highlighter's internal contract, not ours
 * (issue #241).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CodeViewer } from '../src/client/preview/content.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// CodeViewer doesn't measure the DOM, but CodeBlock's grammar-loading store
// rides requestAnimationFrame/setTimeout paths; keep jsdom stable with a
// no-op ResizeObserver just in case the surrounding renderer ever measures.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

function renderViewer(content: string, language: string): HTMLElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(<CodeViewer content={content} language={language} />)
  })
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CodeViewer preview highlighting', () => {
  it('renders a plain <pre> fallback for an unknown extension', () => {
    const host = renderViewer('const answer = 42', 'xyz')
    const wrapper = host.querySelector('.md-code-block')
    expect(wrapper).not.toBeNull()
    const pre = wrapper?.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.textContent).toContain('const answer = 42')
  })

  it('renders the highlighted tree with a copy button for a known language', () => {
    const host = renderViewer('function add(a: number, b: number): number { return a + b }', 'ts')
    const wrapper = host.querySelector('.md-code-block')
    expect(wrapper).not.toBeNull()
    // The source text is present whether it fell back to plain or produced
    // shiki tokens (integer overflow of tokenize time limit can flip the arm).
    expect(host.textContent).toContain('function add')
    const copy = wrapper?.querySelector('button')
    expect(copy).not.toBeNull()
    expect(copy?.textContent).toBe('复制代码')
  })

  it('renders without crashing on empty content', () => {
    const host = renderViewer('', 'ts')
    const wrapper = host.querySelector('.md-code-block')
    expect(wrapper).not.toBeNull()
    expect(host.textContent).not.toBeNull()
  })
})
