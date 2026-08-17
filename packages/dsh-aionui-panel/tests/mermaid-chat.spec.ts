/**
 * Mermaid chat scope mapping tests: the observer batch maps to the minimal
 * mutated subtrees an enhance pass can re-scan instead of the whole body.
 * Pure against the exported helper plus real MutationRecord construction.
 */
import { describe, expect, it } from 'vitest'
import { enhanceScopesFor, isPanelOwnedPre } from '../src/client/chat/mermaid-chat.tsx'

/** Record a single-type mutation by hand with the given added/removed lists. */
function record(
  target: Node,
  addedNodes: NodeListOf<Node> | Node[],
  removedNodes: NodeListOf<Node> | Node[] = [],
): MutationRecord {
  return {
    type: 'childList',
    target,
    addedNodes,
    removedNodes,
    attributeName: null,
    attributeNamespace: null,
    oldValue: null,
    nextSibling: null,
    previousSibling: null,
  } as unknown as MutationRecord
}

describe('enhanceScopesFor', () => {
  it('an added element yields that element', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const child = document.createElement('pre')
    parent.appendChild(child)
    const scopes = enhanceScopesFor([record(parent, [child])])
    // The added element itself is a scope (the connected target adds it too).
    expect(scopes).toContain(child)
  })

  it('an added text node yields its parentElement', () => {
    const pre = document.createElement('pre')
    document.body.appendChild(pre)
    const text = document.createTextNode('graph TD')
    pre.appendChild(text)
    const scopes = enhanceScopesFor([record(pre, [text])])
    // Target pre and text's parentElement pre dedupe to a single scope.
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toBe(pre)
  })

  it('promotes a settled language label mutation to its code-block wrapper', () => {
    const block = document.createElement('div')
    block.className = 'md-code-block'
    const label = document.createElement('div')
    label.className = '_infostring_shell'
    const pre = document.createElement('pre')
    pre.innerHTML = '<code>flowchart LR\nA--&gt;B</code>'
    block.append(label, pre)
    document.body.appendChild(block)
    const language = document.createTextNode('mermaid')
    label.appendChild(language)

    expect(enhanceScopesFor([record(label, [language])])).toEqual([block])
  })

  it('a removed-node-only record yields nothing', () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const child = document.createElement('pre')
    target.appendChild(child)
    const rec = record(target, [], [child])
    // Removal cannot introduce a new fence, so the record contributes nothing.
    expect(enhanceScopesFor([rec])).toEqual([])
  })

  it('disconnected nodes are skipped', () => {
    // Fully detached parent and child: neither target nor added node is connected.
    const detachedParent = document.createElement('div')
    const detachedChild = document.createElement('pre')
    detachedParent.appendChild(detachedChild)
    expect(enhanceScopesFor([record(detachedParent, [detachedChild])])).toEqual([])

    // A text node inside a detached parent is skipped through its parentElement.
    const detachedWithText = document.createElement('pre')
    const text = document.createTextNode('graph TD')
    detachedWithText.appendChild(text)
    expect(enhanceScopesFor([record(detachedWithText, [text])])).toEqual([])
  })

  it('duplicates collapse to one scope', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const first = document.createTextNode('first')
    const second = document.createTextNode('second')
    parent.appendChild(first)
    parent.appendChild(second)
    const rec1 = record(parent, [first])
    const rec2 = record(parent, [second])
    // Both records map parent (target + both texts' parentElement) to one scope.
    const scopes = enhanceScopesFor([rec1, rec2])
    expect(scopes).toHaveLength(1)
    expect(scopes[0]).toBe(parent)
  })
})

describe('isPanelOwnedPre', () => {
  it('owns blocks inside the markdown scope marker or the preview column only', () => {
    const chat = document.createElement('pre')
    document.body.appendChild(chat)
    expect(isPanelOwnedPre(chat)).toBe(false)

    const mdScope = document.createElement('div')
    mdScope.setAttribute('data-aionui-md-scope', '1')
    const mdPre = document.createElement('pre')
    mdScope.appendChild(mdPre)
    document.body.appendChild(mdScope)
    expect(isPanelOwnedPre(mdPre)).toBe(true)

    const col = document.createElement('div')
    col.setAttribute('data-aionui-preview-col', '')
    const codePre = document.createElement('pre')
    col.appendChild(codePre)
    document.body.appendChild(col)
    expect(isPanelOwnedPre(codePre)).toBe(true)

    chat.remove()
    mdScope.remove()
    col.remove()
  })
})
