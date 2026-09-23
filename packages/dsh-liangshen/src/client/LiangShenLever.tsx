/**
 * The homepage lever: a slot-machine arm beside the model selector.
 *
 * Pull it down and the session about to start becomes LiangShen mode; push it
 * up and the preset the user was on comes back. The arm tracks the real preset
 * (never a local guess), and the theatrical part — flash, shockwave, sparks,
 * and the three-language jackpot banner — plays only once the switch actually
 * landed, so a refused switch never celebrates.
 *
 * The component is pure: every fact and verb arrives through the injected face.
 * A pointer drag past {@link DRAG_THRESHOLD_PX} counts as a pull or a push; a
 * plain click or a keyboard activation toggles instead.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { LeverFace } from './lever-controller.ts'
import css from './LiangShenLever.module.css'

/** Vertical travel that separates a pull or push from a plain click. */
const DRAG_THRESHOLD_PX = 14

/** How long the burst overlay stays mounted, matching its CSS duration. */
const BURST_MS = 2200

/** Jackpot lines that read the same in every language. */
const BINARY = '01001100 01001001 01000001 01001110 01000111'
const MORSE = '-.. . . .--. ... . . -.- / .... .- .-. -. . ... ...'

/** One spark per spoke of the burst. */
const SPARKS = Array.from({ length: 14 }, (_, index) => index)

/** Sync the hero preset chip above the composer so both controls always agree. */
function syncHeroChip(label: string): void {
  try {
    if (typeof document === 'undefined') return
    const chip = document.querySelector<HTMLElement>('button[aria-haspopup="menu"] span[class*="seatLabel"]')
      ?? Array.from(document.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"] span')).find(s => s.className.includes('seatLabel'))
    if (chip && chip.textContent !== label) {
      chip.textContent = label
    }
  } catch {
    // Non-browser or detached element
  }
}

/** Slot entry for `conversation.input.right` (left of the model selector). */
export function LiangShenLever(face: LeverFace): ReactElement | null {
  const snapshot = useSyncExternalStore(face.store.subscribe, face.store.getSnapshot)
  const { state, restoreLabel, busy, error, burst } = snapshot
  const [burstKey, setBurstKey] = useState(0)
  const seen = useRef(burst)
  const drag = useRef<{ x: number, y: number, fired: boolean } | undefined>(undefined)
  const actionable = !busy && (state === 'on' || state === 'off')
  const on = state === 'on'
  const errorText = error === undefined
    ? undefined
    : error.kind === 'locked'
      ? face.t('lever.failed.locked')
      : error.kind === 'missing'
        ? face.t('lever.failed.missing')
        : error.kind === 'timeout'
          ? face.t('lever.failed.timeout')
          : face.t('lever.failed.failed', { reason: error.reason })

  // The burst is driven by the controller's counter, so a reload or a refresh
  // can never replay it and a refused switch can never start it.
  useEffect(() => {
    if (burst > seen.current) setBurstKey(burst)
    seen.current = burst
  }, [burst])

  useEffect(() => {
    if (burstKey === 0) return
    const timer = setTimeout(() => { setBurstKey(0) }, BURST_MS)
    return () => { clearTimeout(timer) }
  }, [burstKey])

  // Keep the hero preset chip above the composer in sync with the lever's selection
  const prevState = useRef(state)
  useEffect(() => {
    if (state === 'on') {
      syncHeroChip(face.t('lever.name'))
    } else if (prevState.current === 'on' && state === 'off' && restoreLabel !== '') {
      syncHeroChip(restoreLabel)
    }
    prevState.current = state
  }, [state, restoreLabel, face])

  // The lever exists only while the preset can still change, which is the
  // blank-session window: a started session reports `locked`, a deployment
  // without the preset reports `missing`, and both mean the row renders
  // nothing instead of a dead control in the composer of a running session.
  // An `on` lever with an empty restore label has nothing to return to either
  // (the roster supplies no other usable preset), so a push there would be the
  // same dead control: render nothing rather than a switch that eats gestures.
  if (state === 'locked' || state === 'missing' || (state === 'on' && restoreLabel === '')) return null

  const toggle = (): void => {
    if (!actionable) return
    if (on) face.push()
    else face.pull()
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!actionable) return
    drag.current = { x: event.clientX, y: event.clientY, fired: false }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Defensive: some environments throw on pointer capture
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const pending = drag.current
    if (pending === undefined || pending.fired) return
    const travelY = event.clientY - pending.y
    const travelX = event.clientX - pending.x
    if (Math.hypot(travelX, travelY) >= DRAG_THRESHOLD_PX) {
      pending.fired = true
      if (on) face.push()
      else face.pull()
    }
  }

  const onPointerUp = (): void => {
    const pending = drag.current
    drag.current = undefined
    // A drag already fired its verb; a click without travel still toggles.
    if (pending === undefined || pending.fired) return
    toggle()
  }

  return (
    <span
      className={css.lever}
      data-dsh-plugin="liangshen"
      data-dsh-part="lever"
      data-state={state}
      data-busy={busy ? 'true' : undefined}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={face.t('lever.a11y')}
        aria-busy={busy}
        title={hint(face, state, restoreLabel)}
        className={css.control}
        disabled={!actionable}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Keyboard and assistive activation arrives as a detail-less click;
        // pointer activation is already handled on pointerup.
        onClick={(event) => { if (event.detail === 0) toggle() }}
      >
        <span className={css.track} data-dsh-part="lever-track" aria-hidden="true">
          <svg className={css.arm} data-dsh-part="lever-arm" viewBox="0 0 16 26" aria-hidden="true">
            <rect className={css.rod} x="6.5" y="3.5" width="3" height="21" rx="1.5" />
            <circle className={css.knob} cx="8" cy="4" r="3.4" />
          </svg>
        </span>
        <span className={css.readout}>{busy ? face.t('lever.busy') : on ? face.t('lever.state.on') : face.t('lever.state.off')}</span>
      </button>
      {errorText !== undefined && (
        <span className={css.error} role="status" title={errorText}>{errorText}</span>
      )}
      {burstKey !== 0 && <Burst key={burstKey} face={face} />}
    </span>
  )
}

/** The hover hint: what this gesture would do right now. */
function hint(face: LeverFace, state: string, restoreLabel: string): string {
  if (state === 'locked') return face.t('lever.hint.locked')
  if (state === 'missing') return face.t('lever.hint.missing')
  if (state === 'on') return face.t('lever.hint.push', { preset: restoreLabel === '' ? face.t('lever.state.off') : restoreLabel })
  return face.t('lever.hint.pull')
}

/** The jackpot overlay: flash, shockwave rings, sparks, and the banner. */
function Burst({ face }: { face: LeverFace }): ReactElement {
  return (
    <span className={css.burst} data-dsh-part="lever-burst" aria-hidden="true">
      <span className={css.flash} />
      <span className={css.ring} />
      <span className={css.ring} />
      <span className={css.ring} />
      <span className={css.banner} data-dsh-part="lever-banner">
        <span className={css.bannerName}>{face.t('lever.name')}</span>
        <span className={css.line}>{face.t('burst.line1')}</span>
        <span className={css.line}>{face.t('burst.line2')}</span>
        <span className={css.code}>{BINARY}</span>
        <span className={css.code}>{MORSE}</span>
      </span>
      <span className={css.sparks}>
        {SPARKS.map(spoke => (
          // `rotate` is its own property so the keyframes' translate runs along
          // the spoke after the rotation composes with it.
          <i key={spoke} className={css.spark} style={{ rotate: `${spoke * (360 / SPARKS.length)}deg` }} />
        ))}
      </span>
    </span>
  )
}
