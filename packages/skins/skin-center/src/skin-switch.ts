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

import { readdirSync, readFileSync, readlinkSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo layout: skin bundles live at packages/skins/<id>. */
const SKINS_DIR = fileURLToPath(new URL('../../../skins/', import.meta.url))

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
 * @param dir - directory name under packages/skins/.
 */
function readSkinMeta(dir: string): { id: string; package: string; wiring: { id: string; bundleWired: boolean } } | null {
  try {
    const meta: unknown = JSON.parse(readFileSync(joinPath(SKINS_DIR, dir, 'skin.json'), 'utf8'))
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
 * Derive the skin registry from packages/skins/<id>/skin.json — the single
 * source of truth (skin.json already carries package/wiring.id/bundleWired).
 * Replaces the CLI's hand-maintained SKINS dictionary, so adding a skin
 * needs no code change here.
 * @returns skin id -> switch metadata.
 */
export function loadRegistry(): Record<string, SkinSwitchEntry> {
  const out: Record<string, SkinSwitchEntry> = {}
  for (const dir of readdirSync(SKINS_DIR)) {
    const meta = readSkinMeta(dir)
    if (meta === null || meta.wiring === undefined || meta.package === undefined) continue
    out[meta.id] = {
      pkg: meta.package,
      id: meta.wiring.id,
      dir: joinPath(SKINS_DIR, dir),
      bundleWired: meta.wiring.bundleWired === true,
    }
  }
  return out
}

/**
 * The skins the bundle layer already wires (no insert row needed) — derived
 * from each skin.json wiring.bundleWired (the repo's static truth, e.g. xp).
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
 * Make the profile node_modules symlink for a skin. Returns true when a new
 * link was created, false when it already pointed at the skin dir. Refuses
 * to touch a non-symlink target (that path is not ours to clobber).
 * @param entry - the skin switch entry.
 * @param profileModulesDir - the profile's node_modules dir.
 */
function ensureSymlink(entry: SkinSwitchEntry, profileModulesDir: string): boolean {
  const target = joinPath(profileModulesDir, entry.pkg)
  let stat: ReturnType<typeof lstatSync> | null = null
  try { stat = lstatSync(target) } catch { /* absent */ }
  if (stat) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`${target} exists and is not a symlink — refusing to touch it`)
    }
    const current = readlinkSync(target)
    if (current === entry.dir) return false
    unlinkSync(target)
  }
  // The link's parent scoped dir may not exist on a fresh machine (the
  // profiles/node_modules tree is created incrementally).
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(entry.dir, target)
  return true
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
 * Optional soft warning when a skin is not resolvable from the web profile
 * (the CLI prints it; surfaced as a soft hint, not a failure — the patch
 * stays authoritative).
 * @param entry - the skin switch entry.
 * @param profileModulesDir - the profile's node_modules dir.
 */
function checkInstalled(entry: SkinSwitchEntry, profileModulesDir: string): string | null {
  let ok = false
  try {
    ok = lstatSync(joinPath(profileModulesDir, entry.pkg)).isSymbolicLink()
  } catch { /* absent */ }
  return ok ? null : `${entry.pkg} 未安装到 profile；先用 dsh-skin install ${entry.id.replace(/^ui-skin-/, '')}（或 dsh plugin --profile ${DEFAULT_PROFILE} add ${entry.dir}）安装，否则加载会失败。`
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
  const notices: string[] = []
  if (!official) {
    const entry = registry[name]
    symlinkFriendly(`switching to "${name}"`, () => { ensureSymlink(entry, paths.profileModulesDir) })
    const warn = checkInstalled(entry, paths.profileModulesDir)
    if (warn !== null) notices.push(warn)
  }

  const patch = stripLegacySkinRows(stripManaged(readPatch(paths.patchPath)))
  const next = `${patch.replace(/\s+$/, '')}\n\n${renderManaged(official ? null : name, registry)}\n`
  writePatchAtomic(paths.patchPath, next)

  const core = official
    ? 'restored the official stock look — the config watcher applies it within seconds; refresh the page to see it.'
    : `skin switched to "${name}" — the config watcher applies it within seconds; refresh the page (or the manifest re-fetches) to see it.`
  return notices.length ? `${core}\n${notices.join('\n')}` : core
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