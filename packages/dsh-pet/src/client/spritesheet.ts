/**
 * Whale-girl spritesheet geometry and animation tracks.
 *
 * The atlas follows the Codex/hatch-pet contract: 8 columns × 9 rows of
 * 192×208 cells (1536×1872 total), rows in this order:
 *   0 idle, 1 running-right, 2 running-left, 3 waving, 4 jumping,
 *   5 failed, 6 waiting, 7 running, 8 review
 *
 * Frame counts and per-frame durations are per-track definitions below; the
 * whale-girl atlas is produced by the hatch-pet pipeline, so calibrate
 * `TRACKS` against the actual run (`pet_request.json` frame counts) when the
 * asset lands. Tracks that do not loop hand off to `fallback`.
 * @module @linxin666/dsh-pet/client/spritesheet
 */

import type { PetAnimation } from '../state.ts'

/** Atlas cell size in px (Codex contract). */
export const FRAME_WIDTH = 192
export const FRAME_HEIGHT = 208
/** Columns per row (max frames per track). */
export const FRAME_COLUMNS = 8

/** One animation track: frame indices into the row + per-frame durations. */
export interface TrackDef {
  /** Frame indices (columns) played in order; must be < FRAME_COLUMNS. */
  frames: readonly number[]
  /** Per-frame duration in ms; same length as frames. */
  durations: readonly number[]
  /** Whether the track loops; a non-looping track hands off to fallback. */
  loop: boolean
  /** Track to play after a non-looping track finishes. */
  fallback?: PetAnimation
}

/**
 * Track definitions for the whale-girl. Durations are tuned for a soft,
 * slow-healing feel (roughly 2.5× the earlier fast draft — the pet should
 * breathe, not race); calibrate frame counts against the hatch-pet run when
 * the asset lands (rows may carry 4–8 frames).
 */
export const TRACKS: Record<PetAnimation, TrackDef> = {
  idle: { frames: [0, 1, 2, 3, 4, 5], durations: [400, 400, 500, 400, 400, 500], loop: true },
  'running-right': { frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: [225, 225, 225, 225, 225, 225, 225, 225], loop: true },
  'running-left': { frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: [225, 225, 225, 225, 225, 225, 225, 225], loop: true },
  waving: { frames: [0, 1, 2, 3], durations: [350, 350, 350, 350], loop: true },
  jumping: { frames: [0, 1, 2, 3, 4], durations: [300, 300, 300, 350, 350], loop: false, fallback: 'idle' },
  failed: { frames: [0, 1, 2, 3, 4, 5, 6, 7], durations: [450, 450, 450, 500, 550, 600, 450, 450], loop: false, fallback: 'idle' },
  waiting: { frames: [0, 1, 2, 3, 4, 5], durations: [450, 450, 500, 450, 450, 500], loop: true },
  running: { frames: [0, 1, 2, 3, 4, 5], durations: [250, 250, 250, 250, 250, 250], loop: true },
  review: { frames: [0, 1, 2, 3, 4, 5], durations: [550, 550, 550, 550, 550, 550], loop: true },
}

/** Row index of one animation track (mirrors state.ts rowOf). */
export function rowOfTrack(animation: PetAnimation): number {
  const rows: Record<PetAnimation, number> = {
    idle: 0,
    'running-right': 1,
    'running-left': 2,
    waving: 3,
    jumping: 4,
    failed: 5,
    waiting: 6,
    running: 7,
    review: 8,
  }
  return rows[animation]
}

/**
 * Background-position (px) of one frame cell within the scaled atlas.
 * The background image is scaled by `scale` (element size ÷ cell size), and
 * background-position offsets are applied in SCALED coordinates — using raw
 * atlas coordinates here would drift each frame by the scale factor and
 * render torn/overlapping frames.
 */
export function framePosition(row: number, col: number, scale = 1): { x: number; y: number } {
  return { x: -col * FRAME_WIDTH * scale, y: -row * FRAME_HEIGHT * scale }
}

/** Total duration of one track, ms. */
export function trackDuration(track: TrackDef): number {
  return track.durations.reduce((sum, d) => sum + d, 0)
}

/**
 * Detect how many frames each row actually carries by scanning the decoded
 * atlas for non-transparent cells (hatch-pet rows may hold 4–8 frames; the
 * unused trailing cells are fully transparent). Rows whose every sample is
 * transparent report 0.
 * @param image - the fully decoded spritesheet (natural size 1536×1872).
 * @returns per-row frame counts, length 9.
 */
export function detectFrameCounts(image: HTMLImageElement): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (ctx === null) return Array.from({ length: 9 }, () => FRAME_COLUMNS)
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const counts: number[] = []
  const stride = FRAME_COLUMNS * FRAME_WIDTH
  const probeStep = 8
  const margin = 12
  for (let row = 0; row < 9; row++) {
    let count = 0
    for (let col = 0; col < FRAME_COLUMNS; col++) {
      let hasContent = false
      const x0 = col * FRAME_WIDTH
      const y0 = row * FRAME_HEIGHT
      for (let y = y0 + margin; y < y0 + FRAME_HEIGHT - margin && !hasContent; y += probeStep) {
        for (let x = x0 + margin; x < x0 + FRAME_WIDTH - margin && !hasContent; x += probeStep) {
          const idx = (y * stride + x) * 4
          if ((data[idx + 3] ?? 0) > 8) hasContent = true
        }
      }
      if (hasContent) count += 1
    }
    counts.push(count)
  }
  return counts
}

/**
 * Trim a track to the actual frame count of its row. A row with 0 detected
 * frames degrades to the first frame (the atlas is still loading or corrupt)
 * so the pet never renders blank.
 */
export function trimTrack(track: TrackDef, frameCount: number): TrackDef {
  const n = Math.max(1, Math.min(frameCount, track.frames.length))
  return {
    frames: track.frames.slice(0, n),
    durations: track.durations.slice(0, n),
    loop: track.loop,
    ...(track.fallback === undefined ? {} : { fallback: track.fallback }),
  }
}
