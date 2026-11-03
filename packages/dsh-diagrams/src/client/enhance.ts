/**
 * The DOM enhancement: watch the page for markdown code blocks whose fence
 * language is `mermaid`, render each one with the vendored runtime, and keep
 * the diagrams in step with the shell theme.
 *
 * Why an observer instead of a render hook: the official markdown renderer has
 * no code-block extension seam (see the Agent Note), so the only integration
 * point is its output DOM. The observer is scoped to mutated subtrees (mapped to
 * the owning code block) and coalesced to one animation frame per batch, so a
 * long streaming transcript never re-scans the whole document.
 *
 * Cost control: mermaid parses and lays out synchronously on the page's main
 * thread, so the work here is scheduled rather than fired at once. Diagrams are
 * painted one per frame (a document with twelve diagrams stays scrollable while
 * they land), the sanitized SVG is memoized per theme and source (a palette
 * flip back, or a host re-render that re-claims a block, costs nothing), the
 * runtime is initialized only when the palette actually changes, and a fence the
 * parser rejects is never retried with the same source — its own rollback
 * mutates the DOM, so retrying on every mutation would spin the page forever.
 *
 * Failure policy: every failure restores the untouched code block — a missing
 * runtime, a half-streamed fence, or a diagram the parser rejects never leaves a
 * broken node behind and never throws into the caller.
 * @module @linxin666/dsh-client-ui-diagrams/client/enhance
 */

import { CODE_BLOCK_CLASS, DIAGRAM_CLASS, DATA_STATE, RUNTIME_ROUTE } from '../core/contract.ts'
import { claimBlock, findMermaidBlocks, finishedContainers, hideSourceBlock, restoreBlock } from './blocks.ts'
import { loadRuntime, type MermaidRuntime } from './runtime.ts'
import { sanitizeSvg } from './sanitize.ts'
import { mermaidTheme, shellIsDark, watchTheme } from './theme.ts'

/** Options for {@link startEnhancement} (tests override the loader and root). */
export interface EnhancementOptions {
  /** Same-origin route serving the runtime bundle. */
  runtimeUrl?: string
  /** Observation root; defaults to `document.body`. */
  root?: HTMLElement
  /** Runtime loader override; defaults to the script-injecting loader. */
  load?: (url: string) => Promise<MermaidRuntime>
}

/** Monotonic id source: mermaid keys its `<svg>` by the id it is handed. */
let renderSeq = 0

/** How many rendered diagrams one page keeps for reuse (oldest is evicted first). */
const CACHE_LIMIT = 32

/** Quiet period before a fence whose source changed since its last rejection retries. */
const RETRY_DELAY_MS = 400

/**
 * Map one mutation batch to the minimal DOM scopes that can hold a new fence.
 * Removal-only records contribute nothing (removing a node never introduces a
 * block), and records inside an already-rendered figure are ignored so writing
 * the sanitized SVG cannot re-trigger the pass.
 * @param records - The batch the observer delivered.
 * @returns Connected elements to scan, deduped by identity.
 */
export function scopesForRecords(records: MutationRecord[]): Element[] {
  const scopes = new Set<Element>()
  const consider = (element: Element | null): void => {
    if (element === null || !element.isConnected) return
    if (element.closest(`.${DIAGRAM_CLASS}`) !== null) return
    scopes.add(element.closest(`.${CODE_BLOCK_CLASS}`) ?? element)
  }
  for (const record of records) {
    if (record.addedNodes.length === 0) continue
    if (record.target instanceof Element) consider(record.target)
    for (const node of Array.from(record.addedNodes)) {
      consider(node instanceof Element ? node : node.parentElement)
    }
  }
  return [...scopes]
}

/** The mermaid palette the shell currently asks for. */
function currentTheme(): string {
  return mermaidTheme(shellIsDark())
}

/** Upper bound on one scheduling hop, so a throttled tab cannot stall the queue. */
const FRAME_BACKSTOP_MS = 48

/**
 * Run one callback on the next frame, or after a short timeout when frames do
 * not arrive (a hidden tab throttles `requestAnimationFrame` to nothing).
 * @param run - The callback to run once.
 * @returns The cancelling callback: runs (or marks) the callback once only.
 */
function afterNextFrame(run: () => void): () => void {
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const once = (): void => {
    if (done) return
    done = true
    if (timer !== undefined) clearTimeout(timer)
    if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    run()
  }
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(once)
  timer = setTimeout(once, FRAME_BACKSTOP_MS)
  return once
}

/** Let the page paint between two diagrams so a long document stays responsive. */
function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => { afterNextFrame(() => { resolve() }) })
}

/**
 * Start the enhancement and return its disposer.
 *
 * The first pass scans the whole observation root (the transcript usually
 * mounted before this plugin), then only mutated subtrees are scanned. A theme
 * flip repaints every finished diagram from its stored source.
 * @param options - Root, route and loader overrides.
 * @returns Disposer: disconnect the observer, stop the theme watch, drop timers.
 */
export function startEnhancement(options: EnhancementOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {}
  const root = options.root ?? document.body
  const runtimeUrl = options.runtimeUrl ?? RUNTIME_ROUTE
  const load = options.load ?? loadRuntime

  let disposed = false
  /** Cancels the queued flush, while one is scheduled. */
  let cancelFlush: (() => void) | undefined
  const queued = new Set<Element>()

  /** Sanitized SVG per `theme + source`, oldest entry evicted past the limit. */
  const painted = new Map<string, string>()
  /** The source that last made a block fail; the same source is never retried. */
  const rejected = new WeakMap<HTMLPreElement, string>()
  /** Pending quiet-period retries, cleared on dispose. */
  const retries = new Set<ReturnType<typeof setTimeout>>()
  /** The runtime and palette the shared runtime was last initialized for. */
  let initialized: { runtime: MermaidRuntime; theme: string } | undefined

  /** Remember one rendered diagram, evicting the oldest entry past the limit. */
  const remember = (key: string, svg: string): void => {
    if (painted.has(key)) painted.delete(key)
    painted.set(key, svg)
    for (const oldest of painted.keys()) {
      if (painted.size <= CACHE_LIMIT) break
      painted.delete(oldest)
    }
  }

  /** Apply the runtime options once per runtime and palette (mermaid re-inits are expensive). */
  const ensureInitialized = (runtime: MermaidRuntime, theme: string): void => {
    if (initialized?.runtime === runtime && initialized.theme === theme) return
    runtime.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'strict',
      // Labels must be SVG text: mermaid's HTML labels live in <foreignObject>,
      // which the sanitizer strips, so an HTML label renders as an empty box.
      htmlLabels: false,
      fontFamily: 'inherit',
    })
    initialized = { runtime, theme }
  }

  /**
   * Paint one claimed container, reusing a memoized diagram when possible.
   * @param container - The container claimed for this fence.
   * @param runtime - Loaded mermaid runtime.
   * @param theme - Palette the diagram must be painted for.
   * @returns The sanitized SVG for that container.
   */
  const paint = async (container: HTMLElement, runtime: MermaidRuntime, theme: string): Promise<string> => {
    const source = container.getAttribute('data-diagram-source') ?? ''
    const key = `${theme}\u0000${source}`
    const cached = painted.get(key)
    if (cached !== undefined) return cached
    const { svg } = await runtime.render(`dsh-diagrams-${(renderSeq += 1)}`, source)
    const cleaned = sanitizeSvg(svg)
    remember(key, cleaned)
    return cleaned
  }

  /**
   * Retry one fence after the quiet period, but only when its source changed:
   * the source that already failed is final until the fence grows.
   * @param pre - The source block whose render was rejected.
   */
  const scheduleRetry = (pre: HTMLPreElement): void => {
    const timer = setTimeout(() => {
      retries.delete(timer)
      if (disposed || !pre.isConnected || pre.hasAttribute('data-diagram-claimed')) return
      if (rejected.get(pre) === (pre.textContent ?? '')) return
      void (async () => {
        let runtime: MermaidRuntime
        try {
          runtime = await load(runtimeUrl)
        } catch {
          return // A vendor route that cannot answer leaves the fence as an ordinary block.
        }
        if (disposed || !pre.isConnected || pre.hasAttribute('data-diagram-claimed')) return
        const theme = currentTheme()
        ensureInitialized(runtime, theme)
        await renderBlock(pre, runtime, theme)
      })()
    }, RETRY_DELAY_MS)
    retries.add(timer)
  }

  /**
   * Render one source block in place, restoring it on any failure.
   * @param pre - The fence's source block.
   * @param runtime - Loaded mermaid runtime.
   * @param theme - Palette to paint for.
   */
  const renderBlock = async (pre: HTMLPreElement, runtime: MermaidRuntime, theme: string): Promise<void> => {
    const container = claimBlock(pre)
    try {
      container.setAttribute(DATA_STATE, 'rendering')
      const cleaned = await paint(container, runtime, theme)
      if (disposed || !container.isConnected) return
      container.innerHTML = cleaned
      container.setAttribute(DATA_STATE, 'done')
      hideSourceBlock(pre)
    } catch {
      // Syntax error, missing runtime support or a half-streamed fence: put the
      // code block back untouched and never retry this exact source again.
      const source = container.getAttribute('data-diagram-source') ?? ''
      restoreBlock(pre, container)
      rejected.set(pre, source)
      scheduleRetry(pre)
    }
  }

  /** Render every unclaimed mermaid block under one scope, one diagram per frame. */
  const enhanceScope = async (scope: ParentNode, runtime: MermaidRuntime, theme: string): Promise<void> => {
    const blocks = findMermaidBlocks(scope).filter(pre => rejected.get(pre) !== (pre.textContent ?? ''))
    if (blocks.length === 0) return
    ensureInitialized(runtime, theme)
    for (const pre of blocks) {
      if (disposed) return
      if (!pre.isConnected || pre.hasAttribute('data-diagram-claimed')) continue
      // oxlint-disable-next-line eslint/no-await-in-loop -- one diagram per frame is the point of this loop.
      await renderBlock(pre, runtime, theme)
      if (disposed) return
      // oxlint-disable-next-line eslint/no-await-in-loop -- the painted frame between diagrams is the point of this loop.
      await nextPaint()
    }
  }

  /** Repaint finished diagrams for the current shell theme, reusing what is cached. */
  const retheme = async (): Promise<void> => {
    const containers = finishedContainers(root)
    if (containers.length === 0) return
    let runtime: MermaidRuntime
    try {
      runtime = await load(runtimeUrl)
    } catch {
      return
    }
    if (disposed) return
    const theme = currentTheme()
    ensureInitialized(runtime, theme)
    for (const container of containers) {
      if (disposed) return
      if (!container.isConnected) continue
      try {
        // oxlint-disable-next-line eslint/no-await-in-loop -- one repaint per frame is the point of this loop.
        const cleaned = await paint(container, runtime, theme)
        if (disposed || !container.isConnected) return
        container.innerHTML = cleaned
        container.setAttribute(DATA_STATE, 'done')
      } catch {
        // A theme flip must never blank a diagram that already rendered.
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- the painted frame between repaints is the point of this loop.
      await nextPaint()
    }
  }

  /** One coalesced pass over the queued scopes. */
  const flush = async (): Promise<void> => {
    cancelFlush = undefined
    const scopes = [...queued]
    queued.clear()
    if (disposed || scopes.length === 0) return
    let runtime: MermaidRuntime
    try {
      runtime = await load(runtimeUrl)
    } catch {
      return // no vendor route: leave every fence as an ordinary code block
    }
    const theme = currentTheme()
    for (const scope of scopes) {
      if (disposed) return
      // oxlint-disable-next-line eslint/no-await-in-loop -- scopes are scanned one at a time so each can yield.
      await enhanceScope(scope, runtime, theme)
    }
  }

  const schedule = (scopes: readonly Element[]): void => {
    for (const scope of scopes) queued.add(scope)
    if (queued.size === 0 || cancelFlush !== undefined) return
    cancelFlush = afterNextFrame(() => {
      cancelFlush = undefined
      void flush()
    })
  }

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((records) => { schedule(scopesForRecords(records)) })
    observer.observe(root, { childList: true, subtree: true })
  }
  const stopThemeWatch = watchTheme(() => { void retheme() })
  schedule([root])

  return () => {
    disposed = true
    cancelFlush?.()
    cancelFlush = undefined
    for (const timer of retries) clearTimeout(timer)
    retries.clear()
    stopThemeWatch()
  }
}
