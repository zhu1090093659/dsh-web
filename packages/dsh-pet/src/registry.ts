/**
 * Pet registry — the multi-pet contract. One pet is a directory holding a
 * 'pet.json' manifest plus an atlas image; nothing else is required, and no
 * host or client code changes when a pet is added. The registry scans four
 * sources, later sources overriding earlier ones on an id collision:
 *
 *   1. the package's own 'assets' subdirectories (built-in pets);
 *   2. '${CODEX_HOME:-~/.codex}/pets' subdirectories (hatch-pet custom pets,
 *      legacy source kept readable);
 *   3. '$DSH_HOME/pets' subdirectories (the pet-center user directory);
 *   4. 'PetConfig.pets' manifests composed by the embedding application
 *      (highest precedence).
 *
 * Manifests are parsed through manifest-v2 (pet-center M2, issue #623): v1
 * manifests are compat-read as sprite2d, v2 manifests validate fail-closed,
 * and structured diagnostics ride alongside the legacy warnings. Live2d
 * entries (pet-center M3) list like any other pet: the entry carries the
 * validated live2d block plus the model's reference closure (the servable
 * set the asset route allows), and a model3.json that is unreadable or
 * declares unsafe references rejects the entry with an error diagnostic.
 *
 * The manifest follows the Codex/hatch-pet contract (8 columns x 9 rows of
 * 192x208 cells, the 9-state row order below). Legacy whale-girl manifests
 * that only carry 'frames' keep working: geometry, per-row frame counts and
 * per-track rhythm all fall back to the hatch-pet contract defaults, and the
 * whale-girl manifest overrides its own durations.
 * @module @linxin666/dsh-pet/registry
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ActivityPhase, PetAnimation } from './state.ts'
import { normalizePetRemarks, type PetRemarks, type PetRemarksManifest } from './remarks.ts'
import { mergeVoicePacks, normalizeVoicePack, type PetPanelView, type VoicePack } from './voice-pack.ts'
import { parseDecorationManifest } from './decoration.ts'
import { imageDimensions } from './image-dimensions.ts'
import { PET_DECORATION_API_VERSION, type DecorationView } from './contracts/status-decoration.ts'
import { dshHome } from './dsh-home.ts'
import { parsePetManifest, type PetManifestLive2d, type PetManifestV2, type PetRendererKind } from './manifest-v2.ts'
import { collectModel3References } from './model3.ts'
import { DEFAULT_PET_ID } from './defaults.ts'

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

/**
 * Default per-track rhythm — the shared slow baseline every sprite2d pet
 * plays unless its manifest overrides a track (user request: all pets were
 * too fast at the legacy hatch-pet contract pace).
 */
export const DEFAULT_TRACK_PATTERNS: Record<PetAnimation, {
  durations: number[]
  loop: boolean
  fallback?: PetAnimation
}> = {
  idle: { durations: [500, 500, 600, 500, 500, 600], loop: true },
  'running-right': { durations: [300, 300, 300, 300, 300, 300, 300, 400], loop: true },
  'running-left': { durations: [300, 300, 300, 300, 300, 300, 300, 400], loop: true },
  waving: { durations: [450, 450, 450, 450], loop: true },
  jumping: { durations: [400, 400, 400, 450, 450], loop: false, fallback: 'idle' },
  failed: { durations: [550, 550, 550, 600, 650, 700, 550, 550], loop: false, fallback: 'idle' },
  waiting: { durations: [550, 550, 600, 550, 550, 600], loop: true },
  running: { durations: [330, 330, 330, 330, 330, 400], loop: true },
  review: { durations: [650, 650, 650, 650, 650, 650], loop: true },
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
  /** Optional per-scene track sequences; every declared sequence has at least 5 items. */
  sequences?: Partial<Record<ActivityPhase, PetAnimation[]>>
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

/** The live2d renderer block as served to the browser half (pet-center M3). */
export interface PetLive2dDefinition {
  /** Browser URL of the .model3.json (served by the host asset route). */
  modelUrl: string
  /** Manifest-relative model path (host route allow-list key). */
  modelPath: string
  /** Scale multiplier over the canvas auto-fit, (0, 10]. */
  scale?: number
  /** Model offset in canvas px from the center-bottom anchor. */
  translate?: { x?: number; y?: number }
  /** ActivityPhase -> motion group; unmapped phases fall back to idle. */
  motions: Partial<Record<ActivityPhase, string>> & { idle: string }
  /** Optional ActivityPhase -> expression name layered over the motion. */
  expressions?: Partial<Record<ActivityPhase, string>>
  /** Hit area names triggering the tap motion; defaults to every model HitArea. */
  hitAreas?: string[]
}

/** A normalized pet as served to the browser half. */
export interface PetDefinition {
  id: string
  displayName: string
  description: string
  /** The renderer this entry mounts with (pet-center M2). */
  renderer: PetRendererKind
  /** Live2d render block; present exactly when renderer is 'live2d' (M3). */
  live2d?: PetLive2dDefinition
  /** Atlas cell size in px. */
  cell: PetCell
  /** Columns per row. */
  columns: number
  /** Per-row frame counts (length 9, row order above). */
  rows: number[]
  /** Total atlas rows (9 for v1, 11 for v2 look-row atlases). */
  atlasRows: number
  /** Fully resolved animation tracks (frames + durations + loop/fallback). */
  tracks: Record<PetAnimation, PetTrackDef>
  /** Validated per-scene track sequences; omitted scenes keep single-track playback. */
  sequences?: Partial<Record<ActivityPhase, PetAnimation[]>>
  /** Browser URL of the atlas (served by the host asset route). */
  atlasUrl: string
  /** Browser URL of the manifest (served by the host asset route). */
  manifestUrl: string
  /** Hover-panel chrome overrides (voice.json 'panel'; pet-center M4). */
  panel?: PetPanelView
}

/** A resolved pet plus its host-side file location. */
export interface PetEntry extends PetDefinition {
  /** Absolute directory holding the manifest and atlas. */
  dir: string
  /** Atlas path relative to 'dir' (declared by the manifest). */
  spritesheetPath: string
  /**
   * Manifest-relative files the asset route may serve beyond pet.json and
   * 'previews/*' (pet-center M3): the sprite2d atlas, or the live2d model
   * plus its model3.json reference closure.
   */
  servable: readonly string[]
  /** Normalized per-pet remark pools (manifest 'remarks'), when declared. */
  remarks?: PetRemarks
  /**
   * Normalized per-pet voice pack (the directory's voice.json; pet-center
   * M4). Host-side only — the browser half receives its 'panel' slice.
   */
  voice?: VoicePack
}

/** Registry load result: resolved entries plus load warnings. */
export interface PetRegistry {
  entries: PetEntry[]
  warnings: string[]
  /** Structured diagnostics from the manifest-v2 parse (superset detail of warnings). */
  diagnostics: PetRegistryDiagnostic[]
  byId(id: string): PetEntry | undefined
  /** The pet an installation falls back to when the selection is unknown. */
  defaultEntry(): PetEntry
  /**
   * The global voice override ('$DSH_HOME/pets/.voice.json'), when present —
   * layers under every per-pet pack and over the built-in pools (M4, #677).
   */
  globalVoice?: VoicePack
  /**
   * Status decorations (pet-center M5, #567): built-in 'assets/decorations'
   * entries overridden by same-id user entries under
   * '$DSH_HOME/pets/decorations'. Independent of the pet entries. Optional
   * so prebuilt test registries without decorations keep compiling.
   */
  decorations?: DecorationEntry[]
  /** Look up one decoration by id. */
  decorationById?(id: string): DecorationEntry | undefined
}

/** One resolved status decoration plus its host-side file location. */
export interface DecorationEntry extends DecorationView {
  /** Absolute directory holding the descriptor and strip. */
  dir: string
  /** Strip path relative to 'dir' (declared by the descriptor). */
  entryPath: string
  /** Descriptor-relative files the decoration asset route may serve. */
  servable: readonly string[]
  /** Asset license identifier (required by the descriptor). */
  license: string
}

/** One structured registry diagnostic (manifest-v2 era). */
export interface PetRegistryDiagnostic {
  level: 'error' | 'warning'
  /** Where the diagnostic originates (directory or file). */
  source: string
  message: string
}

/** Registry sources. */
export interface PetRegistryOptions {
  /** Absolute package root whose 'assets/*' hold built-in pets. */
  packageRoot: string
  /** Asset route prefix the browser URLs are built under. */
  assetPrefix?: string
  /** Custom pet directory (defaults to '${CODEX_HOME:-~/.codex}/pets'). */
  petsDir?: string
  /** Pet-center user directory (defaults to '$DSH_HOME/pets'; '' disables). */
  dshPetsDir?: string
  /** Extra manifest entries composed by the embedding application. */
  extra?: readonly PetManifest[]
}

/** Stable id charset: keeps asset URLs plain and filesystem-safe. */
const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** Safe path-segment charset for atlas files. */
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const PET_NAME_MAX_LENGTH = 80
const PET_PHASES: readonly ActivityPhase[] = ['idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed']

/** Validate optional scene sequences without rejecting an otherwise usable pet. */
function normalizeSequences(
  raw: unknown,
  id: string,
  warn: (message: string) => void,
): Partial<Record<ActivityPhase, PetAnimation[]>> | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    warn('manifest ' + id + ': sequences must be an object keyed by activity phase')
    return undefined
  }
  const sequences: Partial<Record<ActivityPhase, PetAnimation[]>> = {}
  for (const [phase, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!PET_PHASES.includes(phase as ActivityPhase)) {
      warn('manifest ' + id + ': unknown sequence phase ' + JSON.stringify(phase))
      continue
    }
    if (!Array.isArray(value) || value.length < 5) {
      warn('manifest ' + id + ': sequence ' + phase + ' must contain at least 5 animations')
      continue
    }
    const unknownIndex = value.findIndex(animation => typeof animation !== 'string' || !PET_ROW_ORDER.includes(animation as PetAnimation))
    if (unknownIndex !== -1) {
      const unknown = value[unknownIndex]
      warn('manifest ' + id + ': sequence ' + phase + ' contains unknown animation ' + JSON.stringify(unknown))
      continue
    }
    sequences[phase as ActivityPhase] = value as PetAnimation[]
  }
  return Object.keys(sequences).length === 0 ? undefined : sequences
}

/**
 * Build the fully resolved animation tracks from the contract defaults plus
 * optional per-track overrides. Shared by the sprite2d resolver and the
 * live2d entry builder (which fills the sprite fields with contract
 * defaults so the flat PetDefinition shape holds for every renderer).
 */
function buildTracks(
  rows: readonly number[],
  columns: number,
  trackOverrides: Partial<Record<PetAnimation, PetTrackOverride>>,
  warn: (message: string) => void,
): Record<PetAnimation, PetTrackDef> | undefined {
  const tracks = {} as Record<PetAnimation, PetTrackDef>
  for (const [row, animation] of PET_ROW_ORDER.entries()) {
    const pattern = DEFAULT_TRACK_PATTERNS[animation]
    const override = trackOverrides[animation]
    const durations = Array.isArray(override?.durations) && override.durations.length > 0
      ? override.durations.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
      : pattern.durations
    if (durations.length === 0) {
      warn('track ' + animation + ' carries no usable durations')
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
  return tracks
}

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
  // v2 atlases (spriteVersionNumber 2) hold 11 rows: 9 animation rows + 2 look rows.
  const atlasRowCount = source.spriteVersionNumber === 2 ? 11 : DEFAULT_PET_ROW_COUNT
  const rows = DEFAULT_FRAME_COUNTS.map((fallback, index) => {
    const value = Array.isArray(source.frames) ? source.frames[index] : undefined
    return finiteInt(value, fallback, columns)
  })
  const remarks = normalizePetRemarks(source.remarks, message => warn('manifest ' + id + ': ' + message))
  const sequences = normalizeSequences(source.sequences, id, warn)
  const trackOverrides = (typeof source.tracks === 'object' && source.tracks !== null ? source.tracks : {}) as Partial<Record<PetAnimation, PetTrackOverride>>
  const tracks = buildTracks(rows, columns, trackOverrides, message => warn('manifest ' + id + ': ' + message))
  if (tracks === undefined) return undefined
  const sheet = spritesheetPath.join('/')
  return {
    id,
    displayName,
    description,
    renderer: 'sprite2d' as const,
    cell,
    columns,
    rows,
    atlasRows: atlasRowCount,
    tracks,
    ...(sequences === undefined ? {} : { sequences }),
    atlasUrl: assetUrl(assetPrefix, id, spritesheet),
    manifestUrl: assetUrl(assetPrefix, id, 'pet.json'),
    dir,
    spritesheetPath: sheet,
    servable: [sheet],
    ...(remarks === undefined ? {} : { remarks }),
  }
}

/**
 * Adapt a validated v2 manifest's sprite2d block onto the legacy flat shape
 * the established resolver consumes (pet-center M2 P2). The legacy resolver
 * only expresses 9-row (default) and 11-row (spriteVersionNumber 2) atlases,
 * so other atlasRows values are rejected here with a diagnostic.
 */
function flattenV2Sprite2d(manifest: PetManifestV2): Record<string, unknown> | undefined {
  const block = manifest.sprite2d
  if (block === undefined) return undefined
  const legacy: Record<string, unknown> = {
    id: manifest.id,
    displayName: manifest.displayName,
    spritesheetPath: block.spritesheetPath,
  }
  if (manifest.description !== undefined) legacy.description = manifest.description
  if (block.cell !== undefined) legacy.cell = block.cell
  if (block.columns !== undefined) legacy.columns = block.columns
  if (block.frames !== undefined) legacy.frames = block.frames
  if (block.tracks !== undefined) legacy.tracks = block.tracks
  if (block.atlasRows !== undefined) {
    if (block.atlasRows === 11) legacy.spriteVersionNumber = 2
    else if (block.atlasRows !== DEFAULT_PET_ROW_COUNT) return undefined
  }
  if (manifest.sequences !== undefined) legacy.sequences = manifest.sequences
  if (manifest.remarks !== undefined) legacy.remarks = manifest.remarks
  return legacy
}

/**
 * Resolve a validated live2d manifest into a renderable entry (pet-center
 * M3). The model3.json is read at scan time: its reference closure becomes
 * the entry's servable set (the asset route's allow-list), and a model that
 * is unreadable or declares unsafe references rejects the entry fail-closed
 * with an error diagnostic. Closure files missing on disk warn but keep the
 * entry listed — the client renderer's diagnostic card reports the broken
 * render, matching the registry's never-throw philosophy (install-time
 * strictness belongs to the CLI validator). The sprite fields carry contract
 * defaults: the chrome sizes live2d pets off 'display.size', not the atlas.
 */
function resolveLive2dEntry(
  manifest: PetManifestV2,
  dir: string,
  options: { assetPrefix?: string; warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] },
): PetEntry | undefined {
  const assetPrefix = options.assetPrefix ?? '/pet'
  const record = (level: 'error' | 'warning', message: string): void => {
    options.diagnostics?.push({ level, source: dir, message })
    options.warnings?.push(message)
  }
  const block = manifest.live2d as PetManifestLive2d | undefined
  if (block === undefined) {
    record('error', 'pet ' + manifest.id + ': renderer live2d requires a live2d block')
    return undefined
  }
  const modelFile = join(dir, block.model)
  let model3: unknown
  try {
    // Stat guard before the read: a pathological model file — huge, or a
    // FIFO/device — is skipped with a warning instead of stalling the host
    // at scan time, mirroring the voice/decoration descriptor discipline.
    // The guard stays silent on stat errors, so a missing or unreadable
    // path is re-stat'ed here to fall through to the original fail-closed
    // 'not readable' diagnostic below.
    if (guardedScannedJsonStat(modelFile, options, 'live2d model ' + block.model, PET_SCAN_LIVE2D_MODEL_CAP) === undefined) {
      statSync(modelFile)
      return undefined
    }
    model3 = JSON.parse(readFileSync(modelFile, 'utf8'))
  } catch (error) {
    record('error', 'pet ' + manifest.id + ': live2d model ' + block.model + ' is not readable: '
      + (error instanceof Error ? error.message : String(error)))
    return undefined
  }
  const { references, errors } = collectModel3References(model3)
  if (errors.length > 0) {
    for (const message of errors) {
      record('error', 'pet ' + manifest.id + ': live2d model ' + block.model + ': ' + message)
    }
    return undefined
  }
  for (const reference of references) {
    if (!existsSync(join(dir, reference))) {
      record('warning', 'pet ' + manifest.id + ': live2d closure file missing: ' + reference)
    }
  }
  const tracks = buildTracks(DEFAULT_FRAME_COUNTS, DEFAULT_PET_COLUMNS, {}, message => record('warning', 'pet ' + manifest.id + ': ' + message))
  if (tracks === undefined) return undefined
  const remarks = normalizePetRemarks(manifest.remarks, message => record('warning', 'pet ' + manifest.id + ': ' + message))
  const modelUrl = assetUrl(assetPrefix, manifest.id, block.model)
  const live2d: PetLive2dDefinition = {
    modelUrl,
    modelPath: block.model,
    ...(block.scale === undefined ? {} : { scale: block.scale }),
    ...(block.translate === undefined ? {} : { translate: block.translate }),
    motions: block.motions,
    ...(block.expressions === undefined ? {} : { expressions: block.expressions }),
    ...(block.hitAreas === undefined ? {} : { hitAreas: block.hitAreas }),
  }
  return {
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description ?? '',
    renderer: 'live2d' as const,
    live2d,
    cell: { ...DEFAULT_PET_CELL },
    columns: DEFAULT_PET_COLUMNS,
    rows: [...DEFAULT_FRAME_COUNTS],
    atlasRows: DEFAULT_PET_ROW_COUNT,
    tracks,
    atlasUrl: modelUrl,
    manifestUrl: assetUrl(assetPrefix, manifest.id, 'pet.json'),
    dir,
    spritesheetPath: block.model,
    servable: [block.model, ...references],
    ...(remarks === undefined ? {} : { remarks }),
  }
}

/** Scan one directory of pet folders; entries come back in name order. */
function scanPetDir(dir: string, options: { assetPrefix?: string; warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] }): PetEntry[] {
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
    const parsed = readPetJson(manifestFile, options)
    if (parsed === undefined) continue
    const entryDir = join(dir, name)
    const verdict = parsePetManifest(parsed, entryDir)
    for (const diagnostic of verdict.diagnostics) {
      options.diagnostics?.push({ level: diagnostic.level, source: entryDir, message: diagnostic.message })
      options.warnings?.push(diagnostic.message)
    }
    if (!verdict.ok) continue
    let entry: PetEntry | undefined
    if (verdict.manifest.renderer === 'live2d') {
      entry = resolveLive2dEntry(verdict.manifest, entryDir, options)
    } else {
      const legacy = flattenV2Sprite2d(verdict.manifest)
      if (legacy === undefined) {
        const note = 'pet ' + verdict.manifest.id + ': sprite2d.atlasRows only supports 9 or 11 under the v1 compat resolver'
        options.diagnostics?.push({ level: 'error', source: entryDir, message: note })
        options.warnings?.push(note)
        continue
      }
      entry = resolvePetManifest(legacy, entryDir, options)
    }
    if (entry === undefined) continue
    // Optional voice pack (voice.json) — pure content, warn-and-drop (M4).
    const voice = loadVoicePackFile(join(entryDir, 'voice.json'), options)
    entries.push({ ...entry, ...(voice === undefined ? {} : { voice }) })
  }
  return entries
}

/**
 * Read and parse one pet.json manifest; undefined (warning recorded) on
 * failure. The descriptor stat guard applies first: a pathological file —
 * huge, or a FIFO/device — is skipped with a warning instead of stalling
 * or OOM-ing the host at scan time (same discipline as voice/decoration).
 */
function readPetJson(
  file: string,
  options: { warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] },
): unknown {
  if (guardedScannedJsonStat(file, options, 'pet manifest') === undefined) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    options.warnings?.push('skipping ' + file + ': ' + (error instanceof Error ? error.message : String(error)))
    return undefined
  }
}

/**
 * Scan-time read ceiling for user-authored JSON descriptors (voice.json,
 * .voice.json, decoration.json): the registry reads these synchronously at
 * plugin startup, and a pathological file — multi-GB, or a FIFO/device
 * symlink — must not hang or exhaust the host before the warn-and-drop
 * discipline can apply (review-spd follow-up, pet-center M4/M5).
 */
export const PET_SCAN_JSON_CAP = 64 * 1024

/**
 * Scan-time read ceiling for a live2d model3.json, matching the asset
 * route's model cap (PET_ASSET_CAPS.model). Model descriptors are far
 * larger than the other scanned JSON, but a pathological file — huge, or a
 * FIFO/device — must still be skipped with a warning instead of stalling
 * or OOM-ing the host at plugin startup (same review-spd follow-up).
 */
export const PET_SCAN_LIVE2D_MODEL_CAP = 32 * 1024 * 1024

/**
 * Stat one scanned JSON descriptor with a regular-file + size guard, so a
 * pathological user file is skipped with a warning instead of stalling or
 * OOM-ing the host at startup. Returns the Stats, or undefined when the
 * caller must skip the file (a warning was recorded). 'cap' defaults to
 * the descriptor ceiling (PET_SCAN_JSON_CAP); model descriptors pass the
 * larger live2d ceiling.
 */
function guardedScannedJsonStat(
  file: string,
  options: { warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] },
  what: string,
  cap: number = PET_SCAN_JSON_CAP,
): ReturnType<typeof statSync> | undefined {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(file)
  } catch {
    return undefined
  }
  const warn = (message: string): void => {
    options.warnings?.push(file + ': ' + message)
    options.diagnostics?.push({ level: 'warning', source: file, message: file + ': ' + message })
  }
  if (!st.isFile()) {
    warn(what + ' is not a regular file; ignored')
    return undefined
  }
  if (st.size > cap) {
    warn(what + ' exceeds the ' + cap + '-byte scan ceiling; ignored')
    return undefined
  }
  return st
}

/**
 * Load and normalize one optional voice.json (pet-center M4). A missing
 * file is silent; a broken file warns and drops. The pack is pure content,
 * so every issue stays a warning — a bad voice.json never rejects a pet.
 */
function loadVoicePackFile(
  file: string,
  options: { warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] },
): VoicePack | undefined {
  if (!existsSync(file)) return undefined
  if (guardedScannedJsonStat(file, options, 'voice pack') === undefined) return undefined
  const warn = (message: string): void => {
    options.warnings?.push(file + ': ' + message)
    options.diagnostics?.push({ level: 'warning', source: file, message: file + ': ' + message })
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    warn('voice pack is not valid JSON; ignored: ' + (error instanceof Error ? error.message : String(error)))
    return undefined
  }
  return normalizeVoicePack(raw, warn)
}

/** Decoration asset URL prefix (served by the decoration route, M5). */
export const DECORATION_ASSET_PREFIX = '/api/pet/decoration'

/** Read the pixel dimensions of a decoration strip (PNG/WebP), if decodable. */
function readImageDimensions(file: string): { width: number; height: number } | undefined {
  let header: Buffer
  try {
    // Only the header is needed for dimensions; cap the read so a huge or
    // corrupt strip cannot balloon memory during the registry scan.
    const fd = openSync(file, 'r')
    try {
      header = Buffer.alloc(64)
      const read = readSync(fd, header, 0, header.length, 0)
      if (read < 0) return undefined
      header = header.subarray(0, read)
    } finally {
      closeSync(fd)
    }
  } catch {
    return undefined
  }
  return imageDimensions(header)
}

/**
 * Scan one directory of decoration folders ('decoration.json' + strip).
 * Later scans override earlier ones on id collision; a bad descriptor warns
 * and skips — the never-throw philosophy holds for decorations too (M5).
 */
function scanDecorationDir(dir: string, options: { warnings?: string[]; diagnostics?: PetRegistryDiagnostic[] }): DecorationEntry[] {
  if (!existsSync(dir)) return []
  let names: string[] = []
  try {
    names = readdirSync(dir).filter(name => !name.startsWith('.'))
  } catch {
    return []
  }
  names.sort()
  const entries: DecorationEntry[] = []
  for (const name of names) {
    const entryDir = join(dir, name)
    const manifestFile = join(entryDir, 'decoration.json')
    if (!existsSync(manifestFile)) continue
    if (guardedScannedJsonStat(manifestFile, options, 'decoration descriptor') === undefined) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(manifestFile, 'utf8'))
    } catch (error) {
      const message = 'skipping ' + manifestFile + ': ' + (error instanceof Error ? error.message : String(error))
      options.warnings?.push(message)
      options.diagnostics?.push({ level: 'error', source: entryDir, message })
      continue
    }
    const verdict = parseDecorationManifest(raw, manifestFile)
    for (const diagnostic of verdict.diagnostics) {
      options.diagnostics?.push({ level: diagnostic.level, source: entryDir, message: diagnostic.message })
      options.warnings?.push(diagnostic.message)
    }
    if (!verdict.ok) continue
    const manifest = verdict.manifest
    // A missing strip keeps the entry listed (mirroring the live2d closure
    // discipline) but earns a diagnostic: the ornament will silently render
    // nothing, and the warning names the file to fix.
    if (!existsSync(join(entryDir, manifest.entry))) {
      const message = 'decoration ' + manifest.id + ': strip file missing: ' + manifest.entry
      options.warnings?.push(message)
      options.diagnostics?.push({ level: 'warning', source: entryDir, message })
    } else {
      // Geometry check: the client renders the strip as a single row of
      // 'columns' frames (background-position advances by frame width only),
      // so the strip must be exactly cell.width * columns wide and cell.height
      // tall. A mismatched strip silently shows the wrong/partial frames —
      // warn-and-keep, mirroring the missing-strip discipline (never throw).
      const actual = readImageDimensions(join(entryDir, manifest.entry))
      if (actual !== undefined) {
        const expectedWidth = manifest.cell.width * manifest.columns
        if (actual.width !== expectedWidth || actual.height !== manifest.cell.height) {
          const message = 'decoration ' + manifest.id + ': strip ' + actual.width + 'x' + actual.height
            + ' does not match cell ' + manifest.cell.width + 'x' + manifest.cell.height + ' x ' + manifest.columns
            + ' columns (expected ' + expectedWidth + 'x' + manifest.cell.height + '); frames will render wrong'
          options.warnings?.push(message)
          options.diagnostics?.push({ level: 'warning', source: entryDir, message })
        }
      }
    }
    entries.push({
      apiVersion: PET_DECORATION_API_VERSION,
      id: manifest.id,
      dir: entryDir,
      entryPath: manifest.entry,
      servable: ['decoration.json', manifest.entry],
      license: manifest.license,
      assetBase: DECORATION_ASSET_PREFIX + '/' + encodeURIComponent(manifest.id),
      entryUrl: DECORATION_ASSET_PREFIX + '/' + encodeURIComponent(manifest.id) + '/' + manifest.entry,
      cell: manifest.cell,
      columns: manifest.columns,
      durations: manifest.durations,
      loop: manifest.loop,
      phases: manifest.phases,
    })
  }
  return entries
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
  const diagnostics: PetRegistryDiagnostic[] = []
  const byId = new Map<string, PetEntry>()
  const builtinIds = new Set<string>()

  for (const entry of scanPetDir(join(packageRoot, 'assets'), { assetPrefix, warnings, diagnostics })) {
    if (byId.has(entry.id)) {
      warnings.push('duplicate built-in pet id ' + entry.id + '; the first one wins')
      continue
    }
    byId.set(entry.id, entry)
    builtinIds.add(entry.id)
  }

  const petsDir = options.petsDir ?? codexPetsDir()
  if (petsDir !== '') {
    for (const entry of scanPetDir(petsDir, { assetPrefix, warnings, diagnostics })) {
      if (byId.has(entry.id)) warnings.push('custom pet ' + entry.id + ' overrides the built-in one')
      byId.set(entry.id, entry)
    }
  }

  // The pet-center user directory ranks above the legacy hatch-pet source.
  const dshPetsDir = options.dshPetsDir ?? join(dshHome(), 'pets')
  let globalVoice: VoicePack | undefined
  if (dshPetsDir !== '') {
    for (const entry of scanPetDir(dshPetsDir, { assetPrefix, warnings, diagnostics })) {
      if (byId.has(entry.id)) warnings.push('user pet ' + entry.id + ' overrides an earlier registration')
      byId.set(entry.id, entry)
    }
    // The global voice override layers under every per-pet pack (M4, #677).
    globalVoice = loadVoicePackFile(join(dshPetsDir, '.voice.json'), { warnings, diagnostics })
  }

  for (const manifest of options.extra ?? []) {
    const raw = manifest.spritesheetPath
    const dir = raw === undefined || isAbsolute(raw)
      ? join(packageRoot, 'assets', 'extra')
      : dirname(resolve(packageRoot, raw))
    // petAtlasFile joins entry.dir (already the spritesheet's parent when the
    // path is package-relative) with entry.spritesheetPath, so the stored path
    // must be the basename only — otherwise the directory segment is applied
    // twice and the atlas 404s.
    const source = raw === undefined || isAbsolute(raw)
      ? manifest
      : { ...manifest, spritesheetPath: basename(raw) }
    const entry = resolvePetManifest(source, dir, { assetPrefix, warnings })
    if (entry === undefined) continue
    if (byId.has(entry.id)) warnings.push('composed pet ' + entry.id + ' overrides an earlier registration')
    byId.set(entry.id, entry)
  }

  // Status decorations (pet-center M5, #567): built-in entries first,
  // then same-id user entries under '$DSH_HOME/pets/decorations' override.
  const decorationById = new Map<string, DecorationEntry>()
  for (const entry of scanDecorationDir(join(packageRoot, 'assets', 'decorations'), { warnings, diagnostics })) {
    decorationById.set(entry.id, entry)
  }
  if (dshPetsDir !== '') {
    for (const entry of scanDecorationDir(join(dshPetsDir, 'decorations'), { warnings, diagnostics })) {
      if (decorationById.has(entry.id)) {
        warnings.push('user decoration ' + entry.id + ' overrides the built-in one')
      }
      decorationById.set(entry.id, entry)
    }
  }

  const entries = [...byId.values()]
  const decorations = [...decorationById.values()]
  return {
    entries,
    warnings,
    diagnostics,
    byId: (id: string) => byId.get(id),
    defaultEntry: () => entries.find(entry => (
      entry.id === DEFAULT_PET_ID && builtinIds.has(entry.id)
    )) ?? entries.find(entry => builtinIds.has(entry.id)) ?? entries[0]!,
    ...(globalVoice === undefined ? {} : { globalVoice }),
    decorations,
    decorationById: (id: string) => decorationById.get(id),
  }
}

/** The built-in default decoration id (M5): the first reference ornament. */
export const DEFAULT_DECORATION_ID = 'whale'

/** Strip host-only fields, leaving the browser-visible decoration view. */
export function decorationView(entry: DecorationEntry): DecorationView {
  return {
    apiVersion: PET_DECORATION_API_VERSION,
    id: entry.id,
    assetBase: entry.assetBase,
    entryUrl: entry.entryUrl,
    cell: entry.cell,
    columns: entry.columns,
    durations: entry.durations,
    loop: entry.loop,
    phases: entry.phases,
  }
}

/**
 * Strip host-only fields, leaving the client-visible definition. When the
 * registry carries a global voice pack, its panel chrome layers under the
 * entry's own pack (per-slot merge, pet > global), mirroring the voice-pool
 * layering (pet-center M4, issue #677).
 */
export function petEntryView(entry: PetEntry, globalVoice?: VoicePack): PetDefinition {
  const panel = globalVoice === undefined
    ? entry.voice?.panel
    : mergeVoicePacks(globalVoice, entry.voice)?.panel
  return {
    id: entry.id,
    displayName: entry.displayName,
    description: entry.description,
    renderer: entry.renderer,
    ...(entry.live2d === undefined ? {} : { live2d: entry.live2d }),
    cell: entry.cell,
    columns: entry.columns,
    rows: entry.rows,
    atlasRows: entry.atlasRows,
    tracks: entry.tracks,
    ...(entry.sequences === undefined ? {} : { sequences: entry.sequences }),
    atlasUrl: entry.atlasUrl,
    manifestUrl: entry.manifestUrl,
    ...(panel === undefined ? {} : { panel }),
  }
}

/** The absolute file a pet's atlas resolves to (host asset route). */
export function petAtlasFile(entry: PetEntry): string {
  return join(entry.dir, entry.spritesheetPath)
}

