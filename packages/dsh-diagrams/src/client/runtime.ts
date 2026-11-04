/**
 * On-demand loader for the vendored mermaid runtime.
 *
 * The bundle is a third-party IIFE that leaves a `window.mermaid` global, so
 * the handle is validated structurally (never trusted) and one `<script>` is
 * injected per page no matter how many blocks ask for it. A failed load clears
 * the memo so a later block can retry after a transient failure.
 * @module @linxin666/dsh-client-ui-diagrams/client/runtime
 */

/** The slice of the mermaid API this package consumes. */
export interface MermaidRuntime {
  /** Apply global render options (called once per render batch). */
  initialize: (config: Record<string, unknown>) => void
  /** Render one diagram source to SVG markup. */
  render: (id: string, text: string) => Promise<{ svg: string }>
}

/** Resolve the runtime global, or null while it is absent or malformed. */
export function runtimeIfLoaded(): MermaidRuntime | null {
  const candidate = (globalThis as Record<string, unknown>).mermaid
  if (typeof candidate !== 'object' || candidate === null) return null
  const checked = candidate as Record<string, unknown>
  if (typeof checked.initialize !== 'function' || typeof checked.render !== 'function') return null
  return checked as unknown as MermaidRuntime
}

/** Shared in-flight load, so concurrent batches inject one script. */
let pending: Promise<MermaidRuntime> | undefined

/**
 * Load the runtime once per page from the host route.
 * @param url - Same-origin vendor route serving the IIFE bundle.
 * @returns The validated runtime; rejects when the script cannot load.
 */
export function loadRuntime(url: string): Promise<MermaidRuntime> {
  const loaded = runtimeIfLoaded()
  if (loaded !== null) return Promise.resolve(loaded)
  if (pending !== undefined) return pending
  pending = new Promise<MermaidRuntime>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.addEventListener('load', () => {
      const runtime = runtimeIfLoaded()
      if (runtime === null) {
        pending = undefined
        reject(new Error('diagrams: the vendor script loaded but left no mermaid global'))
        return
      }
      resolve(runtime)
    })
    script.addEventListener('error', () => {
      pending = undefined
      reject(new Error(`diagrams: failed to load ${url}`))
    })
    document.head.appendChild(script)
  })
  return pending
}
