/**
 * Shared mermaid renderer with LRU memoization and single-init theme tracking.
 *
 * Both the official `conversation.chat.markdown.fence` slot layer and the
 * document-preview DOM fallback render through this cache so theme switches
 * and re-mounts reuse sanitized SVG without re-parsing identical sources.
 * @module @linxin666/dsh-client-ui-diagrams/client/render
 */

import { RUNTIME_ROUTE } from '../core/contract.ts'
import { loadRuntime, type MermaidRuntime } from './runtime.ts'
import { sanitizeSvg } from './sanitize.ts'

/** How many rendered diagrams one renderer keeps for reuse (oldest evicted first). */
const CACHE_LIMIT = 32

/** Monotonic id source: mermaid keys its `<svg>` by the id it is handed. */
let renderSeq = 0

/** Options for rendering one mermaid diagram source. */
export interface RenderMermaidOptions {
  /** Same-origin route serving the vendored runtime bundle. */
  runtimeUrl?: string
  /** Runtime loader override (tests inject fakes). */
  load?: (url: string) => Promise<MermaidRuntime>
  /** Already-loaded runtime handle, skipping the loader when provided. */
  runtime?: MermaidRuntime
}

/** Stateful mermaid renderer instance (shared in production, isolated in tests). */
export interface MermaidRenderer {
  /** Read a previously rendered, sanitized SVG from the LRU cache, if present. */
  getCached(source: string, theme: string): string | undefined
  /** Initialize the runtime once per `(runtime, theme)` pair. */
  ensureInitialized(runtime: MermaidRuntime, theme: string): void
  /** Render and sanitize one mermaid source for the requested theme. */
  render(source: string, theme: string, options?: RenderMermaidOptions): Promise<string>
}

/**
 * Create a mermaid renderer owning its own LRU cache and initialization state.
 * @returns An isolated renderer instance.
 */
export function createMermaidRenderer(): MermaidRenderer {
  const painted = new Map<string, string>()
  let initialized: { runtime: MermaidRuntime; theme: string } | undefined

  const cacheKey = (theme: string, source: string): string => `${theme}\u0000${source}`

  const remember = (key: string, svg: string): void => {
    if (painted.has(key)) painted.delete(key)
    painted.set(key, svg)
    for (const oldest of painted.keys()) {
      if (painted.size <= CACHE_LIMIT) break
      painted.delete(oldest)
    }
  }

  const ensureInitialized = (runtime: MermaidRuntime, theme: string): void => {
    if (initialized?.runtime === runtime && initialized.theme === theme) return
    runtime.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      // Mermaid otherwise leaves its error diagram under body when render throws;
      // callers own the failure UI and fall back to the source block.
      suppressErrorRendering: true,
      // Labels must be SVG text: mermaid's HTML labels live in <foreignObject>,
      // which the sanitizer strips, so an HTML label renders as an empty box.
      htmlLabels: false,
      fontFamily: 'inherit',
    })
    initialized = { runtime, theme }
  }

  const getCached = (source: string, theme: string): string | undefined => painted.get(cacheKey(theme, source))

  const render = async (
    source: string,
    theme: string,
    options: RenderMermaidOptions = {},
  ): Promise<string> => {
    const key = cacheKey(theme, source)
    const cached = painted.get(key)
    if (cached !== undefined) return cached
    const runtime = options.runtime ?? await (options.load ?? loadRuntime)(options.runtimeUrl ?? RUNTIME_ROUTE)
    ensureInitialized(runtime, theme)
    const { svg } = await runtime.render(`dsh-diagrams-${(renderSeq += 1)}`, source)
    const cleaned = sanitizeSvg(svg)
    remember(key, cleaned)
    return cleaned
  }

  return { getCached, ensureInitialized, render }
}

/** Default page-wide renderer shared by the fence slot layer. */
export const sharedMermaidRenderer: MermaidRenderer = createMermaidRenderer()
