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

/**
 * Start the enhancement and return its disposer.
 *
 * The first pass scans the whole observation root (the transcript usually
 * mounted before this plugin), then only mutated subtrees are scanned. A theme
 * flip re-renders every finished diagram from its stored source.
 * @param options - Root, route and loader overrides.
 * @returns Disposer: disconnect the observer, stop the theme watch, drop timers.
 */
export function startEnhancement(options: EnhancementOptions = {}): () => void {
  if (typeof document === 'undefined') return () => {}
  const root = options.root ?? document.body
  const runtimeUrl = options.runtimeUrl ?? RUNTIME_ROUTE
  const load = options.load ?? loadRuntime

  let disposed = false
  let frame: number | undefined
  const queued = new Set<Element>()

  /** Render every unclaimed mermaid block under one scope, in place. */
  const enhanceScope = async (scope: ParentNode, runtime: MermaidRuntime): Promise<void> => {
    const blocks = findMermaidBlocks(scope)
    if (blocks.length === 0) return
    runtime.initialize({
      startOnLoad: false,
      theme: mermaidTheme(shellIsDark()),
      securityLevel: 'strict',
      fontFamily: 'inherit',
    })
    await Promise.all(blocks.map(async (pre) => {
      const container = claimBlock(pre)
      try {
        container.setAttribute(DATA_STATE, 'rendering')
        const { svg } = await runtime.render(`dsh-diagrams-${(renderSeq += 1)}`, container.getAttribute('data-diagram-source') ?? '')
        if (disposed || !container.isConnected) return
        container.innerHTML = sanitizeSvg(svg)
        container.setAttribute(DATA_STATE, 'done')
        hideSourceBlock(pre)
      } catch {
        // Syntax error, missing runtime support or a half-streamed fence:
        // put the code block back untouched and retry on the next mutation.
        container.remove()
        pre.removeAttribute('data-diagram-claimed')
      }
    }))
  }

  /** Re-render finished diagrams for the current shell theme. */
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
    runtime.initialize({
      startOnLoad: false,
      theme: mermaidTheme(shellIsDark()),
      securityLevel: 'strict',
      fontFamily: 'inherit',
    })
    await Promise.all(containers.map(async (container) => {
      try {
        const { svg } = await runtime.render(`dsh-diagrams-${(renderSeq += 1)}`, container.getAttribute('data-diagram-source') ?? '')
        if (disposed || !container.isConnected) return
        container.innerHTML = sanitizeSvg(svg)
      } catch {
        // A theme flip must never blank a diagram that already rendered.
      }
    }))
  }

  /** One coalesced pass over the queued scopes. */
  const flush = async (): Promise<void> => {
    frame = undefined
    const scopes = [...queued]
    queued.clear()
    if (disposed || scopes.length === 0) return
    let runtime: MermaidRuntime
    try {
      runtime = await load(runtimeUrl)
    } catch {
      return // no vendor route: leave every fence as an ordinary code block
    }
    for (const scope of scopes) {
      if (disposed) return
      await enhanceScope(scope, runtime)
    }
  }

  const schedule = (scopes: readonly Element[]): void => {
    for (const scope of scopes) queued.add(scope)
    if (queued.size === 0 || frame !== undefined) return
    frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => { void flush() })
      : (setTimeout(() => { void flush() }, 16) as unknown as number)
  }

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver((records) => { schedule(scopesForRecords(records)) })
    observer.observe(root, { childList: true, subtree: true })
  }
  const stopThemeWatch = watchTheme(() => { void retheme() })
  schedule([root])

  return () => {
    disposed = true
    if (frame !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
    stopThemeWatch()
  }
}
