/**
 * Pet manifest v2 — parsing, fail-closed validation, and the v1 compat read
 * (issue #623, milestone M1/M2). This module is the single entry point every
 * manifest parse flows through: manifests without 'petManifestVersion' are
 * compat-read as v1 sprite2d pets (with a migration hint diagnostic), v2
 * manifests are validated fail-closed (unknown top-level keys, unknown
 * renderer kinds, missing conditional blocks and unsafe paths all reject the
 * manifest with human-readable diagnostics).
 *
 * Discipline split: STRUCTURE is fail-closed (types, key sets, paths,
 * required fields); CONTENT stays warn-and-drop (a bad sequence entry drops
 * the entry, never the pet) — matching the registry's long-standing
 * never-throw philosophy. Deep normalization of sequences/remarks stays with
 * the registry's existing normalizers; this module only gates structure.
 *
 * The JSON Schema twin lives at contracts/pet-manifest-v2.schema.json for
 * documentation, the CLI, and external tooling; the hand-rolled validator
 * here is authoritative (the repository ships no schema-validator runtime).
 *
 * This file is imported directly by scripts/ (dsh-pet-migrate-v2) under
 * node's strip-only TypeScript mode: keep it erasable-syntax-only (no
 * parameter properties, enums, or namespaces).
 * @module @linxin666/dsh-pet/manifest-v2
 */

import { isAbsolute } from 'node:path'
import type { ActivityPhase, PetAnimation } from './state.ts'

/** Schema version this module validates. */
export const PET_MANIFEST_V2 = 2 as const

/** Renderer kinds the pet center knows how to dispatch (M1 §2). */
export const PET_RENDERER_KINDS = ['sprite2d', 'live2d'] as const
export type PetRendererKind = (typeof PET_RENDERER_KINDS)[number]

/** The seven ActivityPhase semantics (pet-center owned; M1 §1). */
export const PET_ACTIVITY_PHASES: readonly ActivityPhase[] = [
  'idle', 'waiting', 'thinking', 'tool', 'review', 'done', 'failed',
]

/** sprite2d renderer block (v2 nested shape of the v1 atlas contract). */
export interface PetManifestSprite2d {
  /** Atlas path relative to the manifest directory (safe segments only). */
  spritesheetPath: string
  /** Atlas cell size in px; defaults resolved by the registry. */
  cell?: { width?: number; height?: number }
  /** Columns per row; defaults to 8. */
  columns?: number
  /** Total atlas rows (9 classic; 11 for v2 look-row atlases). */
  atlasRows?: number
  /** Per-row used frame counts. */
  frames?: number[]
  /** Per-track rhythm overrides (durations/loop/fallback), v1 shape. */
  tracks?: Record<string, unknown>
}

/** live2d renderer block (Cubism Core is always user-supplied; M1 §0). */
export interface PetManifestLive2d {
  /** Path of the .model3.json relative to the manifest directory. */
  model: string
  /** Model scale, (0, 10]; defaults to 1. */
  scale?: number
  /** Model offset in canvas space. */
  translate?: { x?: number; y?: number }
  /** ActivityPhase -> motion group name; idle is required, unmapped phases fall back to idle. */
  motions: Partial<Record<ActivityPhase, string>> & { idle: string }
  /** Optional ActivityPhase -> expression name layered over the motion. */
  expressions?: Partial<Record<ActivityPhase, string>>
  /** Hit area names triggering pet.interact; defaults to every model HitArea. */
  hitAreas?: string[]
  /** Whisper-paced lip sync (post-M3). */
  lipSync?: boolean
}

/** Normalized v2 manifest the registry consumes. */
export interface PetManifestV2 {
  petManifestVersion: typeof PET_MANIFEST_V2
  id: string
  displayName: string
  description?: string
  version?: string
  author?: string
  /** Required by v2; v1 compat reads may lack it (warning, not rejection). */
  license?: string
  homepage?: string
  renderer: PetRendererKind
  sprite2d?: PetManifestSprite2d
  live2d?: PetManifestLive2d
  sequences?: Partial<Record<ActivityPhase, PetAnimation[]>>
  /** Pass-through for the registry's remarks normalizer (v1 shape). */
  remarks?: unknown
}

/** One structured diagnostic emitted while parsing a manifest. */
export interface PetManifestDiagnostic {
  level: 'error' | 'warning'
  message: string
}

/** Parse outcome: a usable manifest plus diagnostics, or rejection. */
export type PetManifestParse =
  | { ok: true; manifest: PetManifestV2; migrated: 'v1-compat' | undefined; diagnostics: PetManifestDiagnostic[] }
  | { ok: false; diagnostics: PetManifestDiagnostic[] }

const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
/**
 * Field allow-lists mirroring contracts/pet-manifest-v2.schema.json. Exported
 * so the drift test can lock the schema file and this validator together;
 * the CLI reuses parsePetManifest instead of these.
 */
export const KNOWN_TOP_LEVEL = new Set([
  '$schema', 'petManifestVersion', 'id', 'displayName', 'description', 'version',
  'author', 'license', 'homepage', 'renderer', 'sprite2d', 'live2d', 'sequences', 'remarks',
])
/** sprite2d block field allow-list (drift-locked to the schema file). */
export const KNOWN_SPRITE2D = new Set(['spritesheetPath', 'cell', 'columns', 'atlasRows', 'frames', 'tracks'])
/** live2d block field allow-list (drift-locked to the schema file). */
export const KNOWN_LIVE2D = new Set(['model', 'scale', 'translate', 'motions', 'expressions', 'hitAreas', 'lipSync'])

class Diagnostics {
  readonly list: PetManifestDiagnostic[] = []
  private readonly source: string
  constructor(source: string) { this.source = source }
  error(message: string): void { this.list.push({ level: 'error', message: this.source + ': ' + message }) }
  warn(message: string): void { this.list.push({ level: 'warning', message: this.source + ': ' + message }) }
  get hasErrors(): boolean { return this.list.some(d => d.level === 'error') }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unknownKeys(source: Record<string, unknown>, known: Set<string>): string[] {
  return Object.keys(source).filter(key => !known.has(key))
}

/**
 * Validate a manifest-relative asset path: no absolute paths, no backslashes,
 * no traversal, plain safe segments only. Returns the normalized path.
 */
export function safeManifestPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const value = raw.trim()
  if (isAbsolute(value) || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined
  const segments = value.split('/').filter(segment => segment !== '')
  if (segments.length === 0) return undefined
  if (segments.some(segment => segment === '.' || segment === '..' || !PATH_SEGMENT_PATTERN.test(segment))) return undefined
  return segments.join('/')
}

function parseStringBlock(record: Record<string, unknown>, key: string, diag: Diagnostics, required: boolean): string | undefined {
  const value = record[key]
  if (value === undefined) {
    if (required) diag.error('missing required field ' + JSON.stringify(key))
    return undefined
  }
  if (typeof value !== 'string' || value.trim() === '') {
    diag.error('field ' + JSON.stringify(key) + ' must be a non-empty string')
    return undefined
  }
  return value.trim()
}

/** Validate the phase-keyed string map shape shared by motions/expressions. */
function parsePhaseStringMap(
  raw: unknown, field: string, diag: Diagnostics,
): Partial<Record<ActivityPhase, string>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    diag.error('field ' + JSON.stringify(field) + ' must be an object keyed by activity phase')
    return undefined
  }
  const result: Partial<Record<ActivityPhase, string>> = {}
  for (const [phase, value] of Object.entries(raw)) {
    if (!PET_ACTIVITY_PHASES.includes(phase as ActivityPhase)) {
      diag.error(field + ': unknown activity phase ' + JSON.stringify(phase))
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      diag.error(field + '.' + phase + ' must be a non-empty string')
      continue
    }
    result[phase as ActivityPhase] = value.trim()
  }
  return result
}

/** Structural gate for sequences: content stays warn-and-drop (registry's job). */
function parseSequences(
  raw: unknown, diag: Diagnostics,
): Partial<Record<ActivityPhase, PetAnimation[]>> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    diag.warn('sequences must be an object keyed by activity phase; ignoring')
    return undefined
  }
  const sequences: Partial<Record<ActivityPhase, PetAnimation[]>> = {}
  for (const [phase, value] of Object.entries(raw)) {
    if (!PET_ACTIVITY_PHASES.includes(phase as ActivityPhase)) {
      diag.warn('sequences: unknown activity phase ' + JSON.stringify(phase) + '; entry dropped')
      continue
    }
    if (!Array.isArray(value) || value.length < 5 || value.some(item => typeof item !== 'string')) {
      diag.warn('sequences.' + phase + ' must be an array of at least 5 animation names; entry dropped')
      continue
    }
    sequences[phase as ActivityPhase] = value as PetAnimation[]
  }
  return Object.keys(sequences).length === 0 ? undefined : sequences
}

function parseSprite2dBlock(raw: unknown, diag: Diagnostics): PetManifestSprite2d | undefined {
  if (!isRecord(raw)) {
    diag.error('renderer sprite2d requires a "sprite2d" block object')
    return undefined
  }
  const extra = unknownKeys(raw, KNOWN_SPRITE2D)
  if (extra.length > 0) diag.error('sprite2d: unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  const spritesheetPath = safeManifestPath(raw.spritesheetPath)
  if (spritesheetPath === undefined) {
    diag.error('sprite2d.spritesheetPath must be a safe manifest-relative path')
  }
  const block: PetManifestSprite2d = { spritesheetPath: spritesheetPath ?? '' }
  if (raw.cell !== undefined) {
    if (!isRecord(raw.cell)) diag.error('sprite2d.cell must be an object { width?, height? }')
    else block.cell = raw.cell as { width?: number; height?: number }
  }
  if (raw.columns !== undefined) {
    if (typeof raw.columns !== 'number' || !Number.isInteger(raw.columns) || raw.columns < 1) diag.error('sprite2d.columns must be a positive integer')
    else block.columns = raw.columns
  }
  if (raw.atlasRows !== undefined) {
    if (typeof raw.atlasRows !== 'number' || !Number.isInteger(raw.atlasRows) || raw.atlasRows < 1) diag.error('sprite2d.atlasRows must be a positive integer')
    else block.atlasRows = raw.atlasRows
  }
  if (raw.frames !== undefined) {
    if (!Array.isArray(raw.frames) || raw.frames.some(v => typeof v !== 'number' || !Number.isInteger(v) || v < 0)) {
      diag.error('sprite2d.frames must be an array of non-negative integers')
    } else block.frames = raw.frames as number[]
  }
  if (raw.tracks !== undefined) {
    if (!isRecord(raw.tracks)) diag.error('sprite2d.tracks must be an object keyed by animation')
    else block.tracks = raw.tracks
  }
  return diag.hasErrors ? undefined : block
}

function parseLive2dBlock(raw: unknown, diag: Diagnostics): PetManifestLive2d | undefined {
  if (!isRecord(raw)) {
    diag.error('renderer live2d requires a "live2d" block object')
    return undefined
  }
  const extra = unknownKeys(raw, KNOWN_LIVE2D)
  if (extra.length > 0) diag.error('live2d: unknown field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  const model = safeManifestPath(raw.model)
  if (model === undefined) {
    diag.error('live2d.model must be a safe manifest-relative path to a .model3.json')
  } else if (!model.endsWith('.model3.json')) {
    diag.error('live2d.model must point at a .model3.json file')
  }
  const motions = parsePhaseStringMap(raw.motions, 'live2d.motions', diag)
  if (raw.motions === undefined) diag.error('live2d.motions is required (at least an "idle" group)')
  else if (motions !== undefined && motions.idle === undefined) diag.error('live2d.motions.idle is required (unmapped phases fall back to it)')
  const block: PetManifestLive2d = {
    model: model ?? '',
    motions: (motions ?? { idle: '' }) as PetManifestLive2d['motions'],
  }
  if (raw.scale !== undefined) {
    if (typeof raw.scale !== 'number' || !Number.isFinite(raw.scale) || raw.scale <= 0 || raw.scale > 10) {
      diag.error('live2d.scale must be a number in (0, 10]')
    } else block.scale = raw.scale
  }
  if (raw.translate !== undefined) {
    if (!isRecord(raw.translate)
      || (raw.translate.x !== undefined && typeof raw.translate.x !== 'number')
      || (raw.translate.y !== undefined && typeof raw.translate.y !== 'number')) {
      diag.error('live2d.translate must be an object { x?: number, y?: number }')
    } else block.translate = raw.translate as { x?: number; y?: number }
  }
  const expressions = parsePhaseStringMap(raw.expressions, 'live2d.expressions', diag)
  if (expressions !== undefined) block.expressions = expressions
  if (raw.hitAreas !== undefined) {
    if (!Array.isArray(raw.hitAreas) || raw.hitAreas.some(v => typeof v !== 'string' || v.trim() === '')) {
      diag.error('live2d.hitAreas must be an array of non-empty strings')
    } else block.hitAreas = raw.hitAreas as string[]
  }
  if (raw.lipSync !== undefined) {
    if (typeof raw.lipSync !== 'boolean') diag.error('live2d.lipSync must be a boolean')
    else block.lipSync = raw.lipSync
  }
  return diag.hasErrors ? undefined : block
}

/** v1 compat read: map the legacy flat manifest onto the v2 sprite2d shape. */
function compatV1(source: Record<string, unknown>, diag: Diagnostics): PetManifestV2 | undefined {
  const id = parseStringBlock(source, 'id', diag, true)
  if (id !== undefined && !PET_ID_PATTERN.test(id)) {
    diag.error('id ' + JSON.stringify(id) + ' is not a lowercase kebab id')
  }
  const displayName = typeof source.displayName === 'string' && source.displayName.trim() !== ''
    ? source.displayName.trim()
    : id
  const spritesheetRaw = source.spritesheetPath === undefined ? 'spritesheet.webp' : source.spritesheetPath
  const spritesheetPath = safeManifestPath(spritesheetRaw)
  if (spritesheetPath === undefined) {
    diag.error('spritesheetPath ' + JSON.stringify(String(source.spritesheetPath)) + ' is not a safe relative path')
  }
  if (source.license === undefined) {
    diag.warn('v1 compat read: no license field; run scripts/dsh-pet-migrate-v2 to migrate this pet')
  }
  const sprite2d: PetManifestSprite2d = { spritesheetPath: spritesheetPath ?? 'spritesheet.webp' }
  if (isRecord(source.cell)) sprite2d.cell = source.cell as { width?: number; height?: number }
  if (typeof source.columns === 'number') sprite2d.columns = source.columns
  if (Array.isArray(source.frames)) sprite2d.frames = source.frames as number[]
  if (isRecord(source.tracks)) sprite2d.tracks = source.tracks
  // v2 spritesheet atlases (spriteVersionNumber 2) carry 11 rows: 9 + 2 look rows.
  if (source.spriteVersionNumber === 2) sprite2d.atlasRows = 11
  const manifest: PetManifestV2 = {
    petManifestVersion: PET_MANIFEST_V2,
    id: id ?? '',
    displayName: displayName ?? '',
    renderer: 'sprite2d',
    sprite2d,
  }
  if (typeof source.description === 'string' && source.description.trim() !== '') manifest.description = source.description.trim()
  if (typeof source.license === 'string' && source.license.trim() !== '') manifest.license = source.license.trim()
  const sequences = parseSequences(source.sequences, diag)
  if (sequences !== undefined) manifest.sequences = sequences
  if (source.remarks !== undefined) manifest.remarks = source.remarks
  return diag.hasErrors ? undefined : manifest
}

/** Strict v2 validation (fail-closed on structure). */
function parseV2(source: Record<string, unknown>, diag: Diagnostics): PetManifestV2 | undefined {
  const extra = unknownKeys(source, KNOWN_TOP_LEVEL)
  if (extra.length > 0) diag.error('unknown top-level field(s) ' + extra.map(k => JSON.stringify(k)).join(', '))
  if (source.petManifestVersion !== PET_MANIFEST_V2) {
    diag.error('petManifestVersion must be 2 (got ' + JSON.stringify(source.petManifestVersion) + ')')
  }
  const id = parseStringBlock(source, 'id', diag, true)
  if (id !== undefined && (!PET_ID_PATTERN.test(id) || id.length > 64)) {
    diag.error('id ' + JSON.stringify(id) + ' must be a lowercase kebab id of at most 64 chars')
  }
  const displayName = parseStringBlock(source, 'displayName', diag, true)
  const license = parseStringBlock(source, 'license', diag, true)
  const rendererRaw = source.renderer === undefined ? 'sprite2d' : source.renderer
  if (!PET_RENDERER_KINDS.includes(rendererRaw as PetRendererKind)) {
    diag.error('unknown renderer ' + JSON.stringify(rendererRaw) + '; expected one of ' + PET_RENDERER_KINDS.join(', '))
  }
  const renderer = rendererRaw as PetRendererKind
  const manifest: PetManifestV2 = {
    petManifestVersion: PET_MANIFEST_V2,
    id: id ?? '',
    displayName: displayName ?? '',
    renderer,
  }
  if (license !== undefined) manifest.license = license
  if (source.description !== undefined) {
    if (typeof source.description !== 'string' || source.description.length > 500) diag.error('description must be a string of at most 500 chars')
    else manifest.description = source.description
  }
  if (source.version !== undefined) {
    if (typeof source.version !== 'string' || !SEMVER_PATTERN.test(source.version)) diag.error('version must be a semver string (x.y.z)')
    else manifest.version = source.version
  }
  if (source.author !== undefined) {
    if (typeof source.author !== 'string' || source.author.length > 128) diag.error('author must be a string of at most 128 chars')
    else manifest.author = source.author
  }
  if (source.homepage !== undefined) {
    if (typeof source.homepage !== 'string') diag.error('homepage must be a string URL')
    else manifest.homepage = source.homepage
  }
  if (renderer === 'sprite2d') {
    const block = parseSprite2dBlock(source.sprite2d, diag)
    if (block !== undefined) manifest.sprite2d = block
    if (source.live2d !== undefined) diag.error('renderer sprite2d must not declare a live2d block')
  } else if (renderer === 'live2d') {
    const block = parseLive2dBlock(source.live2d, diag)
    if (block !== undefined) manifest.live2d = block
    if (source.sprite2d !== undefined) diag.error('renderer live2d must not declare a sprite2d block')
  }
  const sequences = parseSequences(source.sequences, diag)
  if (sequences !== undefined) manifest.sequences = sequences
  if (source.remarks !== undefined && !isRecord(source.remarks)) diag.error('remarks must be an object of remark pools')
  else if (source.remarks !== undefined) manifest.remarks = source.remarks
  return diag.hasErrors ? undefined : manifest
}

/**
 * Parse one pet manifest: v1 (no petManifestVersion) is compat-read as a
 * sprite2d pet with a migration hint; v2 is validated fail-closed. The parse
 * never throws — every failure comes back as structured diagnostics.
 * @param raw - the parsed pet.json value.
 * @param sourceLabel - human-readable origin for diagnostics (dir or file).
 */
export function parsePetManifest(raw: unknown, sourceLabel: string): PetManifestParse {
  const diag = new Diagnostics(sourceLabel)
  if (!isRecord(raw)) {
    diag.error('manifest is not an object')
    return { ok: false, diagnostics: diag.list }
  }
  if (raw.petManifestVersion === undefined) {
    const manifest = compatV1(raw, diag)
    if (manifest === undefined) return { ok: false, diagnostics: diag.list }
    diag.warn('v1 compat read: manifest treated as renderer "sprite2d"; run scripts/dsh-pet-migrate-v2 to migrate')
    return { ok: true, manifest, migrated: 'v1-compat', diagnostics: diag.list }
  }
  const manifest = parseV2(raw, diag)
  if (manifest === undefined) return { ok: false, diagnostics: diag.list }
  return { ok: true, manifest, migrated: undefined, diagnostics: diag.list }
}
