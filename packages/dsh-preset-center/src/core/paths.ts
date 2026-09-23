/**
 * The preset-center storage contract: one directory, one meaning.
 *
 * The library under the DSH home is where the market installs a preset and
 * the only place the preset center reads from. Nothing scans it: the harness
 * no longer discovers presets on disk, so a downloaded directory stays inert
 * until this plugin declares it to `ctx.agentPresets` at runtime.
 *
 * The path is a cross-package contract, not private state: it is the
 * destination the market installer writes (`preset` asset kind).
 * @module @linxin666/dsh-client-ui-preset-center/core/paths
 */

import { join } from 'node:path'

/** Library directory under the DSH home: the market install target. */
export const LIBRARY_DIR = 'agent-presets'

/**
 * Provenance filename written by the market installer (mirrors
 * `PROVENANCE_FILENAME` in `@linxin666/dsh-client-ui-market`; no
 * cross-package runtime import, the same way the skin center mirrors it).
 */
export const PROVENANCE_FILENAME = 'dsh-market.provenance.json'

/** The composition file that makes a directory a preset. */
export const COMPOSITION_FILE = 'agent.cordis.yml'

/** The display-text file the composition's registry declaration reads. */
export const METADATA_FILE = 'preset.yml'

/** Official preset id rule (mirrors the harness's preset identity rule). */
export const PRESET_ID_RE = /^[a-z0-9][a-z0-9-]*$/

/** Whether `id` is a usable preset directory name. */
export function isPresetId(id: unknown): id is string {
  return typeof id === 'string' && PRESET_ID_RE.test(id)
}

/** The library directory for one DSH home. */
export function libraryRoot(dshHome: string): string {
  return join(dshHome, LIBRARY_DIR)
}
