/**
 * Fixed decoration layers (issue #506, contract section 6).
 *
 * Six skin-center-owned, non-interactive containers mounted once per
 * document (component scope): background / ambient / top / bottom / sidebar /
 * foreground. Skins fill them per activation (background media, scrims,
 * strips); the CONTENT is activation scope — on every switch the controller
 * replaces it through the effect ledger.
 *
 * Guarantees:
 *  - pointer-events: none always (decoration must never eat clicks);
 *  - the layer elements themselves survive skin switches, reloads of the
 *    skin runtime, and HMR (ensure* is idempotent);
 *  - stacking stays below the official shell overlay: background/ambient sit
 *    behind the app, the strip/foreground layers use moderate z-indices that
 *    lose to dialogs/overlays (official overlay paints above 1000);
 *  - the background layer carries its own compositor layer (will-change:
 *    transform): a full-viewport skin background image is expensive to
 *    re-rasterize, and without isolation Chromium re-rasterizes it in
 *    horizontal bands whenever unrelated repaint bursts (streaming chat,
 *    animated pets, overlay menus) invalidate the same area — visible as
 *    vertical band flicker (issue #1013).
 * @module @linxin666/dsh-client-ui-skin-center/runtime/decoration-layers
 */

export const DECORATION_LAYER_NAMES = [
  'background',
  'ambient',
  'top',
  'bottom',
  'sidebar',
  'foreground',
] as const

export type DecorationLayerName = (typeof DECORATION_LAYER_NAMES)[number]

export type DecorationLayers = Record<DecorationLayerName, HTMLElement>

const LAYER_ATTR = 'data-dsh-skin-layer'

/**
 * Per-layer paint order. The background sits at -2: negative z-index
 * elements paint ABOVE the html/body backgrounds (so a skin's own opaque
 * root background-color renders BEHIND its art — the v1 layering) yet below
 * every panel surface. It shares -2 with the WE scrim, which never paints
 * at the same time (an active WE wallpaper suppresses skin media, enforced
 * by the controller). The skin-background blur veil (-1) still samples the
 * art above it. Ambient effects paint above the veils; the strip/foreground
 * layers stay below the official overlay band (>=1000).
 */
const LAYER_STYLE: Record<DecorationLayerName, string> = {
  // Explicit longhands only: the inset shorthand has burned us once (a
  // mid-session layer lost its bottom edge), longhands parse everywhere.
  background: 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:-2;pointer-events:none;will-change:transform;',
  ambient: 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:30;pointer-events:none;',
  top: 'position:fixed;top:0;left:0;right:0;z-index:40;pointer-events:none;',
  bottom: 'position:fixed;bottom:0;left:0;right:0;z-index:40;pointer-events:none;',
  sidebar: 'position:fixed;top:0;bottom:0;left:0;z-index:40;pointer-events:none;',
  foreground: 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:41;pointer-events:none;',
}

function ensureOne(doc: Document, name: DecorationLayerName): HTMLElement {
  const existing = doc.querySelector<HTMLElement>(`[${LAYER_ATTR}="${name}"]`)
  if (existing) {
    // Never trust a previous writer's styles: re-assert invariants.
    existing.style.cssText = LAYER_STYLE[name]
    return existing
  }
  const el = doc.createElement('div')
  el.setAttribute(LAYER_ATTR, name)
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = LAYER_STYLE[name]
  doc.body.appendChild(el)
  return el
}

/**
 * Ensure all six layers exist and return their handles. Idempotent; safe to
 * call on every activation.
 */
export function ensureDecorationLayers(doc: Document): DecorationLayers {
  return {
    background: ensureOne(doc, 'background'),
    ambient: ensureOne(doc, 'ambient'),
    top: ensureOne(doc, 'top'),
    bottom: ensureOne(doc, 'bottom'),
    sidebar: ensureOne(doc, 'sidebar'),
    foreground: ensureOne(doc, 'foreground'),
  }
}

/**
 * Replace one layer's content (activation scope). Returns a teardown that
 * removes exactly the nodes this call added — idempotent, ledger-ready.
 */
export function setLayerContent(
  layer: HTMLElement,
  nodes: Iterable<Node>,
): () => void {
  const added = [...nodes]
  for (const node of added) layer.appendChild(node)
  let done = false
  return () => {
    if (done) return
    done = true
    for (const node of added) node.parentNode?.removeChild(node)
  }
}

/** Remove every node an activation left in a layer (used on dispose). */
export function clearLayer(layer: HTMLElement): void {
  while (layer.firstChild) layer.removeChild(layer.firstChild)
}

/**
 * Build the background media element for a manifest backgroundMedia layer.
 * Returns null when the theme variant has no media. The element fills the
 * background layer; the scrim (when declared) is a sibling overlay.
 */
export function buildBackgroundMedia(
  doc: Document,
  layer: { type: 'image' | 'video'; src: string; scrim?: string },
  assetBase: string,
): HTMLElement[] {
  const nodes: HTMLElement[] = []
  const fullBleed = 'position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover;'
  if (layer.type === 'image') {
    const img = doc.createElement('img')
    img.src = `${assetBase}/${layer.src}`
    img.alt = ''
    img.setAttribute('aria-hidden', 'true')
    img.style.cssText = fullBleed
    nodes.push(img)
  } else {
    const video = doc.createElement('video')
    video.src = `${assetBase}/${layer.src}`
    video.muted = true
    video.loop = true
    video.autoplay = true
    video.playsInline = true
    video.setAttribute('aria-hidden', 'true')
    video.style.cssText = fullBleed
    nodes.push(video)
  }
  if (layer.scrim) {
    const scrim = doc.createElement('div')
    scrim.setAttribute('aria-hidden', 'true')
    scrim.style.cssText = `position:absolute;inset:0;background:${layer.scrim};`
    nodes.push(scrim)
  }
  return nodes
}

/**
 * The universal scrim veil (issue #1000): a plain color layer stacked after
 * the manifest media inside the same background decoration layer, so the
 * occlusion slider darkens ANY skin's painted backdrop without each skin
 * having to consume --dsw-skin-scrim in its own token math.
 *
 * Strength rides a dedicated variable (--dsh-skin-veil, written by the
 * BackgroundController next to the legacy scrim var) instead of
 * --dsw-skin-scrim itself: that var doubles as the art-presence marker the
 * controller flips to '1' on every media mount, which would flash the veil
 * fully opaque before the user's value lands. Skins already handling occlusion
 * themselves declare contributes.backgroundSelfScrim and simply never get a
 * veil node — no double darkening.
 */
export function buildUniversalScrimVeil(doc: Document): HTMLElement {
  const veil = doc.createElement('div')
  veil.setAttribute('aria-hidden', 'true')
  veil.setAttribute('data-dsh-universal-veil', '')
  // Explicit longhands only (see LAYER_STYLE above). opacity (not alpha in
  // background) keeps the color constant while the slider only ever touches
  // one number; the var falls back to 0 so an absent writer paints nothing.
  veil.style.cssText =
    'position:absolute;top:0;right:0;bottom:0;left:0;background:#000;opacity:var(--dsh-skin-veil, 0);'
  return veil
}
