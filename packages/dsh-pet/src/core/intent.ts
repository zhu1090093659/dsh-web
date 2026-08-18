/** Renderer-neutral semantic intents derived from activity and interaction facts. */

import { narrateActivity, type NarrationDecision } from './narration.ts'
import type { PetAggregateSnapshot, PetTaskPhase, PetTaskSnapshot } from './protocol.ts'

/** Stable intent contract version consumed by every renderer family. */
export const PET_INTENT_VERSION = 2 as const

export type PetExpression =
  | 'neutral'
  | 'curious'
  | 'focused'
  | 'happy'
  | 'worried'
  | 'questioning'

export type PetMotion =
  | 'idle'
  | 'waiting'
  | 'thinking'
  | 'working'
  | 'reviewing'
  | 'request-input'
  | 'celebrate'
  | 'failure'
  | 'pet'
  | 'feed'

export type PetIntentSource = 'activity' | 'interaction' | 'system'
export type PetMotionPlayback = 'loop' | 'once' | 'hold'

/** Speech is a separate event and never participates in motion deduplication. */
export interface PetIntentSpeech {
  id: string
  text: string
  createdAt: number
}

/** A bounded semantic command understood by sprite, Live2D, or another renderer. */
export interface PetIntent {
  version: typeof PET_INTENT_VERSION
  id: string
  source: PetIntentSource
  createdAt: number
  expiresAt?: number
  priority: number
  interruptible: boolean
  expression: PetExpression
  motion: PetMotion
  playback: PetMotionPlayback
  speech?: PetIntentSpeech
  sourceTaskIds: string[]
}

interface PhaseIntent {
  expression: PetExpression
  motion: PetMotion
  playback: PetMotionPlayback
  priority: number
  interruptible: boolean
}

function forPhase(phase: PetTaskPhase): PhaseIntent {
  switch (phase) {
    case 'waiting_input':
      return {
        expression: 'questioning', motion: 'request-input', playback: 'hold', priority: 80, interruptible: false,
      }
    case 'blocked':
      return {
        expression: 'worried', motion: 'request-input', playback: 'hold', priority: 75, interruptible: false,
      }
    case 'failed':
      return {
        expression: 'worried', motion: 'failure', playback: 'hold', priority: 70, interruptible: false,
      }
    case 'done':
      return {
        expression: 'happy', motion: 'celebrate', playback: 'once', priority: 60, interruptible: false,
      }
    case 'tool':
      return {
        expression: 'focused', motion: 'working', playback: 'loop', priority: 40, interruptible: true,
      }
    case 'thinking':
      return {
        expression: 'focused', motion: 'thinking', playback: 'loop', priority: 30, interruptible: true,
      }
    case 'review':
      return {
        expression: 'neutral', motion: 'reviewing', playback: 'loop', priority: 25, interruptible: true,
      }
    case 'waiting':
      return {
        expression: 'curious', motion: 'waiting', playback: 'loop', priority: 15, interruptible: true,
      }
    case 'idle':
      return {
        expression: 'neutral', motion: 'idle', playback: 'loop', priority: 0, interruptible: true,
      }
  }
}

/** Runtime-neutral FNV-1a hash used only to keep semantic IDs short and bounded. */
function semanticHash(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

/** Motion identity changes only when the renderer-relevant task semantics change. */
export function activityIntentId(task: PetTaskSnapshot | undefined): string {
  if (task === undefined) return 'activity:idle'
  return `activity:${semanticHash([
    task.taskId,
    task.phase,
    String(task.phaseStartedAt),
    task.tool?.name ?? '',
  ].join('|'))}`
}

function speechFor(
  snapshot: PetAggregateSnapshot,
  narration: NarrationDecision | undefined,
): PetIntentSpeech | undefined {
  const text = narration?.text ?? narrateActivity(snapshot)
  if (text === undefined) return undefined
  const createdAt = narration?.createdAt ?? snapshot.emittedAt
  return {
    id: `speech:${narration?.reason ?? 'snapshot'}:${String(createdAt)}`,
    text,
    createdAt,
  }
}

/** Map only the selected primary task; renderers never consume session events. */
export function mapActivityToIntent(
  snapshot: PetAggregateSnapshot,
  narration?: NarrationDecision,
): PetIntent {
  const primary = snapshot.tasks.find(task => task.taskId === snapshot.primaryTaskId)
  const phase = primary?.phase ?? 'idle'
  const mapped = forPhase(phase)
  const speech = speechFor(snapshot, narration)
  return {
    version: PET_INTENT_VERSION,
    id: activityIntentId(primary),
    source: 'activity',
    createdAt: primary?.phaseStartedAt ?? 0,
    priority: mapped.priority,
    interruptible: mapped.interruptible,
    expression: mapped.expression,
    motion: mapped.motion,
    playback: mapped.playback,
    ...(speech === undefined ? {} : { speech }),
    sourceTaskIds: primary === undefined ? [] : [primary.taskId],
  }
}

/** Create one short interaction Intent without replacing the underlying task state. */
export function createInteractionIntent(
  kind: 'pet' | 'feed',
  text: string,
  createdAt: number,
  accepted: boolean,
): PetIntent {
  return {
    version: PET_INTENT_VERSION,
    id: `interaction:${kind}:${String(createdAt)}`,
    source: 'interaction',
    createdAt,
    expiresAt: createdAt + 1_600,
    priority: 65,
    interruptible: false,
    expression: accepted ? 'happy' : 'questioning',
    motion: kind,
    playback: 'once',
    speech: {
      id: `speech:interaction-${kind}:${String(createdAt)}`,
      text,
      createdAt,
    },
    sourceTaskIds: [],
  }
}
