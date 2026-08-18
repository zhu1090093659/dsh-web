/**
 * React bindings for the framework-free stores: useSyncExternalStore with a
 * stable snapshot (the stores return immutable snapshots, so selector-free
 * subscription is safe), plus a stable-callback helper for event handlers.
 * @module dsh-aionui-panel/client/hooks/useStore
 */

import { useSyncExternalStore } from 'react'
import type { StateHandle } from '../store.ts'

/** Subscribe a component to one store (full snapshot). */
export function useStore<S>(store: StateHandle<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

