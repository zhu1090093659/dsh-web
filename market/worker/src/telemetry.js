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
/** Events older than this many days are pruned opportunistically. */
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
 */
export async function recordEvents(env, rows) {
  if (rows.length === 0) return
  const now = Date.now()
  const statements = await Promise.all(rows.map(async (row) => env.DB.prepare(
    'INSERT OR IGNORE INTO telemetry_events (id, day, kind, visitor, subject, version, channel, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)'
  ).bind(row.id, row.day, row.kind, row.visitor, row.subject, row.version, row.channel || '', now)))
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

/**
 * Aggregate UV/PV summary over the last N days. Counts only; raw events
 * never leave this table.
 */
export async function telemetrySummary(env, days) {
  const since = utcDay(Date.now() - (days - 1) * 86400000)
  const today = utcDay()
  const [dailyPv, dailyHb, topPaths, itemsAll, itemsToday, itemsChannels, itemsVersions] = (await env.DB.batch([
    env.DB.prepare("SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv FROM telemetry_events WHERE kind = 'pv' AND day >= ?1 GROUP BY day ORDER BY day").bind(since),
    env.DB.prepare("SELECT day, COUNT(*) AS pv, COUNT(DISTINCT visitor) AS uv FROM telemetry_events WHERE kind = 'hb' AND day >= ?1 GROUP BY day ORDER BY day").bind(since),
    env.DB.prepare("SELECT subject, COUNT(*) AS pv FROM telemetry_events WHERE kind = 'pv' AND day >= ?1 GROUP BY subject ORDER BY pv DESC LIMIT 20").bind(since),
    env.DB.prepare("SELECT subject, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND day >= ?1 GROUP BY subject ORDER BY visitors DESC LIMIT 200").bind(since),
    env.DB.prepare("SELECT subject, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND day = ?1 GROUP BY subject").bind(today),
    env.DB.prepare("SELECT subject, channel, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND channel != '' AND day >= ?1 GROUP BY subject, channel").bind(since),
    env.DB.prepare("SELECT subject, version, COUNT(DISTINCT visitor) AS visitors FROM telemetry_events WHERE kind = 'hb' AND version != '' AND day >= ?1 GROUP BY subject, version ORDER BY visitors DESC").bind(since),
  ])).map((result) => result.results || [])
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
  return {
    ok: true,
    range: { days, since },
    site: {
      totals: { pv: sumPv(dailyPv), uv_daily_sum: sumUv(dailyPv) },
      daily: dailyPv.map((row) => ({ day: row.day, pv: row.pv, uv: row.uv })),
      top_paths: topPaths.map((row) => ({ path: row.subject, pv: row.pv })),
    },
    plugins: {
      totals: { uv_daily_sum: sumUv(dailyHb), items: itemsAll.length },
      daily: dailyHb.map((row) => ({ day: row.day, beats: row.pv, uv: row.uv })),
      items: itemsAll.map((row) => ({
        item: row.subject,
        instances: row.visitors,
        active_today: activeToday.get(row.subject) || 0,
        channels: channelsByItem.get(row.subject) || {},
        versions: versionsByItem.get(row.subject) || [],
      })),
    },
  }
}

/** Opportunistic retention prune; called on summary reads. */
export async function pruneOldEvents(env) {
  const cutoffDay = utcDay(Date.now() - RETENTION_DAYS * 86400000)
  await env.DB.prepare('DELETE FROM telemetry_events WHERE day < ?1').bind(cutoffDay).run()
}

/** POST /api/telemetry/event handler. Returns the json() helper's shape. */
export async function handleTelemetryPost(request, env, json) {
  if (!env.DB) return json({ ok: false, error: 'storage-unavailable' }, 503)
  let body
  try { body = await request.json() } catch { return json({ ok: false, error: 'invalid-json' }, 400) }
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
  await recordEvents(env, await submissionRows(env, body.kind === 'pageview' ? 'pv' : 'hb', hash, subjects))
  return json({ ok: true })
}

/** GET /api/telemetry/summary handler. When TELEMETRY_READ_KEY is configured,
 * callers must present it via the x-telemetry-key header or ?key= parameter. */
export function summaryAuthorized(request, url, env) {
  const key = env.TELEMETRY_READ_KEY
  if (!key) return true
  return (request.headers.get('x-telemetry-key') || url.searchParams.get('key') || '') === key
}

export async function handleTelemetrySummary(request, url, env, json) {
  if (!env.DB) return json({ ok: false, error: 'storage-unavailable' }, 503)
  if (!summaryAuthorized(request, url, env)) return json({ ok: false, error: 'unauthorized' }, 403)
  let days = Number.parseInt(url.searchParams.get('days') || '', 10)
  if (!Number.isFinite(days)) days = 30
  days = Math.min(Math.max(days, 1), 365)
  const summary = await telemetrySummary(env, days)
  try { await pruneOldEvents(env) } catch { /* pruning is best-effort */ }
  return json(summary)
}
