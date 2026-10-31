/**
 * Post-mutation duplicate-mount guard for the gateway host half. The official
 * CLI's bundle reconciliation appends EVERY dependency that declares
 * `dsh.bundle` to the profile manifest's `dsh.profile.bundles` — including
 * packages the composition already mounts through a patch row (the family
 * aggregate mounts dsh-better-sidebar as the insert row
 * `{ id: 'better-sidebar', name: 'dsh-better-sidebar' }` while the package
 * also sits in the profile's dependencies). The bundles layer then mounts the
 * package a second time and the next boot dies on duplicate routes
 * (`webserver: duplicate prefix route "/sidebar/api"`). This module decides,
 * from the before-state composition, which newly added bundles entries are
 * such duplicate mounts; the gateway strips exactly those entries back out.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMap } from 'yaml'
import { bareRowEnabled, bareRowName, insertRowsOf, parsePatch, type InsertRow } from './rows.ts'
import { stripBom, type ProfileFacts } from './profile.ts'

/** The before-state composition facts the guard reads. */
export interface GuardSnapshot {
  /** The profile patch text captured before the mutation. */
  patchText: string
  /** Dependency names captured before the mutation. */
  dependencies: readonly string[]
  /** Profile-layer row enablement by entry id (bare rows), before the mutation. */
  rowEnabled: ReadonlyMap<string, boolean>
}

/**
 * The bundles entries a mutation newly added: present after, absent before.
 * Entries the user already had are never the guard's business.
 * @param before - bundles list before the mutation.
 * @param after - bundles list after the mutation.
 * @returns the newly added entries, in after-state order.
 */
export function newlyAddedBundles(before: readonly string[], after: readonly string[]): string[] {
  return after.filter(name => !before.includes(name))
}

/**
 * Record one candidate row: an enabled row mounts its named package; a row
 * the profile layer disables (bare `disabled: true` override matching the
 * row id) mounts nothing, so it never justifies stripping a bundles entry.
 */
function collectRow(mounted: Set<string>, rowEnabled: ReadonlyMap<string, boolean>, row: InsertRow): void {
  if (row.name === undefined || row.name === '') return
  if (row.id !== undefined && rowEnabled.get(row.id) === false) return
  mounted.add(row.name)
}

/**
 * The package names the before-state composition already mounts through patch
 * rows: the profile patch's own rows (bare and insert-format) plus every
 * before-state dependency's own bundle patch insert entries (the aggregate's
 * rows section lives there, not in the profile layer). A tolerant read: a
 * broken patch file yields no names rather than failing the mutation.
 * @param facts - resolved profile locations.
 * @param before - the before-state capture.
 * @returns the set of row-mounted package names.
 */
export async function rowMountedPackageNames(facts: ProfileFacts, before: GuardSnapshot): Promise<ReadonlySet<string>> {
  const mounted = new Set<string>()
  try {
    const { root } = parsePatch(before.patchText, facts.patchPath)
    for (const item of root.items) {
      if (!isMap(item)) continue
      const name = bareRowName(item)
      if (name !== undefined && bareRowEnabled(item)) mounted.add(name)
    }
  } catch {
    // A broken profile patch yields no bare-row names; the CLI owns the error.
  }
  for (const row of insertRowsOf(before.patchText)) {
    collectRow(mounted, before.rowEnabled, row)
  }
  for (const dependency of before.dependencies) {
    const patchPath = join(facts.profileDir, 'node_modules', ...dependency.split('/'), 'cordis.patch.yml')
    let text: string
    try {
      text = await readFile(patchPath, 'utf8')
    } catch {
      continue
    }
    for (const row of insertRowsOf(text)) {
      collectRow(mounted, before.rowEnabled, row)
    }
  }
  return mounted
}

/**
 * The newly added bundles entries that duplicate an existing row mount and
 * must be stripped to keep the next boot alive.
 * @param facts - resolved profile locations.
 * @param before - the before-state capture.
 * @param beforeBundles - the bundles list before the mutation.
 * @param afterBundles - the bundles list after the mutation.
 * @returns the entries to remove from `dsh.profile.bundles`.
 */
export async function duplicateMountBundles(
  facts: ProfileFacts,
  before: GuardSnapshot,
  beforeBundles: readonly string[],
  afterBundles: readonly string[],
): Promise<string[]> {
  const added = newlyAddedBundles(beforeBundles, afterBundles)
  if (added.length === 0) return []
  const mounted = await rowMountedPackageNames(facts, before)
  return added.filter(name => mounted.has(name))
}

/**
 * Whether an installed dependency declares its own bundle patch (`dsh.bundle`
 * in its package.json) — the fact the official CLI's reconciliation selects a
 * dependency on. A package that declares none is a plain dependency of some
 * mounted bundle and never enters the selection.
 * @param facts - resolved profile locations.
 * @param name - dependency name (possibly scoped).
 * @returns whether the installed package declares `dsh.bundle`; a package that
 *   cannot be read proves nothing and answers false.
 */
export async function declaresBundle(facts: ProfileFacts, name: string): Promise<boolean> {
  let text: string
  try {
    text = await readFile(join(facts.profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')
  } catch {
    return false
  }
  try {
    const parsed = JSON.parse(stripBom(text)) as { dsh?: { bundle?: unknown } }
    const bundle = parsed.dsh?.bundle
    return typeof bundle === 'object' && bundle !== null
  } catch {
    return false
  }
}
