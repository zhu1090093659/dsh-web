/**
 * frames2d renderer — plays the free-form named frame-sequence tracks of a
 * frames2d pet (manifest v2 'frames2d' block). The pet center picks the
 * track from the ActivityPhase stream (phase -> track map, idle fallback);
 * the gameplay driver may force a track through the handle's setState
 * override (drag/work/sleep/shop...), and a finished non-loop track settles
 * into its fallback, releasing the override when the fallback matches the
 * phase-mapped track. Rendering never throws: a broken track list degrades
 * to the first decodable frame, and the 1.2 s stall watchdog re-kicks the
 * playback chain after timer throttling.
 *
 * Frame presentation has two modes picked once at mount by capability
 * probing:
 * - Canvas bitmap buffer (default where createImageBitmap/fetch/2D context
 *   exist): every frame is decoded exactly once into an ImageBitmap during
 *   the warm pass and drawn onto one <canvas> - steady-state playback issues
 *   zero DOM mutations and zero re-decodes (measured hotspot: swapping
 *   <img>.src per frame drove image decode + invalidation every tick).
 * - Classic <img> fallback (jsdom/tests or missing APIs): identical to the
 *   historical behavior - cache-warm Image elements plus guarded src swaps,
 *   so environments without modern decoding keep working unchanged.
 *
 * @module @linxin666/dsh-pet/client/renderers/frames2d
 */

import { PET_RENDERER_API_VERSION, type PetRenderer, type PetRendererContext, type PetRendererHandle } from '../../contracts/renderer.ts'
import type { ActivityPhase } from '../../state.ts'

/** One track as served inside the pet definition (browser URLs). */
export interface Frames2dTrackConfig {
  frames: string[]
  durations: number[]
  loop: boolean
  fallback?: string
}

/** The frames2d block as served inside the pet definition. */
export interface PetFrames2dConfig {
  tracks: Record<string, Frames2dTrackConfig>
  phases: Partial<Record<ActivityPhase, string>> & { idle: string }
  /** Selectable skins; each swaps the base idle target while selected. */
  skins?: Frames2dSkinConfig[]
}

/** One selectable skins entry as served inside the pet definition. */
export interface Frames2dSkinConfig {
  id: string
  label: string
  /** A declared looping track that becomes the base idle while selected. */
  idleTrack: string
  /** Click actions exclusive to this skin (roll by probability; miss → touch zones). */
  clickActions?: Frames2dSkinClickActionConfig[]
}

/** One probability-rolled tap action a skin may declare. */
export interface Frames2dSkinClickActionConfig {
  track: string
  probability: number
  phrases?: string[]
}

export interface Frames2dRendererHandle extends PetRendererHandle {
  /** Force a track id (gameplay override); undefined returns to phase mapping. */
  setState(track: string | undefined): void
  /**
   * Swap the base idle target (idle phase, unmapped phases and every
   * fallback back to idle) to a declared looping track — a skin. undefined
   * restores the manifest idle track.
   */
  setIdleTrack(track: string | undefined): void
  /** The track currently playing (diagnostics and tests). */
  currentTrack(): string
}

/** Stall watchdog period: a looping track stuck longer re-kicks its chain. */
const WATCHDOG_MS = 1200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Fail-closed client-side validation of the served frames2d block. */
function validateFrames2dConfig(config: unknown): PetFrames2dConfig {
  if (!isRecord(config) || !isRecord(config.tracks) || !isRecord(config.phases)) {
    throw new Error('frames2d config requires tracks and phases objects')
  }
  const tracks: Record<string, Frames2dTrackConfig> = {}
  for (const [name, raw] of Object.entries(config.tracks)) {
    if (!isRecord(raw) || !Array.isArray(raw.frames) || raw.frames.length === 0
      || raw.frames.some(f => typeof f !== 'string' || f === '')
      || !Array.isArray(raw.durations) || raw.durations.length !== raw.frames.length
      || raw.durations.some(d => typeof d !== 'number' || !(d > 0))) {
      throw new Error('frames2d track ' + JSON.stringify(name) + ' needs same-length frames/durations')
    }
    tracks[name] = {
      frames: raw.frames as string[],
      durations: raw.durations as number[],
      loop: raw.loop !== false,
      ...(typeof raw.fallback === 'string' ? { fallback: raw.fallback } : {}),
    }
  }
  const phases = config.phases as Partial<Record<ActivityPhase, string>>
  if (typeof phases.idle !== 'string' || tracks[phases.idle] === undefined) {
    throw new Error('frames2d phases.idle must name an existing track')
  }
  // Skins: keep entries whose idleTrack survives validation and loops —
  // a non-looping base idle would settle into itself forever. Click actions
  // with an unresolvable track are dropped from that skin.
  let skins: Frames2dSkinConfig[] | undefined
  if (Array.isArray(config.skins)) {
    const resolved: Frames2dSkinConfig[] = []
    for (const skin of config.skins as unknown[]) {
      if (!isRecord(skin) || typeof skin.id !== 'string' || typeof skin.label !== 'string'
        || typeof skin.idleTrack !== 'string' || skin.idleTrack === '') continue
      const target = tracks[skin.idleTrack]
      if (target === undefined || !target.loop) continue
      let clickActions: Frames2dSkinClickActionConfig[] | undefined
      if (Array.isArray(skin.clickActions)) {
        const kept: Frames2dSkinClickActionConfig[] = []
        for (const action of skin.clickActions as unknown[]) {
          if (!isRecord(action) || typeof action.track !== 'string' || action.track === ''
            || typeof action.probability !== 'number' || !(action.probability > 0) || action.probability > 1) continue
          if (tracks[action.track] === undefined) continue
          kept.push({
            track: action.track,
            probability: action.probability,
            ...(Array.isArray(action.phrases) ? { phrases: action.phrases as string[] } : {}),
          })
        }
        if (kept.length > 0) clickActions = kept
      }
      resolved.push({ id: skin.id, label: skin.label, idleTrack: skin.idleTrack, ...(clickActions === undefined ? {} : { clickActions }) })
    }
    if (resolved.length > 0) skins = resolved
  }
  return { tracks, phases: phases as PetFrames2dConfig['phases'], ...(skins === undefined ? {} : { skins }) }
}

interface DecodedFrame {
  source: ImageBitmap | HTMLImageElement
  width: number
  height: number
}

export const frames2dRenderer: PetRenderer<PetFrames2dConfig> = {
  id: 'frames2d',
  apiVersion: PET_RENDERER_API_VERSION,
  validateConfig: validateFrames2dConfig,

  mount(ctx: PetRendererContext, config: PetFrames2dConfig): Frames2dRendererHandle {
    const reducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Capability probe: the canvas path needs decode-to-bitmap, same-origin
    // fetch, and a real 2D context (jsdom returns null and falls back below).
    let canvas: HTMLCanvasElement | null = null
    let context2d: CanvasRenderingContext2D | null = null
    let img: HTMLImageElement | null = null
    try {
      if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
        const probe = document.createElement('canvas')
        const c2d = probe.getContext('2d')
        if (c2d !== null) {
          canvas = probe
          context2d = c2d
        }
      }
    } catch {
      canvas = null
      context2d = null
    }

    if (canvas !== null && context2d !== null) {
      canvas.dataset.dshPetFrames2d = ctx.petId
      canvas.draggable = false
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.objectFit = 'contain'
      canvas.style.pointerEvents = 'none'
      ctx.container.appendChild(canvas)
    } else {
      img = document.createElement('img')
      img.dataset.dshPetFrames2d = ctx.petId
      img.alt = ''
      img.draggable = false
      img.style.width = '100%'
      img.style.height = '100%'
      img.style.objectFit = 'contain'
      img.style.pointerEvents = 'none'
      ctx.container.appendChild(img)
    }

    // Decode cache: one concurrent decode per URL, memoized forever (frames
    // are tiny same-origin webp files; failures resolve undefined and keep
    // the last painted frame instead of breaking playback).
    const decoding = new Map<string, Promise<DecodedFrame | undefined>>()
    const decodedAll: Promise<void>[] = []
    const loadFrame = (url: string): Promise<DecodedFrame | undefined> => {
      const cached = decoding.get(url)
      if (cached !== undefined) return cached
      const job: Promise<DecodedFrame | undefined> = (async () => {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error('http ' + response.status)
          const bitmap = await createImageBitmap(await response.blob())
          return { source: bitmap, width: bitmap.width, height: bitmap.height }
        } catch {
          // Fail-open: classic Image decode keeps non-modern runtimes alive.
          return await new Promise<DecodedFrame | undefined>((resolve) => {
            try {
              const pre = new Image()
              pre.onload = (): void => {
                resolve(pre.naturalWidth > 0 ? { source: pre, width: pre.naturalWidth, height: pre.naturalHeight } : undefined)
              }
              pre.onerror = (): void => resolve(undefined)
              pre.src = url
            } catch {
              resolve(undefined)
            }
          })
        }
      })()
      decoding.set(url, job)
      decodedAll.push(job.then(() => undefined, () => undefined))
      return job
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setInterval> | undefined
    let track: string = config.phases.idle
    let frameIndex = 0
    let lastAdvance = Date.now()
    let override: string | undefined
    // Skin base idle: every "back to idle" target resolves through this
    // (idle phase, unmapped phases and fallbacks), so a selected skin swaps
    // the pet's resting look without touching gameplay tracks.
    let baseIdle: string = config.phases.idle
    let drawToken = 0
    let lastDrawnUrl: string | undefined

    const trackForPhase = (phase: ActivityPhase): string => {
      const mapped = config.phases[phase]
      if (mapped === undefined) return baseIdle
      const target = mapped === config.phases.idle ? baseIdle : mapped
      return config.tracks[target] !== undefined ? target : baseIdle
    }

    /** Canvas path: paints the newest requested frame; stale draws drop out. */
    const paintCanvas = (url: string): void => {
      if (context2d === null || canvas === null) return
      const myToken = ++drawToken
      void loadFrame(url).then((frame) => {
        if (disposed || frame === undefined || myToken !== drawToken) return
        if (lastDrawnUrl === url) return
        lastDrawnUrl = url
        // Resizing clears the canvas, so size only when it actually differs.
        if (canvas.width !== frame.width || canvas.height !== frame.height) {
          canvas.width = frame.width
          canvas.height = frame.height
        } else {
          context2d.clearRect(0, 0, canvas.width, canvas.height)
        }
        context2d.drawImage(frame.source as CanvasImageSource, 0, 0)
      }).catch(() => { /* keep last frame */ })
    }

    const show = (trackId: string, index: number): void => {
      const def = config.tracks[trackId]
      const url = def?.frames[index]
      if (url === undefined) return
      if (img !== null) {
        if (img.getAttribute('src') !== url) img.src = url
        return
      }
      paintCanvas(url)
    }

    const schedule = (ms: number): void => {
      if (disposed) return
      timer = setTimeout(tick, ms)
    }

    function tick(): void {
      if (disposed) return
      const def = config.tracks[track]
      if (def === undefined || def.frames.length === 0) return
      lastAdvance = Date.now()
      const next = frameIndex + 1
      if (next < def.frames.length) {
        frameIndex = next
        show(track, frameIndex)
        schedule(def.durations[frameIndex] ?? 200)
        return
      }
      if (def.loop) {
        frameIndex = 0
        show(track, frameIndex)
        schedule(def.durations[frameIndex] ?? 200)
        return
      }
      // Non-loop completion: settle into the fallback — an explicit fallback to
      // a real track wins, except when it points back at the manifest idle
      // (that resolves through the skin base idle); anything else lands on
      // the skin base idle. When the settle target is what the phase map
      // plays anyway, release the gameplay override.
      const target = def.fallback !== undefined && config.tracks[def.fallback] !== undefined
        ? (def.fallback === config.phases.idle ? baseIdle : def.fallback)
        : baseIdle
      if (target === trackForPhase(ctx.phase.get())) override = undefined
      play(target)
    }

    function play(trackId: string): void {
      if (disposed) return
      if (config.tracks[trackId] === undefined) trackId = baseIdle
      if (timer !== undefined) clearTimeout(timer)
      track = trackId
      frameIndex = 0
      lastAdvance = Date.now()
      show(track, frameIndex)
      if (reducedMotion) return
      const def = config.tracks[track]!
      schedule(def.durations[0] ?? 200)
    }

    const unsubscribe = ctx.phase.subscribe((phase) => {
      if (override !== undefined) return
      const target = trackForPhase(phase)
      if (target !== track) play(target)
    })

    // Watchdog: a throttled-away timer (background tab) leaves the chain
    // dead; re-kick when a looping track has not advanced on schedule.
    if (!reducedMotion) {
      watchdog = setInterval(() => {
        if (disposed) return
        const def = config.tracks[track]
        if (def === undefined || !def.loop) return
        const expected = (def.durations[frameIndex] ?? 200) + WATCHDOG_MS
        if (Date.now() - lastAdvance > expected) tick()
      }, WATCHDOG_MS)
    }

    // Warm pass: decode every frame up front (tiny same-origin webp files)
    // so loops and phase switches never wait on a first decode - same intent
    // as the historical Image-cache warm loop, now feeding the decode cache.
    for (const warmTrack of Object.values(config.tracks)) {
      for (const warmUrl of warmTrack.frames) void loadFrame(warmUrl)
    }

    play(track)

    let disposedOnce = false
    const dispose = (): void => {
      if (disposedOnce) return
      disposedOnce = true
      disposed = true
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
      if (watchdog !== undefined) clearInterval(watchdog)
      // Release decoded bitmaps after pending decodes settle; close() is
      // browser-only, so guard it for exotic hosts.
      void Promise.allSettled(decodedAll).then(() => {
        for (const job of decoding.values()) {
          void job.then((frame) => {
            try {
              const maybeClose = (frame?.source as { close?: () => void } | undefined)?.close
              if (typeof maybeClose === 'function' && frame !== undefined) maybeClose.call(frame.source)
            } catch { /* already released */ }
          }).catch(() => { /* never rejects anyway */ })
        }
        decoding.clear()
      })
      canvas?.remove()
      img?.remove()
    }
    ctx.onCleanup(dispose)

    return {
      dispose,
      setState(next: string | undefined): void {
        if (disposed) return
        if (next === undefined) {
          override = undefined
          const target = trackForPhase(ctx.phase.get())
          if (target !== track) play(target)
          return
        }
        if (config.tracks[next] === undefined) return
        override = next
        if (next !== track) play(next)
      },
      setIdleTrack(next: string | undefined): void {
        if (disposed) return
        if (next === undefined || (config.tracks[next] !== undefined && config.tracks[next]!.loop)) {
          baseIdle = next ?? config.phases.idle
        }
        // A skin only owns the resting look: re-resolve only when no
        // gameplay override is active (active overrides end into baseIdle).
        if (override === undefined) {
          const target = trackForPhase(ctx.phase.get())
          if (target !== track) play(target)
        }
      },
      currentTrack(): string {
        return track
      },
    }
  },
}
