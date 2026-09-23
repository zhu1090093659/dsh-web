/**
 * Market provenance for one installed preset: the record the market installer
 * writes at install time (market origin, asset version, per-file sha256).
 *
 * It is what lets the panel tell a workshop-managed preset apart from a
 * hand-authored directory, and a pristine copy apart from one edited after
 * install. Fail-closed: unreadable or wrongly-shaped provenance is `missing`,
 * never trusted.
 * @module @linxin666/dsh-client-ui-preset-center/core/provenance
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { PROVENANCE_FILENAME } from './paths.ts'

/** Market origin the provenance must pin (mirrors MARKET_ORIGIN in the market package). */
export const MARKET_ORIGIN = 'https://dsh-market.com'

/** The provenance record as the market installer writes it. */
export interface PresetProvenance {
  /** Format version; only 1 is understood. */
  version: number
  /** Market origin the bytes came from. */
  source: string
  /** Asset id the record belongs to. */
  id: string
  /** Install timestamp (ISO string). */
  installedAt: string
  /** Market manifest version at install time, when the manifest carried one. */
  assetVersion?: string
  /** Relative path -> lowercase hex sha256. */
  files: Record<string, string>
}

/** Integrity of a preset directory against its own provenance record. */
export type ProvenanceState = 'valid' | 'modified' | 'missing'

/** One directory's provenance verdict. */
export interface ProvenanceReport {
  /** Whether a well-formed record for this id exists. */
  state: ProvenanceState
  /** The record, when it parsed and matched the id. */
  provenance: PresetProvenance | null
  /** Recorded files whose bytes no longer match. */
  mismatches: string[]
  /** Recorded files that are absent. */
  missing: string[]
  /** Files on disk that the record does not list. */
  extra: string[]
}

function sha256Hex(abs: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return null
  }
}

/** Every regular file under `dir`, as sorted relative POSIX paths. */
export function listFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  let entries
  try {
    entries = readdirSync(join(dir, base), { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith('.')) continue
    const rel = base === '' ? entry.name : base + '/' + entry.name
    if (entry.isDirectory()) out.push(...listFiles(dir, rel))
    else out.push(rel)
  }
  return out
}

/** Read one preset directory's provenance record; null when absent or malformed. */
export function readProvenance(dir: string, id: string): PresetProvenance | null {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(dir, PROVENANCE_FILENAME), 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1) return null
  if (record.source !== MARKET_ORIGIN) return null
  if (record.id !== id) return null
  const files = record.files
  if (typeof files !== 'object' || files === null) return null
  const hashes: Record<string, string> = {}
  for (const [rel, hash] of Object.entries(files as Record<string, unknown>)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return null
    hashes[rel] = hash
  }
  const installedAt = typeof record.installedAt === 'string' ? record.installedAt : ''
  const assetVersion = typeof record.assetVersion === 'string' ? record.assetVersion : undefined
  return { version: 1, source: MARKET_ORIGIN, id, installedAt, ...(assetVersion === undefined ? {} : { assetVersion }), files: hashes }
}

/** Verify one directory's bytes against its own provenance record. */
export function verifyProvenance(dir: string, id: string): ProvenanceReport {
  const provenance = readProvenance(dir, id)
  if (provenance === null) return { state: 'missing', provenance: null, mismatches: [], missing: [], extra: [] }
  const mismatches: string[] = []
  const missing: string[] = []
  for (const [rel, expected] of Object.entries(provenance.files)) {
    const actual = sha256Hex(join(dir, ...rel.split('/')))
    if (actual === null) missing.push(rel)
    else if (actual !== expected) mismatches.push(rel)
  }
  const extra = listFiles(dir).filter((rel) => rel !== PROVENANCE_FILENAME && provenance.files[rel] === undefined)
  const state: ProvenanceState = mismatches.length === 0 && missing.length === 0 ? 'valid' : 'modified'
  return { state, provenance, mismatches, missing, extra }
}

/** Whether `dir` is a directory that exists. */
export function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}
