/**
 * State machine behind the Manage tab: inventory refresh, per-row toggles,
 * and the outcome message of each switch. The store is the component's only
 * data face; every mutation goes through update() so renders stay consistent
 * with the wire.
 * @module @linxin666/dsh-plugin-manager/client/controller
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { PluginRow, SetEnabledResponse } from '../protocol.ts'
import type { PluginManagerApi } from './api.ts'

/** Full tab state. */
export interface PluginManagerState {
  phase: 'loading' | 'ready' | 'error'
  error?: string
  entries: PluginRow[]
  toggling: Record<string, boolean>
  /** One outcome message per entry (latest switch result). */
  rowNotices: Record<string, string>
}

/** Initial tab state. */
export function initialPluginManagerState(): PluginManagerState {
  return {
    phase: 'loading',
    entries: [],
    toggling: {},
    rowNotices: {},
  }
}

/** Controller dependencies (structural; the client apply adapts ctx). */
export interface PluginManagerControllerDeps {
  /** The route API client. */
  api: PluginManagerApi
}

/** The registration-side face the tab slot entry injects. */
export interface PluginManagerTabInjected {
  hooks: {
    /** Tab snapshot bound by the renderer as usePluginManager. */
    pluginManager: SnapshotStore<PluginManagerState>
  }
  /** Read the inventory; called when the tab renders. */
  load: () => Promise<void>
  /** Toggle one plugin entry. */
  toggle: (entryId: string, enabled: boolean) => Promise<void>
}

/** Render one switch outcome as a localized message key. */
export function outcomeKey(result: SetEnabledResponse): 'resultAppliedPersisted' | 'resultAppliedOnly' | 'resultDeferred' {
  if (!result.applied) return 'resultDeferred'
  return result.persisted ? 'resultAppliedPersisted' : 'resultAppliedOnly'
}

/** Bridges the tab component onto the manager routes. */
export class PluginManagerController {
  private readonly store: SnapshotStore<PluginManagerState>

  /** @param deps - api client. */
  constructor(private readonly deps: PluginManagerControllerDeps) {
    this.store = createSnapshotStore(initialPluginManagerState())
  }

  /** The face the slot registration injects. */
  inject(): PluginManagerTabInjected {
    return {
      hooks: { pluginManager: this.store },
      load: () => this.load(),
      toggle: (entryId, enabled) => this.toggle(entryId, enabled),
    }
  }

  /** Read the current snapshot (tests). */
  getSnapshot(): PluginManagerState {
    return this.store.getSnapshot()
  }

  /** Read the inventory. */
  async load(): Promise<void> {
    this.store.update((draft) => { draft.phase = 'loading'; draft.error = undefined })
    try {
      const result = await this.deps.api.list()
      this.store.update((draft) => {
        draft.phase = 'ready'
        draft.error = undefined
        draft.entries = result.entries
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.phase = 'error'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Toggle one entry and update its row with the outcome. */
  async toggle(entryId: string, enabled: boolean): Promise<void> {
    this.store.update((draft) => {
      draft.toggling[entryId] = true
      draft.error = undefined
    })
    try {
      const result = await this.deps.api.setEnabled(entryId, enabled)
      this.store.update((draft) => {
        const row = draft.entries.find(entry => entry.entryId === result.entryId)
        if (row !== undefined) {
          row.enabled = result.enabled
        }
        draft.rowNotices[entryId] = outcomeKey(result)
      })
    } catch (error) {
      this.store.update((draft) => {
        draft.rowNotices[entryId] = 'toggleFailed'
        draft.error = error instanceof Error ? error.message : String(error)
      })
    } finally {
      this.store.update((draft) => { delete draft.toggling[entryId] })
    }
  }
}
