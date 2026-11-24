/**
 * Official `conversation.chat.markdown.fence` hoc layer for `mermaid` fences.
 *
 * While a message is streaming, the layer returns the inner plain code block
 * untouched so half-written diagrams never trigger parse errors or layout
 * churn. Once settled, it loads the vendored runtime on demand, renders and
 * sanitizes the SVG for the current shell theme, and replaces the code block;
 * any parse, sanitizer, or runtime failure falls back to the untouched code
 * block.
 * @module @linxin666/dsh-client-ui-diagrams/client/MermaidFenceLayer
 */

import { useEffect, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { HocShare, PropsRuntime, SlotMap } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DATA_SOURCE,
  DATA_STATE,
  DIAGRAM_CLASS,
  PART_NAME,
  PLUGIN_NAME,
  RUNTIME_ROUTE,
} from '../core/contract.ts'
import { sharedMermaidRenderer, type MermaidRenderer } from './render.ts'
import type { MermaidRuntime } from './runtime.ts'
import { mermaidTheme, shellIsDark, watchTheme } from './theme.ts'

/** Props delivered by the official fence slot plus optional test overrides. */
export type MermaidFenceLayerProps =
  & Partial<PropsRuntime<'conversation.chat.markdown.fence'>>
  & Pick<PropsRuntime<'conversation.chat.markdown.fence'>, 'lang' | 'code' | 'streaming'>
  & HocShare<SlotMap['conversation.chat.markdown.fence']>
  & {
    /** Same-origin vendor route override. */
    runtimeUrl?: string
    /** Runtime loader override (tests inject fakes). */
    load?: (url: string) => Promise<MermaidRuntime>
    /** Isolated renderer cache override (tests inject fresh instances). */
    renderer?: MermaidRenderer
  }

function initialTheme(): 'default' | 'dark' {
  if (typeof document === 'undefined' || document.body === null) return 'default'
  return mermaidTheme(shellIsDark())
}

/**
 * Render settled `mermaid` markdown fences in the official chat flow as
 * sanitized SVG diagrams, falling back to `children` while streaming or on any
 * error.
 */
export function MermaidFenceLayer({
  code,
  streaming,
  children,
  runtimeUrl = RUNTIME_ROUTE,
  load,
  renderer = sharedMermaidRenderer,
}: MermaidFenceLayerProps): ReactNode {
  const [theme, setTheme] = useState<'default' | 'dark'>(initialTheme)
  const trimmed = code.trim()
  const cached = !streaming && trimmed !== '' ? renderer.getCached(code, theme) : undefined
  const [rendered, setRendered] = useState<{ key: string; svg: string } | null>(() => (
    cached !== undefined ? { key: `${theme}\u0000${code}`, svg: cached } : null
  ))

  useEffect(() => {
    if (typeof document === 'undefined' || document.body === null) return undefined
    setTheme(mermaidTheme(shellIsDark()))
    return watchTheme((isDark) => {
      setTheme(mermaidTheme(isDark))
    })
  }, [])

  const targetKey = `${theme}\u0000${code}`

  useEffect(() => {
    if (streaming || trimmed === '') return undefined
    const hit = renderer.getCached(code, theme)
    if (hit !== undefined) {
      setRendered({ key: targetKey, svg: hit })
      return undefined
    }
    let cancelled = false
    void renderer.render(code, theme, { runtimeUrl, load }).then(
      (svg) => {
        if (!cancelled) setRendered({ key: targetKey, svg })
      },
      () => {
        if (!cancelled) {
          setRendered((prev) => (prev?.key === targetKey ? null : prev))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [code, trimmed, streaming, theme, targetKey, runtimeUrl, load, renderer])

  if (streaming || trimmed === '') return children

  const svg = cached ?? (rendered?.key === targetKey ? rendered.svg : undefined)
  if (svg === undefined) return children

  return (
    <div
      className={DIAGRAM_CLASS}
      data-dsh-plugin={PLUGIN_NAME}
      data-dsh-part={PART_NAME}
      {...{
        [DATA_STATE]: 'done',
        [DATA_SOURCE]: code,
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
