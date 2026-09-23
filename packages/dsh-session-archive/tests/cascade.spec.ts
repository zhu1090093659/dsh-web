import { describe, expect, it } from 'vitest'
import { descendantsOf, planDelete, clientProtectedReason } from '../src/core/cascade.ts'
import type { ArchiveSessionRow } from '../src/core/types.ts'

function row(overrides: Partial<ArchiveSessionRow> & { id: string }): ArchiveSessionRow {
  return {
    workspaceIds: [],
    archived: false,
    lastActivityReliable: false,
    running: false,
    blank: false,
    childIds: [],
    childCount: 0,
    issues: [],
    ...overrides,
  }
}

function family(): ArchiveSessionRow[] {
  // parent -> child1, child2 -> grandchild
  return [
    row({ id: 'session-p', childIds: ['session-c1', 'session-c2'], childCount: 2, sizeBytes: 100 }),
    row({ id: 'session-c1', parentId: 'session-p', sizeBytes: 10 }),
    row({ id: 'session-c2', parentId: 'session-p', childIds: ['session-g'], childCount: 1, sizeBytes: 20 }),
    row({ id: 'session-g', parentId: 'session-c2', sizeBytes: 5 }),
  ]
}

describe('descendantsOf', () => {
  it('collects the full descendant closure', () => {
    expect(descendantsOf(family(), 'session-p').sort()).toEqual(['session-c1', 'session-c2', 'session-g'])
    expect(descendantsOf(family(), 'session-c2')).toEqual(['session-g'])
    expect(descendantsOf(family(), 'session-g')).toEqual([])
  })
})

describe('planDelete', () => {
  it('expands the family: deleting the parent targets all descendants', () => {
    const plan = planDelete(family(), ['session-p'], new Map())
    expect([...plan.targets].sort()).toEqual(['session-c1', 'session-c2', 'session-g', 'session-p'])
    expect(plan.skipped).toEqual([])
    expect(plan.totalBytes).toBe(135)
  })

  it('allows deleting a child with no protected descendants alone', () => {
    const plan = planDelete(family(), ['session-c2'], new Map())
    expect([...plan.targets].sort()).toEqual(['session-c2', 'session-g'])
  })

  it('skips the whole family when any descendant is protected', () => {
    const plan = planDelete(family(), ['session-p'], new Map([['session-g', 'running']]))
    expect(plan.targets).toEqual([])
    expect(plan.skipped.map((entry) => entry.id).sort()).toEqual(['session-c1', 'session-c2', 'session-g', 'session-p'])
    for (const entry of plan.skipped) {
      expect(entry.status).toBe('skipped')
      expect(entry.reason).toBe('family-protected')
      expect(entry.detail).toContain('session-g')
    }
  })

  it('skips a protected direct id with its own reason and leaves its family untouched', () => {
    const plan = planDelete(family(), ['session-p'], new Map([['session-p', 'current']]))
    expect(plan.targets).toEqual([])
    expect(plan.skipped).toEqual([{ id: 'session-p', status: 'skipped', reason: 'current' }])
  })

  it('reports unknown ids as not-found without affecting the rest', () => {
    const plan = planDelete(family(), ['session-missing', 'session-c1'], new Map())
    expect(plan.targets).toEqual(['session-c1'])
    expect(plan.skipped).toEqual([{ id: 'session-missing', status: 'skipped', reason: 'not-found' }])
  })

  it('deduplicates overlapping direct selections (parent and child both selected)', () => {
    const plan = planDelete(family(), ['session-p', 'session-c1', 'session-g'], new Map())
    expect([...plan.targets].sort()).toEqual(['session-c1', 'session-c2', 'session-g', 'session-p'])
  })

  it('records each skipped member once when a protected child is also selected', () => {
    const plan = planDelete(family(), ['session-p', 'session-g'], new Map([['session-g', 'running']]))
    expect(plan.targets).toEqual([])
    expect(plan.skipped.map((entry) => entry.id).sort()).toEqual(['session-c1', 'session-c2', 'session-g', 'session-p'])
    // The directly selected protected child keeps its own reason; the family
    // entry from the parent must not shadow it.
    const grandchild = plan.skipped.filter((entry) => entry.id === 'session-g')
    expect(grandchild).toHaveLength(1)
    expect(grandchild[0]).toMatchObject({ status: 'skipped', reason: 'running' })
  })

  it('keeps the family reason for a protected member that is not directly selected', () => {
    const plan = planDelete(family(), ['session-p', 'session-c2'], new Map([['session-g', 'running']]))
    expect(plan.targets).toEqual([])
    expect(plan.skipped.map((entry) => entry.id).sort()).toEqual(['session-c1', 'session-c2', 'session-g', 'session-p'])
    const grandchild = plan.skipped.filter((entry) => entry.id === 'session-g')
    expect(grandchild).toHaveLength(1)
    expect(grandchild[0]).toMatchObject({ reason: 'family-protected', detail: 'session-g:running' })
  })
})

describe('clientProtectedReason', () => {
  it('marks running rows and the current session', () => {
    const rows = [row({ id: 'session-a', running: true }), row({ id: 'session-b' })]
    const map = clientProtectedReason(rows, 'session-b')
    expect(map.get('session-a')).toBe('running')
    expect(map.get('session-b')).toBe('current')
    expect(map.size).toBe(2)
  })
})
