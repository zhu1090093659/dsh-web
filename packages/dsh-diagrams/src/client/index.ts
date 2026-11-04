/**
 * Browser entry of the diagrams plugin.
 *
 * The enhancement needs no slot and no service: it observes the page for the
 * official markdown renderer's mermaid fences (chat transcript and document
 * preview alike) and renders them itself. `apply` therefore only owns the
 * effect's lifetime.
 * @module @linxin666/dsh-client-ui-diagrams/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { startEnhancement } from './enhance.ts'

/**
 * Start the diagram enhancement for the lifetime of this client plugin.
 * @param ctx - Client context; the effect disposes the observer on unload.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => startEnhancement(), 'diagrams: render mermaid fences')
}

export { startEnhancement } from './enhance.ts'
export { scopesForRecords } from './enhance.ts'
export { findMermaidBlocks } from './blocks.ts'
export { sanitizeSvg } from './sanitize.ts'
export { mermaidTheme, shellIsDark, watchTheme } from './theme.ts'
export { loadRuntime, runtimeIfLoaded, type MermaidRuntime } from './runtime.ts'
