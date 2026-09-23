/**
 * Browser-side inventory filtering, sorting, and selection accounting. Pure
 * logic over the complete inventory the host serves, so "select all" always
 * means the full filtered result set — never just the rendered window.
 * @module @linxin666/dsh-session-archive/core/selection
 */

import type { ArchiveSessionRow, ArchiveIssueCode } from './types.ts'

export type StatusFilter = 'all' | 'active' | 'archived'
export type WorkspaceFilter = 'any' | 'none' | string
export type SortKey = 'lastActivity' | 'archivedAt' | 'createdAt' | 'title' | 'size'
export type SortDir = 'asc' | 'desc'

export interface FilterState {
  status: StatusFilter
  workspaceId: WorkspaceFilter
  query: string
  issuesOnly: boolean
}

/**
 * The section opens on the ARCHIVED view (the management surface's primary
 * audience) with pagination at 20 rows per page. Filtering/sorting resets to
 * the first page; selection always spans the complete filtered set, never
 * just the current page.
 */
export const DEFAULT_FILTER_STATE: FilterState = {
  status: 'archived',
  workspaceId: 'any',
  query: '',
  issuesOnly: false,
}

/** Rows per page. */
export const PAGE_SIZE = 20

function matchesQuery(row: ArchiveSessionRow, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  if (row.id.toLowerCase().includes(needle)) return true
  return row.title !== undefined && row.title.toLowerCase().includes(needle)
}

export function filterRows(rows: readonly ArchiveSessionRow[], filter: FilterState): ArchiveSessionRow[] {
  const query = filter.query.trim().toLowerCase()
  return rows.filter((row) => {
    if (filter.status === 'active' && row.archived) return false
    if (filter.status === 'archived' && !row.archived) return false
    if (filter.workspaceId === 'none' && row.workspaceIds.length > 0) return false
    if (filter.workspaceId !== 'any' && filter.workspaceId !== 'none' && !row.workspaceIds.includes(filter.workspaceId)) return false
    if (filter.issuesOnly && row.issues.length === 0) return false
    return matchesQuery(row, query)
  })
}

function timeOr(row: ArchiveSessionRow, key: SortKey): number | undefined {
  if (key === 'lastActivity') return row.lastActivityAt
  if (key === 'archivedAt') return row.archivedAt
  if (key === 'createdAt') return row.createdAt
  return undefined
}

export function sortRows(rows: readonly ArchiveSessionRow[], key: SortKey, dir: SortDir): ArchiveSessionRow[] {
  const sign = dir === 'asc' ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    if (key === 'title') {
      const at = a.title ?? ''
      const bt = b.title ?? ''
      if (at !== bt) return sign * at.localeCompare(bt)
      return a.id.localeCompare(b.id)
    }
    if (key === 'size') {
      const av = a.sizeBytes
      const bv = b.sizeBytes
      // Unknown sizes sort last in either direction, exactly like the time
      // keys below: a missing size is not the smallest file.
      if (av === undefined && bv === undefined) return a.id.localeCompare(b.id)
      if (av === undefined) return 1
      if (bv === undefined) return -1
      if (av !== bv) return sign * (av - bv)
      return a.id.localeCompare(b.id)
    }
    const av = timeOr(a, key)
    const bv = timeOr(b, key)
    // Unknown times sort last in either direction.
    if (av === undefined && bv === undefined) return a.id.localeCompare(b.id)
    if (av === undefined) return 1
    if (bv === undefined) return -1
    if (av !== bv) return sign * (av - bv)
    return a.id.localeCompare(b.id)
  })
  return copy
}

/** Selection accounting: what the user holds vs what the current filter shows. */
export interface SelectionSummary {
  selected: number
  inside: number
  outside: number
}

export function selectionSummary(selection: ReadonlySet<string>, filtered: readonly ArchiveSessionRow[]): SelectionSummary {
  let inside = 0
  for (const row of filtered) {
    if (selection.has(row.id)) inside += 1
  }
  const selected = selection.size
  return { selected, inside, outside: selected - inside }
}

export const ISSUE_CODES: readonly ArchiveIssueCode[] = ['no-title', 'no-archive-time', 'unreadable', 'no-data']
