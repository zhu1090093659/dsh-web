import { describe, expect, it } from 'vitest'

import { animationForPetSnapshot, frameAtElapsed, frameStateAtElapsed, spriteSheetRows, TRACKS } from './sprite-animation.ts'

describe('desktop sprite clock', () => {
  it('uses the PetDex atlas height declared by the model version', () => {
    expect(spriteSheetRows(1)).toBe(9)
    expect(spriteSheetRows(2)).toBe(11)
  })

  it('selects frames using the existing whale animation timing', () => {
    expect(frameAtElapsed(TRACKS.idle, 0)).toBe(0)
    expect(frameAtElapsed(TRACKS.idle, 401)).toBe(1)
    expect(frameAtElapsed(TRACKS.idle, 1301)).toBe(3)
  })

  it('loops without adding React render state', () => {
    expect(frameAtElapsed(TRACKS.waving, 1400)).toBe(0)
    expect(frameAtElapsed(TRACKS.waving, 1751)).toBe(1)
  })

  it('schedules paints only when the displayed atlas frame changes', () => {
    expect(frameStateAtElapsed(TRACKS.idle, 0)).toEqual({ frame: 0, nextInMs: 400 })
    expect(frameStateAtElapsed(TRACKS.idle, 399)).toEqual({ frame: 0, nextInMs: 1 })
    expect(frameStateAtElapsed(TRACKS.idle, 401)).toEqual({ frame: 1, nextInMs: 399 })
  })

  it('prefers Web DSH intent motion and falls back to the legacy animation', () => {
    expect(animationForPetSnapshot({
      animation: 'idle',
      intent: {
        version: 2,
        id: 'activity:tool',
        source: 'activity',
        createdAt: 100,
        priority: 40,
        interruptible: true,
        expression: 'focused',
        motion: 'working',
        playback: 'loop',
        sourceTaskIds: ['task'],
      },
    })).toBe('running-right')
    expect(animationForPetSnapshot({ animation: 'review' })).toBe('review')
    expect(animationForPetSnapshot(null)).toBe('idle')
  })
})
