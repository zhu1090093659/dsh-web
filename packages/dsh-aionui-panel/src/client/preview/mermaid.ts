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

/**
 * Configure the mermaid runtime for the current theme. Called once per
 * render batch (enhance or retheme), not per diagram, so a surface with
 * many diagrams initializes the runtime a single time.
 */
function initializeRuntime(runtime: MermaidRuntime, theme: string): void {
  runtime.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: '"trebuchet ms", verdana, arial, sans-serif',
  })
}

/** Render one diagram source to SVG with the already-initialized runtime. */
async function renderSvg(runtime: MermaidRuntime, source: string): Promise<string> {
  const { svg } = await runtime.render(`aionui-mermaid-${(renderSeq += 1)}`, source)
  return svg
}

/** Disallowed elements removed from mermaid SVG output before innerHTML. */
const DISALLOWED_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed']

/** Whether an attribute name is an { on* } event-handler (case-insensitive). */
function isEventHandler(name: string): boolean {
  return /^on/i.test(name)
}

/** Whether an href/xlink:href value carries an executable javascript: URL. */
function isDangerousHref(value: string): boolean {
  return /^javascript:/i.test(value.trim())
}

/**
 * Application-level defense-in-depth on top of mermaid's own strict-mode
 * escaping: parse the rendered SVG in a detached container, remove disallowed
 * elements and dangerous attributes, and return the serialized cleaned markup.
 * Throws when the input cannot be parsed as markup or still carries dangerous
 * raw tokens, so callers fall back to their failure path.
 */
export function sanitizeSvg(svg: string): string {
  const template = document.createElement('template')
  template.innerHTML = svg
  const root = template.content

  // Remove disallowed elements; loop because removals can expose nested ones.
  for (let found = true; found; ) {
    found = false
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (DISALLOWED_ELEMENTS.some((tag) => el.tagName.toLowerCase() === tag.toLowerCase())) {
        el.remove()
        found = true
      }
    }
  }

  // Strip event-handler attributes and javascript: hrefs from every element.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (isEventHandler(attr.name) || isDangerousHref(attr.value)) el.removeAttribute(attr.name)
    }
  }

  const cleaned = template.innerHTML
  const lower = cleaned.toLowerCase()
  if (lower.includes('<script') || lower.includes('javascript:')) {
    throw new Error('mermaid SVG still contains dangerous tokens after sanitization')
  }
  return cleaned
}

/**
 * Collect the still-unclaimed fenced mermaid code blocks under one scope.
 * Two shapes are found (the claim always targets the <pre>):
 * 1. the panel markdown renderer's `pre.language-mermaid` and the legacy
 *    chat shape `pre > code.language-mermaid`;
 * 2. the official shell CodeBlock shape (`@deepseek-ai/dsh-client-ui-primitives`):
 *    the fence language survives only as the info-string banner text
 *    (`[class*="infostring"]` inside a `.md-code-block` wrapper), and
 *    because shiki has no mermaid grammar the body renders as a plain
 *    `<pre>` with no `language-*` class — so the block is recognized
 *    through its banner (issue #451).
 * Empty blocks and blocks another driver already claimed are skipped.
 * Pure (DOM-read only) so tests can drive it in jsdom.
 */
export function findMermaidCodeBlocks(scope: ParentNode): HTMLPreElement[] {
  const found: HTMLPreElement[] = []
  const seen = new Set<Element>()
  const consider = (pre: Element | null): void => {
    if (pre === null || !(pre instanceof HTMLPreElement)) return
    if (seen.has(pre) || pre.hasAttribute(DATA_CLAIMED)) return
    if ((pre.textContent ?? '').trim() === '') return
    seen.add(pre)
    found.push(pre)
  }
  // Shape 1: language class on the pre/code (panel markdown, legacy chat).
  for (const el of Array.from(scope.querySelectorAll('pre.language-mermaid, code.language-mermaid'))) {
    consider(el instanceof HTMLPreElement ? el : el.parentElement)
  }
  // Shape 2: shell CodeBlock — resolve the info-string banner to its <pre>.
  for (const info of Array.from(scope.querySelectorAll<HTMLElement>('[class*="infostring"]'))) {
    if ((info.textContent ?? '').trim().toLowerCase() !== 'mermaid') continue
    consider(info.closest('.md-code-block')?.querySelector('pre') ?? null)
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
  initializeRuntime(runtime, options.theme)
  const jobs: Array<Promise<void>> = []
  for (const pre of findMermaidCodeBlocks(scope)) {
    if (options.skip?.(pre) === true) continue
    const container = claimBlock(pre, options.className)
    jobs.push((async () => {
      try {
        container.setAttribute(DATA_STATE, 'rendering')
        const source = container.getAttribute(DATA_SOURCE) ?? ''
        const svg = await renderSvg(runtime, source)
        container.innerHTML = sanitizeSvg(svg)
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
  initializeRuntime(runtime, options.theme)
  const containers = Array.from(scope.querySelectorAll<HTMLElement>('[data-mermaid-state="done"]'))
  await Promise.all(containers.map(async (container) => {
    const source = container.getAttribute(DATA_SOURCE) ?? ''
    try {
      const svg = await renderSvg(runtime, source)
      container.innerHTML = sanitizeSvg(svg)
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
