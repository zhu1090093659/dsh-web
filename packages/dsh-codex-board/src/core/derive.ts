/**
 * Codex-board domain model: derive the floating-board view from the session
 * todos projection. Framework-free pure functions so the mapping is
 * unit-testable in isolation.
 *
 * The todos projection is the whole list written by the `todo_write` tool
 * (`{content, status}[]` with status `pending | in_progress | completed`),
 * or `null` before the first write / after a new turn starts. The board
 * renders nothing for absent lists, a progress summary for a present one.
 */

/** Todo status, mirroring the `todo_write` tool enum. */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** One todo row from the session projection. */
export interface TodoItem {
  /** The task text (non-empty after tool validation). */
  content: string
  /** Current lifecycle status. */
  status: TodoStatus
}

/** Progress summary derived from a todos list. */
export interface TodoProgress {
  /** Total row count. */
  total: number
  /** Rows marked completed. */
  completed: number
  /** Rows currently in progress. */
  inProgress: number
  /** Rows still pending. */
  pending: number
  /** 0..1 completion ratio (0 for an empty list). */
  ratio: number
  /** 1-based index of the first in-progress row, 0 when none. */
  activeIndex: number
}

/** Empty progress for absent/empty lists. */
const EMPTY_PROGRESS: TodoProgress = {
  total: 0,
  completed: 0,
  inProgress: 0,
  pending: 0,
  ratio: 0,
  activeIndex: 0,
}

/**
 * Derive the progress summary from a todos projection value.
 * @param todos - the projection value (null = absent).
 * @returns progress summary (empty for absent/empty lists).
 */
export function deriveProgress(todos: readonly TodoItem[] | null): TodoProgress {
  if (todos === null || todos.length === 0) return EMPTY_PROGRESS
  let completed = 0
  let inProgress = 0
  let activeIndex = 0
  for (let i = 0; i < todos.length; i += 1) {
    const status = todos[i].status
    if (status === 'completed') completed += 1
    else if (status === 'in_progress') {
      inProgress += 1
      if (activeIndex === 0) activeIndex = i + 1
    }
  }
  const total = todos.length
  return {
    total,
    completed,
    inProgress,
    pending: total - completed - inProgress,
    ratio: total === 0 ? 0 : completed / total,
    activeIndex,
  }
}

/** Board collapsed state key per session (localStorage namespace). */
const COLLAPSE_KEY_PREFIX = 'dsh.codexBoard.collapsed.v1.'

/** Read a session's collapsed state from localStorage (false when absent/unavailable). */
export function readCollapsed(sessionId: string): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY_PREFIX + sessionId) === '1'
  } catch {
    return false
  }
}

/** Persist a session's collapsed state to localStorage (best effort). */
export function writeCollapsed(sessionId: string, collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(COLLAPSE_KEY_PREFIX + sessionId, '1')
    else localStorage.removeItem(COLLAPSE_KEY_PREFIX + sessionId)
  } catch {
    // storage unavailable (private mode): collapsing still works for the tab
  }
}
