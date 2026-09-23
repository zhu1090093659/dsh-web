/**
 * Pet persistence — tiny JSON store for affinity + display config, written
 * under $DSH_HOME (defaults to ~/.dsh) as `pet.json`. Deliberately minimal:
 * one file, atomic rename write, tolerant read (corrupt file → defaults).
 * @module @linxin666/dsh-pet/persist
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { AFFINITY_MAX, emptyAffinity, type AffinityState } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger, type TreatLedger } from './treats.ts'
import { DEFAULT_PET_ID, DEFAULT_PET_NAME } from './defaults.ts'
import type { PetGameplayState } from './gameplay.ts'

export { DEFAULT_PET_ID, DEFAULT_PET_NAME } from './defaults.ts'

/** Display configuration the user can tweak. */
export interface PetDisplayConfig {
  /** Master switch. */
  visible: boolean
  /** Scale of the rendered pet in px (sprite cell height). */
  size: number
  /** Horizontal inset from the viewport right edge, px. */
  right: number
  /** Vertical inset from the viewport bottom edge, px. */
  bottom: number
  /**
   * Multiplier on the bubble typography's automatic size following (#1549).
   * The rendered bubble scale is `size / 160 * bubbleScale`, bounded by
   * {@link BUBBLE_FONT_MIN_PX}..{@link BUBBLE_FONT_MAX_PX}, so 1 keeps the
   * 12px baseline the stylesheet was drawn for at the default 160px pet.
   */
  bubbleScale: number
}

export const defaultDisplayConfig: PetDisplayConfig = {
  visible: true,
  size: 160,
  right: 24,
  bottom: 120,
  bubbleScale: 1,
}

/** Display value bounds (shared by load-time validation and setConfig). */
export const DISPLAY_SIZE_MIN = 32
export const DISPLAY_SIZE_MAX = 1024
export const DISPLAY_INSET_MAX = 10_000

/** Bubble typography bounds (issue #1549). */
export const BUBBLE_SCALE_MIN = 0.5
export const BUBBLE_SCALE_MAX = 2
/** Pixel size the bubble stylesheet was drawn for, at the default pet size. */
export const BUBBLE_BASE_FONT_PX = 12
/** Pet size that baseline matches; other sizes scale the bubble with them. */
export const BUBBLE_BASE_SIZE_PX = 160
/** Readability floor and layout ceiling of the scaled bubble text. */
export const BUBBLE_FONT_MIN_PX = 10
export const BUBBLE_FONT_MAX_PX = 24

/**
 * Bubble typography scale for one display config (issue #1549): the bubble
 * follows the pet's own size so a shrunk pet does not carry a full-size
 * bubble, and the user's multiplier rides on top. The result is a CSS ratio
 * against {@link BUBBLE_BASE_FONT_PX}, bounded so the text never drops below
 * the readability floor or outgrows the pet. `bubbleScale` is optional at
 * runtime: a host that predates the field (a rolling update, or any snapshot
 * that omits it) falls back to the baseline, because a NaN ratio written into
 * `--pet-bubble-scale` collapses every bubble's text to zero.
 * @param display - display config; `bubbleScale` may be absent on older hosts.
 * @returns the ratio written to `--pet-bubble-scale` (always finite).
 */
export function bubbleScaleFor(display: Pick<PetDisplayConfig, 'size'> & { bubbleScale?: number }): number {
  // Guard the arithmetic, not just the clamp: Math.min/max propagate NaN, so a
  // missing or non-finite field would otherwise reach the stylesheet.
  const size = Number.isFinite(display.size) ? display.size : BUBBLE_BASE_SIZE_PX
  const multiplier = typeof display.bubbleScale === 'number' && Number.isFinite(display.bubbleScale)
    ? display.bubbleScale
    : 1
  const scaled = (size / BUBBLE_BASE_SIZE_PX) * multiplier
  const min = BUBBLE_FONT_MIN_PX / BUBBLE_BASE_FONT_PX
  const max = BUBBLE_FONT_MAX_PX / BUBBLE_BASE_FONT_PX
  return Math.round(Math.min(max, Math.max(min, scaled)) * 100) / 100
}

/** Everything persisted for the pet. */
export interface PetPersist {
  /** Selected pet id (a registry entry; clamped at service startup). */
  petId: string
  /**
   * Per-pet display names keyed by pet id. A pet without an entry falls back
   * to its manifest displayName, so only user renames are stored here.
   */
  names: Record<string, string>
  /**
   * Per-pet selected frames2d skin id (keyed by pet id). Skin ids are manifest
   * data, so a stale entry (skin renamed or removed, pet swapped) is ignored
   * when the state view is built instead of pinning an unresolvable track.
   */
  skins: Record<string, string>
  affinity: AffinityState
  /** Treat (小鱼干) stock ledger. */
  treats: TreatLedger
  display: PetDisplayConfig
  /** Per-pet gameplay state (stats/currencies/mode), keyed by pet id. */
  gameplay: Record<string, PetGameplayState>
}

/** Name constraints. */
export const PET_NAME_MAX_LENGTH = 20

export function emptyPersist(): PetPersist {
  return {
    petId: DEFAULT_PET_ID,
    names: {},
    skins: {},
    affinity: emptyAffinity(),
    treats: emptyTreatLedger(),
    display: { ...defaultDisplayConfig },
    gameplay: {},
  }
}

/**
 * Resolve the persistence directory ($DSH_HOME or ~/.dsh). Delegates to the
 * shared {@link dshHome} resolution so the plugin family keeps one DSH_HOME
 * definition (env override, ~ expansion, cwd-joined relative values).
 */
export function petHomeDir(): string {
  return dshHome()
}

/** Numeric field guard: finite numbers only, else the fallback. */
function finiteNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** A persisted document from any schema era (legacy carried a flat `name`). */
type PetPersistDocument = Partial<PetPersist> & { name?: unknown }

/** Sanitize the per-pet names map (string keys, non-empty trimmed values). */
function loadPetNames(parsed: PetPersistDocument): Record<string, string> {
  const names: Record<string, string> = {}
  if (typeof parsed.names !== 'object' || parsed.names === null) return names
  for (const [id, value] of Object.entries(parsed.names as Record<string, unknown>)) {
    if (id === '' || typeof value !== 'string') continue
    const name = value.trim()
    if (name === '') continue
    names[id] = name.slice(0, PET_NAME_MAX_LENGTH)
  }
  return names
}

/** Sanitize the per-pet skin selection map (string keys, non-empty trimmed values). */
function loadPetSkins(parsed: PetPersistDocument): Record<string, string> {
  const skins: Record<string, string> = {}
  if (typeof parsed.skins !== 'object' || parsed.skins === null) return skins
  for (const [id, value] of Object.entries(parsed.skins as Record<string, unknown>)) {
    if (id === '' || typeof value !== 'string') continue
    const skin = value.trim()
    if (skin === '') continue
    skins[id] = skin
  }
  return skins
}

/** Clamp one count/score into [0, max]. */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/** Absolute numeric ceilings applied at load (manifest clamps refine these). */
const GAMEPLAY_LOAD_STAT_CAP = 1_000_000
const GAMEPLAY_LOAD_CURRENCY_CAP = 9_999_999

/** Sanitize the persisted per-pet gameplay map. */
function loadGameplay(parsed: PetPersistDocument): Record<string, PetGameplayState> {
  const result: Record<string, PetGameplayState> = {}
  if (typeof parsed.gameplay !== 'object' || parsed.gameplay === null) return result
  for (const [petId, raw] of Object.entries(parsed.gameplay as Record<string, unknown>)) {
    if (petId === '' || typeof raw !== 'object' || raw === null) continue
    const record = raw as Partial<PetGameplayState>
    const stats: Record<string, number> = {}
    if (typeof record.stats === 'object' && record.stats !== null) {
      for (const [key, value] of Object.entries(record.stats)) {
        if (key === '' || typeof value !== 'number' || !Number.isFinite(value)) continue
        stats[key] = Math.min(GAMEPLAY_LOAD_STAT_CAP, Math.max(0, value))
      }
    }
    const currencies: Record<string, number> = {}
    if (typeof record.currencies === 'object' && record.currencies !== null) {
      for (const [key, value] of Object.entries(record.currencies)) {
        if (key === '' || typeof value !== 'number' || !Number.isFinite(value)) continue
        currencies[key] = Math.min(GAMEPLAY_LOAD_CURRENCY_CAP, Math.max(0, Math.floor(value)))
      }
    }
    const item: PetGameplayState = {
      stats,
      currencies,
      // Any non-empty id survives the round trip; whether it is still declared
      // is settled against the manifest when the mode is read back.
      mode: typeof record.mode === 'string' && record.mode.length > 0 && record.mode.length <= 24 ? record.mode : null,
      settledAt: clamp(finiteNum(record.settledAt, 0), Number.MAX_SAFE_INTEGER),
    }
    if (typeof record.incomeCarryMs === 'number' && Number.isFinite(record.incomeCarryMs)) {
      item.incomeCarryMs = Math.max(0, record.incomeCarryMs)
    }
    if (typeof record.restoreCarryMs === 'number' && Number.isFinite(record.restoreCarryMs)) {
      item.restoreCarryMs = Math.max(0, record.restoreCarryMs)
    }
    result[petId] = item
  }
  return result
}

/** Load persisted state; missing or corrupt files fall back to defaults. */
export function loadPetPersist(dir: string = petHomeDir()): PetPersist {
  try {
    const raw = readFileSync(join(dir, 'pet.json'), 'utf8')
    const parsed = JSON.parse(raw) as PetPersistDocument
    const base = emptyPersist()
    const rawAffinity = (parsed.affinity ?? {}) as Partial<AffinityState>
    const affinity: AffinityState = {
      points: clamp(finiteNum(rawAffinity.points, 0), AFFINITY_MAX),
      lastPetAt: clamp(finiteNum(rawAffinity.lastPetAt, 0), Number.MAX_SAFE_INTEGER),
      lastFeedAt: clamp(finiteNum(rawAffinity.lastFeedAt, 0), Number.MAX_SAFE_INTEGER),
      pets: clamp(finiteNum(rawAffinity.pets, 0), Number.MAX_SAFE_INTEGER),
      feeds: clamp(finiteNum(rawAffinity.feeds, 0), Number.MAX_SAFE_INTEGER),
      petRejects: clamp(finiteNum(rawAffinity.petRejects, 0), Number.MAX_SAFE_INTEGER),
      feedRejects: clamp(finiteNum(rawAffinity.feedRejects, 0), Number.MAX_SAFE_INTEGER),
      turns: clamp(finiteNum(rawAffinity.turns, 0), Number.MAX_SAFE_INTEGER),
    }
    const rawTreats = (parsed.treats ?? {}) as Partial<TreatLedger>
    const treats: TreatLedger = {
      treats: clamp(finiteNum(rawTreats.treats, 0), defaultTreatConfig.maxTreats),
      lastTreatGrantAt: clamp(finiteNum(rawTreats.lastTreatGrantAt, 0), Number.MAX_SAFE_INTEGER),
      turnsAtLastTreatGrant: clamp(finiteNum(rawTreats.turnsAtLastTreatGrant, 0), Number.MAX_SAFE_INTEGER),
    }
    const rawDisplay = (parsed.display ?? {}) as Partial<PetDisplayConfig>
    const display: PetDisplayConfig = {
      visible: typeof rawDisplay.visible === 'boolean' ? rawDisplay.visible : base.display.visible,
      // The settings schema requires whole pixels; drag positions are
      // clamped but not integral, so round at the persistence boundary.
      size: Math.round(Math.min(DISPLAY_SIZE_MAX, Math.max(DISPLAY_SIZE_MIN, finiteNum(rawDisplay.size, base.display.size)))),
      right: Math.round(clamp(finiteNum(rawDisplay.right, base.display.right), DISPLAY_INSET_MAX)),
      bottom: Math.round(clamp(finiteNum(rawDisplay.bottom, base.display.bottom), DISPLAY_INSET_MAX)),
      // Fractional on purpose: the multiplier is a ratio, not a pixel count.
      bubbleScale: Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, finiteNum(rawDisplay.bubbleScale, base.display.bubbleScale))),
    }
    const petId = typeof parsed.petId === 'string' && parsed.petId.trim() !== ''
      ? parsed.petId.trim()
      : base.petId
    const names = loadPetNames(parsed)
    // Legacy migration: pre-registry installs persisted one flat `name`
    // field. Move it onto the selected pet (the legacy whale-girl unless the
    // file already names another pet) so renames survive the upgrade.
    if (typeof parsed.name === 'string' && parsed.name.trim() !== '' && names[petId] === undefined) {
      names[petId] = parsed.name.trim().slice(0, PET_NAME_MAX_LENGTH)
    }
    return {
      petId,
      names,
      skins: loadPetSkins(parsed),
      affinity,
      treats,
      display,
      gameplay: loadGameplay(parsed),
    }
  } catch {
    return emptyPersist()
  }
}

/** Atomically persist state (write temp + rename). */
export function savePetPersist(data: PetPersist, dir: string = petHomeDir()): void {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'pet.json')
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, target)
}
