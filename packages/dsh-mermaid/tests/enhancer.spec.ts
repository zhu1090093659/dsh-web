// @vitest-environment jsdom
/**
 * Enhancer DOM behavior against a CodeBlock-shaped transcript fixture: the
 * render seam is stubbed, so these tests cover discovery, figure lifecycle,
 * failure policy, and teardown — not mermaid itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findMermaidFences, installMermaidEnhancer, type MermaidRender } from '../src/client/enhancer.ts'
import { setLanguage, t } from '../src/client/locales.ts'

/** Build one CodeBlock-shaped fence element (banner + source body). */
function makeFence(lang: string, source: string): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const bannerWrap = document.createElement('div')
  const banner = document.createElement('div')
  const infostring = document.createElement('div')
  infostring.className = 'infostring'
  infostring.textContent = lang
  banner.appendChild(infostring)
  banner.appendChild(document.createElement('div'))
  bannerWrap.appendChild(banner)
  const body = document.createElement('pre')
  body.textContent = `${source}\n`
  block.appendChild(bannerWrap)
  block.appendChild(body)
  return block
}

/** The figure this enhancer attached to a block, if any. */
function figureOf(block: HTMLDivElement): HTMLDivElement | null {
  return block.querySelector('.dsh-mermaid-figure')
}
/** Real-timer sleep (the enhancer debounce runs on real timers). */
async function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  await promise
}

/** Labels wired to the zh dictionary, like the client entry does. */
const labels = {
  source: () => t('figure.source'),
  hide: () => t('figure.hide'),
  error: (message: string) => t('figure.error', { error: message }),
}

/** A render stub returning fixed SVG, recording every call. */
function okRender(calls: string[]): MermaidRender {
  return async (id, source) => {
    calls.push(`${id}:${source}`)
    return { ok: true, svg: `<svg id="${id}">diagram(${source})</svg>` }
  }
}

beforeEach(() => {
  document.body.textContent = ''
  document.getElementById('dsh-mermaid-style')?.remove()
  setLanguage('zh')
})

describe('findMermaidFences', () => {
  it('finds only mermaid fences with their trimmed source', () => {
    document.body.append(
      makeFence('mermaid', 'graph TD; A-->B'),
      makeFence('python', 'print(1)'),
      makeFence('Mermaid', 'graph TD; C-->D'),
    )
    const fences = findMermaidFences(document.body)
    expect(fences.map(fence => fence.source)).toEqual(['graph TD; A-->B', 'graph TD; C-->D'])
  })

  it('ignores blocks without the CodeBlock banner structure', () => {
    const bare = document.createElement('div')
    bare.className = 'md-code-block'
    bare.innerHTML = '<pre>graph TD; A-->B</pre>'
    document.body.appendChild(bare)
    expect(findMermaidFences(document.body)).toEqual([])
  })
})

describe('installMermaidEnhancer', () => {
  it('renders a figure for a mermaid fence and hides the source', async () => {
    const calls: string[] = []
    const block = makeFence('mermaid', 'graph TD; A-->B')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await vi.waitFor(() => {
      const figure = figureOf(block)
      expect(figure).not.toBeNull()
      expect(figure?.querySelector('svg')).not.toBeNull()
    })
    const body = block.children[1] as HTMLElement
    expect(body.dataset.dshMermaidHidden).toBe('1')
    expect(calls).toEqual([expect.stringContaining('graph TD; A-->B')])
    handle.dispose()
  })

  it('leaves non-mermaid fences untouched', async () => {
    const calls: string[] = []
    const block = makeFence('python', 'print(1)')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await delay(20)
    expect(calls).toEqual([])
    expect(figureOf(block)).toBeNull()
    handle.dispose()
  })

  it('shows the reason and keeps the source readable on render failure', async () => {
    const render: MermaidRender = async () => ({ ok: false, error: 'syntax boom' })
    const block = makeFence('mermaid', 'graph TD; A->')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render, labels, debounceMs: 0 })

    await vi.waitFor(() => {
      expect(figureOf(block)?.textContent).toContain('syntax boom')
    })
    const body = block.children[1] as HTMLElement
    expect(body.dataset.dshMermaidHidden).toBeUndefined()
    expect(body.textContent).toContain('graph TD; A->')
    handle.dispose()
  })

  it('re-renders when the source changes (streaming settle)', async () => {
    const calls: string[] = []
    const block = makeFence('mermaid', 'graph TD; A-->B')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await vi.waitFor(() => {
      expect(figureOf(block)).not.toBeNull()
      expect(figureOf(block)?.querySelector('svg')).not.toBeNull()
    })
    // The stream settles: the source body grows; the enhancer re-renders.
    const body = block.children[1] as HTMLElement
    body.textContent = 'graph TD; A-->B-->C\n'
    handle.scan()
    await vi.waitFor(() => {
      expect(figureOf(block)?.querySelector('svg')?.textContent).toContain('graph TD; A-->B-->C')
    })
    expect(calls.length).toBe(2)
    handle.dispose()
  })

  it('does not re-render an unchanged settled block', async () => {
    const calls: string[] = []
    const block = makeFence('mermaid', 'graph TD; A-->B')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await vi.waitFor(() => {
      expect(figureOf(block)).not.toBeNull()
      expect(figureOf(block)?.querySelector('svg')).not.toBeNull()
    })
    handle.scan()
    handle.rerenderAll()
    await vi.waitFor(() => {
      expect(calls.length).toBe(2) // rerenderAll re-renders once on purpose
    })
    handle.scan()
    await delay(20)
    expect(calls.length).toBe(2) // but a plain scan of an unchanged block does not
    handle.dispose()
  })

  it('toggles the source through the toolbar button', async () => {
    const calls: string[] = []
    const block = makeFence('mermaid', 'graph TD; A-->B')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await vi.waitFor(() => {
      expect(figureOf(block)).not.toBeNull()
      expect(figureOf(block)?.querySelector('button')).not.toBeNull()
    })
    const body = block.children[1] as HTMLElement
    const toggle = figureOf(block)!.querySelector('button')!
    expect(toggle.textContent).toBe(t('figure.source'))

    toggle.click()
    expect(body.dataset.dshMermaidHidden).toBeUndefined()
    expect(toggle.textContent).toBe(t('figure.hide'))

    toggle.click()
    expect(body.dataset.dshMermaidHidden).toBe('1')
    handle.dispose()
  })

  it('dispose reverts every figure and removes the stylesheet', async () => {
    const calls: string[] = []
    const block = makeFence('mermaid', 'graph TD; A-->B')
    document.body.appendChild(block)
    const handle = installMermaidEnhancer(document, { render: okRender(calls), labels, debounceMs: 0 })

    await vi.waitFor(() => {
      expect(figureOf(block)).not.toBeNull()
      expect(figureOf(block)?.querySelector('svg')).not.toBeNull()
    })
    handle.dispose()

    expect(figureOf(block)).toBeNull()
    expect((block.children[1] as HTMLElement).dataset.dshMermaidHidden).toBeUndefined()
    expect(block.dataset.dshMermaid).toBeUndefined()
    expect(document.getElementById('dsh-mermaid-style')).toBeNull()
  })
})
