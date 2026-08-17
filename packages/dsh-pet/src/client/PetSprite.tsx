/**
 * Pet sprite companion component — the browser half's centerpiece. Renders a
 * fixed-position floating sprite (React portal onto document.body), plays
 * the track matching the host animation snapshot, and exposes the
 * interaction surface: click to pet, hover panel with feed/rename/hide, drag
 * to reposition (persisted via setConfig). Everything visual comes from the
 * pet definition the host serves ('/api/pet/pets' + the state snapshot's
 * pet id), so one component renders every registry entry.
 * @module @linxin666/dsh-pet/client/PetSprite
 */

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import type { PetDefinition } from '../registry.ts'
import type { PetFeedback } from './pet-store.ts'
import { framePosition, rowOfTrack, trimTrack } from './spritesheet.ts'
import { sequenceFrameAt } from './sequences.ts'
import { animationForPhase, type PetAnimation } from '../state.ts'
import { NS } from './locales.ts'
import styles from './pet.module.css'

/** Props injected by the plugin apply body (store actions + locale). */
export interface PetSpriteProps {
  /** Latest host snapshot; null while loading. */
  snapshot: PetStateView | null
  /** The selected pet's registry definition (atlas URL + geometry + tracks). */
  definition: PetDefinition
  /** Display configuration (persisted by the host). */
  display: PetDisplayConfig
  /** Active reaction bubble, if any. */
  feedback: PetFeedback | null
  /** Pet the sprite (click). */
  onPet: () => void
  /** Feed the sprite (panel button). */
  onFeed: () => void
  /** Hide the sprite (panel button). */
  onHide: () => void
  /** Persist a drag position. */
  onDragEnd: (right: number, bottom: number) => void
  /** Rename the selected pet (persisted by the host). */
  onRename: (name: string) => void
  /** Navigate to the session one status bubble reports on. */
  onOpenSession: (sessionId: string) => void
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
 * with per-frame durations from the definition's tracks; the atlas image is
 * loaded once and the background position is written straight to the sprite
 * element (no per-frame React state).
 */
export function PetSprite(props: PetSpriteProps): ReactPortal {
  const { snapshot, definition, display, feedback } = props
  const spriteRef = useRef<HTMLDivElement | null>(null)
  const floatRef = useRef<HTMLDivElement | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  // Explicit IME composition tracking: some input methods (WeChat IME on
  // Windows) report keydowns with isComposing === false mid-composition, so
  // the native flag alone is not a safe submit/cancel guard (#303).
  const composingRef = useRef(false)
  const [dragPos, setDragPos] = useState<{ right: number; bottom: number } | null>(null)
  const dragRef = useRef<{ startX: number; startY: number; right: number; bottom: number } | null>(null)
  const hideTimerRef = useRef<number | null>(null)
  const frameRef = useRef<{ track: PetAnimation | null; index: number; elapsed: number }>({
    track: null,
    index: 0,
    elapsed: 0,
  })

  const cell = definition.cell
  const columns = definition.columns
  const rows = definition.rows
  const tracks = definition.tracks
  const sequences = definition.sequences

  // Load the atlas once; the definition carries the authoritative per-row
  // frame counts and per-track durations, so nothing else is fetched.
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setImageReady(true)
    }
    img.src = definition.atlasUrl
    return () => {
      cancelled = true
      img.onload = null
    }
  }, [definition.atlasUrl])

  // Frame loop: advance the current track and write background-position.
  // Offsets must be in SCALED coordinates (background-position applies to the
  // scaled background image), so the current sprite scale rides a ref that
  // the loop reads every tick. Under prefers-reduced-motion the sprite holds
  // its track's first frame instead of animating (presentation-only; the
  // animation state machine is untouched).
  const spriteScale = display.size / cell.height
  const phase = snapshot?.phase ?? 'idle'
  const animation = snapshot?.animation ?? 'idle'
  const scaleRef = useRef(spriteScale)
  scaleRef.current = spriteScale
  useEffect(() => {
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    const sequence = animation === animationForPhase(phase) ? sequences?.[phase] : undefined
    const leadAnimation = sequence?.[0] ?? animation
    const row = rowOfTrack(leadAnimation)
    const track = trimTrack(tracks[leadAnimation], rows[row] ?? tracks[leadAnimation].frames.length)
    // Paint one static sprite frame up front either way, so the pet is never
    // blank while the loop heat-up runs.
    const leadCol = track.frames[0]!
    const lead = framePosition(cell, columns, row, leadCol, scaleRef.current)
    if (spriteRef.current !== null) {
      spriteRef.current.style.backgroundPosition = lead.x + 'px ' + lead.y + 'px'
    }
    if (reduceMotion) return
    let raf = 0
    let last = performance.now()
    let sequenceElapsed = 0
    const tick = (ts: number): void => {
      const delta = ts - last
      last = ts
      if (sequence !== undefined) {
        sequenceElapsed += delta
        const current = sequenceFrameAt(sequence, tracks, sequenceElapsed)
        const currentRow = rowOfTrack(current.animation)
        const currentTrack = trimTrack(
          tracks[current.animation],
          rows[currentRow] ?? tracks[current.animation].frames.length,
        )
        const col = currentTrack.frames[current.frameIndex]!
        const pos = framePosition(cell, columns, currentRow, col, scaleRef.current)
        if (spriteRef.current !== null) {
          spriteRef.current.style.backgroundPosition = pos.x + 'px ' + pos.y + 'px'
        }
        raf = requestAnimationFrame(tick)
        return
      }
      // row/track come from the effect scope: they were computed once above
      // and this effect re-runs when animation/tracks/rows change, so the
      // per-frame recompute (trimTrack slices fresh arrays) is pure waste.
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
      const pos = framePosition(cell, columns, row, col, scaleRef.current)
      if (spriteRef.current !== null) {
        spriteRef.current.style.backgroundPosition = pos.x + 'px ' + pos.y + 'px'
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animation, phase, cell, columns, rows, tracks, sequences])

  // Auto-clear the feedback bubble after its CSS animation. The callback
  // rides a ref so re-renders never reset the timer: the 2s poll rebuilds
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
  // trailing click (fired after pointerup) does not pet the sprite.
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
  const spriteWidth = Math.round(cell.width * spriteScale)
  const spriteHeight = Math.round(cell.height * spriteScale)
  // Concurrent sessions each render their own bubble (stacked above the
  // sprite); the legacy single 'bubble' is the fallback when the host serves
  // no per-session list. The hover panel now sits below the sprite, so the
  // bubbles stay visible and clickable while hovering — no region swap.
  const sessionBubbles = snapshot?.sessions ?? []
  const statusBubble = feedback === null && sessionBubbles.length === 0
    ? snapshot?.bubble
    : undefined
  const displayName = snapshot?.name ?? definition.displayName

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
        // The panel renders OUTSIDE the container's box (absolute, below
        // the sprite), so moving onto it fires pointerleave on the container.
        // Treat a target still inside the container's DOM (the overflowed
        // panel) as "still hovering"; otherwise give the pointer a short
        // grace period to reach the panel across the gap below the sprite.
        // The bridge ('.panel::after') keeps the pointer inside the hit
        // area, and the grace period covers a slow mouse crossing the
        // remaining sliver.
        const next = e.relatedTarget
        if (next instanceof Node && floatRef.current?.contains(next)) return
        // Never auto-hide while the rename box is open: moving the pointer
        // onto an IME candidate window (an OS-level window outside the
        // webview) fires pointerleave, and unmounting the input mid-IME-
        // composition crashes some input methods / the renderer (#303).
        if (renaming) return
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
          backgroundImage: imageReady ? 'url(' + definition.atlasUrl + ')' : undefined,
          backgroundSize: (cell.width * columns * spriteScale) + 'px ' + (cell.height * (definition.atlasRows ?? rows.length) * spriteScale) + 'px',
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
        aria-label={definition.displayName}
      />
      {feedback !== null && (
        <div key={feedback.at} className={clsx(styles.bubble, feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet)}>
          {feedback.text}
        </div>
      )}
      {feedback === null && sessionBubbles.length > 0 && (
        <div className={styles.bubbleStack}>
          {sessionBubbles.map(session => (
            <button
              key={session.sessionId}
              type="button"
              className={clsx(styles.bubble, styles.bubbleStatus, styles.bubbleClickable)}
              title={props.t('pet.openSessionHint')}
              onClick={() => { props.onOpenSession(session.sessionId) }}
            >
              {session.bubble}
            </button>
          ))}
        </div>
      )}
      {statusBubble !== undefined && (
        <div className={clsx(styles.bubble, styles.bubbleStatus)} role="status" aria-live="polite">
          {statusBubble}
        </div>
      )}
      {hovered && dragRef.current === null && (
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
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
                onKeyDown={(e) => {
                  // While an IME composition is active (e.g. selecting a
                  // Chinese candidate), Enter/Escape keydowns belong to the
                  // input method: ignore them so candidate selection can
                  // neither submit the draft nor close the rename box. The
                  // explicit ref and the 'Process' key cover IMEs that mark
                  // composition keydowns with isComposing === false (#303).
                  if (composingRef.current || e.nativeEvent.isComposing || e.key === 'Process') return
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
                <span className={styles.nameCell}>{displayName}</span>
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
                    // Cancel any pending hide so the rename box cannot
                    // unmount right as the user starts typing (#303).
                    clearHideTimer()
                    setNameDraft(displayName)
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
