/**
 * Install-spec helpers shared by the market card: one-line command copy and
 * the installed-row lookup for plugins.
 */

import type { InstalledPluginItem } from './plugin-manager-bridge.ts'

export interface PluginEntryLike {
  id: string
  npm?: string
  repo?: string
}

/**
 * npm package name (optionally scoped, lowercase) as the store manifest
 * uses it, plus the optional concrete version/tag suffix npm accepts
 * (e.g. pkg@1.2.3, @scope/pkg@next). Range operators are not part of the
 * store convention, so `^1.0.0`-style specs stay rejected.
 */
const NPM_SPEC = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[0-9A-Za-z][0-9A-Za-z._-]*)?$/

/** The command to install a plugin entry (npm package when published, else its repository URL). */
export function installCommand(entry: PluginEntryLike): string {
  return `dsh plugin --profile web add ${entry.npm ?? entry.repo ?? entry.id}`
}

/** The spec handed to the pluginManager service. */
export function installSpec(entry: PluginEntryLike): string {
  return entry.npm ?? entry.repo ?? entry.id
}

/**
 * Whether an install spec may be handed to the plugin manager. Acceptable
 * shapes are an npm package name (optionally pkg@version) or a plain
 * https:// git URL; ssh://, git@-style, file://, http://, relative paths and
 * bare repo names are rejected, so the remote manifest can never drive a
 * non-https or local install.
 */
export function isInstallSpecValid(spec: string): boolean {
  if (spec.startsWith('https://')) return isHttpsGitUrl(spec)
  return NPM_SPEC.test(spec)
}

/** Whether a spec is a well-formed https:// URL with a host. */
function isHttpsGitUrl(spec: string): boolean {
  // The URL parser re-homes 'https:///path' onto host 'path'; require the
  // host to actually start right after the scheme.
  if (!/^https:\/\/[A-Za-z0-9]/.test(spec)) return false
  if (/[\s\u0000-\u001F\u007F]/.test(spec)) return false
  try {
    const url = new URL(spec)
    return url.protocol === 'https:' && url.hostname !== ''
  } catch {
    return false
  }
}

/** Find the installed row for an entry (null when not installed or no snapshot). */
export function entryInstalled(entry: PluginEntryLike, installed: readonly InstalledPluginItem[]): InstalledPluginItem | null {
  return installed.find((item) => item.id === entry.id) ?? null
}
