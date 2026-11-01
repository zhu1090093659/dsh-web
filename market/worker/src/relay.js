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
 *
 * A failure of this hop answers the frozen contract instead of prose: one JSON
 * body per failure in the shape `{ok:false,code,message}` (see
 * `relay-failure.js`), so the App branches on a code. Only a browser navigation
 * still gets the offline page.
 */

import { relayFailure } from './relay-failure.js'
import {
  RATE_LIMIT_RETENTION_MS,
  REGISTER_MAX_PER_ID,
  REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_MS,
  REGISTRATION_TTL_MS,
} from './relay-limits.js'

/** The frozen failure contract lives in one module both relay halves share. */
export { RELAY_FAILURE_STATUS, relayFailure } from './relay-failure.js'

/** The id/secret shape both relay paths authenticate (see relay-control.js). */
export const ID_RE = /^[a-z0-9]{16}$/
export const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
/** Registration writes must name a plugin-managed quick tunnel. */
const TARGET_ORIGIN_SUFFIX = '.trycloudflare.com'
/**
 * The bridge markers shared with `relay-bridge.js`. A bridge answer that found
 * no connector carries the first one, and the proxy path reads it as a
 * same-request fallback; the other two name the transport that served a request
 * in the response the phone sees.
 */
export const RELAY_BRIDGE_MARKER = 'x-relay-bridge'
export const RELAY_BRIDGE_NO_CONNECTOR = 'no-connector'
export const RELAY_TRANSPORT_HEADER = 'x-relay-transport'
export const RELAY_FALLBACK_HEADER = 'x-relay-fallback'
/** The marker the Worker's bridge door alone sets on a connector attach; the
 * proxy path strips it, so a phone cannot present itself as a connector. */
export const RELAY_BRIDGE_ATTACH_HEADER = 'x-relay-bridge-attach'
/** The registry's rate limits, its row TTL and the retention window live in
 * `relay-limits.js`; they stay part of this module's surface because
 * `relay-control.js` reads the buckets from here. */
export {
  RATE_LIMIT_RETENTION_MS,
  REGISTER_MAX_PER_ID,
  REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_MS,
}

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  })
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqualStr(a, b) {
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

/** The milliseconds left in the window one rate-limit refusal was counted in. */
export function retryAfterMsOf(windowStart) {
  return Math.max(0, windowStart + REGISTER_WINDOW_MS - Date.now())
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
  let existing
  try {
    existing = await env.DB.prepare('SELECT secret_hash FROM relay_registrations WHERE id = ?1').bind(id).first()
  } catch {
    // A D1 blip here used to escape the handler as a bare 500. It is the storage
    // failure the batch below reports, so it answers the same way -- including
    // the `error` spelling the plugin compares against.
    return relayFailure('relay-storage-unavailable', { legacy: 'storage-unavailable' })
  }

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
  // This refusal is the only one on the registration surface that a frozen code
  // names; the rest keep their pre-contract `error` shape (the table has no code
  // for them). `legacy` keeps `error` for the plugin's registration client.
  if (ipCount > REGISTER_MAX_PER_IP || idCount > REGISTER_MAX_PER_ID) {
    return relayFailure('rate-limited', { legacy: true })
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

/**
 * Cron GC: drop stale registrations and rate-limit rows whose window has turned
 * over. The rate-limit retention is three windows (RATE_LIMIT_RETENTION_MS)
 * rather than the day it used to be: a row is read only while its own window is
 * current, so a longer history is pure size — at the storm's rate a day of rows
 * was what pushed this table past a gigabyte. One batched delete keeps the tick
 * to a single statement pair.
 */
export async function pruneRelay(env) {
  try {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM relay_registrations WHERE last_seen_at < ?1').bind(Date.now() - REGISTRATION_TTL_MS),
      env.DB.prepare('DELETE FROM relay_rate_limit WHERE window_start < ?1').bind(Date.now() - RATE_LIMIT_RETENTION_MS),
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
 * The page a browser gets for a dead id. A device asking for data must not
 * receive HTML: it gets the frozen JSON so it can read a code.
 */
function offlinePage() {
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

/** Whether this request is a browser navigation, the one case that still gets
 * the offline page (a GET whose Accept names HTML). */
function acceptsOfflinePage(request) {
  if (request.method !== 'GET') return false
  const accept = request.headers.get('accept')
  return accept !== null && accept.toLowerCase().includes('text/html')
}

/**
 * Build assets under `/assets/` carry a content hash in the file name
 * (`index-5SrrfWpU.js`, `langs/cpp-DIPi6g--.js`,
 * `fonts/KaTeX_AMS-Regular-DRggAlZN.ttf`), so their bytes and their URL move
 * together and a one-year max-age is safe.
 *
 * The tunneled instance serves them without any Cache-Control / ETag /
 * Last-Modified, and this hop passed the origin's response through verbatim —
 * which left the client with nothing to cache against: it re-fetched the whole
 * shell on every load (measured 237502 B at 1.3-2.3 s TTFB through the relay,
 * byte-identical each time). Caching hashed assets here is what makes a
 * phone's second load cheap. Every other path keeps the origin's headers.
 */
const IMMUTABLE_ASSET_RE = /^\/assets\/(?:[\w.-]+\/)*[\w.-]+-[\w-]{8,}\.[A-Za-z0-9]+$/
const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable'

/** Whether one relay path names a content-hashed build asset. Deliberately
 * narrow: an unhashed name under `/assets/` (a favicon, a manifest) keeps the
 * origin's headers, because caching it for a year would be wrong. */
export function isImmutableAssetPath(pathname) {
  return IMMUTABLE_ASSET_RE.test(pathname)
}

/** Add immutable caching to a hashed build asset. Everything else — `/api/*`,
 * HTML, unhashed names, WebSocket upgrades (101) and non-200 responses — is
 * returned exactly as the origin sent it. */
function withImmutableAssetCache(response, pathname, method) {
  if (method !== 'GET' && method !== 'HEAD') return response
  if (response.status !== 200) return response
  if (!isImmutableAssetPath(pathname)) return response
  const headers = new Headers(response.headers)
  headers.set('cache-control', IMMUTABLE_ASSET_CACHE)
  return new Response(response.body, { status: 200, statusText: response.statusText, headers })
}

/**
 * Which transport serves one instance: `bridge` only when this deployment
 * carries the object namespace and the instance's lease was flipped.
 *
 * The mode lives on the lease row, so it is read apart from the registry row
 * the quick path needs -- and a failure here is `quick`, never an error. That
 * direction matters at deploy time: a Worker shipped before the mode migration
 * must keep serving the whole fleet on quick instead of answering 503, which is
 * why the registry read owns `relay-storage-unavailable` and this probe does not.
 * @returns `bridge` or `quick`.
 */
export async function bridgeModeOf(env, id) {
  if (env.RELAY_BRIDGE === undefined) return 'quick'
  try {
    const lease = await env.DB.prepare('SELECT mode FROM relay_leases WHERE id = ?1').bind(id).first()
    return lease && lease.mode === 'bridge' ? 'bridge' : 'quick'
  } catch {
    return 'quick'
  }
}

/**
 * Hand one request to the instance's object.
 * @param pathname - the relay pathname, for the immutable-asset stamp.
 * @returns the object's response, or undefined when it holds no connector and
 * the caller must fall back to quick inside this same request.
 */
async function fetchThroughBridge(request, env, id, pathname) {
  // A downstream request must never look like a connector attach: only the
  // bridge door may set that marker, so a forged one is dropped here.
  const forwarded = request.headers.has(RELAY_BRIDGE_ATTACH_HEADER)
    ? new Request(request, { headers: withoutAttachMarker(request.headers) })
    : request
  let response
  try {
    response = await env.RELAY_BRIDGE.get(env.RELAY_BRIDGE.idFromName(id)).fetch(forwarded)
  } catch (error) {
    console.warn(JSON.stringify({ relay: 'bridge-error', id, message: error instanceof Error ? error.message : String(error) }))
    return undefined
  }
  if (response.status === 409 && response.headers.get(RELAY_BRIDGE_MARKER) === RELAY_BRIDGE_NO_CONNECTOR) {
    console.warn(JSON.stringify({ relay: 'bridge-fallback', id, reason: RELAY_BRIDGE_NO_CONNECTOR }))
    return undefined
  }
  // The same immutable stamp the quick path applies, for the same reason: the
  // object hands the connector's own headers through, and the tunneled instance
  // sends no Cache-Control on its content-hashed build assets, so without this
  // a phone re-fetches the whole shell on every load through the bridge too.
  return withImmutableAssetCache(response, pathname, request.method)
}

/** The same headers without the bridge attach marker. */
function withoutAttachMarker(headers) {
  const copy = new Headers(headers)
  copy.delete(RELAY_BRIDGE_ATTACH_HEADER)
  return copy
}

/** Mark a quick answer as the fallback of a bridge-mode request. A 101 is
 * returned untouched: its socket cannot be carried by a rebuilt Response. */
function withFallbackMark(response) {
  if (response.status === 101) return response
  const headers = new Headers(response.headers)
  headers.set(RELAY_FALLBACK_HEADER, RELAY_BRIDGE_NO_CONNECTOR)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/**
 * Proxy one request for `<id>.dsh-market.com` to the registered target.
 * The pairing cookie and every application check stay on the tunneled
 * instance; this hop rewrites only the Host header so the origin sees the
 * relay hostname (cookies and harness auth are Host-bound there).
 *
 * The transport is decided before the registry is consulted, because a bridged
 * instance has no registration row to find: its connector serves the hostname
 * out of its Durable Object, and the plugin stops announcing a quick target the
 * moment its mode is bridge. Requiring a row first would answer `instance-offline`
 * for exactly the instances the bridge default is meant to serve.
 */
export async function handleRelayProxy(request, env, id) {
  // A deployment without the namespace answers `quick` here without a read, and
  // an unreadable mode answers `quick` too: this probe never turns a working
  // quick instance into a failure.
  const transport = await bridgeModeOf(env, id)
  if (transport === 'bridge') {
    const bridged = await fetchThroughBridge(request, env, id, new URL(request.url).pathname)
    if (bridged !== undefined) return bridged
    // The object holds no connector, so this instance has no bridge to serve
    // from; the registry below is what a still-running quick tunnel answers on.
  }

  let row
  try {
    row = await env.DB.prepare('SELECT target FROM relay_registrations WHERE id = ?1').bind(id).first()
  } catch {
    return relayFailure('relay-storage-unavailable')
  }
  if (!row) return acceptsOfflinePage(request) ? offlinePage() : relayFailure('instance-offline')

  let target
  try {
    target = new URL(request.url)
    target.protocol = 'https:'
    target.hostname = new URL(row.target).hostname
    target.port = ''
  } catch {
    return relayFailure('invalid-registration')
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
  let response
  try {
    const forwarded = new Request(target.href, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
      // WebSocket upgrades ride this path in Workers (fetch upgrades when the
      // client sends an Upgrade request and the body is null).
      ...(request.headers.get('upgrade') === 'websocket' ? {} : { duplex: 'half' }),
    })
    response = await fetch(forwarded)
  } catch (error) {
    // Every throw here means the registered tunnel gave this hop no answer at
    // all, the one condition the frozen table calls `instance-offline`.
    console.warn(JSON.stringify({ relay: 'proxy-upstream-error', id, message: error instanceof Error ? error.message : String(error) }))
    return relayFailure('instance-offline', { message: 'the instance tunnel did not answer' })
  }
  const shaped = withImmutableAssetCache(response, target.pathname, request.method)
  return transport === 'bridge' ? withFallbackMark(shaped) : shaped
}

/** Dispatch for relay traffic: returns a Response, or undefined when the
 * request is not relay-routed (the main fetch handler continues). */
export async function handleRelay(request, env) {
  const url = new URL(request.url)
  const id = relayIdOf(url)
  if (!id) return undefined
  return handleRelayProxy(request, env, id)
}