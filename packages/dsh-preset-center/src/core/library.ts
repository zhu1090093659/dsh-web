/**
 * The preset library: one directory, and the filesystem-derived state every
 * surface reads.
 *
 * A directory under the library is installed and inert — the harness no longer
 * scans any on-disk preset root, so a downloaded composition runs only once
 * this plugin declares it to `ctx.agentPresets`. `enabled` therefore comes
 * from the live declarations, not from the filesystem, and no operation here
 * moves a directory: enabling is a registry call, disabling drops that call,
 * and uninstalling deletes the bytes.
 *
 * The module owns no policy: reserved ids and the default-preset guard live in
 * the route layer, which is the only place that can read the roster.
 * @module @linxin666/dsh-client-ui-preset-center/core/library
 */

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { isPresetId, libraryRoot } from './paths.ts'
import { isDirectory, verifyProvenance, type ProvenanceReport } from './provenance.ts'

/** Why a library operation was refused. */
export type PresetOperationCode =
  | 'invalid-id'
  | 'not-installed'
  | 'not-managed'
  | 'write'

/** A refused library operation. */
export class PresetOperationError extends Error {
  readonly code: PresetOperationCode
  constructor(code: PresetOperationCode, message: string) {
    super(message)
    this.code = code
  }
}

/** Everything the surfaces know about one preset id. */
export interface PresetStateRow {
  /** Preset id (the directory name). */
  id: string
  /** The library copy exists. */
  installed: boolean
  /** This plugin currently holds a registry declaration for the id. */
  enabled: boolean
  /** A well-formed market provenance record is present. */
  managed: boolean
  /** Market asset version recorded at install, when the record carries one. */
  assetVersion?: string
  /** Install timestamp recorded at install. */
  installedAt?: string
  /** Integrity of the library copy against its own provenance record. */
  integrity: 'valid' | 'modified' | 'missing' | 'none'
  /** The directory the row describes. */
  dir: string
}

/** Subdirectory ids of the library, sorted; an absent root yields none. */
export function scanPresetIds(root: string): string[] {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && isPresetId(entry.name))
    .map((entry) => entry.name)
    .sort()
}

/**
 * The state of one id, derived from the library directory and the live
 * declarations.
 * @param dshHome - DSH home root.
 * @param id - preset id.
 * @param declared - ids this plugin has declared to the registry.
 * @returns the row every surface renders.
 */
export function readPresetState(dshHome: string, id: string, declared: ReadonlySet<string>): PresetStateRow {
  const dir = libraryDirOf(dshHome, id)
  const installed = isDirectory(dir)
  const report: ProvenanceReport = installed
    ? verifyProvenance(dir, id)
    : { state: 'missing', provenance: null, mismatches: [], missing: [], extra: [] }
  const provenance = report.provenance
  return {
    id,
    installed,
    enabled: installed && declared.has(id),
    managed: provenance !== null,
    ...(provenance?.assetVersion === undefined ? {} : { assetVersion: provenance.assetVersion }),
    ...(provenance?.installedAt === undefined ? {} : { installedAt: provenance.installedAt }),
    integrity: installed ? report.state : 'none',
    dir,
  }
}

/** Every installed id with its state, sorted. */
export function listPresetStates(dshHome: string, declared: ReadonlySet<string>): PresetStateRow[] {
  return scanPresetIds(libraryRoot(dshHome)).map((id) => readPresetState(dshHome, id, declared))
}

/** Absolute library path of one id. */
export function libraryDirOf(dshHome: string, id: string): string {
  return join(libraryRoot(dshHome), id)
}

/**
 * Delete the library copy of a workshop-managed preset.
 * @param dshHome - DSH home root.
 * @param id - preset id.
 * @throws {PresetOperationError} invalid-id or not-managed when the directory
 *   exists without market provenance (a hand-authored directory is never
 *   deleted); an absent preset is a no-op.
 */
export function uninstallPreset(dshHome: string, id: string): void {
  if (!isPresetId(id)) throw new PresetOperationError('invalid-id', `invalid preset id: ${String(id)}`)
  const dir = libraryDirOf(dshHome, id)
  if (!isDirectory(dir)) return
  if (!verifyProvenance(dir, id).provenance) {
    throw new PresetOperationError('not-managed', `preset was not installed from the Workshop: ${id}`)
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  } catch (err) {
    throw new PresetOperationError('write', err instanceof Error ? err.message : String(err))
  }
}
