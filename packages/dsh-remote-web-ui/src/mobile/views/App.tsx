/**
 * Mobile surface root: the view state machine (workspaces → sessions →
 * chat) and the top-level data flows. Deliberately plain React state — no
 * router, no state library: the surface is three fixed levels with a back
 * affordance, and every piece of data is fetched on demand.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { history as fetchHistory, listSessions, listWorkspaces, prompt } from '../api.ts'
import { MuxClient } from '../mux.ts'
import { RpcCallError, RpcTransportError } from '../rpc.ts'
import { ChatView } from './ChatView.tsx'
import { SessionListView } from './SessionListView.tsx'
import { WorkspaceView as WorkspaceRoster } from './WorkspaceView.tsx'

/** One navigation level. */
type Route =
  | { kind: 'workspaces' }
  | { kind: 'sessions'; workspace: WorkspaceRow }
  | { kind: 'chat'; session: SessionView; workspace: WorkspaceRow }

/** The session-list row model (list + chat share it). */
export interface SessionView {
  sessionId: string
  title: string
  cwd?: string
  updatedAt: number
  running: boolean
  blank: boolean
}

/** One rendered chat message (produced by the fold). */
export interface RenderMessage {
  id: string
  kind: 'user' | 'assistant'
  text: string
  seq: number
  time: number
  pending?: boolean
  failed?: boolean
  toolSummary?: string
}

/** Map a list row to the surface model; the title comes from projections when present. */
export function toSessionView(item: {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  projections?: { values?: Record<string, unknown> }
}): SessionView {
  const titleValue = item.projections?.values?.title
  const title = typeof titleValue === 'string' && titleValue !== ''
    ? titleValue
    : item.cwd !== undefined ? item.cwd.split('/').filter(Boolean).at(-1) ?? item.cwd : '新会话'
  return {
    sessionId: item.sessionId,
    title,
    ...(item.cwd !== undefined ? { cwd: item.cwd } : {}),
    updatedAt: item.updatedAt,
    running: item.running,
    blank: item.blank,
  }
}

/** Human clock, e.g. "14:05" or "昨天 20:31". */
export function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return clock
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日 ${clock}`
}

/**
 * The surface root.
 * @returns the app tree.
 */
export function App() {
  const [route, setRoute] = useState<Route>({ kind: 'workspaces' })
  const muxRef = useRef<MuxClient | undefined>(undefined)

  // The mux stream lives for the page lifetime: session events keep the
  // open chat live, and reconnect is automatic.
  useEffect(() => {
    const mux = new MuxClient()
    muxRef.current = mux
    mux.start()
    return () => { mux.stop() }
  }, [])

  // Keep the live-event client pointed at the session currently on screen so
  // its polling fallback can keep that chat fresh over SSE-impairing tunnels
  // (quick tunnel / Tailscale Serve do not forward Server-Sent Events).
  useEffect(() => {
    muxRef.current?.observe(route.kind === 'chat' ? route.session.sessionId : undefined)
  }, [route])

  const back = useCallback(() => {
    setRoute(previous => {
      if (previous.kind === 'chat') return { kind: 'sessions', workspace: previous.workspace }
      if (previous.kind === 'sessions') return { kind: 'workspaces' }
      return previous
    })
  }, [])

  const openChat = useCallback((session: SessionView, workspace: WorkspaceRow) => {
    setRoute({ kind: 'chat', session, workspace })
  }, [])

  return (
    <div className="mobile">
      {route.kind === 'workspaces'
        ? <WorkspaceRoster onPick={(workspace) => { setRoute({ kind: 'sessions', workspace }) }} />
        : route.kind === 'sessions'
          ? (
            <SessionListView
              workspace={route.workspace}
              onBack={back}
              onPick={(session) => { openChat(session, route.workspace) }}
            />
          )
          : <ChatView session={route.session} mux={muxRef.current} onBack={back} />}
    </div>
  )
}

/** Shared error text for the surface's small failure affordances. */
export function errorText(error: unknown): string {
  if (error instanceof RpcCallError) return error.error.message
  if (error instanceof RpcTransportError) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Actionable hint for transport-level 403s on host-gated channels (model
 * picker, session creation): the phone's UI bundle is served fresh from disk
 * per request, while the host-side allowlist lives in the long-running
 * process — a rebuild without a restart shows the new surface against the
 * old allowlist (HTTP 403 forbidden).
 */
export function staleHostHint(message: string): string | undefined {
  return /^HTTP 403/.test(message)
    ? '宿主端插件可能仍在运行旧版本：请重启 dsh web 后再试。'
    : undefined
}

/** Fetch one history page (tail by default) — thin wrapper so views share the call shape. */
export function loadHistory(sessionId: string, beforeSeq?: number) {
  return fetchHistory(sessionId, beforeSeq)
}

export { listSessions, listWorkspaces, prompt }
