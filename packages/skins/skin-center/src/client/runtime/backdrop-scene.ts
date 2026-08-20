/**
 * Unified "backdrop visible" scene marker (issue #777).
 *
 * A skin with painted background media or a mounted Wallpaper Engine
 * wallpaper both put real backdrop art behind the app. The two runtime
 * controllers (skin-controller and wallpaper) report their mount state
 * through setSceneBackdropActive(); this module folds them into ONE body /
 * html marker `data-dsh-backdrop-active` and installs the shared composer
 * seat neutralizer that keys on it.
 *
 * The composer seat paints an opaque base fade under the input card (rc.8: a
 * linear gradient to --dsw-alias-bg-base, z-index 7; some builds additionally
 * use a ::before with backdrop-filter). While ANY backdrop art is visible the
 * fade would hide it behind the input area, so the official mask is
 * neutralized uniformly for skins and wallpapers alike (issue #747 direction).
 *
 * Readability after the mask is gone comes from the input card itself
 * ([data-composer-card], the official shell's stable card anchor): the card
 * keeps its own translucent tint (--dsw-specific-* tokens, not a hardcoded
 * opacity) and gains a fixed backdrop blur (INPUT_FROST_BLUR_PX). The blur
 * occludes the backdrop art and any message content scrolling under the
 * input, so typed text never overlaps — a frosted pane instead of the older
 * flat mask. The frost is only enabled while the conversation actually has
 * message content (data-dsh-conversation-content): an empty conversation has
 * no正文 to occlude, so the input card keeps only its own translucent tint
 * and does not flash an extra blur patch (issue #777 follow-up).
 * The strength is a baked constant (not a slider) until the unified
 * dialog-blur control lands.
 *
 * The marker is body/html level (managed outside the surface/part/plugin
 * enum, see contracts/semantic-attrs-v1.md) and survives a neutralizer
 * teardown; the style is inert whenever the marker is absent.
 * @module @linxin666/dsh-client-ui-skin-center/runtime/backdrop-scene
 */

/** Shared marker: set on html + body while a source reports backdrop art. */
export const BACKDROP_ACTIVE_ATTR = 'data-dsh-backdrop-active'

/** The shared composer-seat neutralizer style's own attribute. */
export const SCENE_NEUTRALIZER_ATTR = 'data-dsh-scene-neutralizer'

/** Conversation-content marker: set while the active conversation has rows. */
export const CONVERSATION_CONTENT_ATTR = 'data-dsh-conversation-content'

/** One source that can make backdrop art visible. */
export type BackdropSource = 'skin' | 'wallpaper'

/** Fixed input-card backdrop blur strength (px). Baked, not a slider yet. */
export const INPUT_FROST_BLUR_PX = 10

const sourceSets = new WeakMap<Document, Set<BackdropSource>>()
const contentObservers = new WeakMap<Document, MutationObserver>()

/**
 * Report one source's backdrop-art presence. The marker stays on while any
 * source is active, so the skin and wallpaper controllers never clobber each
 * other across their mount/unmount cycles.
 */
export function setSceneBackdropActive(doc: Document, source: BackdropSource, active: boolean): void {
  let sources = sourceSets.get(doc)
  if (sources === undefined) {
    sources = new Set()
    sourceSets.set(doc, sources)
  }
  if (active) sources.add(source)
  else sources.delete(source)
  syncMarker(doc, sources)
}

/** Reflect the source set onto html/body and ensure the neutralizer on use. */
function syncMarker(doc: Document, sources: Set<BackdropSource>): void {
  const active = sources.size > 0
  if (active) {
    doc.body?.setAttribute(BACKDROP_ACTIVE_ATTR, 'true')
    doc.documentElement?.setAttribute(BACKDROP_ACTIVE_ATTR, 'true')
    ensureSceneNeutralizer(doc)
    startContentObserver(doc)
  } else {
    doc.body?.removeAttribute(BACKDROP_ACTIVE_ATTR)
    doc.documentElement?.removeAttribute(BACKDROP_ACTIVE_ATTR)
    stopContentObserver(doc)
  }
}

/** Track whether the active conversation has message rows for the frost gate. */
function updateConversationContent(doc: Document): void {
  const has = doc.body !== null && doc.body.querySelector('[data-chat-anchor-key]') !== null
  if (has) {
    doc.body?.setAttribute(CONVERSATION_CONTENT_ATTR, 'true')
    doc.documentElement?.setAttribute(CONVERSATION_CONTENT_ATTR, 'true')
  } else {
    doc.body?.removeAttribute(CONVERSATION_CONTENT_ATTR)
    doc.documentElement?.removeAttribute(CONVERSATION_CONTENT_ATTR)
  }
}

/** Observe the conversation tree while a backdrop is visible. */
function startContentObserver(doc: Document): void {
  if (contentObservers.has(doc)) return
  updateConversationContent(doc)
  const win = doc.defaultView
  if (win === null || typeof win.MutationObserver !== 'function') return
  const observer = new win.MutationObserver(() => updateConversationContent(doc))
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
  contentObservers.set(doc, observer)
}

/** Stop the content observer and drop the content marker. */
function stopContentObserver(doc: Document): void {
  const observer = contentObservers.get(doc)
  if (observer !== undefined) {
    observer.disconnect()
    contentObservers.delete(doc)
  }
  doc.body?.removeAttribute(CONVERSATION_CONTENT_ATTR)
  doc.documentElement?.removeAttribute(CONVERSATION_CONTENT_ATTR)
}

/**
 * Install the shared composer-seat neutralizer, keyed by head presence so a
 * cleared head (tests) or a re-mount re-creates it. Without the marker the
 * rules are inert, so the style can outlive a single mount without changing
 * any other look.
 */
export function ensureSceneNeutralizer(doc: Document): void {
  if (doc.head === null) return
  if (doc.head.querySelector(`style[${SCENE_NEUTRALIZER_ATTR}]`) !== null) return
  const style = doc.createElement('style')
  style.setAttribute(SCENE_NEUTRALIZER_ATTR, '')
  style.textContent = `
    html[data-dsh-backdrop-active] [data-composer-seat]::before {
      background: none !important;
      backdrop-filter: none !important;
    }
    /* The input-card / bubble / code-block glass is now driven by the
       skin-center card blur slider (--dsw-wallpaper-glass-blur); the fixed
       10px placeholder is removed. */
  `
  doc.head.appendChild(style)
}
