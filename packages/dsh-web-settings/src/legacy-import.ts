/**
 * One-shot import of the family settings the 0.1.7 settings subsystem leaves
 * orphaned in `$DSH_HOME/settings.yaml.imported`.
 *
 * The Host's own legacy import renames `settings.yaml` and then imports every
 * section under its own name as the profile entry id, so a family section
 * (`pet`, `dsh-usage`, ...) matches no entry: the Host logs it as rejected,
 * leaves it in the renamed file, and every family setting reverts to its
 * schema default. This module picks those sections up through two ordered
 * rules, and writes what the entry's own user layer does not already carry
 * through the official write path, `settings.update(entryId, patch, revision)`.
 *
 * 1. The alias rule: the section name resolves through the same tables the
 *    bridge serves namespaces with — the allowlist's family namespace aliases,
 *    then the active profile roster that maps a namespace onto the entry id
 *    the Host addresses.
 * 2. The field rule: a section the alias rule cannot place is matched against
 *    the top-level Config fields the served entries declare, and the entry that
 *    uniquely declares a field of that name takes it. This is how a namespace a
 *    plugin folded into its own Config still lands: the Skin Center declares
 *    `skin-background`, `skin-custom-theme`, and `skin-wallpaper` as fields of
 *    one entry, so the legacy sections of those names belong at those paths.
 *    The match must be unique: two entries declaring the field name, or none,
 *    leaves the section alone.
 *
 * Whichever rule placed the section, the path inside the entry is the same
 * decision: the section is written at a top-level field of its own name when
 * that entry declares one (the folded-in namespace case, which the alias rule
 * reaches whenever the entry also serves the namespace), and at the entry root
 * otherwise — the ordinary family plugin, whose Config carries the section's
 * fields directly. A section both rules could claim keeps the alias rule. The
 * import is one-shot and never clobbers: a field path the entry's user layer
 * already holds is dropped from the patch, and every section the run imported is
 * recorded in a small marker document under the DSH home, so a later boot
 * cannot re-apply a value the user has since cleared. A section the Host
 * refuses stays unrecorded and is retried on the next boot.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse } from 'yaml'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { resolveNamespaceEntries } from './allowlist.ts'
import type { BridgeProfileEntry, ServedNamespace, SettingsSurface } from './bridge.ts'
import { servedNamespaces } from './bridge.ts'
import { resolveDshHome } from './dsh-home.ts'

/** File name of the one-shot import marker inside the DSH home. */
export const LEGACY_IMPORT_MARKER_FILE = 'dsh-web-settings-legacy-import.json'

/** Marker version this build writes; a marker of another version is never overwritten. */
export const LEGACY_IMPORT_MARKER_VERSION = 1

/** One legacy section this import recorded. */
export interface LegacyImportRecord {
  /** Profile entry id the section was written into. */
  entryId: string
  /**
   * Field path inside that entry the section was written to: empty for a
   * section the alias rule placed at the entry root, `[name]` for a section the
   * field rule matched to a top-level Config field. Absent in a marker written
   * before the field rule existed, which also means the entry root.
   */
  path: string[]
  /** Fields the run wrote at that path (empty when the user layer already carried them all). */
  fields: string[]
  /** ISO timestamp of the write, for a human reading the marker. */
  importedAt: string
}

/** The one-shot marker document: which legacy sections were already imported. */
export interface LegacyImportMarker {
  version: number
  sections: Record<string, LegacyImportRecord>
}

/** What the marker file holds, or why it cannot be used. */
export type LegacyImportMarkerState =
  | { status: 'absent' }
  | { status: 'recorded'; marker: LegacyImportMarker }
  | { status: 'unusable'; reason: string }

/**
 * Path of the one-shot import marker inside the DSH home. Deleting the file
 * re-arms the import; the user-layer check still refuses to overwrite anything
 * the entry already carries.
 * @param env - process environment to read DSH_HOME from (test seam).
 * @param home - platform home directory fallback (test seam).
 * @returns the absolute marker path.
 */
export function legacyImportMarkerPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return join(resolveDshHome(env, home), LEGACY_IMPORT_MARKER_FILE)
}

/**
 * Write the marker document. Written whole through a temporary file so a
 * crash mid-write cannot leave a truncated marker behind.
 * @param path - marker path, from legacyImportMarkerPath().
 * @param marker - the document to store.
 */
export function writeLegacyImportMarker(path: string, marker: LegacyImportMarker): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = path + '.tmp'
  writeFileSync(temporary, JSON.stringify(marker, null, 2) + '\n', 'utf8')
  renameSync(temporary, path)
}

/**
 * Read the marker document.
 * @param path - marker path, from legacyImportMarkerPath().
 * @returns the marker state. A file that is unreadable, unparseable, or
 *   written by another version is 'unusable' rather than 'absent': a marker
 *   this build cannot read may already cover sections, so the import does not
 *   re-apply values over it.
 */
export function readLegacyImportMarkerState(path: string): LegacyImportMarkerState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { status: 'absent' }
  }
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch {
    return { status: 'unusable', reason: 'it does not parse as a marker document' }
  }
  if (!isRecord(parsed)) return { status: 'unusable', reason: 'it is not a JSON object' }
  const { version, sections } = parsed
  if (version !== LEGACY_IMPORT_MARKER_VERSION) {
    return { status: 'unusable', reason: 'it carries version ' + JSON.stringify(version) + ' instead of ' + String(LEGACY_IMPORT_MARKER_VERSION) }
  }
  if (!isRecord(sections)) return { status: 'unusable', reason: 'its sections entry is not an object' }
  const records: Record<string, LegacyImportRecord> = {}
  for (const [section, value] of Object.entries(sections)) {
    if (!isRecord(value) || typeof value.entryId !== 'string') continue
    records[section] = {
      entryId: value.entryId,
      path: Array.isArray(value.path) ? value.path.filter((step): step is string => typeof step === 'string') : [],
      fields: Array.isArray(value.fields) ? value.fields.filter((field): field is string => typeof field === 'string') : [],
      importedAt: typeof value.importedAt === 'string' ? value.importedAt : '',
    }
  }
  return { status: 'recorded', marker: { version: LEGACY_IMPORT_MARKER_VERSION, sections: records } }
}

/** Whether a value is a plain data mapping (never an array or a class instance). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The settings surface this run reads and writes: the Host settings service, narrowed. */
export interface LegacyImportSettings extends SettingsSurface {
  /** Merge the patch into the entry's user layer (the official write path). */
  update(entryId: string, patch: object, expectedRevision?: number): Promise<void>
}

/** The logging seam this run reports through (the Host logger satisfies it). */
export interface LegacyImportLogger {
  info(format: string, ...params: unknown[]): void
  warn(format: string, ...params: unknown[]): void
}

/** Everything one import run needs. */
export interface LegacyImportDeps {
  /** The Host settings surface. */
  settings: LegacyImportSettings
  /** Active profile roster (`configEditor.entries()`), the only place a package identity survives. */
  entries: () => BridgeProfileEntry[]
  /** Read the raw legacy settings document ('' when unreadable or absent). */
  readSettingsYaml: () => string
  /** Host logger; every failure is reported here instead of thrown. */
  logger: LegacyImportLogger
  /** Marker path, from legacyImportMarkerPath(). */
  markerPath: string
  /** Clock for the marker timestamp (test seam). */
  now?: () => Date
}

/** What one run did, for the Host log and for tests. */
export interface LegacyImportOutcome {
  /** Section names this run recorded as imported (written, or already complete in the user layer). */
  imported: string[]
  /** Section names a previous run had already recorded. */
  done: string[]
  /** Section names left alone: no family namespace and no declared field, or no entry the Host serves for either. */
  skipped: string[]
  /** The subset of `skipped` that names a family namespace no served entry owns. */
  unserved: string[]
  /** The subset of `skipped` that two or more served entries could claim by field name. */
  ambiguous: string[]
  /** Section names the Host refused to write, with the reason it gave. */
  refused: { section: string; reason: string }[]
}

/** The document's top-level sections, or the empty list with a warning. */
function readLegacySections(text: string, logger: LegacyImportLogger): [string, unknown][] {
  if (text.trim() === '') return []
  let document: unknown
  try {
    document = parse(text)
  } catch (error) {
    logger.warn('web-ui-settings: the legacy settings document does not parse as YAML, no section was imported: %s', reasonOf(error))
    return []
  }
  if (!isRecord(document)) {
    logger.warn('web-ui-settings: the legacy settings document is not a mapping of sections, no section was imported')
    return []
  }
  return Object.entries(document)
}

/** A failure message for the log, however the Host threw. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One section's write target: the entry id the Host addresses, the path inside it, and its live descriptor. */
interface LegacyTarget {
  entryId: string
  /** Path inside the entry the section's fields are written to ([] = the entry root). */
  path: string[]
  descriptor: SettingsDescriptor
}

/**
 * The top-level Config fields one served descriptor declares. Read from the
 * descriptor's serialized schema envelope `dict` — the declaration itself,
 * which is what both rules match on; the envelope needs no rehydration for a
 * key walk, and a descriptor whose schema carries no object `dict` declares no
 * matchable field.
 * @param descriptor - one served entry's descriptor.
 * @returns the declared top-level field names.
 */
function declaredFields(descriptor: SettingsDescriptor): string[] {
  const schema = descriptor.schema
  if (!isRecord(schema)) return []
  const dict = schema.dict
  return isRecord(dict) ? Object.keys(dict) : []
}

/**
 * The path one section is written at inside the entry that owns it. A plugin
 * that folded a pre-0.1.7 namespace into its own Config declares that namespace
 * as a top-level field (the Skin Center carries `skin-background`,
 * `skin-custom-theme`, and `skin-wallpaper` that way), so a section named after
 * a declared field belongs at that field's path; every other entry carries the
 * section's fields directly, which is the ordinary family case.
 * @param descriptor - the descriptor of the entry the section resolved to.
 * @param section - one top-level section name of the legacy document.
 * @returns the field path ([] = the entry root).
 */
function sectionPath(descriptor: SettingsDescriptor, section: string): string[] {
  return declaredFields(descriptor).includes(section) ? [section] : []
}

/**
 * Resolve one section by the alias rule: the entry that serves its family
 * namespace. The section name is resolved through the artifact the bridge
 * serves namespaces with — the allowlist's alias table gives the family
 * namespace (a name may resolve to more than one, e.g. the market spelling),
 * and the served roster gives the entry id that namespace is addressed by. A
 * namespace the Host serves under its own name rather than through a profile
 * row keeps that name as the entry id, exactly as the bridge's write path
 * does. The path inside that entry is decided the way the field rule decides
 * it, so an entry declaring a field of the section's own name takes the
 * section there instead of at its root.
 * @param section - one top-level section name of the legacy document.
 * @param served - family namespace to served entry, from the Host settings view.
 * @returns the write target, or undefined when no served entry owns the section.
 */
function resolveAliasTarget(section: string, served: Map<string, ServedNamespace>): LegacyTarget | undefined {
  for (const family of resolveNamespaceEntries(section)) {
    const target = served.get(family)
    if (target !== undefined) {
      return {
        entryId: target.entryId ?? family,
        path: sectionPath(target.descriptor, section),
        descriptor: target.descriptor,
      }
    }
  }
  return undefined
}

/** How the field rule placed one section. */
type FieldMatch =
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'target'; target: LegacyTarget }

/**
 * Resolve one section by the field rule: the unique served entry that declares
 * a top-level Config field named exactly like the section. This is how a
 * namespace a plugin folded into its own Config still lands — the section's
 * fields belong at that field's path. Fail closed: no declaring entry, or more
 * than one, leaves the section alone rather than writing a guess.
 * @param section - one top-level section name of the legacy document.
 * @param served - family namespace to served entry, from the Host settings view.
 * @returns the match, which is 'ambiguous' when two or more entries declare the field.
 */
function resolveFieldTarget(section: string, served: Map<string, ServedNamespace>): FieldMatch {
  const declaring = new Map<string, ServedNamespace>()
  for (const target of served.values()) {
    // Keyed by entry id: an entry declaring the field counts once, however
    // many served namespaces its descriptor is reached under.
    const entryId = target.entryId ?? String(target.descriptor.ns)
    if (declaredFields(target.descriptor).includes(section) && !declaring.has(entryId)) declaring.set(entryId, target)
  }
  if (declaring.size === 0) return { kind: 'none' }
  if (declaring.size > 1) return { kind: 'ambiguous' }
  const [entryId, target] = [...declaring][0]
  return { kind: 'target', target: { entryId, path: sectionPath(target.descriptor, section), descriptor: target.descriptor } }
}

/**
 * The section fields the entry's own user layer does not already carry.
 * Presence is decided per field path at any depth: a path the user layer holds
 * is dropped whole — its subtree is never rewritten, arrays included, because
 * the Host merges arrays by replacement — while a hold on one nested key still
 * lets its untouched siblings through.
 * @param userLayer - the descriptor's `user` layer (the entry's own overrides).
 * @param section - one legacy section's mapping.
 * @returns the patch to write, or undefined when the user layer already carries every field.
 */
function unheldFields(userLayer: unknown, section: Record<string, unknown>): Record<string, unknown> | undefined {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(section)) {
    if (isRecord(userLayer) && Object.hasOwn(userLayer, key)) {
      const held = userLayer[key]
      const nested = isRecord(value) && isRecord(held) ? unheldFields(held, value) : undefined
      if (nested !== undefined) patch[key] = nested
      continue
    }
    patch[key] = value
  }
  return Object.keys(patch).length === 0 ? undefined : patch
}

/**
 * The user-layer subtree a section is judged against at one target path.
 * A path the user layer holds with something other than a mapping is held
 * whole: the section has nowhere to merge into, so it is not written at all.
 * @param userLayer - the descriptor's `user` layer.
 * @param path - the target path ([] = the entry root).
 * @returns the subtree to judge against, and whether the path is held whole.
 */
function heldLayer(userLayer: unknown, path: readonly string[]): { layer: unknown; heldWhole: boolean } {
  let layer = userLayer
  for (const key of path) {
    if (!isRecord(layer) || !Object.hasOwn(layer, key)) return { layer: undefined, heldWhole: false }
    layer = layer[key]
  }
  return { layer, heldWhole: path.length > 0 && !isRecord(layer) }
}

/** One section's write: the patch for the official call, and the field names it writes inside the target path. */
interface PlannedSectionWrite {
  /** The patch handed to `settings.update`. */
  patch: Record<string, unknown>
  /** The section's own field names this patch writes (the ones the user layer does not hold). */
  fields: string[]
}

/**
 * The patch one section writes at its target path, or undefined when the user
 * layer holds it all.
 * @param target - the resolved write target.
 * @param value - the section's mapping.
 * @returns the planned write, or undefined when there is nothing to write.
 */
function patchFor(target: LegacyTarget, value: Record<string, unknown>): PlannedSectionWrite | undefined {
  const { layer, heldWhole } = heldLayer(target.descriptor.user, target.path)
  if (heldWhole) return undefined
  const unheld = unheldFields(layer, value)
  if (unheld === undefined) return undefined
  return {
    patch: target.path.length === 0 ? unheld : { [target.path[0]]: unheld },
    fields: Object.keys(unheld),
  }
}

/** A section list for the log line. */
function listOf(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.join(', ')
}

/**
 * Import the orphaned family sections once. Never throws: every refusal is
 * reported through the logger and left unrecorded so the next boot retries it,
 * and a section the Host already holds is dropped from the patch instead of
 * overwritten.
 * @param deps - the settings surface, the profile roster, the document reader, the logger, and the marker path.
 * @returns what the run did.
 */
export async function importLegacyFamilySections(deps: LegacyImportDeps): Promise<LegacyImportOutcome> {
  const outcome: LegacyImportOutcome = { imported: [], done: [], skipped: [], unserved: [], ambiguous: [], refused: [] }
  const sections = readLegacySections(deps.readSettingsYaml(), deps.logger)
  if (sections.length === 0) return outcome
  const state = readLegacyImportMarkerState(deps.markerPath)
  if (state.status === 'unusable') {
    deps.logger.warn('web-ui-settings: the legacy import marker %s was left alone because %s', deps.markerPath, state.reason)
    return outcome
  }
  const records: Record<string, LegacyImportRecord> = { ...state.status === 'recorded' ? state.marker.sections : {} }
  const now = deps.now ?? ((): Date => new Date())
  // The entry's own user layer decides what may be written, so the view is read
  // unredacted: a redacted user layer hides the `role('secret')` fields a user
  // already holds, and the import would overwrite them with the legacy value.
  const project = (): Map<string, ServedNamespace> =>
    servedNamespaces({ settings: deps.settings, entries: deps.entries }, { redactSecrets: false })
  let served = project()
  for (const [section, value] of sections) {
    if (records[section] !== undefined) {
      outcome.done.push(section)
      continue
    }
    // Rule order: the alias rule owns a section it can place at an entry root;
    // only a section it cannot place is matched against declared field names.
    let target = resolveAliasTarget(section, served)
    if (target === undefined) {
      const match = resolveFieldTarget(section, served)
      if (match.kind === 'target') {
        target = match.target
      } else {
        outcome.skipped.push(section)
        if (match.kind === 'ambiguous') {
          outcome.ambiguous.push(section)
        } else if (resolveNamespaceEntries(section).length > 0) {
          // A section naming a family namespace no entry owns and no entry
          // declares as a field is ours, but there is nowhere to write it.
          outcome.unserved.push(section)
        }
        continue
      }
    }
    if (!isRecord(value)) {
      outcome.refused.push({ section, reason: 'the section is not a mapping of fields' })
      deps.logger.warn('web-ui-settings: legacy section %s is not a mapping of fields and was not imported into entry %s', section, target.entryId)
      continue
    }
    const planned = patchFor(target, value)
    if (planned === undefined) {
      // Nothing to write: the user layer already carries every field, or holds
      // the target path whole. The section is still recorded, so a value the
      // user clears later stays cleared instead of being imported next boot.
      outcome.imported.push(section)
    } else {
      try {
        await deps.settings.update(target.entryId, planned.patch, target.descriptor.revision)
      } catch (error) {
        const reason = reasonOf(error)
        outcome.refused.push({ section, reason })
        deps.logger.warn('web-ui-settings: legacy section %s was not imported into entry %s: %s', section, target.entryId, reason)
        continue
      }
      outcome.imported.push(section)
      // The write moved the entry's revision and user layer: re-read the view
      // so a later section targeting the same entry is judged against it.
      served = project()
    }
    records[section] = {
      entryId: target.entryId,
      path: [...target.path],
      fields: planned === undefined ? [] : planned.fields,
      importedAt: now().toISOString(),
    }
    try {
      writeLegacyImportMarker(deps.markerPath, { version: LEGACY_IMPORT_MARKER_VERSION, sections: records })
    } catch (error) {
      deps.logger.warn('web-ui-settings: the legacy import marker %s could not be written, sections may be imported again: %s', deps.markerPath, reasonOf(error))
    }
  }
  deps.logger.info(
    'web-ui-settings: legacy family settings import: imported %s, already recorded %s, left alone %s section(s), refused %s',
    listOf(outcome.imported), listOf(outcome.done), String(outcome.skipped.length), listOf(outcome.refused.map(entry => entry.section)),
  )
  if (outcome.unserved.length > 0) {
    deps.logger.info('web-ui-settings: legacy family sections %s name a namespace no served entry owns and stay in the document', listOf(outcome.unserved))
  }
  if (outcome.ambiguous.length > 0) {
    deps.logger.info('web-ui-settings: legacy sections %s are declared by more than one served entry and stay in the document', listOf(outcome.ambiguous))
  }
  return outcome
}

/** The Loader's settle seam as the Host boot installs it. */
interface CompositionLoader {
  await(): Promise<void>
}

/**
 * Resolve once the composition has settled every entry, so the roster and the
 * settings view this import reads are complete. Read structurally: the family
 * package does not depend on cordis-plugin-loader, whose Context augmentation
 * is what types `loader` for a Host plugin. A host without the seam, or one
 * whose settle promise rejects, imports on the view it has: a section the Host
 * does not serve yet stays unrecorded and is retried on the next boot.
 * @param root - the root context (`ctx.root`).
 * @returns a promise that settles when the import may read the configuration.
 */
export function compositionSettled(root: unknown): Promise<void> {
  const loader = isRecord(root) ? root.loader : undefined
  const settle = isRecord(loader) ? loader.await : undefined
  if (typeof settle !== 'function') return Promise.resolve()
  return Promise.resolve((settle as () => Promise<unknown>).call(loader)).then(() => undefined, () => undefined)
}
