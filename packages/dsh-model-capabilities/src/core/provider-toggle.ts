/**
 * Provider disable/enable core: the disabled-profile archive and the path ops
 * a toggle performs.
 *
 * Disabling a provider uses the only sanctioned seam that takes it out of the
 * model catalog (which both the composer picker and the subagent selection
 * read): unset `llm-pi-ai.providers.<route>` — the same write the official
 * Remove-provider button performs. Because that deletes the profile, the
 * toggle first stashes it in this plugin's own settings entry (the `disabled`
 * field of its own Config) under `disabled.<route>`; enabling restores the
 * profile verbatim and clears the archive entry. Orderings are chosen so the
 * worst case is a harmless duplicate archive, never a lost profile.
 *
 * @module @linxin666/dsh-client-ui-model-capabilities/core/provider-toggle
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { PathOp, SetPathOp } from './capabilities.ts'

/**
 * Profile entry ids this plugin's own row carries, in resolution order.
 *
 * The 0.1.7 settings surface addresses one form per ACTIVE PROFILE ENTRY ID
 * (`ctx.configForms.get(entryId)`, `settings.describe()` keyed by entry id)
 * and carries no package identity, so this plugin's own settings entry is the
 * profile row that mounts it — and that row id differs per install source: the
 * package's own cordis.patch.yml inserts `ui-model-capabilities`, while the
 * aggregate bundle namespaces every child row as `web-ui-*`
 * (scripts/aggregate.mjs) and mounts the same plugin under
 * `web-ui-model-capabilities`.
 */
export const CAPS_ENTRY_IDS: readonly string[] = ['ui-model-capabilities', 'web-ui-model-capabilities']

/** One served settings form, as much of it as the archive resolution reads. */
export interface ServedSettingsForm {
  /** Profile entry id the Host serves this form under. */
  ns: string
  /** Serialized form schema (`SettingsNamespaceView['schema']`). */
  schema?: unknown
}

/** Whether a value is a plain data object (not an array or null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Resolve one node of a serialized schema. A schemastery `toJSON()` envelope
 * keeps every node in `refs` and refers to it by uid, so a field reference is
 * either that uid or — in a hand-built schema — the node itself.
 */
function schemaNode(value: unknown, refs: Record<string, unknown>): Record<string, unknown> | undefined {
  if (isRecord(value) && typeof value['type'] === 'string') return value
  const key = isRecord(value) ? value['uid'] : value
  if (key === undefined) return undefined
  const node = refs[String(key)]
  return isRecord(node) ? node : undefined
}

/**
 * Whether one served form schema is this plugin's own archive schema: a single
 * open-typed `disabled` field, exactly the shape the host half's Config
 * declares. Identifies this plugin's entry when the profile renamed the row.
 */
function isArchiveSchema(schema: unknown): boolean {
  if (!isRecord(schema)) return false
  const refs = isRecord(schema['refs']) ? schema['refs'] : {}
  const root = schemaNode(schema, refs)
  if (root?.['type'] !== 'object' || !isRecord(root['dict'])) return false
  const fields = Object.keys(root['dict'])
  if (fields.length !== 1 || fields[0] !== 'disabled') return false
  return schemaNode(root['dict'][fields[0]], refs)?.['type'] === 'any'
}

/**
 * Resolve the served settings form that is this plugin's own settings entry:
 * the row id this deployment mounts it under, or the entry whose form schema
 * is this plugin's archive schema (a profile that renamed the row).
 * @param namespaces - every form the Host served in one describe answer.
 * @returns the entry id and its view, or undefined when nothing served is this plugin's entry.
 */
export function resolveArchiveEntry<T extends ServedSettingsForm>(
  namespaces: readonly T[],
): { entryId: string, view: T } | undefined {
  for (const id of CAPS_ENTRY_IDS) {
    const view = namespaces.find(form => form.ns === id)
    if (view !== undefined) return { entryId: id, view }
  }
  const view = namespaces.find(form => isArchiveSchema(form.schema))
  return view === undefined ? undefined : { entryId: view.ns, view }
}

/** One archived provider profile. */
export interface StashedProvider {
  /** The profile exactly as the user layer held it (open structure, verbatim). */
  profile: Record<string, unknown>
  /** Display name at disable time, for the archive listing. */
  displayName?: string
}

/** Whether a value is a plain data object (not an array, null, or class instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse the archive from the namespace's resolved value: `disabled` keyed by
 * route id. Malformed entries are skipped (a stash this plugin did not write
 * must not break the listing).
 */
export function readDisabledStore(value: unknown): Record<string, StashedProvider> {
  const out: Record<string, StashedProvider> = {}
  if (!isPlainObject(value) || !isPlainObject(value['disabled'])) return out
  const disabled = value['disabled']
  for (const [route, entry] of Object.entries(disabled)) {
    if (!isPlainObject(entry) || !isPlainObject(entry['profile'])) continue
    out[route] = {
      profile: entry['profile'],
      ...(typeof entry['displayName'] === 'string' && entry['displayName'].length > 0
        ? { displayName: entry['displayName'] }
        : {}),
    }
  }
  return out
}

/** Whether one settings layer holds a profile for the route. */
export function hasProfileAt(section: unknown, route: string): boolean {
  if (!isPlainObject(section) || !isPlainObject(section['providers'])) return false
  return isPlainObject(section['providers'][route])
}

/**
 * Whether a layer other than the user section holds the route, so unsetting the
 * user profile would not take the provider down. The composition `base` layer
 * answers directly when the view carries it; a view without `base` falls back
 * to "the resolved value has it but the user layer does not".
 */
export function hasNonUserProfile(
  view: { user?: unknown, base?: unknown, value?: unknown },
  route: string,
): boolean {
  if (view.base !== undefined) return hasProfileAt(view.base, route)
  return !hasProfileAt(view.user, route) && hasProfileAt(view.value, route)
}

/** Archive one profile: `disabled.<route> = stash` in the plugin namespace. */
export function buildStashOp(route: string, stash: StashedProvider): SetPathOp {
  // The stash is the JSON-parsed stored profile plus a display-name string.
  return { op: 'set', path: ['disabled', route], value: stash as unknown as JsonValue }
}

/** Drop one archive entry: unset `disabled.<route>` in the plugin namespace. */
export function buildUnstashOp(route: string): PathOp {
  return { op: 'unset', path: ['disabled', route] }
}

/** Take the route down: unset `providers.<route>` in the pi-ai namespace. */
export function buildUnsetProviderOp(route: string): PathOp {
  return { op: 'unset', path: ['providers', route] }
}

/** Bring the route back: restore the archived profile verbatim. */
export function buildRestoreProviderOp(route: string, profile: Record<string, unknown>): SetPathOp {
  return {
    op: 'set',
    path: ['providers', route],
    // The profile came from a JSON-parsed stored view, so it is JSON-shaped.
    value: profile as unknown as JsonValue,
  }
}
