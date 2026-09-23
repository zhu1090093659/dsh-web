/**
 * dsh-market-telemetry-view — private real-time viewer for the dsh-market
 * UV/PV aggregates, served at tv.dsh-market.com.
 *
 * Access model (defense in depth):
 * - The route is meant to sit behind a Cloudflare Access application; once
 *   the app exists, unauthenticated requests never reach this worker.
 * - Regardless of Access, the worker itself verifies the Cf-Access-Jwt-
 *   Assertion signature against the team JWKS and refuses to serve anything
 *   until ACCESS_TEAM and ACCESS_AUD secrets are configured.
 *
 * The worker holds no data: every render fetches the live aggregate from
 * dsh-market.com /api/telemetry/summary with TELEMETRY_READ_KEY, so the
 * market worker stays the single source of truth. In-page interactions
 * (range switch, table pagination) go through the same-origin /data proxy,
 * which applies the same Access verification and forwards the summary
 * API's pagination window.
 */

import { CLIENT_JS, PAGE_CSP, renderDashboard } from './page.js'

const SUMMARY_BASE = 'https://dsh-market.com/api/telemetry/summary'
/** Initial page sizes for the two paginated tables. */
const PAGE_SIZES = { paths: 10, items: 10 }

let jwksCache = { at: 0, keys: null }

async function getJwks(team) {
  const now = Date.now()
  if (jwksCache.keys && now - jwksCache.at < 3600000) return jwksCache.keys
  const res = await fetch('https://' + team + '.cloudflareaccess.com/cdn-cgi/access/certs')
  if (!res.ok) throw new Error('jwks fetch failed')
  const body = await res.json()
  jwksCache = { at: now, keys: body.keys || [] }
  return jwksCache.keys
}

function b64uToBytes(text) {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
}

/** Verify the Access JWT signature, audience and expiry against the team. */
async function accessVerified(request, env) {
  const fail = (reason) => { console.log('[access-denied] ' + reason); return false }
  const jwt = request.headers.get('cf-access-jwt-assertion')
  if (!jwt) return fail('no jwt header')
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return fail('secrets unset')
  const [headB64, claimsB64, sigB64] = jwt.split('.')
  if (!headB64 || !claimsB64 || !sigB64) return fail('malformed jwt')
  let header, claims
  try {
    header = JSON.parse(new TextDecoder().decode(b64uToBytes(headB64)))
    claims = JSON.parse(new TextDecoder().decode(b64uToBytes(claimsB64)))
  } catch { return fail('undecodable claims') }
  // Access issues aud as a string for some app shapes and a single-element
  // array for others; accept both.
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(env.ACCESS_AUD) : claims.aud === env.ACCESS_AUD
  if (!audOk) return fail('aud mismatch: ' + JSON.stringify(claims.aud))
  if (Number(claims.exp) * 1000 < Date.now()) return fail('expired')
  let keys
  try {
    keys = await getJwks(env.ACCESS_TEAM)
  } catch (error) {
    return fail('jwks fetch failed: ' + error.message)
  }
  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) return fail('kid not found: ' + JSON.stringify(header.kid))
  const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  // The signing input is the literal ASCII "header.payload" string, not
  // base64-decoded data; only the signature itself is base64url.
  const signingInput = new TextEncoder().encode(headB64 + '.' + claimsB64)
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, b64uToBytes(sigB64), signingInput)
  if (!ok) return fail('signature invalid')
  return true
}

const PLAIN_STYLE = '<style>body{font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#0a0f1e;color:#e6eaf6;max-width:640px;margin:0 auto;padding:48px 24px}h1{font-size:20px}code{background:rgba(148,163,255,.12);color:#a9bcff;padding:1px 6px;border-radius:5px}li{margin:8px 0}</style>'

function page(status, title, body) {
  return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title>' + PLAIN_STYLE + '</head><body>' + body + '</body></html>', {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': PAGE_CSP,
      'referrer-policy': 'no-referrer',
    },
  })
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': PAGE_CSP,
      'referrer-policy': 'no-referrer',
    },
  })
}

const SETUP_HTML = [
  '<h1>telemetry view: setup required</h1>',
  '<p>This viewer refuses to serve data until Cloudflare Access is configured.</p>',
  '<ol>',
  '<li>Zero Trust &gt; Access &gt; Applications: create a self-hosted app for <code>tv.dsh-market.com</code> with an email-OTP policy for your address.</li>',
  '<li>Copy the application AUD tag.</li>',
  '<li>From <code>market/telemetry-view</code> run:<br>',
  '<code>npx wrangler@4 secret put ACCESS_TEAM --name dsh-market-telemetry-view</code> (your team name, the part before <code>.cloudflareaccess.com</code>)<br>',
  '<code>npx wrangler@4 secret put ACCESS_AUD --name dsh-market-telemetry-view</code></li>',
  '</ol>',
].join('')

/**
 * Fetch the summary aggregate upstream. query carries the caller's
 * days/paths/items window verbatim; the market worker clamps it. The
 * MARKET service binding is the production path: this worker runs inside
 * the market worker's invocation chain (forwarded for tv.dsh-market.com),
 * and a public fetch back to dsh-market.com would re-enter that worker in
 * the same chain, trip Cloudflare's loop protection, and fail as a 522
 * from the custom-domain placeholder origin. Bindings bypass zone routing
 * entirely.
 */
async function fetchSummary(env, query) {
  const request = new Request(SUMMARY_BASE + '?' + query, {
    headers: { 'x-telemetry-key': env.TELEMETRY_READ_KEY || '' },
  })
  const res = env.MARKET ? await env.MARKET.fetch(request) : await fetch(request)
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, data: await res.json() }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (!env.ACCESS_TEAM || !env.ACCESS_AUD) {
      return page(503, 'telemetry view setup', SETUP_HTML)
    }
    if (!(await accessVerified(request, env))) {
      return page(401, 'telemetry view', '<h1>401</h1><p>Cloudflare Access verification failed.</p>')
    }

    // The dashboard client script, served same-origin so script-src 'self'
    // covers it even when the edge injects a CSP nonce (which neutralizes
    // 'unsafe-inline'). No-cache: it ships in lockstep with the HTML shell.
    if (url.pathname === '/app.js' && request.method === 'GET') {
      return new Response(CLIENT_JS, {
        status: 200,
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': PAGE_CSP,
          'referrer-policy': 'no-referrer',
        },
      })
    }

    if (url.pathname === '/data' && request.method === 'GET') {
      const forwarded = new URLSearchParams()
      for (const key of ['days', 'paths_limit', 'paths_offset', 'items_limit', 'items_offset']) {
        const value = url.searchParams.get(key)
        if (value !== null && /^\d{1,6}$/.test(value)) forwarded.set(key, value)
      }
      const result = await fetchSummary(env, forwarded.toString())
      if (!result.ok) return json({ ok: false, error: 'upstream-' + result.status }, 502)
      return json(result.data, 200)
    }

    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      return page(404, 'telemetry view', '<h1>404</h1><p>Not found.</p>')
    }

    let days = Number.parseInt(url.searchParams.get('days') || '', 10)
    if (!Number.isFinite(days)) days = 30
    days = Math.min(Math.max(days, 1), 365)
    const result = await fetchSummary(env, new URLSearchParams({
      days: String(days),
      paths_limit: String(PAGE_SIZES.paths),
      items_limit: String(PAGE_SIZES.items),
    }).toString())
    if (!result.ok) {
      return page(502, 'telemetry view', '<h1>502</h1><p>Summary upstream returned ' + result.status + '.</p>')
    }
    return new Response(renderDashboard({ days, sizes: PAGE_SIZES, data: result.data }), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': PAGE_CSP,
        'referrer-policy': 'no-referrer',
      },
    })
  },
}
