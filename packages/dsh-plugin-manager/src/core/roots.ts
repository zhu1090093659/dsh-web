/**
 * dsh home resolution for the plugin manager's on-disk persistence: the
 * user patch layer `<dshHome>/cordis.patch.yml` (hot-watched by dsh web)
 * and the fallback ledger `<dshHome>/plugin-manager.json`.
 * @module @linxin666/dsh-plugin-manager/roots
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

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

/** Default dsh home for the host process. */
export function hostDshHome(): string {
  return resolveDshHome(process.env as Record<string, string | undefined>, homedir())
}

/** The user patch layer every dsh profile composes (and hot-reloads). */
export function userPatchPath(dshHome: string): string {
  return join(dshHome, 'cordis.patch.yml')
}

/** The fallback ledger path. */
export function ledgerPath(dshHome: string): string {
  return join(dshHome, 'plugin-manager.json')
}
