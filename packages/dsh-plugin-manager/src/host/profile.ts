/**
 * Profile resolution and manifest reads for the gateway host half. The npm
 * web runtime has no plugin-installer service, so this package resolves the
 * boot profile from the host process's own argv (the launcher fact) and reads
 * the profile's package.json and cordis.patch.yml directly — reads only; every
 * write goes through the official CLI or the patch-row editor.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { existsSync } from 'node:fs'
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
}

/**
 * Resolve the boot profile name: an explicit `--profile` flag wins, then the
 * DSH_PROFILE environment override, then the `web` subcommand alias, then the
 * desktop app's active profile. The launcher hands the app its own args
 * verbatim, so the web app's argv is the reliable source on every
 * CLI-launched host; the packaged Desktop shell (deepseek-harness-desktop)
 * boots the harness in-process with none of those facts, so its
 * `desktopProfiles` service name is the final fallback.
 * @param argv - process argv (test seam).
 * @param env - process environment (test seam).
 * @param desktopProfileName - active profile reported by the desktop shell's
 * `desktopProfiles` service, when this runtime provides one.
 * @returns the resolved profile facts.
 */
export function resolveProfile(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
  desktopProfileName?: string,
): ProfileFacts {
  const flagIndex = argv.indexOf('--profile')
  let name: string | undefined
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined && argv[flagIndex + 1] !== '') {
    name = argv[flagIndex + 1]
  } else if (env.DSH_PROFILE !== undefined && env.DSH_PROFILE.trim() !== '') {
    name = env.DSH_PROFILE.trim()
  } else if (argv.includes('web')) {
    name = 'web'
  }
  if (name === undefined && desktopProfileName !== undefined && desktopProfileName.trim() !== '') {
    name = desktopProfileName.trim()
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
  const parsed = JSON.parse(text) as {
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
  const parsed = JSON.parse(text) as { dsh?: { profile?: { bundles?: unknown } } }
  const profile = parsed.dsh?.profile
  if (profile === undefined || !Array.isArray(profile.bundles)) return
  profile.bundles = profile.bundles.filter(entry => !(typeof entry === 'string' && names.includes(entry)))
  await copyFile(packageJsonPath, `${packageJsonPath}.bak-plugin-manager`).catch(() => {})
  await writeFile(`${packageJsonPath}.tmp`, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 })
  await rename(`${packageJsonPath}.tmp`, packageJsonPath)
}

/**
 * Read the profile patch text; a missing file is an empty layer.
 * @param patchPath - absolute path of cordis.patch.yml.
 * @returns the file text, or `[]` when absent.
 */
export async function readPatchText(patchPath: string): Promise<string> {
  try {
    return await readFile(patchPath, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return '[]\n'
    throw error
  }
}

/** Whether a profile directory exists (the gateway needs an initialized profile). */
export function profileExists(profileDir: string): boolean {
  return existsSync(join(profileDir, 'package.json'))
}
