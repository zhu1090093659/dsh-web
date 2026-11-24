// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../../src/client/index.ts'
import { MermaidFenceLayer } from '../../src/client/MermaidFenceLayer.tsx'
import { createMermaidRenderer } from '../../src/client/render.ts'
import type { MermaidRuntime } from '../../src/client/runtime.ts'
import {
  DATA_SOURCE,
  DATA_STATE,
  DIAGRAM_CLASS,
  FENCE_LAYER_ID,
  FENCE_SLOT_NAME,
  RENDERED_LANGUAGE,
} from '../../src/core/contract.ts'

function fakeRuntime(label = 'diagram'): {
  runtime: MermaidRuntime
  initialize: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
} {
  const initialize = vi.fn()
  const renderFn = vi.fn(async (id: string, source: string) => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" data-render="${id}" data-len="${source.length}"><text>${label}</text></svg>`,
  }))
  return {
    runtime: { initialize, render: renderFn } as unknown as MermaidRuntime,
    initialize,
    render: renderFn,
  }
}

afterEach(() => {
  cleanup()
  document.body.removeAttribute('data-ds-dark-theme')
})

describe('official chat markdown fence layer', () => {
  it('user reading a streaming mermaid fence sees the raw code block without loading the runtime', () => {
    // Given a mermaid fence that is still streaming
    const load = vi.fn(async () => fakeRuntime().runtime)
    const renderer = createMermaidRenderer()
    // When the fence layer renders while streaming is true
    const view = render(
      <MermaidFenceLayer
        lang="mermaid"
        code="graph TD;A--"
        streaming
        load={load}
        renderer={renderer}
      >
        <pre data-testid="fallback-code">graph TD;A--</pre>
      </MermaidFenceLayer>,
    )
    // Then the fallback code block stays visible and the runtime loader is not triggered
    expect(view.getByTestId('fallback-code').textContent).toBe('graph TD;A--')
    expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('user reading a settled mermaid fence in chat sees a sanitized SVG figure instead of the code block', async () => {
    // Given a settled mermaid fence and a runtime returning an SVG containing a script tag
    const initialize = vi.fn()
    const renderFn = vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>clean</text></svg>',
    }))
    const runtime = { initialize, render: renderFn } as unknown as MermaidRuntime
    const renderer = createMermaidRenderer()
    // When the fence layer mounts with streaming false
    const view = render(
      <MermaidFenceLayer
        lang="mermaid"
        code="graph TD;A-->B"
        streaming={false}
        load={async () => runtime}
        renderer={renderer}
      >
        <pre data-testid="fallback-code">graph TD;A--&gt;B</pre>
      </MermaidFenceLayer>,
    )
    // Then the code block is replaced by a sanitized diagram carrying the semantic attributes
    await waitFor(() => {
      expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)?.getAttribute(DATA_STATE)).toBe('done')
    })
    const figure = view.container.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement
    expect(figure.getAttribute('data-dsh-plugin')).toBe('diagrams')
    expect(figure.getAttribute('data-dsh-part')).toBe('diagram')
    expect(figure.getAttribute(DATA_SOURCE)).toBe('graph TD;A-->B')
    expect(figure.innerHTML).toContain('<text>clean</text>')
    expect(figure.innerHTML).not.toContain('<script>')
    expect(view.queryByTestId('fallback-code')).toBeNull()
  })

  it('user keeps the fallback code block when mermaid parsing fails in the fence slot', async () => {
    // Given a settled fence whose syntax the mermaid runtime rejects
    const runtime = {
      initialize: vi.fn(),
      render: vi.fn(async () => { throw new Error('syntax error') }),
    } as unknown as MermaidRuntime
    const renderer = createMermaidRenderer()
    // When the fence layer tries to render it
    const view = render(
      <MermaidFenceLayer
        lang="mermaid"
        code="graph TD;broken"
        streaming={false}
        load={async () => runtime}
        renderer={renderer}
      >
        <pre data-testid="fallback-code">graph TD;broken</pre>
      </MermaidFenceLayer>,
    )
    // Then the parse is attempted and the fallback code block remains visible with no figure left behind
    await waitFor(() => {
      expect(runtime.render).toHaveBeenCalled()
    })
    expect(view.getByTestId('fallback-code').textContent).toBe('graph TD;broken')
    expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull()
  })

  it('user sees the fence diagram repaint for dark theme and reuse the cached light diagram on flip back', async () => {
    // Given a settled mermaid fence rendered in the light palette
    const { runtime, initialize, render: renderFn } = fakeRuntime('themed')
    const renderer = createMermaidRenderer()
    const view = render(
      <MermaidFenceLayer
        lang="mermaid"
        code="graph LR;X-->Y"
        streaming={false}
        load={async () => runtime}
        renderer={renderer}
      >
        <pre>graph LR;X--&gt;Y</pre>
      </MermaidFenceLayer>,
    )
    await waitFor(() => {
      expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)?.getAttribute(DATA_STATE)).toBe('done')
    })
    const lightHtml = view.container.querySelector(`.${DIAGRAM_CLASS}`)?.innerHTML
    // When the shell toggles dark mode on and then back off
    document.body.setAttribute('data-ds-dark-theme', '')
    await waitFor(() => {
      expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)?.innerHTML).not.toBe(lightHtml)
    })
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
    const darkCount = renderFn.mock.calls.length
    document.body.removeAttribute('data-ds-dark-theme')
    await waitFor(() => {
      expect(view.container.querySelector(`.${DIAGRAM_CLASS}`)?.innerHTML).toBe(lightHtml)
    })
    // Then switching back to light reuses the cached SVG without another parse
    expect(renderFn.mock.calls.length).toBe(darkCount)
  })

  it('operator sees apply register MermaidFenceLayer into the official conversation.chat.markdown.fence slot', () => {
    // Given a client context exposing ctx.slots and ctx.effect
    const registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const effectCleanups: Array<() => void> = []
    const fakeSlots = {
      inject: (_name: string, fn: () => () => void) => {
        const stop = fn()
        effectCleanups.push(stop)
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        registered.push({ options, component })
        return () => {}
      },
    }
    const fakeCtx = {
      get: (name: string) => (name === 'slots' ? fakeSlots : undefined),
      effect: (fn: () => () => void) => {
        effectCleanups.push(fn())
      },
    } as unknown as ClientContext
    // When the client plugin applies
    apply(fakeCtx)
    // Then the mermaid layer is registered under the official fence slot and key
    expect(registered).toHaveLength(1)
    expect(registered[0]?.options).toEqual({
      name: FENCE_SLOT_NAME,
      key: RENDERED_LANGUAGE,
      id: FENCE_LAYER_ID,
    })
    expect(registered[0]?.component).toBe(MermaidFenceLayer)
    for (const stop of effectCleanups) stop()
  })
})
