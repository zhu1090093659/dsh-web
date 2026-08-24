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
import { join } from 'node:path'
import { resolveDshHome } from './dsh-home.ts'

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
 * Resolve the boot profile name from the host argv: an explicit `--profile`
 * flag wins, then the DSH_PROFILE environment override, then the `web`
 * subcommand alias. The launcher hands the app its own args verbatim, so the
 * web app's argv is the reliable source on every CLI-launched host.
 * @param argv - process argv (test seam).
 * @param env - process environment (test seam).
 * @returns the resolved profile facts.
 */
export function resolveProfile(argv: readonly string[] = process.argv, env: NodeJS.ProcessEnv = process.env): ProfileFacts {
  const flagIndex = argv.indexOf('--profile')
  let name: string | undefined
  let desktop = false
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined && argv[flagIndex + 1] !== '') {
    name = argv[flagIndex + 1]
  } else if (env.DSH_PROFILE !== undefined && env.DSH_PROFILE.trim() !== '') {
    name = env.DSH_PROFILE.trim()
    // A Desktop workaround may set DSH_PROFILE globally. Its in-process boot
    // still has only the executable in argv; keep desktop channel probing in
    // that shape, while ordinary CLI invocations remain non-desktop.
    desktop = argv.length <= 1 && desktopSelectedProfile(env) === name
  } else if (argv.includes('web')) {
    name = 'web'
  } else {
    name = desktopSelectedProfile(env)
    desktop = name !== undefined
  }
  if (name === undefined) {
    throw new Error('plugin-manager: cannot determine the boot profile; pass --profile <name> or set DSH_PROFILE')
  }
  // The name becomes a directory under profiles/: reject traversal outright.
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`plugin-manager: invalid profile name ${JSON.stringify(name)}`)
  }
  const profileDir = join(resolveDshHome(env), 'profiles', name)
  return {
    profileName: name,
    profileDir,
    patchPath: join(profileDir, 'cordis.patch.yml'),
    packageJsonPath: join(profileDir, 'package.json'),
    desktop,
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
