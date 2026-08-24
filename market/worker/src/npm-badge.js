/**
 * Shields.io endpoint badges for the dsh-web npm family. The aggregate
 * package was renamed from @linxin666/dsh-web-ui-all to @linxin666/dsh-web-all
 * (dual-published for two releases, then the legacy name is deprecated), so
 * badge numbers must cover both names — shields' native npm badges cannot sum
 * packages and 404 on the new name until its first publish. Numbers come from
 * the public npm API at request time, cached briefly per isolate.
 */

const PACKAGES = ['@linxin666/dsh-web-all', '@linxin666/dsh-web-ui-all']
const TTL_MS = 60 * 60 * 1000
const BADGE_CACHE = { 'cache-control': 'public, max-age=1800' }

let cache = { at: 0, downloads: null, version: null }

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  }
}

function formatDownloads(n) {
  const trim = (v) => String(Math.round(v * 10) / 10)
  if (n >= 1e6) return trim(n / 1e6) + 'm/month'
  if (n >= 1e3) return trim(n / 1e3) + 'k/month'
  return String(n) + '/month'
}

/** Compare two clean vX.Y.Z versions; returns positive when a > b. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((s) => Number.parseInt(s, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((s) => Number.parseInt(s, 10) || 0)
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i] }
  return 0
}

async function totals() {
  const now = Date.now()
  if (now - cache.at < TTL_MS && (cache.downloads !== null || cache.version !== null)) return cache
  const enc = (p) => encodeURIComponent(p)
  const [dls, vers] = await Promise.all([
    Promise.all(PACKAGES.map((p) => fetchJson('https://api.npmjs.org/downloads/point/last-month/' + enc(p)))),
    Promise.all(PACKAGES.map((p) => fetchJson('https://registry.npmjs.org/' + enc(p) + '/latest'))),
  ])
  let downloads = null
  for (const d of dls) {
    if (d && Number.isFinite(d.downloads)) downloads = (downloads || 0) + d.downloads
  }
  let version = null
  for (const v of vers) {
    if (v && typeof v.version === 'string' && (version === null || compareVersions(v.version, version) > 0)) version = v.version
  }
  cache = { at: now, downloads, version }
  return cache
}

/** kind is 'downloads' or 'version'; json is the worker's JSON responder. */
export async function handleNpmBadge(kind, json) {
  const data = await totals()
  if (kind === 'downloads') {
    if (data.downloads === null) return json({ schemaVersion: 1, label: 'downloads', message: 'unavailable', color: 'lightgrey' }, 200, BADGE_CACHE)
    return json({ schemaVersion: 1, label: 'downloads', message: formatDownloads(data.downloads), color: 'blue', namedLogo: 'npm' }, 200, BADGE_CACHE)
  }
  if (data.version === null) return json({ schemaVersion: 1, label: 'npm', message: 'unavailable', color: 'lightgrey' }, 200, BADGE_CACHE)
  return json({ schemaVersion: 1, label: 'npm', message: 'v' + data.version, color: 'blue', namedLogo: 'npm' }, 200, BADGE_CACHE)
}
