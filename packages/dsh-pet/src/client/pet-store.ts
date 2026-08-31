/**
 * Browser-side pet store: the pet state snapshot plus transient UI feedback
 * (reaction bubbles), written only through the store's audit actions. The
 * RPC polling and interactions live in the plugin apply body; components
 * only ever read snapshots.
 * @module @linxin666/dsh-pet/client/pet-store
 */

import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { EngineStoreHandle, EngineStoreInstance } from '@deepseek-ai/dsh-client-store'
import type { PetGameplayStateView, PetStateView } from '../service.ts'
import type { PetInteraction } from '../affinity.ts'
import type { PetDefinition } from '../registry.ts'

/** One transient reaction bubble on the pet. */
export interface PetFeedback {
  /** Bubble copy. */
  text: string
  /** Interaction kind driving the reaction animation. */
  kind: PetInteraction | 'none'
  /** Epoch ms when the bubble appeared (for expiry). */
  at: number
}

/** Pet UI state as consumers see it. */
export interface PetUiState {
  /** Latest host snapshot; null before the first successful fetch. */
  snapshot: PetStateView | null
  /** The registry list the host serves (atlas URLs + geometry + tracks). */
  pets: PetDefinition[]
  /** Fetch lifecycle. */
  state: 'loading' | 'ready' | 'error'
  /** Transport error message (for the debug surface), when any. */
  error: string | null
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
}

/** Store write set. */
export type PetUiActions = {
  /** Replace the host snapshot (poll result). */
  setSnapshot: (draft: PetUiState, snapshot: PetStateView) => void
  /** Replace the registry list. */
  setPets: (draft: PetUiState, pets: PetDefinition[]) => void
  /** Mark the fetch lifecycle. */
  setState: (draft: PetUiState, state: PetUiState['state'], error: string | null) => void
  /** Show a reaction bubble. */
  setFeedback: (draft: PetUiState, feedback: PetFeedback | null) => void
  /**
   * Patch the gameplay slice of the snapshot (verb write-back), so the HUD
   * reflects a touch/mode/buy result immediately instead of waiting one
   * poll tick (2 s).
   */
  setGameplayView: (draft: PetUiState, view: PetGameplayStateView) => void
}

/** Create the pet store handle (apply world only; never module-level). */
export function createPetStore(): EngineStoreHandle<PetUiState, PetUiActions> {
  return defineStore({
    init: (): PetUiState => ({
      snapshot: null,
      pets: [],
      state: 'loading',
      error: null,
      feedback: null,
    }),
    actions: {
      setSnapshot: (draft, snapshot) => {
        draft.snapshot = snapshot
        draft.state = 'ready'
        draft.error = null
      },
      setPets: (draft, pets) => {
        draft.pets = pets
      },
      setState: (draft, state, error) => {
        draft.state = state
        draft.error = error
      },
      setFeedback: (draft, feedback) => {
        draft.feedback = feedback
      },
      setGameplayView: (draft, view) => {
        if (draft.snapshot !== null) draft.snapshot = { ...draft.snapshot, gameplay: view }
      },
    },
  })
}

export type { PetInteraction }

/**
 * A live pet store instance (one per host, owned by the plugin apply body —
 * the pet itself is host-global, so its UI state must not ride the slot
 * system's per-session store scoping).
 */
export type PetStoreInstance = EngineStoreInstance<PetUiState, PetUiActions>

