/**
 * In-process skin switching for the skin center — the official `dsh-skin use`
 * CLI, re-implemented as a pure ESM module so the host half never needs a
 * `dsh-skin` binary on PATH (the bug zhu1090093659/dsh-web-ui#5: "dsh-skin
 * CLI not found on PATH").
 *
 * `use` owns the `dsh-skin managed` section of `~/.dsh/cordis.patch.yml`
 * (atomic rewrite, hot-reloaded by the DSH config watcher within seconds,
 * no restart) and the profile node_modules symlink that makes the selected
 * skin resolvable from the web profile. `current` reads the active back.
 *
 * The behaviour/text is a 1:1 port of scripts/dsh-skin (`use`/`current`;
 * workspace assets live in packages/skins/<id>). The skin registry is
 * derived from each packages/skins/<id>/skin.json instead of a hand-written
 * dictionary, so adding a skin needs no code change here.
 * @module @linxin666/dsh-client-ui-skin-center/skin-switch
 */

import { readdirSync, readFileSync, readlinkSync, lstatSync, mkdirSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
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

/** The GUI profile this machine runs (dsh web); overridable via DSH_SKIN_PROFILE. */
const DEFAULT_PROFILE = process.env.DSH_SKIN_PROFILE ?? 'web'

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
    if (typeof record.package !== 'string') return null
    const wiring = record.wiring
    const wiringRecord = (typeof wiring === 'object' && wiring !== null) ? (wiring as Record<string, unknown>) : null
    if (wiringRecord === null || typeof wiringRecord.id !== 'string') return null
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
 * from each skin.json wiring.bundleWired (the repo's static truth).
 *
 * TODO: the CLI also detects skins wired via the active profile's
 * dsh.profile.bundles (bundleWiredFromProfile). A skin installed from the
 * web profile's manifest is still represented by skin.json's flag in this
 * repo; wire further profile-based detection here if ever needed.
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
 * comments. The CLI regex matched the historical @deepseek-ai scope; this
 * also matches the current @linxin666 scope so stale rows are always cleaned.
 * @param patch - raw patch file text.
 */
export function stripLegacySkinRows(patch: string): string {
  return patch
    // insert rows for any ui-skin-* package, with their optional comment line
    .replace(/^    # [^\n]*\n    - id: ui-skin-[^\n]+\n      name: '@(?:deepseek-ai|linxin666)\/dsh-client-ui-skin-[^\n]+'\n/gm, '')
    .replace(/^# \(touch\)[^\n]*\n?/gm, '')
    .replace(/\n{3,}/g, '\n\n')
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
  if (end === -1) throw new Error('managed skin section is unterminated; fix ~/.dsh/cordis.patch.yml')
  return patch.slice(0, start) + patch.slice(end + MANAGED_END.length)
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
    lines.push('- insert:', `    - id: ${registry[active].id}`, `      name: '${registry[active].pkg}'`)
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

// --- paths ---

/** Layout of the DSH home + profile the CLI switches against. */
export interface SkinSwitchPaths {
  /** ~/.dsh/cordis.patch.yml */
  patchPath: string
  /** ~/.dsh/profiles/<profile>/node_modules */
  profileModulesDir: string
}

/**
 * Resolve the DSH paths under a HOME. home/profile are injectable so tests
 * can point at a throwaway HOME (mirrors scripts/dsh-skin.test.mjs).
 * @param home - home dir (defaults to the process HOME).
 * @param profile - profile name (defaults to DSH_SKIN_PROFILE or 'web').
 */
export function resolvePaths(home: string = homedir(), profile: string = DEFAULT_PROFILE): SkinSwitchPaths {
  return {
    patchPath: joinPath(home, '.dsh', 'cordis.patch.yml'),
    profileModulesDir: joinPath(home, '.dsh', 'profiles', profile, 'node_modules'),
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
 * the parent dir if missing.
 * @param filePath - target file.
 * @param next - full next content.
 */
function writePatchAtomic(filePath: string, next: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp-${process.pid}`
  writeFileSync(tmp, next)
  renameSync(tmp, filePath)
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
  if (!official) {
    const entry = registry[name]
    symlinkFriendly(`switching to "${name}"`, () => { ensureSymlink(entry, paths.profileModulesDir) })
    // Honest apply: refuse to report success for a skin the host cannot
    // load. ensureSymlink only makes the profile resolve the path; the real
    // question is whether the boot graph can import the package, which is
    // what checkResolvable answers. Throw so /apply turns it into ok:false.
    const problem = checkResolvable(entry, paths.profileModulesDir)
    if (problem !== null) throw new Error(problem)
  }

  const patch = stripLegacySkinRows(stripManaged(readPatch(paths.patchPath)))
  const next = `${patch.replace(/\s+$/, '')}\n\n${renderManaged(official ? null : name, registry)}\n`
  writePatchAtomic(paths.patchPath, next)

  const core = official
    ? 'restored the official stock look — the config watcher applies it within seconds; refresh the page to see it.'
    : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`
  return core
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
  return currentActive(patch ?? readPatch(paths.patchPath), registry) ?? 'none'
}