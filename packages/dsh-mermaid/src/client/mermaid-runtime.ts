/**
 * The real mermaid runtime wrapper: initializes the bundled mermaid with the
 * configured theme and renders one source to SVG. Kept behind a seam so the
 * enhancer tests never load the multi-megabyte dependency.
 *
 * Failure policy: render problems surface as `{ ok: false }` outcomes, never
 * as rejections — the enhancer shows the reason beside the readable source.
 * @module @linxin666/dsh-client-ui-mermaid/client/mermaid-runtime
 */

import mermaid from 'mermaid'
import type { MermaidRenderOutcome } from './enhancer.ts'
import { resolveAutoTheme } from './auto-theme.ts'
import type { MermaidBuiltInTheme, MermaidThemeSetting } from '../core/themes.ts'

/** Theme mermaid was last initialized with; re-init only on change. */
let initializedTheme: MermaidBuiltInTheme | undefined

/** Counter for unique render ids (mermaid keys its temp elements by id). */
let renderCounter = 0

/**
 * Initialize (or re-initialize) mermaid for one built-in theme.
 * @param theme - the mermaid built-in theme to apply.
 */
async function ensureInitialized(theme: MermaidBuiltInTheme): Promise<void> {
  if (initializedTheme === theme) return
  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme,
    fontFamily: 'inherit',
  })
  initializedTheme = theme
}

/** Extract a one-line message from an unknown render failure. */
function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const line = text.split('\n').find(part => part.trim() !== '') ?? 'unknown error'
  return line.length > 300 ? `${line.slice(0, 300)}…` : line
}

/**
 * Render one mermaid source to SVG under the configured theme.
 * @param id - unique render id (from the enhancer).
 * @param source - the fence source.
 * @param setting - the user-selected theme setting (`auto` resolves here).
 * @returns the SVG markup, or the failure reason.
 */
export async function renderMermaidDiagram(
  id: string,
  source: string,
  setting: MermaidThemeSetting,
): Promise<MermaidRenderOutcome> {
  try {
    const theme = setting === 'auto' ? resolveAutoTheme(document) : setting
    await ensureInitialized(theme)
    const { svg } = await mermaid.render(`${id}-${++renderCounter}`, source)
    return { ok: true, svg }
  } catch (error) {
    // mermaid can leave its temp elements behind on a parse failure.
    document.getElementById(`d${id}`)?.remove()
    document.getElementById(id)?.remove()
    return { ok: false, error: messageOf(error) }
  }
}
