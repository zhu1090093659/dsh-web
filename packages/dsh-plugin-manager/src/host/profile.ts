/**
 * Profile resolution and manifest reads for the gateway host half. The npm
 * web runtime has no plugin-installer service, so this package resolves the
 * boot profile from the host process's own argv (the launcher fact) and reads
 * the profile's package.json and cordis.patch.yml directly — reads only; every
 * write goes through the official CLI or the patch-row editor.
 * @module @linxin666/dsh-client-ui-plugin-manager/host
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined && argv[flagIndex + 1] !== '') {
    name = argv[flagIndex + 1]
  } else if (env.DSH_PROFILE !== undefined && env.DSH_PROFILE.trim() !== '') {
    name = env.DSH_PROFILE.trim()
  } else if (argv.includes('web')) {
    name = 'web'
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
