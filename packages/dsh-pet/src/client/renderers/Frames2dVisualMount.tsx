/**
 * Frames2d visual mount — the React bridge between the pet center chrome
 * and the imperative frames2d renderer, mirroring the live2d mount. The
 * bridge owns the contract context (asset base, phase stream, interaction
 * write-back, activation cleanups), feeds the polled phase into the stream,
 * forwards the chrome's drag gesture onto the conventional 'drag' track
 * (when the pet declares one), and renders the localized fallback card when
 * the served config is invalid.
 * @module @linxin666/dsh-pet/client/renderers/Frames2dVisualMount
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition } from '../../registry.ts'
import type { ActivityPhase } from '../../state.ts'
import { createPhaseStream, type PhaseStream } from '../phase-stream.ts'
import type { DragStream } from '../drag-stream.ts'
import type { PetRendererContext } from '../../contracts/renderer.ts'
import { defaultPetRendererRegistry } from './registry.ts'
import type { Frames2dRendererHandle } from './frames2d.ts'
import type { GameplayBus } from '../gameplay-hud.tsx'
import type { NS } from '../locales.ts'

/** Mount the frames2d renderer as the sprite's visual (inside the chrome). */
export function Frames2dVisualMount(props: {
  definition: PetDefinition
  phase: ActivityPhase
  onPet: () => void
  /** Chrome drag gesture stream (the renderer switch owns it). */
  drag: DragStream
  /** Gameplay coordination bus; the mount registers its track override. */
  bus?: GameplayBus
  t: PropsLocale<typeof NS>['t']
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<PhaseStream | null>(null)
  const handleRef = useRef<Frames2dRendererHandle | null>(null)
  const [invalid, setInvalid] = useState(false)

  // One activation per pet definition: build the contract context and mount.
  useEffect(() => {
    setInvalid(false)
    const container = containerRef.current
    const frames2d = props.definition.frames2d
    if (container === null || frames2d === undefined) return undefined
    streamRef.current ??= createPhaseStream(props.phase)
    const cleanups: (() => void)[] = []
    const ctx: PetRendererContext = {
      petId: props.definition.id,
      assetBase: '/pet/' + encodeURIComponent(props.definition.id),
      container,
      phase: streamRef.current,
      interact: props.onPet,
      onCleanup: (fn) => { cleanups.push(fn) },
    }
    let handle: Frames2dRendererHandle
    try {
      handle = defaultPetRendererRegistry.mount('frames2d', ctx, frames2d) as Frames2dRendererHandle
    } catch {
      setInvalid(true)
      return () => { for (const fn of cleanups.splice(0)) fn() }
    }
    handleRef.current = handle
    // The gameplay HUD steers one shared override slot through the bus;
    // mode rules (work blocks drag, sleep wakes on it) keep the two
    // producers from fighting over the slot.
    if (props.bus !== undefined) {
      const gameplayBus = props.bus
      gameplayBus.setTrack = (track) => { handleRef.current?.setState(track) }
      gameplayBus.setIdleTrack = (track) => { handleRef.current?.setIdleTrack(track) }
      cleanups.push(() => {
        gameplayBus.setTrack = undefined
        gameplayBus.setIdleTrack = undefined
      })
    }
    // The drag gesture drives the conventional 'drag' track when declared.
    // On release, a declared gameplay.dragEndState (miku: standup) plays
    // once; its fallback auto-releases the override back to the phase map.
    const dragTrack = props.definition.gameplay?.dragState ?? (frames2d.tracks.drag === undefined ? undefined : 'drag')
    const offDrag = props.drag.subscribe((dragging) => {
      if (dragTrack === undefined) return
      if (dragging) {
        handle.setState(dragTrack)
        return
      }
      handle.setState(props.definition.gameplay?.dragEndState)
    })
    cleanups.push(offDrag)
    return () => {
      handleRef.current = null
      for (const fn of cleanups.splice(0)) fn()
      handle.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one activation per pet identity
  }, [props.definition])

  // Feed the polled phase into the activation's stream (change-only).
  useEffect(() => {
    streamRef.current?.push(props.phase)
  }, [props.phase])

  return (
    <div
      ref={containerRef}
      data-dsh-pet-frames2d={props.definition.id}
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {invalid && (
        <span data-dsh-pet-frames2d-error="invalid-config">
          {props.t('pet.renderer.unavailable', { renderer: 'frames2d' })}
        </span>
      )}
    </div>
  )
}
