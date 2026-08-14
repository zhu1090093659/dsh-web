/**
 * Miku skin — Hatsune Miku electronic-idol theme for the dsh web GUI.
 * apply() owns the whole surface and retracts it on dispose (the
 * ThemePresenter retraction discipline: the plugin only ever removes what it
 * wrote): the `data-dsh-miku` body attribute the stylesheet is scoped on,
 * the idol backdrop (an original teal-ponytail art with a readability scrim
 * chosen by the current theme, swapped live on `data-ds-dark-theme`
 * changes), the title bar (note icon + 01 badge + window glyphs), the status
 * bar (waveform + status cells), the injected favicon, and the document
 * title. The CSS rides the bundle's CSS-modules auto-inject (style tag owned
 * by the loader, removed on entry dispose). No services are injected: the
 * skin needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import css from './miku.module.css'
import { MIKU_ART } from './art.ts'

/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
const SKIN_TITLE = '初音未来 · DeepSeek 在线'

/** Status bar cells; the spacer cell splits left and right groups. */
const STATUS_CELLS = ['MIKU 01', '声库就绪', '已连接', '在线', 'VOCALOID 正式版'] as const

/** Title bar window buttons (decorative glyphs, aria-hidden). */
const TITLEBAR_GLYPHS = ['–', '□', '×'] as const

/**
 * Resolve one module class name. The css-modules record types as
 * `string | undefined` under noUncheckedIndexedAccess; every key used here
 * is a literal name in this package's own stylesheet, so the fallback is
 * unreachable in practice and only satisfies the indexed-access type.
 */
const cls = (name: keyof typeof css): string => css[name] ?? ''

/** Miku note mark (a single eighth note), inline so the skin carries no static assets. */
const NOTE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">',
  '<path d="M32 8v20.6a8 8 0 1 1-4-6.9V13.4L20 16.8v17.8a8 8 0 1 1-4-6.9V12.2c0-.9.6-1.7 1.5-1.9l16-4.4c1-.3 2 .3 2.5 1.1.3.5.5 1 .5 1.5z" fill="#2e9bff"/>',
  '<ellipse cx="24" cy="44" rx="7.5" ry="2.4" fill="rgba(0,0,0,0.18)"/>',
  '</svg>',
].join('')

/** Miku "01" badge: the iconic unit number on a rounded teal chip. */
const BADGE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="18" viewBox="0 0 68 36" aria-hidden="true">',
  '<rect x="1" y="1" width="66" height="34" rx="8" fill="rgba(57,197,187,0.16)" stroke="#2e9bff" stroke-width="2"/>',
  '<text x="34" y="25" text-anchor="middle" font-family="Consolas, monospace" font-size="19" font-weight="700" fill="#1e6fd9">01</text>',
  '</svg>',
].join('')

/** Favicon: teal rounded square with a white eighth note. */
const FAVICON_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">',
  '<rect x="2" y="2" width="60" height="60" rx="14" fill="#2e9bff"/>',
  '<path d="M42 14v24.6a10 10 0 1 1-5-8.7V20.6l-15 4.1v21.7a10 10 0 1 1-5-8.7V15.4c0-1 .7-2 1.7-2.2l19-5.2c1.2-.3 2.4.4 2.9 1.4.3.6.4 1.1.4 1.6z" fill="#fff"/>',
  '</svg>',
].join('')

/** Light scrim: the thinnest blue-tinted veil. The art is bright and airy,
 *  so a heavy scrim would bury the idol; the translucent surfaces carry
 *  readability instead. */
const SCRIM_LIGHT = [
  'linear-gradient(rgba(240, 248, 255, 0.02) 0%, rgba(234, 242, 255, 0.05) 55%, rgba(228, 238, 255, 0.08) 100%)',
].join(', ')

/** Dark scrim: a very light blue veil — the user's art is already a deep
 *  dark scene, so only a whisper of tint is needed to keep text legible
 *  while the picture stays vivid. */
const SCRIM_DARK = [
  'linear-gradient(rgba(4, 10, 28, 0.12) 0%, rgba(6, 14, 36, 0.16) 60%, rgba(8, 18, 42, 0.18) 100%)',
].join(', ')

const BACKDROP_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-attachment',
  'background-repeat',
] as const

/**
 * Apply the Miku skin: body attribute, idol backdrop (with a live-swapping
 * theme scrim), title bar, status bar, favicon, title. All writes are
 * retracted by the effect disposer on dispose. Backdrop writes go through
 * the canonical hyphenated CSSOM API (setProperty/getPropertyValue), so any
 * prior value round-trips verbatim on restore.
 * @param ctx - owning context (the effect lifecycle owns retraction).
 */
export function apply(ctx: Context): void {
  const body = document.body
  const originalTitle = document.title
  const previous = new Map<string, string>()
  for (const prop of BACKDROP_PROPERTIES) {
    previous.set(prop, body.style.getPropertyValue(prop))
  }
  body.dataset.dshMiku = ''

  const setBackdrop = (): void => {
    const dark = body.dataset.dsDarkTheme !== undefined
    body.style.setProperty('background-image', `${dark ? SCRIM_DARK : SCRIM_LIGHT}, url(${MIKU_ART})`)
    body.style.setProperty('background-position', 'center')
    body.style.setProperty('background-size', 'cover')
    body.style.setProperty('background-attachment', 'fixed')
    body.style.setProperty('background-repeat', 'no-repeat')
  }
  setBackdrop()

  // Swap the scrim live when the base theme system flips dark/light.
  const observer = new MutationObserver(setBackdrop)
  observer.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

  const titlebar = document.createElement('div')
  titlebar.className = cls('mikuTitlebar')
  titlebar.dataset.skinChrome = 'titlebar'
  const icon = document.createElement('span')
  icon.className = cls('mikuTitlebarIcon')
  icon.innerHTML = NOTE_SVG
  const badge = document.createElement('span')
  badge.className = cls('mikuTitlebarBadge')
  badge.innerHTML = BADGE_SVG
  const title = document.createElement('span')
  title.className = cls('mikuTitlebarTitle')
  title.textContent = SKIN_TITLE
  titlebar.append(icon, badge, title)
  for (const glyph of TITLEBAR_GLYPHS) {
    const btn = document.createElement('span')
    btn.className = cls('mikuTitlebarBtn')
    btn.setAttribute('aria-hidden', 'true')
    btn.textContent = glyph
    titlebar.append(btn)
  }

  const statusbar = document.createElement('div')
  statusbar.className = cls('mikuStatusbar')
  statusbar.dataset.skinChrome = 'statusbar'
  const wave = document.createElement('span')
  wave.className = cls('mikuStatusbarWave')
  wave.innerHTML = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="12" viewBox="0 0 72 12" aria-hidden="true">',
    '<path d="M1 6h3l2-4 2 8 2-9 2 6 2-3 2 5 2-7 2 4 2-2 2 3 2-6 2 7 2-5 2 4 2-3 2 2 2-4 2 3 2-2 2 1 2-3 2 2 2-1 2 2 2-4 2 2 2-1 2 1 2-2 2 2 2-1 1 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg>',
  ].join('')
  const spacer = document.createElement('span')
  spacer.className = cls('mikuStatusbarSpacer')
  statusbar.append(wave, spacer)
  for (const cell of STATUS_CELLS) {
    const el = document.createElement('span')
    el.className = cls('mikuStatusbarCell')
    el.textContent = cell
    statusbar.append(el)
  }

  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.href = `data:image/svg+xml;utf8,${encodeURIComponent(FAVICON_SVG)}`
  document.head.append(favicon)

  document.title = SKIN_TITLE
  body.append(titlebar, statusbar)

  ctx.effect(() => () => {
    delete body.dataset.dshMiku
    observer.disconnect()
    for (const [prop, value] of previous) {
      body.style.setProperty(prop, value)
    }
    titlebar.remove()
    statusbar.remove()
    favicon.remove()
    // Only restore when the skin's own title still stands — a session title
    // projected by the shell must not be clobbered by skin teardown.
    if (document.title === SKIN_TITLE) document.title = originalTitle
  }, 'ui-skin-miku: Miku chrome')
}
