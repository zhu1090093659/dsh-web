/**
 * Official session event projection — pure. Maps the durable DSH session
 * vocabulary onto the pet's visual phases and carries an optional completed-
 * turn reward for the ledger. Holds no state of its own; callers keep a
 * {@link ProjectionRuntime} per session and feed events in arrival order.
 *
 * Status copy comes from the chatter voice (big rotating pools, per-tool
 * families, real-argument hints), and streamed model output feeds the murmur
 * engine so the pet can whisper its inner voice (碎碎念). The wall clock is
 * injected by the caller, keeping every projection reproducible.
 * @module @linxin666/dsh-pet/event-projection
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PetStateInput } from './state.ts'
import { StatusVoice, toolArgHint, WhisperEngine, type VoicePoolsProvider } from './chatter.ts'

/** Runtime shape of the optional legacy activity event. */
export interface ActivityStatusEventLike {
  phase?: string
  line?: string
  phrase?: string
}

/** Per-session facts needed to project the official event stream. */
export interface ProjectionRuntime {
  activeTools: Set<string>
  officialEventsSeen: boolean
  stepHadFailure: boolean
  /** Round-robin status copy voice (scene-stable, cadence-rotated). */
  voice: StatusVoice
  /** Inner-whisper engine fed by the model's own streamed output. */
  whispers: WhisperEngine
}

/** One official event projection, optionally carrying a completed turn reward. */
export interface PetActivityTransition {
  input: PetStateInput
  completedTurn?: number
  /** A fresh inner whisper woken by this event's model output, when any. */
  whisper?: string
}

/**
 * Fresh projection runtime for a newly seen session. The optional voice-pack
 * provider (pet-center M4, issue #677) hands both chatter engines their
 * pools; engines resolve overrides at draw time, so swapping the provider's
 * pack re-voices live runtimes without rebuilding them.
 */
export function emptyProjectionRuntime(pools?: VoicePoolsProvider): ProjectionRuntime {
  return {
    activeTools: new Set(),
    officialEventsSeen: false,
    stepHadFailure: false,
    voice: new StatusVoice(pools),
    whispers: new WhisperEngine(pools),
  }
}

/** Keep tool names readable inside the compact status bubble. */
function displayToolName(name: string): string {
  const compact = name.replace(/\s+/g, ' ').trim() || '工具'
  return compact.length <= 24 ? compact : compact.slice(0, 21) + '...'
}

/** Whether a legacy phase is part of the pet's supported vocabulary. */
export function isActivityPhase(phase: string): phase is PetStateInput['phase'] {
  return ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed'].includes(phase)
}

/**
 * Project the durable DSH session vocabulary into the pet's visual phases.
 * Unknown and log-only events do not disturb the last meaningful activity.
 * @param nowMs - injected wall clock for copy rotation and whisper pacing.
 */
export function projectOfficialEvent(
  event: SessionEvent,
  runtime: ProjectionRuntime,
  nowMs: number = Date.now(),
): PetActivityTransition | undefined {
  switch (event.type) {
    case 'turn/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: runtime.voice.scene('prepare', nowMs) } }
    case 'step/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: runtime.voice.scene('waiting', nowMs) } }
    case 'assistant/chunk': {
      const { chunk } = event.data
      if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
        const whisper = runtime.whispers.feed(chunk.text, nowMs)
        return {
          input: { phase: 'thinking', line: runtime.voice.scene('thinking', nowMs) },
          ...(whisper === undefined ? {} : { whisper }),
        }
      }
      if (chunk.type === 'text-delta' && chunk.text.length > 0) {
        const whisper = runtime.whispers.feed(chunk.text, nowMs)
        return {
          input: { phase: 'review', line: runtime.voice.scene('review', nowMs) },
          ...(whisper === undefined ? {} : { whisper }),
        }
      }
      return undefined
    }
    case 'assistant/message':
      return { input: { phase: 'review', line: runtime.voice.scene('review', nowMs) } }
    case 'tool/call':
      runtime.activeTools.add(String(event.data.callId))
      return {
        input: {
          phase: 'tool',
          line: runtime.voice.tool(
            event.data.name,
            displayToolName(event.data.name),
            toolArgHint(event.data.name, event.data.arguments),
            nowMs,
          ),
        },
      }
    case 'tool/result': {
      const block = event.data.message.content[0]
      runtime.activeTools.delete(String(event.data.message.source.callId))
      runtime.stepHadFailure ||= event.data.error !== undefined || block.isError === true
      if (runtime.activeTools.size > 0) {
        return {
          input: {
            phase: 'tool',
            line: runtime.voice.toolRemaining(runtime.activeTools.size, nowMs),
          },
        }
      }
      return runtime.stepHadFailure
        ? { input: { phase: 'failed', line: runtime.voice.scene('toolFailed', nowMs) } }
        : { input: { phase: 'thinking', line: runtime.voice.scene('toolResult', nowMs) } }
    }
    case 'turn/end': {
      runtime.activeTools.clear()
      switch (event.data.reason.kind) {
        case 'completed':
          return {
            input: { phase: 'done', line: runtime.voice.scene('done', nowMs) },
            completedTurn: event.data.turn,
          }
        case 'error':
          return { input: { phase: 'failed', line: runtime.voice.scene('failed', nowMs) } }
        case 'max-tokens':
          return { input: { phase: 'failed', line: runtime.voice.scene('maxTokens', nowMs) } }
        case 'interrupted':
          return { input: { phase: 'failed', line: runtime.voice.scene('interrupted', nowMs) } }
        case 'blocked':
          return { input: { phase: 'waiting', line: runtime.voice.scene('blocked', nowMs) } }
        case 'aborted':
          // A stopped session settles to idle without a bubble: the pet
          // visibly calms down and the session drops out of the bubble stack.
          return { input: { phase: 'idle' } }
        default:
          // TurnEndReasonMap is merge-extensible; a newer ending must not
          // leave the pet showing stale in-progress work.
          return { input: { phase: 'idle' } }
      }
    }
    default:
      return undefined
  }
}
