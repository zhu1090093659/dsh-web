/**
 * Status-decoration manifest v1 — fail-closed structure + warn-and-drop
 * content, mirroring the pet manifest-v2 discipline (issue #623 M5,
 * protocol #567). Unknown top-level fields, unsafe entry paths, out-of-
 * range geometry and unknown renderer content reject the descriptor with
 * human-readable diagnostics; per-phase binding issues drop that binding
 * only. The JSON Schema twin lives at
 * contracts/status-decoration-v1.schema.json; this hand-rolled parser is
 * authoritative. Keep this file erasable-syntax-only (scripts/ import it
 * under node's strip-only mode).
 * @module @linxin666/dsh-pet/decoration
 */

import { isAbsolute } from 'node:path'
import type { ActivityPhase } from './state.ts'
import { PET_ACTIVITY_PHASES } from './manifest-v2.ts'
import type {
  DecorationDiagnostic,
  DecorationManifest,
  DecorationManifestParse,
  PhaseBindings,
  PhaseSegment,
} from './contracts/status-decoration.ts'

/** Geometry and content caps (the adopted PNG/WebP sprite-strip bounds). */
export const DECORATION_CELL_MAX = 256
export const DECORATION_COLUMNS_MAX = 16
export const DECORATION_DURATION_MAX_MS = 2000
export const DECORATION_ENTRY_EXTENSIONS = ['.webp', '.png'] as const
export const DECORATION_DISPLAY_NAME_MAX = 64

/** Field allow-list (drift-locked to the schema twin in tests). */
export const KNOWN_DECORATION_TOP_LEVEL = new Set([
  '$schema', 'decorationManifestVersion', 'id', 'displayName', 'license',
  'entry', 'cell', 'columns', 'frameMs', 'durations', 'loop', 'phases',
])

const PET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

class Diagnostics {
  readonly list: DecorationDiagnostic[] = []
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

/** Positive integer in [min, max], else undefined. */
function finiteInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

/**
 * Validate a descriptor-relative entry path: no absolute paths, no
 * backslashes, no traversal, plain safe segments only, and an exact
 * lowercase PNG/WebP extension (the adopted entry discipline — SVG/CSS are
 * not accepted). The extension match is case-sensitive on purpose: the
 * asset route serves the declared path verbatim, so a case-mismatched
 * suffix (frames.PNG vs frames.png) would pass a lenient check but 403 on
 * case-sensitive filesystems.
 * Returns the normalized path or undefined.
 */
export function safeDecorationEntry(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const value = raw.trim()
  if (value.length > 256) return undefined
  if (isAbsolute(value) || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined
  const segments = value.split('/').filter(segment => segment !== '')
  if (segments.length === 0) return undefined
  if (segments.some(segment => segment === '.' || segment === '..' || !PATH_SEGMENT_PATTERN.test(segment))) return undefined
  const last = segments[segments.length - 1]!
  const dot = last.lastIndexOf('.')
  if (dot <= 0 || !(DECORATION_ENTRY_EXTENSIONS as readonly string[]).includes(last.slice(dot))) return undefined
  return segments.join('/')
}

/** Normalize one phase binding value; undefined (warning) on bad content. */
function normalizeSegment(
  raw: unknown,
  columns: number,
  diag: Diagnostics,
): PhaseSegment | undefined {
  if (raw === 'hide') return 'hide'
  if (!isRecord(raw)) {
    diag.warn('phase binding must be "hide" or { from, to }; binding dropped')
    return undefined
  }
  const from = finiteInt(raw.from, 0, columns - 1)
  const to = finiteInt(raw.to, 0, columns - 1)
  if (from === undefined || to === undefined || from > to) {
    diag.warn('phase frame segment out of range; binding dropped')
    return undefined
  }
  return { from, to }
}

/**
 * Parse and validate one decoration.json document. Fail-closed over the
 * structure (types, key sets, paths, ranges); phase-binding content issues
 * drop that binding only (warn-and-drop, the registry never-throw rule).
 */
export function parseDecorationManifest(
  raw: unknown,
  source: string = 'decoration.json',
): DecorationManifestParse {
  const diag = new Diagnostics(source)
  if (!isRecord(raw)) {
    diag.error('descriptor must be a JSON object')
    return { ok: false, diagnostics: diag.list }
  }
  for (const key of unknownKeys(raw, KNOWN_DECORATION_TOP_LEVEL)) {
    diag.error('unknown top-level field ' + JSON.stringify(key))
  }
  if (raw.decorationManifestVersion !== 1) {
    diag.error('decorationManifestVersion must be 1')
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!PET_ID_PATTERN.test(id)) {
    diag.error('id must be a lowercase kebab id')
  }
  if (id.length > 64) {
    diag.error('id must be at most 64 characters')
  }
  const license = typeof raw.license === 'string' ? raw.license.trim() : ''
  if (license === '') diag.error('license is required (asset provenance)')
  if (license.length > 128) {
    diag.error('license must be at most 128 characters')
  }
  const entry = safeDecorationEntry(raw.entry)
  if (entry === undefined) {
    diag.error('entry must be a safe relative PNG/WebP path')
  }
  const rawCell = isRecord(raw.cell) ? raw.cell : {}
  for (const key of Object.keys(rawCell)) {
    if (key !== 'width' && key !== 'height') diag.warn('unknown cell field ' + JSON.stringify(key) + ' ignored')
  }
  const cellWidth = finiteInt(rawCell.width, 1, DECORATION_CELL_MAX)
  const cellHeight = finiteInt(rawCell.height, 1, DECORATION_CELL_MAX)
  if (cellWidth === undefined || cellHeight === undefined) {
    diag.error('cell width/height must be integers in [1, ' + DECORATION_CELL_MAX + ']')
  }
  const columns = finiteInt(raw.columns, 1, DECORATION_COLUMNS_MAX)
  if (columns === undefined) {
    diag.error('columns must be an integer in [1, ' + DECORATION_COLUMNS_MAX + ']')
  }
  if (diag.hasErrors || id === '' || entry === undefined || columns === undefined) {
    return { ok: false, diagnostics: diag.list }
  }
  const displayName = typeof raw.displayName === 'string' && raw.displayName.trim() !== ''
    ? raw.displayName.trim().slice(0, DECORATION_DISPLAY_NAME_MAX)
    : id
  let loop: boolean
  if (raw.loop === undefined || typeof raw.loop === 'boolean') {
    loop = raw.loop ?? true
  } else {
    diag.warn('loop must be a boolean; defaulting to true')
    loop = true
  }
  const rawDurations = raw.durations
  let durations: number[]
  if (Array.isArray(rawDurations)) {
    const usable = rawDurations.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= DECORATION_DURATION_MAX_MS)
    if (usable.length !== columns) {
      diag.warn('durations length must equal columns; using the constant frameMs instead')
      durations = []
    } else {
      durations = usable
    }
  } else if (rawDurations !== undefined) {
    diag.warn('durations must be an array; using the constant frameMs instead')
    durations = []
  } else {
    durations = []
  }
  if (durations.length === 0) {
    const frameMs = finiteInt(raw.frameMs, 1, DECORATION_DURATION_MAX_MS) ?? 120
    durations = Array.from({ length: columns }, () => frameMs)
  }
  const phases: PhaseBindings = {}
  const rawPhases = raw.phases
  if (isRecord(rawPhases)) {
    for (const [key, value] of Object.entries(rawPhases)) {
      if (!(PET_ACTIVITY_PHASES as readonly string[]).includes(key)) {
        diag.warn('unknown phase ' + JSON.stringify(key) + '; binding ignored')
        continue
      }
      const segment = normalizeSegment(value, columns, diag)
      if (segment !== undefined) phases[key as ActivityPhase] = segment
    }
  } else if (rawPhases !== undefined) {
    diag.warn('phases must be an object; all phases hide')
  }
  const visible = Object.values(phases).some(segment => segment !== 'hide')
  if (!visible) diag.warn('no phase shows the ornament; the decoration stays hidden')
  const manifest: DecorationManifest = {
    decorationManifestVersion: 1,
    id,
    displayName,
    license,
    entry,
    cell: { width: cellWidth!, height: cellHeight! },
    columns,
    durations,
    loop,
    phases,
  }
  return { ok: true, manifest, diagnostics: diag.list }
}