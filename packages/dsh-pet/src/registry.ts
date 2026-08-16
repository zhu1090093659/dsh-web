/**
 * Pet registry — the multi-pet contract. One pet is a directory holding a
 * 'pet.json' manifest plus an atlas image; nothing else is required, and no
 * host or client code changes when a pet is added. The registry scans three
 * sources, later sources overriding earlier ones on an id collision:
 *
 *   1. the package's own 'assets' subdirectories (built-in pets);
 *   2. '${CODEX_HOME:-~/.codex}/pets' subdirectories (hatch-pet custom pets);
 *   3. 'PetConfig.pets' manifests composed by the embedding application
 *      (highest precedence).
 *
 * The manifest follows the Codex/hatch-pet contract (8 columns x 9 rows of
 * 192x208 cells, the 9-state row order below). Legacy whale-girl manifests
 * that only carry 'frames' keep working: geometry, per-row frame counts and
 * per-track rhythm all fall back to the hatch-pet contract defaults, and the
 * whale-girl manifest overrides its own durations.
 * @module @linxin666/dsh-pet/registry
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PetAnimation } from './state.ts'
import { normalizePetRemarks, type PetRemarks, type PetRemarksManifest } from './remarks.ts'

/** Fixed row order of the 9-state animation contract. */
export const PET_ROW_ORDER: readonly PetAnimation[] = [
  'idle',
  'running-right',
  'running-left',
  'waving',
  'jumping',
  'failed',
  'waiting',
  'running',
  'review',
]

/** Atlas cell size in px. */
export interface PetCell {
  width: number
  height: number
}

/** Atlas cell size in px (Codex/hatch-pet contract). */
export const DEFAULT_PET_CELL: PetCell = { width: 192, height: 208 }
/** Columns per row (max frames per track). */
export const DEFAULT_PET_COLUMNS = 8
/** Rows in the atlas (fixed by the animation contract). */
export const DEFAULT_PET_ROW_COUNT = 9

/**
 * Per-row used-column counts from the hatch-pet contract table. Manifests
 * that carry no 'frames' field (the Codex custom-pet shape) resolve here.
 */
export const DEFAULT_FRAME_COUNTS: readonly number[] = [6, 8, 8, 4, 5, 8, 6, 6, 6]

/** Absolute package root, resolved from a module URL (lib/ or src/). */
export function petPackageRoot(importMetaUrl: string): string {
  return fileURLToPath(new URL('../', importMetaUrl))
}

/** Resolve the hatch-pet custom pets directory (CODEX_HOME or ~/.codex). */
export function codexPetsDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const raw = env.CODEX_HOME !== undefined && env.CODEX_HOME.trim() !== ''
    ? env.CODEX_HOME.trim()
    : join(home, '.codex')
  const expanded = raw === '~'
    ? home
    : (raw.startsWith('~/') || raw.startsWith('~\\')) ? join(home, raw.slice(2)) : raw
  return join(expanded, 'pets')
}

/** Finite non-negative integer guard, else the fallback. */
function finiteInt(value: unknown, fallback: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : fallback
}

/** Build the browser URL of one pet asset. */
function assetUrl(prefix: string, id: string, file: string): string {
  const path = file.split('/').filter(segment => segment !== '').join('/')
  return prefix + '/' + encodeURIComponent(id) + '/' + path
}

/** One animation track as served to the browser half. */
export interface PetTrackDef {
  /** Frame indices (columns) played in order. */
  frames: number[]
  /** Per-frame duration in ms; same length as frames. */
  durations: number[]
  /** Whether the track loops; a non-looping track holds its last frame. */
  loop: boolean
  /** Track to switch to after a non-looping track finishes. */
  fallback?: PetAnimation
}

/** Default per-track rhythm (hatch-pet contract table). */
export const DEFAULT_TRACK_PATTERNS: Record<PetAnimation, {
  durations: number[]
  loop: boolean
  fallback?: PetAnimation
}> = {
  idle: { durations: [280, 110, 110, 140, 140, 320], loop: true },
  'running-right': { durations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  'running-left': { durations: [120, 120, 120, 120, 120, 120, 120, 220], loop: true },
  waving: { durations: [140, 140, 140, 280], loop: true },
  jumping: { durations: [140, 140, 140, 140, 280], loop: false, fallback: 'idle' },
  failed: { durations: [140, 140, 140, 140, 140, 140, 140, 240], loop: false, fallback: 'idle' },
  waiting: { durations: [150, 150, 150, 150, 150, 260], loop: true },
  running: { durations: [120, 120, 120, 120, 120, 220], loop: true },
  review: { durations: [150, 150, 150, 150, 150, 280], loop: true },
}

/** Manifest shape a pet directory (or 'PetConfig.pets' entry) declares. */
export interface PetManifest {
  /** Unique pet id, lowercase kebab-case. */
  id: string
  /** Human-readable display name (settings selector, panel header). */
  displayName: string
  /** One-line description. */
  description?: string
  /** Atlas path relative to the manifest's directory. */
  spritesheetPath: string
  /** Atlas cell size; defaults to the Codex contract 192x208. */
  cell?: { width?: number; height?: number }
  /** Columns per row; defaults to 8. */
  columns?: number
  /**
   * Per-row frame counts (9 entries, row order above). Manifests that omit
   * it resolve the hatch-pet contract table.
   */
  frames?: number[]
  /** Optional per-track rhythm overrides; omitted tracks use the defaults. */
  tracks?: Partial<Record<PetAnimation, PetTrackOverride>>
  /**
   * Optional witty-remark overrides the pet speaks on interactions
   * (community contributions use this to give their pet its own voice).
   * Each slot accepts one line or a pool of lines; a slot replaces the
   * built-in default pool for that slot only.
   */
  remarks?: PetRemarksManifest
}

/** Per-track rhythm overrides a manifest may carry. */
export interface PetTrackOverride {
  /** Per-frame durations in ms (cycled to the row's frame count). */
  durations?: number[]
  /** Whether the track loops. */
  loop?: boolean
  /** Track to switch to after a non-looping track finishes. */
  fallback?: PetAnimation
}

/** A normalized pet as served to the browser half. */
export interface PetDefinition {
  id: string
  displayName: string
  description: string
  /** Atlas cell size in px. */
  cell: PetCell
  /** Columns per row. */
  columns: number
  /** Per-row frame counts (length 9, row order above). */
  rows: number[]
  /** Fully resolved animation tracks (frames + durations + loop/fallback). */
  tracks: Record<PetAnimation, PetTrackDef>
  /** Browser URL of the atlas (served by the host asset route). */
  atlasUrl: string
  /** Browser URL of the manifest (served by the host asset route). */
  manifestUrl: string
}

/** A resolved pet plus its host-side file location. */
export interface PetEntry extends PetDefinition {
  /** Absolute directory holding the manifest and atlas. */
  dir: string
  /** Atlas path relative to 'dir' (declared by the manifest). */
  spritesheetPath: string
  /** Normalized per-pet remark pools (manifest 'remarks'), when declared. */
  remarks?: PetRemarks
}

/** Registry load result: resolved entries plus load warnings. */
export interface PetRegistry {
  entries: PetEntry[]
  warnings: string[]
  byId(id: string): PetEntry | undefined
  /** The pet an installation falls back to when the selection is unknown. */
  defaultEntry(): PetEntry
}

/** Registry sources. */
export interface PetRegistryOptions {
  /** Absolute package root whose 'assets/*' hold built-in pets. */
  packageRoot: string
  /** Asset route prefix the browser URLs are built under. */
  assetPrefix?: string
  /** Custom pet directory (defaults to '${CODEX_HOME:-~/.codex}/pets'). */
  petsDir?: string
  /** Extra manifest entries composed by the embedding application. */
  extra?: readonly PetManifest[]
}

/** Stable id charset: keeps asset URLs plain and filesystem-safe. */
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** Safe path-segment charset for atlas files. */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const PET_NAME_MAX_LENGTH = 80

/**
 * Normalize one parsed manifest into a renderable pet entry, or undefined
 * (with a warning recorded) when the manifest violates the contract.
 */
export function resolvePetManifest(
  raw: unknown,
  dir: string,
  options: { assetPrefix?: string; warnings?: string[] } = {},
): PetEntry | undefined {
  const { assetPrefix = '/pet', warnings = [] } = options
  const warn = (message: string): void => { warnings.push(message) }
  if (typeof raw !== 'object' || raw === null) {
    warn('manifest is not an object')
    return undefined
  }
  const source = raw as Record<string, unknown>
  const id = typeof source.id === 'string' ? source.id.trim() : ''
  if (!PET_ID_PATTERN.test(id)) {
    warn('manifest id ' + JSON.stringify(String(source.id)) + ' is not a lowercase kebab id')
    return undefined
  }
  const displayName = typeof source.displayName === 'string' && source.displayName.trim() !== ''
    ? source.displayName.trim().slice(0, PET_NAME_MAX_LENGTH)
    : id
  const description = typeof source.description === 'string'
    ? source.description.trim()
    : ''
  const spritesheet = typeof source.spritesheetPath === 'string' && source.spritesheetPath.trim() !== ''
    ? source.spritesheetPath.trim()
    : 'spritesheet.webp'
  const spritesheetPath = spritesheet.split('/').filter(segment => segment !== '')
  if (
    spritesheetPath.length === 0
    || isAbsolute(spritesheet)
    || spritesheet.includes('\\')
    || spritesheetPath.some(segment => segment === '..' || !PATH_SEGMENT_PATTERN.test(segment))
  ) {
    warn('manifest spritesheetPath ' + JSON.stringify(spritesheet) + ' is not a safe relative path')
    return undefined
  }
  const rawCell = (typeof source.cell === 'object' && source.cell !== null ? source.cell : {}) as Record<string, unknown>
  const cell = {
    width: finiteInt(rawCell.width, DEFAULT_PET_CELL.width, 2048),
    height: finiteInt(rawCell.height, DEFAULT_PET_CELL.height, 2048),
  }
  const columns = finiteInt(source.columns, DEFAULT_PET_COLUMNS, 32)
  const rows = DEFAULT_FRAME_COUNTS.map((fallback, index) => {
    const value = Array.isArray(source.frames) ? source.frames[index] : undefined
    return finiteInt(value, fallback, columns)
  })
  const remarks = normalizePetRemarks(source.remarks, message => warn('manifest ' + id + ': ' + message))
  const trackOverrides = (typeof source.tracks === 'object' && source.tracks !== null ? source.tracks : {}) as Partial<Record<PetAnimation, PetTrackOverride>>
  const tracks = {} as Record<PetAnimation, PetTrackDef>
  for (const [row, animation] of PET_ROW_ORDER.entries()) {
    const pattern = DEFAULT_TRACK_PATTERNS[animation]
    const override = trackOverrides[animation]
    const durations = Array.isArray(override?.durations) && override.durations.length > 0
      ? override.durations.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
      : pattern.durations
    if (durations.length === 0) {
      warn('manifest ' + id + ': track ' + animation + ' carries no usable durations')
      return undefined
    }
    const frameCount = Math.max(1, Math.min(rows[row]!, columns))
    const sized = durations.length >= frameCount
      ? durations.slice(0, frameCount)
      : Array.from({ length: frameCount }, (_, index) => durations[index % durations.length]!)
    tracks[animation] = {
      frames: Array.from({ length: frameCount }, (_, index) => index),
      durations: sized,
      loop: typeof override?.loop === 'boolean' ? override.loop : pattern.loop,
      ...(override?.fallback === undefined
        ? pattern.fallback === undefined ? {} : { fallback: pattern.fallback }
        : PET_ROW_ORDER.includes(override.fallback)
          ? { fallback: override.fallback }
          : pattern.fallback === undefined ? {} : { fallback: pattern.fallback }),
    }
  }
  return {
    id,
    displayName,
    description,
    cell,
    columns,
    rows,
    tracks,
    atlasUrl: assetUrl(assetPrefix, id, spritesheet),
    manifestUrl: assetUrl(assetPrefix, id, 'pet.json'),
    dir,
    spritesheetPath: spritesheetPath.join('/'),
    ...(remarks === undefined ? {} : { remarks }),
  }
}

/** Scan one directory of pet folders; entries come back in name order. */
function scanPetDir(dir: string, options: { assetPrefix?: string; warnings?: string[] }): PetEntry[] {
  if (!existsSync(dir)) return []
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(name => !name.startsWith('.'))
  } catch {
    return []
  }
  names.sort()
  const entries: PetEntry[] = []
  for (const name of names) {
    const manifestFile = join(dir, name, 'pet.json')
    if (!existsSync(manifestFile)) continue
    const parsed = readPetJson(manifestFile, options.warnings)
    if (parsed === undefined) continue
    const entry = resolvePetManifest(parsed, join(dir, name), options)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** Read and parse one manifest file; undefined (warning recorded) on failure. */
function readPetJson(file: string, warnings: string[] | undefined): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    warnings?.push('skipping ' + file + ': ' + (error instanceof Error ? error.message : String(error)))
    return undefined
  }
}

/**
 * Load the pet registry: built-in 'assets/*' first, then the hatch-pet
 * custom pets directory, then composed 'extra' manifests (each later source
 * overrides an earlier one on id collision). The registry never throws on a
 * bad manifest: it skips it and records a warning.
 */
export function loadPetRegistry(options: PetRegistryOptions): PetRegistry {
  const { packageRoot, assetPrefix = '/pet' } = options
  const warnings: string[] = []
  const byId = new Map<string, PetEntry>()
  const builtinIds = new Set<string>()

  for (const entry of scanPetDir(join(packageRoot, 'assets'), { assetPrefix, warnings })) {
    if (byId.has(entry.id)) {
      warnings.push('duplicate built-in pet id ' + entry.id + '; the first one wins')
      continue
    }
    byId.set(entry.id, entry)
    builtinIds.add(entry.id)
  }

  const petsDir = options.petsDir ?? codexPetsDir()
  if (petsDir !== '') {
    for (const entry of scanPetDir(petsDir, { assetPrefix, warnings })) {
      if (byId.has(entry.id)) warnings.push('custom pet ' + entry.id + ' overrides the built-in one')
      byId.set(entry.id, entry)
    }
  }

  for (const manifest of options.extra ?? []) {
    const dir = manifest.spritesheetPath === undefined || isAbsolute(manifest.spritesheetPath)
      ? join(packageRoot, 'assets', 'extra')
      : dirname(resolve(packageRoot, manifest.spritesheetPath))
    const entry = resolvePetManifest(manifest, dir, { assetPrefix, warnings })
    if (entry === undefined) continue
    if (byId.has(entry.id)) warnings.push('composed pet ' + entry.id + ' overrides an earlier registration')
    byId.set(entry.id, entry)
  }

  const entries = [...byId.values()]
  return {
    entries,
    warnings,
    byId: (id: string) => byId.get(id),
    defaultEntry: () => entries.find(entry => builtinIds.has(entry.id)) ?? entries[0]!,
  }
}

/** Strip host-only fields, leaving the client-visible definition. */
export function petEntryView(entry: PetEntry): PetDefinition {
  return {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    cell: entry.cell,
    columns: entry.columns,
    rows: entry.rows,
    tracks: entry.tracks,
    atlasUrl: entry.atlasUrl,
    manifestUrl: entry.manifestUrl,
  }
}

/** The absolute file a pet's atlas resolves to (host asset route). */
export function petAtlasFile(entry: PetEntry): string {
  return join(entry.dir, entry.spritesheetPath)
}

/** The directory basename of one entry (legacy asset URL alias, e.g. whale). */
export function petDirAlias(entry: PetEntry): string {
  return basename(entry.dir)
}


