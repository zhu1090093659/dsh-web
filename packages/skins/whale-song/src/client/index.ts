/**
 * whale-song skin — the《鲸吟》(Whale Song) deep-sea whale-goddess theme,
 * a hot-pluggable client plugin for the dsh web GUI. apply() owns the whole
 * ambient surface and retracts it on dispose (the ThemePresenter retraction
 * discipline: the plugin only ever removes what it wrote): the
 * `data-dsh-whale-song` body attribute the stylesheet is scoped on, the
 * ocean-art backdrop (base64 data URL with a readability scrim chosen by
 * the current theme, swapped live on `data-ds-dark-theme` changes), and the
 * injected favicon: the official DeepSeek blue-whale mark (the real
 * deepseek.com favicon, rasterized to PNG — no SVG icons anywhere in the
 * skin). The backdrop art is a text-free ambience painting in the spirit of
 * the concept art — the poster copy (DEEPSEEK / 鲸吟·深寻 / ARCHIVE) was
 * regenerated away so UI text never fights the background.
 * The palette remap and the frosted pane surfaces ride the bundle's
 * CSS-modules auto-inject (style tag owned by the loader, removed on entry
 * dispose). No services are injected: the skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import { WHALE_ART, WHALE_ICON } from './art.ts'
// The palette remap + the frosted panes (incl. the [id='root'] transparency
// that lets the ocean art show through) ride this stylesheet; the bundle
// preset inlines it as a loader-owned <style data-plugin-css> tag.
import './whale-song.module.css'

/** Light scrim: the thinnest ice veil. The art is bright and airy (the
 *  right half is near-white open water), so a heavy scrim would bury the
 *  painting; the translucent surfaces carry readability instead. Slightly
 *  stronger toward the bottom, where the whale pod swims (darker art) and
 *  the composer lives. */
const SCRIM_LIGHT = [
  'linear-gradient(rgba(240, 246, 252, 0.05) 0%, rgba(234, 241, 250, 0.11) 55%, rgba(228, 237, 249, 0.16) 100%)',
].join(', ')

/** Dark scrim: a deep navy veil — the night-cruise take on the same ocean,
 *  deep enough to keep text legible while the whales still glow through. */
const SCRIM_DARK = [
  'linear-gradient(rgba(6, 14, 36, 0.38) 0%, rgba(9, 19, 45, 0.48) 60%, rgba(13, 26, 58, 0.55) 100%)',
].join(', ')

const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/**
 * The occlusion the skin-center background control requests: the value of
 * --dsw-skin-scrim (0..1) written to document.body by the skin center. The
 * veil is a plain gradient layered over the art in the same background-image
 * stack (never an ancestor backdrop-filter, which would trap fixed-position
 * overlays). The alpha rides a CSS variable inside the gradient, so the
 * browser re-rasterizes the backdrop live as the control moves.
 */

/**
 * Apply the whale-song skin: body attribute, ocean-art backdrop (with a
 * live-swapping theme scrim), favicon. All writes are retracted by the
 * effect disposer on dispose. Backdrop writes go through the canonical
 * hyphenated CSSOM API (setProperty/getPropertyValue), so any prior value
 * round-trips verbatim on restore.
 * @param ctx - owning context (the effect lifecycle owns retraction).
 */
export function apply(ctx: Context): void {
  const body = document.body
  const previous = new Map<string, string>()
  for (const prop of BACKDROP_PROPERTIES) {
    previous.set(prop, body.style.getPropertyValue(prop))
  }
  body.dataset.dshWhaleSong = ''

  const setBackdrop = (): void => {
    const dark = body.dataset.dsDarkTheme !== undefined
    // The skin-center background control writes --dsw-skin-scrim (0..1); the
    // variable rides inside the veil gradient's alpha, so moving the control
    // re-rasters the backdrop instantly (and 0/unset keeps the stock scrim
    // exactly — an alpha-0 layer is invisible).
    const backdrop = `linear-gradient(rgba(6, 14, 36, var(--dsw-skin-scrim, 0)) 0%, rgba(6, 14, 36, var(--dsw-skin-scrim, 0)) 100%), ${dark ? SCRIM_DARK : SCRIM_LIGHT}, url(${WHALE_ART})`
    body.style.setProperty('background-image', backdrop)
    body.style.setProperty('background-position', 'center')
    body.style.setProperty('background-size', 'cover')
    body.style.setProperty('background-attachment', 'fixed')
    body.style.setProperty('background-repeat', 'no-repeat')
  }
  setBackdrop()

  // Swap the scrim live when the base theme system flips dark/light.
  const observer = new MutationObserver(setBackdrop)
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.type = 'image/png'
  favicon.href = WHALE_ICON
  document.head.append(favicon)

  ctx.effect(() => () => {
    delete body.dataset.dshWhaleSong
    observer.disconnect()
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    favicon.remove()
  }, 'ui-skin-whale-song: ocean backdrop')
}
