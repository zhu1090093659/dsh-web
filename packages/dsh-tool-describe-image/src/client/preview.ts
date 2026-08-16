/**
 * Conversation image preview enhancer. The web shell renders user messages
 * as plain text (no markdown pipeline), so the describe-image reference the
 * send hook splices (`![图片](/describe-image/raw/sha256:…)`) sits in the
 * transcript as raw text. This module watches the chat transcript — the
 * official `conversation.session` slot wrapper, which excludes the composer —
 * and upgrades each reference in place into an inline thumbnail (a real
 * button: Enter/Space opens a full-size overlay, focus returns on close).
 * The message text itself is never edited — the original markdown is
 * restored when the toggle turns off or the plugin unloads — so the session
 * log and the model side are untouched.
 *
 * Scanning is scoped and incremental: a lightweight observer on the document
 * only (re)discovers the transcript container, while the content observer on
 * the container processes just the nodes each mutation record carries — no
 * full-page walks during streaming or sidebar churn. If the raw route is
 * unreachable through the current origin (for example a proxy that does not
 * forward it), the thumbnail load fails, the failure is remembered for the
 * session, and the reference text is left alone from there on.
 * @module @linxin666/dsh-tool-describe-image/client/preview
 */

import { t } from './locales.ts'
import css from './preview.module.css'

/** Matches one describe-image reference inside message text (global flag for repeated matches). */
const REFERENCE_PATTERN = /!\[([^\]]*)]\((\/describe-image\/raw\/[^)\s]+)\)/g

/** The official slot wrapper owning the chat transcript; the composer lives outside it. */
const CONVERSATION_ROOT_SELECTOR = '[data-slot="conversation.session"]'

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
 * Install the enhancer. With `root` omitted the transcript container is
 * resolved through the official slot attribute and re-resolved whenever the
 * shell remounts it (session switch); a fixed `root` (tests) skips that
 * watch. Content passes are record-driven and idempotent — processed
 * references are elements, never text nodes, so a re-scan finds nothing new.
 * @param isEnabled - read per pass so settings edits apply without a reload.
 * @param root - fixed subtree to watch (defaults to the transcript container).
 * @returns the handle; {@link ConversationImagePreview.dispose} restores the DOM.
 */
export function installConversationImagePreview(isEnabled: () => boolean, root?: HTMLElement): ConversationImagePreview {
  /** Raw paths whose thumbnail load failed this session. */
  const failedPaths = new Set<string>()
  let lightboxCleanup: (() => void) | undefined
  let contentObserver: MutationObserver | undefined
  let mountObserver: MutationObserver | undefined
  let observedRoot: HTMLElement | undefined
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

  /** The subtree every scan and restore is confined to. */
  const scope = (): HTMLElement | undefined => root ?? observedRoot

  /** Restore every preview inside the scope (toggle off / dispose). */
  const restoreAll = (): void => {
    const within = scope()
    if (within === undefined) return
    for (const preview of within.querySelectorAll(`[${PREVIEW_ATTR}]`)) restorePreview(preview)
  }

  /** Close the full-size overlay when one stands. */
  const closeLightbox = (): void => {
    lightboxCleanup?.()
    lightboxCleanup = undefined
  }

  /** Open the full-size overlay; focus moves in and returns to the trigger on close. */
  const openLightbox = (src: string, alt: string, trigger: HTMLElement): void => {
    closeLightbox()
    const overlay = document.createElement('div')
    overlay.className = css.lightbox ?? ''
    overlay.setAttribute(LIGHTBOX_ATTR, '')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', t('preview.close'))
    overlay.tabIndex = -1
    const image = document.createElement('img')
    image.src = src
    image.alt = alt
    overlay.append(image)
    overlay.addEventListener('click', closeLightbox)
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeLightbox()
    }
    overlay.addEventListener('keydown', onKeydown)
    lightboxCleanup = () => {
      overlay.remove()
      // Restore focus without scrolling: the transcript may have moved while
      // the overlay stood, and the default focus scroll would yank the view
      // back to the thumbnail (issue #317).
      if (trigger.isConnected) trigger.focus({ preventScroll: true })
    }
    document.body.append(overlay)
    overlay.focus()
  }

  /** Build one inline, keyboard-operable thumbnail for one located reference. */
  const buildPreview = (match: ImageReferenceMatch, source: string): HTMLElement => {
    const preview = document.createElement('span')
    preview.className = css.preview ?? ''
    preview.setAttribute(PREVIEW_ATTR, source)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = css.thumbButton ?? ''
    button.title = t('preview.expand')
    button.setAttribute('aria-label', t('preview.expand'))
    const image = document.createElement('img')
    image.className = css.thumb ?? ''
    image.src = window.location.origin + match.path
    image.alt = match.alt
    image.addEventListener('error', () => {
      // The raw route is unreachable through the current origin: remember it
      // and leave the reference text alone from here on.
      rememberFailure(match.path)
      restorePreview(preview)
    }, { once: true })
    button.addEventListener('click', () => openLightbox(image.src, match.alt, button))
    button.append(image)
    preview.append(button)
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

  /** Upgrade the references inside one added or changed node (text node or subtree). */
  const scanNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node as Text
      if (text.data.includes('/describe-image/raw/') && !isExcluded(text)) enhanceNode(text)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode: candidate => {
        const text = candidate as Text
        if (!text.data.includes('/describe-image/raw/')) return NodeFilter.FILTER_REJECT
        return isExcluded(text) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    // Collect before mutating: replacing a node mid-walk invalidates the iterator.
    const targets: Text[] = []
    while (walker.nextNode()) targets.push(walker.currentNode as Text)
    for (const target of targets) enhanceNode(target)
  }

  /** One full upgrade pass over the scope (initial attach, toggle on). */
  const enhanceAll = (): void => {
    const within = scope()
    if (within !== undefined) scanNode(within)
  }

  /** Content observer: process only the nodes each mutation record carries. */
  const onContentRecords = (records: MutationRecord[]): void => {
    if (disposed || !isEnabled()) return
    for (const record of records) {
      if (record.type === 'characterData') {
        scanNode(record.target)
      } else {
        for (const node of record.addedNodes) scanNode(node)
      }
    }
  }

  /** (Re)attach the content observer to the live transcript container. */
  const attach = (): void => {
    const next = root ?? document.querySelector<HTMLElement>(CONVERSATION_ROOT_SELECTOR) ?? undefined
    if (next === observedRoot) return
    contentObserver?.disconnect()
    observedRoot = next
    if (observedRoot !== undefined) {
      contentObserver = new MutationObserver(onContentRecords)
      contentObserver.observe(observedRoot, { childList: true, subtree: true, characterData: true })
      if (isEnabled()) enhanceAll()
    }
  }

  /** Collapse a mutation burst into one container re-resolution per microtask. */
  const schedule = (): void => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (!disposed) attach()
    })
  }

  /** Apply the current toggle state once. */
  const apply = (): void => {
    if (disposed) return
    if (isEnabled()) {
      attach()
      enhanceAll()
    } else {
      restoreAll()
    }
  }

  if (root === undefined) {
    // Watch the document only to (re)discover the transcript container; the
    // per-fire work is one identity check plus at most one querySelector.
    mountObserver = new MutationObserver(schedule)
    mountObserver.observe(document.body, { childList: true, subtree: true })
  }
  attach()

  return {
    refresh: apply,
    dispose: () => {
      disposed = true
      mountObserver?.disconnect()
      contentObserver?.disconnect()
      restoreAll()
      closeLightbox()
    },
  }
}
