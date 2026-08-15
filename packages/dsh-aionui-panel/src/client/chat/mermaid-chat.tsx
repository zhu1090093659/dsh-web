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
 * diagram lands. Mutations are debounced to one rAF and the observer is
 * disconnected on unmount.
 * @module dsh-aionui-panel/client/chat/mermaid-chat
 */

import { useEffect } from 'react'
import type { JSX } from 'react'
import { DATA_MD_SCOPE, enhanceMermaidBlocks, mermaidTheme, rethemeMermaidBlocks, shellIsDark, watchShellTheme } from '../preview/mermaid.ts'
import previewCss from '../styles/preview.module.css'

/** Hidden sentinel: renders nothing, owns the transcript observer. */
export function MermaidChatEnhancer(): JSX.Element | null {
  useEffect(() => {
    let scheduled = false
    let pendingFrame = 0
    const run = (): void => {
      scheduled = false
      void enhanceMermaidBlocks(document.body, {
        className: previewCss.mermaidBlock,
        theme: mermaidTheme(shellIsDark()),
        skip: (pre) => pre.closest(`[${DATA_MD_SCOPE}]`) !== null,
      })
    }
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      pendingFrame = requestAnimationFrame(run)
    }
    const observer = new MutationObserver(schedule)
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
