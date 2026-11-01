import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * The relay bridge's two halves: the Worker that stays at the door and the
 * Durable Object per instance behind it.
 *
 * The object half runs in the Workers runtime, so this file installs the two
 * platform globals it needs -- a WebSocket pair and a Response that can carry
 * an upgrade -- before importing the module under test. Both are real enough
 * to keep the piped bytes real: the sockets are message-linked, and the
 * response is the platform Response with a writable status for 101.
 */
class BridgeResponse extends Response {
  constructor(body = null, init = undefined) {
    if (init !== undefined && init.status === 101) {
      super(null, { status: 200 })
      Object.defineProperty(this, 'status', { value: 101 })
    } else {
      super(body, init)
    }
    this.webSocket = init === undefined ? undefined : init.webSocket
  }
}

class BridgeSocket {
  constructor() {
    this.listeners = new Map()
    /** What this side received from its peer, and what it sent to it. */
    this.inbox = []
    this.outbox = []
    this.closed = null
    this.peer = null
    this.accepted = false
  }

  accept() {
    this.accepted = true
  }

  send(data) {
    this.outbox.push(data)
    const peer = this.peer
    if (peer === null) return
    queueMicrotask(() => peer.dispatch('message', { data }))
  }

  close(code = 1000, reason = '') {
    if (this.closed !== null) return
    this.closed = { code, reason }
    const peer = this.peer
    if (peer === null) return
    // A close is one event both ends observe: the peer is closed by it too.
    queueMicrotask(() => {
      if (peer.closed === null) peer.closed = { code, reason }
      peer.dispatch('close', { code, reason })
    })
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }

  dispatch(type, event) {
    if (type === 'message') this.inbox.push(event.data)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }

  /** The control frames this side received, parsed. */
  controls() {
    return this.inbox.filter((frame) => typeof frame === 'string').map((frame) => JSON.parse(frame))
  }
}

class BridgeSocketPair {
  constructor() {
    const first = new BridgeSocket()
    const second = new BridgeSocket()
    first.peer = second
    second.peer = first
    return [first, second]
  }
}

globalThis.Response = BridgeResponse
globalThis.WebSocketPair = BridgeSocketPair

const { RelayBridge } = await import('../market/worker/src/relay-bridge.js')
const {
  RELAY_BRIDGE_ATTACH_HEADER,
  RELAY_BRIDGE_MARKER,
  RELAY_BRIDGE_NO_CONNECTOR,
  RELAY_FALLBACK_HEADER,
  RELAY_TRANSPORT_HEADER,
} = await import('../market/worker/src/relay.js')
const { RELAY_FAILURE_MESSAGE } = await import('../market/worker/src/relay-failure.js')
const worker = (await import('../market/worker/src/index.js')).default

const ID = 'abcd1234abcd1234'
const HOST = ID + '.dsh-market.com'
const SECRET = 'A'.repeat(43)
const TARGET = 'https://minted-tunnel-name.trycloudflare.com'
const ATTACH_PATH = '/__relay_bridge/connector'

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One tick of the microtask and timer queues, so a message the fake socket
 * delivers has been handled before the assertion reads its effect. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * D1 double: the registry row, the lease row and the rate-limit windows this
 * file's paths read. Anything else throws, so a path that starts reading a
 * table this double does not know fails loudly instead of silently answering.
 */
function bridgeDb(config = {}) {
  const state = {
    registration: config.registration ?? null,
    lease: config.lease ?? null,
    modeFails: config.modeFails === true,
    counts: new Map(config.counts ?? []),
    modeReads: 0,
    registrationReads: 0,
  }
  function statement(sql, args) {
    return {
      sql,
      args,
      async first() {
        // Every read is keyed by the bound id, exactly as D1 would be: an
        // unknown instance must find nothing, not somebody else's row.
        const rowOf = (row, fields) => (row !== null && row.id === args[0] ? fields(row) : null)
        if (sql.includes('SELECT target FROM relay_registrations')) {
          // Counted, not just answered: a bridged instance must be served without
          // this read ever happening, which is what the dispatch-order cases assert.
          state.registrationReads += 1
          return rowOf(state.registration, (row) => ({ ...row }))
        }
        if (sql.includes('SELECT mode FROM relay_leases')) {
          state.modeReads += 1
          if (state.modeFails) throw new Error('D1_ERROR: no such column: mode')
          return rowOf(state.lease, (row) => ({ mode: row.mode }))
        }
        if (sql.includes('SELECT secret_hash FROM relay_leases')) {
          return rowOf(state.lease, (row) => ({ secret_hash: row.secret_hash }))
        }
        if (sql.includes('SELECT secret_hash FROM relay_registrations')) {
          return rowOf(state.registration, (row) => ({ secret_hash: row.secret_hash }))
        }
        throw new Error('unexpected first: ' + sql)
      },
      async run() {
        throw new Error('unexpected run: ' + sql)
      },
      async all() {
        throw new Error('unexpected all: ' + sql)
      },
    }
  }
  return {
    state,
    prepare(sql) {
      return { bind: (...args) => statement(sql, args) }
    },
    async batch(statements) {
      return statements.map((entry) => {
        if (entry.sql.includes('INSERT INTO relay_rate_limit')) {
          const key = entry.args[0]
          state.counts.set(key, (state.counts.get(key) ?? 0) + 1)
          return {}
        }
        if (entry.sql.includes('SELECT count FROM relay_rate_limit')) {
          return { results: [{ count: state.counts.get(entry.args[0]) ?? 0 }] }
        }
        throw new Error('unexpected batch: ' + entry.sql)
      })
    },
  }
}

/** The object namespace, recording which instance id each call names. */
function bridgeNamespace(answer) {
  const named = []
  return {
    named,
    idFromName(name) {
      named.push(name)
      return { name, toString: () => name }
    },
    get(id) {
      return {
        async fetch(request) {
          return await answer(request, id)
        },
      }
    },
  }
}

/** One phone request on the relay hostname. */
function phone(path = '/api/ping') {
  return new Request('https://' + HOST + path, { headers: { host: HOST } })
}

/** A bridged answer, as the object would build it. */
function bridgedAnswer(text, extra = {}) {
  return new BridgeResponse(text, {
    status: 200,
    headers: { 'content-type': 'text/plain', [RELAY_TRANSPORT_HEADER]: 'bridge', ...extra },
  })
}

test('a quick-mode instance keeps riding its quick tunnel and never reaches an object', async () => {
  // Given an instance whose lease row still says quick, beside a deployment
  //       that does carry the bridge namespace
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    lease: { id: ID, secret_hash: 'unused', mode: 'quick' },
  })
  const namespace = bridgeNamespace(() => {
    throw new Error('the object must not be asked about a quick instance')
  })
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the quick tunnel carried it, byte for byte, and nothing fell back
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'tunnel-body')
    assert.deepEqual(forwarded, [TARGET + '/api/ping'])
    assert.equal(response.headers.get(RELAY_FALLBACK_HEADER), null)
    assert.deepEqual(namespace.named, [])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a bridge-mode instance is served by its object and the quick tunnel is not contacted', async () => {
  // Given a flipped lease row and an object that answers the request itself
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    lease: { id: ID, secret_hash: 'unused', mode: 'bridge' },
  })
  const namespace = bridgeNamespace(async (request) => {
    assert.equal(new URL(request.url).pathname, '/api/ping')
    return bridgedAnswer('bridged-body')
  })
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200 })
  }
  try {
    // When the phone asks for the same path
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the bytes came from the object, named by this instance's id, and the
    //      quick tunnel was never dialed
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'bridged-body')
    assert.equal(response.headers.get(RELAY_TRANSPORT_HEADER), 'bridge')
    assert.deepEqual(namespace.named, [ID])
    assert.deepEqual(forwarded, [])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a bridge-mode instance with no connector falls back to quick inside the same request', async () => {
  // Given a flipped lease row whose object holds no connector socket
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    lease: { id: ID, secret_hash: 'unused', mode: 'bridge' },
  })
  const namespace = bridgeNamespace(async () => new BridgeResponse(RELAY_BRIDGE_NO_CONNECTOR, {
    status: 409,
    headers: { [RELAY_BRIDGE_MARKER]: RELAY_BRIDGE_NO_CONNECTOR },
  }))
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200 })
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the quick tunnel answered, and the response says it was the fallback
    assert.equal(await response.text(), 'tunnel-body')
    assert.deepEqual(forwarded, [TARGET + '/api/ping'])
    assert.equal(response.headers.get(RELAY_FALLBACK_HEADER), RELAY_BRIDGE_NO_CONNECTOR)
    assert.equal(response.headers.get(RELAY_TRANSPORT_HEADER), null)
  } finally {
    globalThis.fetch = realFetch
  }
})


test('a bridged instance with no registration row is served by its object, not the registry', async () => {
  // Given a flipped lease row and no registry row at all -- the shape a bridged
  //       instance has once its quick tunnel stops announcing a target
  const db = bridgeDb({ lease: { id: ID, secret_hash: 'unused', mode: 'bridge' } })
  const namespace = bridgeNamespace(async (request) => {
    assert.equal(new URL(request.url).pathname, '/api/ping')
    return bridgedAnswer('bridged-body')
  })
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200 })
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the object answered, and the registry was never consulted: requiring
    //      a row first is what made a bridged instance unreachable
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'bridged-body')
    assert.equal(response.headers.get(RELAY_TRANSPORT_HEADER), 'bridge')
    assert.deepEqual(namespace.named, [ID])
    assert.equal(db.state.registrationReads, 0, 'the bridge is decided before the registry')
    assert.deepEqual(forwarded, [], 'and the quick tunnel is never dialed')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a bridged instance with no registration row still carries a WebSocket upgrade', async () => {
  // Given the same shape, and an object that accepts the upgrade
  const db = bridgeDb({ lease: { id: ID, secret_hash: 'unused', mode: 'bridge' } })
  const socket = new BridgeSocket()
  let seen = null
  const namespace = bridgeNamespace(async (request) => {
    seen = request
    return new BridgeResponse(null, { status: 101, webSocket: socket })
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    throw new Error('the quick tunnel must not be dialed: ' + request.url)
  }
  try {
    // When the phone upgrades on its relay hostname
    const response = await worker.fetch(new Request('https://' + HOST + '/api/ws', {
      headers: { host: HOST, upgrade: 'websocket' },
    }), { DB: db, RELAY_BRIDGE: namespace })

    // Then the upgrade reached the object, unaltered, with no registry read
    assert.equal(response.status, 101)
    assert.equal(response.webSocket, socket)
    assert.equal(seen.headers.get('upgrade'), 'websocket')
    assert.equal(db.state.registrationReads, 0)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a bridged instance with no connector and no registration row still answers instance-offline', async () => {
  // Given a flipped lease row whose object holds no connector, and no registry row
  const db = bridgeDb({ lease: { id: ID, secret_hash: 'unused', mode: 'bridge' } })
  const namespace = bridgeNamespace(async () => new BridgeResponse(RELAY_BRIDGE_NO_CONNECTOR, {
    status: 409,
    headers: { [RELAY_BRIDGE_MARKER]: RELAY_BRIDGE_NO_CONNECTOR },
  }))
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200 })
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the frozen offline code answers, and the object's refusal invented no
    //      tunnel to fall back to
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, 'instance-offline')
    assert.equal(db.state.registrationReads, 1, 'the fallback consulted the registry once')
    assert.deepEqual(forwarded, [])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a quick instance with no registration row still answers instance-offline', async () => {
  // Given a quick lease row and no registry row
  const db = bridgeDb({ lease: { id: ID, secret_hash: 'unused', mode: 'quick' } })
  const namespace = bridgeNamespace(() => {
    throw new Error('the object must not be asked about a quick instance')
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    throw new Error('an instance with no row has nothing to dial: ' + request.url)
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the registry's own answer is exactly what it was before the reorder
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, 'instance-offline')
    assert.equal(db.state.registrationReads, 1)
    assert.deepEqual(namespace.named, [], 'a quick instance never reaches an object')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a quick instance with a registration row still proxies to its tunnel target', async () => {
  // Given a quick lease row beside the registry row its quick tunnel announced
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    lease: { id: ID, secret_hash: 'unused', mode: 'quick' },
  })
  const namespace = bridgeNamespace(() => {
    throw new Error('the object must not be asked about a quick instance')
  })
  const forwarded = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (request) => {
    forwarded.push(request.url)
    return new Response('tunnel-body', { status: 200 })
  }
  try {
    // When the phone asks for a path on its relay hostname
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then the quick path is byte-for-byte what it was: the target carried it and
    //      no fallback marker was stamped on a non-fallback answer
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'tunnel-body')
    assert.deepEqual(forwarded, [TARGET + '/api/ping'])
    assert.equal(response.headers.get(RELAY_FALLBACK_HEADER), null)
    assert.equal(response.headers.get(RELAY_TRANSPORT_HEADER), null)
    assert.equal(db.state.registrationReads, 1)
    assert.deepEqual(namespace.named, [])
  } finally {
    globalThis.fetch = realFetch
  }
})
test('a lease table that cannot answer the mode keeps the instance on quick', async () => {
  // Given a deployment whose D1 has not run the mode migration yet
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    modeFails: true,
  })
  const namespace = bridgeNamespace(() => {
    throw new Error('the object must not be reached while the mode is unreadable')
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('tunnel-body', { status: 200 })
  try {
    // When a request arrives for an instance
    const response = await worker.fetch(phone(), { DB: db, RELAY_BRIDGE: namespace })

    // Then quick served it instead of the whole relay answering 503
    assert.equal(await response.text(), 'tunnel-body')
    assert.equal(db.state.modeReads, 1)
    assert.deepEqual(namespace.named, [])
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a downstream request cannot present itself as a connector attach', async () => {
  // Given a bridge-mode instance and a phone that forges the attach marker
  const db = bridgeDb({
    registration: { id: ID, secret_hash: 'unused', target: TARGET },
    lease: { id: ID, secret_hash: 'unused', mode: 'bridge' },
  })
  let seen = null
  const namespace = bridgeNamespace(async (request) => {
    seen = request
    return bridgedAnswer('bridged-body')
  })
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('tunnel-body', { status: 200 })
  try {
    // When it asks for the object with that marker set
    const forged = new Request('https://' + HOST + '/api/ping', {
      headers: { host: HOST, [RELAY_BRIDGE_ATTACH_HEADER]: '1' },
    })
    await worker.fetch(forged, { DB: db, RELAY_BRIDGE: namespace })

    // Then the object saw the request without it
    assert.equal(seen.headers.get(RELAY_BRIDGE_ATTACH_HEADER), null)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the bridge door refuses a plain request, an unknown id and a wrong secret', async () => {
  const hash = await sha256Hex(SECRET)
  const db = bridgeDb({ lease: { id: ID, secret_hash: hash, mode: 'bridge' } })
  const namespace = bridgeNamespace(async () => new BridgeResponse(null, { status: 101, webSocket: new BridgeSocket() }))
  const env = { DB: db, RELAY_BRIDGE: namespace }
  const door = (query, headers) => new Request('https://dsh-market.com/api/relay/bridge' + query, { headers })

  // Given the bridge door and three requests that do not prove the credential
  // When each one is asked for a socket
  const plain = await worker.fetch(door('?id=' + ID, {}), env)
  const unknown = await worker.fetch(door('?id=0123456789abcdef', {
    upgrade: 'websocket',
    authorization: 'Bearer ' + SECRET,
  }), env)
  const wrongSecret = await worker.fetch(door('?id=' + ID, {
    upgrade: 'websocket',
    authorization: 'Bearer ' + 'B'.repeat(43),
  }), env)

  // Then none of them reached an object, and each was refused on its own ground
  assert.equal(plain.status, 426)
  assert.equal(unknown.status, 403)
  assert.equal(wrongSecret.status, 403)
  assert.deepEqual(namespace.named, [])
})

test('the bridge door hands an authenticated upgrade to the instance object', async () => {
  // Given a lease row whose secret hash matches the credential the connector holds
  const hash = await sha256Hex(SECRET)
  const db = bridgeDb({ lease: { id: ID, secret_hash: hash, mode: 'bridge' } })
  const connector = new BridgeSocket()
  let attach = null
  const namespace = bridgeNamespace(async (request) => {
    attach = request
    return new BridgeResponse(null, { status: 101, webSocket: connector })
  })

  // When the connector dials with its id and its own long-lived secret
  const response = await worker.fetch(new Request('https://dsh-market.com/api/relay/bridge?id=' + ID, {
    headers: { upgrade: 'websocket', authorization: 'Bearer ' + SECRET },
  }), { DB: db, RELAY_BRIDGE: namespace })

  // Then the object was named by that id and saw nothing but the attach
  assert.equal(response.status, 101)
  assert.equal(response.webSocket, connector)
  assert.deepEqual(namespace.named, [ID])
  assert.equal(new URL(attach.url).pathname, ATTACH_PATH)
  assert.equal(attach.headers.get(RELAY_BRIDGE_ATTACH_HEADER), '1')
  assert.equal(attach.headers.get('authorization'), null)
})

test('the bridge door refuses upgrades beyond the registry windows', async () => {
  // Given an instance whose id window is already spent for this minute
  const hash = await sha256Hex(SECRET)
  const db = bridgeDb({
    lease: { id: ID, secret_hash: hash, mode: 'bridge' },
    counts: [['id:' + ID, 6]],
  })
  const namespace = bridgeNamespace(async () => {
    throw new Error('a rate-limited upgrade must not reach an object')
  })

  // When it dials again
  const response = await worker.fetch(new Request('https://dsh-market.com/api/relay/bridge?id=' + ID, {
    headers: { upgrade: 'websocket', authorization: 'Bearer ' + SECRET },
  }), { DB: db, RELAY_BRIDGE: namespace })

  // Then the window refused it before any object was named
  assert.equal(response.status, 429)
  assert.deepEqual(namespace.named, [])
  assert.equal(db.state.counts.get('id:' + ID), 7)
  assert.equal(db.state.counts.get('ip:unknown'), 1)
})

test('the object refuses an attach that the Worker door did not mark', async () => {
  // Given an object and an attach-shaped request without the door's marker
  const object = new RelayBridge({ id: { toString: () => ID } })

  // When it is asked to attach
  const response = await object.fetch(new Request('https://bridge.internal' + ATTACH_PATH, {
    headers: { upgrade: 'websocket' },
  }))

  // Then it is refused, so only a connection this Worker approved can attach
  assert.equal(response.status, 403)
})

test('the object sends the public origin as the Host the connector must use', async () => {
  // Given an attached connector
  const object = new RelayBridge({ id: { toString: () => ID } })
  const attached = await object.fetch(attachRequest())
  const connector = attached.webSocket

  // When a phone request arrives on the relay hostname
  const pending = object.fetch(phone('/api/sessions?limit=2'))
  await settle()
  const frames = connector.controls()
  connector.send(JSON.stringify({ t: 'res', id: frames[0].id, status: 200, headers: [] }))
  connector.send(JSON.stringify({ t: 'fin', id: frames[0].id }))
  await pending

  // Then the frame carries the origin the phone dialed -- never the loopback
  //      authority the connector will dial, which is what unlocks the host's
  //      local control plane
  const req = frames.find((frame) => frame.t === 'req')
  assert.equal(req.host, HOST)
  assert.equal(req.url, '/api/sessions?limit=2')
  assert.equal(req.host.includes('127.0.0.1'), false)
  const hostHeader = req.headers.find(([name]) => name.toLowerCase() === 'host')
  assert.deepEqual(hostHeader, ['host', HOST])
})

test('a second attach replaces the connector socket the object already held', async () => {
  // Given a connector already attached
  const object = new RelayBridge({ id: { toString: () => ID } })
  const first = (await object.fetch(attachRequest())).webSocket

  // When the same instance dials again with the same long-lived credential
  const second = (await object.fetch(attachRequest())).webSocket
  await settle()

  // Then the newest socket wins, the previous one is closed as replaced, and
  //      the next request travels on the new one only
  assert.deepEqual(first.closed, { code: 1000, reason: 'replaced' })
  assert.equal(second.closed, null)
  const pending = object.fetch(phone('/api/ping'))
  await settle()
  assert.equal(first.inbox.length, 0)
  assert.equal(second.controls()[0].t, 'req')
  second.send(JSON.stringify({ t: 'res', id: second.controls()[0].id, status: 200, headers: [] }))
  second.send(JSON.stringify({ t: 'fin', id: second.controls()[0].id }))
  await pending
})

test('the object streams a bridged response body to the downstream caller', async () => {
  // Given an attached connector and a phone request in flight
  const object = new RelayBridge({ id: { toString: () => ID } })
  const connector = (await object.fetch(attachRequest())).webSocket
  const pending = object.fetch(phone('/api/stream'))
  await settle()
  const { id } = connector.controls()[0]

  // When the connector answers in two chunks
  connector.send(JSON.stringify({
    t: 'res',
    id,
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'text/plain']],
  }))
  connector.send(chunk(1, id, 'first-'))
  await settle()
  connector.send(chunk(1, id, 'second'))
  connector.send(JSON.stringify({ t: 'fin', id }))

  // Then the bytes arrive whole, the response is marked as bridged, and the
  //      stream closed with the last chunk
  const response = await pending
  assert.equal(response.status, 200)
  assert.equal(response.headers.get(RELAY_TRANSPORT_HEADER), 'bridge')
  assert.equal(response.headers.get('content-type'), 'text/plain')
  assert.equal(await response.text(), 'first-second')
})

test('a connector that goes away fails the streams it owned', async () => {
  // Given a request waiting on a connector that never answers
  const object = new RelayBridge({ id: { toString: () => ID } })
  const connector = (await object.fetch(attachRequest())).webSocket
  const pending = object.fetch(phone('/api/slow'))
  await settle()

  // When the connector socket closes
  connector.close(1006, 'network')

  // Then the downstream caller reads the frozen failure instead of waiting out
  //      the head timeout: a 502 that says retry, because a reconnected
  //      connector makes the identical request work
  const response = await pending
  assert.equal(response.status, 502)
  assert.equal(response.headers.get('x-relay-retryable'), '1')
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'connector-closed',
    message: RELAY_FAILURE_MESSAGE['connector-closed'],
  })
})

/** The attach request the Worker's door builds. */
function attachRequest() {
  return new Request('https://bridge.internal' + ATTACH_PATH, {
    headers: { upgrade: 'websocket', [RELAY_BRIDGE_ATTACH_HEADER]: '1' },
  })
}

/** One payload frame of the bridge contract. */
function chunk(kind, id, text) {
  const payload = new TextEncoder().encode(text)
  const bytes = new Uint8Array(5 + payload.byteLength)
  bytes[0] = kind
  new DataView(bytes.buffer).setUint32(1, id >>> 0)
  bytes.set(payload, 5)
  return bytes
}
