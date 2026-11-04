// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { claimBlock, findMermaidBlocks, finishedContainers, hideSourceBlock, restoreBlock } from '../../src/client/blocks.ts'
import { DATA_CLAIMED, DATA_SOURCE, DATA_STATE, DIAGRAM_CLASS } from '../../src/core/contract.ts'

/** One renderer-shaped fenced code block: language banner plus a source pre. */
function codeBlock(language: string, source: string): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  block.innerHTML = `<div class="banner"><div class="_infostring_x1">${language}</div></div>`
    + `<div data-code-block-content><pre>${source}</pre></div>`
  return block
}

describe('mermaid block discovery', () => {
  it('user reading a transcript has the mermaid fence offered and the typescript fence ignored', () => {
    // Given a transcript holding one mermaid fence and one typescript fence
    document.body.innerHTML = ''
    document.body.append(codeBlock('mermaid', 'graph TD;A-->B'), codeBlock('typescript', 'const a = 1'))
    // When the discovery walks the document
    const found = findMermaidBlocks(document.body)
    // Then only the mermaid source pre is offered
    expect(found).toHaveLength(1)
    expect(found[0]?.textContent).toBe('graph TD;A-->B')
  })

  it('user sees a claimed or empty fence never offered again', () => {
    // Given a claimed block and an empty mermaid fence
    document.body.innerHTML = ''
    const claimed = codeBlock('mermaid', 'graph TD;A-->B')
    claimed.querySelector('pre')?.setAttribute(DATA_CLAIMED, '1')
    document.body.append(claimed, codeBlock('mermaid', '   '))
    // When discovery runs again
    const found = findMermaidBlocks(document.body)
    // Then neither is offered
    expect(found).toHaveLength(0)
  })

  it('user gets the block resolved when a re-scan starts at the block itself', () => {
    // Given a scope that IS the code block (a mutation target)
    document.body.innerHTML = ''
    const block = codeBlock('mermaid', 'graph TD;A-->B')
    document.body.append(block)
    // When the scan starts at that block
    const found = findMermaidBlocks(block)
    // Then the block's pre is found
    expect(found).toHaveLength(1)
  })
})

describe('diagram containers', () => {
  it('user gets one container per claimed fence, carrying the source and the semantic attributes', () => {
    // Given a mermaid block in the document
    document.body.innerHTML = ''
    const block = codeBlock('mermaid', 'graph TD;A-->B')
    document.body.append(block)
    const pre = block.querySelector('pre') as HTMLPreElement
    // When the block is claimed
    const container = claimBlock(pre)
    // Then a pending, self-describing container sits right after the source
    expect(pre.hasAttribute(DATA_CLAIMED)).toBe(true)
    expect(pre.nextElementSibling).toBe(container)
    expect(container.className).toBe(DIAGRAM_CLASS)
    expect(container.getAttribute(DATA_STATE)).toBe('pending')
    expect(container.getAttribute(DATA_SOURCE)).toBe('graph TD;A-->B')
    expect(container.getAttribute('data-dsh-plugin')).toBe('diagrams')
    expect(container.getAttribute('data-dsh-part')).toBe('diagram')
  })

  it('user gets the source block back unchanged when a render fails', () => {
    // Given a claimed block that then finished hiding its source
    document.body.innerHTML = ''
    const block = codeBlock('mermaid', 'graph TD;A-->B')
    document.body.append(block)
    const pre = block.querySelector('pre') as HTMLPreElement
    const container = claimBlock(pre)
    hideSourceBlock(pre)
    // When the render is rolled back
    restoreBlock(pre, container)
    // Then the container is gone and the source is visible and unclaimed again
    expect(document.querySelector(`.${DIAGRAM_CLASS}`)).toBeNull()
    expect(pre.hasAttribute(DATA_CLAIMED)).toBe(false)
    expect(pre.style.display).toBe('')
  })

  it('operator gets only finished containers for a theme re-render', () => {
    // Given one finished and one pending container
    document.body.innerHTML = `<div class="${DIAGRAM_CLASS}" data-diagram-state="done"></div>`
      + `<div class="${DIAGRAM_CLASS}" data-diagram-state="pending"></div>`
    // When the finished set is read
    const finished = finishedContainers(document.body)
    // Then only the rendered one qualifies
    expect(finished).toHaveLength(1)
    expect(finished[0]?.getAttribute(DATA_STATE)).toBe('done')
  })
})