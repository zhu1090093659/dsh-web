/**
 * Matrix 骇客帝国（深夜护眼版）— a hot-pluggable client plugin in the dsh web
 * ui family. apply() sets the `data-dsh-matrix` body attribute the stylesheet
 * is scoped on, forces the dark theme flag (night-use feature, kept in place
 * by a MutationObserver), and mounts a low-opacity digital-rain canvas;
 * the effect disposer retracts every write (attribute, dark flag, canvas).
 * The CSS rides the bundle's CSS-modules auto-inject (style tag owned by the
 * loader, removed on entry dispose). No services are injected: the skin
 * needs only the DOM.
 */
import type { Context } from '@deepseek-ai/cordis'
import css from './matrix.module.css'

// The css-modules import's side effect is the auto-injected stylesheet;
// this skin styles exclusively via `body[data-dsh-matrix]` attribute
// selectors and design tokens, so the class map is intentionally unused.
void css

/** Katakana + ASCII glyphs for the digital rain (classic Matrix flavor). */
const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF'

/** Column state for the rain overlay. */
interface RainColumn {
  y: number
  speed: number
  chars: string[]
}

/**
 * Mount the low-opacity digital-rain overlay. Returns a disposer, or null
 * when the environment prefers reduced motion / has no canvas support.
 */
function mountRain(): (() => void) | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  const canvas = document.createElement('canvas')
  canvas.dataset.plugin = 'dsh-matrix-skin'
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000;opacity:.10'
  document.body.appendChild(canvas)
  const g = canvas.getContext('2d')
  if (!g) {
    canvas.remove()
    return null
  }
  const FONT = '16px Menlo,Consolas,monospace'
  let cols: RainColumn[] = []
  let w = 0
  let h = 0
  let raf = 0
  let last = 0
  const resize = () => {
    w = canvas.width = window.innerWidth
    h = canvas.height = window.innerHeight
    const n = Math.max(1, Math.floor(w / 18))
    cols = []
    for (let i = 0; i < n; i++) {
      cols.push({ y: Math.random() * -h, speed: 0.5 + Math.random() * 1.3, chars: [] })
    }
  }
  const frame = (t: number) => {
    raf = 0
    if (document.hidden) return
    if (t - last < 50) {
      raf = requestAnimationFrame(frame)
      return
    }
    last = t
    g.fillStyle = 'rgba(4,8,5,0.14)'
    g.fillRect(0, 0, w, h)
    g.font = FONT
    cols.forEach((c, i) => {
      c.y += c.speed * 16
      if (c.y > h + 40) {
        c.y = -40
        c.chars = []
      }
      c.chars.unshift(GLYPHS[(Math.random() * GLYPHS.length) | 0])
      if (c.chars.length > 14) c.chars.pop()
      const x = i * 18
      for (let j = 0; j < c.chars.length; j++) {
        g.fillStyle = j === 0 ? 'rgba(190,255,215,0.95)' : `rgba(0,230,118,${0.9 - j * 0.05})`
        g.fillText(c.chars[j], x, c.y - j * 16)
      }
    })
    raf = requestAnimationFrame(frame)
  }
  resize()
  window.addEventListener('resize', resize)
  raf = requestAnimationFrame(frame)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    canvas.remove()
  }
}

/**
 * Activate the Matrix skin: set the body marker, force the dark-theme flag
 * (night-use feature), start the rain. The disposer retracts everything.
 */
export function apply(ctx: Context): void {
  const body = document.body
  if (!body) return
  body.dataset.dshMatrix = ''
  const prevDark = body.dataset.dsDarkTheme
  body.dataset.dsDarkTheme = ''
  const attrObs = new MutationObserver(() => {
    if (body.dataset.dsDarkTheme === undefined) body.dataset.dsDarkTheme = ''
  })
  attrObs.observe(body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  let disposeRain: (() => void) | null = null
  try {
    disposeRain = mountRain()
  } catch {
    disposeRain = null
  }
  ctx.effect(() => () => {
    attrObs.disconnect()
    delete body.dataset.dshMatrix
    if (prevDark === undefined) delete body.dataset.dsDarkTheme
    else body.dataset.dsDarkTheme = prevDark
    if (disposeRain) disposeRain()
  }, 'dsh-matrix-skin: theme')
}
