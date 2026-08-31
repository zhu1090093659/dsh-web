import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import worker from '../market/worker/src/index.js'

const workerCacheEntries = new Map()
const workerCache = {
  async match(request) {
    const response = workerCacheEntries.get(request.url)
    return response ? response.clone() : undefined
  },
  async put(request, response) {
    workerCacheEntries.set(request.url, response.clone())
  },
}
globalThis.caches = { default: workerCache }
beforeEach(() => workerCacheEntries.clear())

function context() { return { waitUntil() {} } }

test('market worker answers like preflight with CORS', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:3080',
      'access-control-request-headers': 'content-type',
    },
  }), {}, context())
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.match(response.headers.get('access-control-allow-methods') || '', /POST/)
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type')
})

test('market worker preflight never reflects arbitrary request headers', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://evil.example',
      'access-control-request-headers': 'content-type, x-custom-spam, authorization',
    },
  }), {}, context())
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type')
})

test('market worker rejects the removed card-header Turnstile bypass', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-market-client': 'market-card' },
    body: JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef' }),
  }), { TURNSTILE_SECRET: 'configured' }, context())
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, 'captcha-required')
})

test('market worker fails closed on writes when TURNSTILE_SECRET is unset', async () => {
  const db = { prepare: () => { throw new Error('DB must not be touched without the Turnstile binding') } }
  for (const [path, body] of [
    ['/api/like', { kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', turnstile_token: 'token-1' }],
    ['/api/install', { kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', install_id: 'install-1-abcdef1234567890', turnstile_token: 'token-1' }],
  ]) {
    const response = await worker.fetch(new Request('https://dsh-market.com' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }), { DB: db }, context())
    assert.equal(response.status, 403, path + ' rejects without the secret binding')
    assert.equal((await response.json()).error, 'captcha-invalid')
  }
})

test('market worker preserves static asset cache validators', async () => {
  let requested = ''
  const response = await worker.fetch(new Request('https://dsh-market.com/api/skin-center/v2/skins/harbor/stylesheet'), {
    ASSETS: {
      async fetch(request) {
        requested = request instanceof URL ? request.pathname : new URL(typeof request === 'string' ? request : request.url).pathname
        return new Response('body{}', { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=86400', etag: 'abc' } })
      },
    },
  }, context())
  assert.equal(response.status, 200)
  assert.equal(requested, '/tryon-assets/skins/harbor/skin.css')
  assert.equal(response.headers.get('cache-control'), 'public, max-age=86400')
  assert.equal(response.headers.get('etag'), 'abc')
})
test('worker records a like via one D1 batch with recount and count read', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: 'market-like', hostname: 'dsh-market.com' }))
  try {
    const seen = []
    const stmt = () => ({ bind: (...args) => ({ sql: 'stmt', args, original: true }) })
    const db = {
      prepare: (sql) => {
        const s = { sql }
        s.bind = (...args) => { seen.push({ kind: 'bind', sql, args }); return { kind: 'exec', sql } }
        return { bind: s.bind }
      },
      batch: async (items) => {
        seen.push({ kind: 'batch', count: items.length })
        const wants = items.map((i) => i.kind)
        return [
          { results: [] },
          { results: [] },
          { results: [{ votes: 7 }] },
        ]
      },
    }
    const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', turnstile_token: 'token-1' }),
    }), { TURNSTILE_SECRET: 'configured', DB: db }, context())
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.votes, 7)
    assert.equal(seen.filter((e) => e.kind === 'batch').length, 1)
    const batch = seen.find((e) => e.kind === 'batch')
    assert.equal(batch.count, 3)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('worker records an install via one D1 batch with recount and count read', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: 'market-install', hostname: 'dsh-market.com' }))
  try {
    const seen = []
    const db = {
      prepare: (sql) => {
        const s = { sql }
        s.bind = (...args) => { seen.push({ kind: 'bind', sql, args }); return { kind: 'exec', sql } }
        return { bind: s.bind }
      },
      batch: async (items) => {
        seen.push({ kind: 'batch', count: items.length })
        return [
          { results: [], meta: { changed_db: 1 } },
          { results: [] },
          { results: [{ installs: 6 }] },
        ]
      },
    }
    const response = await worker.fetch(new Request('https://dsh-market.com/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', install_id: 'install-1-abcdef1234567890', turnstile_token: 'token-1' }),
    }), { TURNSTILE_SECRET: 'configured', DB: db }, context())
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.installs, 6)
    assert.equal(seen.filter((e) => e.kind === 'batch').length, 1)
    const batch = seen.find((e) => e.kind === 'batch')
    assert.equal(batch.count, 3)
    const insert = seen.find((e) => e.kind === 'bind' && e.sql.includes('INSERT OR IGNORE INTO install_events'))
    assert.ok(insert, 'install event insert statement present')
    assert.match(insert.args[0], /^[0-9a-f]{64}$/, 'event id is a sha256')
    assert.equal(insert.args[2], 'harbor')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('worker install endpoint rejects missing or invalid install params', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'skin', asset_id: 'bad', device_fp: 'x', install_id: 'y' }),
  }), { TURNSTILE_SECRET: 'configured' }, context())
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error, 'invalid-params')
})

test('worker stats endpoint is never cached', async () => {
  const db = { prepare: () => ({ all: async () => ({ results: [] }) }) }
  const response = await worker.fetch(new Request('https://dsh-market.com/api/stats'), { DB: db }, context())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('worker publishes the RFC 9727 API catalog at /.well-known/api-catalog', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/.well-known/api-catalog'), {}, context())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/linkset+json')
  assert.match(response.headers.get('link') || '', /rel="api-catalog"/)
  assert.match(response.headers.get('link') || '', /rfc-editor.org\/info\/rfc9727/)
  const payload = await response.json()
  const entry = payload.linkset && payload.linkset[0]
  assert.equal(entry.anchor, 'https://dsh-market.com/api')
  assert.match(entry['service-desc'][0].href, /openapi\.json$/)
  assert.match(entry['service-doc'][0].href, /api-docs\.html$/)
  assert.match(entry.status[0].href, /\/api\/health$/)
})

test('worker serves the OpenAPI description and API docs', async () => {
  const spec = await worker.fetch(new Request('https://dsh-market.com/openapi.json'), {}, context())
  assert.equal(spec.status, 200)
  assert.match(spec.headers.get('content-type') || '', /application\/json/)
  const openapi = await spec.json()
  assert.equal(openapi.openapi, '3.1.0')
  assert.ok(openapi.paths['/api/health'])
  const docs = await worker.fetch(new Request('https://dsh-market.com/api-docs.html'), {}, context())
  assert.equal(docs.status, 200)
  assert.match(docs.headers.get('content-type') || '', /text\/html/)
  assert.equal(docs.headers.get('x-content-type-options'), 'nosniff')
  assert.match(await docs.text(), /创意工坊 API 文档/)
})

test('worker adds RFC 8288 Link headers on the homepage', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/'), {
    ASSETS: {
      async fetch(request) {
        return new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=0, must-revalidate', etag: 'abc' } })
      },
    },
  }, context())
  assert.equal(response.status, 200)
  const link = response.headers.get('link') || ''
  for (const rel of ['api-catalog', 'service-desc', 'service-doc', 'describedby']) {
    assert.ok(link.includes('rel="' + rel + '"'), rel + ' missing: ' + link)
  }
  assert.ok(link.includes('/.well-known/api-catalog'))
  assert.ok(link.includes('/openapi.json'))
  assert.ok(link.includes('/api-docs.html'))
  assert.equal(response.headers.get('etag'), 'abc')
  const index = await worker.fetch(new Request('https://dsh-market.com/index.html'), {
    ASSETS: { async fetch() { return new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) } },
  }, context())
  assert.equal(index.status, 200)
  assert.ok((index.headers.get('link') || '').includes('service-desc'))
})

test('worker serves a markdown homepage via Accept: text/markdown', async () => {
  const assets = {
    async fetch(request) {
      const pathname = request instanceof URL ? request.pathname : new URL(typeof request === 'string' ? request : request.url).pathname
      const bodies = {
        '/manifest/skins.json': JSON.stringify({ items: [{ id: 'harbor', name: '港湾', nameEn: 'Harbor', author: 'linxin', rank: 1, description: '海港灯火主题' }] }),
        '/manifest/pets.json': JSON.stringify({ items: [{ id: 'whale', displayName: '鲸鱼', rank: 1 }] }),
        '/manifest/plugins.json': JSON.stringify({ items: [{ id: 'dsh-ssh', name: 'SSH', rank: 1, category: 'dev', description: 'Remote shell host' }] }),
      }
      return new Response(bodies[pathname] || '{}', { headers: { 'content-type': 'application/json' } })
    },
  }
  const response = await worker.fetch(new Request('https://dsh-market.com/', { headers: { accept: 'text/markdown' } }), { ASSETS: assets }, context())
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/markdown/)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(Number(response.headers.get('x-markdown-tokens')) > 0)
  const body = await response.text()
  assert.match(body, /^# DSH Web UI/)
  assert.match(body, /港湾/)
  assert.match(body, /HTTP\/dsh-ssh|dsh-ssh/) // plugin listed
})

test('worker keeps HTML when a browser Accept header is sent', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/', { headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } }), {
    ASSETS: { async fetch() { return new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } },
  }, context())
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') || '', /text\/html/)
})

test('worker answers /api with service info', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api'), {}, context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.catalog, 'https://dsh-market.com/.well-known/api-catalog')
})

test('challenge page renders the explicit Turnstile widget', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/turnstile/challenge'), {}, context())
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  const html = await response.text()
  assert.match(html, /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/)
  assert.match(html, /size:&quot;invisible&quot;|size:\"invisible\"/)
})

function telemetryDb(options = {}) {
  const batches = []
  const runs = []
  const db = {
    batches,
    runs,
    prepare(sql) {
      return {
        bind: (...args) => ({
          sql,
          args,
          async run() { runs.push({ sql, args }); return {} },
        }),
      }
    },
    async batch(statements) {
      batches.push(statements)
      if (statements.length === 9 && options.summary) return options.summary.map((results) => ({ results }))
      return statements.map(() => ({ results: [] }))
    },
  }
  return db
}

const VISITOR_OK = 'a'.repeat(32)

async function postEvent(env, body) {
  return worker.fetch(new Request('https://dsh-market.com/api/telemetry/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env, context())
}

test('telemetry event answers preflight with CORS for browser clients', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/event', {
    method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:3080', 'access-control-request-headers': 'content-type' },
  }), {}, context())
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
})

test('telemetry stores only the salted visitor hash, never the raw id', async () => {
  const db = telemetryDb()
  const response = await postEvent({ TELEMETRY_SALT: 'pepper', DB: db }, {
    kind: 'pageview', path: '/tryon/?skin=harbor', visitor: VISITOR_OK,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  const batch = db.batches[0]
  assert.equal(batch.length, 1)
  const args = batch[0].args
  assert.equal(args[2], 'pv')
  assert.match(args[3], /^[0-9a-f]{64}$/)
  assert.ok(!JSON.stringify(db.batches).includes(VISITOR_OK), 'raw visitor must not reach storage')
})

test('telemetry drops honest-bot pageviews without tipping them off', async () => {
  const db = telemetryDb()
  const bot = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
    body: JSON.stringify({ kind: 'pageview', path: '/', visitor: VISITOR_OK }),
  }), { DB: db }, context())
  assert.equal(bot.status, 200)
  const human = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36' },
    body: JSON.stringify({ kind: 'pageview', path: '/', visitor: VISITOR_OK }),
  }), { DB: db }, context())
  assert.equal(human.status, 200)
  assert.equal(db.batches.length, 1, 'only the human pageview reaches storage')
})

test('telemetry heartbeat expands items into one idempotent row each', async () => {
  const db = telemetryDb()
  const response = await postEvent({ DB: db }, {
    kind: 'heartbeat',
    visitor: VISITOR_OK,
    items: [
      { name: '@linxin666/dsh-client-ui-market' },
      { name: '@linxin666/dsh-pet', version: '1.2.3', channel: 'market' },
    ],
  })
  assert.equal(response.status, 200)
  const batch = db.batches[0]
  assert.equal(batch.length, 2)
  assert.equal(batch[0].args[2], 'hb')
  assert.equal(batch[0].args[5], '')
  assert.equal(batch[0].args[6], '')
  assert.equal(batch[1].args[5], '1.2.3')
  assert.equal(batch[1].args[6], 'market')
  // Same-day replay (same channel) collapses to identical ids; a channel
  // flip is a deliberate re-count, so replays must echo the channel.
  await postEvent({ DB: db }, {
    kind: 'heartbeat',
    visitor: VISITOR_OK,
    items: [{ name: '@linxin666/dsh-pet', version: '1.2.3', channel: 'market' }],
  })
  assert.equal(db.batches[1][0].args[0], batch[1].args[0])
})

test('telemetry rejects malformed submissions', async () => {
  const db = telemetryDb()
  const cases = [
    { kind: 'nope', visitor: VISITOR_OK },
    { kind: 'pageview', path: 'not-a-path', visitor: VISITOR_OK },
    { kind: 'pageview', path: '/', visitor: 'short' },
    { kind: 'heartbeat', visitor: VISITOR_OK, items: [] },
    { kind: 'heartbeat', visitor: VISITOR_OK, items: [{ name: 'bad name with spaces' }] },
    { kind: 'heartbeat', visitor: VISITOR_OK, items: [{ name: 'pkg', version: 'bad version!' }] },
    { kind: 'heartbeat', visitor: VISITOR_OK, items: [{ name: 'pkg', channel: 'hacker' }] },
  ]
  for (const body of cases) {
    const response = await postEvent({ DB: db }, body)
    assert.equal(response.status, 400, JSON.stringify(body))
  }
  assert.equal(db.batches.length, 0)
})

test('telemetry summary returns aggregates without pruning old events', async () => {
  const db = telemetryDb({
    summary: [
      [{ day: '2026-05-01', pv: 12, uv: 5 }],
      [{ day: '2026-05-01', pv: 3, uv: 2 }],
      [{ subject: '/', pv: 9 }],
      [{ n: 41 }],
      [{ subject: '@linxin666/dsh-pet', visitors: 2 }],
      [{ subject: '@linxin666/dsh-pet', visitors: 1 }],
      [{ n: 17 }],
      [{ subject: '@linxin666/dsh-pet', channel: 'market', visitors: 1 }],
      [{ subject: '@linxin666/dsh-pet', version: '1.2.3', visitors: 2 }],
    ],
  })
  const response = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary?days=7'), { DB: db }, context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.site.totals.pv, 12)
  assert.equal(payload.site.daily[0].uv, 5)
  assert.equal(payload.site.paths_total, 41)
  assert.deepEqual(payload.site.paths_page, { offset: 0, limit: 20 })
  assert.equal(payload.plugins.totals.items, 17)
  assert.deepEqual(payload.plugins.items_page, { offset: 0, limit: 200 })
  assert.equal(payload.plugins.items[0].item, '@linxin666/dsh-pet')
  assert.equal(payload.plugins.items[0].instances, 2)
  assert.equal(payload.plugins.items[0].active_today, 1)
  assert.equal(payload.plugins.items[0].channels.market, 1)
  assert.equal(payload.plugins.items[0].versions[0].version, '1.2.3')
  assert.equal(db.runs.length, 0)
})

test('telemetry summary binds the requested pagination windows', async () => {
  const db = telemetryDb()
  const response = await worker.fetch(new Request(
    'https://dsh-market.com/api/telemetry/summary?days=30&paths_limit=10&paths_offset=20&items_limit=25&items_offset=50',
  ), { DB: db }, context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.site.paths_page, { offset: 20, limit: 10 })
  assert.deepEqual(payload.plugins.items_page, { offset: 50, limit: 25 })
  const batch = db.batches[0]
  const pathsQuery = batch.find((stmt) => stmt.sql.includes("kind = 'pv'") && stmt.sql.includes('GROUP BY subject'))
  const itemsQuery = batch.find((stmt) => stmt.sql.includes("kind = 'hb'") && stmt.sql.includes('GROUP BY subject ORDER BY visitors'))
  assert.deepEqual(pathsQuery.args.slice(1), [10, 20])
  assert.deepEqual(itemsQuery.args.slice(1), [25, 50])
})

test('telemetry summary clamps out-of-range pagination parameters', async () => {
  const db = telemetryDb()
  const response = await worker.fetch(new Request(
    'https://dsh-market.com/api/telemetry/summary?paths_limit=0&paths_offset=-5&items_limit=9999',
  ), { DB: db }, context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.site.paths_page, { offset: 0, limit: 1 })
  assert.deepEqual(payload.plugins.items_page, { offset: 0, limit: 200 })
  const batch = db.batches[0]
  const pathsQuery = batch.find((stmt) => stmt.sql.includes("kind = 'pv'") && stmt.sql.includes('GROUP BY subject'))
  const itemsQuery = batch.find((stmt) => stmt.sql.includes("kind = 'hb'") && stmt.sql.includes('GROUP BY subject ORDER BY visitors'))
  assert.deepEqual(pathsQuery.args.slice(1), [1, 0])
  assert.deepEqual(itemsQuery.args.slice(1), [200, 0])
})

test('telemetry summary enforces the read key only when configured', async () => {
  const db = telemetryDb()
  const open = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary'), { DB: db }, context())
  assert.equal(open.status, 200)

  const lockedEnv = { TELEMETRY_READ_KEY: 's3cret', DB: telemetryDb() }
  const denied = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary'), lockedEnv, context())
  assert.equal(denied.status, 403)
  const wrongKey = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary', {
    headers: { 'x-telemetry-key': 'nope' },
  }), lockedEnv, context())
  assert.equal(wrongKey.status, 403)
  const queryDenied = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary?key=s3cret'), lockedEnv, context())
  assert.equal(queryDenied.status, 403, 'URL query keys are no longer accepted')
  const headerOk = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary', {
    headers: { 'x-telemetry-key': 's3cret' },
  }), lockedEnv, context())
  assert.equal(headerOk.status, 200)
})

test('telemetry endpoints degrade cleanly without D1', async () => {
  const post = await postEvent({}, { kind: 'pageview', path: '/', visitor: VISITOR_OK })
  assert.equal(post.status, 503)
  const summary = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary'), {}, context())
  assert.equal(summary.status, 503)
})

/** Fake D1 with a precomputed users-badge row. */
function badgeDb(users) {
  return {
    prepare(sql) {
      return {
        bind() { return this },
        async first() { return String(sql).includes('badge_cache') ? { value: users } : { users } },
        async run() {},
      }
    },
  }
}

test('users badge returns the all-time distinct heartbeat visitor count', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/badge/users'), { DB: badgeDb(1284) }, context())
  assert.equal(response.status, 200)
  const badge = await response.json()
  assert.equal(badge.schemaVersion, 1)
  assert.equal(badge.label, 'users')
  assert.equal(badge.message, '1.3k')
  assert.match(response.headers.get('cache-control') || '', /max-age/)
})

test('users badge degrades to grey without D1', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/badge/users'), {}, context())
  const badge = await response.json()
  assert.equal(badge.message, 'unavailable')
  assert.equal(badge.color, 'lightgrey')
})

test('batch npm downloads endpoint derives its allowlist from the plugin manifest and caches', async () => {
  const originalFetch = globalThis.fetch
  let npmCalls = 0
  const db = { prepare: () => ({ all: async () => ({ results: [] }) }) }
  globalThis.fetch = async (url) => {
    npmCalls += 1
    assert.match(String(url), /api\.npmjs\.org\/downloads\/point\/last-month\//)
    return new Response(JSON.stringify({ downloads: 41 }), { status: 200 })
  }
  const assets = {
    async fetch() {
      return new Response(JSON.stringify({ items: [{ id: 'a', npm: 'pkg-a' }, { id: 'b', repo: 'https://github.com/u/b' }, { id: 'c', npm: 'pkg-c' }] }), { status: 200 })
    },
  }
  try {
    const first = await worker.fetch(new Request('https://dsh-market.com/api/npm-downloads'), { ASSETS: assets, DB: db }, context())
    assert.equal(first.status, 200)
    assert.match(first.headers.get('cache-control') || '', /max-age/)
    const payload = await first.json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.downloads, { 'pkg-a': 41, 'pkg-c': 41 })
    const callsAfterFirst = npmCalls
    const second = await worker.fetch(new Request('https://dsh-market.com/api/npm-downloads'), { ASSETS: assets, DB: db }, context())
    await second.json()
    assert.equal(npmCalls, callsAfterFirst, 'second hit within the TTL must reuse the cache')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('batch npm downloads degrades to 503 when the manifest is unreadable', async () => {
  const assets = { async fetch() { return new Response('', { status: 404 }) } }
  const response = await worker.fetch(new Request('https://dsh-market.com/api/npm-downloads'), { ASSETS: assets }, context())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'downloads-unavailable')
})

test('total downloads badge sums the family range API with caching', async () => {
  const originalFetch = globalThis.fetch
  let npmCalls = 0
  globalThis.fetch = async (url) => {
    npmCalls += 1
    assert.match(String(url), /api\.npmjs\.org\/downloads\/range\//)
    return new Response(JSON.stringify({ downloads: [{ downloads: 100, day: '2026-01-01' }] }), { status: 200 })
  }
  try {
    const first = await worker.fetch(new Request('https://dsh-market.com/api/npm-badge/total'), {}, context())
    const badge = await first.json()
    assert.equal(badge.schemaVersion, 1)
    assert.equal(badge.label, 'downloads')
    assert.match(badge.message, /total$/)
    assert.match(badge.message, /^1\.9k /) // 19 packages x 100
    const callsAfterFirst = npmCalls
    const second = await worker.fetch(new Request('https://dsh-market.com/api/npm-badge/total'), {}, context())
    await second.json()
    assert.equal(npmCalls, callsAfterFirst, 'second hit within the TTL must reuse the cache')
  } finally {
    globalThis.fetch = originalFetch
  }
})
function manifestAssets(itemsByKind) {
  return {
    async fetch(request) {
      const pathname = request instanceof URL ? request.pathname : new URL(typeof request === 'string' ? request : request.url).pathname
      const kind = pathname.replace('/manifest/', '').replace('.json', '')
      return new Response(JSON.stringify({ items: itemsByKind[kind] || [] }), { headers: { 'content-type': 'application/json' } })
    },
  }
}

test('worker write endpoints reject oversized bodies with 413', async () => {
  const big = JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', pad: 'x'.repeat(8 * 1024) })
  const like = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: big,
  }), { TURNSTILE_SECRET: 'configured' }, context())
  assert.equal(like.status, 413)
  assert.equal((await like.json()).error, 'payload-too-large')
  const bigTelemetry = JSON.stringify({ kind: 'heartbeat', visitor: 'visitor-abcdef1234567890', pad: 'x'.repeat(32 * 1024) })
  const telemetry = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: bigTelemetry,
  }), { DB: { prepare: () => ({ run: async () => ({}) }) } }, context())
  assert.equal(telemetry.status, 413)
})

test('worker write endpoints reject oversized streamed bodies without content-length', async () => {
  const big = JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', pad: 'x'.repeat(8 * 1024) })
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(big)); controller.close() } })
  const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: stream,
    duplex: 'half',
  }), { TURNSTILE_SECRET: 'configured' }, context())
  assert.equal(response.status, 413)
})

test('worker write endpoints reject assets missing from the published manifests', async () => {
  const db = { prepare: () => { throw new Error('DB must not be touched for unknown assets') } }
  const assets = manifestAssets({ skin: [{ id: 'harbor' }] })
  const like = await worker.fetch(new Request('https://dsh-market.com/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'skin', asset_id: 'not-published', device_fp: '0123456789abcdef' }),
  }), { TURNSTILE_SECRET: 'configured', DB: db, ASSETS: assets }, context())
  assert.equal(like.status, 400)
  assert.equal((await like.json()).error, 'unknown-asset')
  const install = await worker.fetch(new Request('https://dsh-market.com/api/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'skin', asset_id: 'not-published', device_fp: '0123456789abcdef', install_id: 'install-1-abcdef1234567890' }),
  }), { TURNSTILE_SECRET: 'configured', DB: db, ASSETS: assets }, context())
  assert.equal(install.status, 400)
  assert.equal((await install.json()).error, 'unknown-asset')
})

test('worker accepts a like for a manifest-listed asset and caches the allowlist', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: 'market-like', hostname: 'dsh-market.com' }))
  try {
    let manifestReads = 0
    const assets = {
      async fetch(request) {
        manifestReads += 1
        const pathname = request instanceof URL ? request.pathname : new URL(typeof request === 'string' ? request : request.url).pathname
        const items = pathname === '/manifest/skins.json' ? [{ id: 'harbor' }] : []
        return new Response(JSON.stringify({ items }), { headers: { 'content-type': 'application/json' } })
      },
    }
    const db = {
      prepare: (sql) => ({ bind: () => ({ sql }) }),
      batch: async () => [{ results: [] }, { results: [] }, { results: [{ votes: 3 }] }],
    }
    const post = () => worker.fetch(new Request('https://dsh-market.com/api/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'skin', asset_id: 'harbor', device_fp: '0123456789abcdef', turnstile_token: 'token-1' }),
    }), { TURNSTILE_SECRET: 'configured', DB: db, ASSETS: assets }, context())
    const first = await post()
    assert.equal(first.status, 200)
    assert.equal((await first.json()).votes, 3)
    const readsAfterFirst = manifestReads
    const second = await post()
    assert.equal(second.status, 200)
    assert.equal(manifestReads, readsAfterFirst, 'allowlist cache must serve the second write within the TTL')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('worker allows writes when the asset manifests are unreadable', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, action: 'market-like', hostname: 'dsh-market.com' }))
  try {
    const assets = { async fetch() { throw new Error('assets down') } }
    const db = {
      prepare: (sql) => ({ bind: () => ({ sql }) }),
      batch: async () => [{ results: [] }, { results: [] }, { results: [{ votes: 1 }] }],
    }
    const response = await worker.fetch(new Request('https://dsh-market.com/api/like', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'skin', asset_id: 'anything', device_fp: '0123456789abcdef', turnstile_token: 'token-1' }),
    }), { TURNSTILE_SECRET: 'configured', DB: db, ASSETS: assets }, context())
    assert.equal(response.status, 200, 'availability rule: manifest outage must not break writes')
  } finally {
    globalThis.fetch = realFetch
  }
})

