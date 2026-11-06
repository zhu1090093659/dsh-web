import { describe, expect, it } from 'vitest'
import { descendantsOf, planDelete, clientProtectedReason, selectionFullyProtected } from '../src/core/cascade.ts'
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

  it('operator deleting the parent of a host-attached session is refused for the whole family', () => {
    // Given a family whose grandchild the host holds open
    const rows = [
      row({ id: 'session-p', childIds: ['session-c'], childCount: 1 }),
      row({ id: 'session-c', parentId: 'session-p', childIds: ['session-g'], childCount: 1 }),
      row({ id: 'session-g', parentId: 'session-c', hostProtectedReason: 'attached' }),
    ]

    // When the plan is computed from the merged client map, the way the confirm dialog does
    const plan = planDelete(rows, ['session-p'], clientProtectedReason(rows, undefined))

    // Then the entire family is skipped and the host attachment is named as the blocker
    expect(plan.targets).toEqual([])
    expect(plan.skipped.map((entry) => entry.id)).toEqual(['session-p', 'session-c', 'session-g'])
    for (const entry of plan.skipped) {
      expect(entry.reason).toBe('family-protected')
      expect(entry.detail).toBe('session-g:attached')
    }
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

  it('user sees the host attachment and in-flight facts as protected', () => {
    // Given one row the host holds open (attached) and one it is mutating (in-flight)
    const rows = [
      row({ id: 'session-attached', hostProtectedReason: 'attached' }),
      row({ id: 'session-inflight', hostProtectedReason: 'in-flight' }),
      row({ id: 'session-plain' }),
    ]

    // When the preview map is computed for the browser half
    const map = clientProtectedReason(rows, undefined)

    // Then both host facts are protected exactly as the host reports them
    expect(map.get('session-attached')).toBe('attached')
    expect(map.get('session-inflight')).toBe('in-flight')
    expect(map.has('session-plain')).toBe(false)
  })

  it('user gets the same winning reason the host plan reports', () => {
    // Given a row that is running in the feed AND held open by the host, a row
    // that is attached AND is the session being viewed, and a row that is
    // in-flight AND is the session being viewed
    const rows = [
      row({ id: 'session-attached-running', running: true, hostProtectedReason: 'attached' }),
      row({ id: 'session-cur-attached', hostProtectedReason: 'attached' }),
      row({ id: 'session-cur-inflight', hostProtectedReason: 'in-flight' }),
    ]

    // When the preview map is computed with that current session
    const map = clientProtectedReason(rows, 'session-cur-inflight')
    const attachedCurrent = clientProtectedReason(rows, 'session-cur-attached')

    // Then the fixture claims the same winner the host's plan would report:
    // in-flight > current > attached > running
    expect(map.get('session-attached-running')).toBe('attached')
    expect(attachedCurrent.get('session-cur-attached')).toBe('current')
    expect(map.get('session-cur-inflight')).toBe('in-flight')
  })

  it('user still sees running and current protection on an older host', () => {
    // Given rows from a host that predates ArchiveSessionRow.hostProtectedReason
    const rows = [row({ id: 'session-a', running: true }), row({ id: 'session-b' })]

    // When the preview map is computed
    const map = clientProtectedReason(rows, 'session-b')

    // Then only the facts this browser half can observe are protected
    expect([...map.entries()].sort()).toEqual([['session-a', 'running'], ['session-b', 'current']])
  })
})

describe('selectionFullyProtected', () => {
  const protectedReason = new Map([['session-a', 'attached'], ['session-b', 'current']])

  it('operator sees a fully protected selection as undeletable', () => {
    // Given a selection where every id carries a protection reason
    // When the affordance asks whether anything is left to delete
    // Then it reports nothing left
    expect(selectionFullyProtected(['session-a', 'session-b'], protectedReason)).toBe(true)
  })

  it('operator keeps the affordance when the selection mixes protected and deletable rows', () => {
    // Given a selection holding one protected and one deletable id
    // When the affordance asks whether anything is left to delete
    // Then it reports one deletable session
    expect(selectionFullyProtected(['session-a', 'session-plain'], protectedReason)).toBe(false)
  })

  it('operator with nothing selected gets no protection verdict', () => {
    // Given an empty selection
    // When the affordance asks whether every selected id is protected
    // Then it answers no, so an empty selection never claims to be blocked
    expect(selectionFullyProtected([], protectedReason)).toBe(false)
  })
})
