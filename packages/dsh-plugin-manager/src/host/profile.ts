/**
 * Profile resolution and manifest reads for the gateway host half. The npm
 * web runtime has no plugin-installer service, so this package resolves the
 * boot profile from the host process's own argv (the launcher fact) and reads
 * the profile's package.json and cordis.patch.yml directly — reads only; every
 * write goes through the official CLI or the patch-row editor.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { existsSync, readFileSync } from 'node:fs'
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, sep } from 'node:path'
import { resolveDshHome } from './dsh-home.ts'

/**
 * The launched-profile slice the official runtime publishes on the host
 * context as `profileContext` (`{ name, dir, patchPath, installAnchor, ... }`).
 * It is a contract observation, not an import: the gateway needs the same
 * three facts the runtime already resolved, and rebuilding them from
 * `--profile` / `DSH_HOME` cannot name the profile on a launcher that passes
 * neither. This package still treats the value as foreign input: the name is
 * traversal-checked, the directory must be an absolute traversal-free path,
 * and the patch path is accepted only when it is the profile's own patch file
 * — it is a WRITE target, so a foreign path there would redirect the
 * gateway's row writes outside the profile it mounts.
 */
export interface LaunchedProfile {
  name?: unknown
  dir?: unknown
  patchPath?: unknown
  /**
   * Absolute path of the running installation's own `@deepseek-ai/dsh`
   * package.json — the launcher's install anchor. Its `version` IS the version
   * of the DSH this process booted, so it answers the compatibility question
   * without spawning anything; on a packaged Desktop install it is the only
   * source that does, because no `dsh` reaches that host's PATH (issue #1819).
   */
  installAnchor?: unknown
}

/** Resolved locations of one profile's writable surface. */
export interface ProfileFacts {
  /** Profile name (the directory under $DSH_HOME/profiles). */
  profileName: string
  /** Absolute profile directory. */
  profileDir: string
  /** Absolute path of the profile's cordis.patch.yml. */
  patchPath: string
  /** Absolute path of the profile's package.json. */
  packageJsonPath: string
  /** True when the profile was inferred from the packaged desktop host. */
  desktop?: boolean
}

/**
 * Strip a leading UTF-8 byte order mark (U+FEFF), which commonly appears in
 * files edited or created on Windows (PowerShell / Notepad).
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
}

/** Read the packaged desktop app's persisted active profile, when present. */
export function desktopSelectedProfile(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env.DSH_DESKTOP_DEFAULT_PROFILE?.trim()
  if (explicit) return explicit
  const appRoots = [
    env.APPDATA && join(env.APPDATA, 'DSH Desktop'),
    env.XDG_CONFIG_HOME && join(env.XDG_CONFIG_HOME, 'DSH Desktop'),
    env.HOME && join(env.HOME, 'Library', 'Application Support', 'DSH Desktop'),
    env.HOME && join(env.HOME, '.config', 'DSH Desktop'),
  ].filter((value): value is string => typeof value === 'string')
  for (const root of appRoots) {
    try {
      const parsed = JSON.parse(stripBom(readFileSync(join(root, 'profile-selection', 'state.json'), 'utf8'))) as { active?: unknown }
      if (typeof parsed.active === 'string' && parsed.active.trim() !== '') return parsed.active.trim()
    } catch {
      // Missing or malformed desktop state: try the next platform location.
    }
  }
  return undefined
}

/**
 * The running installation's own `@deepseek-ai/dsh` package.json, as the
 * launcher published it on `profileContext`, or undefined when the host
 * publishes none (or publishes something unusable). This is a READ-ONLY
 * fact — unlike the profile directory and the patch path it is never a write
 * target — but it still arrives from outside this package, so it must be an
 * absolute, traversal-free path before anything reads a version out of it.
 * @param launched - the profile facts the Host published, when available.
 * @returns the validated anchor path, or undefined.
 */
export function launchedInstallAnchor(launched: LaunchedProfile | undefined): string | undefined {
  const anchor = launched === undefined || typeof launched.installAnchor !== 'string'
    ? ''
    : launched.installAnchor.trim()
  if (anchor === '') return undefined
  if (!isAbsolute(anchor) || anchor.split(/[\/\\]/).includes('..')) return undefined
  return anchor
}

/**
 * Read the `version` field of one package manifest, tolerating every failure:
 * a missing file, an unreadable one (a stripped asar entry), malformed JSON, or
 * a non-string version all read as "no version". Callers fall back to their next
 * source rather than reporting a version nobody declared.
 * @param manifestPath - absolute path of a package.json.
 * @returns the declared version, or undefined.
 */
export function readManifestVersion(manifestPath: string): string | undefined {
  try {
    const parsed = JSON.parse(stripBom(readFileSync(manifestPath, 'utf8'))) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version.trim() !== '' ? parsed.version.trim() : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the host argv names the packaged Desktop launcher, whose entry
 * script is `@deepseek-ai/dsh-desktop-host`. The Desktop client boots the
 * `desktop` profile through `runProfile()` WITHOUT a `--profile` flag and
 * without exporting DSH_PROFILE, so argv is the only launcher fact left and
 * the desktop channel probe must stay on for that shape (the packaged host
 * registers the official installer services programmatically, which the CLI
 * boot dump cannot see).
 * @param argv - process argv.
 */
export function isPackagedDesktopArgv(argv: readonly string[]): boolean {
  return argv.some(argument => argument.includes(`${sep}dsh-desktop-host${sep}`) || argument.includes('/dsh-desktop-host/'))
}

/**
 * The profile directory a packaged Desktop launch carries in its OWN argv.
 * Electron under ELECTRON_RUN_AS_NODE (and node alike) strips exec switches
 * from `process.argv`, so the desktop host launches as
 * `[execPath, dsh-desktop-host/lib/index.js, <dsh>, <profileDir>, ...]` and
 * hands the profile directory to its own `loadProfileDirectory` as that
 * positional argument. This is a launcher fact independent of the
 * `profileContext` service, so a runtime that publishes no service can
 * still be named correctly; a published service stays authoritative above it.
 * @param argv - process argv.
 * @returns the absolute profile directory, or undefined when argv names none.
 */
export function desktopProfileDirFromArgv(argv: readonly string[]): string | undefined {
  if (!isPackagedDesktopArgv(argv)) return undefined
  for (const argument of argv) {
    // The profile directory is the one absolute argument inside a
    // `profiles` tree; the launcher entry, the dsh install and the
    // runtime roots all sit elsewhere, so no positional index is assumed.
    if (!isAbsolute(argument)) continue
    if (basename(dirname(argument)) !== 'profiles') continue
    const name = basename(argument)
    if (name === '' || name === '.' || name === '..') continue
    return argument
  }
  return undefined
}

/**
 * Resolve the boot profile from the launcher facts: an explicit `--profile`
 * flag wins, then the profile the official runtime published on the host
 * context, then the profile directory a packaged launch carries in its own
 * argv, then the DSH_PROFILE environment override, then the `web` subcommand
 * alias, then the packaged Desktop app's persisted selection.
 *
 * Why the launched facts outrank DSH_PROFILE: in this runtime the variable is
 * an OUTPUT, not a boot selector. `runProfile()` is the single launch path for
 * CLI and Desktop alike and provides `profileContext` in both, and
 * `@deepseek-ai/dsh-shell-env` DERIVES `DSH_PROFILE` from `profileContext.name`
 * for the shell children it spawns; no runtime module reads it to choose a
 * profile. Whenever both exist they therefore describe the same profile, and
 * the service carries the more precise facts (the exact directory and patch
 * file). A hand-set or stale value disagreeing with the running host is the
 * one case where the order matters, and following it would mount the gateway -
 * and write its rows - into a profile this host never reads.
 * @param argv - process argv (test seam).
 * @param env - process environment (test seam).
 * @param launched - the profile facts the Host published, when available.
 * @param desktopLauncher - whether argv names the packaged Desktop launcher.
 * @returns the resolved profile facts.
 */
export function resolveProfile(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  launched?: LaunchedProfile,
  desktopLauncher: boolean = isPackagedDesktopArgv(argv),
): ProfileFacts {
  const flagIndex = argv.indexOf('--profile')
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined && argv[flagIndex + 1] !== '') {
    return factsFor(argv[flagIndex + 1], env, desktopLauncher)
  }
  // The published profile outranks the environment: a Desktop workaround may
  // set DSH_PROFILE globally while the running host boots another profile, and
  // following the variable there would mount the gateway (and write patch
  // rows) into a profile this host never reads. The service is the runtime's
  // own answer about the profile it actually launched.
  const published = launchedFacts(launched, desktopLauncher, env)
  if (published !== undefined) return published
  // No service (an older runtime): the packaged Desktop launcher still names
  // its profile directory positionally in argv, which outranks the
  // environment for the same reason the published service does.
  const desktopDir = desktopProfileDirFromArgv(argv)
  if (desktopDir !== undefined) {
    // Built through the same validated path as a published directory so the
    // argv fact cannot skip a guard the service fact must pass.
    const argvFacts = launchedFacts({ name: basename(desktopDir), dir: desktopDir }, desktopLauncher, env)
    if (argvFacts !== undefined) return argvFacts
  }
  if (env.DSH_PROFILE !== undefined && env.DSH_PROFILE.trim() !== '') {
    // A Desktop workaround may set DSH_PROFILE globally. Its in-process boot
    // still has only the executable in argv; keep desktop channel probing in
    // that shape, while ordinary CLI invocations remain non-desktop.
    const name = env.DSH_PROFILE.trim()
    const desktop = desktopLauncher || (argv.length <= 1 && desktopSelectedProfile(env) === name)
    return factsFor(name, env, desktop)
  }
  if (argv.includes('web')) return factsFor('web', env, desktopLauncher)
  const selected = desktopSelectedProfile(env)
  if (selected !== undefined) return factsFor(selected, env, true)
  throw new Error('plugin-manager: cannot determine the boot profile; pass --profile <name> or set DSH_PROFILE')
}

/**
 * Facts from the profile the Host published on `profileContext`, when that
 * service carries a usable name (or directory). The published directory is the
 * launched profile's real location, which is exactly what the runtime passes
 * to the profile loader itself — the name-based builder would only reproduce
 * it. It is still validated before it becomes the root of every later lookup.
 * @param launched - the host's published profile facts.
 * @param desktopLauncher - whether argv names the packaged Desktop launcher.
 * @param env - process environment, for the name-only fallback layout.
 * @returns the facts, or undefined when nothing usable was published.
 */
function launchedFacts(
  launched: LaunchedProfile | undefined,
  desktopLauncher: boolean,
  env: NodeJS.ProcessEnv,
): ProfileFacts | undefined {
  if (launched === undefined) return undefined
  const name = typeof launched.name === 'string' ? launched.name.trim() : ''
  const dir = typeof launched.dir === 'string' ? launched.dir.trim() : ''
  if (name === '' && dir === '') return undefined
  if (name !== '') assertSafeProfileName(name)
  const profileRoot = join(resolveDshHome(env), 'profiles')
  const profileDir = dir !== '' ? dir : join(profileRoot, name)
  // The published directory becomes the root of every later lookup (module
  // manifests, row patches, the --dump-config probe) and the place row writes
  // land, so its SHAPE is validated here. The RAW segments are inspected
  // because `normalize` would silently collapse a `..` away, hiding an escape
  // instead of rejecting it.
  if (!isAbsolute(profileDir) || profileDir.split(/[\/\\]/).includes('..')) {
    throw new Error(`plugin-manager: published profile directory is not a safe absolute path ${JSON.stringify(launched.dir ?? '')}`)
  }
  // The published name and directory must describe the SAME profile: the name
  // drives every CLI `--profile <name>` spawn while the directory drives the
  // files this gateway reads and writes, so a mismatch would split the two
  // write paths across different profiles. The official runtime publishes
  // exactly `basename(dir)` as the name, so this holds for every real host.
  const dirBase = profileDir.split(/[\/\\]/).filter(Boolean).pop() ?? basename(profileDir)
  if (name !== '' && name !== dirBase) {
    throw new Error(`plugin-manager: published profile name and directory disagree ${JSON.stringify(name)} vs ${JSON.stringify(profileDir)}`)
  }
  const isPosixLiteral = profileDir.includes('/') && !profileDir.includes('\\')
  const ownPatchPath = isPosixLiteral ? `${profileDir}/cordis.patch.yml` : join(profileDir, 'cordis.patch.yml')
  const publishedPatchPath = typeof launched.patchPath === 'string' ? launched.patchPath.trim() : ''
  // The patch path is a WRITE target (row enablement). Accept only the
  // profile's own patch file; anything else would let the published value
  // redirect a write outside the profile this gateway mounts.
  if (publishedPatchPath !== '' && publishedPatchPath !== ownPatchPath && normalize(publishedPatchPath) !== normalize(ownPatchPath)) {
    throw new Error(`plugin-manager: published patch path is not the launched profile's own patch file ${JSON.stringify(launched.patchPath)}`)
  }
  return {
    profileName: name !== '' ? name : dirBase,
    profileDir,
    patchPath: ownPatchPath,
    packageJsonPath: isPosixLiteral ? `${profileDir}/package.json` : join(profileDir, 'package.json'),
    // Strictly a launcher fact: only argv naming the packaged Desktop host (or
    // the persisted desktop selection, in the fallback branch below) marks the
    // run as desktop. A profile that merely happens to be *named* "desktop" is
    // not evidence about the host, and /mode's installer-service probe keys on
    // the real host shape.
    desktop: desktopLauncher,
  }
}

/** Facts for one explicitly named profile, resolved under `$DSH_HOME/profiles`. */
function factsFor(name: string, env: NodeJS.ProcessEnv, desktop: boolean): ProfileFacts {
  const trimmed = name.trim()
  assertSafeProfileName(trimmed)
  const profileDir = join(resolveDshHome(env), 'profiles', trimmed)
  return {
    profileName: trimmed,
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
    desktop,
  }
}

/**
 * Reject a profile name that is not exactly one directory segment under
 * `profiles/`. `.` is rejected alongside separators and `..`: `join` normalizes
 * it away, so accepting it would silently resolve to the `profiles` directory
 * itself rather than to a profile.
 */
function assertSafeProfileName(name: string): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`plugin-manager: invalid profile name ${JSON.stringify(name)}`)
  }
}

/** The profile package.json surface the gateway reads. */
export interface ProfileManifest {
  /** dsh.profile.bundles entries (may be absent). */
  bundles: string[]
  /** package.json dependencies: package name -> install spec. */
  dependencies: Record<string, string>
}

/**
 * Read the profile manifest; a missing or malformed file fails loud.
 * @param packageJsonPath - absolute path of the profile's package.json.
 * @returns the parsed bundles and dependencies.
 */
export async function readProfileManifest(packageJsonPath: string): Promise<ProfileManifest> {
  const text = await readFile(packageJsonPath, 'utf8')
  const parsed = JSON.parse(stripBom(text)) as {
    dsh?: { profile?: { bundles?: unknown } }
    dependencies?: unknown
  }
  const bundles = Array.isArray(parsed.dsh?.profile?.bundles)
    ? parsed.dsh.profile.bundles.filter((item): item is string => typeof item === 'string')
    : []
  const rawDeps = parsed.dependencies
  const dependencies: Record<string, string> = {}
  if (typeof rawDeps === 'object' && rawDeps !== null) {
    for (const [name, spec] of Object.entries(rawDeps)) {
      if (typeof spec === 'string') dependencies[name] = spec
    }
  }
  return { bundles, dependencies }
}

/**
 * Remove selected entries from the profile manifest's `dsh.profile.bundles`,
 * conservatively: a single backup copy, then a tmp write and an atomic-ish
 * rename over the target — the same discipline as the patch-row editor. Every
 * other key (dependencies included) round-trips untouched; entries not in
 * `names` keep their order. A missing bundles array is a no-op write.
 * @param packageJsonPath - absolute path of the profile's package.json.
 * @param names - bundle entries to strip (package names).
 */
export async function stripProfileBundles(packageJsonPath: string, names: readonly string[]): Promise<void> {
  const text = await readFile(packageJsonPath, 'utf8')
  const parsed = JSON.parse(stripBom(text)) as { dsh?: { profile?: { bundles?: unknown } } }
  const profile = parsed.dsh?.profile
  if (profile === undefined || !Array.isArray(profile.bundles)) return
  profile.bundles = profile.bundles.filter(entry => !(typeof entry === 'string' && names.includes(entry)))
  await copyFile(packageJsonPath, `${packageJsonPath}.bak-plugin-manager`).catch(() => {})
  await writeFile(`${packageJsonPath}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  await rename(`${packageJsonPath}.tmp`, packageJsonPath)
}

/**
 * Move one bundle entry to a position in `dsh.profile.bundles`, preserving
 * every unrelated entry. The plugin-manager migration uses this to keep the
 * renamed aggregate at the same layer position it occupied before the
 * remove/update cycle instead of leaving the CLI append at the end.
 * @param packageJsonPath - absolute path of the profile manifest.
 * @param name - bundle entry to move.
 * @param index - desired zero-based position.
 */
export async function reorderProfileBundle(packageJsonPath: string, name: string, index: number): Promise<void> {
  const text = await readFile(packageJsonPath, 'utf8')
  const parsed = JSON.parse(stripBom(text)) as { dsh?: { profile?: { bundles?: unknown } } }
  const profile = parsed.dsh?.profile
  if (profile === undefined || !Array.isArray(profile.bundles)) return
  const bundles = profile.bundles.filter((entry): entry is string => typeof entry === 'string')
  const current = bundles.indexOf(name)
  if (current >= 0) bundles.splice(current, 1)
  const target = Math.max(0, Math.min(index, bundles.length))
  bundles.splice(target, 0, name)
  profile.bundles = bundles
  await copyFile(packageJsonPath, `${packageJsonPath}.bak-plugin-manager`).catch(() => {})
  await writeFile(`${packageJsonPath}.tmp`, `${JSON.stringify(parsed, null, 2)}
`, { mode: 0o600 })
  await rename(`${packageJsonPath}.tmp`, packageJsonPath)
}

/**
 * Read the profile patch text; a missing file is an empty layer.
 * @param patchPath - absolute path of cordis.patch.yml.
 * @returns the file text, or `[]` when absent.
 */
export async function readPatchText(patchPath: string): Promise<string> {
  try {
    const text = await readFile(patchPath, 'utf8')
    return stripBom(text)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return '[]\n'
    throw error
  }
}

/** Whether a profile directory exists (the gateway needs an initialized profile). */
export function profileExists(profileDir: string): boolean {
  return existsSync(join(profileDir, 'package.json'))
}