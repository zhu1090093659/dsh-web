/**
 * KaTeX math enhancement for markdown surfaces: lazily loads the vendored
 * KaTeX runtime (script + stylesheet, same origin, no CDN) from the host
 * vendor route and upgrades every math placeholder the markdown renderer
 * emitted (data-aionui-math, issue #421) into typeset math in place.
 *
 * Failure policy mirrors the mermaid enhancer: any load failure leaves the
 * placeholders on their raw TeX fallback text; a per-formula render failure
 * stamps the placeholder and moves on. Nothing here throws to the caller.
 * @module dsh-aionui-panel/client/preview/katex
 */

import { DATA_MATH, DATA_MATH_SOURCE } from './markdown.ts'

/** Minimal structural type of the katex runtime this module consumes. */
interface KatexRuntime {
  render: (tex: string, element: HTMLElement, options?: KatexRenderOptions) => void
}

/** The small option surface this module passes to katex.render. */
interface KatexRenderOptions {
  displayMode?: boolean
  throwOnError?: boolean
}

/** Host-served KaTeX artifacts (lib/assets/katex/ behind the vendor route). */
export const KATEX_VENDOR_JS = '/aionui-panel/vendor/katex.js'
export const KATEX_VENDOR_CSS = '/aionui-panel/vendor/katex.css'

/** Lifecycle state stamped on placeholders (`done`/`fallback`). */
const DATA_STATE = 'data-aionui-math-state'

let loadPromise: Promise<KatexRuntime> | undefined

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

/** Inject the vendored stylesheet once per page (idempotent by href). */
function ensureKatexStylesheet(): void {
  if (document.querySelector(`link[href="${KATEX_VENDOR_CSS}"]`) !== null) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = KATEX_VENDOR_CSS
  document.head.appendChild(link)
}

/**
 * Load the katex runtime once per page: injects the stylesheet and a
 * <script> for the host vendor route, resolving with the runtime. Concurrent
 * callers share one injection; a failure clears the cache so a later
 * surface can retry.
 */
export function loadKatexLibrary(): Promise<KatexRuntime> {
  const existing = katexGlobal()
  if (existing !== null) return Promise.resolve(existing)
  if (loadPromise !== undefined) return loadPromise
  loadPromise = new Promise<KatexRuntime>((resolve, reject) => {
    ensureKatexStylesheet()
    const script = document.createElement('script')
    script.src = KATEX_VENDOR_JS
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
      reject(new Error(`failed to load ${KATEX_VENDOR_JS}`))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/**
 * Collect the still-unrendered math placeholders under one scope. Elements
 * another pass already stamped (any data-aionui-math-state) are skipped, so
 * the enhancer stays idempotent across re-renders of the same html.
 */
export function findMathPlaceholders(scope: ParentNode): HTMLElement[] {
  const found: HTMLElement[] = []
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>(`[${DATA_MATH}]`))) {
    if (el.hasAttribute(DATA_STATE)) continue
    if ((el.getAttribute(DATA_MATH_SOURCE) ?? el.textContent ?? '').trim() === '') continue
    found.push(el)
  }
  return found
}

/**
 * Typeset every unrendered math placeholder under `scope` in place. The
 * library only loads when at least one placeholder exists; a load failure
 * leaves every placeholder on its raw TeX fallback. Never rejects.
 */
export async function enhanceMathPlaceholders(scope: ParentNode): Promise<void> {
  const placeholders = findMathPlaceholders(scope)
  if (placeholders.length === 0) return
  let runtime: KatexRuntime
  try {
    runtime = await loadKatexLibrary()
  } catch {
    return // no vendor route (asset missing): keep raw TeX fallbacks
  }
  for (const el of placeholders) {
    const source = el.getAttribute(DATA_MATH_SOURCE) ?? el.textContent ?? ''
    const displayMode = el.getAttribute(DATA_MATH) === 'block'
    try {
      runtime.render(source, el, { displayMode, throwOnError: false })
      el.setAttribute(DATA_STATE, 'done')
    } catch {
      // Formula-level failure: keep the raw TeX fallback text untouched.
      el.setAttribute(DATA_STATE, 'fallback')
    }
  }
}
