/**
 * Chat-transcript mermaid enhancement: the core conversation renderer emits
 * fenced code as `pre > code.language-mermaid`, and the shell has no slot
 * for message-body post-processing — so this component rides the
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
 * (an added element directly; otherwise that node's parentElement), deduped
 * by identity. Disconnected nodes and removed-only records yield nothing —
 * removal never introduces a fence. Pure (DOM-read only) so tests can drive
 * it in jsdom.
 */
export function enhanceScopesFor(records: MutationRecord[]): Element[] {
  const scopes = new Set<Element>()
  for (const record of records) {
    // Removal-only batches do not introduce a fence: without additions the
    // target scan is wasted, so only records carrying added nodes contribute.
    if (record.addedNodes.length === 0) continue
    if (record.target instanceof Element && record.target.isConnected) {
      scopes.add(record.target)
    }
    for (const node of record.addedNodes) {
      const element = node instanceof Element ? node : node.parentElement
      if (element !== null && element.isConnected) scopes.add(element)
    }
  }
  return Array.from(scopes)
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
          skip: (pre) => pre.closest(`[${DATA_MD_SCOPE}]`) !== null,
        })
        return
      }
      for (const scope of scopes) {
        void enhanceMermaidBlocks(scope, {
          className: previewCss.mermaidBlock,
          theme: mermaidTheme(shellIsDark()),
          skip: (pre) => pre.closest(`[${DATA_MD_SCOPE}]`) !== null,
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
