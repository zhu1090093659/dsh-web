import test from 'node:test'
import assert from 'node:assert/strict'

import worker from '../market/worker/src/index.js'
import {
  CF_RATE_LIMIT_RETRY_AFTER_MS,
  CF_RETRY_AFTER_MS,
  LEASE_PRUNE_MAX_PER_TICK,
  LEASE_TTL_MS,
  RELAY_BRIDGE_CREDENTIAL,
  RELAY_BRIDGE_ENDPOINT,
  leaseIngress,
  pruneRelayLeases,
} from '../market/worker/src/relay-control.js'

const ID = 'abcd1234abcd1234'
const HOST = ID + '.dsh-market.com'
const OTHER_ID = '0123456789abcdef'
const OTHER_HOST = OTHER_ID + '.dsh-market.com'
const SECRET = 'A'.repeat(43)
const DAY_MS = 24 * 60 * 60 * 1000

function context() { return { waitUntil() {} } }

/** D1 double: lease rows and rate-limit windows in memory, batches applied in order. */
function leaseDb(seed = {}) {
  const leases = new Map(Object.entries(seed.leases || {}))
  const rateLimit = new Map()
  const batches = []
  function applyRateLimit(args) {
    const key = args[0] + '|' + args[1]
    rateLimit.set(key, (rateLimit.get(key) || 0) + 1)
  }
  function applyLeaseInsert(args) {
    const previous = leases.get(args[0])
    leases.set(args[0], {
      id: args[0],
      secret_hash: args[1],
      tunnel_id: args[2],
      hostname: args[3],
      origin_port: args[4],
      plugin_version: args[5],
      state: 'active',
      // The upsert never names the column, so an operator's flip survives a
      // claim and a fresh row takes the migration's 'quick' default.
      mode: previous ? previous.mode : 'quick',
      created_at: previous ? previous.created_at : args[6],
      last_seen_at: args[6],
      released_at: undefined,
    })
  }
  function statement(sql, args) {
    return {
      sql,
      args,
      async first() {
        if (sql.includes('FROM relay_leases')) return leases.get(args[0]) || null
        return null
      },
      async run() {
        if (sql.includes("UPDATE relay_leases SET state = 'released'")) {
          const row = leases.get(args[0])
          if (row === undefined) return { meta: { changes: 0 } }
          row.state = 'released'
          row.released_at = args[1]
          return { meta: { changes: 1 } }
        }
        if (sql.includes('DELETE FROM relay_leases')) return { meta: { changes: leases.delete(args[0]) ? 1 : 0 } }
        if (sql.includes('INSERT INTO relay_rate_limit')) {
          applyRateLimit(args)
          return {}
        }
        throw new Error('unexpected run: ' + sql)
      },
      async all() {
        if (sql.includes('FROM relay_leases WHERE last_seen_at <')) {
          const cutoff = args[0]
          const stale = [...leases.values()].filter((row) => row.last_seen_at < cutoff).map(({ id, tunnel_id }) => ({ id, tunnel_id }))
          // D1 applies the LIMIT clause, so the double does too: the tick
          // budget is read off the query the worker really sends.
          return { results: sql.includes('LIMIT') ? stale.slice(0, Number(args[1])) : stale }
        }
        throw new Error('unexpected all: ' + sql)
      },
    }
  }
  return {
    leases,
    rateLimit,
    batches,
    prepare(sql) { return { bind: (...args) => statement(sql, args) } },
    async batch(statements) {
      batches.push(statements.map((s) => s.sql))
      return statements.map((s) => {
        if (s.sql.includes('SELECT count FROM relay_rate_limit')) {
          const count = rateLimit.get(s.args[0] + '|' + s.args[1])
          return { results: count === undefined ? [] : [{ count }] }
        }
        if (s.sql.includes('INSERT INTO relay_rate_limit')) {
          applyRateLimit(s.args)
          return { results: [] }
        }
        if (s.sql.includes('INSERT INTO relay_leases')) {
          applyLeaseInsert(s.args)
          return { results: [] }
        }
        throw new Error('unexpected batch statement: ' + s.sql)
      })
    },
  }
}

/**
 * Cloudflare API double: records every call in order and answers with the
 * normalized shapes the lease path consumes. Seeded with an existing tunnel or
 * record to exercise the find side of find-or-create.
 */
function cloudflare(seed = {}) {
  const tunnels = new Map(Object.entries(seed.tunnels || {}))
  const records = new Map(Object.entries(seed.records || {}))
  const calls = []
  let created = 0
  return {
    calls,
    tunnels,
    records,
    names() { return calls.map((call) => call[0]) },
    async findTunnel(name) {
      calls.push(['findTunnel', name])
      const id = tunnels.get(name)
      return id === undefined ? undefined : { id, name }
    },
    async createTunnel(name) {
      calls.push(['createTunnel', name])
      created += 1
      const id = 'tunnel-uuid-' + String(created)
      tunnels.set(name, id)
      return { id, name }
    },
    async putTunnelConfiguration(tunnelId, ingress) {
      calls.push(['putTunnelConfiguration', tunnelId, ingress])
      return {}
    },
    async getTunnelToken(tunnelId) {
      calls.push(['getTunnelToken', tunnelId])
      return 'connector-token-' + tunnelId
    },
    async findDnsRecord(name) {
      calls.push(['findDnsRecord', name])
      return records.get(name)
    },
    async createDnsRecord(record) {
      calls.push(['createDnsRecord', record])
      const stored = { id: 'record-' + record.name, ...record }
      records.set(record.name, stored)
      return stored
    },
    async updateDnsRecord(recordId, record) {
      calls.push(['updateDnsRecord', recordId, record])
      const stored = { id: recordId, ...record }
      records.set(record.name, stored)
      return stored
    },
    async deleteDnsRecord(recordId) {
      calls.push(['deleteDnsRecord', recordId])
      for (const [name, record] of records) if (record.id === recordId) records.delete(name)
      return {}
    },
    async deleteTunnel(tunnelId) {
      calls.push(['deleteTunnel', tunnelId])
      for (const [name, id] of tunnels) if (id === tunnelId) tunnels.delete(name)
      return {}
    },
  }
}

/** One Cloudflare API answer, errors included, shaped the way the account API does. */
function cfReply(status, message, result) {
  const body = status >= 400
    ? { success: false, errors: [{ code: 1000, message }] }
    : { success: true, errors: [], result }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * Run one body against the worker's own Cloudflare client with `fetch`
 * replaced by a recording stub, so a test counts the exact account calls a code
 * path sent rather than trusting a double's bookkeeping. The reply function
 * receives the 1-based call number, which is how a path is made to succeed once
 * and then be refused.
 */
async function withCfStub(reply, body) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init && init.method })
    return reply(calls.length, String(url))
  }
  try {
    return await body(calls)
  } finally {
    globalThis.fetch = original
  }
}

/** The Worker secrets the real client builds itself from. */
const CF_SECRETS = { CF_API_TOKEN: 'scoped-relay-token', CF_ACCOUNT_ID: 'account-id', CF_ZONE_ID: 'zone-id' }

/** The Cloudflare answer when the account request budget is spent (10500). */
const RATE_LIMITED_REPLY = () => cfReply(429, 'More than 1200 requests per 300 seconds reached')

/** The n-th generated lease id: 16 digits, which ID_RE accepts. */
function staleId(index) {
  return String(index).padStart(16, '0')
}

/** A stale lease row, seeded so the cron GC picks it up. */
function staleLease(id, tunnelId, now) {
  return {
    id,
    secret_hash: 'hash',
    tunnel_id: tunnelId,
    hostname: id + '.dsh-market.com',
    origin_port: 3080,
    state: 'active',
    created_at: now - LEASE_TTL_MS - DAY_MS,
    last_seen_at: now - LEASE_TTL_MS - DAY_MS,
  }
}

const claim = (env, body = {}, headers = {}) => worker.fetch(new Request('https://dsh-market.com/api/relay/claim', {
  method: 'PUT',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...headers },
  body: JSON.stringify({ id: ID, secret: SECRET, new_secret: SECRET, origin: { port: 3080 }, plugin: { version: '0.4.8' }, ...body }),
}), env, context())

const post = (env, path, body = {}) => worker.fetch(new Request('https://dsh-market.com/api/relay/' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: ID, secret: SECRET, ...body }),
}), env, context())

test('claim creates the tunnel, its ingress, the CNAME and answers the lease', async () => {
  const db = leaseDb()
  const api = cloudflare()
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.mode, 'quick', 'the additive deployment keeps answering the quick mode')
  assert.equal(body.tunnel.id, 'tunnel-uuid-1')
  assert.equal(body.tunnel.token, 'connector-token-tunnel-uuid-1')
  assert.equal(body.hostname, HOST)
  assert.equal(body.dns.target, 'tunnel-uuid-1.cfargotunnel.com')
  assert.deepEqual(api.calls.find((call) => call[0] === 'putTunnelConfiguration')[2], [
    { hostname: HOST, service: 'http://127.0.0.1:3080' },
    { service: 'http_status:404' },
  ], 'the ingress carries the instance hostname and the required catch-all rule')
  assert.deepEqual(api.records.get(HOST), { id: 'record-' + HOST, type: 'CNAME', name: HOST, content: 'tunnel-uuid-1.cfargotunnel.com', proxied: true })
  const row = db.leases.get(ID)
  assert.equal(row.tunnel_id, 'tunnel-uuid-1')
  assert.equal(row.origin_port, 3080)
  assert.equal(row.plugin_version, '0.4.8')
  assert.equal(row.state, 'active')
})

test('a bridged lease claims without touching the cloudflare account', async () => {
  // A row an operator flipped to the bridge transport, whose data plane is the
  // instance's Durable Object and which therefore owns no Cloudflare object.
  const db = leaseDb({ leases: {
    [ID]: {
      id: ID,
      secret_hash: await secretHashOf(SECRET),
      tunnel_id: '',
      hostname: HOST,
      origin_port: 3080,
      plugin_version: '0.4.8',
      state: 'active',
      mode: 'bridge',
      created_at: 1,
      last_seen_at: 1,
    },
  } })
  const api = cloudflare()
  const env = { DB: db, CF_RELAY_API: api }
  const claimedAt = Date.now()
  const response = await claim(env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    mode: 'bridge',
    hostname: HOST,
    bridge: { endpoint: RELAY_BRIDGE_ENDPOINT, instance: ID, credential: RELAY_BRIDGE_CREDENTIAL },
  }, 'the answer keeps the hostname and the bridge grant, and carries no tunnel block')
  assert.equal(api.calls.length, 0, 'a bridged claim sends no cloudflare call at all')
  const row = db.leases.get(ID)
  assert.equal(row.state, 'active', 'the lease is renewed as usual')
  assert.equal(row.tunnel_id, '', 'a bridged lease points at no tunnel')
  assert.equal(row.last_seen_at >= claimedAt, true, 'the row is seen now, inside the cron GC TTL')

  const again = await claim(env, { new_secret: undefined })
  assert.equal(again.status, 200)
  assert.equal(api.calls.length, 0, 'the next claim does not create the idle tunnel back')
  assert.equal(db.leases.get(ID).mode, 'bridge', 'a claim never undoes the operator flip')
})

test('a quick claim still converges the tunnel, its ingress, the CNAME and the token', async () => {
  const api = cloudflare()
  const response = await claim({ DB: leaseDb(), CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.deepEqual(api.names(), [
    'findTunnel',
    'createTunnel',
    'putTunnelConfiguration',
    'findDnsRecord',
    'createDnsRecord',
    'getTunnelToken',
  ], 'the tunnel transport keeps its exact convergence order')
})

test('claim answers the named mode when the control plane flips the switch', async () => {
  const response = await claim({ DB: leaseDb(), CF_RELAY_API: cloudflare(), RELAY_MODE: 'named' })
  assert.equal((await response.json()).mode, 'named')
})

test('a second claim converges without recreating the tunnel or the record', async () => {
  const db = leaseDb()
  const api = cloudflare()
  const env = { DB: db, CF_RELAY_API: api }
  await claim(env)
  const again = await claim(env, { new_secret: undefined })
  assert.equal(again.status, 200)
  assert.equal(api.names().filter((name) => name === 'createTunnel').length, 1, 'the tunnel is found, never re-created')
  assert.equal(api.names().filter((name) => name === 'createDnsRecord').length, 1, 'the CNAME is found, never re-created')
  assert.equal(api.names().filter((name) => name === 'getTunnelToken').length, 2, 'each claim reads the token once')
})

test('claim repairs a CNAME whose target drifted away from the tunnel', async () => {
  const db = leaseDb()
  const api = cloudflare({
    tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-9' },
    records: { [HOST]: { id: 'record-old', name: HOST, content: 'dead-tunnel.cfargotunnel.com', proxied: true } },
  })
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.equal(api.names().includes('createDnsRecord'), false, 'no second record is created on the same name')
  const updated = api.calls.find((call) => call[0] === 'updateDnsRecord')
  assert.deepEqual(updated[2], { type: 'CNAME', name: HOST, content: 'tunnel-uuid-9.cfargotunnel.com', proxied: true })
  assert.equal(api.records.get(HOST).content, 'tunnel-uuid-9.cfargotunnel.com')
})

test('claim keeps the registry auth and param semantics', async () => {
  const db = leaseDb({ leases: { [ID]: { id: ID, secret_hash: 'owned-by-another-secret', tunnel_id: 'tunnel-x', hostname: HOST, state: 'active' } } })
  const api = cloudflare()
  const wrongSecret = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(wrongSecret.status, 403)
  assert.equal((await wrongSecret.json()).error, 'auth-failed')
  assert.equal(api.calls.length, 0, 'an unauthenticated claim touches nothing in the account')

  const unknown = await claim({ DB: leaseDb(), CF_RELAY_API: api }, { register: false })
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).error, 'unknown-id')

  const noNewSecret = await claim({ DB: leaseDb(), CF_RELAY_API: api }, { new_secret: undefined })
  assert.equal(noNewSecret.status, 400)
  assert.equal((await noNewSecret.json()).error, 'invalid-params')

  const badPort = await claim({ DB: leaseDb(), CF_RELAY_API: api }, { origin: { port: 0 } })
  assert.equal(badPort.status, 400)
  const missingOrigin = await claim({ DB: leaseDb(), CF_RELAY_API: api }, { origin: undefined })
  assert.equal(missingOrigin.status, 400)
  const badId = await claim({ DB: leaseDb(), CF_RELAY_API: api }, { id: 'NOPE' })
  assert.equal(badId.status, 400)
  const badJson = await worker.fetch(new Request('https://dsh-market.com/api/relay/claim', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'not json',
  }), { DB: leaseDb(), CF_RELAY_API: api }, context())
  assert.equal(badJson.status, 400)
})

test('claim is rate limited on the shared per-id window', async () => {
  const db = leaseDb()
  const env = { DB: db, CF_RELAY_API: cloudflare() }
  for (let i = 0; i < 6; i++) {
    const response = await claim(env, { new_secret: i === 0 ? SECRET : undefined })
    assert.equal(response.status, 200, 'claim ' + String(i + 1) + ' stays inside the budget')
  }
  const seventh = await claim(env)
  assert.equal(seventh.status, 429)
  assert.equal((await seventh.json()).error, 'rate-limited')
})

test('an unconfigured worker fails closed without touching the account or D1', async () => {
  const db = leaseDb()
  const response = await claim({ DB: db })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'cf-api-unconfigured')
  assert.equal(db.leases.size, 0, 'no half-written lease row')
  assert.equal(db.rateLimit.size, 0, 'no window spent for a request that never ran')
})

test('an unavailable cloudflare api answers 502 with a retry hint and writes nothing', async () => {
  const db = leaseDb()
  const api = cloudflare()
  api.createTunnel = async () => { throw new Error('cloudflare api POST /accounts/x/cfd_tunnel: server unavailable') }
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.equal(body.error, 'cf-api-unavailable')
  assert.equal(body.retryAfterMs, CF_RETRY_AFTER_MS)
  assert.equal(db.leases.size, 0, 'a failed claim leaves no lease row behind')
  assert.deepEqual([...db.rateLimit.values()], [1, 1], 'the attempt still spends its ip and id windows')
})

test('claim refuses a tunnel token the api did not issue', async () => {
  const db = leaseDb()
  const api = cloudflare()
  api.getTunnelToken = async () => ''
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 502)
  assert.equal(db.leases.size, 0)
})

test('release marks the lease released and keeps the tunnel and the record', async () => {
  const api = cloudflare()
  const db = leaseDb()
  const env = { DB: db, CF_RELAY_API: api }
  await claim(env)
  const before = api.calls.length
  const response = await post(env, 'release')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(api.calls.length, before, 'release never calls the cloudflare api')
  assert.equal(db.leases.get(ID).state, 'released')
  assert.equal(db.leases.get(ID).tunnel_id, 'tunnel-uuid-1', 'the tunnel survives so re-enabling is instant')
  assert.equal(api.records.get(HOST).content, 'tunnel-uuid-1.cfargotunnel.com', 'the hostname survives')
})

test('release and retire require the id secret', async () => {
  const db = leaseDb({ leases: { [ID]: { id: ID, secret_hash: 'owned-by-another-secret', tunnel_id: 'tunnel-x', hostname: HOST, state: 'active' } } })
  const api = cloudflare()
  const env = { DB: db, CF_RELAY_API: api }
  const release = await post(env, 'release')
  assert.equal(release.status, 403)
  const retire = await post(env, 'retire')
  assert.equal(retire.status, 403)
  assert.equal(api.calls.length, 0)
  assert.equal(db.leases.get(ID).state, 'active')
})

test('retire removes the record, then the tunnel, then the row', async () => {
  const api = cloudflare()
  const db = leaseDb()
  const env = { DB: db, CF_RELAY_API: api }
  await claim(env)
  api.calls.length = 0
  const response = await post(env, 'retire')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.deepEqual(api.names(), ['findDnsRecord', 'deleteDnsRecord', 'deleteTunnel'])
  assert.equal(api.records.size, 0)
  assert.equal(api.tunnels.size, 0)
  assert.equal(db.leases.size, 0)
})

test('retire answers 503 without the cloudflare api and keeps the lease', async () => {
  const db = leaseDb({ leases: { [ID]: { id: ID, secret_hash: await secretHashOf(SECRET), tunnel_id: 'tunnel-x', hostname: HOST, state: 'active' } } })
  const response = await post({ DB: db }, 'retire')
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'cf-api-unconfigured')
  assert.equal(db.leases.size, 1, 'the only pointer to the tunnel is kept until it can be removed')
})

test('the cron GC removes the record before the tunnel and keeps fresh leases', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: { id: ID, secret_hash: 'hash', tunnel_id: 'tunnel-stale', hostname: HOST, state: 'active', last_seen_at: now - LEASE_TTL_MS - DAY_MS },
    [OTHER_ID]: { id: OTHER_ID, secret_hash: 'hash', tunnel_id: 'tunnel-fresh', hostname: OTHER_HOST, state: 'active', last_seen_at: now - DAY_MS },
  } })
  const api = cloudflare({
    tunnels: { ['dsh-relay-' + ID]: 'tunnel-stale' },
    records: { [HOST]: { id: 'record-stale', name: HOST, content: 'tunnel-stale.cfargotunnel.com', proxied: true } },
  })
  await pruneRelayLeases({ DB: db, CF_RELAY_API: api })
  assert.deepEqual(api.names(), ['findDnsRecord', 'deleteDnsRecord', 'deleteTunnel'], 'the record goes before the tunnel')
  assert.equal(api.calls[0][1], HOST)
  assert.equal(api.calls[2][1], 'tunnel-stale')
  assert.equal(db.leases.has(ID), false, 'the idle lease is recovered')
  assert.equal(db.leases.has(OTHER_ID), true, 'a lease seen inside the TTL stays')
})

test('the cron GC leaves leases it cannot settle without the cloudflare api', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: { id: ID, secret_hash: 'hash', tunnel_id: 'tunnel-stale', hostname: HOST, state: 'active', last_seen_at: now - LEASE_TTL_MS - DAY_MS },
    [OTHER_ID]: { id: OTHER_ID, secret_hash: 'hash', tunnel_id: undefined, hostname: OTHER_HOST, state: 'released', last_seen_at: now - LEASE_TTL_MS - DAY_MS },
  } })
  const result = await pruneRelayLeases({ DB: db })
  assert.equal(result.pruned, 1)
  assert.equal(db.leases.has(ID), true, 'a tunnel nothing can remove keeps its only pointer')
  assert.equal(db.leases.has(OTHER_ID), false, 'a lease that owns no account resource is dropped')
})

test('claim grades a spent account budget apart from an outage', async () => {
  const db = leaseDb()
  const response = await withCfStub(RATE_LIMITED_REPLY, () => claim({ DB: db, ...CF_SECRETS }))
  assert.equal(response.status, 502, 'the endpoint keeps the status code it answered with before')
  const body = await response.json()
  assert.equal(body.error, 'cf-api-rate-limited')
  assert.equal(body.retryAfterMs, CF_RATE_LIMIT_RETRY_AFTER_MS)
  assert.equal(CF_RATE_LIMIT_RETRY_AFTER_MS, 300_000, 'the hint covers the window Cloudflare counts the budget over')
  assert.ok(CF_RATE_LIMIT_RETRY_AFTER_MS >= CF_RETRY_AFTER_MS * 60, 'the budget hint is minutes, not seconds')
  assert.equal(db.leases.size, 0, 'a refused claim still leaves no lease row behind')
})

test('retire grades a spent account budget apart and keeps the lease', async () => {
  const db = leaseDb({ leases: { [ID]: { ...staleLease(ID, 'tunnel-x', Date.now()), secret_hash: await secretHashOf(SECRET) } } })
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => ({
    response: await post({ DB: db, ...CF_SECRETS }, 'retire'),
    urls: calls.map((call) => call.url),
  }))
  assert.equal(outcome.response.status, 502)
  const body = await outcome.response.json()
  assert.equal(body.error, 'cf-api-rate-limited')
  assert.equal(body.retryAfterMs, CF_RATE_LIMIT_RETRY_AFTER_MS)
  assert.equal(outcome.urls.length, 1, 'the refused lookup ends the retire before any delete')
  assert.equal(db.leases.size, 1, 'a refused retire keeps the only pointer to the tunnel')
})

test('the upstream status, not its message, decides the failure grade', async () => {
  // An outage whose body happens to carry Cloudflare's rate-limit sentence stays
  // an outage, and a 429 whose body says nothing about rates is still the spent
  // budget: the grade reads the status code alone.
  const outageDb = leaseDb()
  const outage = await withCfStub(
    () => cfReply(503, 'More than 1200 requests per 300 seconds reached'),
    () => claim({ DB: outageDb, ...CF_SECRETS }),
  )
  assert.equal(outage.status, 502)
  const outageBody = await outage.json()
  assert.equal(outageBody.error, 'cf-api-unavailable')
  assert.equal(outageBody.retryAfterMs, CF_RETRY_AFTER_MS)

  const budgetDb = leaseDb()
  const budget = await withCfStub(() => cfReply(429, 'internal error'), () => claim({ DB: budgetDb, ...CF_SECRETS }))
  const budgetBody = await budget.json()
  assert.equal(budgetBody.error, 'cf-api-rate-limited')
  assert.equal(budgetBody.retryAfterMs, CF_RATE_LIMIT_RETRY_AFTER_MS)
  assert.equal(budgetDb.leases.size, 0, 'neither grade writes a lease row')
})

test('the cron GC settles at most one tick budget of stale leases', async () => {
  const now = Date.now()
  const seeded = {}
  for (let index = 0; index <= LEASE_PRUNE_MAX_PER_TICK; index++) {
    seeded[staleId(index)] = staleLease(staleId(index), 'tunnel-' + staleId(index), now)
  }
  const db = leaseDb({ leases: seeded })
  const api = cloudflare()
  const result = await pruneRelayLeases({ DB: db, CF_RELAY_API: api })
  assert.equal(LEASE_PRUNE_MAX_PER_TICK, 25, 'the tick budget is one explicit constant')
  assert.equal(result.pruned, LEASE_PRUNE_MAX_PER_TICK)
  assert.equal(result.rateLimited, false)
  assert.equal(db.leases.size, 1, 'rows over the budget wait for the next tick')
  assert.equal(db.leases.has(staleId(LEASE_PRUNE_MAX_PER_TICK)), true, 'the row left over is the one the query did not return')
  assert.equal(api.names().filter((name) => name === 'deleteTunnel').length, LEASE_PRUNE_MAX_PER_TICK, 'no account call is spent on the row left over')
})

test('a spent account budget ends the cron GC at once', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: staleLease(ID, 'tunnel-stale', now),
    [OTHER_ID]: staleLease(OTHER_ID, 'tunnel-other', now),
  } })
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const result = await pruneRelayLeases({ DB: db, ...CF_SECRETS })
    return { result, urls: calls.map((call) => call.url) }
  })
  assert.equal(outcome.result.rateLimited, true)
  assert.equal(outcome.result.pruned, 0)
  assert.equal(outcome.urls.length, 1, 'the refused call ends the tick: the second stale row is never dialled')
  assert.match(outcome.urls[0], /\/zones\/zone-id\/dns_records\?type=CNAME&name=/, 'the tick stopped on the first row it touched')
  assert.equal(db.leases.size, 2, 'both rows keep their tunnel ids for the next tick')
})

test('a budget that runs out mid-row ends the tick without a further call', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: staleLease(ID, 'tunnel-stale', now),
    [OTHER_ID]: staleLease(OTHER_ID, 'tunnel-other', now),
  } })
  const outcome = await withCfStub(
    (callNumber) => callNumber === 1
      ? cfReply(200, undefined, [{ id: 'record-1', type: 'CNAME', name: HOST, content: 'tunnel-stale.cfargotunnel.com', proxied: true }])
      : RATE_LIMITED_REPLY(),
    async (calls) => {
      const result = await pruneRelayLeases({ DB: db, ...CF_SECRETS })
      return { result, urls: calls.map((call) => call.url) }
    },
  )
  assert.equal(outcome.result.rateLimited, true)
  assert.equal(outcome.result.pruned, 0)
  assert.equal(outcome.urls.length, 2, 'the find and the refused delete are the whole spend of the interrupted row')
  assert.match(outcome.urls[1], /\/dns_records\/record-1$/)
  assert.equal(db.leases.size, 2, 'the interrupted row keeps its tunnel id and is retried next tick')
})

test('the cron GC still walks past a row that failed for its own reason', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: staleLease(ID, 'tunnel-stale', now),
    [OTHER_ID]: staleLease(OTHER_ID, 'tunnel-other', now),
  } })
  const api = cloudflare()
  api.deleteTunnel = async (tunnelId) => {
    api.calls.push(['deleteTunnel', tunnelId])
    if (tunnelId === 'tunnel-stale') throw new Error('cloudflare api DELETE /accounts/account-id/cfd_tunnel/tunnel-stale: not found')
    return {}
  }
  const result = await pruneRelayLeases({ DB: db, CF_RELAY_API: api })
  assert.equal(result.rateLimited, false)
  assert.equal(result.pruned, 1)
  assert.equal(db.leases.has(ID), true, 'the row that could not be settled keeps its tunnel id')
  assert.equal(db.leases.has(OTHER_ID), false, 'the next stale row still settles in the same tick')
  assert.equal(api.names().filter((name) => name === 'deleteTunnel').length, 2, 'one row failure does not end the tick')
})

test('the lease helper shapes match the wire contract', () => {
  assert.deepEqual(leaseIngress(ID, 3080), [
    { hostname: HOST, service: 'http://127.0.0.1:3080' },
    { service: 'http_status:404' },
  ])
})

/** The stored hash of one secret, for seeded rows. */
async function secretHashOf(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
