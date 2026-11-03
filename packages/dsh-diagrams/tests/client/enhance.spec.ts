// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { scopesForRecords, startEnhancement } from '../../src/client/enhance.ts'
import type { MermaidRuntime } from '../../src/client/runtime.ts'
import { DATA_CLAIMED, DATA_STATE, DIAGRAM_CLASS } from '../../src/core/contract.ts'

/** One renderer-shaped fenced code block. */
function codeBlock(language: string, source: string): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  block.innerHTML = `<div class="banner"><div class="_infostring_x1">${language}</div></div>`
    + `<div data-code-block-content><pre>${source}</pre></div>`
  return block
}

/** A structural runtime double: records initializes, renders markup tagged with the render id. */
function fakeRuntime(label = 'ok'): {
  runtime: MermaidRuntime
  initialize: ReturnType<typeof vi.fn>
  render: ReturnType<typeof vi.fn>
} {
  const initialize = vi.fn()
  const render = vi.fn(async (id: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" data-render="${id}"><text>${label}</text></svg>` }))
  return { runtime: { initialize, render } as unknown as MermaidRuntime, initialize, render }
}

describe('diagram enhancement', () => {
  it('user sees a mermaid fence rendered as a diagram and can still copy its source', async () => {
    // Given a transcript with one mermaid fence
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'))
    const { runtime, render } = fakeRuntime()
    // When the enhancement starts
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    // Then the diagram lands and the source block is only hidden
    await vi.waitFor(() => {
      expect(document.querySelector(`.${DIAGRAM_CLASS}`)?.getAttribute(DATA_STATE)).toBe('done')
    })
    const pre = document.querySelector('pre') as HTMLPreElement
    expect(render).toHaveBeenCalledTimes(1)
    expect(document.querySelector(`.${DIAGRAM_CLASS}`)?.innerHTML).toContain('<text>ok</text>')
    expect(pre.style.display).toBe('none')
    expect(pre.textContent).toBe('graph TD;A-->B')
    stop()
  })

  it('user keeps the original code block when the diagram is rejected', async () => {
    // Given a fence the runtime cannot parse
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A--'))
    const runtime = { initialize: vi.fn(), render: vi.fn(async () => { throw new Error('parse error') }) } as unknown as MermaidRuntime
    // When the enhancement tries to render it
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    // Then no container survives and the block is free to retry later
    await vi.waitFor(() => { expect(runtime.render).toHaveBeenCalled() })
    await vi.waitFor(() => { expect(document.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull() })
    const pre = document.querySelector('pre') as HTMLPreElement
    expect(pre.hasAttribute(DATA_CLAIMED)).toBe(false)
    expect(pre.style.display).not.toBe('none')
    stop()
  })

  it('user sees diagrams repainted for the new palette after a light/dark flip', async () => {
    // Given a rendered diagram
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'))
    const { runtime, render } = fakeRuntime()
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    await vi.waitFor(() => { expect(render).toHaveBeenCalledTimes(1) })
    const figure = document.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement
    const firstRender = figure.innerHTML
    // When the shell switches to its dark palette
    document.body.setAttribute('data-ds-dark-theme', '')
    // Then the diagram on screen is repainted for the new theme
    await vi.waitFor(() => { expect(figure.innerHTML).not.toBe(firstRender) })
    expect(figure.getAttribute(DATA_STATE)).toBe('done')
    stop()
  })

  it('user keeps ordinary code blocks when the runtime cannot load', async () => {
    // Given a page whose vendor route cannot answer
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'))
    let loadAttempts = 0
    // When the enhancement starts and the loader rejects
    const stop = startEnhancement({ root: document.body, load: async () => { loadAttempts += 1; throw new Error('404') } })
    // Then the load was attempted and nothing is claimed or containerised
    await vi.waitFor(() => { expect(loadAttempts).toBeGreaterThan(0) })
    expect(document.querySelectorAll(`.${DIAGRAM_CLASS}`)).toHaveLength(0)
    expect((document.querySelector('pre') as HTMLPreElement).hasAttribute(DATA_CLAIMED)).toBe(false)
    stop()
  })
})

describe('mutation scoping', () => {
  it('operator gets one scan scope per mutated block, removals and figures excluded', () => {
    // Given a block, a rendered figure and a removal-only record
    document.body.innerHTML = ''
    const block = codeBlock('mermaid', 'graph TD;A-->B')
    const figure = document.createElement('div')
    figure.className = DIAGRAM_CLASS
    figure.innerHTML = '<svg><text>x</text></svg>'
    document.body.append(block, figure)
    const inside = figure.querySelector('text') as Element
    const records = [
      { target: block, addedNodes: [block.querySelector('pre')] },
      { target: block, addedNodes: [] },
      { target: inside, addedNodes: [inside] },
    ] as unknown as MutationRecord[]
    // When the batch is mapped to scan scopes
    const scopes = scopesForRecords(records)
    // Then only the code block is scanned, once
    expect(scopes).toEqual([block])
  })
})