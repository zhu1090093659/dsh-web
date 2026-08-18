import { describe, expect, it } from 'vitest'
import {
  createInteractionIntent,
  mapActivityToIntent,
  PET_INTENT_VERSION,
} from '../src/core/intent.ts'
import { narrateActivity, type NarrationDecision } from '../src/core/narration.ts'
import type { PetAggregateSnapshot, PetTaskPhase } from '../src/core/protocol.ts'

function snapshot(phase?: PetTaskPhase): PetAggregateSnapshot {
  if (phase === undefined) {
    return {
      protocolVersion: 2,
      sequence: 0,
      emittedAt: 100,
      tasks: [],
      summary: { active: 0, waiting: 0, blocked: 0, failed: 0, completedRecently: 0 },
    }
  }
  return {
    protocolVersion: 2,
    sequence: 4,
    emittedAt: 100,
    primaryTaskId: 'task',
    tasks: [{
      taskId: 'task',
      instanceId: 'instance',
      bootId: 'boot',
      sessionId: 'session',
      phase,
      statusLine: phase === 'tool' ? '正在运行测试' : undefined,
      ...(phase === 'tool'
        ? { tool: { name: 'test', activeCount: 1, completedCount: 0 } }
        : {}),
      startedAt: 10,
      phaseStartedAt: 90,
      updatedAt: 90,
    }],
    summary: { active: 1, waiting: 0, blocked: phase === 'blocked' ? 1 : 0, failed: 0, completedRecently: 0 },
  }
}

describe('pet intent core', () => {
  it('maps activity into renderer-neutral V2 commands', () => {
    expect(mapActivityToIntent(snapshot('tool'))).toEqual({
      version: PET_INTENT_VERSION,
      id: 'activity:e6041ac9c53fb4cd',
      source: 'activity',
      createdAt: 90,
      priority: 40,
      interruptible: true,
      expression: 'focused',
      motion: 'working',
      playback: 'loop',
      speech: {
        id: 'speech:snapshot:100',
        text: '正在运行测试',
        createdAt: 100,
      },
      sourceTaskIds: ['task'],
    })
    expect(mapActivityToIntent(snapshot('waiting_input'))).toMatchObject({
      expression: 'questioning',
      motion: 'request-input',
      playback: 'hold',
      priority: 80,
      interruptible: false,
    })
    expect(mapActivityToIntent(snapshot('blocked'))).toMatchObject({
      expression: 'worried',
      motion: 'request-input',
      playback: 'hold',
      priority: 75,
      interruptible: false,
    })
  })

  it('keeps motion identity stable across transport and speech-only updates', () => {
    const firstSnapshot = snapshot('thinking')
    const secondSnapshot = {
      ...firstSnapshot,
      sequence: 99,
      emittedAt: 5_000,
      tasks: firstSnapshot.tasks.map(task => ({ ...task, statusLine: '仍在思考', updatedAt: 5_000 })),
    }
    const firstNarration: NarrationDecision = {
      text: '正在思考', emitted: true, reason: 'initial', createdAt: 100,
    }
    const secondNarration: NarrationDecision = {
      text: '还在继续思考', emitted: true, reason: 'long-running', createdAt: 5_000,
    }
    const first = mapActivityToIntent(firstSnapshot, firstNarration)
    const second = mapActivityToIntent(secondSnapshot, secondNarration)

    expect(second.id).toBe(first.id)
    expect(second.speech?.id).not.toBe(first.speech?.id)
    expect(second.motion).toBe(first.motion)
  })

  it('changes motion identity when the active tool changes', () => {
    const first = snapshot('tool')
    const second = {
      ...first,
      sequence: 5,
      tasks: first.tasks.map(task => ({
        ...task,
        tool: { name: 'build', activeCount: 1, completedCount: 0 },
      })),
    }
    expect(mapActivityToIntent(second).id).not.toBe(mapActivityToIntent(first).id)
  })

  it('creates a bounded one-shot interaction without replacing task identity', () => {
    expect(createInteractionIntent('feed', '好吃！', 1_000, true)).toEqual({
      version: PET_INTENT_VERSION,
      id: 'interaction:feed:1000',
      source: 'interaction',
      createdAt: 1_000,
      expiresAt: 2_600,
      priority: 65,
      interruptible: false,
      expression: 'happy',
      motion: 'feed',
      playback: 'once',
      speech: { id: 'speech:interaction-feed:1000', text: '好吃！', createdAt: 1_000 },
      sourceTaskIds: [],
    })
  })

  it('falls back to idle without inventing task progress', () => {
    expect(narrateActivity(snapshot())).toBeUndefined()
    expect(mapActivityToIntent(snapshot())).toMatchObject({
      id: 'activity:idle',
      source: 'activity',
      expression: 'neutral',
      motion: 'idle',
      playback: 'loop',
      sourceTaskIds: [],
    })
  })
})
