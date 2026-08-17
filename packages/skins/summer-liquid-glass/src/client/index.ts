/**
 * summer-liquid-glass skin — the 夏沫琉璃 (Summer Liquid Glass) theme, a
 * hot-pluggable client plugin for the dsh web GUI. apply() owns the whole
 * surface and retracts it on dispose: the `data-dsh-summer-liquid-glass` body
 * attribute the stylesheet is scoped on, the night-festival backdrop (WebP
 * data URL under a deep-navy readability mask; the face sits upper-center so
 * the position is anchored toward the top), the injected liquid-glass favicon,
 * and a rAF-throttled pointer sheen for large glass panels. The palette and
 * the layered glass surfaces ride the bundle's CSS-modules auto-inject (style
 * tag owned by the loader, removed on dispose). No services are injected: the
 * skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SUMMER_ART, SUMMER_ICON } from './art.ts'
import './summer-liquid-glass.module.css'

const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

const SHEEN_PROPERTIES = ['--dsw-glass-rx', '--dsw-glass-ry'] as const

/**
 * Apply the summer-liquid-glass skin: body attribute, night-art backdrop (the
 * readability mask rides the --dsw-glass-mask variable so narrow screens can
 * deepen it), favicon, and a pointer-tracked sheen. All writes are retracted
 * by the effect disposer on dispose; backdrop writes go through the hyphenated
 * CSSOM API so any prior value round-trips verbatim on restore.
 * @param ctx - owning context (the effect lifecycle owns retraction).
 */
export function apply(ctx: Context): void {
  const body = document.body
  const previous = new Map<string, string>()
  for (const prop of BACKDROP_PROPERTIES) {
    previous.set(prop, body.style.getPropertyValue(prop))
  }
  body.dataset.dshSummerLiquidGlass = ''

  // The skin-center background control writes --dsw-skin-scrim (0..1); the
  // readability mask rides --dsw-glass-mask (styled in CSS, deepened on narrow
  // screens), so both re-raster the backdrop instantly when moved.
  const backdrop = [
    'linear-gradient(rgba(7, 19, 33, var(--dsw-skin-scrim, 0)) 0%, rgba(7, 19, 33, var(--dsw-skin-scrim, 0)) 100%)',
    'linear-gradient(rgba(7, 19, 33, var(--dsw-glass-mask, 0.26)) 0%, rgba(7, 19, 33, var(--dsw-glass-mask, 0.26)) 100%)',
    `url(${SUMMER_ART})`,
  ].join(', ')
  body.style.setProperty('background-image', backdrop)
  // Face is upper-center in the art: anchor toward the top so it stays visible
  // across common window shapes without burying the fireworks at the bottom.
  body.style.setProperty('background-position', 'center 30%')
  body.style.setProperty('background-size', 'cover')
  body.style.setProperty('background-attachment', 'fixed')
  body.style.setProperty('background-repeat', 'no-repeat')

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.type = 'image/svg+xml'
  favicon.href = SUMMER_ICON
  document.head.append(favicon)

  // Subtle pointer-tracked sheen for large glass panels: rAF-throttled, two
  // custom properties only, disabled under prefers-reduced-motion. Guarded so
  // non-browser / jsdom runs (no matchMedia or rAF) skip it entirely.
  const prefersReduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches
  const canAnimate = typeof requestAnimationFrame === 'function'
  let raf = 0
  const onPointerMove = (event: PointerEvent): void => {
    if (!canAnimate || raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const width = window.innerWidth || 1
      const height = window.innerHeight || 1
      body.style.setProperty('--dsw-glass-rx', String(event.clientX / width))
      body.style.setProperty('--dsw-glass-ry', String(event.clientY / height))
    })
  }
  if (!prefersReduced && canAnimate) {
    document.addEventListener('pointermove', onPointerMove, { passive: true })
  }

  ctx.effect(() => () => {
    delete body.dataset.dshSummerLiquidGlass
    document.removeEventListener('pointermove', onPointerMove)
    if (raf) cancelAnimationFrame(raf)
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    for (const prop of SHEEN_PROPERTIES) {
      body.style.removeProperty(prop)
    }
    favicon.remove()
  }, 'ui-skin-summer-liquid-glass: liquid glass backdrop')
}
