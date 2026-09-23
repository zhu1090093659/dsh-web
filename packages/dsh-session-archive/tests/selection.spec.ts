import { describe, expect, it } from 'vitest'
import { filterRows, selectionSummary, sortRows, DEFAULT_FILTER_STATE } from '../src/core/selection.ts'
import type { ArchiveSessionRow } from '../src/core/types.ts'

function row(overrides: Partial<ArchiveSessionRow> & { id: string; title?: string }): ArchiveSessionRow {
  return {
    workspaceIds: [],
    archived: false,
    lastActivityReliable: true,
    running: false,
    blank: false,
    childIds: [],
    childCount: 0,
    issues: [],
    ...overrides,
  } as ArchiveSessionRow
}

const rows: ArchiveSessionRow[] = [
  row({ id: 'session-a', title: 'Alpha plan', workspaceIds: ['ws-1'], lastActivityAt: 300, sizeBytes: 30 }),
  row({ id: 'session-b', title: 'Beta review', workspaceIds: ['ws-1', 'ws-2'], lastActivityAt: 200, archived: true, archivedAt: 250 }),
  row({ id: 'session-c', workspaceIds: [], lastActivityAt: 100, issues: ['no-title'] }),
  row({ id: 'session-d', title: 'Gamma notes', archived: true, lastActivityReliable: false }),
]

describe('filterRows', () => {
  it('defaults to the archived view', () => {
    expect(DEFAULT_FILTER_STATE.status).toBe('archived')
  })

  it('filters by archive status', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'active' }).map((r) => r.id).sort()).toEqual(['session-a', 'session-c'])
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'archived' }).map((r) => r.id).sort()).toEqual(['session-b', 'session-d'])
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all' }).length).toBe(4)
  })

  it('filters by workspace including workspace-less', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all', workspaceId: 'ws-2' }).map((r) => r.id)).toEqual(['session-b'])
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all', workspaceId: 'none' }).map((r) => r.id).sort()).toEqual(['session-c', 'session-d'])
  })

  it('searches title and id case-insensitively', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all', query: 'alpha' }).map((r) => r.id)).toEqual(['session-a'])
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all', query: 'SESSION-C' }).map((r) => r.id)).toEqual(['session-c'])
  })

  it('filters issue rows', () => {
    expect(filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'all', issuesOnly: true }).map((r) => r.id)).toEqual(['session-c'])
  })
})

describe('sortRows', () => {
  it('sorts by last activity, unknown values last in both directions', () => {
    const desc = sortRows(rows, 'lastActivity', 'desc').map((r) => r.id)
    expect(desc.slice(0, 3)).toEqual(['session-a', 'session-b', 'session-c'])
    expect(desc[3]).toBe('session-d')
    const asc = sortRows(rows, 'lastActivity', 'asc').map((r) => r.id)
    expect(asc[0]).toBe('session-c')
    expect(asc[3]).toBe('session-d')
  })

  it('sorts by archive time, unknown last in both directions', () => {
    expect(sortRows(rows, 'archivedAt', 'desc').map((r) => r.id)).toEqual(['session-b', 'session-a', 'session-c', 'session-d'])
  })

  it('sorts by size, unknown sizes last in both directions', () => {
    const sized = [
      row({ id: 'session-a', sizeBytes: 30 }),
      row({ id: 'session-b', sizeBytes: 10 }),
      row({ id: 'session-c' }),
      row({ id: 'session-d', sizeBytes: 20 }),
    ]
    expect(sortRows(sized, 'size', 'desc').map((r) => r.id)).toEqual(['session-a', 'session-d', 'session-b', 'session-c'])
    expect(sortRows(sized, 'size', 'asc').map((r) => r.id)).toEqual(['session-b', 'session-d', 'session-a', 'session-c'])
  })

  it('keeps a real zero-byte size ahead of unknown sizes in both directions', () => {
    const zero = [row({ id: 'session-u' }), row({ id: 'session-z', sizeBytes: 0 })]
    expect(sortRows(zero, 'size', 'desc').map((r) => r.id)).toEqual(['session-z', 'session-u'])
    expect(sortRows(zero, 'size', 'asc').map((r) => r.id)).toEqual(['session-z', 'session-u'])
  })
})

describe('selectionSummary', () => {
  it('counts inside and outside the current filter', () => {
    const selection = new Set(['session-a', 'session-b'])
    const filtered = filterRows(rows, { ...DEFAULT_FILTER_STATE, status: 'archived' })
    const summary = selectionSummary(selection, filtered)
    expect(summary).toEqual({ selected: 2, inside: 1, outside: 1 })
  })
})
