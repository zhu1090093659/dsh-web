import {
  PET_INTENT_VERSION,
  type PetExpression,
  type PetIntent,
  type PetMotion,
} from '../../../src/core/intent.ts'
import type { SpriteAnimation } from './sprite-animation.ts'

const compatibilityMotion: Record<SpriteAnimation, { motion: PetMotion, expression: PetExpression }> = {
  idle: { motion: 'idle', expression: 'neutral' },
  waiting: { motion: 'waiting', expression: 'curious' },
  running: { motion: 'thinking', expression: 'focused' },
  'running-right': { motion: 'working', expression: 'focused' },
  'running-left': { motion: 'working', expression: 'focused' },
  review: { motion: 'reviewing', expression: 'neutral' },
  waving: { motion: 'request-input', expression: 'questioning' },
  jumping: { motion: 'celebrate', expression: 'happy' },
  failed: { motion: 'failure', expression: 'worried' },
}

/** Convert the frozen pre-V2 animation field without exposing it to Providers. */
export function compatibilityIntent(animation: SpriteAnimation, key: string = animation): PetIntent {
  const semantic = compatibilityMotion[animation]
  return {
    version: PET_INTENT_VERSION,
    id: `compatibility:${key}`,
    source: 'system',
    createdAt: 0,
    priority: 0,
    interruptible: true,
    expression: semantic.expression,
    motion: semantic.motion,
    playback: ['jumping', 'waving', 'failed'].includes(animation) ? 'once' : 'loop',
    sourceTaskIds: [],
  }
}
