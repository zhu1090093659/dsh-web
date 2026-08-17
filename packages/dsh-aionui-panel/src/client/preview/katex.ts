/**
 * KaTeX math enhancement for markdown surfaces: lazily loads the KaTeX
 * runtime and stylesheet from the host vendor routes (same origin, no CDN),
 * renders every `$$...$$` block and `$...$` inline placeholder emitted by
 * the markdown renderer in place, and keeps the raw TeX as the element's
 * text so any load/render failure degrades to the source text verbatim —
 * nothing here throws to the caller. Theme-independent: KaTeX glyph colors
 * inherit currentColor, so no re-render is needed on shell theme flips.
 * @module dsh-aionui-panel/client/preview/katex
 */

/** Minimal structural type of the KaTeX runtime this module consumes. */
interface KatexRuntime {
  render: (tex: string, element: HTMLElement, options: Record<string, unknown>) => void
}

/** Host-served KaTeX IIFE bundle and stylesheet (lib/assets/katex behind the routes). */
export const KATEX_JS_URL = '/aionui-panel/vendor/katex.js'
export const KATEX_CSS_URL = '/aionui-panel/vendor/katex.css'

/** Class names the markdown renderer stamps on math placeholders. */
export const KATEX_BLOCK_CLASS = 'katex-block'
export const KATEX_INLINE_CLASS = 'katex-inline'

/** Lifecycle state stamped on a placeholder once its render is claimed. */
const DATA_CLAIMED = 'data-katex-claimed'

/** Marker stamped on a placeholder whose KaTeX render landed. */
const DATA_DONE = 'data-katex-done'

/** Marker the preview viewer stamps on its own subtree (chat enhancement skips it). */
export const DATA_MD_SCOPE = 'data-aionui-md-scope'

let loadPromise: Promise<KatexRuntime> | undefined
let cssInjected = false

/**
 * Resolve the katex global left by the vendor IIFE bundle, or null while
 * absent. Narrow and defensive: the bundle is a third-party artifact.
 */
function katexGlobal(): KatexRuntime | null {
  const candidate = (globalThis as Record<string, unknown>).katex
  if (typeof candidate !== 'object' || candidate === null) return null
  const checked = candidate as Record<string, unknown>
  if (typeof checked.render !== 'function') return null
  return checked as unknown as KatexRuntime
}

/**
 * Load the KaTeX runtime once per page: injects the stylesheet link (best
 * effort — a missing CSS degrades glyph layout, never the render itself) and
 * a <script> for the host vendor route, resolving with the runtime.
 * Concurrent callers share one injection; a failure clears the cache so a
 * later surface can retry.
 */
export function loadKatexLibrary(): Promise<KatexRuntime> {
  const existing = katexGlobal()
  if (existing !== null) return Promise.resolve(existing)
  if (loadPromise !== undefined) return loadPromise
  if (!cssInjected && typeof document !== 'undefined') {
    cssInjected = true
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = KATEX_CSS_URL
    document.head.appendChild(link)
  }
  loadPromise = new Promise<KatexRuntime>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = KATEX_JS_URL
    script.async = true
    script.onload = () => {
      const runtime = katexGlobal()
      if (runtime === null) {
        loadPromise = undefined
        reject(new Error('katex vendor script loaded but window.katex is missing'))
        return
      }
      resolve(runtime)
    }
    script.onerror = () => {
      loadPromise = undefined
      reject(new Error(`failed to load ${KATEX_JS_URL}`))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/**
 * Collect the still-unclaimed math placeholders under one scope. Empty
 * placeholders and ones another driver already claimed are skipped. Pure
 * (DOM-read only) so tests can drive it in jsdom.
 */
export function findKatexMath(scope: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = []
  const seen = new Set<Element>()
  for (const el of Array.from(scope.querySelectorAll(`.${KATEX_BLOCK_CLASS}, .${KATEX_INLINE_CLASS}`))) {
    if (!(el instanceof HTMLElement)) continue
    if (seen.has(el)) continue
    seen.add(el)
    if (el.hasAttribute(DATA_CLAIMED)) continue
    if ((el.textContent ?? '').trim() === '') continue
    found.push(el)
  }
  return found
}

/**
 * Render every unclaimed math placeholder under `scope` with KaTeX. Block
 * placeholders render in display mode, inline ones in inline mode; a
 * render error leaves the raw TeX text in place and un-claims the element so
 * a later surface can retry. Never rejects.
 */
export async function enhanceKatexMath(scope: ParentNode): Promise<void> {
  let runtime: KatexRuntime
  try {
    runtime = await loadKatexLibrary()
  } catch {
    return // no vendor route (asset missing): keep plain TeX text
  }
  for (const el of findKatexMath(scope)) {
    el.setAttribute(DATA_CLAIMED, '1')
    const displayMode = el.classList.contains(KATEX_BLOCK_CLASS)
    try {
      runtime.render(el.textContent ?? '', el, {
        displayMode,
        throwOnError: true,
        strict: false,
        trust: false,
      })
      el.setAttribute(DATA_DONE, '1')
    } catch {
      // Syntax error or hostile input: the raw TeX text is still in place,
      // so just release the claim and keep the degradation.
      el.removeAttribute(DATA_CLAIMED)
    }
  }
}
