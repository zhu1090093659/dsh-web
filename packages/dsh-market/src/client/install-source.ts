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

/** Strips an npm scope prefix (e.g. '@scope/pkg' -> 'pkg'). */
function unscoped(name: string): string {
  return name.replace(/^@[^/]+\//, '')
}

/** Strips version/tag suffix from an npm spec (e.g. 'pkg@1.2.3' -> 'pkg', '@scope/pkg@1.2.3' -> '@scope/pkg'). */
function stripVersion(spec: string): string {
  const atIdx = spec.lastIndexOf('@')
  return atIdx > 0 ? spec.slice(0, atIdx) : spec
}

/** Normalizes a git URL or spec to a canonical owner/repo path. */
function normalizeRepo(spec: string): string {
  let s = spec.trim().toLowerCase()
  const hashIdx = s.indexOf('#')
  if (hashIdx !== -1) s = s.slice(0, hashIdx)
  s = s.replace(/^(?:git\+)?https?:\/\/(?:www\.)?github\.com\//, '')
    .replace(/^github:/, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  return s
}

/** Whether an installed plugin row corresponds to a market plugin entry. */
function isRowMatch(entry: PluginEntryLike, item: InstalledPluginItem): boolean {
  // 1. Direct ID / name match
  if (item.id === entry.id || item.name === entry.id) return true

  // 2. Direct npm match (with or without version tags)
  if (entry.npm) {
    const entryNpmBase = stripVersion(entry.npm)
    if (item.id === entry.npm || item.id === entryNpmBase) return true
    if (item.name === entry.npm || item.name === entryNpmBase) return true
    if (stripVersion(item.source.spec) === entryNpmBase) return true
  }

  // 3. Unscoped match (e.g. '@omdsh-dev/dsh-annotation' matches 'dsh-annotation')
  const itemUnscoped = unscoped(item.id)
  const nameUnscoped = unscoped(item.name)
  if (itemUnscoped === entry.id || nameUnscoped === entry.id) return true
  if (entry.npm) {
    const entryUnscoped = unscoped(stripVersion(entry.npm))
    if (itemUnscoped === entryUnscoped || nameUnscoped === entryUnscoped) return true
    if (entryUnscoped === item.id || entryUnscoped === item.name) return true
  }

  // 4. Git repository / spec match
  if (entry.repo) {
    const entryCanon = normalizeRepo(entry.repo)
    if (entryCanon) {
      if (normalizeRepo(item.id) === entryCanon) return true
      if (normalizeRepo(item.name) === entryCanon) return true
      if (normalizeRepo(item.source.spec) === entryCanon) return true
    }
  }

  return false
}

/** Find the installed row for an entry (null when not installed or no snapshot). */
export function entryInstalled(entry: PluginEntryLike, installed: readonly InstalledPluginItem[]): InstalledPluginItem | null {
  return installed.find((item) => isRowMatch(entry, item)) ?? null
}
