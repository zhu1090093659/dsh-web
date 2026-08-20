/**
 * Renderer switch — the client dispatch seam of the pet center (issue #623,
 * milestone M2 P5 / M3). The pet's manifest picks the renderer: sprite2d
 * hands straight through to the sprite; live2d injects its visual INTO the
 * sprite chrome (the dock, bubbles and panel belong to the pet center, not
 * the renderer); a renderer this build cannot serve renders a clear
 * diagnostic card instead of blanking.
 * @module @linxin666/dsh-pet/client/renderers/PetRendererSwitch
 */

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition } from '../../registry.ts'
import type { ActivityPhase } from '../../state.ts'
import type { PetSpriteProps } from '../PetSprite.tsx'
import { defaultPetRendererRegistry } from './registry.ts'
import { Live2dVisualMount } from './live2d/Live2dVisualMount.tsx'
import type { NS } from '../locales.ts'

/** Dispatch one pet definition to its renderer; unknown kinds get a card. */
export function PetRendererSwitch(props: {
  definition: PetDefinition
  /** Current activity phase (fed to renderer visuals). */
  phase: ActivityPhase
  /** The chrome's pet interaction (affinity write-back owner). */
  onPet: () => void
  t: PropsLocale<typeof NS>['t']
  children?: ReactNode
}): ReactElement {
  const renderer = props.definition.renderer ?? 'sprite2d'
  if (renderer === 'sprite2d') return <>{props.children}</>
  if (renderer === 'live2d' && defaultPetRendererRegistry.has('live2d') && isValidElement<PetSpriteProps>(props.children)) {
    const visual = (
      <Live2dVisualMount
        definition={props.definition}
        phase={props.phase}
        onPet={props.onPet}
        t={props.t}
      />
    )
    return cloneElement(props.children, { visual })
  }
  return (
    <span data-dsh-pet-renderer-fallback={renderer}>
      {props.t('pet.renderer.unavailable', { renderer })}
    </span>
  )
}
