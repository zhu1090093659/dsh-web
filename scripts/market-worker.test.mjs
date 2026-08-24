import test from 'node:test'
import assert from 'node:assert/strict'

import worker from '../market/worker/src/index.js'

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
      if (statements.length === 7 && options.summary) return options.summary.map((results) => ({ results }))
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

test('telemetry summary returns aggregates only and prunes old events', async () => {
  const db = telemetryDb({
    summary: [
      [{ day: '2026-05-01', pv: 12, uv: 5 }],
      [{ day: '2026-05-01', pv: 3, uv: 2 }],
      [{ subject: '/', pv: 9 }],
      [{ subject: '@linxin666/dsh-pet', visitors: 2 }],
      [{ subject: '@linxin666/dsh-pet', visitors: 1 }],
      [{ subject: '@linxin666/dsh-pet', channel: 'market', visitors: 1 }],
      [{ subject: '@linxin666/dsh-pet', version: '1.2.3', visitors: 2 }],
    ],
  })
  const response = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary?days=7'), { DB: db }, context())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.site.totals.pv, 12)
  assert.equal(payload.site.daily[0].uv, 5)
  assert.equal(payload.plugins.items[0].item, '@linxin666/dsh-pet')
  assert.equal(payload.plugins.items[0].instances, 2)
  assert.equal(payload.plugins.items[0].active_today, 1)
  assert.equal(payload.plugins.items[0].channels.market, 1)
  assert.equal(payload.plugins.items[0].versions[0].version, '1.2.3')
  assert.equal(db.runs.length, 1)
  assert.match(db.runs[0].sql, /DELETE FROM telemetry_events/)
})

test('telemetry summary enforces the read key only when configured', async () => {
  const db = telemetryDb()
  const open = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary'), { DB: db }, context())
  assert.equal(open.status, 200)

  const lockedEnv = { TELEMETRY_READ_KEY: 's3cret', DB: telemetryDb() }
  const denied = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary'), lockedEnv, context())
  assert.equal(denied.status, 403)
  const wrongKey = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary?key=nope'), lockedEnv, context())
  assert.equal(wrongKey.status, 403)
  const queryOk = await worker.fetch(new Request('https://dsh-market.com/api/telemetry/summary?key=s3cret'), lockedEnv, context())
  assert.equal(queryOk.status, 200)
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
