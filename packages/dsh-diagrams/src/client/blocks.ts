/**
 * Finding, claiming and restoring mermaid code blocks in the official markdown
 * DOM, and the container that replaces them.
 *
 * The renderer's fenced code block is a `div.md-code-block` whose banner
 * carries the fence language as plain text; its `<pre>` has no language class.
 * The original `<pre>` is therefore HIDDEN, never removed: the block's own copy
 * button keeps reading the source from it.
 * @module @linxin666/dsh-client-ui-diagrams/client/blocks
 */

import {
  CODE_BLOCK_CLASS,
  DATA_CLAIMED,
  DATA_SOURCE,
  DATA_STATE,
  DIAGRAM_CLASS,
  INFOSTRING_CLASS_FRAGMENT,
  PART_NAME,
  PLUGIN_NAME,
  RENDERED_LANGUAGE,
} from '../core/contract.ts'

/** The mermaid blocks under one scope that this package has not claimed yet. */
export function findMermaidBlocks(scope: ParentNode): HTMLPreElement[] {
  const blocks: Element[] = []
  if (scope instanceof Element && scope.classList.contains(CODE_BLOCK_CLASS)) blocks.push(scope)
  blocks.push(...Array.from(scope.querySelectorAll(`.${CODE_BLOCK_CLASS}`)))

  const found: HTMLPreElement[] = []
  const seen = new Set<Element>()
  for (const block of blocks) {
    const infostring = block.querySelector(`[class*="${INFOSTRING_CLASS_FRAGMENT}"]`)
    if ((infostring?.textContent ?? '').trim() !== RENDERED_LANGUAGE) continue
    const pre = block.querySelector('pre')
    if (!(pre instanceof HTMLPreElement) || seen.has(pre)) continue
    seen.add(pre)
    if (pre.hasAttribute(DATA_CLAIMED)) continue
    if ((pre.textContent ?? '').trim() === '') continue
    found.push(pre)
  }
  return found
}

/**
 * Create the diagram container for one block and mark the block claimed.
 * @param pre - The block's `<pre>` (kept in the tree, hidden once rendered).
 * @returns The container to fill with the sanitized SVG.
 */
export function claimBlock(pre: HTMLPreElement): HTMLElement {
  pre.setAttribute(DATA_CLAIMED, '1')
  const container = document.createElement('div')
  container.className = DIAGRAM_CLASS
  container.setAttribute(DATA_STATE, 'pending')
  container.setAttribute(DATA_SOURCE, pre.textContent ?? '')
  container.setAttribute('data-dsh-plugin', PLUGIN_NAME)
  container.setAttribute('data-dsh-part', PART_NAME)
  pre.insertAdjacentElement('afterend', container)
  return container
}

/**
 * Undo one claim: drop the container and free the block for a later attempt
 * (a streaming fence becomes renderable once it closes).
 * @param pre - The block's `<pre>`.
 * @param container - The container created for it.
 */
export function restoreBlock(pre: HTMLPreElement, container: HTMLElement): void {
  container.remove()
  pre.removeAttribute(DATA_CLAIMED)
  pre.style.removeProperty('display')
}

/** Hide the source block once its diagram landed (the copy button still reads it). */
export function hideSourceBlock(pre: HTMLPreElement): void {
  pre.style.display = 'none'
}

/** Every finished container under one scope (retheme input). */
export function finishedContainers(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(`.${DIAGRAM_CLASS}[data-diagram-state="done"]`))
}
