/**
 * Pet persistence — tiny JSON store for affinity + display config, written
 * under $DSH_HOME (defaults to ~/.dsh) as `pet.json`. Deliberately minimal:
 * one file, atomic rename write, tolerant read (corrupt file → defaults).
 * @module @linxin666/dsh-pet/persist
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AFFINITY_MAX, emptyAffinity, type AffinityState } from './affinity.ts'
import { defaultTreatConfig, emptyTreatLedger, type TreatLedger } from './treats.ts'

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
}

export const defaultDisplayConfig: PetDisplayConfig = {
  visible: true,
  size: 160,
  right: 24,
  bottom: 20,
}

/** Display value bounds (shared by load-time validation and setConfig). */
export const DISPLAY_SIZE_MIN = 32
export const DISPLAY_SIZE_MAX = 512
export const DISPLAY_INSET_MAX = 10_000

/** Everything persisted for the pet. */
export interface PetPersist {
  /** User-customizable pet display name. */
  name: string
  affinity: AffinityState
  /** Treat (小鱼干) stock ledger. */
  treats: TreatLedger
  display: PetDisplayConfig
}

/** Default pet name (used until the user renames the pet). */
export const DEFAULT_PET_NAME = '鲸鱼娘'

/** Name constraints. */
export const PET_NAME_MAX_LENGTH = 20

export function emptyPersist(): PetPersist {
  return {
    name: DEFAULT_PET_NAME,
    affinity: emptyAffinity(),
    treats: emptyTreatLedger(),
    display: { ...defaultDisplayConfig },
  }
}

/** Resolve the persistence directory ($DSH_HOME or ~/.dsh). */
export function petHomeDir(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** Numeric field guard: finite numbers only, else the fallback. */
function finiteNum(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Clamp one count/score into [0, max]. */
function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value))
}

/** Load persisted state; missing or corrupt files fall back to defaults. */
export function loadPetPersist(dir: string = petHomeDir()): PetPersist {
  try {
    const raw = readFileSync(join(dir, 'pet.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<PetPersist>
    const base = emptyPersist()
    const rawAffinity = (parsed.affinity ?? {}) as Partial<AffinityState>
    const affinity: AffinityState = {
      points: clamp(finiteNum(rawAffinity.points, 0), AFFINITY_MAX),
      lastPetAt: clamp(finiteNum(rawAffinity.lastPetAt, 0), Number.MAX_SAFE_INTEGER),
      lastFeedAt: clamp(finiteNum(rawAffinity.lastFeedAt, 0), Number.MAX_SAFE_INTEGER),
      pets: clamp(finiteNum(rawAffinity.pets, 0), Number.MAX_SAFE_INTEGER),
      feeds: clamp(finiteNum(rawAffinity.feeds, 0), Number.MAX_SAFE_INTEGER),
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
    }
    return {
      name: typeof parsed.name === 'string' && parsed.name.trim() !== ''
        ? parsed.name
        : base.name,
      affinity,
      treats,
      display,
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
