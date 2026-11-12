import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'

import worker from '../market/worker/src/index.js'
import { REGISTER_MAX_PER_ID, relayIdOf } from '../market/worker/src/relay.js'

const RELAY_HOST = 'abcd1234abcd1234.dsh-market.com'
const SECRET = 'A'.repeat(43)
const TARGET = 'https://minted-tunnel-name.trycloudflare.com'

/** One gzip member of the given text, as the tunneled host sends it. */
function gzipped(text) {
  return gzipSync(Buffer.from(text, 'utf8'))
}

function context() { return { waitUntil() {} } }

/**
 * The binding rules real D1 applies before a statement ever runs, read off the
 * runtime that serves it: workerd's D1PreparedStatement.bind maps every value
 * through number / string / boolean / null / byte array / ArrayBuffer view and
 * throws D1_TYPE_ERROR for anything else. `undefined` is one of those
 * refusals, so a double that accepts it is more permissive than the database it
 * stands in for -- which is how a lease upsert binding a missing field reached
 * production as a 503 instead of failing here. `null` is a supported binding
 * and stays legal.
 */
function rejectUnbindable(args) {
  for (const value of args) {
    const type = typeof value
    if (type === 'number' || type === 'string' || type === 'boolean') continue
    if (value === null) continue
    if (Array.isArray(value) && value.every((byte) => typeof byte === 'number' && byte >= 0 && byte < 256)) continue
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) continue
    throw new Error("D1_TYPE_ERROR: Type '" + type + "' not supported for value '" + String(value) + "'")
  }
  return args
}

/** D1 mock keyed by table: registrations and rate-limit rows in memory. */
function relayDb(seed = {}) {
  const registrations = new Map(Object.entries(seed.registrations || {}))
  const rateLimit = new Map()
  const stmtFor = (sql, args) => {
    const s = { sql, args }
    s.bind = (...a) => ({ sql, args: a, get bound() { return s.boundArgs = a } })
    return {
      bind(...bindArgs) {
        rejectUnbindable(bindArgs)
        return {
          sql, args: bindArgs,
          async first() { return firstOf(sql, bindArgs) },
          async run() { return apply(sql, bindArgs) },
          async all() { return { results: rowsOf(sql, bindArgs) } },
        }
      },
    }
  }
  function firstOf(sql, args) {
    if (sql.includes('FROM relay_registrations')) return registrations.get(args[0]) || null
    return null
  }
  function rowsOf(sql, args) {
    if (sql.includes('FROM relay_rate_limit')) {
      const row = rateLimit.get(args[0] + '|' + args[1])
      return row ? [{ count: row }] : []
    }
    return []
  }
  function apply(sql, args) {
    if (sql.includes('INSERT INTO relay_registrations')) {
      const prev = registrations.get(args[0])
      registrations.set(args[0], {
        id: args[0], secret_hash: args[1], target: args[2],
        registered_at: prev ? prev.registered_at : args[3], last_seen_at: args[3],
      })
      return {}
    }
    if (sql.includes('DELETE FROM relay_registrations')) return { meta: { changes: registrations.delete(args[0]) ? 1 : 0 } }
    if (sql.includes('INSERT INTO relay_rate_limit')) {
      const key = args[0] + '|' + args[1]
      rateLimit.set(key, (rateLimit.get(key) || 0) + 1)
      return {}
    }
    return {}
  }
  return {
    registrations,
    rateLimit,
    prepare(sql) { return stmtFor(sql) },
    async batch(statements) {
      const out = []
      for (const stmt of statements) {
        const args = stmt.args
        if (stmt.sql.includes('SELECT count FROM relay_rate_limit')) {
          const row = rateLimit.get(args[0] + '|' + args[1])
          out.push({ results: row !== undefined ? [{ count: row }] : [] })
        } else if (stmt.sql.includes('SELECT secret_hash FROM relay_registrations')) {
          out.push({ results: [] })
        } else {
          await apply(stmt.sql, args)
          out.push({ results: [] })
        }
      }
      return out
    },
  }
}

const register = (db, body, headers = {}) => worker.fetch(new Request('https://dsh-market.com/api/relay/register', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
  body: JSON.stringify(body),
}), { DB: db }, context())

const proxy = (db, path = '/', init = {}) => worker.fetch(new Request('https://' + RELAY_HOST + path, init), { DB: db }, context())

test('relay id extraction accepts only well-formed single-label subdomains', () => {
  assert.equal(relayIdOf(new URL('https://' + RELAY_HOST + '/x')), 'abcd1234abcd1234')
  assert.equal(relayIdOf(new URL('https://dsh-market.com/')), undefined)
  assert.equal(relayIdOf(new URL('https://a.b.dsh-market.com/')), undefined, 'two-level hostnames are rejected (no universal-ssl coverage)')
  assert.equal(relayIdOf(new URL('https://abcd1234abcd1234.t.dsh-market.com/')), undefined, 'the old two-level relay shape is rejected')
  assert.equal(relayIdOf(new URL('https://UPPERCASE123456.dsh-market.com/')), undefined)
  assert.equal(relayIdOf(new URL('https://short.dsh-market.com/')), undefined)
  assert.equal(relayIdOf(new URL('https://dsh-relay.dsh-market.com/')), undefined)
})

test('relay registration mints and refreshes with secret-hash auth', async () => {
  const db = relayDb()
  const mint = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, new_secret: SECRET, target: TARGET })
  assert.equal(mint.status, 200)
  assert.ok(db.registrations.get('abcd1234abcd1234').secret_hash !== SECRET, 'only the hash is stored')
  const refresh = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, target: 'https://other.trycloudflare.com' })
  assert.equal(refresh.status, 200)
  assert.equal(db.registrations.get('abcd1234abcd1234').target, 'https://other.trycloudflare.com')
})

test('relay registration rejects wrong secrets and bad targets', async () => {
  const db = relayDb({ registrations: { abcd1234abcd1234: { secret_hash: 'existing' } } })
  const wrongSecret = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, target: TARGET })
  assert.equal(wrongSecret.status, 403)
  const evilTarget = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, new_secret: SECRET, target: 'https://evil.example.com' })
  assert.equal(evilTarget.status, 400)
  const innerPath = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, new_secret: SECRET, target: 'https://x.trycloudflare.com/steal' })
  assert.equal(innerPath.status, 400)
  const badId = await register(db, { id: 'NOPE', secret: SECRET, new_secret: SECRET, target: TARGET })
  assert.equal(badId.status, 400)
})

test('relay proxy forwards to the registered target with a rewritten Host', async () => {
  const realFetch = globalThis.fetch
  let seen
  globalThis.fetch = async (request) => {
    seen = { url: request.url, host: request.headers.get('host'), method: request.method, body: await request.text() }
    return new Response('upstream-body', { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  try {
    const db = relayDb({ registrations: { abcd1234abcd1234: { secret_hash: 'x', target: TARGET } } })
    const response = await proxy(db, '/api/pair/status', { method: 'GET', headers: { host: RELAY_HOST, cookie: 'dsh-pair-device=abc' } })
    assert.equal(await response.text(), 'upstream-body')
    assert.equal(seen.url, TARGET + '/api/pair/status')
    assert.equal(seen.host, new URL(TARGET).host, 'the origin sees its own tunnel host')
    assert.equal(seen.method, 'GET')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('relay proxy decompresses a gzip body the origin never declared', async () => {
  // Given an origin that answers a login refusal as gzip bytes under no
  // content-encoding, the shape issue #2030 measured through the relay
  const refusal = 'dsh web authentication required; reopen the URL printed by dsh web.'
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(gzipped(refusal), {
    status: 401,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
  try {
    const db = relayDb({ registrations: { abcd1234abcd1234: { secret_hash: 'x', target: TARGET } } })

    // When a phone asks for the page through the relay
    const response = await proxy(db, '/', { method: 'GET', headers: { host: RELAY_HOST, 'accept-encoding': 'gzip' } })

    // Then the hop hands on text it declared as text, not compressed bytes
    // under a header that promises plain text
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('content-encoding'), null)
    assert.equal(response.headers.get('cache-control'), 'no-transform')
    assert.equal(await response.text(), refusal)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('relay proxy adds immutable caching to hashed build assets only', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('asset-body', {
    status: 200,
    headers: { 'content-type': 'text/javascript; charset=utf-8' },
  })
  try {
    const db = relayDb({ registrations: { abcd1234abcd1234: { secret_hash: 'x', target: TARGET } } })

    // The tunneled instance sends no cache headers at all; the relay is the only
    // place a hashed build asset can be given permission to stay on the client.
    const hashed = await proxy(db, '/assets/index-5SrrfWpU.js', { method: 'GET', headers: { host: RELAY_HOST } })
    assert.equal(hashed.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(hashed.headers.get('content-type'), 'text/javascript; charset=utf-8', 'origin headers survive')
    assert.equal(await hashed.text(), 'asset-body', 'the body passes through unchanged')

    // Nested chunk paths carry the hash too (langs/fonts live one level down).
    const chunk = await proxy(db, '/assets/langs/cpp-DIPi6g--.js', { method: 'GET', headers: { host: RELAY_HOST } })
    assert.equal(chunk.headers.get('cache-control'), 'public, max-age=31536000, immutable')

    // Everything else keeps whatever the origin sent — a year-long cache on an
    // unhashed name, an API reply or a document would be wrong.
    const barePaths = ['/assets/favicon.svg', '/assets/manifest.webmanifest', '/api/pair/status', '/']
    const untouched = await Promise.all(barePaths.map((path) =>
      proxy(db, path, { method: 'GET', headers: { host: RELAY_HOST } })))
    untouched.forEach((response, i) => {
      assert.equal(response.headers.get('cache-control'), null, barePaths[i] + ' must keep the origin headers')
    })
  } finally {
    globalThis.fetch = realFetch
  }
})

test('relay proxy never caches a non-200 for a hashed asset path', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('gone', { status: 404 })
  try {
    const db = relayDb({ registrations: { abcd1234abcd1234: { secret_hash: 'x', target: TARGET } } })
    const response = await proxy(db, '/assets/index-5SrrfWpU.js', { method: 'GET', headers: { host: RELAY_HOST } })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), null)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('relay proxy serves a bilingual offline page only to a browser navigation', async () => {
  const db = relayDb()
  const response = await proxy(db, '/', { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } })
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('x-robots-tag'), 'noindex')
  const html = await response.text()
  assert.match(html, /远程实例当前离线/)
  assert.match(html, /currently offline/)
  // A device asks for data, not a document: the same dead id answers the frozen
  // failure body instead (see scripts/market-relay-failure-json.test.mjs).
  const data = await proxy(db, '/some/deep/path')
  assert.equal(data.status, 503)
  assert.equal((await data.json()).code, 'instance-offline')
})

test('relay unregister requires the secret and removes the row', async () => {
  const db = relayDb()
  await register(db, { id: 'abcd1234abcd1234', secret: SECRET, new_secret: SECRET, target: TARGET })
  const deny = await worker.fetch(new Request('https://dsh-market.com/api/relay/unregister', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'abcd1234abcd1234', secret: 'B'.repeat(43) }),
  }), { DB: db }, context())
  assert.equal(deny.status, 403)
  const ok = await worker.fetch(new Request('https://dsh-market.com/api/relay/unregister', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'abcd1234abcd1234', secret: SECRET }),
  }), { DB: db }, context())
  assert.equal(ok.status, 200)
  assert.equal(db.registrations.size, 0)
})

test('relay registration is rate-limited per id window', async () => {
  const db = relayDb()
  // The budget is one explicit constant, so this reads it instead of repeating it.
  for (let i = 0; i < REGISTER_MAX_PER_ID; i++) {
    const response = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, new_secret: SECRET, target: TARGET })
    assert.equal(response.status, 200, 'registration ' + String(i + 1) + ' stays inside the budget')
  }
  const refused = await register(db, { id: 'abcd1234abcd1234', secret: SECRET, target: TARGET })
  assert.equal(refused.status, 429)
  const body = await refused.json()
  assert.equal(body.code, 'rate-limited')
  assert.equal(body.error, 'rate-limited')
})

test('dsh-market.com paths never dispatch to the relay', async () => {
  const response = await worker.fetch(new Request('https://dsh-market.com/api/health'), {}, context())
  assert.equal(response.status, 200)
})