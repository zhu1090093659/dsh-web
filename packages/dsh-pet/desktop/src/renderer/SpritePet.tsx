import { useEffect, useRef } from 'react'

import spriteUrl from '../../../assets/whale/spritesheet.webp'
import {
  FRAME_COLUMNS,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  frameStateAtElapsed,
  SPRITE_SCALE,
  spriteSheetRows,
  TRACKS,
  type SpriteAnimation,
} from './sprite-animation.ts'

export interface SpritePetModel {
  id: string
  spriteVersion: 1 | 2
  assetUrl?: string
}

interface SpritePetProps {
  animation: SpriteAnimation
  visible: boolean
  /** Semantic identity restarts a track only when the action really changes. */
  intentId?: string
  model?: SpritePetModel
}

export function SpritePet({ animation, visible, intentId, model }: SpritePetProps) {
  const spriteRef = useRef<HTMLDivElement>(null)
  const activeSpriteUrl = model?.assetUrl ?? spriteUrl
  const spriteVersion = model?.spriteVersion ?? 1

  useEffect(() => {
    const element = spriteRef.current
    if (element === null) return
    const track = TRACKS[animation]
    const startedAt = performance.now()
    let frameTimer: number | undefined

    const paint = (): void => {
      frameTimer = undefined
      element.dataset.animationTimerActive = 'false'
      if (!visible || document.hidden) return
      const state = frameStateAtElapsed(track, performance.now() - startedAt)
      element.style.backgroundPosition = `${-state.frame * FRAME_WIDTH * SPRITE_SCALE}px ${-track.row * FRAME_HEIGHT * SPRITE_SCALE}px`
      frameTimer = window.setTimeout(paint, state.nextInMs)
      element.dataset.animationTimerActive = 'true'
    }
    const onVisibilityChange = (): void => {
      if (frameTimer !== undefined) window.clearTimeout(frameTimer)
      frameTimer = undefined
      element.dataset.animationTimerActive = 'false'
      if (visible && !document.hidden) paint()
    }

    element.style.backgroundImage = `url(${activeSpriteUrl})`
    element.style.backgroundSize = `${FRAME_WIDTH * FRAME_COLUMNS * SPRITE_SCALE}px ${FRAME_HEIGHT * spriteSheetRows(spriteVersion) * SPRITE_SCALE}px`
    element.style.backgroundPosition = `0 ${-track.row * FRAME_HEIGHT * SPRITE_SCALE}px`
    document.addEventListener('visibilitychange', onVisibilityChange)
    paint()
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (frameTimer !== undefined) window.clearTimeout(frameTimer)
      element.dataset.animationTimerActive = 'false'
    }
  }, [animation, visible, intentId, activeSpriteUrl, spriteVersion])

  return (
    <div
      ref={spriteRef}
      className="sprite"
      data-animation={animation}
      data-model-id={model?.id ?? 'builtin:whale'}
      data-sprite-version={spriteVersion}
      aria-hidden="true"
    />
  )
}
