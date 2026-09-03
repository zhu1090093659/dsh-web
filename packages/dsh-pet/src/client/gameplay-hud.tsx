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
import { touchZoneAt } from '../gameplay.ts'
import type { PetStoreInstance } from './pet-store.ts'
import type { DragStream } from './drag-stream.ts'
import type { NS } from './locales.ts'
import styles from './pet.module.css'

/** The gameplay verb API the plugin apply body injects (host-authoritative). */
export interface GameplayApi {
  touch: (zone?: string) => Promise<PetGameplayVerbResult>
  setMode: (mode: 'work' | 'sleep' | null) => Promise<PetGameplayVerbResult>
  workTick: () => Promise<PetGameplayVerbResult>
  buy: (item: string) => Promise<PetGameplayVerbResult>
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
  tap?: (fx: number, fy: number) => void
  /**
   * Card open/close request from the chrome (the hover panel's 玩法 action):
   * the HUD registers this, and calling it with no argument toggles the card
   * while a boolean pins the state (same chrome -> HUD direction as tap).
   */
  openCard?: (open?: boolean) => void
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
  const phase = ui.snapshot?.phase ?? 'idle'

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
  const modeRef = useRef<'work' | 'sleep' | null>(view?.mode ?? null)
  modeRef.current = view?.mode ?? null
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const draggingRef = useRef(false)
  const touchLockUntilRef = useRef(0)
  const missRef = useRef(0)
  const busyRef = useRef(false)
  const lowHeldRef = useRef(false)

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
      if (modeRef.current === 'sleep') {
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

  // Drag gestures wake a sleeping pet (miku behavior); the drag stream also
  // feeds the idle director's suppression check.
  useEffect(() => {
    return props.drag.subscribe((dragging) => {
      draggingRef.current = dragging
      if (dragging && modeRef.current === 'sleep') {
        void api.setMode(null).then(applyResult, () => undefined)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one subscription per drag stream
  }, [props.drag])

  // Idle director: weighted rolls between staying idle and playing an act.
  // Runs only while the phase mapping owns the visual (idle phase, no mode,
  // no drag, no held touch animation); maxMiss forces an act after too many
  // idle rolls in a row.
  useEffect(() => {
    const director = def?.idleDirector
    if (def === undefined || director === undefined) return undefined
    const total = director.idleWeight + director.acts.reduce((sum, act) => sum + act.weight, 0)
    if (total <= 0) return undefined
    const timer = window.setInterval(() => {
      if (phaseRef.current !== 'idle') return
      if (modeRef.current !== null || draggingRef.current) return
      if (Date.now() < touchLockUntilRef.current) return
      if (lowHeldRef.current) return // low-energy drowsy owns the visual
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
      bus.setTrack?.(pickedAct.track)
      // Acts with a phrase pool speak one line while they play (miku parity).
      if (pickedAct.phrases !== undefined && pickedAct.phrases.length > 0) {
        const phrase = pickedAct.phrases[Math.floor(Math.random() * pickedAct.phrases.length)]!
        store.actions.setFeedback({ text: phrase, kind: 'none', at: Date.now() })
      }
    }, director.intervalMs)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one director per pet definition
  }, [definition.id, def])

  // Work loop: hold the work track, adjudicate one round per tick, play the
  // result track for its hold window, then resume. Leaving the mode
  // releases the override so the phase mapping takes over.
  useEffect(() => {
    const work = def?.work
    if (def === undefined || work === undefined || view?.mode !== 'work') return undefined
    bus.setTrack?.(work.state)
    let resultTimer = 0
    const timer = window.setInterval(() => {
      if (busyRef.current) return
      busyRef.current = true
      void api.workTick().then((result) => {
        busyRef.current = false
        applyResult(result)
        if (result.ok !== true || result.outcome === undefined) return
        const resultTrack = result.outcome === 'success' ? work.successState : work.failState
        const hold = result.outcome === 'success' ? work.resultMs?.success ?? 1300 : work.resultMs?.fail ?? 1900
        bus.setTrack?.(resultTrack)
        resultTimer = window.setTimeout(() => {
          if (modeRef.current === 'work') bus.setTrack?.(work.state)
        }, hold)
      }, () => { busyRef.current = false })
    }, work.tickMs)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(resultTimer)
      bus.setTrack?.(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode value
  }, [definition.id, def, view?.mode])

  // Sleep loop: hold the sleep track; restore is host-side (lazy settle).
  useEffect(() => {
    const sleep = def?.sleep
    if (def === undefined || sleep === undefined || view?.mode !== 'sleep') return undefined
    bus.setTrack?.(sleep.state)
    return () => bus.setTrack?.(undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop keys on the mode value
  }, [definition.id, def, view?.mode])

  // Low-energy auto-animation: while the named stat sits below its threshold
  // (and the pet is neither working/sleeping nor being dragged or touched)
  // maintain the drowsy track; it recovers to the phase map once the stat
  // reaches the recover bound or the pet enters another gameplay mode. Uses
  // an interval (not just a poll delta) so a brief touch/drag override
  // re-asserts rather than leaving the pet stuck on a stale override.
  useEffect(() => {
    const le = def?.lowEnergy
    if (def === undefined || le === undefined) return undefined
    const timer = window.setInterval(() => {
      if (view?.mode !== null) return // work/sleep loops own the override
      if (draggingRef.current) return // drag track owns it while dragging
      if (Date.now() < touchLockUntilRef.current) return // let a touch animation finish
      const value = view?.stats?.[le.stat] ?? le.recover
      const shouldHold = value < le.threshold
      if (shouldHold) {
        lowHeldRef.current = true
        bus.setTrack?.(le.track)
      } else if (lowHeldRef.current) {
        lowHeldRef.current = false
        bus.setTrack?.(undefined)
      }
    }, 1000)
    return () => {
      window.clearInterval(timer)
      if (lowHeldRef.current) {
        lowHeldRef.current = false
        bus.setTrack?.(undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one loop per pet definition
  }, [definition.id, def])

  if (def === undefined || view === undefined) return null

  const mode = view.mode
  const stats = def.stats ?? {}
  const shop = def.shop

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

  const setMode = (next: 'work' | 'sleep' | null): void => {
    void api.setMode(next).then(applyResult, () => undefined)
  }

  const skins = definition.frames2d?.skins
  const selectSkin = (skin: PetSkinDefinition | undefined): void => {
    setSkinId(skin?.id)
    bus.setIdleTrack?.(skin?.idleTrack)
  }

  return (
    <div ref={hudRef} className={styles.gameplayHud} data-dsh-pet-gameplay={definition.id}>
      {floats.map(entry => (
        <div key={entry.id} className={styles.gameplayFloat}>{entry.text}</div>
      ))}
      {mode !== null && (
        <div className={styles.gameplayModeChip}>
          {tr(mode === 'work' ? 'pet.gameplay.working' : 'pet.gameplay.sleeping')}
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
                {def.sleep !== undefined && (
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => setMode(mode === 'sleep' ? null : 'sleep')}
                  >
                    {tr(mode === 'sleep' ? 'pet.gameplay.wake' : 'pet.gameplay.sleep')}
                  </button>
                )}
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
