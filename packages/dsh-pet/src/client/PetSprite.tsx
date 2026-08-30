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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, ReactPortal } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDisplayConfig } from '../persist.ts'
import type { PetStateView } from '../service.ts'
import { announcementFresh, type PetAnnouncement } from '../announce.ts'
import type { PetDefinition } from '../registry.ts'
import type { DecorationView } from '../contracts/status-decoration.ts'
import type { PetFeedback } from './pet-store.ts'
import { framePosition, rowOfTrack, trimTrack } from './spritesheet.ts'
import { sequenceFrameAt } from './sequences.ts'
import { animationForPhase, type ActivityPhase, type PetAnimation } from '../state.ts'
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
  /** Drag gesture notifications for renderers with a drag track (frames2d). */
  onDraggingChange?: (dragging: boolean) => void
  /** Rename the selected pet (persisted by the host). */
  onRename: (name: string) => void
  /** Navigate to the session one status bubble reports on. */
  onOpenSession: (sessionId: string) => void
  /** Clear the reaction bubble (after its CSS animation). */
  onFeedbackDone: () => void
  /**
   * Custom visual replacing the sprite2d atlas animation (pet-center M3).
   * The chrome (drag, bubbles, panel, tap economy) is untouched: the visual
   * renders inside the sprite box, and the atlas load + frame loop skip.
   */
  visual?: ReactNode
  /**
   * Gameplay overlay (miku-pet generalization): rendered inside the float
   * container so hover containment and stacking work unchanged. Absent for
   * pets without a gameplay block.
   */
  hud?: ReactNode
  /**
   * Gameplay tap sink: receives the tap point as sprite-box fractions
   * (0..1). When present the chrome reports the tap IN ADDITION to the
   * affinity pet; the HUD decides zones/no-ops.
   */
  onGameplayTap?: (fractionX: number, fractionY: number) => void
  /**
   * Gameplay entry (miku-pet generalization): when present the hover panel
   * renders a 玩法 action that opens/closes the gameplay card. The chrome
   * wires it to the HUD through the per-pet bus (openCard), mirroring the
   * onGameplayTap sink. Absent for pets without a gameplay block.
   */
  onGameplayMenu?: () => void
  /** Disable the drag gesture (gameplay work mode blocks dragging). */
  dragDisabled?: boolean
  /**
   * DOM node the floating chrome portals into. Defaults to document.body
   * (the legacy behavior); the plugin apply passes its owning root (the
   * [data-dsh-plugin="pet"] container) so the root owns the whole surface
   * and a root-keyed suppressor (the portrait mobile layer) hides the pet
   * as one unit instead of missing the portaled sprite.
   */
  portalTarget?: Element
  /** Locale translate seat (namespace-bound). */
  t: TranslateNS<typeof NS>
}

/** Clamp a drag offset inside the viewport with a margin. */
function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

/**
 * The status decoration ornament (pet-center M5, #567). Renders the active
 * phase's frame segment as a CSS-background strip at a compact bubble
 * height; prefers-reduced-motion holds the segment's first frame, and a
 * missing or undecodable asset simply paints nothing (CSS background
 * failure) — the bubble text is never disturbed. The span is aria-hidden;
 * the bubble keeps its own semantics untouched.
 */
function StatusOrnament(props: { decoration: DecorationView; phase: ActivityPhase }): ReactElement | null {
  const { decoration, phase } = props
  const segment = decoration.phases[phase]
  const shown = segment !== undefined && segment !== 'hide'
  const segmentKey = segment !== undefined && segment !== 'hide' ? segment.from + ':' + segment.to : 'none'
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const scale = 18 / decoration.cell.height
  const frameWidth = Math.round(decoration.cell.width * scale)
  const stripWidth = decoration.columns * frameWidth
  // Value-stable dependency key: the host serves a fresh DecorationView
  // object on every state poll (2 s), so the effect must not depend on the
  // object identity — otherwise each poll would cancel and restart the
  // frame loop and the animation would jump back to its first frame.
  const durationsKey = decoration.durations.join(',')
  useEffect(() => {
    if (segment === undefined || segment === 'hide') return
    const el = spanRef.current
    if (el === null) return
    const position = (index: number): string => (-index * frameWidth) + 'px 0px'
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    el.style.backgroundPosition = position(segment.from)
    // A single-frame segment (from === to) has nothing to animate: with
    // loop=true the wrap branch would reset index to the same frame and the
    // tick would keep rescheduling a no-op rAF forever. Settle on the one
    // frame instead — same as the reduced-motion static hold.
    if (reduceMotion || segment.from === segment.to) return
    let timer = 0
    let index = segment.from
    let elapsed = 0
    let last = performance.now()
    const tick = (): void => {
      const now = performance.now()
      const delta = now - last
      last = now
      elapsed += delta
      const duration = decoration.durations[index] ?? 120
      // The segment's frame rate (duration ms, typically 90-160) is far
      // below the rAF cadence, so a 60fps loop would spend ~90% of its
      // ticks doing nothing. Schedule by the remaining time to the next
      // frame instead — the ornament wakes once per frame, not once per
      // screen refresh. A late wake (background tab, jank) carries extra
      // elapsed time, so catch up every due frame like the sprite loop.
      if (elapsed >= duration) {
        do {
          elapsed -= duration
          if (index < segment.to) index += 1
          else if (decoration.loop) index = segment.from
        } while (elapsed >= duration)
        // Only advance the background when the frame actually changes.
        el.style.backgroundPosition = position(index)
      }
      // A non-looping segment settles on its last frame; stop scheduling
      // instead of repainting the same position every frame.
      if (!decoration.loop && index === segment.to) return
      timer = window.setTimeout(tick, Math.max(1, duration - elapsed))
    }
    timer = window.setTimeout(tick, 0)
    return () => window.clearTimeout(timer)
  }, [shown, segmentKey, frameWidth, decoration.loop, durationsKey])
  if (!shown) return null
  return (
    <span
      ref={spanRef}
      aria-hidden="true"
      data-dsh-pet-decoration={decoration.id}
      style={{
        display: 'inline-block',
        width: frameWidth,
        height: 18,
        marginRight: 6,
        verticalAlign: 'middle',
        flexShrink: 0,
        backgroundImage: 'url(' + decoration.entryUrl + ')',
        backgroundSize: stripWidth + 'px 18px',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: '0px 0px',
      }}
    />
  )
}

/**
 * The announcement bubble (dsh-usage linkage): a dedicated, specially
 * designed surface for sibling-plugin facts — a balance or today-spend pill,
 * or a plan-quota card with a tone-tinted accent, a mini meter for percent
 * windows, and the reset instant. It rides the top of the session bubble
 * stack (column-reverse puts the DOM-last child farthest from the sprite)
 * and persists for its TTL instead of the short feedback pop.
 */
function UsageAnnouncementBubble(props: { announcement: PetAnnouncement }): ReactNode {
  const { announcement } = props
  const tone = announcement.tone === 'low'
    ? styles.bubbleUsageLow
    : announcement.tone === 'warn'
      ? styles.bubbleUsageWarn
      : styles.bubbleUsageOk
  return (
    <div
      className={clsx(styles.bubble, styles.bubbleUsage, tone)}
      role="status"
      aria-live="polite"
      data-dsh-pet-announcement={announcement.source}
    >
      <span className={styles.bubbleUsageHead}>
        <span className={styles.bubbleUsageTitle}>{announcement.title}</span>
        {(announcement.kind === 'balance' || announcement.kind === 'cost') && announcement.amount !== undefined && (
          <span className={styles.bubbleUsageValue}>{announcement.amount}</span>
        )}
        {announcement.kind === 'plan' && announcement.percent !== undefined && (
          <span className={styles.bubbleUsageValue}>{Math.round(announcement.percent) + '%'}</span>
        )}
      </span>
      {announcement.kind === 'plan' && announcement.percent !== undefined && (
        <span className={styles.bubbleUsageMeter}>
          <span
            className={styles.bubbleUsageMeterFill}
            style={{ width: Math.min(100, Math.max(0, announcement.percent)) + '%' }}
          />
        </span>
      )}
      {announcement.note !== undefined && (
        <span className={styles.bubbleUsageNote}>{announcement.note}</span>
      )}
    </div>
  )
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
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Whichever bubble surface is currently rendered (feedback, the session
  // stack, or the legacy status bubble) — only one exists at a time.
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [hovered, setHovered] = useState(false)
  // Multi-session bubble stack: collapsed by default (only the display
  // session's bubble + a '+N' badge), expanded on stack hover (peek) or by
  // tapping the badge (pinned, for touch). The display session's bubble
  // anchors the bottom of the stack and never moves when extras open above
  // it, so the pointer target cannot flicker.
  const [stackPeek, setStackPeek] = useState(false)
  const [stackPinned, setStackPinned] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [panelAbove, setPanelAbove] = useState(false)
  // Extra margin-bottom for the above-panel so it stacks clear of the
  // bubbles instead of overlapping them (both anchor at the sprite's top).
  const [panelLift, setPanelLift] = useState(0)
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
  // Hover-panel chrome from the pet's voice pack (pet-center M4, issue
  // #677): every slot falls back to the i18n dictionary when unset. Stat
  // formats carry {rank}/{n}/{points} placeholders the host validated.
  const panel = definition.panel
  const panelLabel = (slot: 'feed' | 'rename' | 'hide' | 'confirm', i18n: string): string =>
    panel?.labels?.[slot] ?? i18n
  const panelStat = (
    slot: 'rank' | 'treats' | 'points',
    i18nKey: 'pet.rank' | 'pet.treats' | 'pet.points',
    values: Record<string, string | number>,
  ): string => {
    const format = panel?.stats?.[slot] ?? props.t(i18nKey, values)
    if (panel?.stats?.[slot] === undefined) return format
    // The host whitelists {rank}/{n}/{points} in every stat slot, so a pack
    // format may reference any of them; substitute all three live values
    // (the slot's own value plus the siblings) instead of only the slot's.
    const all: Record<string, string | number> = {
      rank: snapshot?.affinity.rank ?? '?',
      n: snapshot?.treats.stocked ?? 0,
      points: snapshot?.affinity.points ?? 0,
    }
    let text = format
    for (const [name, value] of Object.entries(all)) text = text.replaceAll('{' + name + '}', String(value))
    return text
  }
  const panelShows = (action: 'feed' | 'rename' | 'hide'): boolean =>
    panel?.actions === undefined || panel.actions.includes(action)

  // Load the atlas once; the definition carries the authoritative per-row
  // frame counts and per-track durations, so nothing else is fetched. A
  // custom visual (pet-center M3) replaces the atlas entirely.
  useEffect(() => {
    if (props.visual !== undefined) return
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
  }, [definition.atlasUrl, props.visual])

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
    if (props.visual !== undefined) return
    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
    const sequence = animation === animationForPhase(phase) ? sequences?.[phase] : undefined
    const leadAnimation = sequence?.[0] ?? animation
    const row = rowOfTrack(leadAnimation)
    const track = trimTrack(tracks[leadAnimation], rows[row] ?? tracks[leadAnimation].frames.length)
    // Paint one static sprite frame up front either way, so the pet is never
    // blank while the loop heat-up runs.
    const leadCol = track.frames[0]!
    const lead = framePosition(cell, row, leadCol, scaleRef.current)
    let lastPosStr = lead.x + 'px ' + lead.y + 'px'
    if (spriteRef.current !== null) {
      spriteRef.current.style.backgroundPosition = lastPosStr
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
        const pos = framePosition(cell, currentRow, col, scaleRef.current)
        const posStr = pos.x + 'px ' + pos.y + 'px'
        if (posStr !== lastPosStr) {
          lastPosStr = posStr
          if (spriteRef.current !== null) {
            spriteRef.current.style.backgroundPosition = posStr
          }
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
      const pos = framePosition(cell, row, col, scaleRef.current)
      const posStr = pos.x + 'px ' + pos.y + 'px'
      if (posStr !== lastPosStr) {
        lastPosStr = posStr
        if (spriteRef.current !== null) {
          spriteRef.current.style.backgroundPosition = posStr
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animation, phase, cell, columns, rows, tracks, sequences, props.visual])

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

  // Clear any pending auto-hide timer on unmount: a stray callback after
  // teardown reads window through react-dom and failed CI runs with
  // "window is not defined" (slow-runner timing, PetSprite.test.tsx).
  useEffect(() => () => clearHideTimer(), [])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (props.dragDisabled === true) return
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
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      if (!draggedRef.current) props.onDraggingChange?.(true)
      draggedRef.current = true
    }
    const right = clampOffset(drag.right - dx, window.innerWidth - 40)
    const bottom = clampOffset(drag.bottom - dy, window.innerHeight - 40)
    setDragPos({ right, bottom })
  }
  const onPointerUp = (): void => {
    if (dragRef.current === null) return
    dragRef.current = null
    if (draggedRef.current) props.onDraggingChange?.(false)
    if (dragPos !== null) props.onDragEnd(dragPos.right, dragPos.bottom)
  }

  const pos = dragPos ?? { right: display.right, bottom: display.bottom }
  const spriteWidth = Math.round(cell.width * spriteScale)
  const spriteHeight = Math.round(cell.height * spriteScale)

  // Concurrent sessions share one bubble slot: only the display session
  // speaks by default, and the rest hide behind a '+N' badge until the stack
  // is hovered/pinned open. The legacy single 'bubble' is the fallback when
  // the host serves no per-session list. The hover panel normally sits below
  // the sprite, so the bubbles stay visible and clickable — no region swap.
  const sessionBubbles = snapshot?.sessions ?? []
  const stackOpen = stackPeek || stackPinned
  const collapsed = !stackOpen && sessionBubbles.length > 1
  const visibleSessions = collapsed ? sessionBubbles.slice(0, 1) : sessionBubbles
  const statusBubble = feedback === null && sessionBubbles.length === 0
    ? snapshot?.bubble
    : undefined
  // The freshest plugin-authored announcement (dsh-usage linkage): a
  // dedicated, specially styled bubble above the session stack. The host
  // already TTL-filters; this client-side check covers the last poll tick.
  const announcement = snapshot?.announcement
  const usageAnnouncement = feedback === null && announcement !== undefined && announcementFresh(announcement, Date.now())
    ? announcement
    : undefined
  // Each session's inner whisper (碎碎念) rides its own bubble — short
  // inner-voice copy woken by that session's activity, never the model's or
  // another session's. Instead of a second bubble of its own, a fresh
  // whisper takes over its session's bubble and re-tints it, so the pet
  // never wears two voices at once. Interaction feedback takes over the
  // whole bubble area while it plays, so whispers yield to it like status
  // copy.
  const bubblePresent = feedback !== null || sessionBubbles.length > 0 || statusBubble !== undefined || usageAnnouncement !== undefined
  const displayName = snapshot?.name ?? definition.displayName
  // The host-served status decoration (M5, #567); absent = text-only bubbles.
  const decoration = snapshot?.decoration

  // A settled session list can no longer stay pinned open.
  useEffect(() => {
    if (sessionBubbles.length <= 1) setStackPinned(false)
  }, [sessionBubbles.length])

  useLayoutEffect(() => {
    if (!hovered) {
      setPanelAbove(false)
      setPanelLift(0)
      return
    }
    const updatePanelPlacement = (): void => {
      const sprite = spriteRef.current
      const panel = panelRef.current
      if (sprite === null || panel === null) return
      const availableBelow = window.innerHeight - sprite.getBoundingClientRect().bottom
      const above = availableBelow < panel.getBoundingClientRect().height + 8
      setPanelAbove(above)
      // The fallback above-placement shares the sprite's top edge with the
      // bubble(s); lift the panel by the bubble area's height so the two
      // never overlap (8px base gap + 6px clearance above the top bubble).
      const bubbleHeight = above ? bubbleRef.current?.getBoundingClientRect().height ?? 0 : 0
      setPanelLift(bubbleHeight > 0 ? Math.ceil(bubbleHeight) + 14 : 0)
    }
    updatePanelPlacement()
    window.addEventListener('resize', updatePanelPlacement)
    return () => window.removeEventListener('resize', updatePanelPlacement)
  }, [hovered, renaming, pos.right, pos.bottom, display.size, bubblePresent, sessionBubbles.length, stackOpen, feedback])

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
        className={styles.spriteWrap}
        style={{ width: spriteWidth, height: spriteHeight }}
      >
        <div
          ref={spriteRef}
          className={styles.sprite}
          style={{
            width: spriteWidth,
            height: spriteHeight,
            ...(props.visual === undefined
              ? {
                  backgroundImage: imageReady ? 'url(' + definition.atlasUrl + ')' : undefined,
                  backgroundSize: (cell.width * columns * spriteScale) + 'px ' + (cell.height * (definition.atlasRows ?? rows.length) * spriteScale) + 'px',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: '0 0',
                }
              : {}),
            cursor: dragRef.current === null ? 'grab' : 'grabbing',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            // A pointer sequence that moved (dragged) still fires a trailing
            // click; skip the pet when that happened.
            if (draggedRef.current) return
            if (props.onGameplayTap !== undefined && spriteRef.current !== null) {
              const rect = spriteRef.current.getBoundingClientRect()
              if (rect.width > 0 && rect.height > 0) {
                props.onGameplayTap((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
              }
            }
            props.onPet()
          }}
          role="button"
          aria-label={definition.displayName}
        >
          {props.visual}
        </div>
      </div>
      {props.hud}
      {feedback !== null && (
        <div key={feedback.at} ref={bubbleRef} className={clsx(styles.bubble, feedback.kind === 'feed' ? styles.bubbleFeed : styles.bubblePet)}>
          {feedback.text}
        </div>
      )}
      {feedback === null && (sessionBubbles.length > 0 || statusBubble !== undefined || usageAnnouncement !== undefined) && (
        <div
          ref={bubbleRef}
          className={styles.bubbleStack}
          onPointerEnter={() => setStackPeek(true)}
          onPointerLeave={() => setStackPeek(false)}
        >
          {visibleSessions.map((session, index) => {
            // A session's whisper rides ITS OWN bubble (the stack lead when
            // the current session has one, any bubble when the stack is
            // expanded). The key swap restarts the entrance animation so the
            // mood change reads as the bubble re-speaking.
            const speaksWhisper = session.whisper !== undefined
            const bubble = (
              <button
                key={speaksWhisper ? 'whisper:' + session.whisper : session.sessionId}
                type="button"
                className={clsx(
                  styles.bubble,
                  styles.bubbleStatus,
                  styles.bubbleClickable,
                  speaksWhisper && styles.bubbleWhisper,
                )}
                title={props.t('pet.openSessionHint')}
                onClick={() => { props.onOpenSession(session.sessionId) }}
              >
                {index === 0 && !speaksWhisper && decoration !== undefined && (
                  <StatusOrnament decoration={decoration} phase={phase} />
                )}
                {session.whisper ?? session.bubble}
              </button>
            )
            // The primary bubble carries the '+N' badge while other sessions
            // hide behind it; the badge toggles the pinned (touch) expansion.
            if (index !== 0 || sessionBubbles.length <= 1) return bubble
            return (
              <span key="primary" className={styles.bubbleAnchor}>
                {bubble}
                <button
                  type="button"
                  className={styles.bubbleMore}
                  title={stackOpen
                    ? props.t('pet.collapseSessions')
                    : props.t('pet.moreSessions', { n: sessionBubbles.length - 1 })}
                  aria-label={stackOpen
                    ? props.t('pet.collapseSessions')
                    : props.t('pet.moreSessions', { n: sessionBubbles.length - 1 })}
                  aria-expanded={stackOpen}
                  onClick={(e) => {
                    e.stopPropagation()
                    setStackPinned(open => !open)
                  }}
                >
                  {stackOpen ? '×' : '+' + String(sessionBubbles.length - 1)}
                </button>
              </span>
            )
          })}
          {sessionBubbles.length === 0 && statusBubble !== undefined && (
            <div
              key="status"
              className={clsx(styles.bubble, styles.bubbleStatus)}
              role="status"
              aria-live="polite"
            >
              {decoration !== undefined && (
                <StatusOrnament decoration={decoration} phase={phase} />
              )}
              {statusBubble}
            </div>
          )}
          {usageAnnouncement !== undefined && <UsageAnnouncementBubble announcement={usageAnnouncement} />}
        </div>
      )}
      {hovered && dragRef.current === null && (
        <div
          ref={panelRef}
          className={clsx(styles.panel, panelAbove && styles.panelAbove)}
          data-placement={panelAbove ? 'above' : 'below'}
          style={panelAbove && panelLift > 0
            ? ({ marginBottom: panelLift } as CSSProperties)
            : undefined}
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
                {panelLabel('confirm', props.t('pet.confirm'))}
              </button>
            </div>
          ) : (
            <>
              <div className={styles.rankRow}>
                <span className={styles.nameCell}>{displayName}</span>
                <span className={styles.statRank}>
                  {(() => {
                    const rawRank = snapshot?.affinity.rank ?? '?'
                    const rankKey = `pet.rank.name.${rawRank}`
                    const localized = props.t(rankKey as any)
                    const rankName = localized !== rankKey ? localized : rawRank
                    return panelStat('rank', 'pet.rank', { rank: rankName })
                  })()}
                </span>
              </div>
              <div className={styles.rankRow}>
                <span className={styles.statTreats}>{panelStat('treats', 'pet.treats', { n: snapshot?.treats.stocked ?? 0 })}</span>
                <span className={styles.statPoints}>{panelStat('points', 'pet.points', { points: snapshot?.affinity.points ?? 0 })}</span>
              </div>
              <div className={styles.actions}>
                {panelShows('feed') && (
                  <button type="button" className={styles.action} onClick={props.onFeed}>
                    {panelLabel('feed', props.t('pet.feed'))}
                  </button>
                )}
                {panelShows('rename') && (
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
                    {panelLabel('rename', props.t('pet.rename'))}
                  </button>
                )}
                {panelShows('hide') && (
                  <button type="button" className={styles.action} onClick={props.onHide}>
                    {panelLabel('hide', props.t('pet.hide'))}
                  </button>
                )}
                {props.onGameplayMenu !== undefined && (
                  <button type="button" className={styles.action} onClick={props.onGameplayMenu}>
                    {props.t('pet.gameplay.menu')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )

  return createPortal(float, props.portalTarget ?? document.body)
}
