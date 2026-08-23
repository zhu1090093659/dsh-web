/**
 * War Thunder (战争雷霆 · 钢铁前线) skin hooks — the trusted escape hatch
 * of the v2 skin contract (x-org.linxin666.skin-center/v1alpha1), reviewed
 * and released with this repository. Loading this module executes nothing;
 * apply() owns every DOM write and registers its retraction through
 * ctx.onCleanup.
 *
 * Behaviors:
 *  - themed favicon: the official War Thunder launcher mark (48x48 WebP
 *    extracted read-only from the local game client launcher.ico), served
 *    from this skin's asset directory via ctx.assetBase;
 *  - pinned document title (restored on dispose only when the skin's own
 *    title still stands);
 *  - hold-to-peek (Alt): holding the Alt key anywhere sets html / body
 *    [data-dsh-wt-peek], which patches.css uses to fade the whole frosted
 *    layer stack — the conversation, sidebar and details glass over the
 *    artwork — toward transparent so the battlefield shows through;
 *    releasing restores the readable state. Both transitions are eased in
 *    CSS, so the change is never abrupt.
 *  - peek parallax: while the Alt peek is held, the overscanned artwork
 *    follows the pointer (clamped to the overscan margin, eased via rAF);
 *    releasing smoothly drifts the art back to center. Outside the peek the
 *    artwork stays put.
 * The v1 backdrop (battlefield art + theme scrim) is declarative in v2: it
 * rides contributes.backgroundMedia in skin.json, painted by the skin-center
 * — but the controller only installs the variant that matches the theme at
 * ACTIVATION time, so these hooks subscribe to theme flips and swap the
 * painted image to the other variant in place (same correction as
 * dragon-heir). When the skin-center suppresses manifest media (wallpaper
 * priority) the layer is empty and every artwork fix no-ops.
 */

/** The product title the skin pins (captured by the shell's DocumentTitle after settle). */
const SKIN_TITLE = '战争雷霆 · DeepSeek 在线'

/** Body/html attribute hooking the hold-to-peek state. */
const PEEK_ATTR = 'data-dsh-wt-peek'

/** Parallax overscan: the artwork is rendered at 108% and we may drift
 *  ±4% of the viewport before hitting the edge. Small, calm. */
const PARALLAX_MAX_X = 0.02
const PARALLAX_MAX_Y = 0.012

export default function defineSkinHooks() {
  return {
    apply(ctx) {
      const body = document.body
      const originalTitle = document.title

      const favicon = document.createElement('link')
      favicon.rel = 'icon'
      favicon.type = 'image/webp'
      favicon.href = `${ctx.assetBase}/assets/wt-icon.webp`
      document.head.append(favicon)

      // --- Background variant swap on theme flips ---------------------------
      // The controller paints the manifest variant for the activation-time
      // theme only; correct it live so light/dark each ride their own art.
      const setArtwork = () => {
        const img = ctx.layers.background.querySelector('img')
        if (img === null) return
        const dark = ctx.theme.get() === 'dark'
        const src = `${ctx.assetBase}/assets/${dark ? 'dark-art' : 'light-art'}.webp`
        if (img.getAttribute('src') !== src) img.setAttribute('src', src)
      }
      setArtwork()
      const unsubscribe = ctx.theme.subscribe(setArtwork)

      // --- Peek + parallax (Alt held): glass fades, art drifts --------------
      // The background layer carries a CSS transform transition (.wt-parallax
      // in patches.css: 0.5s cubic-bezier), so we only ever SET the target
      // transform — the browser interpolates every frame. No rAF spring, no
      // jitter: the drift glides and eases back to center on release.
      const background = ctx.layers.background
      background.classList.add('wt-parallax')

      let tx = 0
      let ty = 0
      let peeking = false
      const setPeek = (on) => {
        if (peeking === on) return
        peeking = on
        body.toggleAttribute(PEEK_ATTR, peeking)
        document.documentElement.toggleAttribute(PEEK_ATTR, peeking)
        if (!peeking) {
          // Ease the art back to center after the peek ends (CSS transition).
          background.style.transform = 'translate3d(0px, 0px, 0px)'
          tx = 0
          ty = 0
        }
      }

      const isAlt = (event) =>
        event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight' ||
        event.key === 'AltGraph'

      // Mouse follows the pointer ONLY while peeking; otherwise the
      // battlefield rests (no drift, no motion). target values are updated
      // in place; the CSS transition smooths between them.
      const onMouseMove = (event) => {
        if (!peeking) return
        const vw = window.innerWidth
        const vh = window.innerHeight
        tx = Math.max(-1, Math.min(1, (event.clientX / vw) - 0.5) * 2) * vw * PARALLAX_MAX_X
        ty = Math.max(-1, Math.min(1, (event.clientY / vh) - 0.5) * 2) * vh * PARALLAX_MAX_Y
        background.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`
      }

      const onKeyDown = (event) => {
        if (isAlt(event) && !event.repeat) setPeek(true)
      }
      const onKeyUp = (event) => {
        if (isAlt(event)) setPeek(false)
      }
      const onBlur = () => setPeek(false)

      window.addEventListener('mousemove', onMouseMove, { passive: true })
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)

      document.title = SKIN_TITLE

      ctx.onCleanup(() => {
        unsubscribe()
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('blur', onBlur)
        background.classList.remove('wt-parallax')
        background.style.removeProperty('transform')
        body.removeAttribute(PEEK_ATTR)
        document.documentElement.removeAttribute(PEEK_ATTR)
        favicon.remove()
        // Only restore when the skin's own title still stands — a session
        // title projected by the shell must not be clobbered by skin teardown.
        if (document.title === SKIN_TITLE) document.title = originalTitle
      })
    },
  }
}
