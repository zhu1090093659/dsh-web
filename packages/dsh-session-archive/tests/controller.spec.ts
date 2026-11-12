import { describe, expect, it } from 'vitest'
import { ArchiveController, chunkDeleteTargets, chunkPlain } from '../src/client/archive-controller.ts'
import type { ArchiveApi } from '../src/client/api.ts'
import type { ArchiveSessionRow, BatchResponse, InventoryView } from '../src/core/types.ts'

function row(overrides: Partial<ArchiveSessionRow> & { id: string }): ArchiveSessionRow {
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
  }
}

describe('chunkDeleteTargets', () => {
  const rows = [
    row({ id: 'session-p', childIds: ['session-c1', 'session-c2'], childCount: 2 }),
    row({ id: 'session-c1', parentId: 'session-p' }),
    row({ id: 'session-c2', parentId: 'session-p' }),
    ...Array.from({ length: 310 }, (_, index) => row({ id: `session-x${index}` })),
  ]

  it('keeps families intact within one chunk', () => {
    const chunks = chunkDeleteTargets(rows, ['session-p', ...Array.from({ length: 310 }, (_, index) => `session-x${index}`)])
    const flat = chunks.flat()
    expect(flat).toHaveLength(313)
    const positions = new Map(flat.map((id, index) => [id, index]))
    expect(positions.get('session-p')).toBeLessThan(positions.get('session-c1') as number)
    expect(positions.get('session-p')).toBeLessThan(positions.get('session-c2') as number)
    // No chunk splits the family: the parent and both children share one chunk.
    const parentChunk = chunks.find((chunk) => chunk.includes('session-p'))
    expect(parentChunk).toContain('session-c1')
    expect(parentChunk).toContain('session-c2')
    // Chunks are bounded (family may exceed the bound, plain items never do).
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(310)
  })

  it('partitions plain chunks by fixed size', () => {
    expect(chunkPlain(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })
})

function makeInventory(rows: ArchiveSessionRow[]): InventoryView {
  return {
    generatedAt: 0,
    rows,
    workspaces: [],
    archivedSessionIds: [],
    auto: { cycleRunning: false },
  }
}

function stubApi(overrides: Partial<ArchiveApi> = {}): { api: ArchiveApi; calls: { path: string; ids: string[]; expected?: number }[] } {
  const calls: { path: string; ids: string[]; expected?: number }[] = []
  const api: ArchiveApi = {
    inventory: () => Promise.resolve(makeInventory([])),
    preview: () => Promise.reject(new Error('not used')),
    archive: (ids) => {
      calls.push({ path: 'archive', ids: [...ids] })
      return Promise.resolve({ results: ids.map((id) => ({ id, status: 'ok' as const })), freedBytes: 0 })
    },
    unarchive: (ids) => {
      calls.push({ path: 'unarchive', ids: [...ids] })
      return Promise.resolve({ results: ids.map((id) => ({ id, status: 'ok' as const })), freedBytes: 0 })
    },
    deleteSessions: (ids, _current, expectedTotal) => {
      calls.push({ path: 'delete', ids: [...ids], expected: expectedTotal })
      return Promise.resolve({ results: ids.map((id) => ({ id, status: 'ok' as const })), freedBytes: 10 })
    },
    autoPreview: () => Promise.reject(new Error('not used')),
    autoRun: () => Promise.reject(new Error('not used')),
    ...overrides,
  }
  return { api, calls }
}

describe('ArchiveController.runBatch', () => {
  it('chunks large batches and tracks progress per chunk', async () => {
    const rows = Array.from({ length: 450 }, (_, index) => row({ id: `session-${index}` }))
    const { api, calls } = stubApi()
    const controller = new ArchiveController({ api })
    controller.store.actions.setInventory(makeInventory(rows))
    await controller.runBatch('archive', rows.map((entry) => entry.id))
    expect(calls.length).toBe(Math.ceil(450 / 200))
    const ui = controller.store.getSnapshot()
    expect(ui.batch?.total).toBe(450)
    expect(ui.batch?.processed).toBe(450)
    expect(ui.batch?.running).toBe(false)
    expect(ui.batch?.results.every((result) => result.status === 'ok')).toBe(true)
  })

  it('delete runs family-partitioned chunks with expected totals and reports freed bytes', async () => {
    const rows = [
      row({ id: 'session-p', childIds: ['session-c'], childCount: 1 }),
      row({ id: 'session-c', parentId: 'session-p' }),
    ]
    const { api, calls } = stubApi()
    const controller = new ArchiveController({ api })
    controller.store.actions.setInventory(makeInventory(rows))
    await controller.runBatch('delete', ['session-p'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.ids.sort()).toEqual(['session-c', 'session-p'])
    expect(calls[0]?.expected).toBe(2)
    expect(controller.store.getSnapshot().batch?.freedBytes).toBe(10)
  })

  it('counts protected members as skipped before any request', async () => {
    const rows = [
      row({ id: 'session-run', running: true }),
      row({ id: 'session-x' }),
    ]
    const { api, calls } = stubApi()
    const controller = new ArchiveController({ api })
    controller.store.actions.setInventory(makeInventory(rows))
    await controller.runBatch('delete', ['session-run', 'session-x'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.ids).toEqual(['session-x'])
    const batch = controller.store.getSnapshot().batch
    expect(batch?.total).toBe(2)
    const skipped = batch?.results.find((result) => result.id === 'session-run')
    expect(skipped?.status).toBe('skipped')
    expect(skipped?.reason).toBe('running')
  })

  it('operator sees host-protected sessions counted as skipped before any request', async () => {
    // Given rows the host protects for reasons this browser half cannot observe,
    // beside one it protects by being the session the user is viewing
    const rows = [
      row({ id: 'session-attached', hostProtectedReason: 'attached' }),
      row({ id: 'session-inflight', hostProtectedReason: 'in-flight' }),
      row({ id: 'session-cur' }),
      row({ id: 'session-x' }),
    ]
    const { api, calls } = stubApi()
    const controller = new ArchiveController({ api, sessions: { current: () => 'session-cur' } })
    controller.store.actions.setInventory(makeInventory(rows))

    // When the user confirms a delete covering all four
    await controller.confirmDelete(['session-attached', 'session-inflight', 'session-cur', 'session-x'])
    const confirm = controller.store.getSnapshot().confirmDelete

    // Then the dialog counts only the deletable session and reports three skips
    expect(confirm?.total).toBe(1)
    expect(confirm?.skippedProtected).toBe(3)

    // And the batch sends only that session, recording each skip with its own reason
    await controller.runBatch('delete', ['session-attached', 'session-inflight', 'session-cur', 'session-x'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.ids).toEqual(['session-x'])
    const skipped = new Map((controller.store.getSnapshot().batch?.results ?? [])
      .filter((result) => result.status === 'skipped')
      .map((result) => [result.id, result.reason]))
    expect(skipped.get('session-attached')).toBe('attached')
    expect(skipped.get('session-inflight')).toBe('in-flight')
    expect(skipped.get('session-cur')).toBe('current')
  })

  it('marks a chunk failed when the API throws and keeps the rest', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => row({ id: `session-${index}` }))
    let failOnce = true
    const { api, calls } = stubApi({
      archive: (ids) => {
        calls.push({ path: 'archive', ids: [...ids] })
        if (failOnce) {
          failOnce = false
          return Promise.reject(new Error('transport down'))
        }
        return Promise.resolve({ results: ids.map((id) => ({ id, status: 'ok' as const })), freedBytes: 0 })
      },
    })
    const controller = new ArchiveController({ api })
    controller.store.actions.setInventory(makeInventory(rows))
    await controller.runBatch('archive', rows.map((entry) => entry.id))
    const batch = controller.store.getSnapshot().batch
    expect(batch?.running).toBe(false)
    expect(batch?.error).toContain('transport down')
    // The whole (single) chunk failed together.
    expect(batch?.results.filter((result) => result.status === 'failed')).toHaveLength(3)
    // Retry-failed re-sends only the failed ids.
    failOnce = false
    await controller.retryFailed()
    expect(calls[1]?.ids).toEqual(calls[0]?.ids)
    expect(controller.store.getSnapshot().batch?.results.every((result) => result.status === 'ok')).toBe(true)
  })

  it('recomputes the plan when the inventory changed underneath (plan-mismatch surfacing)', async () => {
    const rows = [row({ id: 'session-a' })]
    const responses: BatchResponse[] = [
      { results: [{ id: 'session-a', status: 'failed', reason: 'error', detail: 'plan mismatch' }], freedBytes: 0 },
    ]
    const { api, calls } = stubApi({
      deleteSessions: (ids, _current, expected) => {
        calls.push({ path: 'delete', ids: [...ids], expected })
        return Promise.resolve(responses.shift() as BatchResponse)
      },
    })
    const controller = new ArchiveController({ api })
    controller.store.actions.setInventory(makeInventory(rows))
    await controller.runBatch('delete', ['session-a'])
    expect(controller.store.getSnapshot().batch?.results[0]?.status).toBe('failed')
  })
})
