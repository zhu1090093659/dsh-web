import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import worker from '../market/worker/src/index.js'
import {
  CF_API_BUDGET_MAX,
  CF_API_BUDGET_WINDOW_MS,
  CF_API_COOLDOWN_MS,
  CF_RATE_LIMIT_RETRY_AFTER_MS,
  CF_RETRY_AFTER_MS,
  LEASE_CONVERGED_TTL_MS,
  LEASE_PRUNE_MAX_PER_TICK,
  LEASE_TOKEN_TTL_MS,
  LEASE_TTL_MS,
  RELAY_BRIDGE_CREDENTIAL,
  RELAY_BRIDGE_ENDPOINT,
  leaseIngress,
  pruneRelayLeases,
  resetCfApiCooldown,
} from '../market/worker/src/relay-control.js'
import {
  RATE_LIMIT_RETENTION_MS,
  REGISTER_MAX_PER_ID,
  REGISTER_WINDOW_MS,
  pruneRelay,
} from '../market/worker/src/relay.js'

// The account cooldown is isolate-local module state, so one case's 429 must not
// decide another case's upstream calls: every case starts with an open gate.
beforeEach(() => resetCfApiCooldown())

const ID = 'abcd1234abcd1234'
const HOST = ID + '.dsh-market.com'
const OTHER_ID = '0123456789abcdef'
const OTHER_HOST = OTHER_ID + '.dsh-market.com'
const SECRET = 'A'.repeat(43)
const DAY_MS = 24 * 60 * 60 * 1000

/** The stored hash of one secret, for rows seeded without a claim. */
async function sha256Of(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
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

/**
 * The columns one SELECT names. D1 answers with a projection of the row it read
 * rather than the row itself, so a field the statement never selected arrives as
 * `undefined` -- and a code path keyed on such a field is dead in production
 * while a double that hands back the whole seeded row keeps it looking alive.
 * The `all()` side of this double has always projected for that reason.
 */
function selectedColumns(sql) {
  const match = /^\s*SELECT\s+(.+?)\s+FROM\s/i.exec(sql)
  if (match === null) return null
  return match[1].split(',').map((column) => column.trim())
}

/** D1 double: lease rows and rate-limit windows in memory, batches applied in order. */
function leaseDb(seed = {}) {
  const leases = new Map(Object.entries(seed.leases || {}))
  const rateLimit = new Map()
  const batches = []
  // Every relay_leases row the worker asked this double to write, in order: a
  // case reads the row the statement bound rather than the map it landed in.
  const leaseWrites = []
  // Every account-budget statement the worker sends, so a case can count the
  // units it spent rather than infer them from the calls that followed.
  const budget = { spends: 0, windowStart: undefined }
  function applyRateLimit(args) {
    const key = args[0] + '|' + args[1]
    rateLimit.set(key, (rateLimit.get(key) || 0) + 1)
  }
  function applyLeaseInsert(args) {
    const previous = leases.get(args[0])
    const row = {
      id: args[0],
      secret_hash: args[1],
      tunnel_id: args[2],
      hostname: args[3],
      origin_port: args[4],
      plugin_version: args[5],
      state: 'active',
      // The upsert never names the column in its DO UPDATE half, so an operator's
      // flip survives a claim; a fresh row records the mode this claim resolved.
      mode: previous ? previous.mode : args[10],
      created_at: previous ? previous.created_at : args[6],
      last_seen_at: args[6],
      // The convergence cache the claim fast path reads back: converged_at and
      // token_at are separate clocks, so the double stores each from its own
      // bound argument rather than assuming they move together.
      converged_at: args[7],
      token_cache: args[8],
      token_at: args[9],
      released_at: undefined,
    }
    leaseWrites.push(row)
    leases.set(args[0], row)
  }
  function statement(sql, args) {
    return {
      sql,
      args,
      async first() {
        if (sql.includes('FROM relay_leases')) {
          const row = leases.get(args[0])
          if (row === undefined) return null
          const columns = selectedColumns(sql)
          if (columns === null) return row
          return Object.fromEntries(columns.map((column) => [column, row[column]]))
        }
        // The account-budget counter: one write that increments and returns the
        // new total, which is the statement the worker really sends.
        if (sql.includes('INSERT INTO relay_rate_limit') && sql.includes('RETURNING count')) {
          budget.spends += 1
          budget.windowStart = args[1]
          const key = args[0] + '|' + args[1]
          const total = (rateLimit.get(key) || 0) + 1
          rateLimit.set(key, total)
          return { count: total }
        }
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
    budget,
    batches,
    leaseWrites,
    prepare(sql) { return { bind: (...args) => statement(sql, rejectUnbindable(args)) } },
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

/**
 * The Worker secrets the real client builds itself from, plus the quick transport.
 * Every case that drives the real Cloudflare client is about the tunnel half
 * (convergence, the budget gate, the cooldown), which is what the deployment-wide
 * RELAY_MODE rollback selects; the bridge default has its own cases below.
 */
const CF_SECRETS = { CF_API_TOKEN: 'scoped-relay-token', CF_ACCOUNT_ID: 'account-id', CF_ZONE_ID: 'zone-id', RELAY_MODE: 'quick' }

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
    // No convergence cache: a row this old never answered the fast path.
    converged_at: null,
    token_cache: null,
    token_at: null,
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

/**
 * The account API answers a converging claim once the gate has opened again:
 * find-or-create the tunnel, write its ingress, find-or-create the CNAME and
 * read the connector token. Routed by URL, which is the stub's second argument,
 * so the case counts paths rather than an order it would have to restate.
 */
function convergeReply(callNumber, url) {
  if (url.includes('/cfd_tunnel?')) return cfReply(200, undefined, [])
  if (url.endsWith('/cfd_tunnel')) return cfReply(200, undefined, { id: 'tunnel-recovered-1', name: 'dsh-relay-' + ID })
  if (url.endsWith('/configurations')) return cfReply(200, undefined, {})
  if (url.includes('/dns_records?')) return cfReply(200, undefined, [])
  if (url.endsWith('/dns_records')) return cfReply(200, undefined, { id: 'record-recovered-1' })
  if (url.endsWith('/token')) return cfReply(200, undefined, 'connector-token-recovered-1')
  return cfReply(500, 'unexpected account call ' + url)
}

/**
 * Close the gate the way production does: one claim whose very first account
 * call meets the spent budget. Returns that claim and how many calls it cost,
 * so a case can prove the cooldown was armed by a real 429 and not by a flag.
 */
async function armCooldown(env = { DB: leaseDb(), ...CF_SECRETS }) {
  return await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const response = await claim(env)
    return { response, calls: calls.length }
  })
}

test('claim creates the tunnel, its ingress, the CNAME and answers the lease', async () => {
  const db = leaseDb()
  const api = cloudflare()
  const response = await claim({ DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.mode, 'quick', 'the deployment-wide rollback keeps answering the quick mode')
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
  // The quick transport is the deployment-wide rollback now, so a case that wants
  // it asks for it explicitly; a fresh row records whatever this claim ran in.
  const response = await claim({ DB: leaseDb(), CF_RELAY_API: api, RELAY_MODE: 'quick' })
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

/**
 * A lease row that already converged: what a client leaves behind after one
 * successful claim, and what the fast path reads back.
 */
async function convergedRow({ convergedAt = Date.now(), tokenAt = Date.now(), port = 3080, token = 'connector-token-cached-1' } = {}) {
  return {
    id: ID,
    secret_hash: await sha256Of(SECRET),
    tunnel_id: 'tunnel-uuid-1',
    hostname: HOST,
    origin_port: port,
    plugin_version: '0.4.8',
    state: 'active',
    mode: 'quick',
    created_at: 1,
    last_seen_at: 1,
    converged_at: convergedAt,
    token_cache: token,
    token_at: tokenAt,
  }
}

test('a claim inside the convergence TTL is answered from the row with zero account calls', async () => {
  // The token was read a second before this claim, so a renewed stamp would be
  // observable: the fast path must hand the token back on its own clock.
  const tokenAt = Date.now() - 1_000
  const row = await convergedRow({ tokenAt })
  const db = leaseDb({ leases: { [ID]: row } })
  const api = cloudflare()
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    mode: 'quick',
    tunnel: { id: 'tunnel-uuid-1', token: 'connector-token-cached-1' },
    hostname: HOST,
    dns: { target: 'tunnel-uuid-1.cfargotunnel.com' },
    bridge: { endpoint: RELAY_BRIDGE_ENDPOINT, instance: ID, credential: RELAY_BRIDGE_CREDENTIAL },
  }, 'the cached answer carries the same shape a converging claim answered with')
  assert.equal(api.calls.length, 0, 'the steady-state claim dials the account zero times')
  assert.equal(db.budget.spends, 0, 'and spends no account budget either')
  assert.equal(db.leases.get(ID).last_seen_at > 1, true, 'the row is still renewed, so the cron GC leaves it alone')
  assert.equal(db.leases.get(ID).token_at, tokenAt, 'the token clock does not move on a cached claim')

  const again = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(again.status, 200)
  assert.equal(api.calls.length, 0, 'the next claim inside the TTL sends nothing upstream either')
})

test('a lease whose convergence has aged out re-converges without re-reading the token', async () => {
  const stale = await convergedRow({ convergedAt: Date.now() - LEASE_CONVERGED_TTL_MS - 1_000, tokenAt: Date.now() - 1_000 })
  const db = leaseDb({ leases: { [ID]: stale } })
  const api = cloudflare({ tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-1' } })
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.deepEqual(api.names(), ['findTunnel', 'putTunnelConfiguration', 'findDnsRecord', 'createDnsRecord'], 'the account half is re-converged')
  assert.equal(api.names().includes('getTunnelToken'), false, 'the cached token is inside its own, longer window and is not read again')
  assert.equal((await response.json()).tunnel.token, 'connector-token-cached-1', 'the claim answers with the token the row already carried')
  const row = db.leases.get(ID)
  assert.equal(row.converged_at > stale.converged_at, true, 'the re-convergence moves the TTL clock')
  assert.equal(row.token_at, stale.token_at, 'and leaves the token clock where the read put it')
})

test('a claim converges again when the origin port moved', async () => {
  const db = leaseDb({ leases: { [ID]: await convergedRow({ port: 3080 }) } })
  const api = cloudflare({ tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-1' } })
  const response = await claim({ DB: db, CF_RELAY_API: api }, { origin: { port: 3090 } })
  assert.equal(response.status, 200)
  assert.deepEqual(api.names(), ['findTunnel', 'putTunnelConfiguration', 'findDnsRecord', 'createDnsRecord'], 'a moved port rewrites the ingress the account carries')
  assert.deepEqual(api.calls.find((call) => call[0] === 'putTunnelConfiguration')[2][0], {
    hostname: HOST,
    service: 'http://127.0.0.1:3090',
  }, 'the new ingress names the port this claim asked for')
  assert.equal(db.leases.get(ID).origin_port, 3090, 'the row moves to the new port')
})

test('a claim whose cached token aged out reads the token alone, not the account', async () => {
  const db = leaseDb({ leases: { [ID]: await convergedRow({ tokenAt: Date.now() - LEASE_TOKEN_TTL_MS - 1_000 }) } })
  const api = cloudflare({ tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-1' } })
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.deepEqual(api.names(), ['getTunnelToken'], 'one call, not four: the tunnel and the record are still described by the row')
  assert.equal((await response.json()).tunnel.token, 'connector-token-tunnel-uuid-1')
  assert.equal(db.leases.get(ID).token_cache, 'connector-token-tunnel-uuid-1', 'the refreshed token is cached for the next claim')
  assert.equal(db.leases.get(ID).token_at > Date.now() - LEASE_TOKEN_TTL_MS, true, 'and its clock restarts from the refresh')

  api.calls.length = 0
  const next = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(next.status, 200)
  assert.equal(api.calls.length, 0, 'the claim after the refresh is back on the zero-call path')
})

test('a released lease is not answered from the cache', async () => {
  const db = leaseDb({ leases: { [ID]: { ...await convergedRow(), state: 'released' } } })
  const api = cloudflare({ tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-1' } })
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  assert.deepEqual(api.names(), ['findTunnel', 'putTunnelConfiguration', 'findDnsRecord', 'createDnsRecord'], 're-enabling re-converges instead of trusting a released row')
  assert.equal(db.leases.get(ID).state, 'active', 'and the row is active again')
})

test('claim answers the named mode when the control plane flips the switch', async () => {
  const response = await claim({ DB: leaseDb(), CF_RELAY_API: cloudflare(), RELAY_MODE: 'named' })
  assert.equal((await response.json()).mode, 'named')
})

test('a new lease defaults to the bridge transport and creates nothing in the account', async () => {
  const db = leaseDb()
  const api = cloudflare()
  // No RELAY_MODE: the deployment default answers this one.
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.mode, 'bridge', 'a fresh row rides the bridge without being told to')
  assert.equal(body.tunnel, undefined, 'a bridged answer carries no tunnel half')
  assert.equal(body.dns, undefined, 'and no CNAME target')
  assert.equal(body.hostname, HOST)
  assert.equal(body.bridge.endpoint, RELAY_BRIDGE_ENDPOINT)
  assert.equal(api.calls.length, 0, 'the default transport costs zero account calls')
  assert.equal(db.budget.spends, 0, 'and spends no account budget')
  assert.equal(db.leases.get(ID).mode, 'bridge', 'the row records the mode it ran in')
  assert.equal(db.leases.get(ID).tunnel_id, '', 'a bridged lease points at no tunnel')
})

test('a bridge claim commits one lease row with NULL convergence and token columns', async () => {
  // The regression this case guards: bridgedLease once answered a shape that
  // omitted target and token, so the upsert bound `undefined`, D1 refused the
  // whole batch and every claim answered 503 storage-unavailable. The double
  // above refuses a binding the way D1 does, so that shape fails here.
  const db = leaseDb()
  const api = cloudflare()
  const response = await claim({ DB: db, CF_RELAY_API: api })

  assert.equal(response.status, 200, 'the claim commits instead of answering the storage failure')
  assert.equal((await response.json()).mode, 'bridge', 'and it answers the bridge transport')
  assert.equal(db.leaseWrites.length, 1, 'exactly one relay_leases row is written')
  const row = db.leaseWrites[0]
  assert.equal(row.mode, 'bridge', 'the row records the transport the claim ran in')
  assert.equal(row.converged_at, null, 'a bridged claim converges nothing, so the column is NULL and not undefined')
  assert.equal(row.token_cache, null, 'and it caches no connector token')
  assert.equal(row.tunnel_id, '', 'a bridged lease owns no tunnel')
})

test('a row that recorded quick keeps the quick transport under the new default', async () => {
  // Every row written before the default flipped records its own mode, so the
  // default reaches the fleet one instance per claim instead of all at once.
  const db = leaseDb({ leases: { [ID]: { ...await convergedRow(), mode: 'quick' } } })
  const api = cloudflare({ tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-1' } })
  const response = await claim({ DB: db, CF_RELAY_API: api })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.mode, 'quick', 'the row answers for itself')
  assert.equal(body.tunnel.id, 'tunnel-uuid-1', 'and keeps its tunnel half')
  assert.equal(db.leases.get(ID).mode, 'quick', 'a claim never rewrites the recorded mode')
})

test('a second claim converges without recreating the tunnel or the record', async () => {
  const db = leaseDb()
  const api = cloudflare()
  const env = { DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' }
  await claim(env)
  const afterFirst = api.names()
  assert.equal(afterFirst.filter((name) => name === 'createTunnel').length, 1, 'the tunnel is created once')
  assert.equal(afterFirst.filter((name) => name === 'getTunnelToken').length, 1, 'the token is read once and cached on the row')
  const again = await claim(env, { new_secret: undefined })
  assert.equal(again.status, 200)
  assert.deepEqual(api.names(), afterFirst, 'the second claim inside the TTL adds no account call at all')
  assert.equal(api.names().filter((name) => name === 'createDnsRecord').length, 1, 'the CNAME is created once')
})

test('claim repairs a CNAME whose target drifted away from the tunnel', async () => {
  const db = leaseDb()
  const api = cloudflare({
    tunnels: { ['dsh-relay-' + ID]: 'tunnel-uuid-9' },
    records: { [HOST]: { id: 'record-old', name: HOST, content: 'dead-tunnel.cfargotunnel.com', proxied: true } },
  })
  const response = await claim({ DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' })
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
  const env = { DB: db, CF_RELAY_API: cloudflare(), RELAY_MODE: 'quick' }
  for (let i = 0; i < REGISTER_MAX_PER_ID; i++) {
    const response = await claim(env, { new_secret: i === 0 ? SECRET : undefined })
    assert.equal(response.status, 200, 'claim ' + String(i + 1) + ' stays inside the budget')
  }
  const refused = await claim(env)
  assert.equal(refused.status, 429)
  const body = await refused.json()
  assert.equal(body.error, 'rate-limited')
  assert.equal(body.retryAfterMs > 0 && body.retryAfterMs <= REGISTER_WINDOW_MS, true, 'the refusal names when its window turns over')
  assert.equal(REGISTER_MAX_PER_ID, 3, 'the per-id budget is one explicit constant, sized for a claim per tunnel start')
  assert.equal(REGISTER_WINDOW_MS, 300_000, 'and counted over the window Cloudflare counts the account budget over')
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
  const response = await claim({ DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' })
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
  const response = await claim({ DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' })
  assert.equal(response.status, 502)
  assert.equal(db.leases.size, 0)
})

test('release marks the lease released and keeps the tunnel and the record', async () => {
  const api = cloudflare()
  const db = leaseDb()
  const env = { DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' }
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
  const env = { DB: db, CF_RELAY_API: api, RELAY_MODE: 'quick' }
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

test('a spent account budget cools the account and the next claim sends nothing upstream', async () => {
  const db = leaseDb()
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const refused = await claim({ DB: db, ...CF_SECRETS })
    const refusedBody = await refused.json()
    const armedCalls = calls.length
    const cooled = await claim({ DB: db, ...CF_SECRETS })
    return {
      refusedStatus: refused.status,
      refusedBody,
      armedCalls,
      cooledStatus: cooled.status,
      cooledBody: await cooled.json(),
      totalCalls: calls.length,
    }
  })
  assert.equal(CF_API_COOLDOWN_MS, 60_000, 'the cooldown is one explicit constant')
  assert.ok(CF_API_COOLDOWN_MS < CF_RATE_LIMIT_RETRY_AFTER_MS, 'the gate reopens well inside the window the caller is told to wait out')
  assert.equal(outcome.refusedStatus, 502, 'the claim that meets the spent budget answers as before')
  assert.equal(outcome.refusedBody.error, 'cf-api-rate-limited', 'that first answer keeps its grade')
  assert.equal(outcome.armedCalls, 1, 'the refused find is the whole spend of the first claim')
  assert.equal(outcome.cooledStatus, 502, 'a cooled claim keeps the status the endpoint answered with before')
  assert.deepEqual(outcome.cooledBody, { ok: false, error: 'cf-api-rate-limited', retryAfterMs: CF_RATE_LIMIT_RETRY_AFTER_MS })
  assert.equal(outcome.totalCalls, outcome.armedCalls, 'the cooled claim sends no account call at all')
  assert.equal(db.leases.size, 0, 'a cooled claim leaves no lease row behind')
})

test('a cooled account refuses retire without dialling upstream', async () => {
  const db = leaseDb({ leases: {
    [ID]: { ...staleLease(ID, 'tunnel-stale', Date.now()), secret_hash: await secretHashOf(SECRET) },
  } })
  const arming = await armCooldown()
  assert.equal(arming.calls, 1, 'the cooldown is armed by a real 429, not by a flag')
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const response = await post({ DB: db, ...CF_SECRETS }, 'retire')
    return { status: response.status, body: await response.json(), calls: calls.length }
  })
  assert.equal(outcome.status, 502)
  assert.deepEqual(outcome.body, { ok: false, error: 'cf-api-rate-limited', retryAfterMs: CF_RATE_LIMIT_RETRY_AFTER_MS })
  assert.equal(outcome.calls, 0, 'a cooled retire sends no account call at all')
  assert.equal(db.leases.size, 1, 'a refused retire keeps the only pointer to the tunnel')
  assert.equal(db.leases.get(ID).tunnel_id, 'tunnel-stale', 'the row still names the object it owns')
})

test('a cooled account ends the cron GC at once with no account call', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: {
    [ID]: staleLease(ID, 'tunnel-stale', now),
    [OTHER_ID]: staleLease(OTHER_ID, 'tunnel-other', now),
  } })
  const arming = await armCooldown()
  assert.equal(arming.calls, 1, 'the cooldown is armed by a real 429, not by a flag')
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const result = await pruneRelayLeases({ DB: db, ...CF_SECRETS })
    return { result, calls: calls.length }
  })
  assert.deepEqual(outcome.result, { pruned: 0, rateLimited: true }, 'the tick reports the spent budget it did not have to meet')
  assert.equal(outcome.calls, 0, 'a cooled tick sends no account call at all')
  assert.equal(db.leases.size, 2, 'both stale rows keep their tunnel ids for the next tick')
})

test('a claim dials the account again once the cooldown has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000 })
  const db = leaseDb()
  const env = { DB: db, ...CF_SECRETS }
  const armed = await withCfStub(RATE_LIMITED_REPLY, () => claim(env))
  assert.equal(armed.status, 502, 'the spent budget is met while the gate is open')
  t.mock.timers.tick(CF_API_COOLDOWN_MS - 1)
  const cooled = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const response = await claim(env)
    return { status: response.status, calls: calls.length }
  })
  assert.equal(cooled.status, 502)
  assert.equal(cooled.calls, 0, 'the gate holds for the whole cooldown, and a cooled attempt does not extend it')
  t.mock.timers.tick(1)
  const recovered = await withCfStub(convergeReply, async (calls) => {
    const response = await claim(env)
    return { status: response.status, body: await response.json(), calls: calls.length }
  })
  assert.equal(recovered.status, 200, 'the claim succeeds once the cooldown has passed')
  assert.equal(recovered.calls, 6, 'the recovered claim dials the account again: find, create, ingress, record, record, token')
  assert.equal(recovered.body.tunnel.id, 'tunnel-recovered-1')
  assert.equal(recovered.body.tunnel.token, 'connector-token-recovered-1')
  assert.equal(recovered.body.dns.target, 'tunnel-recovered-1.cfargotunnel.com')
  assert.equal(db.leases.get(ID).tunnel_id, 'tunnel-recovered-1', 'the recovered claim writes its lease row')
})

test('a bridged claim still succeeds while the account is cooling down', async () => {
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
  const arming = await armCooldown()
  assert.equal(arming.calls, 1, 'the cooldown is armed by a real 429, not by a flag')
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    // No RELAY_MODE here: the row's own 'bridge' is what this case is about, and
    // the deployment-wide switch would override it.
    const response = await claim({ DB: db, ...CF_SECRETS, RELAY_MODE: undefined })
    return { status: response.status, body: await response.json(), calls: calls.length }
  })
  assert.equal(outcome.status, 200, 'the gate guards the account, not a claim that owns no account object')
  assert.deepEqual(outcome.body, {
    mode: 'bridge',
    hostname: HOST,
    bridge: { endpoint: RELAY_BRIDGE_ENDPOINT, instance: ID, credential: RELAY_BRIDGE_CREDENTIAL },
  })
  assert.equal(outcome.calls, 0, 'a bridged claim sends no account call, cooled or not')
  assert.equal(db.leases.get(ID).state, 'active', 'the bridged lease is renewed as usual')
  assert.equal(db.leases.get(ID).tunnel_id, '', 'the cooled gate does not invent a tunnel for a bridged lease')
})

test('an upstream outage does not cool the account', async () => {
  const db = leaseDb()
  const outcome = await withCfStub(() => cfReply(503, 'server unavailable'), async (calls) => {
    const first = await claim({ DB: db, ...CF_SECRETS })
    const firstBody = await first.json()
    const afterFirst = calls.length
    const second = await claim({ DB: db, ...CF_SECRETS })
    return { firstStatus: first.status, firstBody, afterFirst, secondStatus: second.status, afterSecond: calls.length }
  })
  assert.equal(outcome.firstStatus, 502)
  assert.equal(outcome.firstBody.error, 'cf-api-unavailable', 'an outage keeps its own grade and its short hint')
  assert.equal(outcome.firstBody.retryAfterMs, CF_RETRY_AFTER_MS)
  assert.equal(outcome.afterFirst, 1)
  assert.equal(outcome.secondStatus, 502)
  assert.equal(outcome.afterSecond, 2, 'only a 429 closes the gate: the next claim still dials the account')
})

test('a cooled gate never short-circuits authentication', async () => {
  const db = leaseDb({ leases: {
    [ID]: { ...staleLease(ID, 'tunnel-stale', Date.now()), secret_hash: await secretHashOf(SECRET) },
  } })
  const arming = await armCooldown()
  assert.equal(arming.calls, 1, 'the cooldown is armed by a real 429, not by a flag')
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const refusedClaim = await claim({ DB: db, ...CF_SECRETS }, { secret: 'B'.repeat(43), new_secret: undefined })
    const refusedRetire = await post({ DB: db, ...CF_SECRETS }, 'retire', { secret: 'B'.repeat(43) })
    return {
      claimStatus: refusedClaim.status,
      claimBody: await refusedClaim.json(),
      retireStatus: refusedRetire.status,
      calls: calls.length,
    }
  })
  assert.equal(outcome.claimStatus, 403, 'a cooled claim still proves the secret before it grades anything')
  assert.equal(outcome.claimBody.error, 'auth-failed')
  assert.equal(outcome.retireStatus, 403, 'a cooled retire too')
  assert.equal(outcome.calls, 0, 'and neither of them dials the account')
  assert.equal(db.leases.size, 1, 'the refused pair removes nothing')
})

/** The budget bucket one window of the account gate is counted in. */
const BUDGET_KEY = 'cf:api|' + String(Math.floor(Date.now() / CF_API_BUDGET_WINDOW_MS) * CF_API_BUDGET_WINDOW_MS)

test('the account budget gate refuses the call that would exceed it and sends nothing upstream', async () => {
  const db = leaseDb()
  db.rateLimit.set(BUDGET_KEY, CF_API_BUDGET_MAX)
  const outcome = await withCfStub(convergeReply, async (calls) => {
    const response = await claim({ DB: db, ...CF_SECRETS })
    return { status: response.status, body: await response.json(), urls: calls.map((call) => call.url) }
  })
  assert.equal(CF_API_BUDGET_MAX, 600, 'the gate stops at half of the account 1200-call window')
  assert.equal(outcome.status, 502, 'the endpoint keeps the status it answered with before')
  assert.equal(outcome.body.error, 'cf-api-rate-limited', 'a spent budget keeps its own grade')
  assert.equal(outcome.body.retryAfterMs, CF_RATE_LIMIT_RETRY_AFTER_MS)
  assert.deepEqual(outcome.urls, [], 'the gate refuses before the fetch: zero account calls')
  assert.equal(db.budget.spends, 1, 'the refused attempt is still counted, so a retry storm cannot outrun the gate')
  assert.equal(db.leases.size, 0, 'and no lease row is left behind')
})

test('the account budget gate admits the call that reaches its ceiling and refuses the next one', async () => {
  const db = leaseDb()
  db.rateLimit.set(BUDGET_KEY, CF_API_BUDGET_MAX - 1)
  const outcome = await withCfStub(convergeReply, async (calls) => {
    const response = await claim({ DB: db, ...CF_SECRETS })
    return { status: response.status, body: await response.json(), calls: calls.length }
  })
  assert.equal(outcome.status, 502, 'the budget is spent after the ceiling call, so the claim stops on its next one')
  assert.equal(outcome.body.error, 'cf-api-rate-limited')
  assert.equal(outcome.calls, 1, 'exactly the ceiling call went upstream, and the one after it did not')
  assert.equal(db.budget.spends, 2, 'both the admitted and the refused attempt are counted')
})

test('the account budget gate admits a whole convergence while the window has room', async () => {
  const db = leaseDb()
  db.rateLimit.set(BUDGET_KEY, CF_API_BUDGET_MAX - 6)
  const outcome = await withCfStub(convergeReply, async (calls) => {
    const response = await claim({ DB: db, ...CF_SECRETS })
    return { status: response.status, calls: calls.length }
  })
  assert.equal(outcome.status, 200, 'a claim inside the budget still converges')
  assert.equal(outcome.calls, 6, 'with the full account round trip')
  assert.equal(db.budget.spends, 6, 'each of the six calls spent one unit of the window')
  assert.equal(db.rateLimit.get(BUDGET_KEY), CF_API_BUDGET_MAX, 'the window lands exactly on the ceiling')
})

test('a spent account budget refuses the cron GC before it dials', async () => {
  const now = Date.now()
  const db = leaseDb({ leases: { [ID]: staleLease(ID, 'tunnel-stale', now) } })
  db.rateLimit.set(BUDGET_KEY, CF_API_BUDGET_MAX)
  const outcome = await withCfStub(RATE_LIMITED_REPLY, async (calls) => {
    const result = await pruneRelayLeases({ DB: db, ...CF_SECRETS })
    return { result, calls: calls.length }
  })
  assert.deepEqual(outcome.result, { pruned: 0, rateLimited: true })
  assert.equal(outcome.calls, 0, 'the lease GC honours the same gate as the claim path')
  assert.equal(db.leases.has(ID), true, 'the row keeps its tunnel id for the next tick')
})

test('the rate-limit GC drops windows past the retention and keeps the current ones', async () => {
  const now = Date.now()
  const rows = [
    { bucket: 'id:' + ID, windowStart: now - RATE_LIMIT_RETENTION_MS - 1_000, count: 3 },
    { bucket: 'cf:api', windowStart: now - RATE_LIMIT_RETENTION_MS - 1_000, count: 42 },
    { bucket: 'id:' + OTHER_ID, windowStart: now - 1_000, count: 1 },
  ]
  const deletes = []
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          rejectUnbindable(args)
          return {
            sql,
            args,
            async run() { return { meta: { changes: 0 } } },
            async first() { return null },
            async all() { return { results: [] } },
          }
        },
      }
    },
    async batch(statements) {
      return statements.map((statement) => {
        if (statement.sql.includes('DELETE FROM relay_rate_limit')) {
          deletes.push({ sql: statement.sql, cutoff: statement.args[0] })
          return { meta: { changes: rows.filter((row) => row.windowStart < statement.args[0]).length } }
        }
        return { meta: { changes: 0 } }
      })
    },
  }
  await pruneRelay({ DB: db })
  assert.equal(RATE_LIMIT_RETENTION_MS, 3 * REGISTER_WINDOW_MS, 'three windows of history is the retention')
  assert.equal(deletes.length, 1, 'the rate-limit cleanup is one statement, not a loop')
  assert.equal(deletes[0].cutoff, now - RATE_LIMIT_RETENTION_MS, 'the cutoff is the retention window, not a hard-coded day')
  const survivors = rows.filter((row) => row.windowStart >= deletes[0].cutoff)
  assert.deepEqual(survivors.map((row) => row.bucket), ['id:' + OTHER_ID], 'only windows inside the retention survive')
})

/** The stored hash of one secret, for seeded rows. */
async function secretHashOf(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
