/**
 * Mermaid diagram enhancement for markdown surfaces: lazily loads the
 * mermaid runtime from the host vendor route (same origin, no CDN), renders
 * every fenced ```mermaid code block in place, and re-renders on theme
 * flips. Framework-free so both the preview panel (React effect) and the
 * chat transcript observer can drive it over disjoint DOM scopes.
 *
 * Failure policy: any load/render failure leaves the original code block
 * untouched (or restores it verbatim); nothing here throws to the caller.
 * @module dsh-aionui-panel/client/preview/mermaid
 */

/** Minimal structural type of the mermaid runtime this module consumes. */
interface MermaidRuntime {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, text: string, container?: HTMLElement) => Promise<{ svg: string }>
}

/** Host-served mermaid IIFE bundle (lib/assets/mermaid.min.js behind the route). */
export const MERMAID_VENDOR_URL = '/aionui-panel/vendor/mermaid.js'

/** Lifecycle state stamped on diagram containers (`pending`/`rendering`/`done`). */
const DATA_STATE = 'data-mermaid-state'

/** State stamped on a code block once its container exists (`claimed`). */
const DATA_CLAIMED = 'data-mermaid-claimed'

/** The verbatim diagram source kept on the container for theme re-renders. */
const DATA_SOURCE = 'data-mermaid-source'

/** Marker the preview viewer stamps on its own subtree (chat enhancement skips it). */
export const DATA_MD_SCOPE = 'data-aionui-md-scope'

let loadPromise: Promise<MermaidRuntime> | undefined

/**
 * Resolve the mermaid global left by the vendor IIFE bundle, or null while
 * absent. Narrow and defensive: the bundle is a third-party artifact.
 */
function mermaidGlobal(): MermaidRuntime | null {
  const candidate = (globalThis as Record<string, unknown>).mermaid
  if (typeof candidate !== 'object' || candidate === null) return null
  const checked = candidate as Record<string, unknown>
  if (typeof checked.initialize !== 'function' || typeof checked.render !== 'function') return null
  return checked as unknown as MermaidRuntime
}

/**
 * Load the mermaid runtime once per page: injects a <script> for the host
 * vendor route and resolves with the runtime. Concurrent callers share one
 * injection; a failure clears the cache so a later surface can retry.
 */
export function loadMermaidLibrary(): Promise<MermaidRuntime> {
  const existing = mermaidGlobal()
  if (existing !== null) return Promise.resolve(existing)
  if (loadPromise !== undefined) return loadPromise
  loadPromise = new Promise<MermaidRuntime>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = MERMAID_VENDOR_URL
    script.async = true
    script.onload = () => {
      const runtime = mermaidGlobal()
      if (runtime === null) {
        loadPromise = undefined
        reject(new Error('mermaid vendor script loaded but window.mermaid is missing'))
        return
      }
      resolve(runtime)
    }
    script.onerror = () => {
      loadPromise = undefined
      reject(new Error(`failed to load ${MERMAID_VENDOR_URL}`))
    }
    document.head.appendChild(script)
  })
  return loadPromise
}

/** Mermaid theme name for the shell theme marker (`default` or `dark`). */
export function mermaidTheme(isDark: boolean): 'default' | 'dark' {
  return isDark ? 'dark' : 'default'
}

/** Whether the shell currently carries the dark marker attribute. */
export function shellIsDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

/** Monotonic id source for render calls (mermaid keys its <svg> by id). */
let renderSeq = 0

/** Apply (or re-apply) the theme then render one diagram source to SVG. */
async function renderSvg(runtime: MermaidRuntime, theme: string, source: string): Promise<string> {
  runtime.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
  })
  const { svg } = await runtime.render(`aionui-mermaid-${(renderSeq += 1)}`, source)
  return svg
}

/**
 * Collect the still-unclaimed fenced mermaid code blocks under one scope.
 * Both shapes are found: the panel renderer's `pre.language-mermaid` and
 * the chat renderer's `pre > code.language-mermaid` (the claim always
 * targets the <pre>). Empty blocks and blocks another driver already
 * claimed are skipped. Pure (DOM-read only) so tests can drive it in jsdom.
 */
export function findMermaidCodeBlocks(scope: ParentNode): HTMLPreElement[] {
  const found: HTMLPreElement[] = []
  const seen = new Set<Element>()
  for (const el of Array.from(scope.querySelectorAll('pre.language-mermaid, code.language-mermaid'))) {
    const pre = el instanceof HTMLPreElement ? el : el.parentElement
    if (pre === null || !(pre instanceof HTMLPreElement)) continue
    if (seen.has(pre)) continue
    seen.add(pre)
    if (pre.hasAttribute(DATA_CLAIMED)) continue
    if ((pre.textContent ?? '').trim() === '') continue
    found.push(pre)
  }
  return found
}

/**
 * Swap one code block for a diagram container. The original <pre> stays in
 * the tree (hidden once the render lands) so a failure can restore it
 * verbatim; the container carries the source for theme re-renders.
 */
function claimBlock(pre: HTMLPreElement, className: string): HTMLElement {
  pre.setAttribute(DATA_CLAIMED, '1')
  const container = document.createElement('div')
  container.className = className
  container.setAttribute(DATA_STATE, 'pending')
  container.setAttribute(DATA_SOURCE, pre.textContent ?? '')
  pre.insertAdjacentElement('afterend', container)
  return container
}

/** Options for {@link enhanceMermaidBlocks}. */
export interface EnhanceOptions {
  /** Class for the diagram container (a CSS module export). */
  className: string
  /** Resolved mermaid theme name. */
  theme: string
  /** Optional extra exclusion for scopes another driver owns. */
  skip?: (pre: HTMLPreElement) => boolean
}

/**
 * Render every unclaimed ```mermaid block under `scope` into an inline SVG
 * diagram. Idempotent per block across drivers (claimed blocks are skipped);
 * failures restore the original code block. Never rejects.
 */
export async function enhanceMermaidBlocks(scope: ParentNode, options: EnhanceOptions): Promise<void> {
  let runtime: MermaidRuntime
  try {
    runtime = await loadMermaidLibrary()
  } catch {
    return // no vendor route (asset missing): keep plain code blocks
  }
  const jobs: Array<Promise<void>> = []
  for (const pre of findMermaidCodeBlocks(scope)) {
    if (options.skip?.(pre) === true) continue
    const container = claimBlock(pre, options.className)
    jobs.push((async () => {
      try {
        container.setAttribute(DATA_STATE, 'rendering')
        const source = container.getAttribute(DATA_SOURCE) ?? ''
        container.innerHTML = await renderSvg(runtime, options.theme, source)
        container.setAttribute(DATA_STATE, 'done')
        pre.style.display = 'none'
      } catch {
        // Syntax error or render failure: restore the untouched code block.
        container.remove()
        pre.removeAttribute(DATA_CLAIMED)
      }
    })())
  }
  await Promise.all(jobs)
}

/**
 * Re-render every completed diagram container under `scope` after a theme
 * flip (stored sources re-render with the new theme). Containers not in the
 * `done` state are skipped; a failure keeps the previous render.
 */
export async function rethemeMermaidBlocks(scope: ParentNode, options: { theme: string }): Promise<void> {
  const runtime = mermaidGlobal()
  if (runtime === null) return
  const containers = Array.from(scope.querySelectorAll<HTMLElement>('[data-mermaid-state="done"]'))
  await Promise.all(containers.map(async (container) => {
    const source = container.getAttribute(DATA_SOURCE) ?? ''
    try {
      container.innerHTML = await renderSvg(runtime, options.theme, source)
    } catch {
      // Keep the previous render; a theme flip must not blank diagrams.
    }
  }))
}

/**
 * One dark-marker watcher per surface: fires on body attribute flips so the
 * caller can retheme. Returns the disposer.
 */
export function watchShellTheme(onChange: (isDark: boolean) => void): () => void {
  const observer = new MutationObserver(() => { onChange(shellIsDark()) })
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  return () => { observer.disconnect() }
}
