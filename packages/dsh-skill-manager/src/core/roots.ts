/**
 * Skill root resolution: the dsh home directory, the project root of a
 * session cwd, and the two install destinations (user-level and workspace).
 *
 * The user skills root mirrors `dsh-skill-filesystem`: `$DSH_HOME/skills`
 * or `~/.dsh/skills`; the workspace root is `<projectRoot>/.agents/skills`,
 * where the project root is the nearest ancestor carrying a `.git` entry
 * (falling back to the cwd itself, matching the provider's `findProjectRoot`).
 * @module @linxin666/dsh-skill-manager/roots
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/** Path existence probe used while walking toward the project root. */
export type PathExists = (path: string) => Promise<boolean>

/**
 * Resolve the dsh home directory.
 * @param env - environment variables (`DSH_HOME` wins).
 * @param home - the user's home directory.
 * @returns the absolute dsh home path.
 */
export function resolveDshHome(env: Record<string, string | undefined>, home: string): string {
  const configured = env.DSH_HOME
  if (configured !== undefined && configured.trim() !== '') {
    return isAbsolute(configured) ? resolve(configured) : resolve(process.cwd(), configured)
  }
  return resolve(home, '.dsh')
}

/**
 * Find the project root for a cwd: the nearest ancestor containing a
 * `.git` path, or the cwd itself.
 * @param cwd - the session's working directory.
 * @param exists - path existence probe.
 * @returns the project root.
 */
export async function findProjectRoot(cwd: string, exists: PathExists): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    if (await exists(join(current, '.git'))) return current
    const parent = resolve(current, '..')
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** The two install destinations the manager offers. */
export type InstallDestination = 'workspace' | 'user'

/** Resolved install roots for one session cwd. */
export interface SkillRoots {
  /** The workspace project root (nearest git root, or cwd). */
  projectRoot: string
  /** Workspace-level skill root: `<projectRoot>/.agents/skills`. */
  workspace: string
  /** User-level skill root: `<dshHome>/skills`. */
  user: string
}

/**
 * Resolve both install roots for a session cwd.
 * @param cwd - the session's working directory.
 * @param dshHome - the resolved dsh home directory.
 * @param exists - path existence probe for the git-root walk.
 * @returns the resolved roots.
 */
export async function resolveSkillRoots(cwd: string, dshHome: string, exists: PathExists): Promise<SkillRoots> {
  const projectRoot = await findProjectRoot(cwd, exists)
  return {
    projectRoot,
    workspace: join(projectRoot, '.agents', 'skills'),
    user: join(dshHome, 'skills'),
  }
}

/** Default dsh home for the host process. */
export function hostDshHome(): string {
  return resolveDshHome(process.env as Record<string, string | undefined>, homedir())
}
