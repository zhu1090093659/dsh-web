/**
 * Global floating pet entry. The pet is host-global (its state, display and
 * interactions live on '/api/pet/*' endpoints with no session dimension), so
 * it must not ride a session-scoped slot — on the new-conversation screen no
 * session exists to scope a slot by, and the pet would vanish (issue #48).
 * The client half therefore mounts this entry straight onto 'document.body'
 * (see index.ts): while visible it renders the floating PetSprite (a portal
 * into the plugin root, so the root owns the whole surface), while hidden it
 * renders a fixed-position summon button. Which sprite renders is decided by
 * the host snapshot's pet id resolved against the registry list — no per-pet
 * component exists.
 * @module @linxin666/dsh-pet/client/PetDockEntry
 */

import { useEffect, useRef, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStoreInstance } from './pet-store.ts'
import { PetSprite } from './PetSprite.tsx'
import { PetRendererSwitch } from './renderers/PetRendererSwitch.tsx'
import { createDragStream, type DragStream } from './drag-stream.ts'
import { GameplayHud, type GameplayApi, type GameplayBus } from './gameplay-hud.tsx'
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
  /** Gameplay verb API (miku-pet generalization); wired but unused for pets without a gameplay block. */
  gameplay: GameplayApi
}

/** Composed props of the global pet entry (locale + injected; no slot runtime share). */
export type PetDockEntryProps =
  PetInjected
  & PropsLocale<typeof NS>
  & {
    /**
     * DOM node the floating sprite chrome portals into. Defaults to
     * document.body; the plugin apply passes its [data-dsh-plugin="pet"]
     * root so root-keyed suppressors (the portrait mobile layer) and skins
     * own the whole pet surface as one unit.
     */
    portalTarget?: Element
  }

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

  // Per-pet gameplay wiring: the coordination bus (HUD taps <-> chrome,
  // HUD track overrides <-> frames2d mount) and the shared drag stream.
  const auxRef = useRef<{ id: string; bus: GameplayBus; drag: DragStream } | null>(null)
  if (definition !== null && (auxRef.current === null || auxRef.current.id !== definition.id)) {
    auxRef.current = { id: definition.id, bus: {}, drag: createDragStream() }
  }
  const aux = auxRef.current
  const gameplay = definition?.gameplay

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
              {...(aux === null ? {} : { drag: aux.drag, bus: aux.bus })}
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
                portalTarget={props.portalTarget}
                dragDisabled={snapshot.gameplay?.mode === 'work'}
                {...(gameplay === undefined || aux === null
                  ? {}
                  : {
                      onGameplayTap: (fx: number, fy: number) => aux.bus.tap?.(fx, fy),
                      onGameplayMenu: () => aux.bus.openCard?.(),
                      hud: (
                        <GameplayHud
                          definition={definition}
                          store={store}
                          api={props.gameplay}
                          bus={aux.bus}
                          drag={aux.drag}
                          t={props.t}
                        />
                      ),
                    })}
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
