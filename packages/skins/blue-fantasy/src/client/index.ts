/**
 * blue-fantasy skin — the "蓝色幻想" Codex desktop theme
 * (dreamskin.cc, MIT, author powerdog996) adapted for the dsh web GUI, as a
 * hot-pluggable client plugin. apply() owns the whole ambient surface and
 * retracts it on dispose (the ThemePresenter retraction discipline: the
 * plugin only ever removes what it wrote): the `data-dsh-blue-fantasy` body
 * attribute the stylesheet is scoped on, the whale-art backdrop (base64
 * data URL with a readability scrim chosen by the current theme, swapped
 * live on `data-ds-dark-theme` changes), and the injected favicon: the
 * official DeepSeek blue-whale mark (the real deepseek.com favicon,
 * rasterized to PNG — no SVG icons anywhere in the skin).
 * The palette remap and the frosted pane surfaces ride the bundle's
 * CSS-modules auto-inject (style tag owned by the loader, removed on entry
 * dispose). No services are injected: the skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import { WHALE_ART, WHALE_ICON } from './art.ts'
// The palette remap + the frosted panes (incl. the [id='root'] transparency
// that lets the whale art show through) ride this stylesheet; the bundle
// preset inlines it as a loader-owned <style data-plugin-css> tag.
import './blue-fantasy.module.css'

/** Light scrim: a thin ice veil — the art is bright pastel, so a heavy
 *  scrim would bury the subject; the translucent surfaces carry the
 *  readability instead. Slightly stronger toward the bottom, where the
 *  whale girl sits (darker art) and the composer lives. */
const SCRIM_LIGHT = [
  'linear-gradient(rgba(246, 248, 253, 0.08) 0%, rgba(240, 243, 251, 0.14) 55%, rgba(235, 239, 249, 0.2) 100%)',
].join(', ')

/** Dark scrim: a deep indigo veil — lighter than before so the whale girl
 *  stays visible under the night palette. */
const SCRIM_DARK = [
  'linear-gradient(rgba(10, 14, 28, 0.35) 0%, rgba(13, 18, 34, 0.45) 60%, rgba(16, 22, 42, 0.5) 100%)',
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
 * --dsw-skin-scrim (0..1) written to document.body by the skin center. An
 * ancestor backdrop-filter is deliberately not used (it would trap
 * fixed-position overlays); instead the veil is a plain gradient layered
 * over the art in the same background-image stack. The alpha rides a CSS
 * variable inside the gradient, so the browser re-rasterizes the backdrop
 * live as the control moves — no JS wiring needed.
 */

/**
 * Apply the blue-fantasy skin: body attribute, whale-art backdrop (with a
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
  body.dataset.dshBlueFantasy = ''

  const setBackdrop = (): void => {
    const dark = body.dataset.dsDarkTheme !== undefined
    // The skin-center background control writes --dsw-skin-scrim (0..1); the
    // variable rides inside the veil gradient's alpha, so moving the control
    // re-rasters the backdrop instantly (and 0/unset keeps the stock scrim
    // exactly — an alpha-0 layer is invisible).
    const backdrop = `linear-gradient(rgba(16, 22, 42, var(--dsw-skin-scrim, 0)) 0%, rgba(16, 22, 42, var(--dsw-skin-scrim, 0)) 100%), ${dark ? SCRIM_DARK : SCRIM_LIGHT}, url(${WHALE_ART})`
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
    delete body.dataset.dshBlueFantasy
    observer.disconnect()
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    favicon.remove()
  }, 'ui-skin-blue-fantasy: whale backdrop')
}
