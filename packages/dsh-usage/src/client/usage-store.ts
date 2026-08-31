/**
 * Browser-side usage store: the overview snapshot polled from the host plus
 * the fetch lifecycle. Section-local: the store lives while the settings
 * section is mounted, so polling only runs while the page is open.
 * @module @linxin666/dsh-usage/client/usage-store
 */

import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle, EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
import type { UsageOverviewView } from '../core/types.ts'

/** Section UI state as consumers see it. */
export interface UsageUiState {
  /** Latest host overview; null before the first successful fetch. */
  snapshot: UsageOverviewView | null
  /** Fetch lifecycle. */
  status: 'loading' | 'ready' | 'error'
  /** Transport error message, when any. */
  error: string | null
}

/** Store write set. */
export type UsageUiActions = {
  /** Replace the overview (poll result). */
  setSnapshot: (draft: UsageUiState, snapshot: UsageOverviewView) => void
  /** Mark the fetch lifecycle. */
  setState: (draft: UsageUiState, status: UsageUiState['status'], error: string | null) => void
}

/** Create the usage store handle (apply world only; never module-level). */
export function createUsageStore(): EngineStoreHandle<UsageUiState, UsageUiActions> {
  return defineStore({
    init: (): UsageUiState => ({
      snapshot: null,
      status: 'loading',
      error: null,
    }),
    actions: {
      setSnapshot: (draft, snapshot) => {
        draft.snapshot = snapshot
        draft.status = 'ready'
        draft.error = null
      },
      setState: (draft, status, error) => {
        draft.status = status
        draft.error = error
      },
    },
  })
}

export type UsageStoreInstance = EngineStoreInstance<UsageUiState, UsageUiActions>
