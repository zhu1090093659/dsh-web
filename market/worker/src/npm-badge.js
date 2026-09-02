/**
 * Shields.io endpoint badges for the dsh-web npm family. The aggregate
 * package was renamed from @linxin666/dsh-web-ui-all to @linxin666/dsh-web-all
 * (dual-published for two releases, then the legacy name is deprecated), so
 * badge numbers must cover both names — shields' native npm badges cannot sum
 * packages and 404 on the new name until its first publish.
 *
 * The cumulative total badge sums every channel the family is installed from:
 * the npm official registry, the npmmirror registry that serves most domestic
 * traffic, and this repository's GitHub release assets. Sources are read at
 * request time and cached per isolate; a failed channel is skipped so the
 * badge still shows the remaining sum, and only a total absence of data
 * degrades to the grey "unavailable" badge.
 */

const PACKAGES = ['@linxin666/dsh-web-all', '@linxin666/dsh-web-ui-all']
/**
 * Every package name ever published under the family scope: current plugins,
 * both aggregate names, and the retired ones (pre-rename or removed). Summing
 * counts aggregate dependency pulls too, which is the standard "total npm
 * downloads" badge convention. New published family packages must be added
 * here. A cold total compute costs packages x windows x 2 registry requests
 * plus one GitHub page request (51 today); the isolate caches and shields'
 * 30-minute badge cache keep that at roughly one burst per colo per hour.
 */
const FAMILY_PACKAGES = [
  '@linxin666/dsh-web-all', '@linxin666/dsh-web-ui-all',
  '@linxin666/dsh-chat-recovery', '@linxin666/dsh-client-ui-aionui-panel',
  '@linxin666/dsh-client-ui-community-plugins', '@linxin666/dsh-client-ui-git-graph',
  '@linxin666/dsh-client-ui-market', '@linxin666/dsh-client-ui-plugin-manager',
  '@linxin666/dsh-client-ui-session-id', '@linxin666/dsh-client-ui-skill-explorer',
  '@linxin666/dsh-client-ui-skin-center', '@linxin666/dsh-client-ui-task-board',
  '@linxin666/dsh-client-ui-web-ui-settings', '@linxin666/dsh-desktop-launcher',
  '@linxin666/dsh-doctor', '@linxin666/dsh-i18n', '@linxin666/dsh-liangshen',
  '@linxin666/dsh-live-stats', '@linxin666/dsh-perf', '@linxin666/dsh-pet',
  '@linxin666/dsh-remote-web-ui', '@linxin666/dsh-skins', '@linxin666/dsh-ssh',
  '@linxin666/dsh-tool-describe-image', '@linxin666/dsh-usage',
]
/** Before the family's first publish (2026-08-13); both registries clamp a window's start to real data. */
const FAMILY_EPOCH = '2026-01-01'
/** Below npm's 18-month range clamp; npmmirror rejects windows wider than about a year. */
const RANGE_WINDOW_DAYS = 365
const REPO = 'zhu1090093659/dsh-web'
const TTL_MS = 60 * 60 * 1000
const GITHUB_TTL_MS = 6 * 60 * 60 * 1000
const BADGE_CACHE = { 'cache-control': 'public, max-age=1800' }
/** Batch endpoint cache: one entry per served plugin manifest generation. */
const DOWNLOADS_CACHE = { 'cache-control': 'public, max-age=1800, stale-while-revalidate=3600' }

let cache = { at: 0, downloads: null, version: null }
let totalCache = { at: 0, total: null }
let githubCache = { at: 0, total: null }
let pluginDownloadsCache = { at: 0, key: '', downloads: null }

async function fetchJson(url, headers) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers } })
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

/** Compact all-time count, e.g. 12.3k / 1.4m. */
export function formatTotal(n) {
  const trim = (v) => String(Math.round(v * 10) / 10)
  if (n >= 1e6) return trim(n / 1e6) + 'm'
  if (n >= 1e3) return trim(n / 1e3) + 'k'
  return String(n)
}

/** Last-30d npm download count for exactly one package, or null when npm has no data. */
async function packageDownloads(pkg) {
  const data = await fetchJson('https://api.npmjs.org/downloads/point/last-month/' + encodeURIComponent(pkg))
  return data && Number.isFinite(data.downloads) ? data.downloads : null
}

/**
 * Inclusive, non-overlapping date windows tiling [FAMILY_EPOCH, today]. npm's
 * range API silently clamps any window to the trailing 18 months, so an
 * all-time sum must be requested as successive windows instead of one open
 * range.
 */
export function rangeWindows(today) {
  const DAY = 86400000
  const end = Date.parse(today + 'T00:00:00Z')
  let start = Date.parse(FAMILY_EPOCH + 'T00:00:00Z')
  const windows = []
  while (start < end) {
    const stop = Math.min(start + (RANGE_WINDOW_DAYS - 1) * DAY, end)
    windows.push([new Date(start).toISOString().slice(0, 10), new Date(stop).toISOString().slice(0, 10)])
    start = stop + DAY
  }
  return windows
}

/** All-time download sum for one package on one registry, or null when the registry answers nothing usable for any window. */
async function registryPackageTotal(host, pkg) {
  const enc = encodeURIComponent(pkg)
  let sum = null
  for (const [start, end] of rangeWindows(new Date().toISOString().slice(0, 10))) {
    const data = await fetchJson('https://' + host + '/downloads/range/' + start + ':' + end + '/' + enc)
    if (!data || !Array.isArray(data.downloads)) return null
    sum = (sum || 0) + data.downloads.reduce((acc, day) => acc + (Number(day.downloads) || 0), 0)
  }
  return sum
}

/** All-time family sum on one registry; null only when no package answered. */
async function registryFamilyTotal(host) {
  const sums = await Promise.all(FAMILY_PACKAGES.map((pkg) => registryPackageTotal(host, pkg)))
  let total = null
  for (const sum of sums) {
    if (sum !== null) total = (total || 0) + sum
  }
  return total
}

/**
 * GitHub release asset downloads for the repository. Releases are rare, so
 * the sum is cached for 6 hours and the last good value keeps serving when
 * api.github.com rate-limits the shared Cloudflare egress IPs — the badge
 * never loses the channel over a blip. Binding a fine-grained GITHUB_TOKEN
 * secret (public-repo read-only is enough) moves the channel to the
 * authenticated quota; unauthenticated reads are best-effort.
 */
async function githubReleasesTotal(env) {
  const now = Date.now()
  if (now - githubCache.at < GITHUB_TTL_MS) return githubCache.total
  const token = env && typeof env.GITHUB_TOKEN === 'string' ? env.GITHUB_TOKEN : ''
  const headers = token ? { authorization: 'Bearer ' + token } : undefined
  let sum = 0
  let ok = false
  for (let page = 1; page <= 10; page++) {
    const data = await fetchJson('https://api.github.com/repos/' + REPO + '/releases?per_page=100&page=' + page, headers)
    if (!Array.isArray(data)) break
    ok = true
    for (const release of data) {
      for (const asset of release.assets || []) sum += Number(asset.download_count) || 0
    }
    if (data.length < 100) break
  }
  if (ok) githubCache = { at: now, total: sum }
  return githubCache.total
}

/** All-time cumulative downloads across the family, all channels combined; null only when no channel answered. */
async function totalDownloads(env) {
  const now = Date.now()
  if (now - totalCache.at < TTL_MS && totalCache.total !== null) return totalCache.total
  const [npm, mirror, github] = await Promise.all([
    registryFamilyTotal('api.npmjs.org'),
    registryFamilyTotal('registry.npmmirror.com'),
    githubReleasesTotal(env),
  ])
  let total = null
  for (const part of [npm, mirror, github]) {
    if (part !== null) total = (total || 0) + part
  }
  totalCache = { at: now, total }
  return total
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

/** kind is 'downloads' | 'version' | 'total'; json is the worker's JSON responder. */
/**
 * Batch last-30d npm downloads for every plugin in the served manifest.
 * The manifest-derived package list is the allowlist: no query parameter ever
 * drives an upstream lookup. Unpublishable or unlisted packages stay null,
 * and the whole batch cache-lines on the manifest generation.
 */
export async function handleNpmDownloads(env, json) {
  const read = async (path) => {
    const res = await env.ASSETS.fetch(new URL(path, 'https://dsh-market.com/'))
    if (!res || res.status !== 200) return null
    return res.json().catch(() => null)
  }
  const manifest = await read('/manifest/plugins.json')
  if (!manifest || !Array.isArray(manifest.items)) return json({ ok: false, error: 'downloads-unavailable' }, 503)
  const packages = []
  for (const item of manifest.items) {
    if (item && typeof item.npm === 'string' && item.npm && !packages.includes(item.npm)) packages.push(item.npm)
  }
  if (packages.length === 0) return json({ ok: true, generatedAt: new Date().toISOString(), ttlSeconds: 3600, downloads: {} }, 200, DOWNLOADS_CACHE)
  const key = JSON.stringify(packages)
  const now = Date.now()
  if (now - pluginDownloadsCache.at < TTL_MS && pluginDownloadsCache.key === key && pluginDownloadsCache.downloads !== null) {
    return json({ ok: true, generatedAt: new Date(pluginDownloadsCache.at).toISOString(), ttlSeconds: TTL_MS / 1000, downloads: pluginDownloadsCache.downloads }, 200, DOWNLOADS_CACHE)
  }
  const values = await Promise.all(packages.map((pkg) => packageDownloads(pkg)))
  const downloads = {}
  packages.forEach((pkg, index) => { if (values[index] !== null) downloads[pkg] = values[index] })
  pluginDownloadsCache = { at: now, key, downloads }
  return json({ ok: true, generatedAt: new Date(now).toISOString(), ttlSeconds: TTL_MS / 1000, downloads }, 200, DOWNLOADS_CACHE)
}

export async function handleNpmBadge(kind, json, env) {
  if (kind === 'total') {
    const total = await totalDownloads(env)
    if (total === null) return json({ schemaVersion: 1, label: 'downloads', message: 'unavailable', color: 'lightgrey' }, 200, BADGE_CACHE)
    return json({ schemaVersion: 1, label: 'downloads', message: formatTotal(total) + ' total', color: 'blue' }, 200, BADGE_CACHE)
  }
  const data = await totals()
  if (kind === 'downloads') {
    if (data.downloads === null) return json({ schemaVersion: 1, label: 'downloads', message: 'unavailable', color: 'lightgrey' }, 200, BADGE_CACHE)
    return json({ schemaVersion: 1, label: 'downloads', message: formatDownloads(data.downloads), color: 'blue', namedLogo: 'npm' }, 200, BADGE_CACHE)
  }
  if (data.version === null) return json({ schemaVersion: 1, label: 'npm', message: 'unavailable', color: 'lightgrey' }, 200, BADGE_CACHE)
  return json({ schemaVersion: 1, label: 'npm', message: 'v' + data.version, color: 'blue', namedLogo: 'npm' }, 200, BADGE_CACHE)
}

/** Test hook: drop the per-isolate caches so a test exercises a cold compute. */
export function clearBadgeCaches() {
  cache = { at: 0, downloads: null, version: null }
  totalCache = { at: 0, total: null }
  githubCache = { at: 0, total: null }
  pluginDownloadsCache = { at: 0, key: '', downloads: null }
}
