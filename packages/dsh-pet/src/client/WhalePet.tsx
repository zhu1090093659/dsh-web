/**
 * Whale-girl companion component — the browser half's centerpiece. Renders a
 * fixed-position floating sprite (React portal onto document.body), plays
 * the spritesheet track matching the host animation snapshot, and exposes
 * the interaction surface: click to pet, hover panel with feed/hide, drag to
 * reposition (persisted via setConfig).
 * @module @linxin666/dsh-pet/client/WhalePet
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import type { PetFeedback } from './pet-store.ts'
import { framePosition, FRAME_WIDTH, FRAME_HEIGHT, FRAME_COLUMNS, TRACKS, rowOfTrack, trimTrack, detectFrameCounts } from './spritesheet.ts'
import type { PetAnimation } from '../state.ts'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Browser URL of the whale-girl atlas (served by the host half's own route). */
export const PET_SPRITESHEET_URL = '/pet/whale/spritesheet.webp'

/** Browser URL of the whale-girl manifest (authoritative per-row frame counts). */
export const PET_MANIFEST_URL = '/pet/whale/pet.json'

/** Props injected by the slot registration (store actions + locale). */
export interface WhalePetProps {
  /** Latest host snapshot; null while loading. */
  snapshot: PetStateView | null
  /** Display configuration (persisted by the host). */
  display: PetDisplayConfig
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
  /** Pet the whale girl (click). */
  onPet: () => void
  /** Feed the whale girl (panel button). */
  onFeed: () => void
  /** Hide the whale girl (panel button). */
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

/** Clamp a drag offset inside the viewport with a margin. */
function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/**
 * The floating pet. The spritesheet frame advances on requestAnimationFrame
 * with per-frame durations from TRACKS; the atlas image is loaded once and
 * the background position is written straight to the sprite element (no
 * per-frame React state).
 */
export function WhalePet(props: WhalePetProps): ReactPortal {
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
          if (Array.isArray(frames) && frames.length === 9 && frames.every((n) => typeof n === 'number')) {
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

  // Frame loop: advance the current track and write background-position.
  // Offsets must be in SCALED coordinates (background-position applies to the
  // scaled background image), so the current sprite scale rides a ref that
  // the loop reads every tick. Under prefers-reduced-motion the sprite holds
  // its track's first frame instead of animating (presentation-only; the
  // animation state machine is untouched).
  const spriteScale = display.size / FRAME_HEIGHT
  const animation = snapshot?.animation ?? 'idle'
  const scaleRef = useRef(spriteScale)
  scaleRef.current = spriteScale
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    // Paint one static sprite frame up front either way, so the pet is never
    // blank while the loop heat-up runs.
    const row = rowOfTrack(animation)
    const track = frameCounts === null
      ? TRACKS[animation]
      : trimTrack(TRACKS[animation], frameCounts[row] ?? TRACKS[animation].frames.length)
    const leadCol = track.frames[0]!
    const lead = framePosition(row, leadCol, scaleRef.current)
    if (spriteRef.current !== null) {
      spriteRef.current.style.backgroundPosition = `${lead.x}px ${lead.y}px`
    }
    if (reduceMotion) return
    let raf = 0
    let last = performance.now()
    const tick = (ts: number): void => {
      const delta = ts - last
      last = ts
      // Trim the track to the row's real frame count (transparent cells
      // would render as a vanishing pet).
      const row = rowOfTrack(animation)
      const track = frameCounts === null
        ? TRACKS[animation]
        : trimTrack(TRACKS[animation], frameCounts[row] ?? TRACKS[animation].frames.length)
      const st = frameRef.current
      if (st.track !== animation) {
        st.track = animation
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
      const { x, y } = framePosition(row, col, scaleRef.current)
      if (spriteRef.current !== null) {
        spriteRef.current.style.backgroundPosition = `${x}px ${y}px`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animation, frameCounts])

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
  // trailing click (fired after pointerup) does not pet the whale.
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

  const pos = dragPos ?? { right: display.right, bottom: display.bottom }
  const spriteWidth = Math.round(FRAME_WIDTH * spriteScale)
  const spriteHeight = Math.round(FRAME_HEIGHT * spriteScale)

  const float = (
    <div
      ref={floatRef}
      className={styles.float}
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
        // short grace period to reach the panel across the gap above it.
        const next = e.relatedTarget
        if (next instanceof Node && floatRef.current?.contains(next)) return
        clearHideTimer()
        hideTimerRef.current = window.setTimeout(() => setHovered(false), 200)
      }}
    >
      <div
        ref={spriteRef}
        className={styles.sprite}
        style={{
          width: spriteWidth,
          height: spriteHeight,
          backgroundImage: imageReady ? `url(${PET_SPRITESHEET_URL})` : undefined,
          backgroundSize: `${FRAME_WIDTH * FRAME_COLUMNS * spriteScale}px ${FRAME_HEIGHT * 9 * spriteScale}px`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 0',
          cursor: dragRef.current === null ? 'grab' : 'grabbing',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => {
          // A pointer sequence that moved (dragged) still fires a trailing
          // click; skip the pet when that happened.
          if (draggedRef.current) return
          props.onPet()
        }}
        role="button"
        aria-label="whale girl"
      />
      {feedback !== null && (
        <div key={feedback.at} className={`${styles.bubble} ${feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet}`}>
          {feedback.text}
        </div>
      )}
      {hovered && dragRef.current === null && (
        <div className={styles.panel}>
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
                <span className={styles.nameCell}>{snapshot?.name ?? '鲸鱼娘'}</span>
                <span>{props.t('pet.rank', { rank: snapshot?.affinity.rank ?? '?' })}</span>
              </div>
              <div className={styles.rankRow}>
                <span>{props.t('pet.treats', { n: snapshot?.treats.stocked ?? 0 })}</span>
                <span>{props.t('pet.points', { points: snapshot?.affinity.points ?? 0 })}</span>
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
