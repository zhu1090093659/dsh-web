/**
 * Live2D visual mount (pet-center M3) — the React bridge between the pet
 * center chrome and the imperative live2d renderer. The bridge owns the
 * contract context (asset base, phase stream, interaction write-back,
 * activation cleanups), feeds the polled phase into the stream, forwards
 * sub-4px taps as hit-test coordinates, and renders the localized error
 * card when the renderer reports a fatal boot failure.
 * @module @linxin666/dsh-pet/client/renderers/live2d/Live2dVisualMount
 */

import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition } from '../../../registry.ts'
import type { ActivityPhase } from '../../../state.ts'
import { createPhaseStream, type PhaseStream } from '../../phase-stream.ts'
import type { PetRendererContext } from '../../../contracts/renderer.ts'
import { defaultPetRendererRegistry } from '../registry.ts'
import type { Live2dErrorCode, Live2dRendererHandle } from '../live2d.ts'
import type { NS } from '../../locales.ts'

/** Mount the live2d renderer as the sprite's visual (inside the chrome). */
export function Live2dVisualMount(props: {
  definition: PetDefinition
  phase: ActivityPhase
  onPet: () => void
  t: PropsLocale<typeof NS>['t']
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const streamRef = useRef<PhaseStream | null>(null)
  const handleRef = useRef<Live2dRendererHandle | null>(null)
  const downRef = useRef<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<Live2dErrorCode | null>(null)

  // One activation per pet definition: build the contract context and mount.
  useEffect(() => {
    setError(null)
    const container = containerRef.current
    const live2d = props.definition.live2d
    if (container === null || live2d === undefined) return undefined
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
    let handle: Live2dRendererHandle
    try {
      handle = defaultPetRendererRegistry.mount('live2d', ctx, live2d) as Live2dRendererHandle
    } catch {
      setError('load-failed')
      return () => { for (const fn of cleanups.splice(0)) fn() }
    }
    handleRef.current = handle
    handle.onError?.(setError)
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
      data-dsh-pet-live2d={props.definition.id}
      style={{ width: '100%', height: '100%' }}
      onPointerDown={(e) => { downRef.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={(e) => {
        const down = downRef.current
        downRef.current = null
        if (down === null) return
        // A moved pointer is a drag (the chrome owns it), not a tap.
        if (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4) return
        const rect = e.currentTarget.getBoundingClientRect()
        handleRef.current?.tap(e.clientX - rect.left, e.clientY - rect.top)
      }}
    >
      {error !== null && (
        <span data-dsh-pet-live2d-error={error}>
          {error === 'core-missing'
            ? props.t('pet.live2d.core-missing')
            : error === 'vendor-missing'
              ? props.t('pet.live2d.vendor-missing')
              : props.t('pet.live2d.load-failed')}
        </span>
      )}
    </div>
  )
}
