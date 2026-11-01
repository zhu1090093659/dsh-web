/**
 * The relay bridge's per-stream backpressure, its stall harvest, and what a
 * re-attaching connector does to the streams the old socket owned.
 *
 * The object half runs in the Workers runtime, so this file installs the two
 * platform globals it needs -- a WebSocket pair and a Response that can carry an
 * upgrade -- before importing the module under test. Both are real enough to
 * keep the piped bytes real, and the phone side of a bridged body is a real
 * ReadableStream read by a real reader: the window's HIGH and LOW marks are
 * decided by the stream's own accounting, so nothing here fakes them.
 */
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

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

  /** A close event the runtime delivers for a socket this object already gave
   * up on: the late half of a replacement. */
  emitClose(code, reason) {
    if (this.closed === null) this.closed = { code, reason }
    this.dispatch('close', { code, reason })
  }

  /** The control frames this side received, parsed. */
  controls() {
    return this.inbox.filter((frame) => typeof frame === 'string').map((frame) => JSON.parse(frame))
  }
}

/** The two ends of one socket pair, built the way the platform global is. */
function bridgeSocketPair() {
  const first = new BridgeSocket()
  const second = new BridgeSocket()
  first.peer = second
  second.peer = first
  return [first, second]
}

globalThis.Response = BridgeResponse
globalThis.WebSocketPair = bridgeSocketPair

const {
  BRIDGE_CLOSE_REPLACED,
  BRIDGE_STREAM_HIGH,
  BRIDGE_STREAM_PAUSED_CAP,
  BRIDGE_STREAM_STALL_MS,
  RelayBridge,
} = await import('../market/worker/src/relay-bridge.js')
const { RELAY_BRIDGE_ATTACH_HEADER } = await import('../market/worker/src/relay.js')
const { RELAY_FAILURE_MESSAGE } = await import('../market/worker/src/relay-failure.js')

const ID = 'abcd1234abcd1234'
const HOST = ID + '.dsh-market.com'
const ATTACH_PATH = '/__relay_bridge/connector'
/** One connector chunk, in bytes: the window is counted in these. */
const CHUNK = 64 * 1024
/** Exactly the number of chunks that fills the window to HIGH. */
const TO_HIGH = Math.ceil(BRIDGE_STREAM_HIGH / CHUNK)
/** Exactly the number of chunks a paused stream still accepts. */
const TO_CAP = Math.ceil(BRIDGE_STREAM_PAUSED_CAP / CHUNK)

/** One tick of the microtask and timer queues, so a message the fake socket
 * delivered has been handled before the assertion reads its effect. */
function settle() {
  return new Promise((resolve) => {
    setImmediate(() => setImmediate(() => setImmediate(resolve)))
  })
}

/** Parse the JSON lines the object logs, and swallow the real output. */
function captureLog() {
  const lines = []
  const realLog = console.log
  const realWarn = console.warn
  const record = (...parts) => { lines.push(parts.join(' ')) }
  console.log = record
  console.warn = record
  return {
    lines,
    records() {
      return lines.filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    },
    restore() {
      console.log = realLog
      console.warn = realWarn
    },
  }
}

/** One payload frame of the bridge contract. */
function chunk(kind, id, payload) {
  const bytes = new Uint8Array(5 + payload.byteLength)
  bytes[0] = kind
  new DataView(bytes.buffer).setUint32(1, id >>> 0)
  bytes.set(payload, 5)
  return bytes
}

/** The attach request the Worker's door builds. */
function attachRequest() {
  return new Request('https://bridge.internal' + ATTACH_PATH, {
    headers: { upgrade: 'websocket', [RELAY_BRIDGE_ATTACH_HEADER]: '1' },
  })
}

/** One phone request on the relay hostname. */
function phone(path) {
  return new Request('https://' + HOST + path, { headers: { host: HOST } })
}

/** One phone upgrade on the relay hostname. */
function phoneUpgrade(path) {
  return new Request('https://' + HOST + path, { headers: { host: HOST, upgrade: 'websocket' } })
}

/** Attach one connector socket and hand back the connector's own end. */
async function attach(object) {
  const response = await object.fetch(attachRequest())
  assert.equal(response.status, 101)
  return response.webSocket
}

/** A fresh object with one attached connector. */
async function bridged() {
  const object = new RelayBridge({ id: { toString: () => ID } })
  const connector = await attach(object)
  return { object, connector }
}

/** Answer one phone request's head, and hand back the stream id it opened. */
async function answerHead(object, connector, path = '/api/stream') {
  const pending = object.fetch(phone(path))
  await settle()
  const request = connector.controls().find((frame) => frame.t === 'req')
  assert.notEqual(request, undefined)
  connector.send(JSON.stringify({
    t: 'res',
    id: request.id,
    status: 200,
    statusText: 'OK',
    headers: [['content-type', 'text/plain']],
  }))
  await settle()
  return { pending, id: request.id }
}

/** Push body chunks across as the connector's own payload frames. */
async function feed(connector, id, count, size = CHUNK) {
  const payload = new Uint8Array(size)
  for (let index = 0; index < count; index += 1) connector.send(chunk(1, id, payload))
  await settle()
}

test('the window closes at HIGH and the connector is told to pause that stream', async () => {
  const log = captureLog()
  try {
    // Given a bridged response whose body nobody is reading yet
    const { object, connector } = await bridged()
    const { pending, id } = await answerHead(object, connector)

    // When the connector pushes a full window of body chunks
    await feed(connector, id, TO_HIGH)

    // Then that stream -- and only that stream -- is paused
    const pauses = connector.controls().filter((frame) => frame.t === 'pause')
    assert.deepEqual(pauses, [{ t: 'pause', id }])
    assert.equal(connector.controls().filter((frame) => frame.t === 'resume').length, 0)
    const paused = log.records().find((record) => record.relay === 'stream-pause')
    assert.equal(paused.id, id)
    const response = await pending
    assert.equal(response.status, 200)
  } finally {
    log.restore()
  }
})

test('the window reopens at LOW once the phone has read the body down', async () => {
  const log = captureLog()
  try {
    // Given a paused stream held at its window
    const { object, connector } = await bridged()
    const { pending, id } = await answerHead(object, connector)
    await feed(connector, id, TO_HIGH)
    assert.equal(connector.controls().filter((frame) => frame.t === 'pause').length, 1)

    // When the phone reads its way back down
    const response = await pending
    const reader = response.body.getReader()
    let resumed = false
    let reads = 0
    const readOne = async () => {
      reads += 1
      const { done } = await reader.read()
      assert.equal(done, false)
      await settle()
      resumed = connector.controls().some((frame) => frame.t === 'resume' && frame.id === id)
      if (!resumed && reads < 40) await readOne()
    }
    await readOne()

    // Then the resume lands on the same stream, once, and the bytes still flow
    assert.equal(resumed, true)
    const resumes = connector.controls().filter((frame) => frame.t === 'resume')
    assert.deepEqual(resumes, [{ t: 'resume', id }])
    await feed(connector, id, 1)
    const { value } = await reader.read()
    assert.equal(value.byteLength, CHUNK)
  } finally {
    log.restore()
  }
})

test('a connector that never stops sending has its overflow dropped and counted', async () => {
  const log = captureLog()
  try {
    // Given a paused stream and a connector that predates the window, so it
    //       keeps pushing chunks the object cannot queue
    const { object, connector } = await bridged()
    const { pending, id } = await answerHead(object, connector)
    await feed(connector, id, TO_CAP)
    assert.equal(connector.controls().filter((frame) => frame.t === 'pause').length, 1)
    const overflow = 4

    // When it pushes past the pause cap, and then finishes
    await feed(connector, id, overflow)
    connector.send(JSON.stringify({ t: 'fin', id }))

    // Then the stream was not broken: the accepted bytes arrive whole, the drops
    //      are logged, and the response still resolves as a success
    const response = await pending
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.equal(body.length, TO_CAP * CHUNK)
    const drop = log.records().find((record) => record.relay === 'stream-drop')
    assert.equal(drop.id, id)
    assert.equal(drop.cap, BRIDGE_STREAM_PAUSED_CAP)
    const done = log.records().find((record) => record.relay === 'bridge-done')
    assert.equal(done.dropped, overflow * CHUNK)
    assert.equal(done.chunks, TO_CAP + overflow)
  } finally {
    log.restore()
  }
})

test('a paused stream with no drain progress is harvested after the stall window', async () => {
  const log = captureLog()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // Given a stream the phone has stopped reading entirely
    const { object, connector } = await bridged()
    const { pending, id } = await answerHead(object, connector)
    await feed(connector, id, TO_HIGH)
    const response = await pending
    const reader = response.body.getReader()
    assert.equal(connector.controls().filter((frame) => frame.t === 'pause').length, 1)

    // When the stall window passes with no read at all
    assert.equal(BRIDGE_STREAM_STALL_MS, 60_000)
    mock.timers.tick(BRIDGE_STREAM_STALL_MS)
    await settle()

    // Then the connector is told to release the stream, and the phone's body is
    //      aborted rather than left hanging
    const releases = connector.controls().filter((frame) => frame.t === 'close')
    assert.deepEqual(releases, [{ t: 'close', id, reason: 'stream-stalled' }])
    const harvested = log.records().find((record) => record.relay === 'stream-stalled')
    assert.equal(harvested.id, id)
    await assert.rejects(reader.read(), /stream-stalled/)
  } finally {
    mock.timers.reset()
    log.restore()
  }
})

test('a stream that keeps draining is not harvested, and is once it stops', async () => {
  const log = captureLog()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // Given a paused stream whose phone is slow but not gone
    const { object, connector } = await bridged()
    const { pending, id } = await answerHead(object, connector)
    await feed(connector, id, TO_HIGH)
    const reader = (await pending).body.getReader()
    await reader.read()
    await reader.read()
    await reader.read()
    await reader.read()
    await settle()

    // When the first stall window passes, the drain was progress, so the window
    //      re-arms instead of harvesting
    mock.timers.tick(BRIDGE_STREAM_STALL_MS)
    await settle()
    assert.equal(connector.controls().filter((frame) => frame.t === 'close').length, 0)

    // Then the next window -- with no further read -- is the one that harvests
    mock.timers.tick(BRIDGE_STREAM_STALL_MS)
    await settle()
    const releases = connector.controls().filter((frame) => frame.t === 'close')
    assert.deepEqual(releases, [{ t: 'close', id, reason: 'stream-stalled' }])
  } finally {
    mock.timers.reset()
    log.restore()
  }
})

test('a re-attaching connector fails the old streams as connector-replaced', async () => {
  const log = captureLog()
  try {
    // Given a phone request the old connector socket has not answered yet
    const { object, connector } = await bridged()
    const pending = object.fetch(phone('/api/slow'))
    await settle()

    // When the connector dials again, as a reconnect does
    const second = await attach(object)

    // Then the stale stream is answered with the frozen retryable failure, so
    //      the phone asks again on the new socket instead of waiting 60 s
    const response = await pending
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('x-relay-retryable'), '1')
    assert.match(String(response.headers.get('content-type')), /^application\/json/)
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'connector-replaced',
      message: RELAY_FAILURE_MESSAGE['connector-replaced'],
    })
    const failed = log.records().find((record) => record.relay === 'bridge-failed')
    assert.equal(failed.reason, 'connector-replaced')
    // The new socket is untouched and answers the next request
    assert.equal(second.closed, null)
    assert.equal(connector.closed.code, 1000)
    assert.equal(connector.closed.reason, 'replaced')
  } finally {
    log.restore()
  }
})

test('a re-attaching connector closes the phone sockets it owned with 4001', async () => {
  const log = captureLog()
  try {
    // Given a phone WebSocket the old connector socket carries
    const { object, connector } = await bridged()
    const pending = object.fetch(phoneUpgrade('/ios/v1'))
    await settle()
    const open = connector.controls().find((frame) => frame.t === 'ws-open')
    connector.send(JSON.stringify({ t: 'ws-accept', id: open.id }))
    const phoneSocket = (await pending).webSocket
    assert.equal(phoneSocket.closed, null)

    // When the connector re-attaches
    await attach(object)
    await settle()

    // Then the phone is told to reconnect at once, not to report a server fault
    assert.deepEqual(phoneSocket.closed, { code: BRIDGE_CLOSE_REPLACED, reason: 'connector-replaced' })
    assert.equal(BRIDGE_CLOSE_REPLACED, 4001)
  } finally {
    log.restore()
  }
})

test('a replaced socket that closes late does not touch the new socket streams', async () => {
  const log = captureLog()
  try {
    // Given a connector that replaced another one, and a request on the new one
    const { object, connector: first } = await bridged()
    const second = await attach(object)
    await settle()
    const pending = object.fetch(phone('/api/still-alive'))
    await settle()
    const request = second.controls().find((frame) => frame.t === 'req')

    // When the runtime finally delivers the replaced socket's close
    first.peer.emitClose(1006, 'late-close')
    await settle()

    // Then nothing the new socket owns was torn down, and it still answers
    assert.equal(second.closed, null)
    second.send(JSON.stringify({ t: 'res', id: request.id, status: 200, statusText: 'OK', headers: [] }))
    await settle()
    second.send(JSON.stringify({ t: 'fin', id: request.id }))
    const response = await pending
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '')
    assert.equal(log.records().some((record) => record.relay === 'bridge-failed'), false)
  } finally {
    log.restore()
  }
})

test('a head that never arrives answers the frozen stream-stalled failure', async () => {
  const log = captureLog()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // Given a request whose connector never answers the response head
    const { object, connector } = await bridged()
    const pending = object.fetch(phone('/api/silent'))
    await settle()
    assert.equal(connector.controls().filter((frame) => frame.t === 'req').length, 1)

    // When the head window passes
    mock.timers.tick(60_000)
    await settle()

    // Then the phone reads a retryable 504 in the frozen shape
    const response = await pending
    assert.equal(response.status, 504)
    assert.equal(response.headers.get('x-relay-retryable'), '1')
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'stream-stalled',
      message: RELAY_FAILURE_MESSAGE['stream-stalled'],
    })
    const detail = log.records().find((record) => record.relay === 'stream-failed')
    assert.equal(detail.code, 'stream-stalled')
    assert.match(String(detail.detail), /timed out on the response head/)
  } finally {
    mock.timers.reset()
    log.restore()
  }
})

test('a control frame this object does not know is ignored, and the bridge keeps working', async () => {
  const log = captureLog()
  try {
    // Given an attached connector
    const { object, connector } = await bridged()

    // When it sends a frame from a newer version of the contract
    connector.send(JSON.stringify({ t: 'future-frame', id: 1, payload: { anything: true } }))
    await settle()

    // Then the unknown frame is logged and dropped, and a request still flows
    assert.equal(log.records().some((record) => record.relay === 'unknown-control'), true)
    const { pending, id } = await answerHead(object, connector, '/api/ping')
    connector.send(JSON.stringify({ t: 'fin', id }))
    const response = await pending
    assert.equal(response.status, 200)
  } finally {
    log.restore()
  }
})
