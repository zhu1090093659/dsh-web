/**
 * Gateway listing: the installed-plugin inventory read from the profile's
 * package.json, its node_modules manifests, and the patch rows' enablement.
 * The npm web runtime has no installer inventory service, so this module is
 * the read side of the gateway (the write side is the official CLI).
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstalledPluginItem } from '../core/protocol.ts'
import type { LayerSnapshot } from '../core/patch-diff.ts'
import { bareRowEnabled, bareRowId, claimedIdsOf, insertRowsOf, parsePatch } from './rows.ts'
import { readProfileManifest, type ProfileFacts } from './profile.ts'

/** The listing result: plugin rows plus the raw layer snapshot for diffs. */
export interface GatewaySnapshot {
  plugins: InstalledPluginItem[]
  layer: LayerSnapshot
}

/** The node_modules path of one (possibly scoped) package name. */
function modulePathOf(profileDir: string, name: string): string {
  return join(profileDir, 'node_modules', ...name.split('/'))
}

/** Whether an install spec names a git/file/link source rather than a registry package. */
export function sourceKindOf(spec: string): 'npm' | 'git' {
  return /^(link:|file:|git:|github:|git\+|https?:\/\/github\.com)/.test(spec) ? 'git' : 'npm'
}

/**
 * The entry ids one installed dependency claims: the insert ids of its own
 * bundle patch, falling back to the package name. Shared by the listing read
 * side and the set-enabled write side so both agree on the id space — writing
 * package-name rows while reading bundle-patch ids made the switches inert.
 * @param facts - resolved profile locations.
 * @param name - dependency name (possibly scoped).
 * @returns the claimed entry ids, never empty.
 */
export async function claimedEntryIdsOf(facts: ProfileFacts, name: string): Promise<string[]> {
  const patchPath = join(modulePathOf(facts.profileDir, name), 'cordis.patch.yml')
  try {
    const text = await readFile(patchPath, 'utf8')
    const ids = claimedIdsOf(text)
    if (ids.length > 0) return ids
  } catch {
    // Missing bundle patch: a plain plugin claims its own name.
  }
  return [name]
}

/**
 * The insert rows one installed dependency claims, id plus the entry's own
 * name (falling back to the package name for plain plugins). The set-enabled
 * write side needs the entry's own name: the include patch semantics skip a
 * bare override row whose name mismatches the inserted entry's name.
 * @param facts - resolved profile locations.
 * @param name - dependency name (possibly scoped).
 * @returns the claimed rows, never empty.
 */
export async function claimedEntryRowsOf(facts: ProfileFacts, name: string): Promise<Array<{ id: string; name: string }>> {
  const patchPath = join(modulePathOf(facts.profileDir, name), 'cordis.patch.yml')
  try {
    const text = await readFile(patchPath, 'utf8')
    const rows = insertRowsOf(text)
    const claimed = rows.filter((row): row is { id: string; name?: string } => row.id !== undefined)
    if (claimed.length > 0) return claimed.map(row => ({ id: row.id, name: row.name ?? name }))
  } catch {
    // Missing bundle patch: a plain plugin claims its own name.
  }
  return [{ id: name, name }]
}

/**
 * Build one installed-plugin row from the profile facts: version from the
 * installed manifest, enablement from the entry ids its own bundle patch
 * claims (plain plugins use the package name as the row id).
 * @param facts - resolved profile locations.
 * @param name - dependency name (possibly scoped).
 * @param spec - the install spec recorded in the profile dependencies.
 * @param rowEnabled - row enablement by id.
 * @returns the wire-shaped plugin row.
 */
export async function buildPluginRow(
  facts: ProfileFacts,
  name: string,
  spec: string,
  rowEnabled: ReadonlyMap<string, boolean>,
): Promise<InstalledPluginItem> {
  const moduleDir = modulePathOf(facts.profileDir, name)
  let version = 'unknown'
  try {
    const parsed = JSON.parse(await readFile(join(moduleDir, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof parsed.version === 'string') version = parsed.version
  } catch {
    version = 'unknown'
  }

  let bundlePatch = '[]'
  const bundlePatchPath = join(moduleDir, 'cordis.patch.yml')
  if (existsSync(bundlePatchPath)) {
    try {
      bundlePatch = await readFile(bundlePatchPath, 'utf8')
    } catch {
      bundlePatch = '[]'
    }
  }
  const claimed = claimedIdsOf(bundlePatch)
  const entryIds = claimed.length > 0 ? claimed : [name]
  const enabled = entryIds.every(id => rowEnabled.get(id) ?? true)

  return {
    id: name,
    name,
    version,
    source: { kind: sourceKindOf(spec), spec },
    installedAt: '',
    enabled,
  }
}

/**
 * Build the gateway listing and the layer snapshot.
 * @param facts - resolved profile locations.
 * @param patchText - current profile patch text.
 * @returns plugin rows (wire shape of the official list) and the layer state.
 */
export async function snapshotGateway(facts: ProfileFacts, patchText: string): Promise<GatewaySnapshot> {
  const manifest = await readProfileManifest(facts.packageJsonPath)

  // Row enablement by id, read from the patch (fail-loud on invalid YAML:
  // a broken patch file is a repair scenario, never silently skipped).
  const parsed = parsePatch(patchText, facts.patchPath)
  const rowEnabled = new Map<string, boolean>()
  for (const item of parsed.root.items) {
    const id = bareRowId(item)
    if (id !== undefined) rowEnabled.set(id, bareRowEnabled(item))
  }

  const plugins: InstalledPluginItem[] = []
  for (const name of Object.keys(manifest.dependencies).sort()) {
    plugins.push(await buildPluginRow(facts, name, manifest.dependencies[name], rowEnabled))
  }

  return {
    plugins,
    layer: { rows: rowEnabled, bundles: manifest.bundles },
  }
}
