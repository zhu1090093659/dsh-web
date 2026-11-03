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
describe('diagram labels', () => {
  it('user sees node labels because diagrams are initialized with SVG text labels', async () => {
    // Given a flowchart fence whose labels mermaid would otherwise render as HTML
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A[Alpha]-->B[Beta]'))
    const { runtime, initialize, render } = fakeRuntime()
    // When the diagram is rendered
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    await vi.waitFor(() => { expect(render).toHaveBeenCalledTimes(1) })
    // Then the runtime was told to keep labels as SVG text, which the sanitizer keeps
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize.mock.calls[0]?.[0]).toMatchObject({ htmlLabels: false, securityLevel: 'strict' })
    stop()
  })
})

describe('render cost control', () => {
  it('user keeps a usable page when a fence cannot be parsed', async () => {
    // Given a fence the parser rejects and whose rollback mutates the DOM itself
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A--'))
    let attempts = 0
    const runtime = {
      initialize: vi.fn(),
      render: vi.fn(async () => { attempts += 1; throw new Error('parse error') }),
    } as unknown as MermaidRuntime
    // When the page keeps producing DOM changes for a while
    vi.useFakeTimers()
    try {
      const stop = startEnhancement({ root: document.body, load: async () => runtime })
      await vi.advanceTimersByTimeAsync(1000)
      // Then the rejected source is not parsed again on every DOM mutation
      expect(attempts).toBe(1)
      expect(document.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull()
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('user gets the rendered diagram back without a second parse when the palette returns', async () => {
    // Given a diagram painted for the light palette
    document.body.innerHTML = ''
    document.body.removeAttribute('data-ds-dark-theme')
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'))
    const { runtime, render } = fakeRuntime()
    vi.useFakeTimers()
    try {
      const stop = startEnhancement({ root: document.body, load: async () => runtime })
      await vi.advanceTimersByTimeAsync(100)
      const figure = document.querySelector(`.${DIAGRAM_CLASS}`) as HTMLElement
      const figureAfterFirstRender = figure.innerHTML
      const firstRenderId = figureAfterFirstRender.match(/data-render="([^"]+)"/)?.[1]
      // When the shell flips to dark and then back to light
      document.body.setAttribute('data-ds-dark-theme', '')
      await vi.advanceTimersByTimeAsync(100)
      expect(render).toHaveBeenCalledTimes(2)
      document.body.removeAttribute('data-ds-dark-theme')
      await vi.advanceTimersByTimeAsync(100)
      // Then the light-palette diagram is reused from the cache instead of re-parsed
      expect(render).toHaveBeenCalledTimes(2)
      expect(figure.getAttribute(DATA_STATE)).toBe('done')
      expect(figure.innerHTML).toBe(figureAfterFirstRender)
      expect(figureAfterFirstRender).toContain(String(firstRenderId))
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('user gets each diagram painted before the next one is parsed', async () => {
    // Given a document holding two mermaid fences
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'), codeBlock('mermaid', 'graph TD;C-->D'))
    const renders: string[] = []
    let firstFinishedBeforeSecondParse = false
    const runtime = {
      initialize: vi.fn(),
      render: vi.fn(async (id: string, source: string) => {
        if (renders.length === 1) {
          // The second parse must only start once the first diagram is on screen;
          // parsing both at once is what froze the page for hundreds of ms.
          const done = document.querySelectorAll(`.${DIAGRAM_CLASS}[data-diagram-state="done"]`)
          firstFinishedBeforeSecondParse = done.length === 1
        }
        renders.push(source)
        return { svg: `<svg xmlns="http://www.w3.org/2000/svg" data-render="${id}"></svg>` }
      }),
    } as unknown as MermaidRuntime
    // When both are rendered
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    await vi.waitFor(() => { expect(document.querySelectorAll(`.${DIAGRAM_CLASS}[data-diagram-state="done"]`)).toHaveLength(2) })
    // Then the diagrams were parsed one after another, not all at once
    expect(renders).toHaveLength(2)
    expect(firstFinishedBeforeSecondParse).toBe(true)
    stop()
  })

  it('user sees a streaming fence rendered once it becomes valid', async () => {
    // Given a fence that is rejected while it is still half-written
    document.body.innerHTML = ''
    const block = codeBlock('mermaid', 'graph TD;A--')
    document.body.append(block)
    let fail = true
    let attempts = 0
    const runtime = {
      initialize: vi.fn(),
      render: vi.fn(async () => {
        attempts += 1
        if (fail) throw new Error('parse error')
        return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>late</text></svg>' }
      }),
    } as unknown as MermaidRuntime
    const stop = startEnhancement({ root: document.body, load: async () => runtime })
    await vi.waitFor(() => { expect(attempts).toBe(1) })
    // When the fence closes
    fail = false
    ;(block.querySelector('pre') as HTMLPreElement).textContent = 'graph TD;A-->B'
    // Then the diagram lands on the retry that follows the change
    await vi.waitFor(() => {
      expect(document.querySelector(`.${DIAGRAM_CLASS}`)?.getAttribute(DATA_STATE)).toBe('done')
    }, { timeout: 2000 })
    stop()
  })
})