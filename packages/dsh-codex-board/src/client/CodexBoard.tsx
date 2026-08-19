/**
 * CodexBoard: a floating task board pinned to the top-right of the GUI,
 * mirroring the Codex task-board interaction. It reads the current
 * session's todos projection (written by the `todo_write` tool) and shows
 * a progress summary plus the per-row status list. Collapse state is
 * persisted per session in localStorage.
 *
 * The board is host-global (no session-scoped slot): it mounts onto
 * document.body through a single React root for the page lifetime and
 * follows the sessions list `current` selection.
 * @module @linxin666/dsh-codex-board/client/CodexBoard
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { TodoItem } from '../core/derive.ts'
import { deriveProgress, readCollapsed, writeCollapsed } from '../core/derive.ts'
import { NS } from './locales.ts'
import styles from './codex-board.module.css'

/** Composed props of the floating board. */
export interface CodexBoardProps {
  /** The current session id (undefined on the new-conversation screen). */
  sessionId: string | undefined
  /** The session's todos projection value (null = absent). */
  todos: readonly TodoItem[] | null
  /** Locale translate seat (namespace-bound). */
  t: TranslateNS<typeof NS>
}

/** Default top-right offset when the user has not dragged the board. */
const DEFAULT_TOP = 72
const DEFAULT_RIGHT = 16

/** Status -> dictionary key mapping (typed so the locale seat narrows). */
const STATUS_KEYS = {
  pending: 'board.status.pending',
  in_progress: 'board.status.in_progress',
  completed: 'board.status.completed',
} as const

/** The board glyph: a small checklist icon drawn with primitives (no emoji). */
function BoardGlyph(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2" width="11" height="10" rx="2" />
      <path d="M4 6.2l1.8 1.8L10 4.6" />
    </svg>
  )
}

/**
 * The floating Codex-style task board.
 * @param props - session id, todos projection, locale seat.
 * @returns the board element (rendered through the root container).
 */
export function CodexBoard(props: CodexBoardProps): JSX.Element | null {
  const { sessionId, todos, t } = props
  const progress = useMemo(() => deriveProgress(todos), [todos])

  const [collapsed, setCollapsed] = useState<boolean>(() =>
    sessionId !== undefined ? readCollapsed(sessionId) : false,
  )
  const [position, setPosition] = useState(() => ({ top: DEFAULT_TOP, right: DEFAULT_RIGHT }))

  // Persist collapse per session; reset the local flag when the session
  // switches so a stale flag never applies to a different session.
  useEffect(() => {
    if (sessionId === undefined) return
    setCollapsed(readCollapsed(sessionId))
  }, [sessionId])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      if (sessionId !== undefined) writeCollapsed(sessionId, next)
      return next
    })
  }, [sessionId])

  // Hide the board entirely when there is no session or no todos list.
  if (sessionId === undefined || todos === null || todos.length === 0) return null

  const ratioPercent = Math.round(progress.ratio * 100)

  return (
    <div
      data-dsh-plugin="codex-board"
      data-dsh-part="root"
      data-testid="codex-board"
      data-collapsed={collapsed}
      className={styles.root}
      style={{ top: position.top, right: position.right }}
    >
      <button
        type="button"
        data-dsh-part="header"
        data-testid="codex-board-header"
        className={styles.header}
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('board.expand') : t('board.collapse')}
      >
        <span className={styles.glyph}><BoardGlyph /></span>
        <span className={styles.title} data-testid="codex-board-title">{t('board.title')}</span>
        <span className={styles.count} data-testid="codex-board-count">
          {t('board.count', { completed: progress.completed, total: progress.total })}
        </span>
        <span className={styles.chevron} data-expanded={!collapsed}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2.5 4.5L6 8l3.5-3.5" />
          </svg>
        </span>
      </button>

      {!collapsed && (
        <div data-dsh-part="progress" data-testid="codex-board-progress">
          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: ratioPercent + '%' }}
              role="progressbar"
              aria-valuenow={progress.completed}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-label={t('board.sr.progress', { completed: progress.completed, total: progress.total })}
            />
          </div>
          <ul className={styles.list} data-testid="codex-board-list">
            {todos.map((todo, index) => (
              <li
                key={index}
                data-dsh-part="row"
                data-status={todo.status}
                data-testid="codex-board-row"
                className={styles.row}
              >
                <span
                  className={styles.marker}
                  data-status={todo.status}
                  aria-label={t('board.sr.status', { status: t(STATUS_KEYS[todo.status]) })}
                >
                  {todo.status === 'completed' && (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1.8 4.6l1.8 1.8L7.2 2.6" />
                    </svg>
                  )}
                </span>
                <span className={styles.text}>{todo.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
