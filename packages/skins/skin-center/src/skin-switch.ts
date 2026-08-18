/**
 * In-process skin switching for the skin center — the official `dsh-skin use`
 * CLI, re-implemented as a pure ESM module so the host half never needs a
 * `dsh-skin` binary on PATH (the bug zhu1090093659/dsh-web-ui#5: "dsh-skin
 * CLI not found on PATH").
 *
 * `use` owns the `dsh-skin managed` section of the active profile's
 * `cordis.patch.yml` (atomic rewrite, hot-reloaded by the DSH config watcher
 * within seconds, no restart) and the profile node_modules symlink that makes
 * the selected skin resolvable from the running profile. `current` reads the
 * active state back. Keeping the patch profile-scoped prevents non-Web
 * profiles such as dsh-tui from trying to resolve browser-only skin packages.
 *
 * The behaviour/text is a 1:1 port of scripts/dsh-skin (`use`/`current`;
 * workspace assets live in packages/skins/<id>). The skin registry is
 * derived from each packages/skins/<id>/skin.json instead of a hand-written
 * dictionary, so adding a skin needs no code change here.
 * @module @linxin666/dsh-client-ui-skin-center/skin-switch
 */

import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join as joinPath, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Walk up from a file location to the nearest @linxin666/ scoped dir
 * whose entries actually hold skin packages (dsh-skins carrier or
 * dsh-client-ui-skin-* packages). pnpm's virtual store realpaths packages
 * into node_modules/.pnpm/<pkg>@<ver>/node_modules/<name>, so a plain
 * '../../' from the skin-center package can never see its siblings there —
 * this anchor finds the scoped dir that owns them.
 * @param fromDir - the realpathed package dir to walk up from.
 * @returns the scoped skin dir (the skins root), or null when none is found.
 */
export function findScopedAnchor(fromDir: string): string | null {
  let current = fromDir
  for (;;) {
    const scoped = joinPath(current, '@linxin666')
    try {
      for (const entry of readdirSync(scoped)) {
        // A real skin home: the dsh-skins carrier or per-skin packages.
        // The skin-center manager itself is not a skin home.
        if (entry === 'dsh-skins') return scoped
        if (entry.startsWith('dsh-client-ui-skin-') && entry !== 'dsh-client-ui-skin-center') return scoped
      }
    } catch {
      // No scoped dir at this level — keep walking up.
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Resolve the directory that holds the skin packages (each a dir carrying a
 * skin.json). Candidates, in order:
 *  - monorepo / flat npm layout: new URL('../../', import.meta.url)
 *    (packages/skins/ or node_modules/@linxin666/);
 *  - pnpm virtual-store layout: the nearest @linxin666/ scoped dir found by
 *    walking up from this package's realpathed location;
 *  - the legacy '../../../skins/' spelling (which pointed at
 *    node_modules/skins/ under npm — the ENOENT of
 *    zhu1090093659/dsh-web-ui#21/#33/#34), kept as a fallback.
 * DSH_SKINS_DIR overrides everything (tests use it).
 * @param fromUrl - the module URL to resolve from (defaults to this module's
 *   own import.meta.url); injectable so tests can place the module inside a
 *   simulated install layout and exercise the real candidate chain.
 */
export function resolveSkinsDir(fromUrl: string = import.meta.url): string {
  const fromEnv = process.env.DSH_SKINS_DIR
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  const here = fileURLToPath(fromUrl)
  const candidates = [
    fileURLToPath(new URL('../../', fromUrl)),
    findScopedAnchor(dirname(here)),
    fileURLToPath(new URL('../../../skins/', fromUrl)),
  ].filter((candidate): candidate is string => candidate !== null)
  for (const candidate of candidates) {
    if (listSkinDirCandidates(candidate).length > 0) return candidate
  }
  // Nothing probed: fall back to the primary candidate; readSkinMeta skips
  // unreadable entries and callers surface an empty registry.
  return candidates[0]
}

/** The skin-package root for this install (see resolveSkinsDir). */
export const SKINS_DIR = resolveSkinsDir()

/** Managed patch-section delimiters (the CLI's SINGLE authority boundaries). */
export const MANAGED_START = '# --- dsh-skin managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end dsh-skin managed ---'

/** Legal npm package name (scoped or unscoped). skin.json `package` is joined
 * into profile node_modules paths and rendered into YAML, so it must never
 * carry path separators, quotes, newlines, or leading dots. */
const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Legal cordis loader entry id for a skin insert row. */
const WIRING_ID_RE = /^ui-skin-[a-z0-9-]+$/

/** One skin's switch metadata, derived from its packages/skins/<id>/skin.json. */
export interface SkinSwitchEntry {
  /** Cordis plugin package (the boot-graph entry id when active). */
  pkg: string
  /** cordis.patch.yml row id (skin.json wiring.id). */
  id: string
  /** Absolute repo dir of the skin package. */
  dir: string
  /** Whether the bundle layer already wires the skin (no insert row needed). */
  bundleWired: boolean
}

/**
 * Parse the switch-relevant fields of one skin.json. Returns null for
 * anything that is not a valid skin so it is simply skipped — never walking
 * outside the skins tree (the id is validated before any path use).
 * @param absDir - absolute path of the candidate skin directory.
 */
function readSkinMeta(absDir: string): { id: string; package: string; wiring: { id: string; bundleWired: boolean } } | null {
  try {
    const meta: unknown = JSON.parse(readFileSync(joinPath(absDir, 'skin.json'), 'utf8'))
    if (typeof meta !== 'object' || meta === null) return null
    const record = meta as Record<string, unknown>
    if (typeof record.id !== 'string' || !/^[a-z0-9-]+$/.test(record.id)) return null
    if (typeof record.package !== 'string' || !NPM_PACKAGE_NAME_RE.test(record.package)) return null
    const wiring = record.wiring
    const wiringRecord = (typeof wiring === 'object' && wiring !== null) ? (wiring as Record<string, unknown>) : null
    if (wiringRecord === null || typeof wiringRecord.id !== 'string' || !WIRING_ID_RE.test(wiringRecord.id)) return null
    return {
      id: record.id,
      package: record.package,
      wiring: {
        id: wiringRecord.id,
        bundleWired: wiringRecord.bundleWired === true,
      },
    }
  } catch {
    return null
  }
}

/**
 * Enumerate every candidate skin directory under a skins root. Two shapes:
 *  - direct subdirectories carrying a skin.json (monorepo packages/skins/<id>,
 *    and per-skin npm packages @linxin666/dsh-client-ui-skin-<id>);
 *  - the bundled-skins carrier: @linxin666/dsh-skins/skins/<id> (skin assets
 *    shipped inside the dsh-skins aggregate so npm needs no per-skin
 *    package names). Directories without a skin.json are skipped.
 * @param skinsDir - the skins root.
 * @returns absolute candidate dirs (possibly empty).
 */
export function listSkinDirCandidates(skinsDir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(skinsDir)
  } catch {
    return out
  }
  // Non-directory entries (stray files) must be skipped without throwing:
  // statSync on "<file>/skin.json" raises ENOTDIR, which throwIfNoEntry
  // does not suppress. resolveSkinsDir probes at module load, so a single
  // stray file would otherwise crash the whole plugin.
  const isDir = (p: string): boolean => statSync(p, { throwIfNoEntry: false })?.isDirectory() === true
  // Pass 1: direct skin dirs (monorepo / legacy per-skin packages). Kept
  // first so that on an id collision with the carrier below, the direct
  // package deterministically wins in loadRegistry.
  for (const dir of entries) {
    const candidate = joinPath(skinsDir, dir)
    // Skip symlink entries: statSync follows links, so the profile
    // symlinks that ensureSymlink previously managed (e.g.
    // node_modules/@linxin666/dsh-skins -> real dir) would otherwise be
    // mis-registered as skin candidates under the link path itself,
    // poisoning entry.dir and letting ensureSymlink build a
    // self-referential link (issue #43, ELOOP). Only real dirs are skin
    // homes; real skins reachable through a carrier are handled in Pass 2.
    if (lstatSync(candidate, { throwIfNoEntry: false })?.isSymbolicLink() === true) continue
    if (!isDir(candidate)) continue
    if (statSync(joinPath(candidate, 'skin.json'), { throwIfNoEntry: false })) out.push(candidate)
  }
  // Pass 2: the bundled-skins carrier dsh-skins/skins/<id>.
  const bundled = joinPath(skinsDir, 'dsh-skins', 'skins')
  let subdirs: string[]
  try {
    subdirs = readdirSync(bundled)
  } catch {
    return out
  }
  for (const sub of subdirs) {
    const subDir = joinPath(bundled, sub)
    if (!isDir(subDir)) continue
    if (statSync(joinPath(subDir, 'skin.json'), { throwIfNoEntry: false })) out.push(subDir)
  }
  return out
}

/**
 * Derive the skin registry from each skin dir's skin.json — the single
 * source of truth (skin.json already carries package/wiring.id/bundleWired).
 * Replaces the CLI's hand-maintained SKINS dictionary, so adding a skin
 * needs no code change here. Candidate dirs come from
 * listSkinDirCandidates (direct skin dirs + the dsh-skins bundled carrier).
 * The root is injectable so tests can point at either install layout.
 * @param skinsDir - the skins root (defaults to the resolved install layout).
 * @returns skin id -> switch metadata.
 */
export function loadRegistry(skinsDir: string = SKINS_DIR): Record<string, SkinSwitchEntry> {
  const out: Record<string, SkinSwitchEntry> = {}
  // Defense in depth against a registry whose candidate dir is a symlink
  // alias reaching the SAME real skin directory reached by the carrier
  // (issue #43). listSkinDirCandidates already skips symlink entries, but a
  // duplicate here would still poison entry.dir with a link path and let
  // ensureSymlink build a self-referential link (ELOOP). Dedupe on the
  // canonical realpath so only the first (real) candidate is ever registered.
  const seenReal = new Set<string>()
  for (const dir of listSkinDirCandidates(skinsDir)) {
    let real: string
    try { real = realpathSync(dir) } catch { real = dir }
    if (seenReal.has(real)) {
      // Same real skin dir reached twice (one a real dir, one its alias).
      // Keep the first candidate — typically the real directory — and ignore
      // the duplicate link path to keep entry.dir a resolvable real dir.
      console.warn('[skin-center] duplicate skin dir (realpath) "' + real + '": keeping the real directory, ignoring ' + dir)
      continue
    }
    seenReal.add(real)
    const meta = readSkinMeta(dir)
    if (meta === null || meta.wiring === undefined || meta.package === undefined) continue
    if (out[meta.id] !== undefined) {
      // Same skin id present twice (a legacy per-skin package AND the
      // dsh-skins carrier): keep the first candidate deterministically
      // (listSkinDirCandidates orders direct packages before the carrier)
      // and surface the conflict instead of silently last-winning.
      console.warn('[skin-center] duplicate skin id "' + meta.id + '": keeping ' + out[meta.id].dir + ', ignoring ' + dir)
      continue
    }
    out[meta.id] = {
      pkg: meta.package,
      id: meta.wiring.id,
      dir,
      bundleWired: meta.wiring.bundleWired === true,
    }
  }
  return out
}

/**
 * The skins the bundle layer already wires (no insert row needed) — derived
 * from each skin.json wiring.bundleWired (the repo's static truth). Skins
 * wired by an installed per-skin bundle are detected dynamically per profile
 * by activeSkinIsBundleWired / registryWithProfileWiring.
 * @param registry - the derived registry (or a partial override in tests).
 */
export function wiredNames(registry: Record<string, SkinSwitchEntry>): Set<string> {
  const out = new Set<string>()
  for (const [name, skin] of Object.entries(registry)) {
    if (skin.bundleWired) out.add(name)
  }
  return out
}

// --- patch file helpers (1:1 port of scripts/dsh-skin) ----------------

/**
 * Drop legacy hand-written skin rows (insert rows with a name) and old touch
 * comments. Historical writers emitted a comment line above the row with
 * either npm scope, but the row must go regardless of the comment line,
 * indentation or scope — any leftover insert row for a ui-skin-* id plus the
 * managed section's own row produces two insert rows for one loader id, and
 * the boot fails with "duplicate loader entry id" (issue #267). Id-target
 * rows (`- id: ui-skin-xp` + `disabled: true`) carry no `name:` line and
 * must survive: they are the mutual-exclusion wiring, not inserts.
 * @param patch - raw patch file text.
 */
export function stripLegacySkinRows(patch: string): string {
  const lines = patch.split(/\r?\n/)
  const kept: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const idMatch = /^\s*- id:\s*(ui-skin-[a-z0-9-]+)\s*$/.exec(line)
    if (idMatch !== null) {
      const next = lines[i + 1]
      // An insert row carries a `name:` line right below it.
      const insertName = next === undefined
        ? null
        : /^\s*name:\s*['"]?@[a-z0-9][a-z0-9._-]*\/dsh-client-ui-skin-[^'"]*['"]?\s*$/.exec(next)
      if (insertName !== null) {
        // Drop an immediately preceding comment line too (legacy writers
        // emitted one; the row must go even when they did not).
        if (i > 0 && /^\s*#[^\n]*$/.test(lines[i - 1]) && kept[kept.length - 1] === lines[i - 1]) kept.pop()
        i += 1 // skip the name line; the loop increment skips the id line
        continue
      }
    }
    kept.push(line)
  }
  let text = kept.join('\n').replace(/^# \(touch\)[^\n]*\n?/gm, '')
  text = dropEmptyInserts(text)
  return text.replace(/\n{3,}/g, '\n\n')
}

/** Remove `- insert:` items left with no `- id:` rows after legacy cleanup,
 * so an emptied block cannot perturb the loader or later renders. Blocks that
 * still carry rows (any plugin id, skin or not) are kept byte-for-byte. */
function dropEmptyInserts(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (/^-\s*insert:\s*$/.exec(trimmed) === null) {
      out.push(line)
      i += 1
      continue
    }
    const indent = line.length - trimmed.length
    let j = i + 1
    let hasRow = false
    while (j < lines.length) {
      const t = lines[j].trim()
      if (t === '') { j += 1; continue }
      const ind = lines[j].length - t.length
      if (ind <= indent) break
      if (!t.startsWith('#') && /^- id:/.test(t)) hasRow = true
      j += 1
    }
    if (hasRow) {
      for (let k = i; k < j; k += 1) out.push(lines[k])
    }
    i = j
  }
  return out.join('\n')
}

/**
 * Remove the managed skin section. Throws on an unterminated section (a
 * malformed boot patch must fail loudly, never be silently half-written).
 * @param patch - raw patch file text.
 */
export function stripManaged(patch: string): string {
  const start = patch.indexOf(MANAGED_START)
  if (start === -1) return patch
  const end = patch.indexOf(MANAGED_END, start)
  if (end === -1) throw new Error('managed skin section is unterminated; fix the harness cordis.patch.yml')
  return patch.slice(0, start) + patch.slice(end + MANAGED_END.length)
}

/**
 * Drop bare top-level empty flow lists (`[]`) left by the stock profile
 * template. The managed skin section below provides the actual patch array,
 * and an empty flow list followed by block entries is not parseable YAML
 * ("end of the stream or a document separator is expected"), which breaks the
 * next dsh boot. Nested `list: []` mapping values are untouched (the line
 * does not match a standalone `[]`). Runs before
 * normalizePatchForManagedAppend so a template `[]` sitting above the
 * user's own block rows is removed instead of failing that stricter check.
 * @param patch - raw patch file text.
 */
export function stripEmptyPatchList(patch: string): string {
  return patch.replace(/^[ \t]*\[\s*\][ \t]*\r?\n?/gm, '')
}

/**
 * Prepare a user patch for appending the managed block sequence. DSH creates
 * new profile overlays with a flow-style empty sequence (`[]`); appending
 * block rows after that root would create a second YAML root and break boot.
 * Existing block sequences and comments are preserved byte-for-byte.
 * @param patch - raw patch text after old managed rows were removed.
 */
export function normalizePatchForManagedAppend(patch: string): string {
  const lines = (patch.match(/[^\r\n]*(?:\r\n|\n|$)/g) ?? []).filter(line => line !== '')
  const significant: Array<{ index: number; text: string; indent: number }> = []
  let sawDocumentStart = false
  for (let index = 0; index < lines.length; index += 1) {
    const body = lines[index].replace(/\r?\n$/, '')
    const text = body.trim()
    if (text === '' || text.startsWith('#')) continue
    if (/^---(?:\s+#.*)?$/.test(text)) {
      if (sawDocumentStart || significant.length > 0) {
        throw new Error('cordis.patch.yml must contain one YAML document before dsh-skin can append its managed section')
      }
      sawDocumentStart = true
      continue
    }
    if (/^\.\.\.(?:\s+#.*)?$/.test(text)) {
      throw new Error('cordis.patch.yml document-end markers are not supported before the dsh-skin managed section')
    }
    significant.push({ index, text, indent: body.length - body.trimStart().length })
  }
  if (significant.length === 0) return patch
  const root = significant[0]
  if (/^\[\]\s*(?:#.*)?$/.test(root.text)) {
    if (significant.length !== 1) {
      throw new Error('cordis.patch.yml must contain one top-level sequence before dsh-skin can append its managed section')
    }
    lines.splice(root.index, 1)
    return lines.join('')
  }
  if (!root.text.startsWith('-')) {
    throw new Error('cordis.patch.yml must use a top-level block sequence before dsh-skin can append its managed section')
  }
  for (const entry of significant.slice(1)) {
    if (entry.indent < root.indent || (entry.indent === root.indent && !entry.text.startsWith('-'))) {
      throw new Error('cordis.patch.yml must contain one top-level block sequence before dsh-skin can append its managed section')
    }
  }
  return patch
}

/** Render one managed block after the user patch using its existing line ending. */
export function appendManagedPatch(patch: string, managed: string): string {
  const eol = patch.includes('\r\n') ? '\r\n' : '\n'
  const base = patch.replace(/\s+$/, '')
  const block = managed.replace(/\n/g, eol)
  return `${base}${base === '' ? '' : eol + eol}${block}${eol}`
}
/** YAML single-quoted scalar: a literal single quote doubles. `wiring.id` is
 * already validated before it ever reaches a registry, so only `package`
 * needs escaping here. */
function yamlSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Render the managed section for a target skin (null = official stock look:
 * every skin disabled, no insert row). A wired active skin also needs no
 * insert row — the bundle layer already provides it.
 * @param active - skin id, or null for the official stock look.
 * @param registry - registry to render against (defaults to the repo registry).
 */
export function renderManaged(active: string | null, registry: Record<string, SkinSwitchEntry> = loadRegistry()): string {
  const wired = wiredNames(registry)
  const lines = [MANAGED_START]
  for (const name of Object.keys(registry)) {
    if (name === active) continue
    lines.push(`- id: ${registry[name].id}`, '  disabled: true')
  }
  if (active !== null && !wired.has(active)) {
    lines.push('- insert:', `    - id: ${registry[active].id}`, `      name: ${yamlSingleQuote(registry[active].pkg)}`)
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

/**
 * Which skin is currently enabled, read from a patch file. With bundle-wired
 * skins the active skin carries no insert row, so the answer is the
 * bundle-wired skin that the patch does NOT disable; the legacy reading
 * (last non-disabled skin row) remains for pre-bundle layouts.
 * @param patch - raw patch file text.
 * @param registry - registry to read against (defaults to the repo registry).
 */
export function currentActive(patch: string, registry: Record<string, SkinSwitchEntry> = loadRegistry()): string | null {
  const disabled = new Set<string>()
  for (const m of patch.matchAll(/^- id: (ui-skin-[a-z0-9-]+)\n  disabled: true/gm)) {
    disabled.add(m[1])
  }
  const wired = wiredNames(registry)
  for (const [name, skin] of Object.entries(registry)) {
    if (wired.has(name) && !disabled.has(skin.id)) return name
  }
  const rows = [...patch.matchAll(/(?:^|\n) *- id: (ui-skin-[a-z0-9-]+)(\n *disabled: (true))?/g)]
  const enabled: string[] = []
  for (const m of rows) if (!m[3]) enabled.push(m[1])
  return enabled.length ? enabled[enabled.length - 1].replace('ui-skin-', '') : null
}

/**
 * Count the `insert:` list rows for a loader entry id in a patch text (the
 * rows a skin bundle would contribute, as opposed to home-layer
 * `disabled: true` id-target rows). The patch format is small and
 * line-based; a YAML parser dependency is not worth the weight for this one
 * probe. Two insert rows for one id fail the boot with "duplicate loader
 * entry id" (issue #267), so the count is what the self-heal in useSkin
 * keys on.
 * @param patch - raw patch text.
 * @param id - the loader entry id to look for.
 */
function countInsertId(patch: string, id: string): number {
  let count = 0
  let insertIndent: number | null = null
  for (const line of patch.split(/\r?\n/)) {
    const trimmed = line.trimStart()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - trimmed.length
    const insert = /^- insert:\s*$/.exec(trimmed)
    if (insert !== null) {
      insertIndent = indent
      continue
    }
    if (insertIndent === null) continue
    if (indent <= insertIndent) {
      // A non-indented row closes the insert item. Reset and re-check the
      // line in case it starts another insert block.
      insertIndent = null
      const nextInsert = /^- insert:\s*$/.exec(trimmed)
      if (nextInsert !== null) insertIndent = indent
      continue
    }
    const row = /^- id:\s*['"]?([^'"]+)['"]?\s*$/.exec(trimmed)
    if (row !== null && row[1] === id) count += 1
  }
  return count
}

/** Whether a patch contains at least one insert row for `id` (see countInsertId). */
function patchHasInsertId(patch: string, id: string): boolean {
  return countInsertId(patch, id) > 0
}

/**
 * Bundle entries from the active profile manifest's `dsh.profile.bundles` —
 * the authoritative wiring source used by scripts/dsh-skin
 * (`bundleWiredFromProfile`, lines 68-75). Unreadable/malformed manifests
 * contribute nothing, matching the CLI's try/catch fallback.
 * @param profileManifestPath - `<harnessHome>/profiles/<profile>/package.json`.
 */
function readProfileBundles(profileManifestPath: string | undefined): Set<string> {
  const out = new Set<string>()
  if (profileManifestPath === undefined) return out
  try {
    const manifest: unknown = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return out
    const dsh = (manifest as Record<string, unknown>).dsh
    if (typeof dsh !== 'object' || dsh === null) return out
    const profile = (dsh as Record<string, unknown>).profile
    if (typeof profile !== 'object' || profile === null) return out
    const bundles = (profile as Record<string, unknown>).bundles
    if (!Array.isArray(bundles)) return out
    for (const bundle of bundles) if (typeof bundle === 'string') out.add(bundle)
  } catch {
    // Fall through to the structural heuristics below.
  }
  return out
}

/**
 * Dependency keys from the active profile manifest's `dependencies` — the
 * profile top-level packages the loader reconciles patch rows from (the
 * second wiring channel beside dsh.profile.bundles; `dsh plugin add` and
 * npm installs land here). Unreadable/malformed manifests contribute
 * nothing, matching readProfileBundles.
 * @param profileManifestPath - <harnessHome>/profiles/<profile>/package.json.
 */
function readProfileDependencies(profileManifestPath: string | undefined): Set<string> {
  const out = new Set<string>()
  if (profileManifestPath === undefined) return out
  try {
    const manifest: unknown = JSON.parse(readFileSync(profileManifestPath, 'utf8'))
    if (typeof manifest !== 'object' || manifest === null) return out
    const deps = (manifest as Record<string, unknown>).dependencies
    if (typeof deps !== 'object' || deps === null) return out
    for (const key of Object.keys(deps as Record<string, unknown>)) out.add(key)
  } catch {
    // Fall through to the structural heuristics below.
  }
  return out
}

/** Whether an absolute path sits inside the `dsh-skins/skins/` bundled
 * carrier (the path-segment heuristic documented on the symlink branch). */
function isDshSkinsCarrierPath(dir: string): boolean {
  const parts = dir.split(sep)
  return parts.includes('dsh-skins') && parts.includes('skins')
}

/**
 * Whether the active skin's loader entry is already provided by the skin
 * package's own bundle patch, so the home-layer managed section must NOT add
 * a duplicate insert row (issue #148: `duplicate loader entry id`).
 *
 * True when:
 *  - the registry marks the skin `bundleWired` (skin.json wiring flag), or
 *  - the active profile manifest's `dsh.profile.bundles` contains entry.pkg
 *    (the scripts/dsh-skin `bundleWiredFromProfile` authority — true whether
 *    the profile target is a real directory or a symlink), or
 *  - the profile manifest's `dependencies` contains entry.pkg (installed via
 *    `dsh plugin add` / npm — the loader reconciles patch rows of the
 *    profile's top-level packages, which is how these bundles get wired).
 *
 * When the profile manifest exists, its wiring lists are the whole truth:
 * the loader reconciles ONLY bundle entries and dependency packages. In
 * particular, the node_modules symlinks ensureSymlink creates for the
 * skin-center itself are pure resolvability links — they are never
 * reconciled — and must not be mistaken for installed bundles, otherwise
 * useSkin skips the home insert row and no skin ever activates.
 *
 * Only when the manifest is absent/unreadable does the function fall back to
 * the structural probe (a real installed dir, or a symlink to an independent
 * package outside the dsh-skins/skins carrier, whose own cordis.patch.yml
 * inserts entry.id). A symlink into the bundled carrier asset dir is never an
 * active per-skin bundle in any layout.
 * @param entry - the skin switch entry.
 * @param profileModulesDir - the profile's node_modules dir.
 * @param profileManifestPath - optional profile package.json path.
 */
export function activeSkinIsBundleWired(entry: SkinSwitchEntry, profileModulesDir: string, profileManifestPath?: string): boolean {
  if (entry.bundleWired) return true
  // Authoritative profile wiring: dsh.profile.bundles wins regardless of the
  // target layout (real dir or symlink), exactly like scripts/dsh-skin.
  if (readProfileBundles(profileManifestPath).has(entry.pkg)) return true
  // Profile dependencies are the second reconciliation channel (dsh plugin
  // add / npm installs). A package listed there is wired by the loader.
  if (readProfileDependencies(profileManifestPath).has(entry.pkg)) return true
  // The manifest exists: its lists are authoritative. Anything not listed is
  // not reconciled by the loader — including the skin-center's own
  // ensureSymlink links — so it keeps its home insert row.
  if (profileManifestPath !== undefined && statSync(profileManifestPath, { throwIfNoEntry: false })) {
    return false
  }
  const target = joinPath(profileModulesDir, entry.pkg)
  let stat: ReturnType<typeof lstatSync> | undefined
  try {
    stat = lstatSync(target, { throwIfNoEntry: false })
  } catch {
    return false
  }
  if (stat === undefined || (!stat.isDirectory() && !stat.isSymbolicLink())) return false
  let probeDir = target
  if (stat.isSymbolicLink()) {
    // Resolve the link before judging: a carrier asset link (dsh-skins/skins)
    // is not an installed bundle, while a link to an independently installed
    // per-skin package is probed through its real directory.
    let real: string
    try {
      real = realpathSync(target)
    } catch {
      return false
    }
    let entryReal: string
    try { entryReal = realpathSync(entry.dir) } catch { entryReal = entry.dir }
    if (isDshSkinsCarrierPath(real) || (real === entryReal && isDshSkinsCarrierPath(entryReal))) return false
    probeDir = real
  }
  let patch: string
  try {
    patch = readFileSync(joinPath(probeDir, 'cordis.patch.yml'), 'utf8')
  } catch {
    return false
  }
  return patchHasInsertId(patch, entry.id)
}

/**
 * Copy a registry with `bundleWired` enriched from the profile layout, so
 * patch rendering and active reading agree on skins whose insert row the
 * installed per-skin bundle provides.
 */
function registryWithProfileWiring(registry: Record<string, SkinSwitchEntry>, profileModulesDir: string, profileManifestPath?: string): Record<string, SkinSwitchEntry> {
  const out: Record<string, SkinSwitchEntry> = {}
  for (const [name, entry] of Object.entries(registry)) {
    out[name] = activeSkinIsBundleWired(entry, profileModulesDir, profileManifestPath) ? { ...entry, bundleWired: true } : entry
  }
  return out
}

// --- paths ---

/** Layout of the DSH home + profile the CLI switches against. */
export interface SkinSwitchPaths {
  /** ~/.dsh/profiles/<profile>/cordis.patch.yml */
  patchPath: string
  /** ~/.dsh/cordis.patch.yml (pre-profile-scope migration source). */
  legacyPatchPath: string
  /** ~/.dsh/profiles/<profile>/node_modules */
  profileModulesDir: string
  /** ~/.dsh/profiles/<profile>/package.json (dsh.profile.bundles wiring). */
  profileManifestPath: string
}

/**
 * Derive the running harness home + profile from the skin-center package's
 * own install location — the one authority that is true regardless of how
 * the GUI was launched (issue #254: no DSH_PROFILE env var, cwd outside
 * profiles/<name>, so every legacy fallback ends on the wrong profile).
 * Both the literal module path and its realpath are scanned, because profile
 * node_modules entries are commonly symlinks (per-skin links, pnpm store):
 * the literal chain preserves the profiles/<name>/node_modules segment while
 * the realpath chain covers store-resolved loads. The first ancestor matching
 * <harnessHome>/profiles/<name>/node_modules wins; the inner node_modules
 * under .pnpm/<pkg> never matches because its grandparent is .pnpm, not
 * profiles.
 * @param fromUrl - the module URL to resolve from (defaults to this module's
 *   own import.meta.url); injectable so tests can place the module inside a
 *   simulated install layout.
 * @returns the harness home (already the .dsh dir — no suffix is appended)
 *   and the profile name, or null when the module is not installed under a
 *   profiles tree (monorepo dev checkout — callers keep their legacy
 *   fallbacks).
 */
export function resolveInstallLayout(fromUrl: string = import.meta.url): { harnessHome: string; profile: string } | null {
  const starts = [fileURLToPath(fromUrl)]
  try {
    const real = realpathSync(starts[0])
    if (real !== starts[0]) starts.push(real)
  } catch {
    // Unreadable path: the literal chain alone still has a chance.
  }
  for (const start of starts) {
    let current = dirname(start)
    for (;;) {
      if (basename(current) === 'node_modules') {
        const profileDir = dirname(current)
        const profilesDir = dirname(profileDir)
        const profile = basename(profileDir)
        if (basename(profilesDir) === 'profiles' && profile !== '' && profile !== '.' && profile !== '..' && profile !== 'node_modules') {
          return { harnessHome: dirname(profilesDir), profile }
        }
      }
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return null
}

/**
 * First non-blank string in a list of candidate values. Whitespace-only
 * values (including environment variables set to spaces) count as unset.
 */
function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed !== '') return trimmed
    }
  }
  return undefined
}

/**
 * Resolve the DSH harness home exactly like the dsh launcher:
 *  - an injected `home` option (tests pass a throwaway HOME) maps to
 *    `<home>/.dsh`;
 *  - otherwise a trimmed non-empty `$DSH_HOME` is the harness home directly
 *    (dsh's `resolveDshHome()` contract — the env var already points at the
 *    `.dsh` directory, so no suffix is appended);
 *  - otherwise the harness home derived from this package's install layout
 *    (issue #254: the launcher may have configured the home without any env
 *    var reaching this process) — already the `.dsh` dir, no suffix;
 *  - otherwise `homedir()/.dsh`.
 * @param optsHome - injectable HOME (tests); default resolves from env/homedir.
 * @param env - environment map (defaults to process.env).
 * @param installHome - harness home from resolveInstallLayout (no suffix).
 */
export function resolveHarnessHome(optsHome?: string, env: NodeJS.ProcessEnv = process.env, installHome?: string): string {
  if (optsHome !== undefined) return joinPath(optsHome, '.dsh')
  return firstNonBlank(env.DSH_HOME, installHome) ?? joinPath(homedir(), '.dsh')
}

/**
 * Resolve the profile the skin switch must operate against (the profile the
 * GUI is actually running in). Precedence, first non-blank wins:
 *   1. explicit opts.profile;
 *   2. `$DSH_SKIN_PROFILE`;
 *   3. `$DSH_PROFILE` (the generic dsh profile override);
 *   4. `process.cwd()` when it is a directory directly under
 *      `<harnessHome>/profiles/<name>` — return that `<name>`;
 *   5. `web`.
 * Pure and injectable so tests can exercise every precedence level without
 * mutating the process. `useSkin`/`currentSkin` call it with the same
 * harness-home-derived profiles root the path resolver uses.
 * @param optsProfile - explicit profile override.
 * @param env - environment map (defaults to process.env).
 * @param cwd - current working directory (defaults to process.cwd()).
 * @param profilesRoot - `<harnessHome>/profiles` dir (defaults to the root
 *   derived from env/homedir).
 */
export function resolveProfile(
  optsProfile?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  profilesRoot?: string,
): string {
  const explicit = firstNonBlank(optsProfile, env.DSH_SKIN_PROFILE, env.DSH_PROFILE)
  if (explicit !== undefined) return explicit
  const root = resolvePath(profilesRoot ?? joinPath(resolveHarnessHome(undefined, env), 'profiles'))
  return profileFromCwd(cwd, root) ?? 'web'
}

/**
 * The profile name when cwd sits directly under `<harnessHome>/profiles/<name>`
 * — else undefined. Pure so resolvePaths can reuse it with an install-derived
 * profiles root while resolveProfile keeps its own signature for callers.
 */
function profileFromCwd(cwd: string, profilesRoot: string): string | undefined {
  const root = resolvePath(profilesRoot)
  const normalizedCwd = resolvePath(cwd)
  // Compare canonical parents: macOS resolves /var to /private/var, and a
  // symlinked profiles root must still match the profile dir's real parent.
  const canonicalDir = (p: string): string => {
    try { return realpathSync(p) } catch { return resolvePath(p) }
  }
  if (canonicalDir(dirname(normalizedCwd)) === canonicalDir(root)) {
    const name = basename(normalizedCwd)
    try {
      if (name !== '' && statSync(normalizedCwd, { throwIfNoEntry: false })?.isDirectory() === true) return name
    } catch {
      // Unreadable cwd: fall through to the caller's default.
    }
  }
  return undefined
}

/**
 * Resolve the DSH paths under a HOME. home/profile are injectable so tests
 * can point at a throwaway HOME (mirrors scripts/dsh-skin.test.mjs).
 * Precedence for the harness home: injected home > $DSH_HOME > install
 * layout > homedir()/.dsh. For the profile: injected profile >
 * $DSH_SKIN_PROFILE > $DSH_PROFILE > cwd under profiles/<name> > install
 * layout profile > web (issue #254: the install layout is what makes a
 * non-web profile resolve when no env var or cwd hint exists).
 * @param home - home dir (defaults to $DSH_HOME or the process HOME).
 * @param profile - profile name (defaults via the precedence above).
 * @param fromUrl - module URL the install layout is derived from (defaults
 *   to this module's import.meta.url); injectable for tests.
 */
export function resolvePaths(home?: string, profile?: string, fromUrl: string = import.meta.url): SkinSwitchPaths {
  const install = resolveInstallLayout(fromUrl)
  const harnessHome = resolveHarnessHome(home, process.env, install?.harnessHome)
  const profilesRoot = joinPath(harnessHome, 'profiles')
  const explicit = firstNonBlank(profile, process.env.DSH_SKIN_PROFILE, process.env.DSH_PROFILE)
  const activeProfile = explicit ?? profileFromCwd(process.cwd(), profilesRoot) ?? install?.profile ?? 'web'
  return {
    patchPath: joinPath(harnessHome, 'profiles', activeProfile, 'cordis.patch.yml'),
    legacyPatchPath: joinPath(harnessHome, 'cordis.patch.yml'),
    profileModulesDir: joinPath(harnessHome, 'profiles', activeProfile, 'node_modules'),
    profileManifestPath: joinPath(harnessHome, 'profiles', activeProfile, 'package.json'),
  }
}

// --- fs side effects ---

function readPatch(patchPath: string): string {
  try {
    return readFileSync(patchPath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Atomic replace: write a sibling temp file then rename over the target, so a
 * crash mid-write can never leave a half-written boot patch and the config
 * watcher only ever sees complete content (the CLI's own strategy). Creates
 * the parent dir if missing, preserves the target's existing permission bits,
 * uses a fresh mkdtemp directory (same dir as the target) so concurrent
 * writers can never preempt the same temp name, and always cleans the temp
 * directory on error.
 * @param filePath - target file.
 * @param next - full next content.
 */
function writePatchAtomic(filePath: string, next: string): void {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true })
  // Record the mode before touching anything: rename must not silently turn
  // a 0600 boot patch back into a world-readable 0644 file.
  let previousMode: number | undefined
  try {
    previousMode = statSync(filePath).mode & 0o777
  } catch {
    previousMode = undefined
  }
  const tmpDir = mkdtempSync(joinPath(dir, `${basename(filePath)}.tmp-`))
  const tmp = joinPath(tmpDir, basename(filePath))
  try {
    // 'wx' refuses to clobber a pre-existing file inside our fresh tmp dir.
    writeFileSync(tmp, next, { flag: 'wx' })
    chmodSync(tmp, previousMode ?? 0o600)
    renameSync(tmp, filePath)
  } catch (error) {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Preserve the original write failure over a cleanup failure.
    }
    throw error
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // The patch was already renamed into place; an empty tmp-dir cleanup
    // failure must not turn a successful write into an error.
  }
}

/**
 * Make the profile node_modules link for a skin. Returns true when a new
 * link was created, false when the target was already resolvable.
 *
 * A target that already resolves (a REAL installed directory, e.g. the npm
 * layout where the skin package sits at node_modules/@linxin666/..., or a
 * symlink/junction pointing at the skin dir) is left untouched — there is
 * nothing to link. Only an existing link pointing elsewhere is refreshed.
 * A plain FILE target is still refused (that path is not ours to clobber).
 *
 * On win32 the link falls back to a directory junction (absolute target) when
 * symlink creation fails with a privilege error, so no Developer Mode or
 * elevation is required (zhu1090093659/dsh-web-ui#24).
 * @param entry - the skin switch entry.
 * @param profileModulesDir - the profile's node_modules dir.
 */
/** Canonical path a symlink resolves to, tolerant of a degraded link (a
 * self-referential link whose realpath would throw ELOOP); '' when absent. */
function resolveLinkReal(linkPath: string): string {
  try { return realpathSync(linkPath) } catch { return '' }
}

function ensureSymlink(entry: SkinSwitchEntry, profileModulesDir: string): boolean {
  const target = joinPath(profileModulesDir, entry.pkg)
  // Self-reference guard (issue #43, ELOOP): a link whose target equals the
  // link path itself is never legal. When a poisoned registry (entry.dir ==
  // the very profile link we manage) reaches here, refuse to create/refresh
  // and return false so no self-referential symlink is built that would break
  // every later `dsh plugin add`.
  let entryReal: string
  try { entryReal = realpathSync(entry.dir) } catch { entryReal = entry.dir }
  if (entry.dir === target || entryReal === target) return false
  let stat: ReturnType<typeof lstatSync> | null = null
  try { stat = lstatSync(target) } catch { /* absent */ }
  if (stat) {
    if (stat.isSymbolicLink()) {
      // Already resolves to this skin's real dir -> nothing to do. Compare
      // canonical paths (not the raw readlink string) so a relative link or a
      // link through a symlinked intermediate still matches.
      if (resolveLinkReal(target) === entryReal) return false
      // Windows junctions report as symbolic links AND directories; unlink
      // cannot remove a directory reparse point (EPERM), so remove stale
      // junctions with rmdir instead.
      if (process.platform === 'win32' && stat.isDirectory()) rmdirSync(target)
      else unlinkSync(target)
    } else if (stat.isDirectory()) {
      // A real installed package directory: already resolvable, not ours to
      // replace. This is the npm-install layout (issue #21/#33/#34) — the
      // skin package is physically present under the profile's node_modules.
      // It must actually BE this skin's package: an unrelated directory at
      // the target path is refused (the same protection the old code gave).
      if (isSkinPackageDir(target, entry)) return false
      throw new Error(target + ' exists as a directory but does not look like ' + entry.pkg + ' — refusing to treat it as installed')
    } else {
      throw new Error(target + ' exists and is not a symlink or directory — refusing to touch it')
    }
  }
  // The link's parent scoped dir may not exist on a fresh machine (the
  // profiles/node_modules tree is created incrementally).
  mkdirSync(dirname(target), { recursive: true })
  try {
    symlinkSync(entry.dir, target)
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (process.platform === 'win32' && typeof code === 'string' && SYMLINK_PRIVILEGE_CODES.includes(code)) {
      // Directory junction: needs no Developer Mode / elevation. Junction
      // targets must be absolute (entry.dir is).
      symlinkSync(entry.dir, target, 'junction')
    } else {
      throw error
    }
  }
  return true
}

/**
 * Whether an existing directory at a profile link path really is the target
 * skin's installed package (skin.json id + package match). Keeps the
 * npm-install-layout pass-through from silently accepting an unrelated
 * directory left over at the link path.
 * @param dir - the directory to inspect.
 * @param entry - the expected skin.
 */
function isSkinPackageDir(dir: string, entry: SkinSwitchEntry): boolean {
  try {
    const meta: unknown = JSON.parse(readFileSync(joinPath(dir, 'skin.json'), 'utf8'))
    if (typeof meta !== 'object' || meta === null) return false
    const record = meta as Record<string, unknown>
    return record.id === entry.id.replace(/^ui-skin-/, '') && record.package === entry.pkg
  } catch {
    return false
  }
}

/** Windows/privilege code points where symlinkSync fails. */
const SYMLINK_PRIVILEGE_CODES = ['EPERM', 'EACCES', 'ENOSYS']

/**
 * Wrap a symlink-labelled failure (typ. Windows without developer mode or
 * elevated privileges) in a human-readable hint instead of a bare fs error.
 * @param caller - the operation label for the error message.
 * @param fn - the fs call to run.
 */
function symlinkFriendly<T>(caller: string, fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (typeof code === 'string' && SYMLINK_PRIVILEGE_CODES.includes(code)) {
      throw new Error(`${caller} 需要为皮肤创建符号链接，但权限不足（${code}）。Windows 请以管理员身份或开启开发者模式后重试；若已手动把皮肤装进 profile，可跳过本步。`)
    }
    throw error
  }
}

// --- commands ---

/**
 * Whether the skin package is actually resolvable as a plugin from the web
 * profile - the same directory contract the boot graph relies on when it
 * loads the `useSkin` insert row. Unlike the old soft warning, this is a
 * hard gate: the skin-center /apply endpoint must not report ok:true for a
 * skin the host cannot load. The npm aggregate layout shipped skin dirs
 * without a package.json + host entry, so /apply wrote the patch, reported
 * success, and the boot then died on MODULE_NOT_FOUND .../package.json.
 *
 * The check is structural and deterministic (pure fs): resolves what node
 * would - the profile-target package dir must carry a package.json whose
 * name is this skin's package, and a host entry (main, else index.js) that
 * actually exists. That is exactly the resolution that failed before.
 * @param entry - the skin switch entry.
 * @param profileModulesDir - the profile's node_modules dir.
 * @returns an error message when the skin is not resolvable, else null.
 */
function checkResolvable(entry: SkinSwitchEntry, profileModulesDir: string): string | null {
  const target = joinPath(profileModulesDir, entry.pkg)
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) {
    return `${entry.pkg} 未安装到 profile（profile 中无 ${target}）。请先用 dsh-skin install ${entry.id.replace(/^ui-skin-/, '')} 安装，否则宿主无法加载。`
  }
  const pkgPath = joinPath(target, 'package.json')
  if (!statSync(pkgPath, { throwIfNoEntry: false })) {
    return `${entry.pkg} 在 profile 中缺少 package.json（${pkgPath}）——聚合包皮肤目录未带可解析包元数据。`
  }
  let parsed: { name?: unknown; main?: unknown }
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: unknown; main?: unknown }
  } catch {
    parsed = {}
  }
  if (parsed.name !== entry.pkg) {
    return `${entry.pkg} 解析到的 package.json 名为 ${String(parsed.name)}，不是本皮肤（${pkgPath}）。`
  }
  // The host entry the boot imports: package.json main, else index.js.
  const main = typeof parsed.main === 'string' ? parsed.main : 'index.js'
  const mainPath = joinPath(target, main)
  if (!statSync(mainPath, { throwIfNoEntry: false })) {
    return `${entry.pkg} 缺少 host 入口 ${mainPath}（package.json main 未指到可加载文件）。`
  }
  return null
}

/**
 * Switch the active skin. Equivalent to `dsh-skin use <name>`:
 *   1. makes the profile node_modules symlink for a non-official skin,
 *   2. rewrites the managed section of the boot patch atomically.
 * Returns the same stdout the CLI would print (drives the GUI message).
 * @param name - skin id, or 'official' for the stock look.
 * @param opts - injectable HOME/profile/registry (tests use a throwaway HOME).
 * @returns the human-facing confirmation string.
 */
export function useSkin(name: string, opts: { home?: string; profile?: string; registry?: Record<string, SkinSwitchEntry> } = {}): string {
  const official = name === 'official'
  const registry = opts.registry ?? loadRegistry()
  if (!official && registry[name] === undefined) {
    throw new Error(`unknown skin "${name}". Known: ${Object.keys(registry).join(', ')} (or "official" for the stock look)`)
  }
  const paths = resolvePaths(opts.home, opts.profile)
  let renderRegistry = registry
  if (!official) {
    const entry = registry[name]
    symlinkFriendly(`switching to "${name}"`, () => { ensureSymlink(entry, paths.profileModulesDir) })
    // Honest apply: refuse to report success for a skin the host cannot
    // load. ensureSymlink only makes the profile resolve the path; the real
    // question is whether the boot graph can import the package, which is
    // what checkResolvable answers. Throw so /apply turns it into ok:false.
    // This check stays BEFORE any patch write, so a missing skin never leaves
    // a dangling home-layer insert row behind (issue #108).
    const problem = checkResolvable(entry, paths.profileModulesDir)
    if (problem !== null) throw new Error(problem)
    // Once the target is confirmed resolvable, detect whether the skin's own
    // installed bundle patch already provides the insert row (issue #148):
    // then the home layer keeps only the mutual-exclusion disabled rows.
    // dsh.profile.bundles in the profile manifest is authoritative; a
    // symlinked bundled-carrier target otherwise returns false here, so that
    // layout keeps its home insert row (no per-skin bundle patch is active).
    renderRegistry = registryWithProfileWiring(registry, paths.profileModulesDir, paths.profileManifestPath)
  }

  // Older releases wrote the managed block at harness-home scope, which
  // makes every profile inherit the Web-only skin insert. Remove that block
  // before writing the active profile so a later dsh-tui boot cannot import a
  // package installed only in the Web profile (issue #290).
  const legacyPatch = readPatch(paths.legacyPatchPath)
  const migratedLegacyPatch = stripLegacySkinRows(stripManaged(legacyPatch))
  if (migratedLegacyPatch !== legacyPatch) {
    writePatchAtomic(paths.legacyPatchPath, migratedLegacyPatch)
  }

  const patch = normalizePatchForManagedAppend(stripEmptyPatchList(stripLegacySkinRows(stripManaged(readPatch(paths.patchPath)))))
  let next = appendManagedPatch(patch, renderManaged(official ? null : name, renderRegistry))
  let skippedInsert = false
  if (!official && countInsertId(next, renderRegistry[name].id) > 1) {
    // Another insert row for the same loader id already exists elsewhere in
    // the patch — a profile-wired skin bundle the wiring probe missed, or a
    // leftover row the legacy cleanup could not match. Two insert rows for
    // one id fail the boot with "duplicate loader entry id" (issue #267), so
    // drop OUR row and keep the pre-existing one: the managed section then
    // only carries the mutual-exclusion disabled rows.
    const wired = { ...renderRegistry, [name]: { ...renderRegistry[name], bundleWired: true } }
    next = appendManagedPatch(patch, renderManaged(name, wired))
    skippedInsert = true
  }
  writePatchAtomic(paths.patchPath, next)

  const core = official
    ? 'restored the official stock look — the config watcher applies it within seconds; refresh the page to see it.'
    : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`
  const notice = skippedInsert
    ? ' （检测到补丁中已有该皮肤的 insert 行，已跳过本层 insert，避免 duplicate loader entry id。）'
    : ''
  return core + notice
}

/**
 * Read the active skin, mirroring `dsh-skin current` (prints the name or
 * 'none'). The patch is read from disk by default; a caller can pass the text
 * it already holds.
 * @param patch - optional pre-read patch text.
 * @param opts - injectable HOME/profile/registry.
 * @returns the active skin id, or 'none' for the stock look.
 */
export function currentSkin(patch: string | undefined, opts: { home?: string; profile?: string; registry?: Record<string, SkinSwitchEntry> } = {}): string {
  const paths = resolvePaths(opts.home, opts.profile)
  const registry = opts.registry ?? loadRegistry()
  // Mirror useSkin's wiring view: an installed per-skin bundle provides its
  // own insert row, so the home patch carries only disabled rows for it and
  // currentActive must treat it as bundle-wired to report it as active.
  let activePatch = patch ?? readPatch(paths.patchPath)
  // Report the pre-migration state until the first switch moves it into the
  // active profile. An explicit patch argument remains authoritative in tests
  // and for callers that already read the target file.
  if (patch === undefined && !activePatch.includes(MANAGED_START)) {
    activePatch = readPatch(paths.legacyPatchPath)
  }
  return currentActive(activePatch, registryWithProfileWiring(registry, paths.profileModulesDir, paths.profileManifestPath)) ?? 'none'
}
