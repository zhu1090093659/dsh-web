/**
 * dsh-market — edge API for the DSH marketplace.
 * Anonymous likes are Turnstile-gated (fail closed without the secret) and stored in D1.
 * Write bodies are size-capped and asset ids are checked against the served manifests.
 * The API surface is advertised via /.well-known/api-catalog (RFC 9727),
 * described by /openapi.json and documented at /api-docs.html.
 */

import { handleTelemetryPost, handleTelemetrySummary, handleTelemetryUsersBadge, pruneOldEvents, refreshBadgeCache } from './telemetry.js'
import { readJsonCapped } from './body.js'
import { isKnownAsset } from './asset-allowlist.js'
import { handleNpmBadge, handleNpmDownloads } from './npm-badge.js'
import API_CATALOG from './api-catalog.js'
import OPENAPI_SPEC from './openapi.js'
import API_DOCS_HTML from './api-doc.js'

const KINDS = new Set(['skin', 'pet', 'plugin'])
const INSTALL_ACTIONS = new Set(['market-like', 'market-install'])
const HOMEPAGE_PATHS = new Set(['/', '/index.html'])
const HOME_LINK = '</.well-known/api-catalog>; rel="api-catalog", </openapi.json>; rel="service-desc", </api-docs.html>; rel="service-doc", </api-docs.html>; rel="describedby"'
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** Anonymous write bodies are tiny; cap them to bound parse cost and abuse. */
const WRITE_BODY_MAX_BYTES = 4 * 1024
const MARKDOWN_TTL_MS = 5 * 60 * 1000

/** True when the Accept header prefers text/markdown with q > 0. */
function acceptsMarkdown(accept) {
  if (!accept) return false
  for (const part of accept.split(',')) {
    const [type, ...params] = part.trim().split(';')
    if (type.trim().toLowerCase() !== 'text/markdown') continue
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    const qv = q ? Number.parseFloat(q.slice(2)) : 1
    if (!Number.isFinite(qv) || qv > 0) return true
  }
  return false
}

/** Approximate token count for x-markdown-tokens (chars per token heuristic). */
function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4))
}

let markdownCache = { at: 0, body: '', tokens: 0 }

/**
 * Markdown representation of the homepage, generated from the same public
 * manifests the site renders. Cached briefly; returns null when the data
 * cannot be read, so the caller can fall back to the HTML representation.
 */
async function homeMarkdown(env) {
  const now = Date.now()
  if (now - markdownCache.at < MARKDOWN_TTL_MS && markdownCache.body) return markdownCache
  const read = async (path) => {
    const res = await env.ASSETS.fetch(new URL(path, 'https://dsh-market.com/'))
    if (!res || res.status !== 200) return { items: [] }
    return res.json().catch(() => ({ items: [] }))
  }
  try {
    const [skins, pets, plugins] = await Promise.all([
      read('/manifest/skins.json'),
      read('/manifest/pets.json'),
      read('/manifest/plugins.json'),
    ])
    const lines = [
      '# DSH Web UI 创意工坊',
      '',
      'dsh-market.com — DSH Web UI 社区皮肤、宠物与插件的一站式创意工坊。',
      '本文件是站点的 Markdown 表示，通过内容协商（Accept: text/markdown）提供给智能体。',
      '',
      '- API 目录: https://dsh-market.com/.well-known/api-catalog',
      '- OpenAPI 描述: https://dsh-market.com/openapi.json',
      '- API 文档: https://dsh-market.com/api-docs.html',
      '- 网站地图: https://dsh-market.com/sitemap.xml',
      '',
      '## 皮肤 (Skins)',
      '',
    ]
    const skinsItems = Array.isArray(skins.items) ? skins.items : []
    if (!skinsItems.length) lines.push('暂无皮肤。')
    for (const s of skinsItems.sort((a, b) => (a.rank - b.rank) || String(a.id).localeCompare(String(b.id)))) {
      lines.push('### ' + (s.name || s.id) + ' (' + s.id + ')')
      if (s.nameEn) lines.push('- 英文名: ' + s.nameEn)
      lines.push('- 作者: ' + (s.author || '未知'))
      if (s.version) lines.push('- 版本: ' + s.version)
      if (Array.isArray(s.tags) && s.tags.length) lines.push('- 标签: ' + s.tags.join(', '))
      if (s.tagline) lines.push('- 简介: ' + s.tagline)
      if (s.description) lines.push('- 说明: ' + s.description)
      lines.push('- 实时试穿: https://dsh-market.com/tryon/?skin=' + encodeURIComponent(s.id))
      lines.push('')
    }
    lines.push('## 宠物 (Pets)', '')
    const petsItems = Array.isArray(pets.items) ? pets.items : []
    if (!petsItems.length) lines.push('暂无宠物。')
    for (const p of petsItems.sort((a, b) => (a.rank - b.rank) || String(a.id).localeCompare(String(b.id)))) {
      lines.push('### ' + (p.displayName || p.id) + ' (' + p.id + ')')
      if (p.description) lines.push('- 说明: ' + p.description)
      lines.push('')
    }
    lines.push('## 插件 (Plugins)', '')
    const pluginItems = Array.isArray(plugins.items) ? plugins.items : []
    if (!pluginItems.length) lines.push('暂无插件。')
    for (const p of pluginItems.sort((a, b) => (a.rank - b.rank) || String(a.id).localeCompare(String(b.id)))) {
      lines.push('### ' + (p.name || p.id) + ' (' + p.id + ')')
      lines.push('- 分类: ' + (p.category || 'other'))
      if (p.description) lines.push('- 说明: ' + p.description)
      if (p.repo) lines.push('- 仓库: ' + p.repo)
      if (p.npm) lines.push('- npm: ' + p.npm)
      lines.push('')
    }
    const body = lines.join('\n')
    markdownCache = { at: now, body, tokens: estimateTokens(body) }
    return markdownCache
  } catch {
    return null
  }
}
const FP_RE = /^[A-Za-z0-9_-]{16,64}$/
const SKIN_RE = /^[a-z][a-z0-9-]{0,31}$/
const TURNSTILE_ACTION = 'market-like'
const TURNSTILE_SITEKEY = '0x4AAAAAAEYeoSRJRjgCOiZI'

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      ...extra,
    },
  })
}

function preflight(request) {
  const headers = new Headers({
    // ACAO * is intentional: the legitimate writers are MarketCards embedded
    // in arbitrary per-user DSH GUI origins (loopback, LAN, custom domains),
    // which cannot be enumerated. The abuse boundary is Turnstile + the
    // manifest allowlist, not CORS. Allow-headers stays a static list instead
    // of reflecting access-control-request-headers so the header surface
    // cannot creep as new custom headers appear.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  })
  return new Response(null, { status: 204, headers })
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function readStats(env) {
  const { results } = await env.DB.prepare('SELECT kind, asset_id, votes FROM counts').all()
  const out = { skin: {}, pet: {}, plugin: {} }
  for (const row of results || []) {
    if (!(row.kind in out)) continue
    out[row.kind][row.asset_id] = row.votes
  }
  return out
}

async function verifyTurnstile(request, env, token) {
  // Fail closed: without the secret binding no challenge can be verified,
  // so writes are rejected instead of passing anonymously.
  if (!env.TURNSTILE_SECRET) return { ok: false, codes: ['missing-secret-binding'] }
  if (!token) return { ok: false, codes: [] }
  const form = new URLSearchParams()
  form.set('secret', env.TURNSTILE_SECRET)
  form.set('response', token)
  form.set('idempotency_key', crypto.randomUUID())
  const ip = request.headers.get('cf-connecting-ip') || ''
  if (ip) form.set('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const result = await response.json().catch(() => ({ success: false }))
  // siteverify error-codes are not sensitive and are surfaced on the 403 so a
  // dead pairing (invalid-input-secret) is distinguishable from token problems.
  const codes = Array.isArray(result['error-codes']) ? result['error-codes'].map(String) : []
  return {
    ok: result.success === true && INSTALL_ACTIONS.has(result.action) && result.hostname === 'dsh-market.com',
    codes,
  }
}

const CHALLENGE_HTML = [
  '<!doctype html><meta charset="utf-8"><title>Market verification</title>',
  '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"></script>',
  '<div id="challenge"></div>',
  '<script>(function(){',
  'var origin="",requestId="",widget=null,action="' + TURNSTILE_ACTION + '";',
  'function reply(token){if(!origin||!requestId)return;parent.postMessage({source:"dsh-market-card",type:"token",id:requestId,token:token||""},origin);requestId=""}',
  'function ensure(){if(widget!==null||!window.turnstile)return widget;widget=window.turnstile.render("#challenge",{sitekey:"' + TURNSTILE_SITEKEY + '",action:action,size:"invisible",callback:reply,"error-callback":function(){reply("")},"timeout-callback":function(){reply("")}});return widget}',
  'addEventListener("message",function(event){if(event.source!==parent||!event.data||event.data.source!=="dsh-market-card"||event.data.type!=="request")return;action=String(event.data.action||"' + TURNSTILE_ACTION + '");if(!action)action="' + TURNSTILE_ACTION + '";origin=event.origin;requestId=String(event.data.id||"");var tries=0,timer=setInterval(function(){tries++;if(widget!==null&&window.turnstile){try{window.turnstile.reset(widget);window.turnstile.execute(widget)}catch(error){reply("")}clearInterval(timer);return}var id=ensure();if(id!==null){try{window.turnstile.reset(id);window.turnstile.execute(id)}catch(error){reply("")}clearInterval(timer)}else if(tries>=160){clearInterval(timer);reply("")}},50)});',
  '})()</script>',
].join('')

function challengePage() {
  return new Response(CHALLENGE_HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'",
    },
  })
}

/**
 * Record one Workshop install event and refresh the per-asset install count
 * in one D1 batch. Retrying the same (asset, device, install_id) collapses via
 * the deterministic event id; a fresh install_id counts again.
 */
async function mutateInstall(env, kind, assetId, hash, installId) {
  const eventId = await sha256(['v1', kind, assetId, hash, installId].join('|'))
  const insert = env.DB.prepare(
    'INSERT OR IGNORE INTO install_events (id, kind, asset_id, device_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)'
  ).bind(eventId, kind, assetId, hash, Date.now())
  const recount = env.DB.prepare(
    'INSERT INTO install_counts (kind, asset_id, installs) SELECT ?1, ?2, COUNT(*) FROM install_events WHERE kind = ?1 AND asset_id = ?2 ON CONFLICT(kind, asset_id) DO UPDATE SET installs = excluded.installs'
  ).bind(kind, assetId)
  const select = env.DB.prepare('SELECT installs FROM install_counts WHERE kind = ?1 AND asset_id = ?2').bind(kind, assetId)
  const results = await env.DB.batch([insert, recount, select])
  const rows = results[2] && results[2].results
  return Number(rows && rows[0] && rows[0].installs) || 0
}

/** Read per-asset cumulative install counts. */
async function readInstalls(env) {
  try {
    const { results } = await env.DB.prepare('SELECT kind, asset_id, installs FROM install_counts').all()
    const out = { skin: {}, pet: {}, plugin: {} }
    for (const row of results || []) {
      if (!(row.kind in out)) continue
      out[row.kind][row.asset_id] = row.installs
    }
    return out
  } catch {
    // Migration not applied yet: fall back to empty counts so the stats API
    // still serves votes. First install report will fail too, since the
    // table is absent; deployed worker and D1 migration move together.
    return null
  }
}

async function mutateLike(env, kind, assetId, hash, unlike) {
  const mutate = unlike
    ? env.DB.prepare('DELETE FROM likes WHERE kind = ?1 AND asset_id = ?2 AND device_hash = ?3').bind(kind, assetId, hash)
    : env.DB.prepare('INSERT OR IGNORE INTO likes (kind, asset_id, device_hash, created_at) VALUES (?1, ?2, ?3, ?4)').bind(kind, assetId, hash, Date.now())
  const recount = env.DB.prepare(
    'INSERT INTO counts (kind, asset_id, votes) SELECT ?1, ?2, COUNT(*) FROM likes WHERE kind = ?1 AND asset_id = ?2 ON CONFLICT(kind, asset_id) DO UPDATE SET votes = excluded.votes'
  ).bind(kind, assetId)
  const select = env.DB.prepare('SELECT votes FROM counts WHERE kind = ?1 AND asset_id = ?2').bind(kind, assetId)
  const results = await env.DB.batch([mutate, recount, select])
  const rows = results[2] && results[2].results
  return Number(rows && rows[0] && rows[0].votes) || 0
}

export default {
  /** Cron trigger: recompute the public badge counts and prune expired
   * telemetry events (wrangler.jsonc triggers.crons). */
  async scheduled(controller, env) {
    try {
      await refreshBadgeCache(env)
    } catch { /* best-effort; the badge serves the last computed row */ }
    try {
      await pruneOldEvents(env)
    } catch { /* best-effort; pruning retries on the next tick */ }
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === 'OPTIONS' && (path === '/api/like' || path === '/api/install' || path === '/api/stats' || path === '/api/telemetry/event')) return preflight(request)
    if (path === '/api/health') return json({ ok: true })
    if (path === '/api/npm-badge/downloads' && request.method === 'GET') return handleNpmBadge('downloads', json)
    if (path === '/api/npm-badge/version' && request.method === 'GET') return handleNpmBadge('version', json)
    if (path === '/api/npm-badge/total' && request.method === 'GET') return handleNpmBadge('total', json)
    if (path === '/api/npm-downloads' && request.method === 'GET') return handleNpmDownloads(env, json)
    if (path === '/api/telemetry/badge/users' && request.method === 'GET') return handleTelemetryUsersBadge(request, env, json)
    if (path === '/api/turnstile/challenge' && request.method === 'GET') return challengePage()

    if (path === '/api/stats' && request.method === 'GET') {
      // Worker-level cache for one minute with a one-hour stale copy:
      // workshop cards fetch this on every GUI start, and under D1 overload
      // the card UI must render last-known counts instead of an error. The
      // client response stays no-store so the zone cache rules and browsers
      // keep the pre-existing freshness semantics; only the worker-internal
      // copies are cacheable.
      const statsUrl = new URL(request.url)
      statsUrl.search = ''
      const statsCache = caches.default
      const statsKey = new Request(statsUrl.href, { method: 'GET' })
      const freshStats = await statsCache.match(statsKey)
      if (freshStats) {
        // Stored copies carry a max-age for the worker-cache TTL; strip it on
        // the way out so every client-visible response stays no-store and the
        // zone cache rules never pin stats for hours.
        const headers = new Headers(freshStats.headers)
        headers.set('cache-control', 'no-store')
        return new Response(freshStats.body, { status: freshStats.status, headers })
      }
      try {
        const [votes, installs] = await Promise.all([readStats(env), readInstalls(env)])
        const body = { ...votes, installs }
        try {
          await statsCache.put(statsKey, json(body, 200, { 'cache-control': 'public, max-age=60' }))
          await statsCache.put(new Request(statsUrl.href + '?stale=1', { method: 'GET' }), json(body, 200, { 'cache-control': 'public, max-age=3600' }))
        } catch { /* caching is best-effort; serve the computed response */ }
        return json(body, 200, { 'cache-control': 'no-store' })
      } catch {
        const staleStats = await statsCache.match(new Request(statsUrl.href + '?stale=1', { method: 'GET' }))
        if (staleStats) {
          const headers = new Headers(staleStats.headers)
          headers.set('cache-control', 'no-store')
          return new Response(staleStats.body, { status: staleStats.status, headers })
        }
        return json({ ok: false, error: 'storage-unavailable' }, 503)
      }
    }

    if (path === '/api/install' && request.method === 'POST') {
      const read = await readJsonCapped(request, WRITE_BODY_MAX_BYTES)
      if (!read.ok) return json({ ok: false, error: read.error }, read.error === 'payload-too-large' ? 413 : 400)
      const body = read.value
      const kind = typeof body.kind === 'string' ? body.kind : ''
      const assetId = typeof body.asset_id === 'string' ? body.asset_id : ''
      const fp = typeof body.device_fp === 'string' ? body.device_fp : ''
      const installId = typeof body.install_id === 'string' ? body.install_id : ''
      if (!KINDS.has(kind) || !ASSET_RE.test(assetId) || !FP_RE.test(fp) || !/^[A-Za-z0-9_-]{16,64}$/.test(installId)) {
        return json({ ok: false, error: 'invalid-params' }, 400)
      }
      if (!(await isKnownAsset(env, kind, assetId))) return json({ ok: false, error: 'unknown-asset' }, 400)
      const hash = await sha256(fp)
      const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
      const turnstile = await verifyTurnstile(request, env, token)
      if (!turnstile.ok) {
        return json({ ok: false, error: token ? 'captcha-invalid' : 'captcha-required', captcha_error_codes: turnstile.codes }, 403)
      }
      const installs = await mutateInstall(env, kind, assetId, hash, installId)
      return json({ ok: true, installs })
    }

    if (path === '/api/telemetry/event' && request.method === 'POST') {
      return handleTelemetryPost(request, env, json)
    }

    if (path === '/api/telemetry/summary' && request.method === 'GET') {
      return handleTelemetrySummary(request, url, env, json)
    }

    if (path === '/api/like' && request.method === 'POST') {
      const read = await readJsonCapped(request, WRITE_BODY_MAX_BYTES)
      if (!read.ok) return json({ ok: false, error: read.error }, read.error === 'payload-too-large' ? 413 : 400)
      const body = read.value
      const kind = typeof body.kind === 'string' ? body.kind : ''
      const assetId = typeof body.asset_id === 'string' ? body.asset_id : ''
      const fp = typeof body.device_fp === 'string' ? body.device_fp : ''
      const unlike = body.unlike === true
      if (!KINDS.has(kind) || !ASSET_RE.test(assetId) || !FP_RE.test(fp)) {
        return json({ ok: false, error: 'invalid-params' }, 400)
      }
      if (!(await isKnownAsset(env, kind, assetId))) return json({ ok: false, error: 'unknown-asset' }, 400)
      const hash = await sha256(fp)
      const token = typeof body.turnstile_token === 'string' ? body.turnstile_token : ''
      const turnstile = await verifyTurnstile(request, env, token)
      if (!turnstile.ok) {
        return json({ ok: false, error: token ? 'captcha-invalid' : 'captcha-required', captcha_error_codes: turnstile.codes }, 403)
      }
      const votes = await mutateLike(env, kind, assetId, hash, unlike)
      return json({ ok: true, liked: !unlike, votes })
    }

    if (path.startsWith('/api/skin-center/v2/skins/') && request.method === 'GET') {
      const rest = path.slice('/api/skin-center/v2/skins/'.length)
      const slash = rest.indexOf('/')
      const skinId = slash === -1 ? '' : rest.slice(0, slash)
      const sub = slash === -1 ? '' : rest.slice(slash + 1)
      const rel = sub === 'stylesheet' ? 'skin.css'
        : sub === 'patches' ? 'patches.css'
          : sub === 'hooks.mjs' ? 'hooks.mjs'
            : /^(assets|preview)\//.test(sub) ? sub : null
      if (SKIN_RE.test(skinId) && rel !== null && !rel.includes('..')) {
        const assetPath = sub === 'stylesheet' || sub === 'patches'
          ? '/tryon-assets/skins/' + encodeURIComponent(skinId) + '/' + rel
          : '/assets/skins/' + encodeURIComponent(skinId) + '/' + rel
        const asset = await env.ASSETS.fetch(new URL(assetPath, url))
        if (asset && asset.status !== 404) {
          const headers = new Headers()
          headers.set('content-type', asset.headers.get('content-type') || 'application/octet-stream')
          headers.set('cache-control', asset.headers.get('cache-control') || 'public, max-age=86400, stale-while-revalidate=86400')
          for (const name of ['etag', 'last-modified']) {
            const value = asset.headers.get(name)
            if (value) headers.set(name, value)
          }
          return new Response(asset.body, { status: asset.status, headers })
        }
      }
      return json({ ok: false, error: 'skin-asset-not-found' }, 404)
    }

    if (HOMEPAGE_PATHS.has(path) && (request.method === 'GET' || request.method === 'HEAD')) {
      if (acceptsMarkdown(request.headers.get('accept'))) {
        const md = await homeMarkdown(env)
        if (md) {
          return new Response(md.body, {
            status: 200,
            headers: {
              'content-type': 'text/markdown; charset=utf-8',
              'cache-control': 'public, max-age=300',
              'access-control-allow-origin': '*',
              'x-content-type-options': 'nosniff',
              'x-markdown-tokens': String(md.tokens),
            },
          })
        }
      }
      const asset = await env.ASSETS.fetch(new URL(path === '/' ? '/' : '/index.html', url))
      if (asset && asset.status === 200) {
        // RFC 8288 / RFC 9727 Section 3: advertise machine-readable resources.
        const headers = new Headers()
        headers.set('content-type', asset.headers.get('content-type') || 'text/html; charset=utf-8')
        headers.set('cache-control', asset.headers.get('cache-control') || 'public, max-age=0, must-revalidate')
        for (const name of ['etag', 'last-modified']) {
          const value = asset.headers.get(name)
          if (value) headers.set(name, value)
        }
        headers.set('link', HOME_LINK)
        return new Response(asset.body, { status: asset.status, headers })
      }
      return json({ ok: false, error: 'not-found' }, 404)
    }

    if (path === '/.well-known/api-catalog' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(JSON.stringify(API_CATALOG, null, 2) + '\n', {
        status: 200,
        headers: {
          'content-type': 'application/linkset+json',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
          'link': '</.well-known/api-catalog>; rel="api-catalog", <https://www.rfc-editor.org/info/rfc9727>; rel="profile"',
        },
      })
    }

    if (path === '/api' && request.method === 'GET') {
      return json({ ok: true, title: 'DSH Web UI Marketplace API', catalog: 'https://dsh-market.com/.well-known/api-catalog' }, 200, { 'cache-control': 'public, max-age=300' })
    }

    if (path === '/openapi.json' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(JSON.stringify(OPENAPI_SPEC, null, 2) + '\n', {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      })
    }

    if (path === '/api-docs.html' && (request.method === 'GET' || request.method === 'HEAD')) {
      return new Response(API_DOCS_HTML, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300',
          'access-control-allow-origin': '*',
          'x-content-type-options': 'nosniff',
        },
      })
    }

    return json({ ok: false, error: 'not-found' }, 404)
  },
}
