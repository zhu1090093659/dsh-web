/**
 * Mermaid fence enhancer — the DOM half of the plugin.
 *
 * The shell renders assistant markdown fences through the primitives
 * CodeBlock: one `div.md-code-block` per fence whose banner shows the fence
 * language and whose body carries the source (a plain `pre` for grammars
 * shiki does not know, mermaid among them). The SDK ships no fence-render
 * slot, so this module observes the transcript, finds mermaid fences, and
 * swaps in an SVG figure rendered by the injected renderer while keeping the
 * source one toggle away.
 *
 * React interop rules this module lives by:
 * - never remove or replace React-owned nodes (the banner, the source body);
 *   the figure is an extra trailing child and hiding happens through a data
 *   attribute our stylesheet keys on, so React reconciliation never fights us;
 * - every step is guarded — a shell DOM change degrades to "no enhancement",
 *   never to a thrown error (the shell fails the whole boot otherwise);
 * - re-renders are source-compared, so a streaming fence re-renders as it
 *   grows and a settled block renders exactly once.
 *
 * @module @linxin666/dsh-client-ui-mermaid/client/enhancer
 */

/** One render outcome: the SVG markup, or a failure message to show. */
export type MermaidRenderOutcome = { ok: true; svg: string } | { ok: false; error: string }

/** Render one mermaid source to SVG. Injected so tests stay DOM-pure. */
export type MermaidRender = (id: string, source: string) => Promise<MermaidRenderOutcome>

/** Copy the figure chrome reads, resolved per render so it follows the locale. */
export interface MermaidEnhancerLabels {
  /** Label of the toolbar button while the source is hidden. */
  source(): string
  /** Label of the toolbar button while the source is visible. */
  hide(): string
  /** Caption for a failed render; `{error}` carries the renderer message. */
  error(message: string): string
}

/** Options for {@link installMermaidEnhancer}. */
export interface MermaidEnhancerOptions {
  /** The SVG renderer (the mermaid runtime wrapper in production). */
  render: MermaidRender
  /** Figure chrome copy. */
  labels: MermaidEnhancerLabels
  /** Per-block debounce before rendering (default 150 ms). */
  debounceMs?: number
}

/** Control face of one installed enhancer. */
export interface MermaidEnhancerHandle {
  /** Scan the document now (tests and manual triggers). */
  scan(): void
  /** Drop every cached render and re-render all live blocks. */
  rerenderAll(): void
  /** Revert every enhancement, remove the stylesheet, stop observing. */
  dispose(): void
}

/** One discovered mermaid fence. */
export interface MermaidFence {
  /** The CodeBlock root (the `div.md-code-block`). */
  block: HTMLDivElement
  /** The source body element (the `pre` React renders). */
  body: HTMLElement
  /** The fence source text (trailing newline trimmed, like CodeBlock shows). */
  source: string
}

/** Stylesheet element id; one per document, owned by the live enhancer. */
const STYLE_ID = 'dsh-mermaid-style'

/** Class applied to the outer CodeBlock root while a figure is attached. */
const FIGURE_CLASS = 'dsh-mermaid-figure'

/** The figure chrome stylesheet (attribute-hidden source + figure layout). */
const STYLE_TEXT = [
  '[data-dsh-mermaid-hidden="1"]{display:none !important}',
  '.dsh-mermaid-figure{margin:6px 0;border:1px solid rgba(127,127,127,.35);border-radius:8px;padding:6px 12px;overflow-x:auto}',
  '.dsh-mermaid-figure svg{max-width:100%;height:auto}',
  '.dsh-mermaid-toolbar{display:flex;justify-content:flex-end}',
  '.dsh-mermaid-btn{cursor:pointer;font-size:12px;line-height:20px;padding:0 6px;border:none;background:transparent;color:inherit;opacity:.7;border-radius:4px}',
  '.dsh-mermaid-btn:hover{opacity:1}',
  '.dsh-mermaid-error{font-size:12px;opacity:.8;margin:2px 0}',
].join('\n')

/**
 * Find every mermaid fence under a root.
 *
 * Structure contract (primitives CodeBlock): the root div carries
 * `md-code-block`, its first child is the banner wrap whose banner's first
 * cell shows the fence language, and its second child is the source body.
 * Anything else is left alone.
 * @param root - subtree to scan.
 * @returns the mermaid fences found, in document order.
 */
export function findMermaidFences(root: ParentNode): MermaidFence[] {
  const found: MermaidFence[] = []
  const blocks = root.querySelectorAll<HTMLDivElement>('div.md-code-block')
  for (const block of blocks) {
    const bannerWrap = block.firstElementChild
    const body = bannerWrap?.nextElementSibling
    const infostring = bannerWrap?.firstElementChild?.firstElementChild
    if (!(bannerWrap instanceof HTMLElement) || !(body instanceof HTMLElement)) continue
    if (!(infostring instanceof HTMLElement)) continue
    if ((infostring.textContent ?? '').trim().toLowerCase() !== 'mermaid') continue
    found.push({
      block,
      body,
      source: (body.textContent ?? '').replace(/\n$/, ''),
    })
  }
  return found
}

/**
 * Install the enhancer on a document: inject the stylesheet, observe the
 * body for transcript changes, and render every mermaid fence found.
 * @param doc - the browser document.
 * @param options - renderer, copy, and debounce tuning.
 * @returns the enhancer control handle.
 */
export function installMermaidEnhancer(doc: Document, options: MermaidEnhancerOptions): MermaidEnhancerHandle {
  const { render, labels } = options
  const debounceMs = options.debounceMs ?? 150

  let styleOwned = false
  let disposed = false
  let idCounter = 0
  const timers = new Map<HTMLDivElement, number>()
  const inFlight = new Set<HTMLDivElement>()
  /** Blocks this enhancer attached a figure to, with their last source. */
  const processed = new Map<HTMLDivElement, { body: HTMLElement; figure: HTMLDivElement; source: string }>()

  const ensureStyle = (): void => {
    if (doc.getElementById(STYLE_ID) !== null) return
    const style = doc.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLE_TEXT
    doc.head.appendChild(style)
    styleOwned = true
  }

  const removeStyle = (): void => {
    if (!styleOwned) return
    doc.getElementById(STYLE_ID)?.remove()
    styleOwned = false
  }

  const revertBlock = (block: HTMLDivElement): void => {
    const entry = processed.get(block)
    if (entry === undefined) return
    processed.delete(block)
    delete block.dataset.dshMermaid
    delete entry.body.dataset.dshMermaidHidden
    entry.figure.remove()
  }

  const clearTimer = (block: HTMLDivElement): void => {
    const timer = timers.get(block)
    if (timer !== undefined) {
      doc.defaultView?.clearTimeout(timer)
      timers.delete(block)
    }
  }

  const process = (fence: MermaidFence): void => {
    const { block, body, source } = fence
    if (disposed || !block.isConnected || source === '') return

    // Reuse the figure this enhancer created earlier (streaming re-renders).
    let entry = processed.get(block)
    if (entry === undefined || entry.body !== body) {
      if (entry !== undefined) revertBlock(block)
      const figure = doc.createElement('div')
      figure.className = FIGURE_CLASS
      block.appendChild(figure)
      entry = { body, figure, source: '' }
      processed.set(block, entry)
    }
    block.dataset.dshMermaid = 'pending'
    if (entry.source === source && block.dataset.dshMermaidLast === source) return
    if (inFlight.has(block)) return // latest-wins: the in-flight completion rescans.

    const id = `dsh-mermaid-${++idCounter}`
    inFlight.add(block)
    void render(id, source).then((outcome) => {
      inFlight.delete(block)
      if (disposed) return
      const live = processed.get(block)
      if (live === undefined || !block.isConnected) return
      if (outcome.ok) {
        live.figure.textContent = ''
        const svgHolder = doc.createElement('div')
        svgHolder.innerHTML = outcome.svg // renderer output (mermaid strict mode)
        const svg = svgHolder.firstElementChild
        const toolbar = doc.createElement('div')
        toolbar.className = 'dsh-mermaid-toolbar'
        const toggle = doc.createElement('button')
        toggle.type = 'button'
        toggle.className = 'dsh-mermaid-btn'
        const syncToggle = (): void => {
          const hidden = body.dataset.dshMermaidHidden === '1'
          toggle.textContent = hidden ? labels.source() : labels.hide()
        }
        toggle.addEventListener('click', () => {
          if (body.dataset.dshMermaidHidden === '1') delete body.dataset.dshMermaidHidden
          else body.dataset.dshMermaidHidden = '1'
          syncToggle()
        })
        toolbar.appendChild(toggle)
        live.figure.appendChild(svg ?? svgHolder)
        live.figure.appendChild(toolbar)
        body.dataset.dshMermaidHidden = '1'
        syncToggle()
        block.dataset.dshMermaid = 'done'
      } else {
        // Failure keeps the source readable; the figure carries the reason.
        live.figure.textContent = ''
        const caption = doc.createElement('div')
        caption.className = 'dsh-mermaid-error'
        caption.textContent = labels.error(outcome.error)
        live.figure.appendChild(caption)
        delete body.dataset.dshMermaidHidden
        block.dataset.dshMermaid = 'error'
      }
      live.source = source
      block.dataset.dshMermaidLast = source
      // Latest-wins: a source that changed while this render ran (streaming
      // chunk landed mid-render) must re-render once the flight completes.
      const current = (live.body.textContent ?? '').replace(/\n$/, '')
      if (current !== source) doc.defaultView?.setTimeout(() => { scan() }, 0)
    }, () => {
      inFlight.delete(block)
    })
  }

  const scan = (): void => {
    if (disposed) return
    // Drop tracking for blocks that left the DOM (message removed/replaced).
    for (const block of [...processed.keys()]) {
      if (!block.isConnected) {
        clearTimer(block)
        processed.delete(block)
      }
    }
    for (const fence of findMermaidFences(doc.body)) {
      if (inFlight.has(fence.block)) continue
      if (fence.block.dataset.dshMermaid === 'done' && fence.block.dataset.dshMermaidLast === fence.source) continue
      if (timers.has(fence.block)) continue
      const timer = doc.defaultView?.setTimeout(() => {
        timers.delete(fence.block)
        process(fence)
      }, debounceMs)
      if (timer !== undefined) timers.set(fence.block, timer)
    }
  }

  ensureStyle()

  let scanTimer: number | undefined
  const observer = new (doc.defaultView ?? window).MutationObserver(() => {
    if (scanTimer !== undefined) doc.defaultView?.clearTimeout(scanTimer)
    scanTimer = doc.defaultView?.setTimeout(() => {
      scanTimer = undefined
      scan()
    }, 200)
  })
  observer.observe(doc.body, { childList: true, subtree: true, characterData: true })


  scan()

  return {
    scan,
    rerenderAll(): void {
      if (disposed) return
      for (const block of [...processed.keys()]) {
        clearTimer(block)
        revertBlock(block)
      }
      scan()
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      observer.disconnect()
      if (scanTimer !== undefined) doc.defaultView?.clearTimeout(scanTimer)
      for (const timer of timers.values()) doc.defaultView?.clearTimeout(timer)
      timers.clear()
      for (const block of [...processed.keys()]) revertBlock(block)
      removeStyle()
    },
  }
}
