/**
 * Conversation image preview enhancer. The web shell renders user messages
 * as plain text (no markdown pipeline), so the describe-image reference the
 * send hook splices (`![图片](/describe-image/raw/sha256:…)`) sits in the
 * transcript as raw text. This module watches the conversation DOM and
 * upgrades each reference in place into an inline thumbnail (click for a
 * full-size overlay). The message text itself is never edited — the original
 * markdown is restored when the toggle turns off or the plugin unloads — so
 * the session log and the model side are untouched.
 *
 * If the raw route is unreachable through the current origin (for example a
 * proxy that does not forward it), the thumbnail load fails, the failure is
 * remembered for the session, and the reference text is left alone from
 * there on.
 * @module @linxin666/dsh-tool-describe-image/client/preview
 */

import { t } from './locales.ts'
import css from './preview.module.css'

/** Matches one describe-image reference inside message text (global flag for repeated matches). */
const REFERENCE_PATTERN = /!\[([^\]]*)]\((\/describe-image\/raw\/[^)\s]+)\)/g

/** Attribute marking an injected preview; its value is the original markdown source. */
const PREVIEW_ATTR = 'data-dsh-di-preview'

/** Attribute marking the full-size overlay. */
const LIGHTBOX_ATTR = 'data-dsh-di-lightbox'

/** Session-level bound on remembered unreachable raw paths. */
const MAX_FAILED_PATHS = 200

/** One located reference: alt text, raw-route path, and its span inside the source text. */
export interface ImageReferenceMatch {
  readonly alt: string
  readonly path: string
  readonly start: number
  readonly end: number
}

/**
 * Locate every describe-image reference in one text chunk. Pure string math
 * (exported for tests); the DOM side walks text nodes and applies it.
 * @param text - raw message text.
 * @returns the references in source order.
 */
export function findImageReferences(text: string): ImageReferenceMatch[] {
  const matches: ImageReferenceMatch[] = []
  REFERENCE_PATTERN.lastIndex = 0
  for (let match = REFERENCE_PATTERN.exec(text); match !== null; match = REFERENCE_PATTERN.exec(text)) {
    matches.push({ alt: match[1] ?? '', path: match[2] ?? '', start: match.index, end: match.index + match[0].length })
  }
  return matches
}

/** Handle over one installed enhancer. */
export interface ConversationImagePreview {
  /** Re-read the toggle: enhance when on, restore every preview when off. */
  refresh(): void
  /** Restore every preview, close the overlay, and stop observing. */
  dispose(): void
}

/**
 * Install the enhancer. Watches `root` with a MutationObserver; mutation
 * bursts collapse into one pass per microtask and passes are idempotent —
 * processed references are elements, never text nodes, so a re-scan finds
 * nothing new. React re-renders that bring the raw text back are simply
 * re-upgraded on the next pass.
 * @param isEnabled - read per pass so settings edits apply without a reload.
 * @param root - subtree to watch (the shell body by default; tests pass a container).
 * @returns the handle; {@link ConversationImagePreview.dispose} restores the DOM.
 */
export function installConversationImagePreview(isEnabled: () => boolean, root: HTMLElement = document.body): ConversationImagePreview {
  /** Raw paths whose thumbnail load failed this session. */
  const failedPaths = new Set<string>()
  let lightboxCleanup: (() => void) | undefined
  let disposed = false
  let scheduled = false

  /** Whether the text node sits inside an editable surface, raw-text island, or our own UI. */
  const isExcluded = (node: Text): boolean => {
    const parent = node.parentElement
    if (parent === null) return true
    return parent.closest(`input, textarea, script, style, [contenteditable], [${PREVIEW_ATTR}]`) !== null
  }

  /** Remember one unreachable raw path, evicting the oldest beyond the bound. */
  const rememberFailure = (path: string): void => {
    if (failedPaths.size >= MAX_FAILED_PATHS) {
      const oldest = failedPaths.values().next()
      if (oldest.done !== true) failedPaths.delete(oldest.value)
    }
    failedPaths.add(path)
  }

  /** Restore one injected preview to its original markdown text. */
  const restorePreview = (preview: Element): void => {
    const source = preview.getAttribute(PREVIEW_ATTR)
    if (source === null) return
    preview.replaceWith(document.createTextNode(source))
  }

  /** Restore every preview under the root (toggle off / dispose). */
  const restoreAll = (): void => {
    for (const preview of root.querySelectorAll(`[${PREVIEW_ATTR}]`)) restorePreview(preview)
  }

  /** Close the full-size overlay when one stands. */
  const closeLightbox = (): void => {
    lightboxCleanup?.()
    lightboxCleanup = undefined
  }

  /** Open the full-size overlay for one thumbnail; click or Escape closes it. */
  const openLightbox = (src: string, alt: string): void => {
    closeLightbox()
    const overlay = document.createElement('div')
    overlay.className = css.lightbox ?? ''
    overlay.setAttribute(LIGHTBOX_ATTR, '')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-label', t('preview.close'))
    const image = document.createElement('img')
    image.src = src
    image.alt = alt
    overlay.append(image)
    overlay.addEventListener('click', closeLightbox)
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeLightbox()
    }
    document.addEventListener('keydown', onKeydown)
    lightboxCleanup = () => {
      document.removeEventListener('keydown', onKeydown)
      overlay.remove()
    }
    document.body.append(overlay)
  }

  /** Build one inline thumbnail for one located reference. */
  const buildPreview = (match: ImageReferenceMatch, source: string): HTMLElement => {
    const preview = document.createElement('span')
    preview.className = css.preview ?? ''
    preview.setAttribute(PREVIEW_ATTR, source)
    const image = document.createElement('img')
    image.className = css.thumb ?? ''
    image.src = window.location.origin + match.path
    image.alt = match.alt
    image.title = t('preview.expand')
    image.addEventListener('click', () => openLightbox(image.src, match.alt))
    image.addEventListener('error', () => {
      // The raw route is unreachable through the current origin: remember it
      // and leave the reference text alone from here on.
      rememberFailure(match.path)
      restorePreview(preview)
    }, { once: true })
    preview.append(image)
    return preview
  }

  /** Upgrade every reference inside one text node, keeping the surrounding text. */
  const enhanceNode = (node: Text): void => {
    const matches = findImageReferences(node.data).filter(match => !failedPaths.has(match.path))
    if (matches.length === 0) return
    const text = node.data
    const fragment = document.createDocumentFragment()
    let cursor = 0
    for (const match of matches) {
      fragment.append(document.createTextNode(text.slice(cursor, match.start)))
      fragment.append(buildPreview(match, text.slice(match.start, match.end)))
      cursor = match.end
    }
    fragment.append(document.createTextNode(text.slice(cursor)))
    node.replaceWith(fragment)
  }

  /** One full upgrade pass over the watched subtree. */
  const enhanceAll = (): void => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        const text = node as Text
        if (!text.data.includes('/describe-image/raw/')) return NodeFilter.FILTER_REJECT
        return isExcluded(text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    // Collect before mutating: replacing a node mid-walk invalidates the iterator.
    const targets: Text[] = []
    while (walker.nextNode()) targets.push(walker.currentNode as Text)
    for (const node of targets) enhanceNode(node)
  }

  /** Apply the current toggle state once. */
  const apply = (): void => {
    if (disposed) return
    if (isEnabled()) enhanceAll()
    else restoreAll()
  }

  /** Collapse a mutation burst into one pass per microtask. */
  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      apply()
    })
  }

  const observer = new MutationObserver(schedule)
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  apply()

  return {
    refresh: apply,
    dispose: () => {
      disposed = true
      observer.disconnect()
      restoreAll()
      closeLightbox()
    },
  }
}
