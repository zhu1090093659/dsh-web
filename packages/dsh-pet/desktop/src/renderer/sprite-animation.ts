import type { PetAnimation, PetIntent, PetMotion, PetSnapshot } from '../shared/desktop-api.ts'

export type SpriteAnimation = PetAnimation

export const FRAME_WIDTH = 192
export const FRAME_HEIGHT = 208
export const FRAME_COLUMNS = 8
export const SPRITE_SCALE = 0.8

export function spriteSheetRows(version: 1 | 2): 9 | 11 {
  return version === 2 ? 11 : 9
}

interface Track {
  row: number
  frames: readonly number[]
  durations: readonly number[]
}

export const TRACKS: Record<SpriteAnimation, Track> = {
  idle: {
    row: 0,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [400, 400, 500, 400, 400, 500],
  },
  waving: {
    row: 3,
    frames: [0, 1, 2, 3],
    durations: [350, 350, 350, 350],
  },
  'running-right': {
    row: 1,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [225, 225, 225, 225, 225, 225, 225, 225],
  },
  'running-left': {
    row: 2,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [225, 225, 225, 225, 225, 225, 225, 225],
  },
  jumping: {
    row: 4,
    frames: [0, 1, 2, 3, 4],
    durations: [300, 300, 300, 350, 350],
  },
  failed: {
    row: 5,
    frames: [0, 1, 2, 3, 4, 5, 6, 7],
    durations: [450, 450, 450, 500, 550, 600, 450, 450],
  },
  waiting: {
    row: 6,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [450, 450, 500, 450, 450, 500],
  },
  running: {
    row: 7,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [250, 250, 250, 250, 250, 250],
  },
  review: {
    row: 8,
    frames: [0, 1, 2, 3, 4, 5],
    durations: [550, 550, 550, 550, 550, 550],
  },
}

export const SPRITE_MOTION_BINDINGS: Record<PetMotion, SpriteAnimation> = {
  idle: 'idle',
  waiting: 'waiting',
  thinking: 'running',
  working: 'running-right',
  reviewing: 'review',
  'request-input': 'waving',
  celebrate: 'jumping',
  failure: 'failed',
  pet: 'waving',
  feed: 'jumping',
}

export type PetRenderSnapshot = Pick<PetSnapshot, 'animation' | 'intent'>

/** Prefer the renderer-neutral Web DSH intent and retain old Host compatibility. */
export function animationForPetSnapshot(snapshot: PetRenderSnapshot | null | undefined): SpriteAnimation {
  return animationForPetIntent(snapshot?.intent, snapshot?.animation)
}

/** Map a scheduled semantic Intent while retaining the legacy animation fallback. */
export function animationForPetIntent(
  intent: PetIntent | undefined,
  fallback: SpriteAnimation = 'idle',
): SpriteAnimation {
  return intent === undefined ? fallback : SPRITE_MOTION_BINDINGS[intent.motion]
}

export function frameAtElapsed(track: Track, elapsedMs: number): number {
  return frameStateAtElapsed(track, elapsedMs).frame
}

/** Current frame plus the delay until the atlas needs repainting again. */
export function frameStateAtElapsed(track: Track, elapsedMs: number): { frame: number, nextInMs: number } {
  const duration = track.durations.reduce((sum, value) => sum + value, 0)
  let cursor = Math.max(0, elapsedMs) % duration
  for (let index = 0; index < track.frames.length; index += 1) {
    const frameDuration = track.durations[index] ?? 1
    if (cursor < frameDuration) {
      return {
        frame: track.frames[index] ?? 0,
        nextInMs: Math.max(1, Math.ceil(frameDuration - cursor)),
      }
    }
    cursor -= frameDuration
  }
  return { frame: track.frames[0] ?? 0, nextInMs: 1 }
}
