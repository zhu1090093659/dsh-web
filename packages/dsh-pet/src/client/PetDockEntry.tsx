/**
 * Global floating pet entry. The pet is host-global (its state, display and
 * interactions live on '/api/pet/*' endpoints with no session dimension), so
 * it must not ride a session-scoped slot — on the new-conversation screen no
 * session exists to scope a slot by, and the pet would vanish (issue #48).
 * The client half therefore mounts this entry straight onto 'document.body'
 * (see index.ts): while visible it renders the floating PetSprite (a
 * portal), while hidden it renders a fixed-position summon button. Which
 * sprite renders is decided by the host snapshot's pet id resolved against
 * the registry list — no per-pet component exists.
 * @module @linxin666/dsh-pet/client/PetDockEntry
 */

import { useEffect, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStoreInstance } from './pet-store.ts'
import { PetSprite } from './PetSprite.tsx'
import { PetRendererSwitch } from './renderers/PetRendererSwitch.tsx'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Injected actions handed to the dock entry component. */
export interface PetInjected {
  /** The app-wide pet store instance (snapshot + registry list + feedback). */
  store: PetStoreInstance
  /** Ensure the first snapshot (and registry list) is fetched (called on mount). */
  ensure: () => void
  /** Pet the sprite (click). */
  pet: () => void
  /** Feed the sprite. */
  feed: () => void
  /** Hide the sprite. */
  hide: () => void
  /** Summon the hidden sprite back. */
  summon: () => void
  /** Persist a drag position. */
  dragEnd: (right: number, bottom: number) => void
  /** Rename the selected pet (persisted by the host). */
  rename: (name: string) => void
  /** Navigate the GUI to the session a bubble reports on. */
  openSession: (sessionId: string) => void
  /** Clear the reaction bubble. */
  feedbackDone: () => void
}

/** Composed props of the global pet entry (locale + injected; no slot runtime share). */
export type PetDockEntryProps =
  PetInjected
  & PropsLocale<typeof NS>

const DEFAULT_DISPLAY: PetDisplayConfig = { visible: true, size: 160, right: 24, bottom: 20 }

/**
 * Dock entry: while the pet is visible, mount the floating PetSprite (it
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
  const definition = ui.pets.find(entry => entry.id === snapshot?.pet.id) ?? null
  const visible = snapshot?.display.visible ?? true

  useEffect(() => {
    ensure()
  }, [ensure])

  if (visible) {
    return (
      <span data-pet-dock data-testid="pet-dock">
        {snapshot === null || definition === null
          ? null
          : (
            <PetRendererSwitch
              definition={definition}
              phase={snapshot?.phase ?? 'idle'}
              onPet={props.pet}
              t={props.t}
            >
              <PetSprite
                snapshot={snapshot}
                definition={definition}
                display={snapshot.display}
                feedback={feedback}
                onPet={props.pet}
                onFeed={props.feed}
                onHide={props.hide}
                onDragEnd={props.dragEnd}
                onRename={props.rename}
                onOpenSession={props.openSession}
                onFeedbackDone={props.feedbackDone}
                t={props.t}
              />
            </PetRendererSwitch>
          )}
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
      data-dsh-part="summon-button"
    >
      {props.t('pet.summon', { name: snapshot?.name ?? '' })}
    </button>
  )
}
