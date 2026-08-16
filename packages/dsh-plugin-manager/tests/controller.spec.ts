/**
 * Controller state machine: inventory refresh, row toggles, and outcome
 * notices with a mocked snapshot store and api client.
 */

import { describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the minimal
// snapshot-store engine the controller needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    let state = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      update: (mutator: (draft: unknown) => void) => { mutator(state) },
      set: (next: unknown) => { state = next },
    }
  },
}))
import { PluginManagerController } from '../src/client/controller.ts'
import { PluginManagerApi } from '../src/client/api.ts'
import type { ListResponse, PluginRow } from '../src/protocol.ts'

const row = (entryId: string, extra: Partial<PluginRow> = {}): PluginRow => ({
  entryId,
  moduleName: '@linxin666/dsh-client-ui-' + entryId,
  enabled: true,
  fiberPhase: 'active',
  protected: false,
  official: true,
  ...extra,
})

function makeDeps(overrides: Partial<{
  list: ListResponse
  setEnabledError: Error
}> = {}) {
  const api = {
    list: vi.fn(async (): Promise<ListResponse> => overrides.list ?? { entries: [] }),
    setEnabled: vi.fn(async () => {
      if (overrides.setEnabledError !== undefined) throw overrides.setEnabledError
      return { entryId: 'ui-task-board', enabled: false, applied: true, persisted: true, deferred: false }
    }),
  } as unknown as PluginManagerApi
  const controller = new PluginManagerController({ api })
  return { api, controller }
}

describe('PluginManagerController', () => {
  it('loads the inventory', async () => {
    const { controller } = makeDeps({ list: { entries: [row('ui-task-board')] } })
    await controller.load()
    const state = controller.getSnapshot()
    expect(state.phase).toBe('ready')
    expect(state.entries[0]?.entryId).toBe('ui-task-board')
  })

  it('surfaces load failures', async () => {
    const api = { list: vi.fn(async () => { throw new Error('boom') }) } as unknown as PluginManagerApi
    const controller = new PluginManagerController({ api })
    await controller.load()
    const state = controller.getSnapshot()
    expect(state.phase).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('toggles a row and records the outcome notice', async () => {
    const { controller } = makeDeps({ list: { entries: [row('ui-task-board')] } })
    await controller.load()
    await controller.toggle('ui-task-board', false)
    const state = controller.getSnapshot()
    expect(state.entries[0]).toMatchObject({ enabled: false })
    expect(state.rowNotices['ui-task-board']).toBe('resultAppliedPersisted')
    expect(state.toggling['ui-task-board']).toBeUndefined()
  })

  it('surfaces toggle failures', async () => {
    const { controller } = makeDeps({ list: { entries: [row('ui-task-board')] }, setEnabledError: new Error('boom') })
    await controller.load()
    await controller.toggle('ui-task-board', false)
    const state = controller.getSnapshot()
    expect(state.error).toBe('boom')
    expect(state.rowNotices['ui-task-board']).toBe('toggleFailed')
  })
})
