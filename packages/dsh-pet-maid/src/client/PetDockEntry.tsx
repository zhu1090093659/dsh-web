/**
 * Global floating pet entry. The pet is host-global (its state, display and
 * interactions live on `/api/pet-maid/*` endpoints with no session dimension),
 * so it must not ride a session-scoped slot — on the new-conversation screen
 * no session exists to scope a slot by, and the pet would vanish (the same
 * issue dsh-pet solved by mounting globally). The client half therefore
 * mounts this entry straight onto `document.body` (see index.ts): while
 * visible it renders the floating MaidPet (a portal), while hidden it renders
 * a fixed-position summon button.
 * @module @linxin666/dsh-pet-maid/client/PetDockEntry
 */

import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStoreInstance } from './pet-store.ts'
import { MaidPet } from './MaidPet.tsx'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Injected actions handed to the dock entry component. */
export interface PetInjected {
  /** The app-wide pet store instance (snapshot + feedback). */
  store: PetStoreInstance
  /** Ensure the first snapshot is fetched (called on mount). */
  ensure: () => void
  /** Pet the whale maid (single click). */
  pet: () => void
  /** Feed the whale maid. */
  feed: () => void
  /** Hide the whale maid. */
  hide: () => void
  /** Summon the hidden whale maid back. */
  summon: () => void
  /** Persist a drag position. */
  dragEnd: (right: number, bottom: number) => void
  /** Rename the pet (persisted by the host). */
  rename: (name: string) => void
  /** Clear the reaction bubble. */
  feedbackDone: () => void
}

/** Composed props of the global pet entry (locale + injected; no slot runtime share). */
export type PetDockEntryProps =
  PetInjected
  & PropsLocale<typeof NS>

const DEFAULT_DISPLAY: PetDisplayConfig = { visible: true, size: 160, right: 48, bottom: 20, eyeTracking: true, miniMode: true }

/**
 * Dock entry: while the pet is visible, mount the floating MaidPet (it
 * portals itself onto document.body); while hidden, render the summon
 * button so the pet can always come back. The store is the plugin-owned
 * single instance — the slot system provides none because the pet is
 * host-global, not session-scoped.
 */
export function PetDockEntry(props: PetDockEntryProps): ReactElement {
  const { store, ensure } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const snapshot = ui.snapshot
  const feedback = ui.feedback
  const visible = snapshot?.display.visible ?? true

  useEffect(() => {
    ensure()
  }, [ensure])

  if (visible) {
    return (
      <span data-pet-dock data-testid="pet-dock">
        <MaidPet
          snapshot={snapshot}
          display={snapshot?.display ?? DEFAULT_DISPLAY}
          feedback={feedback}
          onPet={props.pet}
          onFeed={props.feed}
          onHide={props.hide}
          onDragEnd={props.dragEnd}
          onRename={props.rename}
          onFeedbackDone={props.feedbackDone}
          t={props.t}
        />
      </span>
    )
  }
  const display = snapshot?.display ?? DEFAULT_DISPLAY
  return (
    <button
      type="button"
      className={styles.summon}
      style={{
        position: 'fixed',
        right: display.right,
        bottom: display.bottom,
        zIndex: 2147483000,
      }}
      onClick={props.summon}
      data-testid="pet-summon"
    >
      {props.t('pet.summon', { name: snapshot?.name ?? '女仆鲸鱼娘' })}
    </button>
  )
}
