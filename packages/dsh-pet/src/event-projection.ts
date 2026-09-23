/**
 * Official session event projection — pure. Maps the durable DSH session
 * vocabulary onto the pet's visual phases and carries an optional completed-
 * turn reward for the ledger. Holds no state of its own; callers keep a
 * {@link ProjectionRuntime} per session and feed events in arrival order.
 *
 * Status copy comes from the chatter voice (big rotating pools, per-tool
 * families, real-argument hints), and the projection feeds the murmur engine
 * (碎碎念) with the SITUATION — thinking/writing during the stream, the
 * running tool family on tool calls, and the STRUCTURED outcome on
 * tool/result and turn/end — so the pet's inner voice always roughly knows
 * what is going on and never mis-fires on output text. The wall clock is
 * injected by the caller, keeping every projection reproducible.
 *
 * Since the 0.1.5-alpha.2 cohort the stream itself is no longer durable
 * vocabulary: per-chunk phase input arrives through the process-local
 * `agent/assistant-stream` publication ({@link projectAssistantStreamFrame}),
 * while the durable log settles one `assistant/message` (or `assistant/attempt`)
 * per attempt.
 * @module @linxin666/dsh-pet/event-projection
 */

import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { PetStateInput } from './state.ts'
import {
  StatusVoice,
  toolArgHint,
  toolCategory,
  WhisperEngine,
  whisperCategoryOf,
  looksLikeTestTool,
  type VoicePoolsProvider,
} from './chatter.ts'

/** Runtime shape of the optional legacy activity event. */
export interface ActivityStatusEventLike {
  phase?: string
  line?: string
  phrase?: string
}

/** Per-session facts needed to project the official event stream. */
export interface ProjectionRuntime {
  activeTools: Set<string>
  /** callIds whose tool looked like a test run, marked at tool/call (pet M6). */
  testCalls: Set<string>
  officialEventsSeen: boolean
  stepHadFailure: boolean
  /** Round-robin status copy voice (scene-stable, cadence-rotated). */
  voice: StatusVoice
  /** Inner-whisper engine fed by the projection's situation and outcomes. */
  whispers: WhisperEngine
}

/** One official event projection, optionally carrying a completed turn reward. */
export interface PetActivityTransition {
  input: PetStateInput
  completedTurn?: number
  /** A fresh inner whisper woken by this event, when any. */
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
    testCalls: new Set(),
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
      runtime.testCalls.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: runtime.voice.scene('prepare', nowMs) } }
    case 'step/start':
      runtime.activeTools.clear()
      runtime.stepHadFailure = false
      return { input: { phase: 'waiting', line: runtime.voice.scene('waiting', nowMs) } }
    case 'assistant/message':
      return { input: { phase: 'review', line: runtime.voice.scene('review', nowMs) } }
    case 'tool/call': {
      const callId = String(event.data.callId)
      runtime.activeTools.add(callId)
      // A test-looking call is remembered so its result (the only place the
      // outcome is known) can wake the test-green mood later.
      if (looksLikeTestTool(event.data.name, event.data.arguments)) runtime.testCalls.add(callId)
      const whisper = runtime.whispers.feed(whisperCategoryOf(toolCategory(event.data.name)), nowMs)
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
        ...(whisper === undefined ? {} : { whisper }),
      }
    }
    case 'tool/result': {
      // Session format V4 moved the call identity and the outcome onto the
      // tool-role message root; the content blocks no longer carry either.
      const { message } = event.data
      const callId = String(message.toolCallId)
      const failed = event.data.error !== undefined || message.isError === true
      const wasTest = runtime.testCalls.delete(callId)
      runtime.activeTools.delete(callId)
      runtime.stepHadFailure ||= failed
      const whisper = failed
        ? runtime.whispers.result('fail', nowMs)
        : wasTest
          ? runtime.whispers.result('pass', nowMs)
          : undefined
      const whisperSpread = whisper === undefined ? {} : { whisper }
      if (runtime.activeTools.size > 0) {
        return {
          input: {
            phase: 'tool',
            line: runtime.voice.toolRemaining(runtime.activeTools.size, nowMs),
          },
          ...whisperSpread,
        }
      }
      return runtime.stepHadFailure
        ? { input: { phase: 'failed', line: runtime.voice.scene('toolFailed', nowMs) }, ...whisperSpread }
        : { input: { phase: 'thinking', line: runtime.voice.scene('toolResult', nowMs) }, ...whisperSpread }
    }
    case 'turn/end': {
      runtime.activeTools.clear()
      runtime.testCalls.clear()
      switch (event.data.reason.kind) {
        case 'completed': {
          const whisper = runtime.whispers.result('done', nowMs)
          return {
            input: { phase: 'done', line: runtime.voice.scene('done', nowMs) },
            completedTurn: event.data.turn,
            ...(whisper === undefined ? {} : { whisper }),
          }
        }
        case 'error': {
          const whisper = runtime.whispers.result('fail', nowMs)
          return {
            input: { phase: 'failed', line: runtime.voice.scene('failed', nowMs) },
            ...(whisper === undefined ? {} : { whisper }),
          }
        }
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

/**
 * Project one live `agent/assistant-stream` publication into the pet's visual
 * phases. Chunk frames are the alpha.2 replacement for the retired durable
 * `assistant/chunk` event: a reasoning delta keeps the pet thinking, a text
 * delta moves it to review; start, end, and non-delta chunks change nothing.
 */
export function projectAssistantStreamFrame(
  frame: AssistantStreamFrame,
  runtime: ProjectionRuntime,
  nowMs: number = Date.now(),
): PetActivityTransition | undefined {
  if (frame.type !== 'chunk') return undefined
  const { chunk } = frame
  if (chunk.type === 'reasoning-delta' && chunk.text.length > 0) {
    const whisper = runtime.whispers.feed('thinking', nowMs)
    return {
      input: { phase: 'thinking', line: runtime.voice.scene('thinking', nowMs) },
      ...(whisper === undefined ? {} : { whisper }),
    }
  }
  if (chunk.type === 'text-delta' && chunk.text.length > 0) {
    const whisper = runtime.whispers.feed('writing', nowMs)
    return {
      input: { phase: 'review', line: runtime.voice.scene('review', nowMs) },
      ...(whisper === undefined ? {} : { whisper }),
    }
  }
  return undefined
}
