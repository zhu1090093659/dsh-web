/** Browser-local exact-version update ignore rules (issue #2078). */
import type { PluginUpdateItem } from '../core/protocol.ts'
import { withIgnoredUpdate, withoutIgnoredUpdate, type IgnoredPluginUpdate } from '../core/updates.ts'

/** localStorage key for the versioned ignore-list document. */
export const IGNORED_UPDATES_STORAGE_KEY = 'dsh.plugin-manager.ignored-updates.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** Read valid unique rules; malformed or unavailable storage yields an empty list. */
export function loadIgnoredUpdates(storage: StorageLike | undefined = browserStorage()): IgnoredPluginUpdate[] {
  if (storage === undefined) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(IGNORED_UPDATES_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    const result: IgnoredPluginUpdate[] = []
    const seen = new Set<string>()
    for (const value of parsed) {
      if (typeof value !== 'object' || value === null) continue
      const row = value as Record<string, unknown>
      if (typeof row.id !== 'string' || row.id === '' || typeof row.version !== 'string' || row.version === '') continue
      const key = JSON.stringify([row.id, row.version])
      if (seen.has(key)) continue
      seen.add(key)
      result.push({ id: row.id, version: row.version })
    }
    return result
  } catch {
    return []
  }
}

/** Persist the list when storage permits; the in-memory answer remains usable either way. */
export function saveIgnoredUpdates(ignored: readonly IgnoredPluginUpdate[], storage: StorageLike | undefined = browserStorage()): void {
  try {
    storage?.setItem(IGNORED_UPDATES_STORAGE_KEY, JSON.stringify(ignored))
  } catch {
    // Private-mode and quota failures degrade the rule to this page session.
  }
}

/** Ignore one exact offer and persist the resulting independent list. */
export function rememberIgnoredUpdate(current: readonly IgnoredPluginUpdate[], item: PluginUpdateItem): IgnoredPluginUpdate[] {
  const next = withIgnoredUpdate(current, item)
  saveIgnoredUpdates(next)
  return next
}

/** Restore one exact offer and persist the resulting independent list. */
export function forgetIgnoredUpdate(current: readonly IgnoredPluginUpdate[], item: PluginUpdateItem): IgnoredPluginUpdate[] {
  const next = withoutIgnoredUpdate(current, item)
  saveIgnoredUpdates(next)
  return next
}
