import { SKIN_CENTER_ENTRIES, type SkinCenterEntry } from './generated/skins.ts'

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Validate the host's JSON boundary before entries reach DOM/style operations. */
function isSkinEntry(value: unknown): value is SkinCenterEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  const required = ['id', 'name', 'nameEn', 'tagline', 'accent', 'bodyAttr', 'package'] as const
  if (required.some(key => typeof entry[key] !== 'string' || entry[key] === '')) return false
  if (!/^[a-z0-9-]+$/.test(entry.id as string)) return false
  if (!/^data-dsh-[a-z0-9-]+$/.test(entry.bodyAttr as string)) return false
  if (!NPM_PACKAGE_NAME_RE.test(entry.package as string)) return false
  if (entry.author !== undefined && typeof entry.author !== 'string') return false
  if (entry.description !== undefined && typeof entry.description !== 'string') return false
  if (entry.tags !== undefined && (!Array.isArray(entry.tags) || !entry.tags.every(tag => typeof tag === 'string'))) return false
  if (entry.order !== undefined && (typeof entry.order !== 'number' || !Number.isFinite(entry.order))) return false
  return true
}

/** Load the host-discovered skin roster, falling back for older deployments. */
export async function loadSkinRoster(fetcher: Fetcher = fetch): Promise<readonly SkinCenterEntry[]> {
  try {
    const response = await fetcher('/api/skin-center/skins')
    if (!response.ok) return SKIN_CENTER_ENTRIES
    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return SKIN_CENTER_ENTRIES
    const record = payload as { ok?: unknown; skins?: unknown }
    if (record.ok !== true || !Array.isArray(record.skins) || !record.skins.every(isSkinEntry)) {
      return SKIN_CENTER_ENTRIES
    }
    return record.skins
  } catch {
    return SKIN_CENTER_ENTRIES
  }
}
