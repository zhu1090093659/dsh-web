/** Pure timing helpers for manifest-defined scene animation sequences. */

import type { PetTrackDef } from '../registry.ts'
import type { PetAnimation } from '../state.ts'

export interface SequenceFrame {
  animation: PetAnimation
  frameIndex: number
}

/** Resolve the active track and frame after elapsed milliseconds of a looping sequence. */
export function sequenceFrameAt(
  sequence: readonly PetAnimation[],
  tracks: Record<PetAnimation, PetTrackDef>,
  elapsedMs: number,
): SequenceFrame {
  const itemDurations = sequence.map(animation => tracks[animation].durations.reduce((sum, value) => sum + value, 0))
  const sequenceDuration = itemDurations.reduce((sum, value) => sum + value, 0)
  let offset = Math.max(0, elapsedMs) % sequenceDuration
  let itemIndex = 0
  while (itemIndex < sequence.length - 1 && offset >= itemDurations[itemIndex]!) {
    offset -= itemDurations[itemIndex]!
    itemIndex += 1
  }
  const animation = sequence[itemIndex]!
  const track = tracks[animation]
  let frameIndex = 0
  while (frameIndex < track.frames.length - 1 && offset >= track.durations[frameIndex]!) {
    offset -= track.durations[frameIndex]!
    frameIndex += 1
  }
  return { animation, frameIndex }
}
