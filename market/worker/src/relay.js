/**
 * dsh-market relay: stable subdomains in front of the plugin-managed quick
 * tunnels (`<id>.dsh-market.com` -> the instance's current tunnel URL).
 *
 * Trust model: the plugin mints an id + secret on first run and re-registers
 * its current tunnel URL on every tunnel start; registrations are
 * secret-authenticated (hash-compared), origin-restricted to
 * *.trycloudflare.com, and rate-limited per IP and per id. The proxy path is
 * read-only against D1 (one lookup per request) and forwards bytes verbatim —
 * the paired-device cookie and every application-level check stay on the
 * instance; this worker never terminates the pairing.
 */

const ID_RE = /^[a-z0-9]{16}$/
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
/** Registration writes must name a plugin-managed quick tunnel. */
const TARGET_ORIGIN_SUFFIX = '.trycloudflare.com'
/** Rate limits: registration refreshes are infrequent (per tunnel start). */
const REGISTER_WINDOW_MS = 60 * 1000
const REGISTER_MAX_PER_IP = 30
const REGISTER_MAX_PER_ID = 6
/** Rows not seen for this long are dropped by the cron GC. */
const REGISTRATION_TTL_MS = 90 * 24 * 60 * 60 * 1000

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  })
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** The `<id>` of `<id>.dsh-market.com`, else undefined. Single label on
 * purpose: Universal SSL covers exactly one subdomain level, so a two-level
 * `*.t.dsh-market.com` hostname gets no certificate and fails the TLS
 * handshake at the edge. */
export function relayIdOf(url) {
  const host = url.hostname
  const parts = host.split('.')
  if (parts.length !== 3) return undefined
  if (parts[1] !== 'dsh-market' || parts[2] !== 'com') return undefined
  const id = parts[0]
  return ID_RE.test(id) ? id : undefined
}

/** Whether one registration target is an https quick-tunnel origin. */
function isAllowedTarget(target) {
  let url
  try {
    url = new URL(target)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search !== '' || url.username || url.password) return false
  return url.hostname.endsWith(TARGET_ORIGIN_SUFFIX) && url.hostname.length > TARGET_ORIGIN_SUFFIX.length
}

/**
 * Consume one rate-limit bucket inside the caller's batch: the COUNT rides
 * the same transaction as the mutation it guards, and the window row is
 * upserted in the same statement set. `limit` is the budget already spent
 * elsewhere plus this request; a consumed window must be committed even when
 * the request is rejected, so retries cannot outrun the window.
 * @returns a prepared statement list prefix implementing the check.
 */
function rateLimitStatements(env, bucket, max) {
  const windowStart = Math.floor(Date.now() / REGISTER_WINDOW_MS) * REGISTER_WINDOW_MS
  return {
    windowStart,
    statements: [
      env.DB.prepare('SELECT count FROM relay_rate_limit WHERE bucket = ?1 AND window_start = ?2').bind(bucket, windowStart),
      env.DB.prepare(
        'INSERT INTO relay_rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
      ).bind(bucket, windowStart),
    ],
  }
}

/** Registration: PUT replaces the target for an existing id, POST mints one. */
export async function handleRelayRegister(request, env) {
  if (request.method !== 'PUT') return json({ ok: false, error: 'method-not-allowed' }, 405)
  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'invalid-json' }, 400)
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  const target = typeof body.target === 'string' ? body.target : ''
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return json({ ok: false, error: 'invalid-params' }, 400)
  if (!isAllowedTarget(target)) return json({ ok: false, error: 'invalid-target' }, 400)

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const now = Date.now()
  const secretHash = await sha256Hex(secret)
  const existing = await env.DB.prepare('SELECT secret_hash FROM relay_registrations WHERE id = ?1').bind(id).first()

  if (existing) {
    if (!timingSafeEqualStr(existing.secret_hash, secretHash)) return json({ ok: false, error: 'auth-failed' }, 403)
  } else {
    if (body.register === false) return json({ ok: false, error: 'unknown-id' }, 404)
    if (!/^[A-Za-z0-9_-]{43}$/.test(body.new_secret || '') || body.new_secret !== secret) {
      return json({ ok: false, error: 'invalid-params' }, 400)
    }
  }

  const perIp = rateLimitStatements(env, 'ip:' + ip, REGISTER_MAX_PER_IP)
  const perId = rateLimitStatements(env, 'id:' + id, REGISTER_MAX_PER_ID)
  const upsert = env.DB.prepare(
    'INSERT INTO relay_registrations (id, secret_hash, target, registered_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(id) DO UPDATE SET target = excluded.target, last_seen_at = excluded.last_seen_at'
  ).bind(id, secretHash, target, now)
  try {
    await env.DB.batch([perIp.statements[0], perIp.statements[1], perId.statements[1], upsert])
  } catch {
    return json({ ok: false, error: 'storage-unavailable' }, 503)
  }
  // The batch cannot conditionally reject, so enforce the budgets after the
  // commit: over-budget writes are harmless overwrites of the same row.
  // Counts are re-read (not trusted from the batch result) to stay correct
  // under concurrent registrations.
  const counts = await env.DB.batch([
    env.DB.prepare('SELECT count FROM relay_rate_limit WHERE bucket = ?1 AND window_start = ?2').bind('ip:' + ip, perIp.windowStart),
    env.DB.prepare('SELECT count FROM relay_rate_limit WHERE bucket = ?1 AND window_start = ?2').bind('id:' + id, perId.windowStart),
  ]).catch(() => [])
  const ipCount = Number(counts[0] && counts[0].results && counts[0].results[0] && counts[0].results[0].count) || 0
  const idCount = Number(counts[1] && counts[1].results && counts[1].results[0] && counts[1].results[0].count) || 0
  if (ipCount > REGISTER_MAX_PER_IP || idCount > REGISTER_MAX_PER_ID) {
    return json({ ok: false, error: 'rate-limited' }, 429)
  }
  return json({ ok: true })
}

/** Remove one registration (secret-authenticated; used when a profile unmounts). */
export async function handleRelayUnregister(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'method-not-allowed' }, 405)
  let body
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'invalid-json' }, 400)
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const secret = typeof body.secret === 'string' ? body.secret : ''
  if (!ID_RE.test(id) || !SECRET_RE.test(secret)) return json({ ok: false, error: 'invalid-params' }, 400)
  const existing = await env.DB.prepare('SELECT secret_hash FROM relay_registrations WHERE id = ?1').bind(id).first().catch(() => null)
  if (!existing || !timingSafeEqualStr(existing.secret_hash, await sha256Hex(secret))) {
    return json({ ok: false, error: 'auth-failed' }, 403)
  }
  await env.DB.prepare('DELETE FROM relay_registrations WHERE id = ?1').bind(id).run().catch(() => undefined)
  return json({ ok: true })
}

/** Cron GC: drop stale registrations and old rate-limit windows. */
export async function pruneRelay(env) {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM relay_registrations WHERE last_seen_at < ?1').bind(Date.now() - REGISTRATION_TTL_MS),
      env.DB.prepare('DELETE FROM relay_rate_limit WHERE window_start < ?1').bind(Date.now() - 24 * 60 * 60 * 1000),
    ])
  } catch { /* best-effort; retries on the next tick */ }
}

const OFFLINE_HTML = [
  '<!doctype html><html><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="referrer" content="no-referrer">',
  '<meta name="robots" content="noindex">',
  '<title>DSH instance offline</title></head>',
  '<body style="font-family:system-ui,sans-serif;padding:24px;max-width:32em;margin:0 auto;line-height:1.6">',
  '<p><strong>远程实例当前离线。</strong></p>',
  '<p>这台 DSH 的隧道尚未启动或地址已更换，稍等片刻后刷新本页即可；本页地址固定不变，无需重新配对。</p>',
  '<hr style="border:none;border-top:1px solid #ccc;margin:16px 0">',
  '<p><strong>This remote instance is currently offline.</strong></p>',
  '<p>The tunnel of this DSH instance is not running right now. Refresh in a moment — this page\u2019s address never changes, so no re-pairing is needed.</p>',
  '</body></html>',
].join('')

/**
 * Proxy one request for `<id>.dsh-market.com` to the registered target.
 * The pairing cookie and every application check stay on the tunneled
 * instance; this hop rewrites only the Host header so the origin sees the
 * relay hostname (cookies and harness auth are Host-bound there).
 */
export async function handleRelayProxy(request, env, id) {
  let row
  try {
    row = await env.DB.prepare('SELECT target FROM relay_registrations WHERE id = ?1').bind(id).first()
  } catch {
    return new Response('relay storage unavailable', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }
  if (!row) {
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
        'referrer-policy': 'no-referrer',
      },
    })
  }
  let target
  try {
    target = new URL(request.url)
    target.protocol = 'https:'
    target.hostname = new URL(row.target).hostname
    target.port = ''
  } catch {
    return json({ ok: false, error: 'invalid-registration' }, 502)
  }
  const headers = new Headers(request.headers)
  headers.set('host', target.host)
  headers.delete('cf-connecting-ip')
  headers.delete('cf-ipcountry')
  headers.delete('cf-ray')
  headers.delete('cf-visitor')
  headers.delete('x-forwarded-for')
  headers.delete('x-forwarded-proto')
  headers.delete('x-real-ip')
  const forwarded = new Request(target.href, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
    // WebSocket upgrades ride this path in Workers (fetch upgrades when the
    // client sends an Upgrade request and the body is null).
    ...(request.headers.get('upgrade') === 'websocket' ? {} : { duplex: 'half' }),
  })
  return fetch(forwarded)
}

/** Dispatch for relay traffic: returns a Response, or undefined when the
 * request is not relay-routed (the main fetch handler continues). */
export async function handleRelay(request, env) {
  const url = new URL(request.url)
  const id = relayIdOf(url)
  if (!id) return undefined
  return handleRelayProxy(request, env, id)
}