/**
 * The panel's own "switched off" set for plugin-provided skills.
 *
 * A skill whose instruction file comes from a plugin provider — the registry
 * reports `SkillSummary.path`, but the file sits outside every skill root this
 * panel scans — has no writable path, so the SKILL.md frontmatter switch the
 * other rows use cannot address it (and offering that switch would only produce
 * a 404). This store is the plugin's own answer: one small JSON document under
 * `$DSH_HOME/dsh-skill-explorer/` listing the provider-backed skills the user
 * switched off in the panel, keyed by the stable pair (provider, skill name).
 *
 * It is a PANEL-LOCAL decision: the host registry still loads the skill, so the
 * panel copy and the README say so plainly instead of pretending the model
 * stopped receiving it. What the store does change is this panel's invocable
 * view (see applyProviderToggles in collect.ts), which is the scope the issue
 * accepts.
 *
 * Writes are atomic (unique temp file, fsync, rename), so an interrupted write
 * can never leave a half-written document behind.
 */

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSkillName } from './collect.ts'

/**
 * Stable identity of one plugin-provided skill in this store.
 *
 * The name alone is not enough: the registry merges by name, but two providers
 * can each supply a file for the same name, and only the pair identifies which
 * one a row shows. An absent provider normalizes to the empty string so the
 * same skill always maps to the same record.
 */
export interface ProviderSkillIdentity {
  /** Official skill name (the grammar isSkillName enforces). */
  name: string
  /** Provider id as the registry reports it ('' when it reports none). */
  provider: string
}

/** The stored document: the provider-backed skills the user switched off. */
export interface ProviderToggleDocument {
  version: 1
  disabled: ProviderSkillIdentity[]
}

/**
 * Bound on the stored set. The panel only ever offers a switch for a skill it
 * lists, so a healthy installation holds a handful of records; the cap keeps a
 * corrupt or hand-edited document from growing without limit.
 */
const MAX_DISABLED = 512

/**
 * Bound on one provider id. Cordis provider ids are short module or plugin
 * names; a longer value is not a provider id this store will record.
 */
const MAX_PROVIDER_LENGTH = 200

/** Per-process counter so two concurrent writes never share a temp file name. */
let tempSeq = 0

/** Store file location: $DSH_HOME/dsh-skill-explorer/provider-toggles.json. */
export function providerToggleFile(dshHome: string): string {
  return join(dshHome, 'dsh-skill-explorer', 'provider-toggles.json')
}

/** The document a panel that has never been switched off reads as. */
export function emptyProviderToggles(): ProviderToggleDocument {
  return { version: 1, disabled: [] }
}

/**
 * Normalize a submitted identity, or reject it.
 *
 * The name must satisfy the official skill grammar (the same one the scan and
 * the file write routes apply), and the provider must be a short id: both are
 * written into the store verbatim, so an unbounded or ungrammatical value would
 * be a record no row could ever match.
 * @param name - candidate skill name from the panel.
 * @param provider - candidate provider id (optional).
 * @returns the normalized identity, or undefined when it is not storable.
 */
export function providerSkillIdentity(name: string, provider?: string): ProviderSkillIdentity | undefined {
  if (!isSkillName(name)) return undefined
  const id = typeof provider === 'string' ? provider.trim() : ''
  if (id.length > MAX_PROVIDER_LENGTH) return undefined
  return { name, provider: id }
}

/** Map key for one identity; JSON keeps the pair unambiguous for any provider id. */
function keyOf(identity: ProviderSkillIdentity): string {
  return JSON.stringify([identity.provider, identity.name])
}

/**
 * Total order over identities (plain comparison, never locale-dependent), so
 * the stored document reads like the skill list: by name, then by provider.
 */
function compareIdentities(left: ProviderSkillIdentity, right: ProviderSkillIdentity): number {
  if (left.name !== right.name) return left.name < right.name ? -1 : 1
  if (left.provider !== right.provider) return left.provider < right.provider ? -1 : 1
  return 0
}

/**
 * Tolerant deserialize: a missing, corrupt, or foreign document reads as "no
 * skill switched off", which is the state a fresh install is in. Records that
 * no row could match (an ungrammatical name, an over-long provider id, a
 * duplicate) are dropped rather than carried forward.
 * @param raw - file text.
 * @returns the usable records, de-duplicated, bounded and sorted.
 */
export function deserializeProviderToggles(raw: string): ProviderToggleDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyProviderToggles()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyProviderToggles()
  const doc = parsed as { version?: unknown; disabled?: unknown }
  if (doc.version !== 1 || !Array.isArray(doc.disabled)) return emptyProviderToggles()
  const seen = new Set<string>()
  const disabled: ProviderSkillIdentity[] = []
  for (const value of doc.disabled) {
    if (typeof value !== 'object' || value === null) continue
    const entry = value as { name?: unknown; provider?: unknown }
    if (typeof entry.name !== 'string' || typeof entry.provider !== 'string') continue
    const identity = providerSkillIdentity(entry.name, entry.provider)
    if (identity === undefined) continue
    const key = keyOf(identity)
    if (seen.has(key)) continue
    seen.add(key)
    disabled.push(identity)
    if (disabled.length >= MAX_DISABLED) break
  }
  return { version: 1, disabled: disabled.sort(compareIdentities) }
}

/** Serialize the document in the shape deserializeProviderToggles accepts. */
export function serializeProviderToggles(doc: ProviderToggleDocument): string {
  return JSON.stringify({ version: 1, disabled: doc.disabled }, null, 1)
}

/**
 * Read the store for a panel request.
 *
 * An unreadable file degrades to the empty document on purpose: the panel then
 * shows every provider skill as enabled, which is the state before the user
 * ever used the switch, instead of failing the whole list route.
 * @param dshHome - the DSH home root.
 * @returns the records the panel currently honors.
 */
export async function readProviderToggles(dshHome: string): Promise<ProviderToggleDocument> {
  try {
    return deserializeProviderToggles(await readFile(providerToggleFile(dshHome), 'utf8'))
  } catch {
    return emptyProviderToggles()
  }
}

/** Atomic JSON write: unique temp file, fsync, rename. */
async function writeJsonAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  tempSeq += 1
  const temp = `${path}.${process.pid}.${tempSeq}.tmp`
  try {
    const handle = await open(temp, 'w')
    try {
      await handle.writeFile(value, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, path)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

/**
 * Record (or clear) the panel-local switch for one provider-backed skill.
 *
 * Both directions are idempotent: switching the same skill off twice keeps one
 * record instead of stacking duplicates, and switching on a skill that is not
 * stored leaves the file untouched. A no-op write is skipped so an unchanged
 * panel never rewrites the document.
 * @param dshHome - the DSH home root.
 * @param identity - the normalized provider-backed skill identity.
 * @param enabled - true to enable (drop the record), false to disable.
 * @returns the document as it stands after the call.
 */
export async function setProviderSkillEnabled(
  dshHome: string,
  identity: ProviderSkillIdentity,
  enabled: boolean,
): Promise<ProviderToggleDocument> {
  const doc = await readProviderToggles(dshHome)
  const stored = doc.disabled.some((entry) => keyOf(entry) === keyOf(identity))
  if (stored === !enabled) return doc
  const disabled = (enabled
    ? doc.disabled.filter((entry) => keyOf(entry) !== keyOf(identity))
    : [...doc.disabled, identity]
  ).sort(compareIdentities)
  const next: ProviderToggleDocument = { version: 1, disabled }
  await writeJsonAtomic(providerToggleFile(dshHome), serializeProviderToggles(next))
  return next
}
