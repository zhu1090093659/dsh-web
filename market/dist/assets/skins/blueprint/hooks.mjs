/**
 * Blueprint — hooks escape hatch: the two drafting HUD bars.
 *
 * Contract: x-org.linxin666.skin-center/v1alpha1.
 * No top-level side effects, no module-level mutable state, every timer and
 * listener registered through ctx.onCleanup, cleanup idempotent.
 *
 * Styling lives in patches.css (.dsh-bp-*); this module only builds DOM.
 */

const CLASS_TITLEBAR = 'dsh-bp-titlebar'
const CLASS_STATUSBAR = 'dsh-bp-statusbar'
const SHEET = '01'
const SCALE = '1:1'
const GRID = '24'

/** Drafting crosshair; inherits the bar accent through currentColor. */
const MARK_SVG = [
  '<svg class="dsh-bp-mark" viewBox="0 0 16 16" aria-hidden="true">',
  '<circle cx="8" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1"/>',
  '<path d="M8 0v5M8 11v5M0 8h5M11 8h5" stroke="currentColor" stroke-width="1"/>',
  '</svg>',
].join('')

/** Official sidebar brand slot; the shell renders the DeepSeek whale here. */
const BRAND_SLOT = '[data-slot="sidebar.brand.mark"]'
const BRAND_CLASS = 'dsh-bp-brand-mark'

/**
 * The two build-identity lines in the same row. Their own class names are
 * CSS-Modules hashes, so the skin stamps a stable attribute and styles that
 * instead (see [data-dsh-bp] in patches.css).
 */
const BUILD_TITLE = '[class*="localBuildTitle"]'
const BUILD_VERSION = '[class*="buildVersion"]'

/**
 * The shell's own DeepSeek whale silhouette, reused as a drafted line drawing:
 * a hairline stroke over a 14% fill, coloured by the skin accent through
 * currentColor (see .dsh-bp-brand-mark in patches.css). Reusing the exact
 * outline keeps the mark recognisable while the rendering matches the theme.
 */
const WHALE_D = 'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z'

const BRAND_SVG = [
  `<svg class="${BRAND_CLASS}" width="24" height="17.66" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true">`,
  `<path d="${WHALE_D}" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="0.62" stroke-linejoin="round" stroke-linecap="round"/>`,
  '</svg>',
].join('')

/** Axis triad for the status bar: X to the right, Y up. */
const AXIS_SVG = [
  '<svg class="dsh-bp-axis" viewBox="0 0 18 18" aria-hidden="true">',
  '<path d="M2 16h13M2 16V3" stroke="currentColor" stroke-width="1.1" fill="none"/>',
  '<path d="M16 16l-3.6-1.9v3.8z" fill="currentColor"/>',
  '<path d="M2 2l-1.9 3.6h3.8z" fill="currentColor"/>',
  '</svg>',
].join('')

/**
 * Theme-adapted favicon: the drafting rosette drawn on the sheet's own colour
 * — warm paper with sepia ink, or night navy with blueprint cyan. Injected as
 * a data URL, so the CSS whitelist (which only governs stylesheets) does not
 * apply.
 */
function favicon(background, ink) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    + `<rect width="32" height="32" rx="5" fill="${background}"/>`
    + `<rect x="1.7" y="1.7" width="28.6" height="28.6" rx="4" fill="none" stroke="${ink}" stroke-width="1.3" opacity="0.5"/>`
    + `<path d="M16 5.5v21M5.5 16h21" stroke="${ink}" stroke-width="1.8"/>`
    + `<circle cx="16" cy="16" r="5.2" fill="none" stroke="${ink}" stroke-width="1.8"/>`
    + '</svg>'
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const FAVICON_LIGHT = favicon('#f1e9da', '#7a6242')
const FAVICON_DARK = favicon('#08243d', '#4fd1ff')

/** A labelled readout: `<span class="dsh-bp-cell">LABEL <b>value</b></span>`. */
function cell(label, value) {
  const el = document.createElement('span')
  el.className = 'dsh-bp-cell'
  el.append(document.createTextNode(label))
  const b = document.createElement('b')
  b.textContent = value
  el.append(b)
  return { el, value: b }
}

function span(className, text) {
  const el = document.createElement('span')
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

function divider() {
  return span('dsh-bp-sep')
}

/** Local wall-clock, zero-padded, no locale dependency. */
function stamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const doc = document

      // ---------------------------------------------------------- title bar
      const titlebar = doc.createElement('div')
      titlebar.className = CLASS_TITLEBAR
      titlebar.setAttribute('aria-hidden', 'true')

      const mark = span('dsh-bp-mark')
      mark.innerHTML = MARK_SVG

      const title = span('dsh-bp-title', `DRAWING ${SHEET} — 工程蓝图`)
      const sheet = cell('SHEET', SHEET)
      const scale = cell('SCALE', SCALE)

      const titleRuler = doc.createElement('div')
      titleRuler.className = 'dsh-bp-ruler'
      titleRuler.setAttribute('aria-hidden', 'true')

      titlebar.append(
        mark,
        span('dsh-bp-id', 'DSH'),
        span('dsh-bp-badge', 'BLUEPRINT'),
        title,
        sheet.el,
        divider(),
        scale.el,
        titleRuler,
      )

      // --------------------------------------------------------- status bar
      const statusbar = doc.createElement('div')
      statusbar.className = CLASS_STATUSBAR
      statusbar.setAttribute('aria-hidden', 'true')

      const grid = cell('GRID', `${GRID}px`)
      const units = cell('UNITS', 'PX')
      const rev = cell('REV', '1.0.0')
      const posX = cell('X', '0000')
      const posY = cell('Y', '0000')
      const clock = cell('T', '--:--:--')
      const mode = cell('MODE', 'PAPER')

      const sync = span('dsh-bp-cell')
      sync.append(span('dsh-bp-dot'), doc.createTextNode('SYNC OK'))

      const axis = span('dsh-bp-axis')
      axis.innerHTML = AXIS_SVG

      const statusRuler = doc.createElement('div')
      statusRuler.className = 'dsh-bp-ruler'
      statusRuler.setAttribute('aria-hidden', 'true')

      statusbar.append(
        grid.el, divider(),
        units.el, divider(),
        rev.el, divider(),
        posX.el,
        posY.el, span('dsh-bp-spacer'),
        clock.el, span('dsh-bp-spacer'),
        mode.el, divider(),
        axis,
        sync,
        statusRuler,
      )

      doc.body.append(titlebar, statusbar)

      // ----------------------------------------------------------- favicon
      const icon = doc.createElement('link')
      icon.rel = 'icon'
      icon.type = 'image/svg+xml'
      const previousIcons = [...doc.querySelectorAll('link[rel~="icon"]')]
      for (const link of previousIcons) link.remove()
      doc.head.append(icon)

      // ------------------------------------------------- full-window backdrop
      // The illustration is drawn twice from pre-derived masks: the drafting
      // grid follows the character silhouette, and the line work sits on top
      // with a heavier outer contour. Asset URLs come from ctx.assetBase
      // because the CSS whitelist rejects absolute paths, so the mask sources
      // cannot be hard-coded in patches.css.
      const bgBase = doc.createElement('div')
      bgBase.className = 'dsh-bp-bg-base'
      bgBase.setAttribute('aria-hidden', 'true')
      const bgFill = doc.createElement('div')
      bgFill.className = 'dsh-bp-bg-fill'
      bgFill.setAttribute('aria-hidden', 'true')
      const bgLine = doc.createElement('div')
      bgLine.className = 'dsh-bp-bg-line'
      bgLine.setAttribute('aria-hidden', 'true')
      // Sheet material sits above the art: paper grain on the light sheet,
      // corner falloff and phosphor lines on the night sheet.
      const bgGrain = doc.createElement('div')
      bgGrain.className = 'dsh-bp-grain'
      bgGrain.setAttribute('aria-hidden', 'true')
      doc.body.append(bgBase, bgFill, bgLine, bgGrain)

      // Negative-z children paint UNDER body's own background, so the body's
      // opaque fill must go transparent while the backdrop is mounted — the
      // same thing the skin controller does for a backgroundMedia layer
      // (skin-controller.ts setBackgroundLayer). The base colour moves onto
      // .dsh-bp-bg-base instead.
      const previousBodyBackground = doc.body.style.getPropertyValue('background-color')
      doc.body.style.setProperty('background-color', 'transparent')

      doc.body.style.setProperty('--dsh-bp-fill-url', `url("${ctx.assetBase}/assets/whale-fill.png")`)
      doc.body.style.setProperty('--dsh-bp-line-url', `url("${ctx.assetBase}/assets/whale-line.png")`)

      // ------------------------------------------------------ theme readout
      const paintTheme = (theme) => {
        mode.value.textContent = theme === 'dark' ? 'NIGHT' : 'PAPER'
        icon.href = theme === 'dark' ? FAVICON_DARK : FAVICON_LIGHT
      }
      paintTheme(ctx.theme.get())
      const unsubscribeTheme = ctx.theme.subscribe(paintTheme)

      // --------------------- clock, paused while hidden (perf guideline R3)
      let timer = null
      const tick = () => { clock.value.textContent = stamp(new Date()) }
      const start = () => {
        if (timer !== null) return
        tick()
        timer = window.setInterval(tick, 1000)
      }
      const stop = () => {
        if (timer === null) return
        window.clearInterval(timer)
        timer = null
      }
      const onVisibility = () => {
        if (doc.visibilityState === 'hidden') stop()
        else start()
      }
      doc.addEventListener('visibilitychange', onVisibility)
      start()

      // ---------- live sheet coordinates: rAF-throttled, passive, cleaned up
      let frame = 0
      let lastX = -1
      let lastY = -1
      const onPointerMove = (event) => {
        if (frame !== 0) return
        frame = window.requestAnimationFrame(() => {
          frame = 0
          const x = Math.round(event.clientX)
          const y = Math.round(event.clientY)
          if (x === lastX && y === lastY) return
          lastX = x
          lastY = y
          posX.value.textContent = String(x).padStart(4, '0')
          posY.value.textContent = String(y).padStart(4, '0')
        })
      }
      doc.addEventListener('pointermove', onPointerMove, { passive: true })

      // ------------------------------------------ sidebar brand (redrawn)
      // The shell paints the whale as a solid glyph; blueprint redraws it as a
      // drafted line drawing. The slot is official and the original markup is
      // restored verbatim on cleanup. The observer is scoped to the brand's own
      // row and short-circuits in O(1) once our mark is in place (perf R1).
      let brandOriginalHTML = null
      let brandObserver = null

      const paintBrandRow = () => {
        // Build identity lines: stamp once, styled by [data-dsh-bp].
        const title = doc.querySelector(BUILD_TITLE)
        if (title && !title.hasAttribute('data-dsh-bp')) title.setAttribute('data-dsh-bp', 'build-title')
        const version = doc.querySelector(BUILD_VERSION)
        if (version && !version.hasAttribute('data-dsh-bp')) version.setAttribute('data-dsh-bp', 'build-version')

        const slot = doc.querySelector(BRAND_SLOT)
        if (!slot) return
        if (slot.querySelector(`.${BRAND_CLASS}`)) return
        const svg = slot.querySelector('svg')
        if (!svg) return
        if (brandOriginalHTML === null) brandOriginalHTML = svg.outerHTML
        const box = doc.createElement('div')
        box.innerHTML = BRAND_SVG
        const drawn = box.firstElementChild
        if (drawn) svg.replaceWith(drawn)
      }

      paintBrandRow()
      const brandRow = doc.querySelector(BRAND_SLOT)?.closest('button')?.parentElement
      if (brandRow) {
        brandObserver = new MutationObserver(() => { paintBrandRow() })
        brandObserver.observe(brandRow, { childList: true, subtree: true })
      }

      // ---------------------------------------------------------- teardown
      ctx.onCleanup(() => {
        doc.removeEventListener('visibilitychange', onVisibility)
        doc.removeEventListener('pointermove', onPointerMove)
        if (frame !== 0) window.cancelAnimationFrame(frame)
        stop()
        unsubscribeTheme()
        if (brandObserver) {
          brandObserver.disconnect()
          brandObserver = null
        }
        for (const el of doc.querySelectorAll('[data-dsh-bp]')) el.removeAttribute('data-dsh-bp')
        const drawn = doc.querySelector(`.${BRAND_CLASS}`)
        if (drawn) {
          if (brandOriginalHTML === null) {
            drawn.remove()
          } else {
            const box = doc.createElement('div')
            box.innerHTML = brandOriginalHTML
            const original = box.firstElementChild
            if (original) drawn.replaceWith(original)
            else drawn.remove()
          }
        }
        titlebar.remove()
        statusbar.remove()
        icon.remove()
        for (const link of previousIcons) doc.head.append(link)
        bgBase.remove()
        bgFill.remove()
        bgLine.remove()
        bgGrain.remove()
        if (previousBodyBackground === '') doc.body.style.removeProperty('background-color')
        else doc.body.style.setProperty('background-color', previousBodyBackground)
        doc.body.style.removeProperty('--dsh-bp-fill-url')
        doc.body.style.removeProperty('--dsh-bp-line-url')
        // removeProperty() leaves an empty style="" attribute behind, which
        // the built-in hooks lifecycle spec compares against the pre-activation
        // body attributes. Drop the attribute once nothing is left in it.
        if (doc.body.getAttribute('style') === '') doc.body.removeAttribute('style')
      })
    },
  }
}
