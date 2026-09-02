/**
 * dsh-market — anonymous usage telemetry.
 *
 * Two event kinds live in one table:
 * - pageview ('pv'): one row per visitor per site path per UTC day.
 * - heartbeat ('hb'): one row per instance per reported item per UTC day,
 *   sent by dsh-web family plugins from the user's browser.
 *
 * Privacy contract: the only identity-like field is a random UUID generated
 * client-side and stored in the browser's localStorage; the worker hashes it
 * with a deployment salt before insert and never persists IP addresses.
 * Aggregate summaries expose counts only, never raw events.
 */

import { readJsonCapped } from './body.js'

const VISITOR_RE = /^[A-Za-z0-9_-]{16,64}$/
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%?/-]{0,127}$/
const NAME_RE = /^[A-Za-z0-9@][A-Za-z0-9@/._:-]{0,63}$/
const VERSION_RE = /^[A-Za-z0-9.+~-]{1,32}$/
const CHANNELS = new Set(['market', 'npm', 'unknown'])
const KINDS = new Set(['pageview', 'heartbeat'])
/**
 * Honest-crawler filter for site pageviews: scanners and search bots that
 * execute JS inflate UV 1:1 with PV because every crawl mints a fresh visitor
 * id. UA is spoofable, so this only drops the honest bulk noise — plugin
 * heartbeats stay unfiltered (they require a real DSH GUI anyway).
 */
const BOT_UA_RE = /bot|crawler|spider|scrape|curl|wget|python|httpclient|http-client|headless|phantom|slurp|archive|scanner|monitor|pingdom|uptime|lighthouse|preview/i
const MAX_ITEMS = 64
/** Heartbeats carry at most MAX_ITEMS small items; cap the raw body too. */
const TELEMETRY_BODY_MAX_BYTES = 16 * 1024
/** Events older than this many days are pruned by the cron trigger. */
const RETENTION_DAYS = 400

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** UTC day bucket, e.g. "2026-05-01". */
export function utcDay(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 10)
}

/** Hash the raw visitor id with the deployment salt; null when unusable. */
export async function visitorHash(visitor, env) {
  if (typeof visitor !== 'string' || !VISITOR_RE.test(visitor)) return null
  return sha256((env.TELEMETRY_SALT || 'dsh-market-telemetry') + '|' + visitor)
}

/**
 * Validate a pageview submission. Returns
 * { ok: true, visitor, path } or { ok: false, error }.
 */
export function parsePageview(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid-body' }
  const path = typeof body.path === 'string' ? body.path : ''
  if (!PATH_RE.test(path)) return { ok: false, error: 'invalid-path' }
  return { ok: true, visitor: typeof body.visitor === 'string' ? body.visitor : '', path }
}

/**
 * Validate a heartbeat submission with its item list. Returns
 * { ok: true, visitor, items: [{ name, version }] } or { ok: false, error }.
 */
export function parseHeartbeat(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid-body' }
  const rawItems = Array.isArray(body.items) ? body.items : []
  if (rawItems.length === 0 || rawItems.length > MAX_ITEMS) return { ok: false, error: 'invalid-items' }
  const items = []
  const seen = new Set()
  for (const raw of rawItems) {
    const item = raw && typeof raw === 'object' ? raw : {}
    const name = typeof item.name === 'string' ? item.name : ''
    if (!NAME_RE.test(name) || seen.has(name)) return { ok: false, error: 'invalid-item-name' }
    seen.add(name)
    const version = typeof item.version === 'string' ? item.version : ''
    if (version && !VERSION_RE.test(version)) return { ok: false, error: 'invalid-item-version' }
    const channel = typeof item.channel === 'string' ? item.channel : ''
    if (channel && !CHANNELS.has(channel)) return { ok: false, error: 'invalid-item-channel' }
    items.push({ name, version, channel })
  }
  return { ok: true, visitor: typeof body.visitor === 'string' ? body.visitor : '', items }
}

/** Deterministic per-day event id so replays collapse via INSERT OR IGNORE. */
async function eventId(hash, kind, subject, version, channel) {
  return sha256('v1|' + kind + '|' + hash + '|' + subject + '|' + version + '|' + (channel || ''))
}

/**
 * Insert events idempotently. Rows carry the hashed visitor, not the raw id.
 * Heartbeat submissions also upsert the visitor into the pre-deduped
 * telemetry_visitors table (same batch) so the all-time badge counts a small
 * primary-key table instead of a full event-table scan.
 */
export async function recordEvents(env, rows) {
  if (rows.length === 0) return
  const now = Date.now()
  const statements = await Promise.all(rows.map(async (row) => env.DB.prepare(
    'INSERT OR IGNORE INTO telemetry_events (id, day, kind, visitor, subject, version, channel, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
  ).bind(row.id, row.day, row.kind, row.visitor, row.subject, row.version, row.channel || '', now)))
  if (rows[0].kind === 'hb') {
    statements.push(env.DB.prepare('INSERT OR IGNORE INTO telemetry_visitors (kind, visitor) VALUES (?1, ?2)').bind('hb', rows[0].visitor))
  }
  await env.DB.batch(statements)
}

/** Build the insert rows for one validated submission. */
export async function submissionRows(env, kind, hash, subjects) {
  const day = utcDay()
  const rows = []
  for (const { subject, version, channel } of subjects) {
    rows.push({ id: await eventId(hash, kind, subject, version, channel), day, kind, visitor: hash, subject, version, channel: channel || '' })
  }
  return rows
}

/** Clamp one pagination parameter to [min, max] with a fallback default. */
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/**
 * Parse the optional pagination window for one summary section.
 * limit is clamped to [1, maxLimit], offset to [0, 100000].
 */
export function parsePage(url, prefix, defaultLimit, maxLimit) {
  return {
    limit: clampInt(url.searchParams.get(prefix + '_limit'), 1, maxLimit, defaultLimit),
    offset: clampInt(url.searchParams.get(prefix + '_offset'), 0, 100000, 0),
  }
}

/**
 * Aggregate UV/PV summary over the last N days. Counts only; raw events
 * never leave this table.
 *
 * Hot paths and heartbeat items are paginated server-side: each section
 * returns one LIMIT/OFFSET page plus the total distinct-subject count, so
 * readers can render complete pagers without transferring whole groupings.
 * The per-item channel/version breakdowns keep full-cardinality scans
 * (their row count is bounded by the plugin catalog, not by traffic) and
 * are joined onto the returned page in memory.
 */
export async function telemetrySummary(env, days, page = {}) {
  const since = utcDay(Date.now() - (days - 1) * 86400000)
  const today = utcDay()
  const paths = page.paths || { limit: 20, offset: 0 }
  const items = page.items || { limit: 200, offset: 0 }
  // Nine aggregates, four batches: D1 rejects a batch whose transaction
  // runtime exceeds its limits, and even indexed, the heartbeat grouping
  // scans take tens of seconds at current volume — each heavy statement
  // needs its own transaction. Cross-chunk consistency is irrelevant:
  // every chunk reads the same append-only event table.
  const batch = async (statements) => (await env.DB.batch(statements)).map((result) => result.results || [])
  const [dailyPv, dailyHb, topPaths, pathsTotal, itemsToday, itemsChannels] = await batch([
    env.DB.prepare("SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv FROM telemetry_events WHERE kind = 'pv' AND day >= ?1 GROUP BY day ORDER BY day").bind(since),
    env.DB.prepare("SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv FROM telemetry_events WHERE kind = 'hb' AND day >= ?1 GROUP BY day ORDER BY day").bind(since),
    env.DB.prepare("SELECT subject, COUNT(*) AS pv FROM telemetry_events WHERE kind = 'pv' AND day >= ?1 GROUP BY subject ORDER BY pv DESC, subject LIMIT ?2 OFFSET ?3").bind(since, paths.limit, paths.offset),
    env.DB.prepare("SELECT COUNT(DISTINCT subject) AS n FROM telemetry_events WHERE kind = 'pv' AND day >= ?1").bind(since),
    env.DB.prepare("SELECT subject, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND day = ?1 GROUP BY subject").bind(today),
    env.DB.prepare("SELECT subject, channel, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND channel != '' AND day >= ?1 GROUP BY subject, channel").bind(since),
  ])
  const [itemsPage] = await batch([
    env.DB.prepare("SELECT subject, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND day >= ?1 GROUP BY subject ORDER BY visitors DESC, subject LIMIT ?2 OFFSET ?3").bind(since, items.limit, items.offset),
  ])
  const [itemsTotal] = await batch([
    env.DB.prepare("SELECT COUNT(DISTINCT subject) AS n FROM telemetry_events WHERE kind = 'hb' AND day >= ?1").bind(since),
  ])
  const [itemsVersions] = await batch([
    env.DB.prepare("SELECT subject, version, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND version != '' AND day >= ?1 GROUP BY subject, version ORDER BY visitors DESC").bind(since),
  ])
  const activeToday = new Map(itemsToday.map((row) => [row.subject, row.visitors]))
  const channelsByItem = new Map()
  for (const row of itemsChannels) {
    if (!channelsByItem.has(row.subject)) channelsByItem.set(row.subject, {})
    channelsByItem.get(row.subject)[row.channel] = row.visitors
  }
  const versionsByItem = new Map()
  for (const row of itemsVersions) {
    if (!versionsByItem.has(row.subject)) versionsByItem.set(row.subject, [])
    versionsByItem.get(row.subject).push({ version: row.version, instances: row.visitors })
  }
  const sumUv = (rows) => rows.reduce((total, row) => total + Number(row.uv || 0), 0)
  const sumPv = (rows) => rows.reduce((total, row) => total + Number(row.pv || 0), 0)
  const totalOf = (rows) => Number(rows[0] && rows[0].n || 0)
  return {
    ok: true,
    range: { days, since },
    site: {
      totals: { pv: sumPv(dailyPv), uv_daily_sum: sumUv(dailyPv) },
      daily: dailyPv.map((row) => ({ day: row.day, pv: row.pv, uv: row.uv })),
      top_paths: topPaths.map((row) => ({ path: row.subject, pv: row.pv })),
      paths_total: totalOf(pathsTotal),
      paths_page: { offset: paths.offset, limit: paths.limit },
    },
    plugins: {
      totals: { uv_daily_sum: sumUv(dailyHb), items: totalOf(itemsTotal) },
      daily: dailyHb.map((row) => ({ day: row.day, beats: row.pv, uv: row.uv })),
      items_page: { offset: items.offset, limit: items.limit },
      items: itemsPage.map((row) => ({
        item: row.subject,
        instances: row.visitors,
        active_today: activeToday.get(row.subject) || 0,
        channels: channelsByItem.get(row.subject) || {},
        versions: versionsByItem.get(row.subject) || [],
      })),
    },
  }
}

/** Retention prune; called by the cron trigger. */
export async function pruneOldEvents(env) {
  const cutoffDay = utcDay(Date.now() - RETENTION_DAYS * 86400000)
  await env.DB.prepare('DELETE FROM telemetry_events WHERE day < ?1').bind(cutoffDay).run()
}

/** POST /api/telemetry/event handler. Returns the json() helper's shape. */
export async function handleTelemetryPost(request, env, json) {
  if (!env.DB) return json({ ok: false, error: 'storage-unavailable' }, 503)
  const read = await readJsonCapped(request, TELEMETRY_BODY_MAX_BYTES)
  if (!read.ok) return json({ ok: false, error: read.error }, read.error === 'payload-too-large' ? 413 : 400)
  const body = read.value
  if (!body || !KINDS.has(body.kind)) return json({ ok: false, error: 'invalid-kind' }, 400)
  const hash = await visitorHash(body.visitor, env)
  if (!hash) return json({ ok: false, error: 'invalid-visitor' }, 400)
  let subjects
  if (body.kind === 'pageview') {
    const parsed = parsePageview(body)
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400)
    // Accept-and-drop so crawlers learn nothing from the status code.
    if (BOT_UA_RE.test(request.headers.get('user-agent') || '')) return json({ ok: true })
    subjects = [{ subject: parsed.path, version: '' }]
  } else {
    const parsed = parseHeartbeat(body)
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400)
    subjects = parsed.items.map((item) => ({ subject: item.name, version: item.version, channel: item.channel }))
  }
  try {
    await recordEvents(env, await submissionRows(env, body.kind === 'pageview' ? 'pv' : 'hb', hash, subjects))
  } catch {
    // Telemetry is best-effort: D1 overload must not surface as a worker
    // exception page. A 503 keeps the client contract (retry on next mount)
    // instead of the client treating the day as reported.
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  return json({ ok: true })
}

/**
 * GET /api/telemetry/summary handler. When TELEMETRY_READ_KEY is configured,
 * callers must present it via the x-telemetry-key header. The key is never
 * accepted in the URL: query strings persist in edge logs, browser history
 * and referrers. Comparison runs on SHA-256 digests, not raw strings.
 */
export async function summaryAuthorized(request, url, env) {
  const key = env.TELEMETRY_READ_KEY
  if (!key) return true
  const presented = request.headers.get('x-telemetry-key') || ''
  if (!presented) return false
  return (await sha256(presented)) === (await sha256(key))
}

/** Compact shields count: 84912 -> "84.9k", 1200000 -> "1.2m". */
function formatBadgeCount(users) {
  const trim = (v) => String(Math.round(v * 10) / 10)
  return users >= 1e6 ? trim(users / 1e6) + 'm' : users >= 1e3 ? trim(users / 1e3) + 'k' : String(users)
}

const BADGE_CACHE_ID = 'users'

/** Recompute the heartbeat distinct-visitor count and seed badge_cache. */
export async function refreshBadgeCache(env) {
  // telemetry_visitors is pre-deduped by the write path (and backfilled by
  // migration 0006), so the all-time count is a small primary-key range scan
  // instead of a full telemetry_events scan that grows with traffic.
  const row = await env.DB.prepare("SELECT COUNT(*) AS users FROM telemetry_visitors WHERE kind = 'hb'").first()
  const users = Number(row && row.users || 0)
  await env.DB.prepare(
    'INSERT INTO badge_cache (id, value, computed_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET value = excluded.value, computed_at = excluded.computed_at'
  ).bind(BADGE_CACHE_ID, users, Date.now()).run()
  return users
}

/**
 * Public shields endpoint badge: all-time distinct heartbeat visitors
 * ("users"). Aggregate count only — no key required, no raw data exposed.
 *
 * The live count is a full-table scan over ~1M rows that exceeds shields'
 * ~3.5s fetch timeout, so the badge reads a single precomputed row that a
 * cron trigger (wrangler.jsonc triggers.crons) refreshes every 30 minutes.
 * On top of that the response is cached at the edge for 30 minutes with a
 * 24h stale copy. Every fallback answers within the timeout or with a valid
 * shields JSON — the README badge must never show "inaccessible".
 */
export async function handleTelemetryUsersBadge(request, env, json) {
  const url = new URL(request.url)
  url.search = ''
  const cache = caches.default
  const key = new Request(url.href, { method: 'GET' })
  const fresh = await cache.match(key)
  if (fresh) return fresh
  let message = 'unavailable'
  let counted = false
  try {
    if (env.DB) {
      const row = await env.DB.prepare('SELECT value FROM badge_cache WHERE id = ?1').bind(BADGE_CACHE_ID).first()
      if (row) {
        message = formatBadgeCount(Number(row.value || 0))
        counted = true
      } else {
        // Bootstrap before the first cron tick: run the full scan once and
        // seed the row so every later read is a single indexed lookup.
        message = formatBadgeCount(await refreshBadgeCache(env))
        counted = true
      }
    }
  } catch { /* D1 overloaded or unavailable: fall through to the stale copy */ }
  if (!counted) {
    const stale = await cache.match(new Request(url.href + '?stale=1', { method: 'GET' }))
    if (stale) return stale
    return json({ schemaVersion: 1, label: 'users', message, color: 'lightgrey' }, 200)
  }
  const body = { schemaVersion: 1, label: 'users', message, color: 'blue' }
  const freshResponse = json(body, 200, { 'cache-control': 'public, max-age=1800' })
  try {
    await cache.put(key, freshResponse.clone())
    await cache.put(new Request(url.href + '?stale=1', { method: 'GET' }), json(body, 200, { 'cache-control': 'public, max-age=86400' }))
  } catch { /* caching is best-effort; the computed response is already valid */ }
  return freshResponse
}

/** Summary rollup cache: freshness windows and cache-row id for one window.
 * Heavy long windows recompute for tens of seconds, so they tolerate longer
 * staleness than the badge-aligned 30 minutes of the light windows. */
function summaryCacheTtl(days) {
  return days <= 30 ? 30 * 60 * 1000 : 12 * 60 * 60 * 1000
}

function summaryCacheId(days, paths, items) {
  return ['d' + days, 'p' + paths.limit + '-' + paths.offset, 'i' + items.limit + '-' + items.offset].join('-')
}

async function readSummaryCache(env, id) {
  try {
    const row = await env.DB.prepare('SELECT payload, computed_at FROM telemetry_summary_cache WHERE id = ?1').bind(id).first()
    if (!row) return null
    return { payload: JSON.parse(String(row.payload || 'null')), computedAt: Number(row.computed_at || 0) }
  } catch { /* unreadable or corrupt cache rows behave like a miss */ }
  return null
}

async function writeSummaryCache(env, id, summary) {
  try {
    await env.DB.prepare(
      'INSERT INTO telemetry_summary_cache (id, payload, computed_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, computed_at = excluded.computed_at'
    ).bind(id, JSON.stringify(summary), Date.now()).run()
  } catch { /* caching is best-effort; the live response is already valid */ }
}

export async function handleTelemetrySummary(request, url, env, json) {
  if (!env.DB) return json({ ok: false, error: 'storage-unavailable' }, 503)
  if (!(await summaryAuthorized(request, url, env))) return json({ ok: false, error: 'unauthorized' }, 403)
  let days = Number.parseInt(url.searchParams.get('days') || '', 10)
  if (!Number.isFinite(days)) days = 30
  days = Math.min(Math.max(days, 1), 365)
  const page = {
    paths: parsePage(url, 'paths', 20, 100),
    items: parsePage(url, 'items', 200, 200),
  }
  const id = summaryCacheId(days, page.paths, page.items)
  const cached = await readSummaryCache(env, id)
  // The live aggregation scans millions of indexed rows (tens of seconds);
  // within the TTL every reader shares the one cached rollup, the same
  // trade-off the users badge already makes.
  if (cached && Date.now() - cached.computedAt < summaryCacheTtl(days) && cached.payload) {
    return json(cached.payload)
  }
  let summary
  try {
    summary = await telemetrySummary(env, days, page)
  } catch {
    // D1 overload must surface as a plain 503 for the dashboard proxy,
    // not as a worker exception page. A stale cache row is still far
    // better than an error page on a read-only dashboard.
    if (cached && cached.payload) return json(cached.payload)
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  await writeSummaryCache(env, id, summary)
  return json(summary)
}

const SUMMARY_DEFAULT_PAGE = { paths: { limit: 20, offset: 0 }, items: { limit: 200, offset: 0 } }
const SUMMARY_FIRST_PAINT_PAGE = { paths: { limit: 10, offset: 0 }, items: { limit: 10, offset: 0 } }

/** Range-button windows rotate one heavy slot per cron tick: scheduled
 * invocations are killed after roughly two minutes, and each 90/365-day
 * window costs ~40s, so pre-warming everything every tick dies mid-list. */
const SUMMARY_PREWARM_ROTATION = [7, 30, 90, 365]

/**
 * Cron pre-warm: refresh the tv first-paint rollup every tick plus one
 * rotation slot of the range-button windows (default /data pages). A failed
 * or killed window keeps serving its previous row; pager offsets the owner
 * clicks warm on demand.
 */
export async function refreshSummaryCache(env) {
  const tick = Math.floor(Date.now() / (30 * 60 * 1000))
  const windows = [
    { days: 30, page: SUMMARY_FIRST_PAINT_PAGE },
    { days: SUMMARY_PREWARM_ROTATION[tick % SUMMARY_PREWARM_ROTATION.length], page: SUMMARY_DEFAULT_PAGE },
  ]
  for (const { days, page } of windows) {
    const id = summaryCacheId(days, page.paths, page.items)
    try {
      const summary = await telemetrySummary(env, days, page)
      await writeSummaryCache(env, id, summary)
    } catch (error) {
      // Surface the skip: a silently missing rotation slot is indistinguishable
      // from a killed invocation when diagnosing the next tick.
      console.log('[summary-prewarm] ' + id + ' skipped: ' + ((error && error.message) || error))
    }
  }
}
