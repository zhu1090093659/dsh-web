/**
 * whale-mom skin — the 鲸鱼妈妈 (Whale Mom) deep-sea theme, a hot-pluggable
 * client plugin for the dsh web GUI. apply() owns the whole ambient surface
 * and retracts it on dispose (the ThemePresenter retraction discipline: the
 * plugin only ever removes what it wrote): the `data-dsh-whale-mom` body
 * attribute the stylesheet is scoped on, the painting backdrop (base64 data
 * URL with a readability scrim chosen by the current theme, swapped live on
 * `data-ds-dark-theme` changes), and the injected whale-mark favicon
 * (inline SVG data URI, no static assets). The art is a text-free ambience
 * painting of a whale mother with her calf — UI text never fights the
 * background.
 * The palette remap and the translucent pane surfaces ride the bundle's
 * CSS-modules auto-inject (style tag owned by the loader, removed on entry
 * dispose). The pane opacities are driven by CSS variables that the
 * skin-center background-occlusion control feeds through
 * `--dsw-skin-scrim` (0..1), so moving the slider re-rasters the panes
 * live; the sidebar's base transparency is a CSS variable
 * (`--dsw-skin-sidebar-alpha`) for fine-tuning. No services are injected:
 * the skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import { WHALE_MOM_ART, WHALE_ICON } from './art.ts'
// The palette remap + the translucent panes (incl. the [id='root']
// transparency that lets the painting show through) ride this stylesheet;
// the bundle preset inlines it as a loader-owned <style data-plugin-css>
// tag.
import './whale-mom.module.css'

/** Light scrim: a thin cool veil over the bright art. The painting is
 *  airy (soft cream water and pale sky), so a heavy scrim would bury it;
 *  the translucent surfaces carry readability instead. Slightly stronger
 *  toward the bottom, where the mother whale's deep-blue body and the
 *  composer live. */
const SCRIM_LIGHT = [
  'linear-gradient(rgba(18, 28, 56, 0.10) 0%, rgba(20, 30, 60, 0.20) 55%, rgba(24, 34, 66, 0.30) 100%)',
].join(', ')

/** Dark scrim: a deep navy veil — the night-cruise take on the same ocean,
 *  deep enough to keep text legible while the whales still glow through. */
const SCRIM_DARK = [
  'linear-gradient(rgba(6, 10, 22, 0.42) 0%, rgba(8, 12, 26, 0.52) 60%, rgba(10, 15, 32, 0.62) 100%)',
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
 * veil is a plain gradient layered over the art in the same
 * background-image stack (never an ancestor backdrop-filter, which would
 * trap fixed-position overlays). The alpha rides a CSS variable inside the
 * gradient, so the browser re-rasterizes the backdrop live as the control
 * moves (and 0/unset keeps the stock scrim exactly — an alpha-0 layer is
 * invisible).
 */

/**
 * Apply the whale-mom skin: body attribute, painting backdrop (with a
 * live-swapping theme scrim), whale-mark favicon. All writes are retracted
 * by the effect disposer on dispose. Backdrop writes go through the
 * canonical hyphenated CSSOM API (setProperty/getPropertyValue), so any
 * prior value round-trips verbatim on restore.
 * @param ctx - owning context (the effect lifecycle owns retraction).
 */
export function apply(ctx: Context): void {
  const body = document.body
  const previous = new Map<string, string>()
  for (const prop of BACKDROP_PROPERTIES) {
    previous.set(prop, body.style.getPropertyValue(prop))
  }
  body.dataset.dshWhaleMom = ''

  const setBackdrop = (): void => {
    const dark = body.dataset.dsDarkTheme !== undefined
    const backdrop = `linear-gradient(rgba(6, 10, 22, var(--dsw-skin-scrim, 0)) 0%, rgba(6, 10, 22, var(--dsw-skin-scrim, 0)) 100%), ${dark ? SCRIM_DARK : SCRIM_LIGHT}, url(${WHALE_MOM_ART})`
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
  favicon.href = WHALE_ICON
  document.head.append(favicon)

  ctx.effect(() => () => {
    delete body.dataset.dshWhaleMom
    observer.disconnect()
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    favicon.remove()
  }, 'ui-skin-whale-mom: whale backdrop')
}