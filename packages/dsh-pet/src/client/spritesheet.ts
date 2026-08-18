/**
 * Spritesheet geometry helpers — parameterized by the pet definition the
 * host serves over '/api/pet/pets', so the browser half renders any registry
 * entry without per-pet code. The per-track tables (frames, durations, loop,
 * fallback) also come from the registry; these helpers only place frames,
 * guard track lengths, and map the fixed 9-row animation contract.
 * @module @linxin666/dsh-pet/client/spritesheet
 */

import { rowOf, type PetAnimation } from '../state.ts'
import type { PetCell, PetTrackDef } from '../registry.ts'

/** Animation track shape the frame loop consumes. */
export type TrackDef = PetTrackDef

/** Row index of one animation track (the fixed 9-row contract). */
export function rowOfTrack(animation: PetAnimation): number {
  // The table itself lives in state.ts (rowOf) — the single source of truth.
  return rowOf(animation)
}

/**
 * Background-position (px) of one frame cell within the scaled atlas.
 * The background image is scaled by `scale` (element size ÷ cell size), and
 * background-position offsets are applied in SCALED coordinates — using raw
 * atlas coordinates here would drift each frame by the scale factor and
 * render torn/overlapping frames.
 */
export function framePosition(cell: PetCell, columns: number, row: number, col: number, scale = 1): { x: number; y: number } {
  return { x: -col * cell.width * scale, y: -row * cell.height * scale }
}

/** Total duration of one track, ms. */
export function trackDuration(track: TrackDef): number {
  return track.durations.reduce((sum, d) => sum + d, 0)
}

/**
 * Trim a track to the actual frame count of its row (the manifest's per-row
 * counts are authoritative; this is a last-line guard against a definition
 * whose row count disagrees with its track table). A row with 0 detected
 * frames degrades to the first frame so the pet never renders blank.
 */
export function trimTrack(track: TrackDef, frameCount: number): TrackDef {
  const n = Math.max(1, Math.min(frameCount, track.frames.length, track.durations.length))
  return {
    frames: track.frames.slice(0, n),
    durations: track.durations.slice(0, n),
    loop: track.loop,
    ...(track.fallback === undefined ? {} : { fallback: track.fallback }),
  }
}
