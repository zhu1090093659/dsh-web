/**
 * Landing level: the workspace roster. The mobile surface opens straight
 * here — no new-session homepage — and every workspace row is a thin
 * fetch from workspace.list (the roster is small; sessions are not loaded
 * until a workspace is opened).
 */

import { useEffect, useState } from 'react'
import type { WorkspaceView as WorkspaceRow } from '@deepseek-ai/dsh-host-apiproxy/api/workspace'
import { listWorkspaces, listDirectory, createWorkspace, type DirectoryListing, type DirectoryEntry } from '../api.ts'
import { errorText } from './App.tsx'
import { ThemeToggle } from '../theme-toggle.tsx'

/** Props for the directory browser. */
interface DirectoryBrowserProps {
  onCancel(): void
  onPick(workspace: WorkspaceRow): void
}

/**
 * Render the directory browser for creating a new workspace.
 */
function DirectoryBrowser({ onCancel, onPick }: DirectoryBrowserProps) {
  const [listing, setListing] = useState<DirectoryListing | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)
  const [path, setPath] = useState<string | undefined>(undefined)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError(undefined)
    setListing(undefined)
    void listDirectory(path).then(
      (res) => {
        if (cancelled) return
        setListing(res)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [path, reload])

  const handleCreate = async () => {
    if (listing === undefined || creating) return
    setCreating(true)
    setError(undefined)
    try {
      const result = await createWorkspace(listing.path)
      onPick(result.workspace)
    } catch (reason: unknown) {
      setCreating(false)
      setError(errorText(reason))
    }
  }

  return (
    <div className="mobile dir-browser">
      <header className="mobile-header">
        <button type="button" className="mobile-headerAction" onClick={onCancel}>返回</button>
        <h1 className="mobile-title">选择目录</h1>
      </header>
      
      {listing !== undefined && (
        <div className="dir-crumbs">
          {listing.crumbs.map((crumb, idx) => (
            <span key={crumb.path}>
              <button
                type="button"
                className="dir-crumb"
                onClick={() => setPath(crumb.path)}
              >
                {crumb.name || '/'}
              </button>
              {idx < listing.crumbs.length - 1 && <span className="dir-crumb-separator">/</span>}
            </span>
          ))}
        </div>
      )}

      {error !== undefined ? (
        <div className="mobile-empty">
          <p className="mobile-error">{error}</p>
          <button type="button" className="mobile-button" onClick={() => setReload(n => n + 1)}>重试</button>
        </div>
      ) : listing === undefined ? (
        <div className="mobile-empty">
          <p className="mobile-muted">加载中…</p>
        </div>
      ) : (
        <ul className="mobile-list">
          {listing.entries.length === 0 ? (
            <div className="mobile-empty dir-empty">
              <p className="mobile-muted">空目录</p>
            </div>
          ) : (
            listing.entries.map((entry: DirectoryEntry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`mobile-row dir-entry ${entry.hidden ? 'dir-entry-hidden' : ''}`}
                  onClick={() => setPath(entry.path)}
                >
                  <span className="mobile-rowTitle">{entry.name}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="dir-select">
        <button
          type="button"
          className="mobile-button"
          disabled={listing === undefined || creating}
          onClick={() => void handleCreate()}
        >
          {creating ? '创建中…' : '选择此目录'}
        </button>
      </div>
    </div>
  )
}

/** Props for the workspace roster. */
export interface WorkspaceViewProps {
  /** Workspace carried by the pairing link; opened after the roster loads. */
  initialWorkspaceId?: string
  /** Open one workspace's session list. */
  onPick(workspace: WorkspaceRow): void
}

/**
 * Render the workspace roster.
 * @param props - the pick action.
 * @returns the roster.
 */
export function WorkspaceView({ initialWorkspaceId, onPick }: WorkspaceViewProps) {
  const [items, setItems] = useState<WorkspaceRow[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  // Bumped by the retry button to re-run the roster fetch effect.
  const [reload, setReload] = useState(0)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listWorkspaces().then(
      (rows) => {
        if (cancelled) return
        const target = initialWorkspaceId === undefined
          ? undefined
          : rows.find(workspace => workspace.workspaceId === initialWorkspaceId)
        if (target !== undefined) {
          onPick(target)
          return
        }
        setItems(rows)
      },
      (reason: unknown) => {
        if (cancelled) return
        setError(errorText(reason))
      },
    )
    return () => { cancelled = true }
  }, [initialWorkspaceId, onPick, reload])

  if (isCreating) {
    return (
      <DirectoryBrowser
        onCancel={() => setIsCreating(false)}
        onPick={onPick}
      />
    )
  }

  if (error !== undefined) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <h1 className="mobile-title">工作区</h1>
          <ThemeToggle />
        </header>
        <div className="mobile-empty">
          <p className="mobile-error">加载失败：{error}</p>
          <button type="button" className="mobile-button" onClick={() => { setError(undefined); setItems(undefined); setReload(n => n + 1) }}>
            重试
          </button>
        </div>
      </div>
    )
  }

  if (items === undefined) {
    return (
      <div className="mobile">
        <header className="mobile-header">
          <h1 className="mobile-title">工作区</h1>
          <ThemeToggle />
        </header>
        <div className="mobile-empty">
          <p className="mobile-muted">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile">
      <header className="mobile-header">
        <h1 className="mobile-title">工作区</h1>
        <ThemeToggle />
      </header>
      {items.length === 0 ? (
        <div className="mobile-empty">
          <p className="mobile-muted">暂无工作区</p>
        </div>
      ) : (
        <ul className="mobile-list">
          {items.map(workspace => (
            <li key={workspace.workspaceId}>
              <button type="button" className="mobile-row" onClick={() => { onPick(workspace) }}>
                <span className="mobile-rowTitle">{workspace.title}</span>
                <span className="mobile-rowMeta">{workspace.path}</span>
                <span className="mobile-chevron">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ padding: '16px' }}>
        <button
          type="button"
          className="mobile-button"
          onClick={() => setIsCreating(true)}
        >
          + 新建工作区
        </button>
      </div>
    </div>
  )
}
