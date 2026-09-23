/**
 * One preference family as a section of this plugin's own configuration form.
 *
 * 0.1.7 addresses configuration as ONE form per profile entry
 * (`ctx.configForms.get(entryId)`) and serves a plugin's own `Config` schema
 * as its settings page; the previous cohort's per-namespace settings scopes
 * are gone. The skin center's three preference families are sections of that
 * one Config, so this wrapper projects the entry form onto one section: the
 * controllers keep addressing their own fields, and every write is queued on
 * the shared form as a path-addressed mutation.
 *
 * The projected fields are declared volatile in the Host schema, which is
 * what makes the Host accept the write, apply it live, and never remount the
 * row (see `Config` in src/index.ts).
 */

import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'

/** The JSON value one wire field write admits. */
type WireValue = Extract<SettingsPathOpView, { op: 'set' }>['value']

/** Read one object-shaped layer of a form snapshot. */
function layerOf(layer: unknown, key: string): unknown {
  return typeof layer === 'object' && layer !== null ? (layer as Record<string, unknown>)[key] : undefined
}

/**
 * Project one entry form onto the section behind `key`.
 * @param parent - the form of the profile entry that owns this section.
 * @param key - the section key inside the entry's Config.
 * @returns the section's form: its own value/user/base layers, and writes
 *   addressed at `[key, field]` on the parent.
 */
export function settingsSection<T>(parent: ConfigForm<unknown>, key: string): ConfigForm<T> {
  let source: ConfigFormSnapshot<unknown> | undefined
  let projected: ConfigFormSnapshot<T> | undefined
  // The form contract promises a stable snapshot reference until the next
  // change; the parent's snapshot is that signal, so a projection of the same
  // parent snapshot is reused instead of rebuilt on every read.
  const project = (): ConfigFormSnapshot<T> => {
    const snapshot = parent.getSnapshot()
    if (projected !== undefined && source === snapshot) return projected
    source = snapshot
    projected = {
      status: snapshot.status,
      value: layerOf(snapshot.value, key) as T | undefined,
      base: layerOf(snapshot.base, key),
      user: layerOf(snapshot.user, key),
      revision: snapshot.revision,
      writable: snapshot.writable,
      mode: snapshot.mode,
    }
    return projected
  }
  return {
    getSnapshot: project,
    subscribe: listener => parent.subscribe(listener),
    set: (field, value) => parent.mutate([{ op: 'set', path: [key, field], value: value as WireValue }]),
    unset: field => parent.mutate([{ op: 'unset', path: [key, field] }]),
    mutate: (ops, expectedRevision) => parent.mutate(ops.map(op => 'value' in op
      ? { op: 'set', path: [key, ...op.path], value: op.value }
      : { op: 'unset', path: [key, ...op.path] }), expectedRevision),
  }
}
