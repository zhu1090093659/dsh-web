/**
 * Whale-maid companion component — the browser half's centerpiece. Renders a
 * fixed-position floating sprite (React portal onto document.body), plays
 * the spritesheet track matching the host animation snapshot plus the local
 * Clawd-style poses (click-to-jump, double-click-to-wave, idle sleep-and-
 * wake), tracks the cursor with subtle eye-following, docks into mini mode
 * at the right edge, and exposes the interaction surface: hover panel with
 * feed/hide, drag to reposition (persisted via setConfig).
 * @module @linxin666/dsh-pet-maid/client/MaidPet
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import type { PetFeedback } from './pet-store.ts'
import { framePosition, FRAME_WIDTH, FRAME_HEIGHT, FRAME_COLUMNS, FRAME_ROWS, TRACKS, rowOfTrack, trimTrack, detectFrameCounts } from './spritesheet.ts'
import type { PetAnimation } from '../state.ts'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Browser URL of the pet atlas (served by the host half's own route). */
export const PET_SPRITESHEET_URL = '/pet/maid/spritesheet.webp'

/** Browser URL of the pet manifest (authoritative per-row frame counts). */
export const PET_MANIFEST_URL = '/pet/maid/pet.json'

/** Idle time before the pet falls asleep, ms. */
export const SLEEP_AFTER_MS = 60_000
/** Recent-activity grace that keeps a sleeping pet awake, ms. */
export const WAKE_GRACE_MS = 1_500
/** Max eye-tracking offset, px. */
export const EYE_MAX_OFFSET = 4
/** Right inset at or below which the pet docks into mini mode, px. */
export const MINI_RIGHT_THRESHOLD = 24
/** Mini-mode scale factor (sprite cell height ÷ normal). */
export const MINI_SCALE = 0.22
/** Mini-mode tuck: how much of the pet hides behind the edge. */
export const MINI_TUCK = 0.7

/** Props injected by the slot registration (store actions + locale). */
export interface MaidPetProps {
  /** Latest host snapshot; null while loading. */
  snapshot: PetStateView | null
  /** Display configuration (persisted by the host). */
  display: PetDisplayConfig
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
  /** Pet the whale maid (single click). */
  onPet: () => void
  /** Feed the whale maid (panel button). */
  onFeed: () => void
  /** Hide the whale maid (panel button). */
  onHide: () => void
  /** Persist a drag position. */
  onDragEnd: (right: number, bottom: number) => void
  /** Rename the pet (persisted by the host). */
  onRename: (name: string) => void
  /** Clear the reaction bubble (after its CSS animation). */
  onFeedbackDone: () => void
  /** Locale translate seat (namespace-bound). */
  t: TranslateNS<typeof NS>
}

/** One pending local reaction. */
export interface PetReaction {
  kind: 'jump' | 'wave'
  /** Epoch ms until which the reaction overrides the host animation. */
  until: number
}

/** Clamp a drag offset inside the viewport with a margin. */
function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/**
 * Resolve the effective pose for one tick: a live reaction wins, then an
 * asleep pet sleeps, then the host animation. Pure: the caller writes the
 * returned `asleep` back to its ref.
 */
export function resolvePose(
  base: PetAnimation,
  input: {
    /** Live reaction, if any (an expired one is ignored). */
    reaction: PetReaction | null
    /** Whether the pet is currently asleep. */
    asleep: boolean
    /** Epoch ms of the last user activity. */
    lastActive: number
    /** Current epoch ms. */
    now: number
  },
): { animation: PetAnimation; asleep: boolean } {
  const { reaction, asleep, lastActive, now } = input
  if (reaction !== null && now < reaction.until) {
    return { animation: reaction.kind === 'wave' ? 'waving' : 'jumping', asleep }
  }
  const restful = base === 'idle' || base === 'thinking'
  if (restful) {
    if (asleep) {
      if (now - lastActive < WAKE_GRACE_MS) return { animation: base, asleep: false }
      return { animation: 'sleeping', asleep: true }
    }
    if (now - lastActive > SLEEP_AFTER_MS) return { animation: 'sleeping', asleep: true }
    return { animation: base, asleep: false }
  }
  return { animation: base, asleep: false }
}

/**
 * Resolve the sprite CSS transform for one tick: mini mode tucks/peeks,
 * otherwise idle poses lean toward the cursor (eye tracking). Pure.
 */
export function spriteTransform(
  effective: PetAnimation,
  input: {
    mini: boolean
    hovered: boolean
    eyeTracking: boolean
    eye: { x: number; y: number }
  },
): string {
  if (input.mini) {
    const tuck = input.hovered ? 0 : MINI_TUCK
    return `translateX(${tuck * 100}%)`
  }
  if (input.eyeTracking && (effective === 'idle' || effective === 'thinking' || effective === 'sleeping')) {
    return `translate(${input.eye.x}px, ${input.eye.y}px)`
  }
  return ''
}

/**
 * The floating pet. The spritesheet frame advances on requestAnimationFrame
 * with per-frame durations from TRACKS; the atlas image is loaded once and
 * the background position is written straight to the sprite element (no
 * per-frame React state). Local poses (jump / wave / sleep) override the
 * host animation until they expire or activity resumes.
 */
export function MaidPet(props: MaidPetProps): ReactPortal {
  const { snapshot, display, feedback } = props
  const spriteRef = useRef<HTMLDivElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [frameCounts, setFrameCounts] = useState<number[] | null>(null)
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number } | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const frameRef = useRef<{ track: PetAnimation | null; index: number; elapsed: number }>({
    track: null,
    index: 0,
    elapsed: 0,
  })
  // Local pose state (all refs: the rAF loop reads them per tick).
  const reactionRef = useRef<PetReaction | null>(null)
  const sleepRef = useRef(false)
  const lastActiveRef = useRef(Date.now())
  const cursorRef = useRef<{ x: number; y: number } | null>(null)
  const eyeRef = useRef({ x: 0, y: 0 })
  const clickTimerRef = useRef<number | null>(null)

  const pos = dragPos ?? { right: display.right, bottom: display.bottom }
  const posRef = useRef(pos)
  posRef.current = pos
  const hoveredRef = useRef(hovered)
  hoveredRef.current = hovered
  const mini = display.miniMode && pos.right <= MINI_RIGHT_THRESHOLD

  // Load the atlas once; then resolve per-row frame counts so tracks never
  // play the transparent trailing cells of a short row. One decoded Image
  // feeds both the sprite render and the frame-count detection. The counts
  // prefer the authoritatively recorded `frames` field on the pet.json
  // manifest route and only fall back to the getImageData atlas scan when
  // that field is absent (older manifests).
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setImageReady(true)
      fetch(PET_MANIFEST_URL)
        .then((res) => (res.ok ? res.json() : Promise.resolve<{ frames?: unknown }>({})))
        .then((manifest: { frames?: unknown }) => {
          if (cancelled) return
          const frames = manifest.frames
          if (Array.isArray(frames) && frames.length === FRAME_ROWS && frames.every((n) => typeof n === 'number')) {
            setFrameCounts(frames as number[])
          } else {
            setFrameCounts(detectFrameCounts(img))
          }
        })
        .catch(() => {
          if (!cancelled) setFrameCounts(detectFrameCounts(img))
        })
    }
    img.src = PET_SPRITESHEET_URL
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [])

  // Window-level activity listeners: cursor position for eye tracking, and
  // any pointer activity counts as "the user is here" (wakes / delays sleep).
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      cursorRef.current = { x: e.clientX, y: e.clientY }
      lastActiveRef.current = Date.now()
    }
    const onDown = (): void => {
      lastActiveRef.current = Date.now()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
    }
  }, [])

  // Frame loop: resolve the effective pose, advance the current track and
  // write background-position + transform. Offsets must be in SCALED
  // coordinates (background-position applies to the scaled background
  // image), so the current sprite scale rides a ref the loop reads every
  // tick. Under prefers-reduced-motion the sprite holds its track's first
  // frame instead of animating (presentation-only; the animation state
  // machine is untouched).
  const spriteScale = display.size / FRAME_HEIGHT
  const animation = snapshot?.animation ?? 'idle'
  const scaleRef = useRef(spriteScale)
  scaleRef.current = spriteScale
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    const minScale = display.miniMode ? MINI_SCALE : 1
    const effectiveScale = Math.max(minScale, scaleRef.current)
    // Paint one static sprite frame up front either way, so the pet is never
    // blank while the loop heat-up runs.
    const leadRow = rowOfTrack(animation)
    const leadTrack = frameCounts === null
      ? TRACKS[animation]
      : trimTrack(TRACKS[animation], frameCounts[leadRow] ?? TRACKS[animation].frames.length)
    const leadCol = leadTrack.frames[0]!
    const lead = framePosition(leadRow, leadCol, effectiveScale)
    if (spriteRef.current !== null) {
      spriteRef.current.style.backgroundPosition = `${lead.x}px ${lead.y}px`
    }
    if (reduceMotion) return
    let raf = 0
    let last = performance.now()
    const tick = (ts: number): void => {
      const delta = ts - last
      last = ts
      const now = Date.now()
      if (reactionRef.current !== null && now >= reactionRef.current.until) {
        reactionRef.current = null
      }
      const resolved = resolvePose(animation, {
        reaction: reactionRef.current,
        asleep: sleepRef.current,
        lastActive: lastActiveRef.current,
        now,
      })
      sleepRef.current = resolved.asleep
      const effective = resolved.animation
      const row = rowOfTrack(effective)
      const track = frameCounts === null
        ? TRACKS[effective]
        : trimTrack(TRACKS[effective], frameCounts[row] ?? TRACKS[effective].frames.length)
      const st = frameRef.current
      if (st.track !== effective) {
        st.track = effective
        st.index = 0
        st.elapsed = 0
      }
      st.elapsed += delta
      const maxIndex = track.frames.length - 1
      while (st.elapsed >= (track.durations[st.index] ?? 0) && st.index < maxIndex) {
        st.elapsed -= track.durations[st.index] ?? 0
        st.index += 1
      }
      if (st.elapsed >= (track.durations[st.index] ?? 0)) {
        if (track.loop) {
          st.elapsed = 0
          st.index = 0
        } else {
          st.index = maxIndex // hold the final frame; the host switches tracks
        }
      }
      const col = track.frames[st.index]!
      const { x, y } = framePosition(row, col, effectiveScale)
      if (spriteRef.current !== null) {
        spriteRef.current.style.backgroundPosition = `${x}px ${y}px`
        spriteRef.current.style.transform = spriteTransform(effective, {
          mini: posRef.current.right <= MINI_RIGHT_THRESHOLD && display.miniMode,
          hovered: hoveredRef.current,
          eyeTracking: display.eyeTracking,
          eye: eyeRef.current,
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // The effect restarts only when the base animation, frame counts, or the
    // display toggles change; per-tick pose resolution reads refs, so
    // re-renders never reset the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animation, frameCounts, display.miniMode, display.eyeTracking])

  // Eye-tracking target: lerp the stored offset toward the cursor-relative
  // target on a light cadence while the pet can look (idle poses only matter;
  // the transform applies only for those poses anyway).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const target = { x: 0, y: 0 }
      if (display.eyeTracking && cursorRef.current !== null) {
        const rect = floatRef.current?.getBoundingClientRect()
        if (rect !== undefined) {
          const cx = rect.left + rect.width / 2
          const cy = rect.top + rect.height / 2
          const dx = cursorRef.current.x - cx
          const dy = cursorRef.current.y - cy
          const dist = Math.hypot(dx, dy)
          if (dist > 1) {
            const strength = Math.min(1, dist / 150)
            target.x = (dx / dist) * EYE_MAX_OFFSET * strength
            target.y = (dy / dist) * EYE_MAX_OFFSET * strength
          }
        }
      }
      eyeRef.current.x += (target.x - eyeRef.current.x) * 0.16
      eyeRef.current.y += (target.y - eyeRef.current.y) * 0.16
    }, 32)
    return () => window.clearInterval(timer)
  }, [display.eyeTracking])

  // Auto-clear the feedback bubble after its CSS animation. The callback
  // rides a ref so re-renders never reset the timer: the 800ms poll rebuilds
  // `props` every tick, and depending on it would starve the timeout.
  const feedbackDoneRef = useRef(props.onFeedbackDone)
  feedbackDoneRef.current = props.onFeedbackDone
  useEffect(() => {
    if (feedback === null) return
    const timer = window.setTimeout(() => feedbackDoneRef.current(), 2600)
    return () => window.clearTimeout(timer)
  }, [feedback])

  // Dragging: pointer events on the sprite; position is right/bottom based.
  // `draggedRef` records whether the pointer actually moved, so the browser's
  // trailing click (fired after pointerup) does not pet the maid.
  const draggedRef = useRef(false)
  const clearHideTimer = (): void => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const current = dragPos ?? { right: display.right, bottom: display.bottom }
    dragRef.current = { startX: e.clientX, startY: e.clientY, ...current }
    draggedRef.current = false
    setHovered(false)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) draggedRef.current = true
    const right = clampOffset(drag.right - dx, window.innerWidth - 40)
    const bottom = clampOffset(drag.bottom - dy, window.innerHeight - 40)
    setDragPos({ right, bottom })
  }
  const onPointerUp = (): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    if (dragPos !== null) props.onDragEnd(dragPos.right, dragPos.bottom)
  }

  // Single click pets (jump reaction); a second click inside the window
  // becomes a double-click wave instead. In mini mode the click pops the pet
  // out of the edge dock and does not pet it.
  const onClick = (): void => {
    if (draggedRef.current) return
    if (mini) {
      props.onDragEnd(Math.max(pos.right, 260), pos.bottom)
      return
    }
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
      reactionRef.current = { kind: 'wave', until: Date.now() + 700 }
      return
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      reactionRef.current = { kind: 'jump', until: Date.now() + 840 }
      props.onPet()
    }, 250)
  }

  const miniScale = display.miniMode && pos.right <= MINI_RIGHT_THRESHOLD ? MINI_SCALE : 1
  const baseScale = Math.max(miniScale, spriteScale)
  const spriteWidth = Math.round(FRAME_WIDTH * baseScale)
  const spriteHeight = Math.round(FRAME_HEIGHT * baseScale)

  const float = (
    <div
      ref={floatRef}
      className={mini ? styles.floatMini : styles.float}
      style={{ right: pos.right, bottom: pos.bottom, zIndex: 2147483000 }}
      onPointerEnter={() => {
        clearHideTimer()
        setHovered(true)
      }}
      onPointerLeave={(e) => {
        // The panel and bubble render OUTSIDE the container's box (absolute,
        // above the sprite), so moving onto them fires pointerleave on the
        // container. Treat a target still inside the container's DOM (the
        // overflowed panel) as "still hovering"; otherwise give the pointer a
        // short grace period to reach the panel across the gap above it. The
        // bridge (`.panel::after`) keeps the pointer inside the hit area, and
        // the grace period covers a slow mouse crossing the remaining sliver.
        const next = e.relatedTarget
        if (next instanceof Node && floatRef.current?.contains(next)) return
        clearHideTimer()
        hideTimerRef.current = window.setTimeout(() => setHovered(false), 300)
      }}
    >
      <div
        ref={spriteRef}
        className={styles.sprite}
        style={{
          width: spriteWidth,
          height: spriteHeight,
          backgroundImage: imageReady ? `url(${PET_SPRITESHEET_URL})` : undefined,
          backgroundSize: `${FRAME_WIDTH * FRAME_COLUMNS * baseScale}px ${FRAME_HEIGHT * FRAME_ROWS * baseScale}px`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 0',
          cursor: dragRef.current === null ? 'grab' : 'grabbing',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        role="button"
        aria-label="whale maid"
        data-testid="pet-sprite"
      />
      {feedback !== null && !mini && (
        <div key={feedback.at} className={`${styles.bubble} ${feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet}`}>
          {feedback.text}
        </div>
      )}
      {!mini && (snapshot?.workingTier ?? 0) >= 2 && feedback === null && (
        <div className={styles.tierBadge} data-testid="pet-tier">
          {props.t('pet.parallel', { n: snapshot?.workingTier ?? 2 })}
        </div>
      )}
      {hovered && dragRef.current === null && !mini && (
        <div
          className={styles.panel}
          onPointerEnter={() => {
            // Reaching the panel (or its bridge) must cancel any hide timer
            // the container's pointerleave may have armed while the pointer
            // crossed the sliver between the sprite and the panel.
            clearHideTimer()
          }}
        >
          {renaming ? (
            <div className={styles.renameRow}>
              <input
                className={styles.nameInput}
                value={nameDraft}
                maxLength={20}
                placeholder={props.t('pet.namePlaceholder')}
                autoFocus
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  // While an IME composition is active (e.g. selecting a
                  // Chinese candidate), Enter/Escape keydowns belong to the
                  // input method: ignore them so candidate selection can
                  // neither submit the draft nor close the rename box.
                  if (e.nativeEvent.isComposing) return
                  if (e.key === 'Enter') {
                    const trimmed = nameDraft.trim()
                    if (trimmed !== '') {
                      props.onRename(trimmed)
                      setRenaming(false)
                    }
                  } else if (e.key === 'Escape') {
                    setRenaming(false)
                  }
                }}
              />
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  const trimmed = nameDraft.trim()
                  if (trimmed !== '') {
                    props.onRename(trimmed)
                    setRenaming(false)
                  }
                }}
              >
                {props.t('pet.confirm')}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.rankRow}>
                <span className={styles.nameCell}>{snapshot?.name ?? '女仆鲸鱼娘'}</span>
                <span>{props.t('pet.rank', { rank: snapshot?.affinity.rank ?? '?' })}</span>
              </div>
              <div className={styles.rankRow}>
                <span>{props.t('pet.treats', { n: snapshot?.treats.stocked ?? 0 })}</span>
                <span>{props.t('pet.points', { points: snapshot?.affinity.points ?? 0 })}</span>
              </div>
              <div className={styles.rankRow}>
                <span>{props.t('pet.asset', { source: snapshot?.assetSource === 'local' ? props.t('pet.assetLocal') : props.t('pet.assetBundled') })}</span>
              </div>
              <div className={styles.actions}>
                <button type="button" className={styles.action} onClick={props.onFeed}>
                  {props.t('pet.feed')}
                </button>
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    setNameDraft(snapshot?.name ?? '')
                    setRenaming(true)
                  }}
                >
                  {props.t('pet.rename')}
                </button>
                <button type="button" className={styles.action} onClick={props.onHide}>
                  {props.t('pet.hide')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  return createPortal(float, document.body)
}
