/**
 * Browser entry of the diagrams plugin.
 *
 * In the chat transcript, mermaid fences render through the official
 * `conversation.chat.markdown.fence` hoc slot (`key: 'mermaid'`). Surfaces that
 * render Markdown without passing `renderCode` (such as the document preview
 * pane) fall back to the scoped DOM observer, which explicitly ignores blocks
 * already inside a `conversation.chat.markdown.fence` slot.
 * @module @linxin666/dsh-client-ui-diagrams/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { FENCE_LAYER_ID, FENCE_SLOT_NAME, RENDERED_LANGUAGE } from '../core/contract.ts'
import { startEnhancement } from './enhance.ts'
import { MermaidFenceLayer } from './MermaidFenceLayer.tsx'
import { sharedMermaidRenderer } from './render.ts'

/** Optional service declaration: slots is present in standard web shells. */
export const inject = {
  slots: { required: false },
}

/**
 * Register the official chat fence layer (when `ctx.slots` is available) and
 * start the document-preview fallback enhancement for the plugin lifetime.
 * @param ctx - Client context; effects dispose the slot and observer on unload.
 */
export function apply(ctx: ClientContext): void {
  const slots = typeof ctx.get === 'function' ? ctx.get('slots', false) : undefined
  if (slots !== undefined) {
    slots.inject(FENCE_SLOT_NAME, () => slots.register({
      name: FENCE_SLOT_NAME,
      key: RENDERED_LANGUAGE,
      id: FENCE_LAYER_ID,
    }, MermaidFenceLayer))
  }
  ctx.effect(() => startEnhancement({ renderer: sharedMermaidRenderer }), 'diagrams: render mermaid fences')
}

export { MermaidFenceLayer, type MermaidFenceLayerProps } from './MermaidFenceLayer.tsx'
export { createMermaidRenderer, sharedMermaidRenderer, type MermaidRenderer, type RenderMermaidOptions } from './render.ts'
export { startEnhancement } from './enhance.ts'
export { scopesForRecords } from './enhance.ts'
export { findMermaidBlocks } from './blocks.ts'
export { sanitizeSvg } from './sanitize.ts'
export { mermaidTheme, shellIsDark, watchTheme } from './theme.ts'
export { loadRuntime, runtimeIfLoaded, type MermaidRuntime } from './runtime.ts'
