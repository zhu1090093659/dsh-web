/**
 * Card view mounting — one React root appended to `document.body`.
 *
 * The GUI's shell has no slot for a floating card, so (following the sibling
 * plugins' DOM-level extension discipline) the panel is a plain appended
 * container; the shell never manages it and never disturbs it. The card
 * hides itself when there is nothing to show.
 */
import { createRoot, type Root } from 'react-dom/client'
import { WorkscopeApi } from './api.ts'
import { GrantCard } from './GrantCard.tsx'
import { en, zh } from './locales.ts'

/** Marker attribute of the injected panel container. */
export const PANEL_SELECTOR = '[data-dsh-beyond-workscope-panel]'

/** Pick the dictionary by the browser language (zh default). */
function pickDictionary(): typeof zh {
  const language = typeof navigator !== 'undefined' ? navigator.language : ''
  return language.toLowerCase().startsWith('en') ? en : zh
}/**
 * Wait for the body, then mount the panel root.
 * @returns disposer unmounting the tree and removing the container.
 */
export function mountPanel(): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined && container.isConnected) return
    if (typeof document === 'undefined' || document.body === null) return
    container = document.createElement('div')
    container.dataset.dshBeyondWorkscopePanel = ''
    document.body.appendChild(container)
    root = createRoot(container)
    const dictionary = pickDictionary()
    root.render(<GrantCard api={new WorkscopeApi()} t={key => dictionary[key] ?? key} />)
  }

  ensure()
  if (container === undefined) {
    // Body not ready yet (edge case): retry once the document settles.
    const observer = new MutationObserver(() => {
      ensure()
      if (container !== undefined) observer.disconnect()
    })
    observer.observe(document, { childList: true, subtree: true })
    return () => observer.disconnect()
  }
  return () => {
    root?.unmount()
    container?.remove()
  }
}
