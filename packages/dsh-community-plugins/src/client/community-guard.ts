/**
 * Runtime guard for the generated community index entries. The index is
 * build-time generated data, but the card renders whatever the module
 * carries; a hand-written narrowing keeps one malformed entry from breaking
 * the whole list at render time.
 */

import { COMMUNITY_CATEGORIES, type CommunityPluginCategory, type CommunityPluginEntry } from './generated/community.ts'

/** Category ids the card knows how to label; others are treated as uncategorized. */
const KNOWN_CATEGORIES: readonly CommunityPluginCategory[] = COMMUNITY_CATEGORIES

/**
 * The install command is pasted into a shell, so repo/npm must be free of
 * shell metacharacters: repo is a plain https URL of path-safe characters,
 * npm a standard (optionally scoped) package name.
 */
const REPO_SAFE_RE = /^https:\/\/[A-Za-z0-9._~\/-]+$/
const NPM_SAFE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** True when the value is a well-formed community plugin entry. */
export function isCommunityPluginEntry(value: unknown): value is CommunityPluginEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || entry.id === '') return false
  if (typeof entry.name !== 'string' || typeof entry.nameEn !== 'string') return false
  if (typeof entry.author !== 'string' || entry.author === '') return false
  if (typeof entry.repo !== 'string' || !REPO_SAFE_RE.test(entry.repo)) return false
  if (entry.description !== undefined && typeof entry.description !== 'string') return false
  if (entry.descriptionEn !== undefined && typeof entry.descriptionEn !== 'string') return false
  if (entry.npm !== undefined && (typeof entry.npm !== 'string' || !NPM_SAFE_RE.test(entry.npm))) return false
  if (entry.category !== undefined && (typeof entry.category !== 'string' || !KNOWN_CATEGORIES.includes(entry.category as CommunityPluginCategory))) return false
  return true
}
