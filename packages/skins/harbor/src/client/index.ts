/**
 * harbor skin — the 夕港 (Harbor) dusk-harbor theme, a hot-pluggable client
 * plugin for the dsh web GUI. apply() owns the whole dusk surface and
 * retracts it on dispose (the ThemePresenter retraction discipline: the
 * plugin only ever removes what it wrote): the `data-dsh-harbor` body
 * attribute the stylesheet is scoped on, the harbor-art backdrop (base64
 * data URL with a readability scrim chosen by the current theme, swapped
 * live on `data-ds-dark-theme` changes), and an injected harbor favicon
 * (inline SVG: navy square, sunset-orange sun, dark water). The palette
 * remap and the translucent pane surfaces ride the bundle's CSS-modules
 * auto-inject (style tag owned by the loader, removed on entry dispose).
 * No services are injected: the skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import { HARBOR_ART } from './art.ts'
// The palette remap + the pane transparency (incl. the [id='root'] reset
// that lets the harbor art show through) ride this stylesheet; the bundle
// preset inlines it as a loader-owned <style data-plugin-css> tag.
import './harbor.module.css'

/** Light scrim: a thin twilight haze. The dusk palette stays, but the art
 *  reads brighter so the UI keeps its evening harbor mood without burying
 *  the painting. */
const SCRIM_LIGHT = [
  'linear-gradient(rgba(20, 26, 46, 0.08) 0%, rgba(20, 26, 46, 0.16) 55%, rgba(20, 26, 46, 0.22) 100%)',
].join(', ')

/** Dark scrim: a deeper dusk veil — the same harbor at night, dark enough
 *  to keep text legible while the sunset still glows through. */
const SCRIM_DARK = [
  'linear-gradient(rgba(11, 14, 26, 0.42) 0%, rgba(12, 16, 30, 0.52) 60%, rgba(14, 18, 34, 0.6) 100%)',
].join(', ')

const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/** Harbor favicon: navy rounded square, sunset sun above dark water. */
const HARBOR_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">',
    '<rect width="64" height="64" rx="12" fill="#141a2e"/>',
    '<circle cx="32" cy="24" r="10" fill="#ff9d5c"/>',
    '<path d="M0 38 L64 38 L64 64 L0 64 Z" fill="#222b4a"/>',
    '<path d="M0 44 L20 44 L29 51 L38 43 L50 50 L64 44 L64 64 L0 64 Z" fill="#141a2e"/>',
    '</svg>',
  ].join(''),
)}`

/**
 * Apply the harbor skin: body attribute, harbor-art backdrop (with a
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
  body.dataset.dshHarbor = ''

  const setBackdrop = (): void => {
    const dark = body.dataset.dsDarkTheme !== undefined
    // The skin-center background control writes --dsw-skin-scrim (0..1); the
    // variable rides inside the veil gradient's alpha, so moving the control
    // re-rasters the backdrop instantly (and 0/unset keeps the stock scrim).
    const backdrop = `linear-gradient(rgba(11, 14, 26, var(--dsw-skin-scrim, 0)) 0%, rgba(11, 14, 26, var(--dsw-skin-scrim, 0)) 100%), ${dark ? SCRIM_DARK : SCRIM_LIGHT}, url(${HARBOR_ART})`
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
  favicon.type = 'image/svg+xml'
  favicon.href = HARBOR_ICON
  document.head.append(favicon)

  ctx.effect(() => () => {
    delete body.dataset.dshHarbor
    observer.disconnect()
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    favicon.remove()
  }, 'ui-skin-harbor: harbor backdrop')
}
