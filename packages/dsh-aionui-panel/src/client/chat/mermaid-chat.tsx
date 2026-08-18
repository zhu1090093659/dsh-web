/**
 * Chat-transcript mermaid enhancement: the shell conversation renderer
 * emits fenced code as `div.md-code-block` with the language in a banner
 * infostring element (no language class on pre/code), and the shell has no
 * slot for message-body post-processing — so this component rides the
 * conversation input dock as a zero-render sentinel and observes the
 * document for mermaid blocks the transcript mounts. Blocks inside the
 * preview panel's own subtree are excluded (each surface owns its blocks).
 *
 * Streaming awareness: an assistant message re-renders continuously, so a
 * diagram fence is often incomplete mid-stream. Renders that fail restore
 * the block and the next mutation retries it — once the fence closes the
 * diagram lands. Mutations are debounced to one rAF so long transcripts do
 * not re-scan the whole document: each batch is mapped to the minimal
 * mutated subtrees and scoped per-frame while the first scheduled pass scans
 * the body once. The observer is disconnected on unmount.
 * @module dsh-aionui-panel/client/chat/mermaid-chat
 */

import { useEffect } from 'react'
import type { JSX } from 'react'
import { DATA_MD_SCOPE, enhanceMermaidBlocks, mermaidTheme, rethemeMermaidBlocks, shellIsDark, watchShellTheme } from '../preview/mermaid.ts'
import previewCss from '../styles/preview.module.css'

/**
 * Map a mutation batch to the minimal scan scopes that may contain new
 * mermaid fences. Each record contributes its target and its added nodes
 * (an added element directly; otherwise that node's parentElement), promoted
 * to the owning `.md-code-block` when present and deduped by identity.
 * Disconnected nodes and removed-only records yield nothing — removal never
 * introduces a fence. Pure (DOM-read only) so tests can drive it in jsdom.
 */
export function enhanceScopesFor(records: MutationRecord[]): Element[] {
  const scopes = new Set<Element>()
  for (const record of records) {
    // Removal-only batches do not introduce a fence: without additions the
    // target scan is wasted, so only records carrying added nodes contribute.
    if (record.addedNodes.length === 0) continue
    if (record.target instanceof Element && record.target.isConnected) {
      scopes.add(record.target.closest('.md-code-block') ?? record.target)
    }
    for (const node of record.addedNodes) {
      const element = node instanceof Element ? node : node.parentElement
      if (element !== null && element.isConnected) {
        scopes.add(element.closest('.md-code-block') ?? element)
      }
    }
  }
  return Array.from(scopes)
}

/**
 * Chat-side ownership guard: blocks inside the preview panel's own subtrees
 * (the markdown viewer scope marker, or the preview column hosting the code
 * viewers) belong to the panel drivers, never to the transcript enhancer.
 */
export function isPanelOwnedPre(pre: HTMLPreElement): boolean {
  return pre.closest(`[${DATA_MD_SCOPE}], [data-aionui-preview-col]`) !== null
}

/** Hidden sentinel: renders nothing, owns the transcript observer. */
export function MermaidChatEnhancer(): JSX.Element | null {
  useEffect(() => {
    let scheduled = false
    let pendingFrame = 0
    let firstPass = true
    let pendingRecords: MutationRecord[] = []
    const run = (): void => {
      scheduled = false
      // The chat mermaid enhancement is a right-panel feature: while the
      // panel is disabled (provider = dsh-better-sidebar), the host does not
      // register the /aionui-panel/* routes, so the vendor script fetch would
      // receive the SPA fallback HTML and throw a parse error. The panel
      // columns only exist while the panel is mounted — bail on their
      // absence (the observer stays armed and the firstPass flag stays true,
      // so a later panel mount triggers the full-document scan).
      if (document.querySelector('[data-aionui-preview-col]') === null) return
      const records = pendingRecords
      pendingRecords = []
      const scopes = enhanceScopesFor(records)
      if (firstPass) {
        // First scheduled pass only: scan the whole document exactly once.
        // Later batches (even removal-only ones that yield no scopes) never
        // fall back to a full-body scan.
        firstPass = false
        void enhanceMermaidBlocks(document.body, {
          className: previewCss.mermaidBlock,
          theme: mermaidTheme(shellIsDark()),
          skip: isPanelOwnedPre,
        })
        return
      }
      for (const scope of scopes) {
        void enhanceMermaidBlocks(scope, {
          className: previewCss.mermaidBlock,
          theme: mermaidTheme(shellIsDark()),
          skip: isPanelOwnedPre,
        })
      }
    }
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      pendingFrame = requestAnimationFrame(run)
    }
    const observer = new MutationObserver((records) => {
      pendingRecords = pendingRecords.concat(records)
      schedule()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    schedule()
    const disposeTheme = watchShellTheme((isDark) => {
      void rethemeMermaidBlocks(document.body, { theme: mermaidTheme(isDark) })
    })
    return () => {
      observer.disconnect()
      disposeTheme()
      cancelAnimationFrame(pendingFrame)
    }
  }, [])
  return null
}
