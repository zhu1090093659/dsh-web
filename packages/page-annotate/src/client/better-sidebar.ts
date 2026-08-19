/**
 * Structural mirror of the dsh-better-sidebar client service and tab types.
 * The real plugin publishes `ctx.betterSidebar`; this plugin declares the
 * faces it touches locally (no dependency on the external package), exactly
 * like dsh-aionui-panel mirrors the side-card registry.
 * @module @linxin666/dsh-page-annotate/client/better-sidebar
 */

import type { ReactNode } from 'react'

/** The minimal SidebarTab a tab component receives. */
export interface SidebarTabLike {
  id: string
  type: string
  title?: string | (() => string)
  /** The URL seed the browser builtin-style tabs carry. */
  path?: string
  url?: string
  meta?: unknown
}

/** Session scope handed to tab components (session-routed services). */
export interface SessionScopeLike {
  sessionId: string
  cwd?: string
}

/** Props every registered tab component receives. */
export interface TabComponentPropsLike {
  ctx: unknown
  store: unknown
  scope: SessionScopeLike
  tab: SidebarTabLike
  visible: boolean
}

/** One registered tab descriptor (the slice registerTab accepts). */
export interface TabDescriptorLike {
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number
  single?: boolean
  urlTarget?: (url: URL) => boolean
  component: (props: TabComponentPropsLike) => ReactNode
}

/** The service face the panel tab registers into. */
export interface BetterSidebarServiceLike {
  registerTab(descriptor: TabDescriptorLike): () => void
  registerFileViewer(descriptor: unknown): () => void
  openTab?(seed: { type: string; title?: string; url?: string; id?: string; meta?: unknown }): void
  getTabs?(): readonly TabDescriptorLike[]
}

/** Resolve the service from a client context (augmented member or ctx.get). */
export function resolveBetterSidebar(ctx: unknown): BetterSidebarServiceLike | undefined {
  const record = ctx as { betterSidebar?: BetterSidebarServiceLike; get?: (name: string) => unknown } | null
  if (record === null || typeof record !== 'object') return undefined
  const direct = record.betterSidebar
  if (direct !== undefined && typeof direct.registerTab === 'function') return direct
  if (typeof record.get === 'function') {
    const viaGet = record.get('betterSidebar') as BetterSidebarServiceLike | undefined
    if (viaGet !== undefined && typeof viaGet.registerTab === 'function') return viaGet
  }
  return undefined
}

/** Whether a tab path looks like an http(s) URL (the panel's navigation seed). */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
