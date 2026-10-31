/**
 * The bridge connector against real sockets: a local stand-in for the Durable
 * Object speaks the frame contract on one WebSocket, and a local HTTP server
 * stands in for the DSH host.
 *
 * The rule this file pins hardest is the one the shadow flight measured: the
 * connector forwards the public origin as Host and never substitutes the
 * loopback authority it dials. The host's local control plane is gated on the
 * Host header alone (the socket is loopback either way), so a connector that
 * rewrote it would publish /remote-bridge/pair/token and /api/pair/* on the
 * public origin -- the first test shows both sides of that gate.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  RelayBridgeConnector,
  bridgeUpgradeHeaders,
  bridgeUpstreamHeaders,
  bridgeUpstreamHost,
  createBridgeFrameParser,
  createRelayBridgeRunner,
  isBridgeInboundPath,
  relayBridgeDialUrl,
  relayBridgeStateFile,
  writeRelayBridgeState,
  type RelayBridgeState,
  type RelayBridgeStateRecord,
} from '../src/host/relay-bridge-connector.ts'

const ID = 'abcd1234abcd1234'
const HOSTNAME = ID + '.dsh-market.com'
const SECRET = 'A'.repeat(43)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
/** What the host's control plane answers a request that is not local. */
const NOT_THIS_MACHINE = 'the request names a Host that is not this machine'

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

/** One payload frame of the bridge contract. */
function chunkFrame(kind: number, id: number, payload: Buffer): Buffer {
  const bytes = Buffer.alloc(5 + payload.length)
  bytes[0] = kind
  bytes.writeUInt32BE(id >>> 0, 1)
  payload.copy(bytes, 5)
  return bytes
}

/** The payload of one bridge payload frame. */
function chunkOf(frame: Buffer): { kind: number; id: number; payload: Buffer } {
  return { kind: frame[0], id: frame.readUInt32BE(1), payload: frame.subarray(5) }
}

/** The next value a producer announces, without polling. */
function feedOf<T>() {
  const waiters: Array<{ match: (value: T) => boolean; resolve: (value: T) => void }> = []
  return {
    push(value: T) {
      for (const waiter of [...waiters]) {
        if (!waiter.match(value)) continue
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(value)
      }
    },
    next(match: (value: T) => boolean = () => true) {
      return new Promise<T>((resolve) => { waiters.push({ match, resolve }) })
    },
  }
}

type Control = Record<string, unknown>

interface BridgeStandIn {
  endpoint: string
  /** The credentials every attach presented. */
  credentials: string[]
  /** The sockets the stand-in attached, in order. */
  sockets: import('node:net').Socket[]
  controls: ReturnType<typeof feedOf<Control>>
  chunks: ReturnType<typeof feedOf<Buffer>>
  /** Resolves when the connector has attached (again). */
  nextAttach(): Promise<void>
  /** Send one frame of the contract to the connector. */
  send(frame: Control | Buffer): void
  close(): Promise<void>
}

/** A stand-in for the object: one WS endpoint speaking the bridge contract. */
async function startBridgeStandIn(): Promise<BridgeStandIn> {
  const credentials: string[] = []
  const sockets: import('node:net').Socket[] = []
  const controls = feedOf<Control>()
  const chunks = feedOf<Buffer>()
  const attaches = feedOf<void>()
  const server = http.createServer((_request, response) => {
    response.statusCode = 400
    response.end('upgrade only')
  })
  server.on('upgrade', (request, socket: import('node:net').Socket) => {
    credentials.push(String(request.headers.authorization))
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + WS_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    sockets.push(socket)
    const parse = createBridgeFrameParser((frame) => {
      if (frame.opcode === 0x1) {
        controls.push(JSON.parse(frame.payload.toString('utf8')) as Control)
        return
      }
      if (frame.opcode === 0x2) chunks.push(frame.payload)
    })
    socket.on('data', parse)
    socket.on('error', () => undefined)
    attaches.push(undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    endpoint: 'ws://127.0.0.1:' + String(port) + '/api/relay/bridge',
    credentials,
    sockets,
    controls,
    chunks,
    nextAttach: () => attaches.next(),
    send(frame) {
      const socket = sockets[sockets.length - 1]
      if (socket === undefined) throw new Error('no bridge socket attached')
      socket.write(Buffer.isBuffer(frame) ? serverFrame(0x2, frame) : serverFrame(0x1, Buffer.from(JSON.stringify(frame))))
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** One request the host stand-in received. */
interface HostRequest {
  url: string
  host: string
  headers: http.IncomingHttpHeaders
}

interface HostStandIn {
  origin: string
  received: HostRequest[]
  close(): Promise<void>
}

/**
 * A stand-in for the DSH host. Its one endpoint is the local control plane,
 * gated exactly as the harness applies it: the socket is loopback for every
 * bridged request, so the Host header is the only thing that decides.
 */
async function startHostStandIn(): Promise<HostStandIn> {
  const received: HostRequest[] = []
  const openSockets: import('node:net').Socket[] = []
  const server = http.createServer((request, response) => {
    const host = String(request.headers.host ?? '')
    received.push({ url: request.url ?? '', host, headers: request.headers })
    const local = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
    response.statusCode = local ? 200 : 403
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(local ? 'issued-a-pair-token' : NOT_THIS_MACHINE)
  })
  server.on('upgrade', (request, socket: import('node:net').Socket) => {
    received.push({ url: request.url ?? '', host: String(request.headers.host ?? ''), headers: request.headers })
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + WS_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    socket.write(serverFrame(0x1, Buffer.from('pong:ping-1')))
    openSockets.push(socket)
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: 'http://127.0.0.1:' + String(port),
    received,
    async close() {
      for (const socket of openSockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** One connector against a bridge and host stand-in. */
function startConnector(bridge: BridgeStandIn, host: HostStandIn, options: Partial<ConstructorParameters<typeof RelayBridgeConnector>[0]> = {}) {
  const connector = new RelayBridgeConnector({
    endpoint: bridge.endpoint,
    id: ID,
    secret: SECRET,
    hostname: HOSTNAME,
    upstream: host.origin,
    ...options,
  })
  cleanups.push(async () => { connector.stop() })
  connector.start()
  return connector
}

describe('the bridge connector forwards what the phone dialed', () => {
  it('operator keeps the public origin as Host so the local control plane stays closed', async () => {
    // Given a host whose control plane answers only a request that names this
    //       machine, and a bridge that relays one such request
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    cleanups.push(() => bridge.close(), () => host.close())
    const attaching = bridge.nextAttach()
    startConnector(bridge, host)
    await attaching

    // When the object relays the phone's request for the pair token
    // The path must be the one this connector serves: anything else is now
    // answered 404 at this hop and would never reach the host, so the Host the
    // host actually saw could not be observed at all
    const headSeen = bridge.controls.next((frame) => frame.t === 'res')
    bridge.send({
      t: 'req',
      id: 7,
      method: 'GET',
      url: '/ios/v1',
      host: HOSTNAME,
      headers: [['host', HOSTNAME], ['cf-connecting-ip', '203.0.113.9'], ['cookie', 'pair=1']],
    })
    bridge.send({ t: 'end', id: 7 })

    // Then the host saw the public origin and refused the request, while the
    // same upstream asked with a loopback Host would have issued a token --
    // that difference is the whole reason this connector never rewrites Host
    const head = await headSeen
    expect(head.status).toBe(403)
    expect(host.received[0].host).toBe(HOSTNAME)
    expect(host.received[0].headers['cf-connecting-ip']).toBeUndefined()
    expect(host.received[0].headers.cookie).toBe('pair=1')
    const direct = await startHostStandIn()
    cleanups.push(() => direct.close())
    const forged = await new Promise<string>((resolve) => {
      http.get({ host: '127.0.0.1', port: Number(new URL(direct.origin).port), path: '/remote-bridge/pair/token', headers: { host: '127.0.0.1:55220' } }, (response) => {
        let body = ''
        response.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
        response.on('end', () => resolve(body))
      })
    })
    expect(forged).toBe('issued-a-pair-token')
  })

  it('operator cannot make the connector invent a loopback Host', () => {
    // Given a frame that names no origin at all
    // When the connector builds the upstream Host
    // Then it falls back to this instance's claimed relay hostname, and the
    // loopback authority it dials is never a candidate
    expect(bridgeUpstreamHost(undefined, HOSTNAME)).toBe(HOSTNAME)
    expect(bridgeUpstreamHost('', HOSTNAME)).toBe(HOSTNAME)
    expect(bridgeUpstreamHost(HOSTNAME, 'other.example')).toBe(HOSTNAME)
    expect(bridgeUpstreamHeaders([['host', '127.0.0.1:55220'], ['accept', 'text/html']], HOSTNAME)).toEqual({
      accept: 'text/html',
      host: HOSTNAME,
    })
  })

  it('operator reconnects with the same long-lived credential and no ticket', async () => {
    // Given a connector that attached once and then lost its socket
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    cleanups.push(() => bridge.close(), () => host.close())
    const states: RelayBridgeState[] = []
    const scheduled: Array<() => void> = []
    const attaching = bridge.nextAttach()
    const lost = feedOf<RelayBridgeState>()
    startConnector(bridge, host, {
      baseDelayMs: 1,
      maxDelayMs: 2,
      timerFn: (fn) => { scheduled.push(fn); return { unref() {} } },
      onState: (state) => { states.push(state); lost.push(state) },
    })
    await attaching
    bridge.sockets[0].destroy()
    await lost.next((state) => state.state === 'failed')

    // When the retry fires
    const redialed = bridge.nextAttach()
    scheduled.shift()?.()
    await redialed

    // Then the second attach presented the same credential again: there is no
    // ticket to spend and no new instance to move to
    expect(bridge.credentials).toEqual(['Bearer ' + SECRET, 'Bearer ' + SECRET])
    expect(states.map((state) => state.state)).toContain('failed')
    expect(relayBridgeDialUrl(bridge.endpoint, ID)).toBe(bridge.endpoint + '?id=' + ID)
    expect(bridgeUpgradeHeaders('wss://dsh-market.com/api/relay/bridge', SECRET)).toMatchObject({
      authorization: 'Bearer ' + SECRET,
      host: 'dsh-market.com',
      upgrade: 'websocket',
    })
  })

  it('operator sees a phone WebSocket travel through the connector', async () => {
    // Given a bridged phone upgrade the host accepts
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    cleanups.push(() => bridge.close(), () => host.close())
    const attaching = bridge.nextAttach()
    startConnector(bridge, host)
    await attaching

    // When the object opens a phone socket and relays one text frame
    const verdict = bridge.controls.next((frame) => frame.t === 'ws-accept' || frame.t === 'ws-fail')
    const answer = bridge.chunks.next((frame) => chunkOf(frame).kind === 3)
    bridge.send({ t: 'ws-open', id: 3, url: '/ios/v1', host: HOSTNAME, headers: [['host', HOSTNAME]] })
    expect((await verdict).t).toBe('ws-accept')
    bridge.send(chunkFrame(3, 3, Buffer.from('ping-1')))

    // Then the host dialed the socket on the public origin and its answer came
    // back as a payload frame the object hands to the phone
    expect(chunkOf(await answer).payload.toString('utf8')).toBe('pong:ping-1')
    expect(host.received[0].host).toBe(HOSTNAME)
    expect(host.received[0].url).toBe('/ios/v1')
  })
})

describe('the connector serves one inbound path and refuses the rest', () => {
  it('operator: the whitelist matches the path, not a whole URL', () => {
    // Given the one path the protocol serves, which the pairing link carries a
    // one-shot ticket in the query of
    // When the predicate is asked about URLs around it
    // Then exactly that path passes: a longer path, a longer segment, another
    // route, and an empty URL are all refused
    expect(isBridgeInboundPath('/ios/v1')).toBe(true)
    expect(isBridgeInboundPath('/ios/v1?token=' + 't'.repeat(8))).toBe(true)
    expect(isBridgeInboundPath('/ios/v1/extra')).toBe(false)
    expect(isBridgeInboundPath('/ios/v10')).toBe(false)
    expect(isBridgeInboundPath('/ios/v1/')).toBe(false)
    expect(isBridgeInboundPath('/remote-bridge/pair/token')).toBe(false)
    expect(isBridgeInboundPath('/api/pair/start')).toBe(false)
    expect(isBridgeInboundPath('/')).toBe(false)
    expect(isBridgeInboundPath('')).toBe(false)
  })

  it('operator: any other HTTP path is answered 404 and never dialed', async () => {
    // Given an attached connector
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    cleanups.push(() => bridge.close(), () => host.close())
    const attaching = bridge.nextAttach()
    startConnector(bridge, host)
    await attaching

    // When the object relays a request for a path the connector does not serve
    const headSeen = bridge.controls.next((frame) => frame.t === 'res')
    const bodySeen = bridge.chunks.next((frame) => chunkOf(frame).kind === 1)
    bridge.send({
      t: 'req',
      id: 11,
      method: 'GET',
      url: '/api/pair/start',
      host: HOSTNAME,
      headers: [['host', HOSTNAME]],
    })
    bridge.send({ t: 'end', id: 11 })

    // Then the connector answered 404 with the contract body, and the host was
    // never dialed at all
    expect((await headSeen).status).toBe(404)
    expect(chunkOf(await bodySeen).payload.toString('utf8')).toBe('{"error":"not-found"}')
    expect(host.received).toEqual([])
  })

  it('operator: any other upgrade is refused with 404 and never dialed', async () => {
    // Given an attached connector
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    cleanups.push(() => bridge.close(), () => host.close())
    const attaching = bridge.nextAttach()
    startConnector(bridge, host)
    await attaching

    // When the object relays a phone upgrade for a path out of the whitelist
    const verdict = bridge.controls.next((frame) => frame.t === 'ws-accept' || frame.t === 'ws-fail')
    bridge.send({
      t: 'ws-open',
      id: 12,
      url: '/remote-bridge/pair/token',
      host: HOSTNAME,
      headers: [['host', HOSTNAME]],
    })

    // Then the connector refused it rather than accepting it, and no upstream
    // socket was ever dialed on its behalf
    const answer = await verdict
    expect(answer.t).toBe('ws-fail')
    expect(host.received).toEqual([])
  })
})

describe('the connector state is readable where no stdout is', () => {
  it('operator finds the dial facts in the state file after a host restart', () => {
    // Given a $DSH_HOME the plugin may write and one record
    const home = mkdtempSync(join(tmpdir(), 'dsh-bridge-state-'))
    cleanups.push(async () => { rmSync(home, { recursive: true, force: true }) })
    const file = relayBridgeStateFile(home)
    const record: RelayBridgeStateRecord = {
      state: 'failed',
      instance: ID,
      hostname: HOSTNAME,
      endpoint: 'wss://dsh-market.com/api/relay/bridge',
      upstream: 'http://127.0.0.1:56671',
      at: '2026-10-23T03:30:00.000Z',
      error: 'socket closed',
    }

    // When the connector records it
    writeRelayBridgeState(file, record)

    // Then the file names the state and the lease it belongs to, and the
    // staged temp file never survives the write
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(record)
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true)
    expect(() => readFileSync(file + '.tmp')).toThrow()
  })

  it('operator reads the runner state from the file, not from the host log', async () => {
    // Given a runner whose object answers the upgrade
    const bridge = await startBridgeStandIn()
    const host = await startHostStandIn()
    const home = mkdtempSync(join(tmpdir(), 'dsh-bridge-runner-'))
    cleanups.push(() => bridge.close(), () => host.close(), async () => { rmSync(home, { recursive: true, force: true }) })
    const file = relayBridgeStateFile(home)
    const states: RelayBridgeState[] = []
    let markConnected = (): void => undefined
    const connected = new Promise<void>((resolve) => { markConnected = resolve })
    const runner = createRelayBridgeRunner({
      stateFile: file,
      now: () => '2026-10-23T03:30:00.000Z',
      onState: (state) => {
        states.push(state)
        if (state.state === 'connected') markConnected()
      },
    })
    cleanups.push(async () => { runner.stop() })

    // When one accepted lease starts it
    const attaching = bridge.nextAttach()
    runner.start({
      identity: { id: ID, secret: SECRET },
      port: Number(new URL(host.origin).port),
      claim: {
        mode: 'bridge',
        tunnel: { id: 'tun-1', token: 'named-token' },
        hostname: HOSTNAME,
        dns: { target: 'tun-1.cfargotunnel.com' },
        bridge: { endpoint: bridge.endpoint, instance: ID, credential: 'lease-secret' },
      },
    })
    // The record is written before the observer is told, so the connector's own
    // transition (not the stand-in accepting the upgrade) is what the file holds
    await Promise.all([bridge.nextAttach(), connected])

    // Then the file names the attached state and the exact lease behind it
    const record = JSON.parse(readFileSync(file, 'utf8')) as RelayBridgeStateRecord
    expect(record).toEqual({
      state: 'connected',
      instance: ID,
      hostname: HOSTNAME,
      endpoint: bridge.endpoint,
      upstream: host.origin,
      at: '2026-10-23T03:30:00.000Z',
    })
    expect(runner.state.state).toBe('connected')
  })
})
