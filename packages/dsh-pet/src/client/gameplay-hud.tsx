/**
 * Gameplay HUD — the client half of the manifest 'gameplay' block (miku-pet
 * generalization). One component owns everything the block needs: the stat
 * bars and shop card (menu / shop pages), the touch-zone tap
 * handling, the idle director rolls, the work and sleep loops, and the
 * float-text toasts. It talks to the host through the injected verb API,
 * writes results straight back into the store (the 2 s poll stays the
 * backstop), and steers the frames2d renderer through the per-pet bus.
 * @module @linxin666/dsh-pet/client/GameplayHud
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PetDefinition, PetSkinDefinition } from '../registry.ts'
import type { PetGameplayVerbResult } from '../service.ts'
import { declaredModes, modeStateOf, PET_ROAM_DIRECTIONS, touchZoneAt, type PetRoamDirection } from '../gameplay.ts'
import type { PetStoreInstance } from './pet-store.ts'
import type { DragStream } from './drag-stream.ts'
import type { NS } from './locales.ts'
import styles from './pet.module.css'

/** The gameplay verb API the plugin apply body injects (host-authoritative). */
export interface GameplayApi {
  touch: (zone?: string) => Promise<PetGameplayVerbResult>
  setMode: (mode: string | null) => Promise<PetGameplayVerbResult>
  workTick: () => Promise<PetGameplayVerbResult>
  buy: (item: string) => Promise<PetGameplayVerbResult>
  /**
   * Persist the selected skin for the current pet (host-authoritative;
   * `undefined` restores the pet's default look).
   */
  setSkin: (skin: string | undefined) => Promise<{ ok: boolean; error?: string }>
}

/**
 * The per-pet coordination bus. The frames2d visual mount registers the
 * track override (setTrack); the HUD registers the sprite tap handler; the
 * chrome calls into whatever is registered. Optional chaining everywhere —
 * either side may be mid-remount during a hot reload.
 */
export interface GameplayBus {
  setTrack?: (track?: string) => void
  /** Swap the pet's base idle track (skin switch); undefined restores default. */
  setIdleTrack?: (track?: string) => void
  /**
   * The base idle track the HUD wants right now, latched on the bus so a
   * renderer that registers late (or remounts: hidden/summoned, StrictMode's
   * double mount) still applies the restored skin instead of snapping back to
   * the default look. Mutating it never requires a re-render.
   */
  idleTrack?: string
  tap?: (fx: number, fy: number) => void
  /**
   * Card open/close request from the chrome (the hover panel's 玩法 action):
   * the HUD registers this, and calling it with no argument toggles the card
   * while a boolean pins the state (same chrome -> HUD direction as tap).
   */
  openCard?: (open?: boolean) => void
  /**
   * Walk the sprite in `direction` by `distance` px at `speed` px/s, clamped
   * to the viewport, and persist the resting spot like a drag. Returns the
   * distance actually travelled (0 when it cannot move), so the caller can
   * hold the walk art for exactly that long. Registered by the chrome
   * (PetSprite); absent while the sprite is unmounted.
   */
  walk?: (direction: PetRoamDirection, distance: number, speed: number) => number
}

type HudPage = 'root' | 'shop' | 'skins'

/** One floating toast (prize / insufficient funds). */
interface HudFloat {
  id: number
  text: string
}

let floatSeq = 0

/** The gameplay overlay for one frames2d pet that declares 'gameplay'. */
export function GameplayHud(props: {
  definition: PetDefinition
  store: PetStoreInstance
  api: GameplayApi
  bus: GameplayBus
  drag: DragStream
  t: PropsLocale<typeof NS>['t']
}): ReactElement | null {
  const { definition, store, api, bus } = props
  const ui = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const def = definition.gameplay
  const view = ui.snapshot?.gameplay
  // Host-persisted skin selection for this pet (undefined = default look).
  const persistedSkin = ui.snapshot?.skin

  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<HudPage>('root')
  // Currently selected skin id (base idle swap); undefined = default look.
  const [skinId, setSkinId] = useState<string | undefined>(undefined)
  const skinIdRef = useRef<string | undefined>(undefined)
  skinIdRef.current = skinId
  const hudRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [floats, setFloats] = useState<HudFloat[]>([])
  // Mutable driver state (refs so intervals never re-arm on a poll tick).
  const modeRef = useRef<string | null>(view?.mode ?? null)
  modeRef.current = view?.mode ?? null
  /** Live gameplay view for the interval loops (def identity is stable, view is not). */
  const viewRef = useRef(view)
  viewRef.current = view
  const draggingRef = useRef(false)
  const touchLockUntilRef = useRef(0)
  const missRef = useRef(0)
  const busyRef = useRef(false)
  /** A roam walk owns the visual right now (the idle director must not steal it). */
  const roamHeldRef = useRef(false)
  /** A one-shot idle-director act owns the visual right now (the roam must not cut in). */
  const actHeldRef = useRef(false)
  /** Pending release of the roam's walk track (cleared when another owner takes it). */
  const roamTimerRef = useRef(0)

  // Dynamic-key lookups (stat ids / currency ids are manifest data).
  const tr = props.t as unknown as (key: string, values?: Record<string, string | number>) => string
  const statLabel = (name: string): string => tr('pet.gameplay.stat.' + name)
  const currencyLabel = (name: string): string => tr('pet.gameplay.currency.' + name)

  const pushFloat = (text: string): void => {
    const id = ++floatSeq
    setFloats(list => [...list.slice(-3), { id, text }])
    window.setTimeout(() => {
      setFloats(list => list.filter(entry => entry.id !== id))
    }, 1100)
  }

  const applyResult = (result: PetGameplayVerbResult): void => {
    if (result.view !== undefined) store.actions.setGameplayView(result.view)
  }

  /**
   * Give up the roam's claim on the shared track-override slot. Every other
   * owner (a mode, a touch reaction, a drag) calls this before it takes the
   * slot, so a walk that is still in flight can never release someone else's
   * track when its own hold window elapses.
   */
  const yieldRoam = (): void => {
    if (roamTimerRef.current !== 0) {
      window.clearTimeout(roamTimerRef.current)
      roamTimerRef.current = 0
    }
    roamHeldRef.current = false
  }

  // Tap handling (registered on the bus; PetSprite reports sprite-box
  // fractions). Sleep wakes on tap; work blocks taps; a held touch
  // animation turns taps into the plain-click boost.
  // Skin contract: while a skin is selected, taps only ever play that
  // skin's own click actions — a miss resolves to the plain click boost,
  // never the default touch zones (so a skinned pet cannot trigger the
  // default pet's shy/work reactions).
  useEffect(() => {
    if (def === undefined) return undefined
    // Play a one-shot override track and lock tap input for its duration so
    // consecutive taps cannot retrigger mid-play (skin click actions and
    // default touch-zone reactions share this path).
    const holdTrack = (track: string, holdMs: number): void => {
      yieldRoam()
      bus.setTrack?.(track)
      touchLockUntilRef.current = Date.now() + holdMs
      window.setTimeout(() => {
        if (Date.now() >= touchLockUntilRef.current) bus.setTrack?.(undefined)
      }, holdMs)
    }
    const speak = (phrases?: string[]): void => {
      if (phrases !== undefined && phrases.length > 0) {
        const phrase = phrases[Math.floor(Math.random() * phrases.length)]!
        store.actions.setFeedback({ text: phrase, kind: 'none', at: Date.now() })
      }
    }
    // Total play time of a track in ms (its fallback lands back in the skin
    // base idle, so holding the lock for the full loop is unnecessary).
    const trackDuration = (track: string): number =>
      definition.frames2d?.tracks[track]?.durations.reduce((sum, ms) => sum + ms, 0) ?? 0
    bus.tap = (fx, fy) => {
      // Any non-work mode ends on a tap (sleep wakes up, a bath steps out);
      // work keeps swallowing taps while its round is running.
      if (modeRef.current !== null && modeRef.current !== 'work') {
        void api.setMode(null).then(applyResult, () => undefined)
        return
      }
      if (modeRef.current === 'work') return
      const box = def.hitBox ?? { x0: 0, y0: 0, x1: 1, y1: 1 }
      const hx = (fx - box.x0) / (box.x1 - box.x0)
      const hy = (fy - box.y0) / (box.y1 - box.y0)
      if (hx < 0 || hx > 1 || hy < 0 || hy > 1) return
      if (Date.now() < touchLockUntilRef.current) {
        void api.touch().then(applyResult, () => undefined)
        return
      }
      const activeSkin = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)
      if (activeSkin !== undefined) {
        // Skin click actions roll first (declared order, cumulative
        // probabilities); on a hit play the action's track once. A miss
        // stays on the plain click boost — never the default touch zones.
        const actions = activeSkin.clickActions ?? []
        if (actions.length > 0) {
          let roll = Math.random()
          const fired = actions.find(action => {
            if (roll < action.probability) return true
            roll -= action.probability
            return false
          })
          if (fired !== undefined) {
            holdTrack(fired.track, trackDuration(fired.track) || 3000)
            speak(fired.phrases)
            return
          }
        }
        void api.touch().then(applyResult, () => undefined)
        return
      }
      const zone = def.touch === undefined ? undefined : touchZoneAt(def.touch, hy)
      if (zone === undefined) return
      void api.touch(zone.name).then((result) => {
        applyResult(result)
        if (result.hit !== true) return
        if (result.state !== undefined) holdTrack(result.state, result.stateMs ?? 3000)
        if (result.phrase !== undefined) {
          store.actions.setFeedback({ text: result.phrase, kind: 'none', at: Date.now() })
        }
      }, () => undefined)
    }
    return () => { bus.tap = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per pet definition
  }, [definition.id, def])

  // Panel entry (chrome -> HUD): the hover panel's 玩法 button drives the
  // card through this channel so the chrome never needs the card's state.
  useEffect(() => {
    bus.openCard = (next?: boolean) => {
      setOpen(prev => next ?? !prev)
      setPage('root')
    }
    return () => { bus.openCard = undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one registration per bus
  }, [bus])

  // Card placement: the card must not enter the bubble band above the sprite
  // or the hover-panel band below it, so it opens beside the sprite instead
  // of growing upward from the pet's feet. It is vertically centered on the
  // sprite box, clamped to the sprite's height, and the side is chosen by
  // the space available to each side (right first; a pet parked near the
  // right viewport edge flips the card to the left).
  useLayoutEffect(() => {
    if (!open) return undefined
    const hud = hudRef.current
    const card = cardRef.current
    if (hud === null || card === null) return undefined
    const place = (): void => {
      const box = hud.parentElement?.getBoundingClientRect()
      if (box === undefined) return
      const gap = 8
      const width = card.getBoundingClientRect().width
      const toRight = window.innerWidth - box.right
      const x = toRight >= width + gap ? box.width + gap : -(width + gap)
      card.style.transform = 'translate(' + Math.round(x) + 'px, ' + Math.round(-box.height / 2) + 'px) translateY(50%)'
      card.style.maxHeight = Math.round(box.height) + 'px'
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one placement per open/page change
  }, [open, page])

  // Drag gestures end any non-work mode (sleep wakes, a bath steps out); the
  // drag stream also feeds the idle director's suppression check.
  useEffect(() => {
    return props.drag.subscribe((dragging) => {
      draggingRef.current = dragging
      if (dragging) yieldRoam()
      if (dragging && modeRef.current !== null && modeRef.current !== 'work') {
        void api.setMode(null).then(applyResult, () => undefined)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per drag stream
  }, [props.drag])

  // Idle director: weighted rolls between staying idle and playing an act.
  // Rolls in every phase -- an ambient act is not a waiting-room performance,
  // and the idle phase only appears when neither the agent nor the user is busy
  // -- but only while nothing else owns the visual: no mode, no drag, no held
  // touch animation, no roam walk and no act already playing. maxMiss forces an
  // act after too many idle rolls in a row.
  useEffect(() => {
    const director = def?.idleDirector
    if (def === undefined || director === undefined) return undefined
    const total = director.idleWeight + director.acts.reduce((sum, act) => sum + act.weight, 0)
    if (total <= 0) return undefined
    let actTimer = 0
    const timer = window.setInterval(() => {
      if (modeRef.current !== null || draggingRef.current) return
      if (Date.now() < touchLockUntilRef.current) return
      if (roamHeldRef.current) return // a roam walk owns the visual
      if (actHeldRef.current) return // the previous act is still playing
      let pickedAct: { track: string; weight: number; phrases?: string[] } | undefined
      if (missRef.current >= director.maxMiss) {
        // Forced act: pick among the acts only.
        const actTotal = director.acts.reduce((sum, act) => sum + act.weight, 0)
        let actRoll = Math.random() * actTotal
        for (const act of director.acts) {
          actRoll -= act.weight
          if (actRoll < 0) { pickedAct = act; break }
        }
      } else {
        let roll = Math.random() * total
        for (const act of director.acts) {
          roll -= act.weight
          if (roll < 0) { pickedAct = act; break }
        }
      }
      if (pickedAct === undefined) {
        missRef.current += 1
        return
      }
      missRef.current = 0
      actHeldRef.current = true
      bus.setTrack?.(pickedAct.track)
      // A one-shot act owns the visual until its own duration elapses (the
      // renderer then falls back to the phase map); the roam must not cut in.
      const holdMs = definition.frames2d?.tracks[pickedAct.track]?.durations.reduce((sum, ms) => sum + ms, 0) ?? 0
      window.clearTimeout(actTimer)
      actTimer = window.setTimeout(() => { actHeldRef.current = false }, holdMs > 0 ? holdMs : 3000)
      // Acts with a phrase pool speak one line while they play (miku parity).
      if (pickedAct.phrases !== undefined && pickedAct.phrases.length > 0) {
        const phrase = pickedAct.phrases[Math.floor(Math.random() * pickedAct.phrases.length)]!
        store.actions.setFeedback({ text: phrase, kind: 'none', at: Date.now() })
      }
    }, director.intervalMs)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(actTimer)
      actHeldRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one director per pet definition
  }, [definition.id, def])

  // Work loop: hold the work track, adjudicate one round per tick, play the
  // result track for its hold window, then resume. Leaving the mode
  // releases the override so the phase mapping takes over. A skin that
  // declares gameplayTracks for the work states plays its own art instead.
  useEffect(() => {
    const work = def?.work
    if (def === undefined || work === undefined || view?.mode !== 'work') return undefined
    const skinGameplay = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)?.gameplayTracks
    /** The state's track, swapped for the skin's override when it declares one. */
    const trackOf = (state: string): string => skinGameplay?.[state] ?? state
    bus.setTrack?.(trackOf(work.state))
    let resultTimer = 0
    const timer = window.setInterval(() => {
      if (busyRef.current) return
      busyRef.current = true
      void api.workTick().then((result) => {
        busyRef.current = false
        // Leaving work mode while the adjudication is in flight drops the late
        // result: writing it back would show work rewards and play the result
        // track for a mode the user has already left (#1495).
        if (modeRef.current !== 'work') return
        applyResult(result)
        if (result.ok !== true || result.outcome === undefined) return
        const resultTrack = trackOf(result.outcome === 'success' ? work.successState : work.failState)
        const hold = result.outcome === 'success' ? work.resultMs?.success ?? 1300 : work.resultMs?.fail ?? 1900
        bus.setTrack?.(resultTrack)
        resultTimer = window.setTimeout(() => {
          if (modeRef.current === 'work') bus.setTrack?.(trackOf(work.state))
        }, hold)
      }, () => { busyRef.current = false })
    }, work.tickMs)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(resultTimer)
      bus.setTrack?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode and the selected skin
  }, [definition.id, def, view?.mode, skinId])

  // Mode loop: hold the active non-work mode's track (sleep, a bath, any
  // extra 'modes' entry). The stat restore is host-side (lazy settle). While a
  // skin with a matching gameplayTracks override is selected, the skin's own
  // track replaces the default one (e.g. a skin-specific doze).
  useEffect(() => {
    const active = view?.mode
    if (def === undefined || active === undefined || active === null || active === 'work') return undefined
    const hold = modeStateOf(def, active)
    if (hold === undefined) return undefined
    const skinGameplay = definition.frames2d?.skins?.find(skin => skin.id === skinIdRef.current)?.gameplayTracks
    yieldRoam()
    bus.setTrack?.(skinGameplay?.[active] ?? hold)
    return () => bus.setTrack?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode value
  }, [definition.id, def, view?.mode, skinId])

  // Random roaming (manifest 'roam'): on a slow interval -- in any phase, as long
  // as no mode, drag, touch animation or director act owns the pet -- roll a
  // wander. The chrome walks the sprite and persists the new spot; this side
  // holds the walk track for exactly the travel time.
  useEffect(() => {
    const roam = def?.roam
    if (def === undefined || roam === undefined) return undefined
    const roll = (): void => {
      // Every phase: a wandering pet is ambient, not a performance, so she
      // keeps walking while the agent works (the idle director's acts stay
      // idle-only). A mode, a drag, a touch animation and a director
      // act all still own the pet and suppress the roll.
      if (modeRef.current !== null || draggingRef.current) return
      if (Date.now() < touchLockUntilRef.current) return
      if (roamHeldRef.current || actHeldRef.current) return
      if (Math.random() >= roam.probability) return
      const span = roam.distanceMax - roam.distanceMin
      const distance = roam.distanceMin + Math.random() * span
      const directions = roam.directions ?? PET_ROAM_DIRECTIONS
      const direction = directions[Math.floor(Math.random() * directions.length)] ?? 'left'
      const travelled = bus.walk?.(direction, distance, roam.speed) ?? 0
      if (travelled === 0) return
      roamHeldRef.current = true
      bus.setTrack?.(roam.state)
      roamTimerRef.current = window.setTimeout(() => {
        roamTimerRef.current = 0
        if (!roamHeldRef.current) return // another owner already took the slot
        roamHeldRef.current = false
        bus.setTrack?.(undefined)
      }, Math.max(150, (Math.abs(travelled) / roam.speed) * 1000))
    }
    // The two decision timers must never share a tick. The roam starts half an
    // interval late, so its ticks interleave with the idle director's instead
    // of landing on the same instant (10 s and 15 s coincide every 30 s).
    let timer = 0
    const lead = window.setTimeout(() => {
      roll()
      timer = window.setInterval(roll, roam.intervalMs)
    }, Math.round(roam.intervalMs / 2))
    return () => {
      window.clearTimeout(lead)
      window.clearInterval(timer)
      yieldRoam()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one director per pet definition
  }, [definition.id, def])

  if (def === undefined || view === undefined) return null

  const mode = view.mode
  const stats = def.stats ?? {}
  const shop = def.shop

  // Every menu mode beyond work: sleep plus any extra 'modes' the pet declares.
  const menuModes = declaredModes(def)

  /** Action-button label for one mode (active = the button that leaves it). */
  const modeLabel = (name: string, active: boolean): string => {
    if (name === 'sleep') return tr(active ? 'pet.gameplay.wake' : 'pet.gameplay.sleep')
    const declared = def.modes?.[name]
    return (active ? declared?.activeLabel ?? declared?.label : declared?.label) ?? tr('pet.gameplay.' + name)
  }

  /** Chip label for the mode the pet is in right now. */
  const modeChip = (name: string): string => {
    if (name === 'work') return tr('pet.gameplay.working')
    if (name === 'sleep') return tr('pet.gameplay.sleeping')
    const declared = def.modes?.[name]
    return declared?.activeLabel ?? declared?.label ?? tr('pet.gameplay.' + name)
  }

  const buy = (itemId: string): void => {
    void api.buy(itemId).then((result) => {
      applyResult(result)
      if (result.ok !== true) {
        if (result.error === 'insufficient-funds') {
          const item = shop?.items.find(entry => entry.id === itemId)
          pushFloat(tr('pet.gameplay.insufficient', { currency: currencyLabel(item?.currency ?? 'treats') }))
        }
        return
      }
      if (result.prize !== undefined) {
        pushFloat(tr('pet.gameplay.prize', { amount: result.prize.amount, currency: currencyLabel(result.prize.currency) }))
      }
    }, () => undefined)
  }

  const setMode = (next: string | null): void => {
    void api.setMode(next).then(applyResult, () => undefined)
  }

  // Skin selection is persisted host-side (per pet): re-seed the menu from
  // every fresh state view, so a page reload or client restart keeps the last
  // choice instead of snapping back to the default look.
  useEffect(() => {
    setSkinId(persistedSkin)
  }, [definition.id, persistedSkin])

  // Push the resolved base idle track into the renderer whenever the pet or
  // the selection changes. The value is latched on the bus first: the visual
  // may register later, or remount later (hidden/summoned), and reads the
  // latch back on activation so a restored skin never falls back to default.
  useEffect(() => {
    const skin = definition.frames2d?.skins?.find(candidate => candidate.id === skinId)
    bus.idleTrack = skin?.idleTrack
    bus.setIdleTrack?.(skin?.idleTrack)
    // persistedSkin rides the deps so the host's value also re-pushes on
    // arrival (a renderer that mounted early still converges).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one push per selection
  }, [definition.id, skinId, persistedSkin])

  const skins = definition.frames2d?.skins
  /** The base idle track one skin id resolves to (undefined = default look). */
  const skinTrackOf = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : definition.frames2d?.skins?.find(candidate => candidate.id === id)?.idleTrack

  const selectSkin = (skin: PetSkinDefinition | undefined): void => {
    setSkinId(skin?.id)
    bus.setIdleTrack?.(skin?.idleTrack)
    // The host owns the choice: a refusal (unknown skin) restores both the
    // menu highlight and the renderer to the value it still serves.
    const restore = (): void => {
      setSkinId(persistedSkin)
      bus.setIdleTrack?.(skinTrackOf(persistedSkin))
    }
    void api.setSkin(skin?.id).then((result) => {
      if (result.ok) return
      restore()
    }, restore)
  }

  return (
    <div ref={hudRef} className={styles.gameplayHud} data-dsh-pet-gameplay={definition.id}>
      {floats.map(entry => (
        <div key={entry.id} className={styles.gameplayFloat}>{entry.text}</div>
      ))}
      {mode !== null && (
        <div className={styles.gameplayModeChip}>
          {modeChip(mode)}
        </div>
      )}
      {open && (
        <div ref={cardRef} className={styles.gameplayCard} data-page={page}>
          {page === 'root' && (
            <>
              <div className={styles.gameplayBars}>
                {Object.entries(stats).map(([name, stat]) => {
                  const value = view.stats[name] ?? 0
                  return (
                    <div key={name} className={styles.gameplayBarRow} title={statLabel(name) + ' ' + String(value) + '/' + String(stat.max)}>
                      <span className={styles.gameplayBarLabel}>{statLabel(name)}</span>
                      <span className={styles.gameplayBarTrack}>
                        <span
                          className={styles.gameplayBarFill}
                          style={{ width: Math.round((value / stat.max) * 100) + '%' }}
                        />
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className={styles.gameplayActions}>
                {menuModes.map(name => (
                  <button
                    key={name}
                    type="button"
                    className={styles.action}
                    onClick={() => setMode(mode === name ? null : name)}
                  >
                    {modeLabel(name, mode === name)}
                  </button>
                ))}
                {shop !== undefined && (
                  <button type="button" className={styles.action} onClick={() => setPage('shop')}>
                    {tr('pet.gameplay.shop')}
                  </button>
                )}
                {skins !== undefined && skins.length > 0 && (
                  <button type="button" className={styles.action} onClick={() => setPage('skins')}>
                    {tr('pet.gameplay.skin')}
                  </button>
                )}
                {def.work !== undefined && (
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setMode(mode === 'work' ? null : 'work')}
                  >
                    {tr(mode === 'work' ? 'pet.gameplay.stopWork' : 'pet.gameplay.work')}
                  </button>
                )}
              </div>
            </>
          )}
          {page === 'shop' && shop !== undefined && (
            <>
              <div className={styles.gameplayShopItems}>
                {shop.items.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.gameplayShopItem}
                    onClick={() => buy(item.id)}
                    title={item.label + ' — ' + String(item.price) + ' ' + currencyLabel(item.currency)}
                  >
                    {item.image !== undefined && (
                      <img className={styles.gameplayShopItemImage} src={item.image} alt="" draggable={false} />
                    )}
                    <span className={styles.gameplayShopItemLabel}>{item.label}</span>
                    <span className={styles.gameplayShopItemPrice}>
                      {item.price} {currencyLabel(item.currency)}
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.gameplayActions}>
                <button type="button" className={styles.action} onClick={() => setPage('root')}>
                  {tr('pet.gameplay.back')}
                </button>
              </div>
            </>
          )}
          {page === 'skins' && skins !== undefined && (
            <>
              <div className={styles.gameplaySkinItems}>
                <button
                  type="button"
                  className={skinId === undefined ? styles.gameplaySkinItem + ' ' + styles.gameplaySkinItemActive : styles.gameplaySkinItem}
                  onClick={() => selectSkin(undefined)}
                >
                  {tr('pet.gameplay.skinDefault')}
                </button>
                {skins.map(skin => (
                  <button
                    key={skin.id}
                    type="button"
                    className={skinId === skin.id ? styles.gameplaySkinItem + ' ' + styles.gameplaySkinItemActive : styles.gameplaySkinItem}
                    onClick={() => selectSkin(skin)}
                  >
                    {skin.label}
                  </button>
                ))}
              </div>
              <div className={styles.gameplayActions}>
                <button type="button" className={styles.action} onClick={() => setPage('root')}>
                  {tr('pet.gameplay.back')}
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className={styles.gameplayClose}
            aria-label={tr('pet.gameplay.back')}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
