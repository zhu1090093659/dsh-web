/**
 * Finding, claiming and restoring mermaid code blocks in the official markdown
 * DOM, and the container that replaces them.
 *
 * The renderer's fenced code block is a `div.md-code-block`; its `<pre>` has no
 * language class. The banner has two known shapes (see core/contract.ts): an
 * `_infostring_` element carrying the raw fence infostring, or a `_language_`
 * span that shows a localized placeholder when the highlighter does not know
 * the language. Mermaid is never a highlighter language, so on that shape the
 * label alone cannot identify the fence and the source's first keyword decides.
 * A real language label (js, bash, json, ...) always wins: those fences are
 * never claimed, whatever their source looks like.
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
  LANGUAGE_CLASS_FRAGMENT,
  PART_NAME,
  PLUGIN_NAME,
  RENDERED_LANGUAGE,
} from '../core/contract.ts'

/**
 * First-keyword signature of the mermaid diagram types. Consulted only when the
 * banner label is a localized placeholder (or absent), never to override a real
 * language label. Issue #2056: the rc.3 renderer hides the fence infostring
 * behind `i.codeLabel` for every language the highlighter does not know.
 */
const MERMAID_HEAD = /^\s*(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/

/** Generic labels that are not a fence language: placeholders and mermaid itself. */
const NON_LANGUAGE_LABEL = /^(?:code|text|plain|plaintext|snippet|mermaid)$/i

/**
 * Whether a banner label is a real fence language rather than a localized
 * placeholder. A placeholder carries CJK text or spaces; a real language is a
 * short ASCII token. The generic non-language labels are excluded so a fence
 * the highlighter does not know still falls through to the source signature.
 * Enumerating placeholder words per locale is deliberately avoided: the set
 * grows with every renderer language (#2056).
 */
function isRealLanguageLabel(label: string): boolean {
  if (!/^[A-Za-z0-9+#._-]{1,24}$/.test(label)) return false
  return !NON_LANGUAGE_LABEL.test(label)
}

/** The mermaid blocks under one scope that this package has not claimed yet. */
export function findMermaidBlocks(scope: ParentNode): HTMLPreElement[] {
  const blocks: Element[] = []
  if (scope instanceof Element && scope.classList.contains(CODE_BLOCK_CLASS)) blocks.push(scope)
  blocks.push(...Array.from(scope.querySelectorAll(`.${CODE_BLOCK_CLASS}`)))

  const found: HTMLPreElement[] = []
  const seen = new Set<Element>()
  for (const block of blocks) {
    const pre = block.querySelector('pre')
    if (!(pre instanceof HTMLPreElement) || seen.has(pre)) continue
    seen.add(pre)
    if (pre.hasAttribute(DATA_CLAIMED)) continue
    if ((pre.textContent ?? '').trim() === '') continue
    const label = (block.querySelector(
      `[class*="${INFOSTRING_CLASS_FRAGMENT}"], [class*="${LANGUAGE_CLASS_FRAGMENT}"]`,
    )?.textContent ?? '').trim()
    if (label.toLowerCase() === RENDERED_LANGUAGE) {
      found.push(pre)
      continue
    }
    if (isRealLanguageLabel(label)) continue
    if (!MERMAID_HEAD.test(pre.textContent ?? '')) continue
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
