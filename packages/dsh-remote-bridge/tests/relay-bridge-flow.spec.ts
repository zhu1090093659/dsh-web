/**
 * The bridge connector against real sockets, for the half of the frame contract
 * the object drives: per-stream flow control and stream release.
 *
 * A stand-in for the object speaks the frame contract on one WebSocket, and a
 * local HTTP server stands in for the DSH host. The host keeps producing bytes
 * on its own clock, so a pause is visible as a stream that stops arriving and a
 * resume as one that starts again -- which is the whole rule: a paused stream
 * must not send its payload frames, and its upstream must stop being read.
 *
 * The other direction matters just as much: an object that predates the window
 * sends none of these frames, and this half must behave exactly as it did
 * before.
 */
import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RelayBridgeConnector,
  createBridgeFrameParser,
} from '../src/host/relay-bridge-connector.ts'

const ID = 'abcd1234abcd1234'
const HOSTNAME = ID + '.dsh-market.com'
const SECRET = 'A'.repeat(43)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** The one inbound path the connector serves, so a stream reaches the host. */
const SERVED_PATH = '/ios/v1'
/** A path this connector does not serve, refused on the spot without dialing. */
const REFUSED_PATH = '/not-served'
/** The stream id that refusal is asked under, which no test opens. */
const FENCE_ID = 99
/** How long a paused stream is watched for stray frames. */
const QUIET_MS = 40
/** How long a stream is given to start flowing before the pause. */
const FLOW_MS = 10_000

type Control = Record<string, unknown>

/** One unmasked server frame (the dialing side masks, a server does not). */
function serverFrame(opcode: number, payload: Buffer): Buffer {
  const head = payload.length < 126 ? 2 : 4
  const bytes = Buffer.alloc(head + payload.length)
  bytes[0] = 0x80 | opcode
  if (payload.length < 126) {
    bytes[1] = payload.length
  } else {
    bytes[1] = 126
    bytes.writeUInt16BE(payload.length, 2)
  }
  payload.copy(bytes, head)
  return bytes
}

/** The payload of one bridge payload frame. */
function chunkOf(frame: Buffer): { kind: number; id: number; payload: Buffer } {
  return { kind: frame[0], id: frame.readUInt32BE(1), payload: frame.subarray(5) }
}

/** Poll one predicate until it holds, or fail the test that waited. */
function waitFor(predicate: () => boolean, what: string, timeoutMs = FLOW_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const poll = (): void => {
      if (predicate()) {
        resolve()
        return
      }
      if (Date.now() > deadline) {
        reject(new Error('timed out waiting for ' + what))
        return
      }
      setTimeout(poll, 2) // test-standards-allow: no-arbitrary-sleep — the bounded waitFor poll the rule names, not a fixed-duration sleep
    }
    poll()
  })
}

/**
 * Fence everything sent so far. One request for a path this connector refuses
 * on the spot is answered over the same socket, so that answer proves the
 * frames before it were processed and the frames before those already arrived:
 * a count read behind the fence cannot grow by a frame written before it.
 */
async function fence(bridge: BridgeStandIn): Promise<void> {
  bridge.send({ t: 'req', id: FENCE_ID, method: 'GET', url: REFUSED_PATH, host: HOSTNAME, headers: [['host', HOSTNAME]] })
  await waitFor(
    () => bridge.controls.some((frame) => frame.t === 'res' && frame.id === FENCE_ID && frame.status === 404),
    'the refused request to answer',
  )
}

/**
 * Watch one observed count over a quiet window, and fail if it moved. A pause
 * is defined by the frames that do not arrive, so the window is the assertion
 * itself rather than a wait for work to finish; the bound keeps its cost fixed
 * and the failure names the stream that spoke.
 */
async function expectQuiet(what: string, observe: () => number, held: number): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, QUIET_MS) }) // test-standards-allow: no-arbitrary-sleep — the bounded quiet window a paused stream is asserted against
  expect(observe(), what + ' stayed quiet for ' + String(QUIET_MS) + ' ms').toBe(held)
}

interface BridgeStandIn {
  endpoint: string
  controls: Control[]
  frames: Buffer[]
  /** Everything the connector sent for one stream, of one payload kind. */
  payloadsOf(id: number, kind?: number): Buffer[]
  send(frame: Control): void
  close(): Promise<void>
}

/** A stand-in for the object: one WS endpoint speaking the bridge contract. */
async function startBridge(): Promise<BridgeStandIn> {
  const controls: Control[] = []
  const frames: Buffer[] = []
  const sockets: Socket[] = []
  const server = http.createServer((_request, response) => {
    response.statusCode = 400
    response.end('upgrade only')
  })
  server.on('upgrade', (request, socket: Socket) => {
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + WS_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    sockets.push(socket)
    const parse = createBridgeFrameParser((frame) => {
      if (frame.opcode === 0x1) {
        controls.push(JSON.parse(frame.payload.toString('utf8')) as Control)
        return
      }
      if (frame.opcode === 0x2) frames.push(frame.payload)
    })
    socket.on('data', parse)
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    endpoint: 'ws://127.0.0.1:' + String(port) + '/api/relay/bridge',
    controls,
    frames,
    payloadsOf(id, kind) {
      return frames
        .map((frame) => chunkOf(frame))
        .filter((chunk) => chunk.id === id && (kind === undefined || chunk.kind === kind))
        .map((chunk) => chunk.payload)
    },
    send(frame) {
      const socket = sockets[sockets.length - 1]
      if (socket === undefined) throw new Error('no bridge socket attached')
      socket.write(serverFrame(0x1, Buffer.from(JSON.stringify(frame))))
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

interface StreamingHost {
  origin: string
  /** What the host observed about the streams it was told to produce. */
  observed: { responses: number; closed: number; writeFails: number }
  close(): Promise<void>
}

/** A host that streams one bridged response, a chunk at a time, until the peer
 * stops reading or the stream is destroyed. */
async function startStreamingHost(intervalMs = 2): Promise<StreamingHost> {
  const observed = { responses: 0, closed: 0, writeFails: 0 }
  const sockets: Socket[] = []
  const server = http.createServer((_request, response) => {
    observed.responses += 1
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    const timer = setInterval(() => { // test-standards-allow: no-arbitrary-sleep — the stand-in host produces the body on its own clock; no test waits on this timer
      if (response.destroyed || response.writableEnded) return
      if (!response.write(Buffer.alloc(1024, 0x61))) observed.writeFails += 1
    }, intervalMs)
    response.on('close', () => {
      observed.closed += 1
      clearInterval(timer)
    })
  })
  server.on('connection', (socket: Socket) => { sockets.push(socket) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: 'http://127.0.0.1:' + String(port),
    observed,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** A host that answers a phone upgrade and then keeps sending text frames. */
async function startTickingSocketHost(intervalMs = 2): Promise<StreamingHost> {
  const observed = { responses: 0, closed: 0, writeFails: 0 }
  const sockets: Socket[] = []
  const server = http.createServer((_request, response) => {
    response.statusCode = 400
    response.end('upgrade only')
  })
  server.on('upgrade', (request, socket: Socket) => {
    observed.responses += 1
    sockets.push(socket)
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + WS_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    const timer = setInterval(() => { // test-standards-allow: no-arbitrary-sleep — the stand-in host ticks its own socket; no test waits on this timer
      if (socket.destroyed) return
      if (!socket.write(serverFrame(0x1, Buffer.from('tick')))) observed.writeFails += 1
    }, intervalMs)
    socket.on('close', () => {
      observed.closed += 1
      clearInterval(timer)
    })
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: 'http://127.0.0.1:' + String(port),
    observed,
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/** One connector against a bridge and host stand-in, attached and ready. */
async function attachedConnector(bridge: BridgeStandIn, host: StreamingHost): Promise<RelayBridgeConnector> {
  const connector = new RelayBridgeConnector({
    endpoint: bridge.endpoint,
    id: ID,
    secret: SECRET,
    hostname: HOSTNAME,
    upstream: host.origin,
  })
  cleanups.push(async () => { connector.stop() })
  connector.start()
  await waitFor(() => bridge.controls.length >= 0 && connector.connected, 'the connector to attach')
  return connector
}

/** Open one bridged stream for the served path, and wait until it flows. */
async function openStream(bridge: BridgeStandIn, id: number): Promise<void> {
  bridge.send({ t: 'req', id, method: 'GET', url: SERVED_PATH, host: HOSTNAME, headers: [['host', HOSTNAME]] })
  bridge.send({ t: 'end', id })
  await waitFor(() => bridge.payloadsOf(id, 1).length >= 3, 'the bridged body to flow')
}

describe('a closed window holds one stream back', () => {
  it('operator: a paused body stops sending frames and a resume starts them again', async () => {
    // Given a bridged response whose body is arriving a chunk at a time
    const bridge = await startBridge()
    const host = await startStreamingHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    await openStream(bridge, 5)

    // When the object closes the window on that stream
    bridge.send({ t: 'pause', id: 5 })
    await fence(bridge)
    const held = bridge.payloadsOf(5, 1).length

    // Then not one more payload frame of that stream arrives: the upstream is
    // not being read, so the backlog stays in its socket
    await expectQuiet('stream 5 while paused', () => bridge.payloadsOf(5, 1).length, held)

    // When the object reopens it
    bridge.send({ t: 'resume', id: 5 })

    // Then the body flows again, from where it stopped
    await waitFor(() => bridge.payloadsOf(5, 1).length > held, 'the body to flow again')
  })

  it('operator: a pause holds back only its own stream', async () => {
    // Given two bridged bodies flowing at once
    const bridge = await startBridge()
    const host = await startStreamingHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    await openStream(bridge, 11)
    await openStream(bridge, 12)

    // When the object closes the window on one of them
    bridge.send({ t: 'pause', id: 11 })
    await fence(bridge)
    const heldFirst = bridge.payloadsOf(11, 1).length
    const heldSecond = bridge.payloadsOf(12, 1).length

    // Then the paused one is silent and the other never stopped
    await expectQuiet('stream 11 while paused', () => bridge.payloadsOf(11, 1).length, heldFirst)
    expect(bridge.payloadsOf(12, 1).length).toBeGreaterThan(heldSecond)
  })

  it('operator: a paused phone socket stops forwarding the upstream frames', async () => {
    // Given a phone WebSocket whose upstream keeps talking
    const bridge = await startBridge()
    const host = await startTickingSocketHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    bridge.send({ t: 'ws-open', id: 21, url: SERVED_PATH, host: HOSTNAME, headers: [['host', HOSTNAME]] })
    await waitFor(() => bridge.controls.some((frame) => frame.t === 'ws-accept' && frame.id === 21), 'the upgrade to be accepted')
    await waitFor(() => bridge.payloadsOf(21, 3).length >= 3, 'the socket frames to flow')

    // When the object closes the window on that socket
    bridge.send({ t: 'pause', id: 21 })
    await fence(bridge)
    const held = bridge.payloadsOf(21, 3).length

    // Then its payload frames stop, and they resume when the window reopens
    await expectQuiet('socket 21 while paused', () => bridge.payloadsOf(21, 3).length, held)
    bridge.send({ t: 'resume', id: 21 })
    await waitFor(() => bridge.payloadsOf(21, 3).length > held, 'the socket frames to flow again')
  })
})

describe('an abandoned stream releases everything behind it', () => {
  it('operator: cancel and close both drop the upstream the object gave up on', async () => {
    // Given two bridged bodies in flight
    const bridge = await startBridge()
    const host = await startStreamingHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    await openStream(bridge, 31)
    await openStream(bridge, 32)

    // When the object abandons them, one under each spelling of the same rule,
    // and the reason is the one the harvest sends
    bridge.send({ t: 'cancel', id: 31, reason: 'stream-stalled' })
    bridge.send({ t: 'close', id: 32, reason: 'stream-stalled' })

    // Then both upstream responses are destroyed, so nothing keeps reading and
    // nothing keeps sending for a stream the object no longer has
    await waitFor(() => host.observed.closed >= 2, 'both upstream responses to close')
    await fence(bridge)
    const afterCancel = bridge.payloadsOf(31, 1).length
    const afterClose = bridge.payloadsOf(32, 1).length
    await expectQuiet('stream 31 after the cancel', () => bridge.payloadsOf(31, 1).length, afterCancel)
    await expectQuiet('stream 32 after the close', () => bridge.payloadsOf(32, 1).length, afterClose)
  })

  it('operator: a cancelled phone socket is closed upstream too', async () => {
    // Given a phone WebSocket the host accepted
    const bridge = await startBridge()
    const host = await startTickingSocketHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    bridge.send({ t: 'ws-open', id: 41, url: SERVED_PATH, host: HOSTNAME, headers: [['host', HOSTNAME]] })
    await waitFor(() => bridge.controls.some((frame) => frame.t === 'ws-accept' && frame.id === 41), 'the upgrade to be accepted')

    // When the object abandons that stream
    bridge.send({ t: 'cancel', id: 41, reason: 'stream-stalled' })

    // Then the upstream socket goes with it
    await waitFor(() => host.observed.closed >= 1, 'the upstream socket to close')
  })
})

describe('a half this connector was not written against still works', () => {
  it('operator: a control frame from a newer contract is ignored, not answered', async () => {
    // Given an attached connector
    const bridge = await startBridge()
    const host = await startStreamingHost()
    cleanups.push(() => bridge.close(), () => host.close())
    const connector = await attachedConnector(bridge, host)
    const before = bridge.controls.length

    // When the object sends a frame this build has never heard of
    bridge.send({ t: 'future-frame', id: 51, payload: { anything: true } })

    // Then the connector neither answers it nor loses the socket, and a request
    // still travels end to end: that request is served after this frame, so its
    // answer is also the proof the unknown frame was read and left alone
    await openStream(bridge, 52)
    expect(connector.connected).toBe(true)
    expect(bridge.controls.length).toBeGreaterThan(before)
    expect(bridge.controls.filter((frame) => frame.t === 'future-frame')).toEqual([])
    expect(bridge.payloadsOf(52, 1).length).toBeGreaterThan(0)
  })

  it('operator: an object that never sends flow control sees the old behaviour', async () => {
    // Given a body that arrives, ends, and is never paused
    const bridge = await startBridge()
    const host = await startStreamingHost()
    cleanups.push(() => bridge.close(), () => host.close())
    await attachedConnector(bridge, host)
    bridge.send({ t: 'req', id: 61, method: 'GET', url: SERVED_PATH, host: HOSTNAME, headers: [['host', HOSTNAME]] })
    bridge.send({ t: 'end', id: 61 })

    // When the object takes the head and the whole body
    await waitFor(() => bridge.controls.some((frame) => frame.t === 'res' && frame.id === 61), 'the response head')
    const head = bridge.controls.find((frame) => frame.t === 'res' && frame.id === 61)
    expect(head?.status).toBe(200)

    // Then this half answered exactly the frames it always did: nothing in the
    // connector's own vocabulary is new, so an object that knows no flow control
    // reads this connector as it always did
    const known = new Set(['res', 'fin', 'fail', 'ws-accept', 'ws-fail', 'ws-close', 'close'])
    const unknown = bridge.controls.filter((frame) => !known.has(String(frame.t)))
    expect(unknown).toEqual([])
  })
})
