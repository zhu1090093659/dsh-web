/**
 * dsh-market relay bridge: a Durable Object meeting point behind the stateless
 * Worker (`relay.js`). Additive on purpose -- the quick-tunnel proxy path keeps
 * serving every instance until that instance's lease row is flipped to
 * `mode = 'bridge'`.
 *
 * The Worker stays at the door. It authenticates the connector upgrade with the
 * lease's own id and secret (hash-compared, rate-limited on the registry's
 * buckets) and hands the upgrade to the object named by `idFromName(id)`, so an
 * object is reachable only through a connection this Worker approved. The object
 * holds that one connector socket and pipes every downstream request to it:
 * plain HTTP with a streaming response body, request bodies, and the phone's
 * WebSocket upgrades, multiplexed on one socket by stream id.
 *
 * Frame contract (one socket, multiplexed):
 *   control frames are JSON text  { t, id, ... }
 *   payload frames are binary     [kind:u8][streamId:u32be][payload]
 *   kinds: 1 HTTP body chunk, 2 WebSocket binary, 3 WebSocket text (UTF-8)
 *   flow control, object -> connector: { t: 'pause', id } closes this stream's
 *   window, { t: 'resume', id } reopens it, and { t: 'close', id, reason }
 *   abandons the stream and frees its upstream -- the frame a phone cancel
 *   already sent, reused so a connector that predates the window still frees
 *   the upstream instead of ignoring it
 *
 * A slow phone must never make this object buffer an instance's whole byte
 * stream: every streamed body queues under BRIDGE_STREAM_HIGH, is paused at
 * that mark, and resumes once the phone has read its way down to
 * BRIDGE_STREAM_LOW. A connector too old to know the window keeps sending, and
 * what it sends past BRIDGE_STREAM_PAUSED_CAP is dropped and counted instead of
 * buffered. A paused stream that makes no drain progress for
 * BRIDGE_STREAM_STALL_MS is harvested and its upstream released.
 *
 * Reconnects are the reason this file has no tickets: the credential is
 * long-lived, so a reconnecting connector dials the same endpoint again and the
 * object replaces the socket it already holds (newest attach wins, the previous
 * socket is closed `1000 replaced`). Streams of the replaced socket fail at once
 * -- the connector that owned them is gone -- while streams the new socket
 * already started keep running.
 */

import { relayFailure } from './relay-failure.js'
import {
  BRIDGE_CLOSE_REPLACED,
  BRIDGE_CLOSE_STALLED,
  BRIDGE_MAX_PER_ID,
  BRIDGE_MAX_PER_IP,
  BRIDGE_STREAM_HIGH,
  BRIDGE_STREAM_LOW,
  BRIDGE_STREAM_PAUSED_CAP,
  BRIDGE_STREAM_STALL_MS,
  HEAD_TIMEOUT_MS,
  REGISTER_WINDOW_MS,
  WS_OPEN_TIMEOUT_MS,
} from './relay-limits.js'
import {
  ID_RE,
  RELAY_BRIDGE_ATTACH_HEADER,
  RELAY_BRIDGE_MARKER,
  RELAY_BRIDGE_NO_CONNECTOR,
  RELAY_TRANSPORT_HEADER,
  SECRET_RE,
  sha256Hex,
  timingSafeEqualStr,
} from './relay.js'

/** The path the Worker rewrites an accepted connector upgrade to. The object
 * also requires RELAY_BRIDGE_ATTACH_HEADER, because a downstream phone could type
 * this path on its own relay hostname and must not be mistaken for a connector. */
export const BRIDGE_ATTACH_PATH = '/__relay_bridge/connector'
/**
 * The per-stream window, the stalled-harvest window, the head and accept
 * timeouts, the door's budgets and the phone's two close codes are stated
 * once in `relay-limits.js`. They stay exported here because the connector
 * and the flow spec read the window off this module.
 */
export {
  BRIDGE_CLOSE_REPLACED,
  BRIDGE_CLOSE_STALLED,
  BRIDGE_MAX_PER_ID,
  BRIDGE_MAX_PER_IP,
  BRIDGE_STREAM_HIGH,
  BRIDGE_STREAM_LOW,
  BRIDGE_STREAM_PAUSED_CAP,
  BRIDGE_STREAM_STALL_MS,
}

const HTTP_BODY = 1
const WS_BINARY = 2
const WS_TEXT = 3

/** Response headers a streaming Response may not carry, or that the connector's
 * own transport already spoke. */
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

const NO_STORE = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
}

/** Every streamed body queues under this window, which is what makes the
 * controller's own byte accounting the per-stream in-flight count. */
const STREAM_QUEUING = new ByteLengthQueuingStrategy({ highWaterMark: BRIDGE_STREAM_HIGH })

/** How many bytes of one streamed body are queued for the phone and not read
 * yet. A null desired size means the stream is already closed or errored. */
function queuedBytes(controller) {
  if (controller === null || controller.desiredSize === null) return null
  const queued = BRIDGE_STREAM_HIGH - controller.desiredSize
  return queued > 0 ? queued : 0
}

/** One timer that never keeps the runtime alive on its own, like sleep. */
function startTimer(fn, ms) {
  const timer = setTimeout(fn, ms)
  if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  return timer
}

function encodeChunk(kind, id, payload) {
  const bytes = new Uint8Array(5 + payload.byteLength)
  bytes[0] = kind
  new DataView(bytes.buffer).setUint32(1, id >>> 0)
  bytes.set(payload, 5)
  return bytes
}

/**
 * A binary WebSocket message arrives as an ArrayBuffer at the edge, as a view in
 * some runtimes, and as a Blob in the local one; the Blob case is why every
 * reader is async.
 */
async function readIncoming(data) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}

function decodeChunk(bytes) {
  return { kind: bytes[0], id: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1), payload: bytes.subarray(5) }
}

/** One serial queue per socket: frames of one stream must not be reordered by an
 * async reader, so they are chained rather than fired concurrently. */
class SerialQueue {
  constructor() {
    this.tail = Promise.resolve()
  }

  push(task) {
    this.tail = this.tail.then(task).catch((error) => {
      console.warn(JSON.stringify({ relay: 'frame-error', message: String(error) }))
    })
  }
}

/** A timeout that never keeps the runtime alive on its own (the Worker's
 * setTimeout returns a number, Node's a handle). */
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') timer.unref()
  })
}

/** A promise plus the one resolver that settles it. */
function deferred() {
  let settle
  const promise = new Promise((resolve) => { settle = resolve })
  return { promise, resolve: (value) => settle(value) }
}

/** The no-connector answer: the proxy path turns this into a same-request
 * fallback to quick without ever showing it to a phone. */
function noConnector() {
  return new Response(RELAY_BRIDGE_NO_CONNECTOR, {
    status: 409,
    headers: { ...NO_STORE, [RELAY_BRIDGE_MARKER]: RELAY_BRIDGE_NO_CONNECTOR },
  })
}

function bearerOf(header) {
  const value = typeof header === 'string' ? header.trim() : ''
  if (!value.toLowerCase().startsWith('bearer ')) return ''
  return value.slice(7).trim()
}

/**
 * The object half: one connector socket per relay instance, and every
 * downstream byte pumped across it. No persistent storage -- the credential is
 * long-lived, so nothing has to survive an eviction.
 */
export class RelayBridge {
  constructor(state) {
    this.state = state
    this.connector = null
    /** Stream id -> its state. Ids are per object and monotonic, so a stream id
     * never collides with a later one, and each entry remembers which connector
     * socket owns it (a replaced socket must not fail its successor's streams). */
    this.http = new Map()
    this.sockets = new Map()
    this.verdicts = new Map()
    /** Connector socket -> its serial frame queue. */
    this.queues = new Map()
    /** The sockets this object replaced: a close event from one of them is
     * history, and must touch nothing a newer socket owns. */
    this.replaced = new WeakSet()
    this.nextId = 1
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === BRIDGE_ATTACH_PATH) return await this.attach(request)
    const upgrade = (request.headers.get('upgrade') ?? '').toLowerCase()
    if (upgrade === 'websocket') return await this.bridgeWebSocket(request)
    return await this.bridgeHttp(request)
  }

  /** Attach one connector socket. The credential was checked by the Worker, and
   * a second attach replaces the first: newest wins, the old one is closed. */
  async attach(request) {
    if (request.headers.get(RELAY_BRIDGE_ATTACH_HEADER) !== '1') {
      return new Response('not a connector attach', { status: 403, headers: NO_STORE })
    }
    if ((request.headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      return new Response('upgrade required', { status: 426, headers: NO_STORE })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    const previous = this.connector
    this.connector = server
    server.addEventListener('message', (event) => {
      const data = event.data
      const queue = this.queueOf(server)
      queue.push(async () => {
        await this.onConnectorMessage(server, data)
      })
    })
    server.addEventListener('close', () => {
      // A socket this object already replaced is history: its late close must
      // not take down a stream the newer socket is carrying.
      if (this.replaced.has(server) || this.connector !== server) return
      this.connector = null
      this.failOwnedBy(server, 'connector-closed')
    })
    if (previous !== null && previous !== server) {
      // Marked first, then failed, then closed. The marker is what makes a late
      // close event harmless, and the failure is what tells each of the old
      // socket's streams it may be asked again on the new one.
      this.replaced.add(previous)
      this.failOwnedBy(previous, 'connector-replaced')
      try {
        previous.close(1000, 'replaced')
      } catch {
        // A socket the runtime already dropped is the expected case on reconnect.
      }
    }
    console.log(JSON.stringify({
      relay: 'bridge-attach',
      instance: this.state.id.toString(),
      replaced: previous !== null && previous !== server,
    }))
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Per-socket frame queue, created on first use and dropped with the socket. */
  queueOf(socket) {
    const existing = this.queues.get(socket)
    if (existing !== undefined) return existing
    const queue = new SerialQueue()
    this.queues.set(socket, queue)
    return queue
  }

  async bridgeHttp(request) {
    const connector = this.connector
    if (connector === null) return noConnector()
    const url = new URL(request.url)
    const id = this.nextId++
    const head = deferred()
    const entry = {
      head: head.resolve,
      controller: null,
      chunks: 0,
      bytes: 0,
      connector,
      /** This stream's flow-control state: whether its window is closed, how
       * many drain events it has seen (the harvest counts those rather than
       * reading a clock), what it had to drop, and the armed harvest. */
      paused: false,
      progress: 0,
      dropped: 0,
      timer: null,
    }
    this.http.set(id, entry)

    connector.send(JSON.stringify({
      t: 'req',
      id,
      method: request.method,
      url: url.pathname + url.search,
      // The public origin the phone dialed, taken from the request URL rather
      // than from a header: this is the one value the connector must not lose,
      // and the host's local control plane is gated on it staying public.
      host: url.host,
      headers: [...request.headers],
    }))
    if (request.body === null) {
      connector.send(JSON.stringify({ t: 'end', id }))
    } else {
      void this.pumpRequestBody(request.body, connector, id)
    }

    const timedOut = Symbol('timeout')
    const settled = await Promise.race([head.promise, sleep(HEAD_TIMEOUT_MS).then(() => timedOut)])
    // A head that never arrives made no progress for the whole window, which is
    // the same failure a paused body is harvested with.
    const result = settled === timedOut
      ? { ok: false, code: 'stream-stalled', message: 'connector timed out on the response head' }
      : settled
    if (!result.ok) {
      this.http.delete(id)
      // A frozen code answers the module's canonical message; the detail this
      // object saw stays in the log, where a phone body cannot lose it.
      const frozen = relayFailure(result.code)
      if (frozen !== undefined) {
        console.warn(JSON.stringify({ relay: 'stream-failed', id, code: result.code, detail: result.message }))
        return frozen
      }
      const status = settled === timedOut ? 504 : 502
      return new Response('relay bridge: ' + result.message, { status, headers: NO_STORE })
    }
    // 204 and 304 may not carry a body at all, so no stream, no controller.
    if (result.status === 204 || result.status === 304) {
      this.http.delete(id)
      const headers = new Headers(result.headers)
      headers.set(RELAY_TRANSPORT_HEADER, 'bridge')
      return new Response(null, { status: result.status, statusText: result.statusText, headers })
    }
    const stream = new ReadableStream({
      start: (controller) => {
        entry.controller = controller
      },
      // Only the phone reading this body drains it, so a pull is the one drain
      // signal a stream has: it is what reopens a window closed at HIGH.
      pull: () => { this.onStreamDrain(id, entry) },
      cancel: () => {
        this.http.delete(id)
        this.clearStallWatch(entry)
        this.sendControl(connector, { t: 'close', id, reason: 'client-cancelled' })
      },
    }, STREAM_QUEUING)
    const headers = new Headers(result.headers)
    headers.set(RELAY_TRANSPORT_HEADER, 'bridge')
    return new Response(stream, { status: result.status, statusText: result.statusText, headers })
  }

  /** Request body chunks become frames as they arrive, so an upload streams too. */
  async pumpRequestBody(body, connector, id) {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value !== undefined) connector.send(encodeChunk(HTTP_BODY, id, value))
      }
      connector.send(JSON.stringify({ t: 'end', id }))
    } catch (error) {
      try {
        connector.send(JSON.stringify({ t: 'close', id, reason: 'upload: ' + String(error) }))
      } catch {
        // Nothing left to tell; the socket is gone.
      }
    }
  }

  /** One control frame to the connector that owns a stream. A socket already
   * gone is the replaced-connector case, not an error at this end. */
  sendControl(connector, frame) {
    try {
      connector.send(JSON.stringify(frame))
    } catch {
      // That socket's streams are being failed already; nothing left to tell.
    }
  }

  /** The phone read one chunk of a streaming body: record the progress, and
   * reopen the window once the queue is back down to LOW. */
  onStreamDrain(id, entry) {
    if (entry.paused !== true) return
    entry.progress += 1
    const queued = queuedBytes(entry.controller)
    if (queued !== null && queued <= BRIDGE_STREAM_LOW) this.resumeStream(id, entry)
  }

  /** Hand one connector chunk to the phone's body: close the window at HIGH, and
   * drop what a connector that never stops sends past the paused cap. */
  pushPayload(id, entry, payload) {
    const controller = entry.controller
    if (controller === null) return
    if (entry.paused) {
      const queued = queuedBytes(controller)
      if (queued !== null && queued + payload.byteLength > BRIDGE_STREAM_PAUSED_CAP) {
        if (entry.dropped === 0) {
          console.warn(JSON.stringify({ relay: 'stream-drop', id, cap: BRIDGE_STREAM_PAUSED_CAP }))
        }
        entry.dropped += payload.byteLength
        return
      }
    }
    try {
      controller.enqueue(payload)
    } catch {
      // The phone cancelled this body between the frame and this call.
      return
    }
    const queued = queuedBytes(controller)
    if (!entry.paused && queued !== null && queued >= BRIDGE_STREAM_HIGH) this.pauseStream(id, entry)
  }

  /** Close one stream's window: the connector stops sending its chunks and stops
   * reading upstream, and nothing further is queued for the phone. */
  pauseStream(id, entry) {
    if (entry.paused) return
    entry.paused = true
    this.sendControl(entry.connector, { t: 'pause', id })
    this.armStallWatch(id, entry)
    console.log(JSON.stringify({ relay: 'stream-pause', id, chunks: entry.chunks, dropped: entry.dropped }))
  }

  /** Reopen it: the phone has read its way back down to LOW. */
  resumeStream(id, entry) {
    if (!entry.paused) return
    entry.paused = false
    this.clearStallWatch(entry)
    this.sendControl(entry.connector, { t: 'resume', id })
    console.log(JSON.stringify({ relay: 'stream-resume', id }))
  }

  /** Arm the harvest of one paused stream. Drain progress re-arms it by making
   * the armed counter stale, so no wall clock is read at all. */
  armStallWatch(id, entry) {
    this.clearStallWatch(entry)
    const armed = entry.progress
    entry.timer = startTimer(() => {
      entry.timer = null
      if (entry.paused !== true || this.http.get(id) !== entry) return
      if (entry.progress !== armed) {
        this.armStallWatch(id, entry)
        return
      }
      this.harvestStream(id, entry)
    }, BRIDGE_STREAM_STALL_MS)
  }

  clearStallWatch(entry) {
    if (entry.timer === null) return
    clearTimeout(entry.timer)
    entry.timer = null
  }

  /**
   * Terminate one stream that never drained, and release its upstream.
   *
   * A body can only fill a window once its head is out, so the HTTP case has no
   * status left to answer: the body is aborted, which is what a phone retries
   * on, and the connector is told with the close frame a phone cancel uses --
   * this contract's name for abandoning a stream and freeing it. The phone
   * socket's own code is BRIDGE_CLOSE_STALLED, which no path reaches yet: this
   * half cannot measure a phone socket's drainage.
   */
  harvestStream(id, entry) {
    this.http.delete(id)
    this.clearStallWatch(entry)
    this.sendControl(entry.connector, { t: 'close', id, reason: 'stream-stalled' })
    if (entry.controller !== null) {
      try {
        entry.controller.error(new Error('stream-stalled'))
      } catch {
        // The phone left first; nothing is waiting for this body.
      }
    }
    console.log(JSON.stringify({
      relay: 'stream-stalled',
      id,
      chunks: entry.chunks,
      bytes: entry.bytes,
      dropped: entry.dropped,
    }))
  }

  async bridgeWebSocket(request) {
    const connector = this.connector
    if (connector === null) return noConnector()
    const url = new URL(request.url)
    const id = this.nextId++
    const verdict = deferred()
    this.verdicts.set(id, { resolve: verdict.resolve, connector })
    connector.send(JSON.stringify({
      t: 'ws-open',
      id,
      url: url.pathname + url.search,
      host: url.host,
      headers: [...request.headers],
    }))
    const accepted = await Promise.race([verdict.promise, sleep(WS_OPEN_TIMEOUT_MS).then(() => false)])
    this.verdicts.delete(id)
    if (accepted !== true) {
      return new Response('relay bridge: connector refused the upgrade', { status: 502, headers: NO_STORE })
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    server.accept()
    const entry = { socket: server, connector }
    this.sockets.set(id, entry)
    const queue = new SerialQueue()
    server.addEventListener('message', (event) => {
      const data = event.data
      queue.push(async () => {
        const bytes = await readIncoming(data)
        if (bytes === null) return
        if (typeof bytes === 'string') {
          connector.send(encodeChunk(WS_TEXT, id, new TextEncoder().encode(bytes)))
          return
        }
        connector.send(encodeChunk(WS_BINARY, id, bytes))
      })
    })
    server.addEventListener('close', () => {
      this.sockets.delete(id)
      try {
        connector.send(JSON.stringify({ t: 'close', id, reason: 'downstream-closed' }))
      } catch {
        // The connector is gone; the object is about to fail everything anyway.
      }
    })
    return new Response(null, { status: 101, webSocket: client })
  }

  async onConnectorMessage(connector, data) {
    const raw = await readIncoming(data)
    if (raw === null) return
    if (typeof raw === 'string') {
      this.onControl(connector, raw)
      return
    }
    const { kind, id, payload } = decodeChunk(raw)
    if (kind === HTTP_BODY) {
      const entry = this.http.get(id)
      if (entry === undefined) return
      entry.chunks += 1
      entry.bytes += payload.byteLength
      this.pushPayload(id, entry, payload)
      return
    }
    const peer = this.sockets.get(id)
    if (peer === undefined) return
    if (kind === WS_TEXT) peer.socket.send(new TextDecoder().decode(payload))
    else peer.socket.send(payload)
  }

  onControl(connector, raw) {
    let frame
    try {
      frame = JSON.parse(raw)
    } catch {
      console.warn(JSON.stringify({ relay: 'unparsable-control', bytes: raw.length }))
      return
    }
    const id = typeof frame.id === 'number' ? frame.id : -1
    switch (frame.t) {
      case 'res': {
        const entry = this.http.get(id)
        if (entry === undefined) return
        entry.head({
          ok: true,
          status: typeof frame.status === 'number' ? frame.status : 502,
          statusText: typeof frame.statusText === 'string' ? frame.statusText : '',
          headers: responseHeaders(frame.headers),
        })
        return
      }
      case 'fin': {
        const entry = this.http.get(id)
        if (entry === undefined) return
        this.http.delete(id)
        this.clearStallWatch(entry)
        console.log(JSON.stringify({ relay: 'bridge-done', id, chunks: entry.chunks, bytes: entry.bytes, dropped: entry.dropped }))
        if (entry.controller !== null) {
          try {
            entry.controller.close()
          } catch {
            // Already closed by a cancel from the other side.
          }
        }
        return
      }
      case 'fail': {
        const entry = this.http.get(id)
        if (entry !== undefined) {
          this.http.delete(id)
          this.clearStallWatch(entry)
          // The connector could not reach its upstream, so what the phone reads
          // is that the instance is offline -- and that it may retry, because
          // the same request works once the host is back.
          entry.head({ ok: false, code: 'instance-offline', message: String(frame.message ?? 'unknown') })
          if (entry.controller !== null) entry.controller.error(new Error(String(frame.message ?? 'connector-failed')))
          return
        }
        this.verdicts.get(id)?.resolve(false)
        return
      }
      case 'ws-accept':
        this.verdicts.get(id)?.resolve(true)
        return
      case 'ws-fail':
        console.warn(JSON.stringify({ relay: 'bridge-ws-refused', id, message: String(frame.message ?? 'unknown') }))
        this.verdicts.get(id)?.resolve(false)
        return
      case 'ws-close': {
        const peer = this.sockets.get(id)
        if (peer === undefined) return
        this.sockets.delete(id)
        try {
          peer.socket.close(typeof frame.code === 'number' ? frame.code : 1000, String(frame.reason ?? ''))
        } catch {
          // The phone side already went away.
        }
        return
      }
      case 'close': {
        const peer = this.sockets.get(id)
        if (peer !== undefined) {
          this.sockets.delete(id)
          try {
            peer.socket.close(1000, String(frame.reason ?? 'connector-cancelled'))
          } catch {
            // Same as above.
          }
          return
        }
        const entry = this.http.get(id)
        if (entry !== undefined) this.clearStallWatch(entry)
        this.http.delete(id)
        return
      }
      default:
        console.warn(JSON.stringify({ relay: 'unknown-control', t: String(frame.t) }))
    }
  }

  /** A connector that goes away leaves no half-open stream behind: everything it
   * owned fails at once, and nothing another socket owns is touched. */
  failOwnedBy(connector, reason) {
    let failed = 0
    for (const [id, entry] of this.http) {
      if (entry.connector !== connector) continue
      this.http.delete(id)
      this.clearStallWatch(entry)
      // The reason travels as the code too: a frozen one answers with its own
      // status and the retry hint, anything older keeps the plain answer.
      entry.head({ ok: false, code: reason, message: reason })
      if (entry.controller !== null) {
        try {
          entry.controller.error(new Error(reason))
        } catch {
          // Already settled by a cancel from the other side.
        }
      }
      failed += 1
    }
    for (const [id, peer] of this.sockets) {
      if (peer.connector !== connector) continue
      this.sockets.delete(id)
      // A replaced connector's phone sockets are told to reconnect at once; one
      // that merely went away is an internal error, not a server instruction.
      try {
        peer.socket.close(reason === 'connector-replaced' ? BRIDGE_CLOSE_REPLACED : 1011, reason)
      } catch {
        // Nothing left to close it with.
      }
      failed += 1
    }
    for (const [id, verdict] of this.verdicts) {
      if (verdict.connector !== connector) continue
      this.verdicts.delete(id)
      verdict.resolve(false)
      failed += 1
    }
    this.queues.delete(connector)
    if (failed > 0) console.log(JSON.stringify({ relay: 'bridge-failed', reason, streams: failed }))
  }
}

/** The queue map has to exist before any socket does. */
function responseHeaders(raw) {
  const headers = new Headers()
  if (!Array.isArray(raw)) return headers
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [name, value] = entry
    if (typeof name !== 'string' || typeof value !== 'string') continue
    if (DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) continue
    headers.append(name, value)
  }
  return headers
}

/**
 * The secret hash one id authenticates against: the lease row first (a claimed
 * instance), then the registry row (an instance that only runs the quick
 * connector). The bridge must be able to idle for both.
 * @returns the stored hash, or undefined when the id is unknown.
 */
async function bridgeSecretHashOf(env, id) {
  const lease = await env.DB.prepare('SELECT secret_hash FROM relay_leases WHERE id = ?1').bind(id).first()
  if (lease && typeof lease.secret_hash === 'string') return lease.secret_hash
  const registration = await env.DB.prepare('SELECT secret_hash FROM relay_registrations WHERE id = ?1').bind(id).first()
  if (registration && typeof registration.secret_hash === 'string') return registration.secret_hash
  return undefined
}

/** Spend the registry's two windows for one id, and report the resulting counts. */
async function spendBridgeWindows(env, ip, id) {
  const windowStart = Math.floor(Date.now() / REGISTER_WINDOW_MS) * REGISTER_WINDOW_MS
  const buckets = ['ip:' + ip, 'id:' + id]
  const spend = (bucket) => env.DB.prepare(
    'INSERT INTO relay_rate_limit (bucket, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1'
  ).bind(bucket, windowStart)
  const read = (bucket) => env.DB.prepare('SELECT count FROM relay_rate_limit WHERE bucket = ?1 AND window_start = ?2').bind(bucket, windowStart)
  await env.DB.batch([spend(buckets[0]), spend(buckets[1])])
  const counts = await env.DB.batch([read(buckets[0]), read(buckets[1])])
  return buckets.map((_, index) => {
    const rows = counts[index] && counts[index].results
    return Number(rows && rows[0] && rows[0].count) || 0
  })
}

/**
 * The Worker's door for a bridge upgrade (`GET /api/relay/bridge?id=<id>`).
 * It authenticates before the object exists in the picture: an unknown id and a
 * wrong secret answer alike, the upgrade is rate-limited on the registry's
 * windows, and only an approved connection reaches the instance's object.
 */
export async function handleRelayBridgeUpgrade(request, env) {
  const upgrade = (request.headers.get('upgrade') ?? '').toLowerCase()
  if (upgrade !== 'websocket') return new Response('upgrade required', { status: 426, headers: NO_STORE })
  if (env.RELAY_BRIDGE === undefined) return new Response('bridge unavailable', { status: 503, headers: NO_STORE })
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  const presented = bearerOf(request.headers.get('authorization'))
  if (!ID_RE.test(id) || !SECRET_RE.test(presented)) return new Response('credential refused', { status: 403, headers: NO_STORE })

  let stored
  try {
    stored = await bridgeSecretHashOf(env, id)
  } catch {
    return new Response('relay storage unavailable', { status: 503, headers: NO_STORE })
  }
  // An unknown id and a wrong secret answer alike: this door is not an oracle
  // for other instances' hostnames, and the compare does not leak its answer.
  if (stored === undefined || !timingSafeEqualStr(await sha256Hex(presented), stored)) {
    return new Response('credential refused', { status: 403, headers: NO_STORE })
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  let spent
  try {
    spent = await spendBridgeWindows(env, ip, id)
  } catch {
    return new Response('relay storage unavailable', { status: 503, headers: NO_STORE })
  }
  if (spent[0] > BRIDGE_MAX_PER_IP || spent[1] > BRIDGE_MAX_PER_ID) {
    return new Response('rate limited', { status: 429, headers: NO_STORE })
  }

  const headers = new Headers(request.headers)
  headers.set(RELAY_BRIDGE_ATTACH_HEADER, '1')
  // The credential has done its work at the door and does not travel on.
  headers.delete('authorization')
  headers.delete('cookie')
  const attach = new Request(new URL(BRIDGE_ATTACH_PATH, url.origin).href, { method: 'GET', headers })
  return await env.RELAY_BRIDGE.get(env.RELAY_BRIDGE.idFromName(id)).fetch(attach)
}
