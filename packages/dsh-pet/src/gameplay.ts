/**
 * Pet gameplay — the optional manifest 'gameplay' block and its host engine.
 * The block layers an opt-in mini-game over any frames2d pet: decaying stat
 * bars, currencies, a weighted idle director, touch zones, a work loop, a
 * sleep loop, passive income and a shop (issue: miku-pet generalization).
 *
 * Discipline split matches manifest-v2: STRUCTURE is fail-closed (types,
 * ranges, references into stats/tracks); the host engine is pure — every
 * verb takes an explicit clock and rng so tests stay deterministic. Decay,
 * passive income and sleep restore are lazy-settled on read (the treats.ts
 * discipline): the host runs no timers for gameplay.
 * @module @linxin666/dsh-pet/gameplay
 */

/** One gameplay effect: add amount to a declared stat or a currency. */
export interface PetGameplayEffect {
  stat?: string
  currency?: string
  amount: number
}

/** One roll branch inside a touch zone; uncovered roll mass is a no-op. */
export interface PetGameplayTouchBranch {
  probability: number
  effects?: PetGameplayEffect[]
  /** Track played on hit (held for stateMs, then the renderer settles). */
  state?: string
  stateMs?: number
  /** Bubble phrase pool; one is picked on hit. */
  phrases?: string[]
}

export interface PetGameplayTouchZone {
  name: string
  /** Vertical slice of the hit box (fractions, y0 < y1). */
  y0: number
  y1: number
  branches: PetGameplayTouchBranch[]
}

export interface PetGameplayStatDef {
  max: number
  initial?: number
  decayPerMinute?: number
  /** Decay rate while the work mode is active (defaults to decayPerMinute). */
  workingDecayPerMinute?: number
  /** Extra decay rate while no session is active. */
  idleDecayPerMinute?: number
}

export interface PetGameplayShopItem {
  id: string
  label: string
  /** Optional frame path (manifest-relative) shown as the item icon. */
  image?: string
  price: number
  currency: string
  effects?: PetGameplayEffect[]
  lottery?: {
    effects?: PetGameplayEffect[]
    /** Default currency the prize is paid in (tiers may override). */
    currency?: string
    tiers: { probability: number; prize: number; currency?: string }[]
  }
}

/** The validated manifest 'gameplay' block. */
export interface PetGameplayManifest {
  idleDirector?: {
    intervalMs: number
    maxMiss: number
    idleWeight: number
    acts: { track: string; weight: number; phrases?: string[] }[]
  }
  stats?: Record<string, PetGameplayStatDef>
  /** Click hit box inside the sprite box (fractions). */
  hitBox?: { x0: number; y0: number; x1: number; y1: number }
  touch?: {
    zones: PetGameplayTouchZone[]
    /** Plain-click effect while a touch animation holds (miku: mood +0..3). */
    clickBoost?: { stat: string; min: number; max: number }
  }
  work?: {
    state: string
    successState: string
    failState: string
    tickMs: number
    /** Hold time of the result track before the next round. */
    resultMs?: { success: number; fail: number }
    successProbability: number
    success?: { effects: PetGameplayEffect[] }
    fail?: { effects: PetGameplayEffect[] }
  }
  sleep?: {
    state: string
    wakeState?: string
    restore: { stat: string; amount: number; intervalMs: number }
  }
  passiveIncome?: { currency: string; amount: number; intervalMs: number }
  shop?: { state?: string; items: PetGameplayShopItem[] }
  /** Track played while the chrome reports dragging (default 'drag'). */
  dragState?: string
  /** Track played once when a drag ends (miku: standup), before settling. */
  dragEndState?: string
  /**
   * Low-energy auto-animation: when the named stat falls below `threshold`
   * (and the pet is not working/sleeping/dragging) the client forces
   * `track` until it recovers to at least `recover` (hysteresis avoids
   * flicker at the boundary). Optional; miku uses it to make the pet dozily
   * yawn/slump when energy is low.
   */
  lowEnergy?: {
    stat: string
    /** Trigger when the stat drops below this value. */
    threshold: number
    /** Release (back to the phase map) once the stat is at least this value. */
    recover: number
    /** frames2d track to force while the condition holds. */
    track: string
  }
}

/* ------------------------------------------------------------------ *
 * Manifest parsing (fail-closed structure)
 * ------------------------------------------------------------------ */

const KEBAB = /^[a-z0-9][a-z0-9-]*$/
const MAX_STATS = 16
const MAX_ZONES = 8
const MAX_BRANCHES = 8
const MAX_ACTS = 16
const MAX_SHOP_ITEMS = 32
const MAX_LOTTERY_TIERS = 16
const MAX_PHRASES = 64
const PHRASE_MAX_LENGTH = 120
const STAT_VALUE_MAX = 1_000_000
const CURRENCY_MAX = 9_999_999

const KNOWN_GAMEPLAY = new Set(['idleDirector', 'stats', 'hitBox', 'touch', 'work', 'sleep', 'passiveIncome', 'shop', 'dragState', 'dragEndState', 'lowEnergy'])
const KNOWN_STAT = new Set(['max', 'initial', 'decayPerMinute', 'workingDecayPerMinute', 'idleDecayPerMinute'])
const KNOWN_ZONE = new Set(['name', 'y0', 'y1', 'branches'])
const KNOWN_TOUCH = new Set(['zones', 'clickBoost'])
const KNOWN_BRANCH = new Set(['probability', 'effects', 'state', 'stateMs', 'phrases'])
const KNOWN_EFFECT = new Set(['stat', 'currency', 'amount'])
const KNOWN_WORK = new Set(['state', 'successState', 'failState', 'tickMs', 'resultMs', 'successProbability', 'success', 'fail'])
const KNOWN_SLEEP = new Set(['state', 'wakeState', 'restore'])
const KNOWN_SHOP_ITEM = new Set(['id', 'label', 'image', 'price', 'currency', 'effects', 'lottery'])
const KNOWN_LOTTERY = new Set(['effects', 'currency', 'tiers'])
const KNOWN_IDLE_DIRECTOR = new Set(['intervalMs', 'maxMiss', 'idleWeight', 'acts'])
const KNOWN_ACT = new Set(['track', 'weight', 'phrases'])
const KNOWN_LOW_ENERGY = new Set(['stat', 'threshold', 'recover', 'track'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKeys(source: Record<string, unknown>, known: Set<string>): string[] {
  return Object.keys(source).filter(key => !known.has(key))
}

export interface GameplayParseHooks {
  /** State names the renderer can play (frames2d track ids). */
  stateNames: ReadonlySet<string>
  error: (message: string) => void
}

function validName(name: unknown, max = 32): name is string {
  return typeof name === 'string' && name.length <= max && KEBAB.test(name)
}

function intIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function numIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function parseEffects(raw: unknown, field: string, stats: Record<string, PetGameplayStatDef>, hooks: GameplayParseHooks): PetGameplayEffect[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) {
    hooks.error(field + ' must be a non-empty array of effects')
    return undefined
  }
  const effects: PetGameplayEffect[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) {
      hooks.error(field + ': every effect must be an object')
      continue
    }
    const extra = unknownKeys(entry, KNOWN_EFFECT)
    if (extra.length > 0) hooks.error(field + ': unknown effect field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
    const hasStat = typeof entry.stat === 'string'
    const hasCurrency = typeof entry.currency === 'string'
    if (hasStat === hasCurrency) {
      hooks.error(field + ': an effect needs exactly one of stat or currency')
      continue
    }
    if (!intIn(entry.amount, -STAT_VALUE_MAX, STAT_VALUE_MAX) || entry.amount === 0) {
      hooks.error(field + ': effect amount must be a non-zero integer within ±' + STAT_VALUE_MAX)
      continue
    }
    if (hasStat && stats[entry.stat as string] === undefined) {
      hooks.error(field + ': effect references undeclared stat ' + JSON.stringify(entry.stat))
      continue
    }
    if (hasCurrency && !validName(entry.currency, 24)) {
      hooks.error(field + ': effect currency must be a kebab id')
      continue
    }
    effects.push({
      ...(hasStat ? { stat: entry.stat as string } : {}),
      ...(hasCurrency ? { currency: entry.currency as string } : {}),
      amount: entry.amount as number,
    })
  }
  return effects.length === 0 ? undefined : effects
}

function parsePhrases(raw: unknown, field: string, hooks: GameplayParseHooks): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PHRASES
    || raw.some(line => typeof line !== 'string' || line.trim() === '' || line.length > PHRASE_MAX_LENGTH)) {
    hooks.error(field + ' must be 1..' + MAX_PHRASES + ' non-empty lines of at most ' + PHRASE_MAX_LENGTH + ' chars')
    return undefined
  }
  return raw as string[]
}

function parseStateRef(raw: unknown, field: string, hooks: GameplayParseHooks): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || !hooks.stateNames.has(raw)) {
    hooks.error(field + ' must name a declared frames2d track')
    return undefined
  }
  return raw
}

/**
 * Validate the manifest 'gameplay' block (fail-closed). Only frames2d pets
 * may declare gameplay today: every state reference checks against the
 * declared track names.
 */
export function parseGameplayManifest(raw: unknown, hooks: GameplayParseHooks): PetGameplayManifest | undefined {
  const error = (message: string): void => hooks.error(message)
  if (!isRecord(raw)) {
    error('gameplay must be an object')
    return undefined
  }
  const extra = unknownKeys(raw, KNOWN_GAMEPLAY)
  if (extra.length > 0) error('gameplay: unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  let failed = false
  const fail = (message: string): void => { failed = true; error(message) }

  // --- stats (parsed first: effects reference them) ---
  const stats: Record<string, PetGameplayStatDef> = {}
  if (raw.stats !== undefined) {
    if (!isRecord(raw.stats)) fail('gameplay.stats must be an object keyed by stat id')
    else {
      const entries = Object.entries(raw.stats)
      if (entries.length > MAX_STATS) fail('gameplay.stats declares too many stats (max ' + MAX_STATS + ')')
      for (const [name, value] of entries) {
        if (!validName(name, 24)) {
          fail('gameplay.stats: invalid stat id ' + JSON.stringify(name))
          continue
        }
        if (!isRecord(value)) {
          fail('gameplay.stats.' + name + ' must be an object')
          continue
        }
        const statExtra = unknownKeys(value, KNOWN_STAT)
        if (statExtra.length > 0) fail('gameplay.stats.' + name + ': unknown field(s) ' + statExtra.map(k => JSON.stringify(k)).join(', '))
        if (!intIn(value.max, 1, STAT_VALUE_MAX)) {
          fail('gameplay.stats.' + name + '.max must be an integer in [1, ' + STAT_VALUE_MAX + ']')
          continue
        }
        const def: PetGameplayStatDef = { max: value.max }
        if (value.initial !== undefined) {
          if (!numIn(value.initial, 0, value.max)) fail('gameplay.stats.' + name + '.initial must be within [0, max]')
          else def.initial = value.initial
        }
        for (const key of ['decayPerMinute', 'workingDecayPerMinute', 'idleDecayPerMinute'] as const) {
          if (value[key] !== undefined) {
            if (!numIn(value[key], 0, 1000)) fail('gameplay.stats.' + name + '.' + key + ' must be a number in [0, 1000]')
            else def[key] = value[key] as number
          }
        }
        stats[name] = def
      }
    }
  }

  const block: PetGameplayManifest = {}
  if (Object.keys(stats).length > 0) block.stats = stats

  // --- idle director ---
  if (raw.idleDirector !== undefined) {
    if (!isRecord(raw.idleDirector) || !Array.isArray(raw.idleDirector.acts)) {
      fail('gameplay.idleDirector must be an object with an acts array')
    } else {
      const d = raw.idleDirector as Record<string, unknown> & { acts: unknown[] }
      const dExtra = unknownKeys(d, KNOWN_IDLE_DIRECTOR)
      if (dExtra.length > 0) fail('gameplay.idleDirector: unknown field(s) ' + dExtra.map(k => JSON.stringify(k)).join(', '))
      if (d.intervalMs !== undefined && !intIn(d.intervalMs, 1000, 60_000)) fail('gameplay.idleDirector.intervalMs must be an integer in [1000, 60000]')
      if (d.maxMiss !== undefined && !intIn(d.maxMiss, 0, 10)) fail('gameplay.idleDirector.maxMiss must be an integer in [0, 10]')
      if (d.idleWeight !== undefined && !intIn(d.idleWeight, 0, 10_000)) fail('gameplay.idleDirector.idleWeight must be an integer in [0, 10000]')
      if (d.acts.length === 0 || d.acts.length > MAX_ACTS) fail('gameplay.idleDirector.acts must declare 1..' + MAX_ACTS + ' acts')
      const acts: { track: string; weight: number; phrases?: string[] }[] = []
      for (const act of d.acts as unknown[]) {
        if (!isRecord(act) || !intIn(act.weight, 1, 10_000)) {
          fail('gameplay.idleDirector.acts entries need a weight integer in [1, 10000]')
          continue
        }
        const aExtra = unknownKeys(act, KNOWN_ACT)
        if (aExtra.length > 0) fail('gameplay.idleDirector.acts: unknown field(s) ' + aExtra.map(k => JSON.stringify(k)).join(', '))
        const track = parseStateRef(act.track, 'gameplay.idleDirector.acts.track', hooks)
        if (track === undefined) continue
        const entry: { track: string; weight: number; phrases?: string[] } = { track, weight: act.weight }
        const phrases = parsePhrases(act.phrases, 'gameplay.idleDirector.acts.phrases', hooks)
        if (phrases !== undefined) entry.phrases = phrases
        acts.push(entry)
      }
      if (acts.length > 0) {
        block.idleDirector = {
          intervalMs: intIn(d.intervalMs, 1000, 60_000) ? d.intervalMs as number : 5000,
          maxMiss: intIn(d.maxMiss, 0, 10) ? d.maxMiss as number : 2,
          idleWeight: intIn(d.idleWeight, 0, 10_000) ? d.idleWeight as number : 0,
          acts,
        }
      }
    }
  }

  // --- hit box ---
  if (raw.hitBox !== undefined) {
    const b = raw.hitBox
    if (!isRecord(b) || !numIn(b.x0, 0, 1) || !numIn(b.x1, 0, 1) || !numIn(b.y0, 0, 1) || !numIn(b.y1, 0, 1)
      || !(b.x0 < b.x1) || !(b.y0 < b.y1)) {
      fail('gameplay.hitBox must be { x0, y0, x1, y1 } fractions with x0 < x1 and y0 < y1')
    } else {
      block.hitBox = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }
    }
  }

  // --- touch zones ---
  if (raw.touch !== undefined) {
    if (!isRecord(raw.touch) || !Array.isArray(raw.touch.zones)) {
      fail('gameplay.touch must be an object with a zones array')
    } else {
      const tExtra = unknownKeys(raw.touch, KNOWN_TOUCH)
      if (tExtra.length > 0) fail('gameplay.touch: unknown field(s) ' + tExtra.map(k => JSON.stringify(k)).join(', '))
      let clickBoost: { stat: string; min: number; max: number } | undefined
      if (raw.touch.clickBoost !== undefined) {
        const cb = raw.touch.clickBoost
        if (!isRecord(cb) || typeof cb.stat !== 'string' || stats[cb.stat] === undefined
          || !intIn(cb.min, 0, 1000) || !intIn(cb.max, 0, 1000) || (cb.min as number) > (cb.max as number)) {
          fail('gameplay.touch.clickBoost must be { stat (declared), min, max } integers with 0 <= min <= max <= 1000')
        } else clickBoost = { stat: cb.stat, min: cb.min, max: cb.max }
      }
      const zones: PetGameplayTouchZone[] = []
      if (raw.touch.zones.length === 0 || raw.touch.zones.length > MAX_ZONES) fail('gameplay.touch.zones must declare 1..' + MAX_ZONES + ' zones')
      for (const zoneRaw of raw.touch.zones as unknown[]) {
        if (!isRecord(zoneRaw) || !validName(zoneRaw.name) || !numIn(zoneRaw.y0, 0, 1) || !numIn(zoneRaw.y1, 0, 1) || !(zoneRaw.y0 < zoneRaw.y1)) {
          fail('gameplay.touch.zones entries need a kebab name and 0 <= y0 < y1 <= 1')
          continue
        }
        const zExtra = unknownKeys(zoneRaw, KNOWN_ZONE)
        if (zExtra.length > 0) fail('gameplay.touch.' + zoneRaw.name + ': unknown field(s) ' + zExtra.map(k => JSON.stringify(k)).join(', '))
        if (!Array.isArray(zoneRaw.branches) || zoneRaw.branches.length === 0 || zoneRaw.branches.length > MAX_BRANCHES) {
          fail('gameplay.touch.' + zoneRaw.name + '.branches must declare 1..' + MAX_BRANCHES + ' branches')
          continue
        }
        let probabilitySum = 0
        const branches: PetGameplayTouchBranch[] = []
        for (const branchRaw of zoneRaw.branches as unknown[]) {
          if (!isRecord(branchRaw) || !numIn(branchRaw.probability, 0, 1) || branchRaw.probability === 0) {
            fail('gameplay.touch.' + zoneRaw.name + '.branches entries need a probability in (0, 1]')
            continue
          }
          const bExtra = unknownKeys(branchRaw, KNOWN_BRANCH)
          if (bExtra.length > 0) fail('gameplay.touch.' + zoneRaw.name + ': unknown branch field(s) ' + bExtra.map(k => JSON.stringify(k)).join(', '))
          probabilitySum += branchRaw.probability
          const branch: PetGameplayTouchBranch = { probability: branchRaw.probability }
          const effects = parseEffects(branchRaw.effects, 'gameplay.touch.' + zoneRaw.name + '.effects', stats, hooks)
          if (effects !== undefined) branch.effects = effects
          const state = parseStateRef(branchRaw.state, 'gameplay.touch.' + zoneRaw.name + '.state', hooks)
          if (state !== undefined) branch.state = state
          if (branchRaw.stateMs !== undefined) {
            if (!intIn(branchRaw.stateMs, 200, 10_000)) fail('gameplay.touch.' + zoneRaw.name + '.stateMs must be an integer in [200, 10000]')
            else branch.stateMs = branchRaw.stateMs
          }
          const phrases = parsePhrases(branchRaw.phrases, 'gameplay.touch.' + zoneRaw.name + '.phrases', hooks)
          if (phrases !== undefined) branch.phrases = phrases
          branches.push(branch)
        }
        if (probabilitySum > 1 + 1e-9) fail('gameplay.touch.' + zoneRaw.name + ': branch probabilities must sum to at most 1')
        if (branches.length > 0) zones.push({ name: zoneRaw.name, y0: zoneRaw.y0, y1: zoneRaw.y1, branches })
      }
      if (zones.length > 0 || clickBoost !== undefined) block.touch = { zones, ...(clickBoost === undefined ? {} : { clickBoost }) }
    }
  }

  // --- work ---
  if (raw.work !== undefined) {
    const w = raw.work
    if (!isRecord(w)) fail('gameplay.work must be an object')
    else {
      const wExtra = unknownKeys(w, KNOWN_WORK)
      if (wExtra.length > 0) fail('gameplay.work: unknown field(s) ' + wExtra.map(k => JSON.stringify(k)).join(', '))
      const state = parseStateRef(w.state, 'gameplay.work.state', hooks)
      const successState = parseStateRef(w.successState, 'gameplay.work.successState', hooks)
      const failState = parseStateRef(w.failState, 'gameplay.work.failState', hooks)
      if (!intIn(w.tickMs, 1000, 60_000)) fail('gameplay.work.tickMs must be an integer in [1000, 60000]')
      if (!numIn(w.successProbability, 0, 1)) fail('gameplay.work.successProbability must be a number in [0, 1]')
      if (state !== undefined && successState !== undefined && failState !== undefined
        && intIn(w.tickMs, 1000, 60_000) && numIn(w.successProbability, 0, 1)) {
        const work: NonNullable<PetGameplayManifest['work']> = {
          state, successState, failState,
          tickMs: w.tickMs,
          successProbability: w.successProbability,
        }
        if (w.resultMs !== undefined) {
          if (!isRecord(w.resultMs) || !intIn(w.resultMs.success, 200, 10_000) || !intIn(w.resultMs.fail, 200, 10_000)) {
            fail('gameplay.work.resultMs must be { success, fail } integers in [200, 10000]')
          } else work.resultMs = { success: w.resultMs.success, fail: w.resultMs.fail }
        }
        for (const key of ['success', 'fail'] as const) {
          if (w[key] !== undefined) {
            if (!isRecord(w[key])) fail('gameplay.work.' + key + ' must be an object { effects }')
            else {
              const effects = parseEffects((w[key] as Record<string, unknown>).effects, 'gameplay.work.' + key + '.effects', stats, hooks)
              if (effects !== undefined) work[key] = { effects }
            }
          }
        }
        block.work = work
      }
    }
  }

  // --- sleep ---
  if (raw.sleep !== undefined) {
    const s = raw.sleep
    if (!isRecord(s) || !isRecord(s.restore)) fail('gameplay.sleep must be an object with a restore block')
    else {
      const sExtra = unknownKeys(s, KNOWN_SLEEP)
      if (sExtra.length > 0) fail('gameplay.sleep: unknown field(s) ' + sExtra.map(k => JSON.stringify(k)).join(', '))
      const state = parseStateRef(s.state, 'gameplay.sleep.state', hooks)
      const wakeState = parseStateRef(s.wakeState, 'gameplay.sleep.wakeState', hooks)
      const restoreStat = typeof s.restore.stat === 'string' && stats[s.restore.stat] !== undefined ? s.restore.stat : undefined
      if (restoreStat === undefined) fail('gameplay.sleep.restore.stat must reference a declared stat')
      if (!intIn(s.restore.amount, 1, 1000)) fail('gameplay.sleep.restore.amount must be an integer in [1, 1000]')
      if (!intIn(s.restore.intervalMs, 1000, 600_000)) fail('gameplay.sleep.restore.intervalMs must be an integer in [1000, 600000]')
      if (state !== undefined && restoreStat !== undefined && intIn(s.restore.amount, 1, 1000) && intIn(s.restore.intervalMs, 1000, 600_000)) {
        block.sleep = {
          state,
          ...(wakeState === undefined ? {} : { wakeState }),
          restore: { stat: restoreStat, amount: s.restore.amount, intervalMs: s.restore.intervalMs },
        }
      }
    }
  }

  // --- passive income ---
  if (raw.passiveIncome !== undefined) {
    const p = raw.passiveIncome
    if (!isRecord(p) || !validName(p.currency, 24) || !intIn(p.amount, 1, 10_000) || !intIn(p.intervalMs, 1000, 86_400_000)) {
      fail('gameplay.passiveIncome must be { currency (kebab), amount 1..10000, intervalMs 1000..86400000 }')
    } else {
      block.passiveIncome = { currency: p.currency, amount: p.amount, intervalMs: p.intervalMs }
    }
  }

  // --- shop ---
  if (raw.shop !== undefined) {
    const s = raw.shop
    if (!isRecord(s) || !Array.isArray(s.items) || s.items.length === 0 || s.items.length > MAX_SHOP_ITEMS) {
      fail('gameplay.shop must be an object with 1..' + MAX_SHOP_ITEMS + ' items')
    } else {
      const shopState = parseStateRef(s.state, 'gameplay.shop.state', hooks)
      const items: PetGameplayShopItem[] = []
      const seen = new Set<string>()
      for (const itemRaw of s.items as unknown[]) {
        if (!isRecord(itemRaw) || !validName(itemRaw.id, 24)) {
          fail('gameplay.shop.items entries need a kebab id')
          continue
        }
        if (seen.has(itemRaw.id)) {
          fail('gameplay.shop: duplicate item id ' + JSON.stringify(itemRaw.id))
          continue
        }
        seen.add(itemRaw.id)
        const iExtra = unknownKeys(itemRaw, KNOWN_SHOP_ITEM)
        if (iExtra.length > 0) fail('gameplay.shop.' + itemRaw.id + ': unknown field(s) ' + iExtra.map(k => JSON.stringify(k)).join(', '))
        if (typeof itemRaw.label !== 'string' || itemRaw.label.trim() === '' || itemRaw.label.length > 80) {
          fail('gameplay.shop.' + itemRaw.id + '.label must be a non-empty string of at most 80 chars')
          continue
        }
        if (!intIn(itemRaw.price, 1, 1_000_000)) {
          fail('gameplay.shop.' + itemRaw.id + '.price must be an integer in [1, 1000000]')
          continue
        }
        if (!validName(itemRaw.currency, 24)) {
          fail('gameplay.shop.' + itemRaw.id + '.currency must be a kebab id')
          continue
        }
        const item: PetGameplayShopItem = {
          id: itemRaw.id,
          label: itemRaw.label.trim(),
          price: itemRaw.price,
          currency: itemRaw.currency,
        }
        if (itemRaw.image !== undefined) {
          if (typeof itemRaw.image !== 'string' || itemRaw.image.includes('..') || itemRaw.image.includes('\\') || itemRaw.image.startsWith('/')) {
            fail('gameplay.shop.' + itemRaw.id + '.image must be a safe manifest-relative frame path')
          } else item.image = itemRaw.image
        }
        const effects = parseEffects(itemRaw.effects, 'gameplay.shop.' + itemRaw.id + '.effects', stats, hooks)
        if (effects !== undefined) item.effects = effects
        if (itemRaw.lottery !== undefined) {
          const l = itemRaw.lottery
          if (!isRecord(l) || !Array.isArray(l.tiers) || l.tiers.length === 0 || l.tiers.length > MAX_LOTTERY_TIERS) {
            fail('gameplay.shop.' + itemRaw.id + '.lottery needs 1..' + MAX_LOTTERY_TIERS + ' tiers')
          } else {
            const lExtra = unknownKeys(l, KNOWN_LOTTERY)
            if (lExtra.length > 0) fail('gameplay.shop.' + itemRaw.id + '.lottery: unknown field(s) ' + lExtra.map(k => JSON.stringify(k)).join(', '))
            if (l.currency !== undefined && !validName(l.currency, 24)) fail('gameplay.shop.' + itemRaw.id + '.lottery.currency must be a kebab id')
            let tierSum = 0
            const tiers: { probability: number; prize: number; currency?: string }[] = []
            for (const tierRaw of l.tiers as unknown[]) {
              if (!isRecord(tierRaw) || !numIn(tierRaw.probability, 0, 1) || tierRaw.probability === 0
                || !intIn(tierRaw.prize, 0, 1_000_000_000)) {
                fail('gameplay.shop.' + itemRaw.id + '.lottery.tiers entries need probability (0,1] and prize 0..1e9')
                continue
              }
              tierSum += tierRaw.probability
              const tier: { probability: number; prize: number; currency?: string } = {
                probability: tierRaw.probability,
                prize: tierRaw.prize,
              }
              if (tierRaw.currency !== undefined) {
                if (!validName(tierRaw.currency, 24)) fail('gameplay.shop.' + itemRaw.id + '.lottery tier currency must be a kebab id')
                else tier.currency = tierRaw.currency
              }
              tiers.push(tier)
            }
            if (tierSum > 1 + 1e-9) fail('gameplay.shop.' + itemRaw.id + '.lottery tier probabilities must sum to at most 1')
            if (tiers.length > 0) {
              const lotteryEffects = parseEffects(l.effects, 'gameplay.shop.' + itemRaw.id + '.lottery.effects', stats, hooks)
              item.lottery = {
                tiers,
                ...(lotteryEffects === undefined ? {} : { effects: lotteryEffects }),
                ...(validName(l.currency, 24) ? { currency: l.currency } : {}),
              }
            }
          }
        }
        if (item.effects === undefined && item.lottery === undefined) {
          fail('gameplay.shop.' + itemRaw.id + ' needs effects or a lottery')
          continue
        }
        items.push(item)
      }
      if (items.length > 0) block.shop = { ...(shopState === undefined ? {} : { state: shopState }), items }
    }
  }

  // --- drag state ---
  if (raw.dragState !== undefined) {
    const state = parseStateRef(raw.dragState, 'gameplay.dragState', hooks)
    if (state !== undefined) block.dragState = state
  }
  if (raw.dragEndState !== undefined) {
    const state = parseStateRef(raw.dragEndState, 'gameplay.dragEndState', hooks)
    if (state !== undefined) block.dragEndState = state
  }

  // --- low-energy auto-animation ---
  if (raw.lowEnergy !== undefined) {
    const le = raw.lowEnergy
    if (!isRecord(le)) fail('gameplay.lowEnergy must be an object')
    else {
      const leExtra = unknownKeys(le, KNOWN_LOW_ENERGY)
      if (leExtra.length > 0) fail('gameplay.lowEnergy: unknown field(s) ' + leExtra.map(k => JSON.stringify(k)).join(', '))
      const stat = typeof le.stat === 'string' && stats[le.stat] !== undefined ? le.stat : undefined
      if (stat === undefined) fail('gameplay.lowEnergy.stat must reference a declared stat')
      const track = parseStateRef(le.track, 'gameplay.lowEnergy.track', hooks)
      const thresholdOk = le.threshold !== undefined && intIn(le.threshold as number, 1, STAT_VALUE_MAX)
      const recoverOk = le.recover !== undefined && numIn(le.recover as number, 0, 1_000_000)
      if (!thresholdOk) fail('gameplay.lowEnergy.threshold must be an integer in [1, ' + STAT_VALUE_MAX + ']')
      if (!recoverOk) fail('gameplay.lowEnergy.recover must be a number in [0, 1000000]')
      if (thresholdOk && recoverOk && (le.recover as number) < (le.threshold as number)) {
        fail('gameplay.lowEnergy.recover must be >= threshold (release happens at/above recover)')
      }
      if (stat !== undefined && track !== undefined && thresholdOk && recoverOk) {
        block.lowEnergy = {
          stat,
          threshold: le.threshold as number,
          recover: le.recover as number,
          track,
        }
      }
    }
  }

  return failed ? undefined : block
}

/* ------------------------------------------------------------------ *
 * Host engine (pure; clock and rng injected)
 * ------------------------------------------------------------------ */

/** Persisted per-pet gameplay state (pet.json 'gameplay' map values). */
export interface PetGameplayState {
  stats: Record<string, number>
  currencies: Record<string, number>
  mode: 'work' | 'sleep' | null
  /** Epoch ms of the last lazy settle. */
  settledAt: number
}

/** Fresh state for one pet: stats at their initial (default max), no currency. */
export function initialGameplayState(manifest: PetGameplayManifest, now: number): PetGameplayState {
  const stats: Record<string, number> = {}
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    stats[name] = def.initial ?? def.max
  }
  return { stats, currencies: {}, mode: null, settledAt: now }
}

/** Clamp one stat value into [0, max]; currencies into [0, CURRENCY_MAX]. */
export function clampGameplay(state: PetGameplayState, manifest: PetGameplayManifest): void {
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    const value = state.stats[name]
    if (value === undefined) state.stats[name] = def.initial ?? def.max
    else state.stats[name] = Math.min(def.max, Math.max(0, value))
  }
  for (const [name, value] of Object.entries(state.currencies)) {
    state.currencies[name] = Math.min(CURRENCY_MAX, Math.max(0, Math.floor(value)))
  }
}

/**
 * Lazy settle: apply stat decay, passive income and sleep restore for the
 * elapsed wall time since the last settle. Mirrors the treats.ts discipline
 * (no host timers; read paths settle). Returns whether anything changed.
 */
export function settleGameplay(
  state: PetGameplayState,
  manifest: PetGameplayManifest,
  now: number,
  options: { sessionActive: boolean },
): boolean {
  const elapsedMs = now - state.settledAt
  if (elapsedMs <= 0) return false
  const minutes = elapsedMs / 60_000
  let changed = false
  for (const [name, def] of Object.entries(manifest.stats ?? {})) {
    const current = state.stats[name]
    if (current === undefined || current <= 0) continue
    let rate = def.decayPerMinute ?? 0
    if (state.mode === 'work' && def.workingDecayPerMinute !== undefined) rate = def.workingDecayPerMinute
    if (!options.sessionActive) rate += def.idleDecayPerMinute ?? 0
    if (rate <= 0) continue
    const next = Math.max(0, current - rate * minutes)
    if (next !== current) {
      state.stats[name] = next
      changed = true
    }
  }
  if (manifest.passiveIncome !== undefined) {
    const ticks = Math.floor(elapsedMs / manifest.passiveIncome.intervalMs)
    if (ticks > 0) {
      const currency = manifest.passiveIncome.currency
      state.currencies[currency] = (state.currencies[currency] ?? 0) + ticks * manifest.passiveIncome.amount
      changed = true
    }
  }
  if (state.mode === 'sleep' && manifest.sleep !== undefined) {
    const ticks = Math.floor(elapsedMs / manifest.sleep.restore.intervalMs)
    if (ticks > 0) {
      const stat = manifest.sleep.restore.stat
      state.stats[stat] = (state.stats[stat] ?? 0) + ticks * manifest.sleep.restore.amount
      changed = true
    }
  }
  state.settledAt = now
  clampGameplay(state, manifest)
  return changed
}

/** Apply one effect vector (touch/work/shop), clamped. */
export function applyGameplayEffects(state: PetGameplayState, manifest: PetGameplayManifest, effects: readonly PetGameplayEffect[]): void {
  for (const effect of effects) {
    if (effect.stat !== undefined) {
      state.stats[effect.stat] = (state.stats[effect.stat] ?? 0) + effect.amount
    } else if (effect.currency !== undefined) {
      state.currencies[effect.currency] = (state.currencies[effect.currency] ?? 0) + effect.amount
    }
  }
  clampGameplay(state, manifest)
}

/** Roll one touch zone branch; undefined when the roll lands in no-op mass. */
export function rollTouchBranch(zone: PetGameplayTouchZone, rng: () => number): PetGameplayTouchBranch | undefined {
  const roll = rng()
  let acc = 0
  for (const branch of zone.branches) {
    acc += branch.probability
    if (roll < acc) return branch
  }
  return undefined
}

/** Roll one work tick outcome. */
export function rollWorkOutcome(work: NonNullable<PetGameplayManifest['work']>, rng: () => number): 'success' | 'fail' {
  return rng() < work.successProbability ? 'success' : 'fail'
}

/** Draw one lottery prize tier; uncovered mass falls through to the last tier. */
export function drawLotteryTier(
  lottery: NonNullable<PetGameplayShopItem['lottery']>,
  rng: () => number,
): { probability: number; prize: number; currency?: string } {
  const roll = rng()
  let acc = 0
  for (const tier of lottery.tiers) {
    acc += tier.probability
    if (roll < acc) return tier
  }
  return lottery.tiers[lottery.tiers.length - 1]!
}

/** The zone one normalized hit-box point lands in, if any. */
export function touchZoneAt(touch: { zones: PetGameplayTouchZone[] }, yFraction: number): PetGameplayTouchZone | undefined {
  return touch.zones.find(zone => yFraction >= zone.y0 && yFraction < zone.y1)
}
