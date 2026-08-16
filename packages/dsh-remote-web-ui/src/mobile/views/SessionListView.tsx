/**
 * Sessions level: one workspace's sessions, loaded incrementally — the
 * first page fetches session.list with a cursor, scrolling appends further
 * pages (never the whole list at once). Rows are filtered to the opened
 * workspace by its owned session ids; extra pages are pulled on demand so
 * a workspace with many sessions converges without a full transfer.
 *
 * Creating a session is this level's other action: the workspace's id is
 * sent to session.create (the host attaches the new session to it), the
 * fresh row is prepended optimistically, and the user lands straight in
 * the new chat — the same "new session opens" flow as the desktop UI.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import type { SessionSummary } from '@deepseek-ai/dsh-host-apiproxy/api/sessions'
import { createSession, listSessions, listWorkspaces } from '../api.ts'
import { errorText, formatTime, staleHostHint, toSessionView, type SessionView } from './App.tsx'
import { ThemeToggle } from '../theme-toggle.tsx'

/** Props for the session list. */
export interface SessionListViewProps {
  workspace: WorkspaceRow
  onBack(): void
  onPick(session: SessionView): void
}

/** Rows that belong to the opened workspace (its owned session id set). */
function ownedItems(page: SessionSummary[], workspace: WorkspaceRow): SessionView[] {
  const owned = new Set(workspace.sessionIds)
  return page
    .filter(item => owned.has(item.sessionId as never))
    .map(item => toSessionView(item, workspace.workspaceId))
}

/**
 * Render one workspace's paged session list.
 * @param props - the workspace, back action, and pick action.
 * @returns the session list.
 */
export function SessionListView({ workspace, onBack, onPick }: SessionListViewProps) {
  const [rows, setRows] = useState<SessionView[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const cursorRef = useRef<string | undefined>(undefined)
  const busyRef = useRef(false)

  // First page on mount. The workspace roster is re-read alongside so the
  // owned-id set is fresh: a session created (or attached) since this
  // workspace row was captured must not vanish from the filter.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    void Promise.all([listSessions(), listWorkspaces()]).then(
      ([page, workspaces]) => {
        if (cancelled) return
        const fresh = workspaces.find(candidate => candidate.workspaceId === workspace.workspaceId)
        const current = fresh ?? workspace
        setRows(ownedItems(page.items, current))
        cursorRef.current = page.nextCursor
        setHasMore(page.hasMore)
        setLoading(false)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [workspace])

  /** Pull the next page and append the rows that belong to this workspace. */
  const loadMore = useCallback(() => {
    if (busyRef.current) return
    const cursor = cursorRef.current
    if (cursor === undefined) return
    busyRef.current = true
    setLoading(true)
    void listSessions(cursor).then(
      (page) => {
        busyRef.current = false
        setLoading(false)
        cursorRef.current = page.nextCursor
        setHasMore(page.hasMore)
        setRows(previous => [...previous, ...ownedItems(page.items, workspace)])
      },
      (reason: unknown) => {
        busyRef.current = false
        setLoading(false)
        setError(errorText(reason))
      },
    )
  }, [workspace])

  /** Create a blank session in this workspace and open it immediately. */
  const handleCreate = useCallback(() => {
    if (creating) return
    setCreating(true)
    setCreateError(undefined)
    void createSession({ workspaceId: workspace.workspaceId }).then(
      (created) => {
        setCreating(false)
        const view: SessionView = {
          sessionId: created.sessionId,
          title: '新会话',
          workspaceId: workspace.workspaceId,
          ...(created.agentPreset !== undefined ? { agentPreset: created.agentPreset } : {}),
          updatedAt: Date.now(),
          running: false,
          blank: true,
        }
        setRows(previous => [view, ...previous])
        onPick(view)
      },
      (reason: unknown) => {
        setCreating(false)
        setCreateError(errorText(reason))
      },
    )
  }, [creating, workspace, onPick])

  const createHint = createError !== undefined ? staleHostHint(createError) : undefined

  return (
    <div className="mobile">
      <header className="mobile-header">
        <button type="button" className="mobile-back" aria-label="返回" onClick={onBack}>‹</button>
        <h1 className="mobile-title mobile-titleInline">{workspace.title}</h1>
        <ThemeToggle />
      </header>
      {error !== undefined && <p className="mobile-error mobile-pad">{error}</p>}
      <div className="mobile-pad">
        <button
          type="button"
          className="mobile-new"
          disabled={creating}
          onClick={() => { void handleCreate() }}
        >
          {creating ? '创建中…' : '+ 新建会话'}
        </button>
      </div>
      {createError !== undefined && (
        <p className="mobile-error mobile-pad">
          {createError}
          {createHint !== undefined && <span className="mobile-hint">{createHint}</span>}
        </p>
      )}
      <ul className="mobile-list">
        {rows.map(row => (
          <li key={row.sessionId}>
            <button type="button" className="mobile-row" onClick={() => { onPick(row) }}>
              <span className="mobile-rowMain">
                <span className="mobile-rowTitle">
                  {row.blank ? '新会话' : row.title}
                  {row.running ? <span className="mobile-live">●</span> : null}
                </span>
                <span className="mobile-rowMeta">{formatTime(row.updatedAt)}</span>
              </span>
              <span className="mobile-chevron">›</span>
            </button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="mobile-pad">
          <button
            type="button"
            className="mobile-button mobile-block"
            disabled={loading}
            onClick={() => { void loadMore() }}
          >
            {loading ? '加载中…' : '加载更多会话'}
          </button>
        </div>
      )}
      {!hasMore && rows.length === 0 && !loading && (
        <div className="mobile-empty">
          <p className="mobile-muted">该工作区还没有会话，点上方按钮新建一个</p>
        </div>
      )}
    </div>
  )
}
