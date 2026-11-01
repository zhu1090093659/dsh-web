/**
 * The relay proxy's failure answers under the frozen contract: one JSON body
 * per failure, `{ok:false,code,message}`, so the App branches on a code, and
 * the offline page kept for browser navigations only.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RELAY_FAILURE_STATUS,
  handleRelayProxy,
  handleRelayRegister,
  relayFailure,
  sha256Hex,
} from '../market/worker/src/relay.js'

const ID = 'abcd1234abcd1234'
const SECRET = 'A'.repeat(43)
const TARGET = 'https://minted-tunnel-name.trycloudflare.com'
const FAILURE_KEYS = ['code', 'message', 'ok']
const STATUSES = {
  'instance-offline': 503,
  'relay-storage-unavailable': 503,
  'connector-replaced': 503,
  'stream-stalled': 504,
  'invalid-registration': 502,
  'rate-limited': 429,
}

/**
 * A D1 stand-in: one registration row, one rate-limit count, and a switch per
 * read the proxy path can make, so every failure point is driven directly.
 */
function fakeDb({ registration, readError = false, modeError = false, rateCount = 0 } = {}) {
  const db = {
    registrationReads: 0,
    modeReads: 0,
    prepare(sql) {
      const statement = { sql, args: [] }
      statement.bind = (...args) => {
        statement.args = args
        return statement
      }
      statement.first = async () => {
        if (sql.includes('FROM relay_registrations')) {
          db.registrationReads += 1
          if (readError) throw new Error('d1 unavailable')
          return registration || null
        }
        if (sql.includes('FROM relay_leases')) {
          db.modeReads += 1
          if (modeError) throw new Error('d1 unavailable')
          return null
        }
        return null
      }
      statement.run = async () => ({})
      return statement
    },
    async batch(statements) {
      return statements.map((statement) => (statement.sql.includes('SELECT count FROM relay_rate_limit')
        ? { results: [{ count: rateCount }] }
        : { results: [] }))
    },
  }
  return db
}

const phone = (init) => new Request('https://' + ID + '.dsh-market.com/api/pair/status', init)

/** Swap the upstream for the duration of one body. */
async function withUpstream(replacement, body) {
  const realFetch = globalThis.fetch
  globalThis.fetch = replacement
  try {
    return await body()
  } finally {
    globalThis.fetch = realFetch
  }
}

/** Collect the operator warnings one body emits instead of printing them. */
async function withWarnings(body) {
  const realWarn = console.warn
  const warnings = []
  console.warn = (line) => {
    warnings.push(String(line))
  }
  try {
    return { value: await body(), warnings }
  } finally {
    console.warn = realWarn
  }
}

test('relay failures answer one frozen code, status and retryable stamp each', async () => {
  // Given the frozen table the App and the connector both branch on
  for (const code of Object.keys(STATUSES)) {
    assert.equal(RELAY_FAILURE_STATUS[code], STATUSES[code], code + ' keeps its frozen status')
  }
  // And no code in the table promises a status outside the 4xx/5xx range
  for (const [code, status] of Object.entries(RELAY_FAILURE_STATUS)) {
    assert.ok(Number.isInteger(status) && status >= 400 && status < 600, code + ' answers an error status')
  }

  // When every code is asked for its answer
  const answers = await Promise.all(Object.keys(STATUSES).map(async (code) => ({
    code,
    response: relayFailure(code),
    body: await relayFailure(code).json(),
  })))

  // Then each answer is exactly the frozen body, at its frozen status
  for (const { code, response, body } of answers) {
    assert.equal(response.status, STATUSES[code], code + ' keeps its frozen status')
    assert.match(response.headers.get('content-type'), /^application\/json/, code + ' is machine-readable')
    assert.equal(response.headers.get('cache-control'), 'no-store', code + ' is never cached')
    assert.deepEqual(Object.keys(body).sort(), FAILURE_KEYS, code + ' carries exactly the frozen fields')
    assert.equal(body.ok, false, code)
    assert.equal(body.code, code)
    assert.ok(body.message.length > 0, code + ' carries a human message')
  }

  // And only a broken registration is not worth retrying
  for (const { code, response } of answers) {
    const expected = code === 'invalid-registration' ? null : '1'
    assert.equal(response.headers.get('x-relay-retryable'), expected, code)
  }
})

test('a dead id answers the offline page to a browser and JSON to a device', async () => {
  // Given a registry that holds no row for this id
  const db = fakeDb()

  // When a browser navigates to it
  const browser = await handleRelayProxy(phone({ method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } }), { DB: db }, ID)

  // Then it still gets the bilingual page
  assert.equal(browser.status, 503)
  assert.match(browser.headers.get('content-type'), /^text\/html/)
  assert.equal(browser.headers.get('x-robots-tag'), 'noindex')
  assert.match(await browser.text(), /currently offline/)

  // When the paired device asks for data instead
  const device = await handleRelayProxy(phone({ method: 'GET', headers: { accept: 'application/json' } }), { DB: db }, ID)

  // Then it gets the frozen offline code and may retry
  assert.equal(device.status, 503)
  assert.match(device.headers.get('content-type'), /^application\/json/)
  assert.equal(device.headers.get('x-relay-retryable'), '1')
  const body = await device.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'instance-offline')
  assert.deepEqual(Object.keys(body).sort(), FAILURE_KEYS)
})

test('the offline page never answers a request that is not a browser navigation', async () => {
  // Given a dead id and four requests that are not a navigation
  const db = fakeDb()
  const cases = [
    { method: 'GET' },
    { method: 'GET', headers: { accept: '*/*' } },
    { method: 'POST', headers: { accept: 'text/html' } },
    { method: 'HEAD', headers: { accept: 'text/html' } },
  ]

  // When each is proxied
  const answers = await Promise.all(cases.map((init) => handleRelayProxy(phone(init), { DB: db }, ID)))

  // Then not one of them receives HTML
  answers.forEach((response, index) => {
    const label = JSON.stringify(cases[index])
    assert.equal(response.status, 503, label)
    assert.match(response.headers.get('content-type'), /^application\/json/, label)
  })
  assert.deepEqual(await Promise.all(answers.map((response) => response.json())).then((bodies) => bodies.map((body) => body.code)),
    cases.map(() => 'instance-offline'))
})

test('a registry read failure answers the frozen storage code even to a browser', async () => {
  // Given D1 that cannot answer the registration lookup
  const db = fakeDb({ readError: true })

  // When a browser asks for the id
  const response = await handleRelayProxy(phone({ method: 'GET', headers: { accept: 'text/html' } }), { DB: db }, ID)

  // Then the answer is the frozen storage failure, not a page about a tunnel
  assert.equal(response.status, 503)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(response.headers.get('x-relay-retryable'), '1')
  assert.equal((await response.json()).code, 'relay-storage-unavailable')
  assert.equal(db.registrationReads, 1)
})

test('an unusable registered target answers the frozen registration code, not retryable', async () => {
  // Given a registration row whose target cannot be parsed
  const db = fakeDb({ registration: { target: 'not-a-url' } })

  // When the proxy resolves it
  const response = await handleRelayProxy(phone(), { DB: db }, ID)

  // Then the answer names the broken registration and does not ask for a retry
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('x-relay-retryable'), null)
  assert.equal((await response.json()).code, 'invalid-registration')
})

test('a mode read that fails keeps the instance on the quick path', async () => {
  // Given a deployment whose lease table cannot answer the mode probe
  let objectCalls = 0
  const bridge = {
    idFromName: () => ID,
    get: () => {
      objectCalls += 1
      throw new Error('the object must not be reached while the mode is unreadable')
    },
  }
  const db = fakeDb({ registration: { target: TARGET }, modeError: true })

  // When a request arrives for that instance
  const response = await withUpstream(
    async () => new Response('tunnel-body', { status: 200, headers: { 'content-type': 'text/plain' } }),
    () => handleRelayProxy(phone(), { DB: db, RELAY_BRIDGE: bridge }, ID),
  )

  // Then the quick tunnel serves it instead of the hop answering a failure
  assert.equal(await response.text(), 'tunnel-body')
  assert.equal(response.headers.get('x-relay-retryable'), null)
  assert.equal(db.modeReads, 1)
  assert.equal(objectCalls, 0)
})

test('an upstream that throws answers the frozen offline code instead of an exception', async () => {
  // Given a registered tunnel that refuses the connection
  const db = fakeDb({ registration: { target: TARGET } })

  // When the proxy forwards to it
  const { value: response, warnings } = await withWarnings(() => withUpstream(
    async () => {
      throw new Error('getaddrinfo ENOTFOUND minted-tunnel-name.trycloudflare.com')
    },
    () => handleRelayProxy(phone(), { DB: db }, ID),
  ))

  // Then the caller reads a code instead of a runtime error page
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('x-relay-retryable'), '1')
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'instance-offline')

  // And the operator keeps the underlying reason
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /proxy-upstream-error/)
  assert.match(warnings[0], /ENOTFOUND/)
})

test('a rate-limited registration answers the frozen code and keeps the legacy error field', async () => {
  // Given a registration whose id window is already spent
  const db = fakeDb({ registration: { secret_hash: await sha256Hex(SECRET) }, rateCount: 7 })

  // When the plugin refreshes its target
  const response = await handleRelayRegister(new Request('https://dsh-market.com/api/relay/register', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ id: ID, secret: SECRET, target: TARGET }),
  }), { DB: db })

  // Then the frozen code is there, and so is the field the plugin reads
  assert.equal(response.status, 429)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(response.headers.get('x-relay-retryable'), '1')
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'rate-limited')
  assert.equal(body.error, 'rate-limited')
  assert.match(body.message, /registration/)
})

test('a registration refusal outside the frozen table keeps its error shape', async () => {
  // Given a registration whose secret does not match the stored hash
  const db = fakeDb({ registration: { secret_hash: await sha256Hex('B'.repeat(43)) } })

  // When the plugin presents the wrong secret
  const response = await handleRelayRegister(new Request('https://dsh-market.com/api/relay/register', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ id: ID, secret: SECRET, target: TARGET }),
  }), { DB: db })

  // Then the pre-contract body survives untouched, with no frozen code invented
  assert.equal(response.status, 403)
  const body = await response.json()
  assert.deepEqual(body, { ok: false, error: 'auth-failed' })
  assert.equal(response.headers.get('x-relay-retryable'), null)
})

test('a registry read that fails while registering answers the frozen storage code', async () => {
  // Given D1 that cannot answer the lookup a registration makes first
  const db = fakeDb({ readError: true })

  // When the plugin refreshes its target
  const response = await handleRelayRegister(new Request('https://dsh-market.com/api/relay/register', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ id: ID, secret: SECRET, target: TARGET }),
  }), { DB: db })

  // Then the caller reads a frozen code instead of a runtime error page
  assert.equal(response.status, 503)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(response.headers.get('x-relay-retryable'), '1')
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'relay-storage-unavailable')
  assert.equal(body.error, 'storage-unavailable', 'the plugin keeps its own spelling of this condition')
})

test('a registration whose batch write fails answers the frozen storage code, not a bare error body', async () => {
  // Given a registry that answers the lookup and then refuses the registration write
  const db = fakeDb({ registration: { secret_hash: await sha256Hex(SECRET) } })
  db.batch = async () => {
    throw new Error('d1 unavailable')
  }

  // When the plugin refreshes its target
  const response = await handleRelayRegister(new Request('https://dsh-market.com/api/relay/register', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify({ id: ID, secret: SECRET, target: TARGET }),
  }), { DB: db })

  // Then the answer is the frozen storage failure at its frozen status, and a retry may outlast it
  assert.equal(response.status, 503)
  assert.match(response.headers.get('content-type'), /^application\/json/)
  assert.equal(response.headers.get('x-relay-retryable'), '1')

  // And it carries the frozen code plus the error spelling the plugin's registration client reads
  const body = await response.json()
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'message', 'ok'], 'the unified failure body, plus the legacy field only')
  assert.equal(body.ok, false)
  assert.equal(body.code, 'relay-storage-unavailable')
  assert.equal(body.error, 'storage-unavailable', 'the plugin keeps its own spelling of this condition')
  assert.match(body.message, /registry/)
})
