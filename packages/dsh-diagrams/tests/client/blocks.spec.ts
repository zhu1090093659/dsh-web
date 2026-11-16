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

/** The 0.2.2-rc.3 renderer shape: a `_language_` span in a card banner, no infostring. */
function languageCodeBlock(label: string, source: string): HTMLDivElement {
  const block = document.createElement('div')
  block.className = 'md-code-block _card_7gxqk_107'
  block.innerHTML = `<div class="_header_x1" data-code-block-banner><div class="_heading_x1"><span class="_language_x1">${label}</span></div></div>`
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


describe('mermaid block discovery across renderer banner shapes (#2056)', () => {
  it('user pasting a mermaid fence on the rc.3 renderer gets the diagram although the banner shows the localized placeholder', () => {
    // Given the rc.3 card shape whose highlighter does not know mermaid, so the
    // banner carries the Chinese and English placeholder labels
    document.body.innerHTML = ''
    document.body.append(
      languageCodeBlock('代码块', 'flowchart LR\nA-->B'),
      languageCodeBlock('Code block', 'sequenceDiagram\nAlice->>Bob: hi'),
    )
    // When discovery walks the document
    const found = findMermaidBlocks(document.body)
    // Then both fences are offered by their source signature
    expect(found).toHaveLength(2)
    expect(found[0]?.textContent).toContain('flowchart LR')
    expect(found[1]?.textContent).toContain('sequenceDiagram')
  })

  it('user reading a plain shell snippet under a placeholder banner keeps the code block', () => {
    // Given a placeholder-labelled fence whose source is not a mermaid diagram
    document.body.innerHTML = ''
    document.body.append(languageCodeBlock('代码块', 'ls -al /tmp'))
    // When discovery runs
    const found = findMermaidBlocks(document.body)
    // Then nothing is offered
    expect(found).toHaveLength(0)
  })

  it('user reading a real language fence is never claimed even when its source looks like mermaid', () => {
    // Given rc.3 banners naming highlighter languages beside mermaid-shaped and plain sources
    document.body.innerHTML = ''
    document.body.append(languageCodeBlock('js', 'flowchart LR\nA-->B'), languageCodeBlock('typescript', 'const a = 1'))
    // When discovery runs
    const found = findMermaidBlocks(document.body)
    // Then the real language label wins and neither fence is offered
    expect(found).toHaveLength(0)
  })

  it('user labelling a fence mermaid gets it claimed whatever the source starts with', () => {
    // Given a banner naming mermaid itself and a source opening with an init directive
    document.body.innerHTML = ''
    document.body.append(languageCodeBlock('mermaid', '%%{init: {"theme": "dark"}}%%\ngraph LR\nA-->B'))
    // When discovery runs
    const found = findMermaidBlocks(document.body)
    // Then the label alone claims the fence
    expect(found).toHaveLength(1)
  })

  it('user writing the fence infostring in mixed case still gets the diagram', () => {
    // Given the older infostring banner carrying `Mermaid`
    document.body.innerHTML = ''
    document.body.append(codeBlock('Mermaid', 'graph LR\nA-->B'))
    // When discovery runs
    const found = findMermaidBlocks(document.body)
    // Then the label matches case-insensitively
    expect(found).toHaveLength(1)
  })

  it('user on a renderer shape with no language banner at all still gets mermaid sources offered', () => {
    // Given a code block whose banner carries no language element
    document.body.innerHTML = ''
    const block = document.createElement('div')
    block.className = 'md-code-block'
    block.innerHTML = '<div data-code-block-content><pre>mindmap\n  root((dsh))</pre></div>'
    document.body.append(block)
    // When discovery runs
    const found = findMermaidBlocks(document.body)
    // Then the source signature decides
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