/**
 * Manifest-derived asset allowlist for the anonymous write endpoints.
 *
 * /api/like and /api/install key D1 rows by client-asserted (kind, asset_id);
 * without a membership check any scripted 64-char id mints rows and pollutes
 * the public stats. The served manifests are the source of truth for which
 * assets exist — the same pattern handleNpmDownloads uses for its package
 * allowlist (npm-badge.js).
 *
 * Availability rule: if the manifest cannot be read (asset-serving outage in
 * the worker's own ASSETS binding — not attacker-inducible), writes are
 * allowed rather than breaking likes/installs service-wide.
 */

const MANIFEST_BY_KIND = {
  skin: '/manifest/skins.json',
  pet: '/manifest/pets.json',
  plugin: '/manifest/plugins.json',
  preset: '/manifest/presets.json',
}

const TTL_MS = 5 * 60 * 1000

/**
 * Per-isolate cache: { at, ids, source } with ids as "kind\nid" members.
 * Keyed to the ASSETS binding identity so a swapped binding (tests, binding
 * replacement) never reads a stale membership set.
 */
let cache = { at: 0, ids: null, source: null }

async function loadIds(env) {
  const now = Date.now()
  if (cache.ids !== null && cache.source === env.ASSETS && now - cache.at < TTL_MS) return cache.ids
  const ids = new Set()
  for (const [kind, path] of Object.entries(MANIFEST_BY_KIND)) {
    const res = await env.ASSETS.fetch(new URL(path, 'https://dsh-market.com/')).catch(() => null)
    if (!res || res.status !== 200) return null
    const manifest = await res.json().catch(() => null)
    if (!manifest || !Array.isArray(manifest.items)) return null
    for (const item of manifest.items) {
      if (item && typeof item.id === 'string' && item.id) ids.add(kind + '\n' + item.id)
    }
  }
  cache = { at: now, ids, source: env.ASSETS }
  return ids
}

/**
 * Whether (kind, assetId) names a published asset. Returns true when the
 * manifests are unreadable (availability rule above).
 */
export async function isKnownAsset(env, kind, assetId) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return true
  const ids = await loadIds(env)
  if (ids === null) return true
  return ids.has(kind + '\n' + assetId)
}
