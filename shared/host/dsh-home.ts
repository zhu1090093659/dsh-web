/**
 * DSH_HOME and DSH_AGENTS_HOME resolution shared by the plugin family's Host
 * halves: environment overrides win (blank values treated as unset), then the
 * platform home fallbacks follow — mirroring `@deepseek-ai/dsh-home-paths`.
 */

import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { isAbsolute as posixIsAbsolute, join as posixJoin } from 'node:path/posix'

/** Expand a leading ~ (or ~user) in a path, platform-style. */
export function expandHome(path: string, home: string = homedir()): string {
  const isPosix = home.startsWith('/')
  const j = isPosix ? posixJoin : join
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return j(home, path.slice(2))
  return path
}

function resolveUserRoot(
  envValue: string | undefined,
  defaultDirName: string,
  home: string,
): string {
  const isPosix = home.startsWith('/')
  const j = isPosix ? posixJoin : join
  const isAbs = isPosix ? posixIsAbsolute : isAbsolute
  if (envValue !== undefined && envValue.trim() !== '') {
    const expanded = expandHome(envValue.trim(), home)
    return isAbs(expanded) ? expanded : j(process.cwd(), expanded)
  }
  return j(home, defaultDirName)
}

/**
 * Resolve the DSH home directory.
 * @param env - process environment to read DSH_HOME from.
 * @param home - platform home directory fallback (test seam).
 * @returns the absolute DSH home path.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return resolveUserRoot(env.DSH_HOME, '.dsh', home)
}

/** Resolve the DSH home directory from the live environment. */
export function dshHome(): string {
  return resolveDshHome()
}

/**
 * Resolve the shared agent configuration root (`$DSH_AGENTS_HOME`, defaulting
 * to `<home>/.agents`), matching `@deepseek-ai/dsh-home-paths`'s `resolveAgentsHome`.
 * @param env - process environment to read DSH_AGENTS_HOME from.
 * @param home - platform home directory fallback (test seam).
 * @returns the absolute shared agents home path.
 */
export function resolveAgentsHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return resolveUserRoot(env.DSH_AGENTS_HOME, '.agents', home)
}

/** Resolve the shared agent configuration root from the live environment. */
export function agentsHome(): string {
  return resolveAgentsHome()
}
