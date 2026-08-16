/**
 * Runtime guard for the generated community index entries. The index is
 * build-time generated data, but the card renders whatever the module
 * carries; a hand-written narrowing keeps one malformed entry from breaking
 * the whole list at render time.
 */

import type { CommunityPluginEntry } from './generated/community.ts'

/** True when the value is a well-formed community plugin entry. */
export function isCommunityPluginEntry(value: unknown): value is CommunityPluginEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.id !== 'string' || entry.id === '') return false
  if (typeof entry.name !== 'string' || typeof entry.nameEn !== 'string') return false
  if (typeof entry.author !== 'string' || entry.author === '') return false
  if (typeof entry.repo !== 'string' || !entry.repo.startsWith('https://')) return false
  if (entry.description !== undefined && typeof entry.description !== 'string') return false
  if (entry.descriptionEn !== undefined && typeof entry.descriptionEn !== 'string') return false
  if (entry.npm !== undefined && typeof entry.npm !== 'string') return false
  return true
}
