/**
 * The declaration an installed preset makes to the agent-preset registry: its
 * identity and display text from `preset.yml`, its child plugin rows from
 * `agent.cordis.yml`, both read from the bytes the market installed.
 *
 * This is the one place the plugin turns a downloaded directory into a
 * registry definition, so it also owns the fail-closed rule: an unreadable or
 * unsupported composition raises instead of declaring a partial preset.
 * @module @linxin666/dsh-client-ui-preset-center/core/definition
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

import { COMPOSITION_FILE, METADATA_FILE } from './paths.ts'
import { CompositionError, readCordisYaml } from './yaml.ts'

/** The display text `preset.yml` contributes to a declaration. */
export interface PresetMetadata {
  /** Display name the roster shows. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
  /** Roster ordering rank. */
  order?: number
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError(`${what} must be a mapping`)
  }
  return value as Record<string, unknown>
}

/** Read the single-line display scalars of one `preset.yml`. */
export function readPresetMetadata(text: string): PresetMetadata {
  const record = asRecord(readCordisYaml(text), METADATA_FILE)
  const metadata: PresetMetadata = {}
  if (record['name'] !== undefined && record['name'] !== null) {
    if (typeof record['name'] !== 'string' || record['name'].includes('\n')) {
      throw new CompositionError(`${METADATA_FILE}: name must be a single-line string`)
    }
    metadata.name = record['name']
  }
  if (record['description'] !== undefined && record['description'] !== null) {
    if (typeof record['description'] !== 'string' || record['description'].includes('\n')) {
      throw new CompositionError(`${METADATA_FILE}: description must be a single-line string`)
    }
    metadata.description = record['description']
  }
  if (record['order'] !== undefined && record['order'] !== null) {
    if (typeof record['order'] !== 'number' || !Number.isFinite(record['order'])) {
      throw new CompositionError(`${METADATA_FILE}: order must be a number`)
    }
    metadata.order = record['order']
  }
  return metadata
}

/** One composition row as the document declares it. */
interface CompositionRow {
  name?: string
  group?: boolean
  config?: unknown
  [key: string]: unknown
}

function asRow(value: unknown, at: string): CompositionRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompositionError(`${at} must be a mapping`)
  }
  const row = value as CompositionRow
  if (typeof row.name !== 'string' || row.name === '') {
    throw new CompositionError(`${at} names no plugin (a "name" string is required)`)
  }
  return row
}

/**
 * Rewrite the relative module names of one row list, recursively through the
 * nested entry lists of group rows, into absolute file URLs. The registry
 * mounts a declaration under the DECLARING plugin's base URL, so a preset that
 * ships its own code files would otherwise resolve them against this package.
 */
function absolutizeRows(rows: readonly CompositionRow[], baseDir: string, at = 'row'): CompositionRow[] {
  return rows.map((row, index) => {
    const label = `${at} ${String(index + 1)}`
    const checked = asRow(row, label)
    const name = checked.name ?? ''
    const out: CompositionRow = { ...checked }
    if (name.startsWith('./') || name.startsWith('../')) {
      out.name = pathToFileURL(resolve(baseDir, name)).href
    }
    if (checked.group === true) {
      if (!Array.isArray(checked.config)) {
        throw new CompositionError(`group ${label} must hold a list of plugin rows`)
      }
      out.config = absolutizeRows(checked.config as CompositionRow[], baseDir, `${label} group`)
    }
    return out
  })
}

/**
 * Read the child plugin rows of one `agent.cordis.yml`.
 * @param text - the raw composition document.
 * @param baseDir - directory a relative row `name` resolves against (the preset's own directory).
 * @returns the row list to hand the registry, relative names resolved to file URLs.
 */
export function readCompositionRows(text: string, baseDir: string): PresetDefinition['plugins'] {
  const value = readCordisYaml(text)
  if (!Array.isArray(value)) {
    throw new CompositionError(`${COMPOSITION_FILE} must be a top-level list of plugin rows`)
  }
  return absolutizeRows(value as CompositionRow[], baseDir) as PresetDefinition['plugins']
}

/** Build the registry definition of one installed preset from its own bytes. */
export function presetDefinition(id: string, composition: string, metadata: string, baseDir: string): PresetDefinition {
  return { id, ...readPresetMetadata(metadata), plugins: readCompositionRows(composition, baseDir) }
}

/**
 * Build the registry definition of one installed preset directory.
 * @param id - preset id (the library directory name).
 * @param dir - absolute preset directory.
 * @returns the definition to submit to `ctx.agentPresets.register`.
 * @throws {CompositionError} when either file is missing or unreadable.
 */
export function readPresetDefinition(id: string, dir: string): PresetDefinition {
  const read = (name: string): string => {
    try {
      return readFileSync(join(dir, name), 'utf8')
    } catch (err) {
      throw new CompositionError(`${name} is unreadable: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return presetDefinition(id, read(COMPOSITION_FILE), read(METADATA_FILE), dir)
}
