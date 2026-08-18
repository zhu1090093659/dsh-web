import { describe, expect, it } from 'vitest'
import { PetIntentScheduler } from '../src/core/intent-scheduler.ts'
import {
  createInteractionIntent,
  mapActivityToIntent,
  type PetIntent,
} from '../src/core/intent.ts'
import type { PetAggregateSnapshot, PetTaskPhase } from '../src/core/protocol.ts'

function activity(phase: PetTaskPhase, phaseStartedAt: number, tool?: string): PetIntent {
  const snapshot: PetAggregateSnapshot = {
    protocolVersion: 2,
    sequence: phaseStartedAt,
    emittedAt: phaseStartedAt,
    primaryTaskId: 'task',
    tasks: [{
      taskId: 'task',
      instanceId: 'instance',
      bootId: 'boot',
      sessionId: 'session',
      phase,
      ...(tool === undefined ? {} : { tool: { name: tool, activeCount: 1, completedCount: 0 } }),
      startedAt: 0,
      phaseStartedAt,
      updatedAt: phaseStartedAt,
    }],
    summary: { active: 1, waiting: 0, blocked: phase === 'blocked' ? 1 : 0, failed: 0, completedRecently: 0 },
  }
  return mapActivityToIntent(snapshot)
}

describe('PetIntentScheduler', () => {
  it('deduplicates one semantic motion even when speech changes', () => {
    const scheduler = new PetIntentScheduler()
    const first = activity('thinking', 100)
    const changedSpeech = {
      ...first,
      speech: { id: 'speech:later:200', text: '还在继续', createdAt: 200 },
    }

    scheduler.submit(first)
    const state = scheduler.submit(changedSpeech)
    expect(state.current?.id).toBe(first.id)
    expect(state.current?.speech?.id).not.toBe('speech:later:200')
    expect(state.queued).toEqual([])
  })

  it('lets an interaction interrupt activity and returns to the latest activity', () => {
    const scheduler = new PetIntentScheduler()
    const thinking = activity('thinking', 100)
    const interaction = createInteractionIntent('pet', '好呀', 200, true)
    const tool = activity('tool', 300, 'test')

    scheduler.submit(thinking)
    expect(scheduler.submit(interaction)).toMatchObject({
      current: { id: interaction.id },
      queued: [{ id: thinking.id }],
    })
    expect(scheduler.submit(tool)).toMatchObject({
      current: { id: interaction.id },
      queued: [{ id: tool.id }],
    })
    expect(scheduler.complete(interaction.id)).toMatchObject({
      current: { id: tool.id },
      queued: [],
    })
  })

  it('does not let lower-priority interaction replace a non-interruptible request', () => {
    const scheduler = new PetIntentScheduler()
    const request = activity('waiting_input', 100)
    const interaction = createInteractionIntent('feed', '好吃', 200, true)

    scheduler.submit(request)
    expect(scheduler.submit(interaction)).toMatchObject({
      current: { id: request.id },
      queued: [{ id: interaction.id }],
    })
    expect(scheduler.tick(2_000).queued).toEqual([])
  })

  it('expires current one-shots and promotes a valid fallback', () => {
    const scheduler = new PetIntentScheduler()
    const thinking = activity('thinking', 100)
    const interaction = createInteractionIntent('pet', '好呀', 200, true)
    scheduler.submit(thinking)
    scheduler.submit(interaction)

    expect(scheduler.tick(1_799).current?.id).toBe(interaction.id)
    expect(scheduler.tick(1_800).current?.id).toBe(thinking.id)
    scheduler.reset()
    expect(scheduler.tick(2_000)).toEqual({ queued: [] })
  })
})
