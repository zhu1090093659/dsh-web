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
 * The shell's active composer seat paints a bottom occlusion gradient under
 * the sticky input card (rc.8: a linear gradient to --dsw-alias-bg-base,
 * z-index 7). Backdrop scenes intentionally remove that seat-wide gradient in
 * both active and hero phases so wallpaper art remains unobstructed down to the
 * viewport edge. Skin-provided seat-wide ::before masks are neutralized too.
 * Composer task/statistics surfaces are styled by the shared shell adapter
 * from skin theme tokens, not by this scene layer.
 *
 * The input card itself ([data-composer-card], the official shell's stable card
 * anchor) keeps its translucent tint and gains the configurable backdrop blur
 * (default INPUT_FROST_BLUR_PX).
 *
 * The card rule is enabled only while the conversation actually has message
 * content (data-dsh-conversation-content): an empty conversation has no正文 to
 * occlude, so the input keeps its normal hero appearance without a frost flash.
 * The strength is provided by --dsh-input-card-blur and falls back to the
 * compatibility default when the setting has not loaded yet.
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

/**
 * Stable shell scrollport scoped row selectors. Official builds emit the chat
 * anchor; the CSS-module suffix fallbacks retain compatibility with older
 * shells without returning to a body-wide topic/session query.
 */
const ACTIVE_CONVERSATION_CONTENT_SELECTOR = [
  '[data-conversation-scroll] [data-chat-anchor-key]',
  '[data-conversation-scroll] [class*="_userRow"]',
  '[data-conversation-scroll] [class*="_compactionRow"]',
  '[data-conversation-scroll] [class*="_contextRow"]',
  '[data-conversation-scroll] [class*="_turnErrorRow"]',
].join(', ')

/** One source that can make backdrop art visible. */
export type BackdropSource = 'skin' | 'wallpaper'

/** Compatibility default for the input-card backdrop blur strength (px). */
export const INPUT_FROST_BLUR_PX = 10

const sourceSets = new WeakMap<Document, Set<BackdropSource>>()
const contentObservers = new WeakMap<Document, MutationObserver>()
const contentFrames = new WeakMap<Document, number>()

/** Write a marker attribute only when the desired state is not applied yet. */
function applyMarker(el: Element | null, attr: string, active: boolean): void {
  if (el === null) return
  if (active) {
    if (el.getAttribute(attr) !== 'true') el.setAttribute(attr, 'true')
    return
  }
  if (el.hasAttribute(attr)) el.removeAttribute(attr)
}

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
  applyMarker(doc.body, BACKDROP_ACTIVE_ATTR, active)
  applyMarker(doc.documentElement, BACKDROP_ACTIVE_ATTR, active)
  if (active) {
    ensureSceneNeutralizer(doc)
    startContentObserver(doc)
  } else {
    stopContentObserver(doc)
  }
}

/**
 * Track whether the active conversation scrollport has message rows for the
 * frost gate. Topic pickers and outgoing session trees can retain their own
 * data-chat-anchor-key nodes during a switch; a body-wide query would count
 * those stale rows and flash the composer frost over the new empty topic.
 */
function updateConversationContent(doc: Document): void {
  const has = doc.body !== null && doc.body.querySelector(ACTIVE_CONVERSATION_CONTENT_SELECTOR) !== null
  applyMarker(doc.body, CONVERSATION_CONTENT_ATTR, has)
  applyMarker(doc.documentElement, CONVERSATION_CONTENT_ATTR, has)
}

/**
 * Coalesce the mutation bursts of a streaming conversation into one content
 * check per frame; a check scheduled for a document that stopped observing is
 * dropped so a late frame can never re-add the marker after teardown.
 */
function scheduleConversationContent(doc: Document): void {
  if (contentFrames.has(doc)) return
  const win = doc.defaultView
  if (win === null || typeof win.requestAnimationFrame !== 'function') {
    updateConversationContent(doc)
    return
  }
  contentFrames.set(doc, win.requestAnimationFrame(() => {
    contentFrames.delete(doc)
    if (!contentObservers.has(doc)) return
    updateConversationContent(doc)
  }))
}

/** Observe the conversation tree while a backdrop is visible. */
function startContentObserver(doc: Document): void {
  if (contentObservers.has(doc)) return
  updateConversationContent(doc)
  const win = doc.defaultView
  if (win === null || typeof win.MutationObserver !== 'function') return
  const observer = new win.MutationObserver(() => scheduleConversationContent(doc))
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true })
  contentObservers.set(doc, observer)
}

/** Stop the content observer, cancel pending work and drop the marker. */
function stopContentObserver(doc: Document): void {
  const frame = contentFrames.get(doc)
  if (frame !== undefined) {
    const win = doc.defaultView
    if (win !== null && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame)
    contentFrames.delete(doc)
  }
  const observer = contentObservers.get(doc)
  if (observer !== undefined) {
    observer.disconnect()
    contentObservers.delete(doc)
  }
  applyMarker(doc.body, CONVERSATION_CONTENT_ATTR, false)
  applyMarker(doc.documentElement, CONVERSATION_CONTENT_ATTR, false)
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
    html[data-dsh-backdrop-active] [data-composer-seat],
    html[data-dsh-backdrop-active] [data-composer-seat]::before {
      background: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }
    html[data-dsh-backdrop-active][data-dsh-conversation-content] [data-composer-card] {
      backdrop-filter: blur(var(--dsh-input-card-blur, ${INPUT_FROST_BLUR_PX}px)) !important;
      -webkit-backdrop-filter: blur(var(--dsh-input-card-blur, ${INPUT_FROST_BLUR_PX}px)) !important;
    }
  `
  doc.head.appendChild(style)
}
