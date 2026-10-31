/**
 * The bridge connector: the plugin side of the relay bridge, grown from the
 * shadow-flight probe (`probe/relay-bridge/connector.mjs`).
 *
 * It dials the instance's Durable Object meeting point over WSS and serves
 * every stream the object multiplexes onto that one socket -- HTTP requests
 * with streamed bodies and responses, and the phone's own WebSocket upgrades.
 *
 * Three rules are not negotiable here:
 *
 *  1. The credential is the relay identity's own long-lived id and secret, sent
 *     in the upgrade's `authorization` header so it never appears in a URL. A
 *     dropped socket is re-dialed with the same credential; the object replaces
 *     the socket it already holds, so a reconnect needs no new ticket and no
 *     new instance.
 *  2. The connector serves exactly one inbound path, the protocol's `WS_PATH`.
 *     Any other HTTP request is answered 404 by the connector itself, any other
 *     upgrade is refused the same way, and neither ever dials upstream. That
 *     whitelist -- not any header -- is what keeps the host's control plane off
 *     the public origin.
 *  3. The connector forwards the public origin the phone dialed and never
 *     invents the authority it dials. The object reads the origin from the
 *     request URL and puts it in the frame; the fallback is this instance's
 *     claimed relay hostname. The loopback `Host` is stamped exactly once, and
 *     not here: the upstream this connector dials is the ingress gate, whose
 *     whole job is to rewrite the `Host` to the loopback authority and to serve
 *     nothing but `WS_PATH`. So the gate is the single place the rewrite
 *     happens, and rule 2 is the reason that rewrite cannot expose anything
 *     beyond the protocol's own route.
 *
 * Frames mirror `market/worker/src/relay-bridge.js`: control frames are JSON
 * text, payload frames are `[kind:u8][streamId:u32be][payload]`.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { dirname, join } from 'node:path'
import { WS_PATH } from '../core/protocol.ts'
import { dshHome } from './dsh-home.ts'
import type { RelayBridgeStart } from './relay-connector.ts'

/** The upgrade carries the lease secret here, never in the URL. */
export const BRIDGE_AUTH_HEADER = 'authorization'
/** Response frames this connector will not forward upstream. */
export const BRIDGE_HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-accept',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-visitor',
  'cf-ray',
  'cf-ipcity',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
])

const HTTP_BODY = 1
const WS_BINARY = 2
const WS_TEXT = 3

/** Where a dropped socket restarts: fast first, then patient. */
export const BRIDGE_RETRY_BASE_MS = 1_000
export const BRIDGE_RETRY_MAX_MS = 30_000

/** The body every refused inbound stream is answered with. */
export const BRIDGE_NOT_FOUND_BODY = '{"error":"not-found"}'

/**
 * Whether one bridged stream may reach the upstream at all.
 *
 * Only the protocol's own upgrade path is served. The comparison is on the
 * path, not the whole URL, because the pairing link carries its one-shot
 * ticket in the query (`WS_PATH?token=...`); everything else — another path,
 * a path that merely starts the same way, an empty URL — is refused.
 * @param url - the `url` one bridged frame names.
 * @returns true when the path is exactly `WS_PATH`.
 */
export function isBridgeInboundPath(url: string): boolean {
  const query = url.indexOf('?')
  return (query === -1 ? url : url.slice(0, query)) === WS_PATH
}

/** One header pair as the frame contract carries it. */
export type BridgeHeaderPairs = ReadonlyArray<readonly [string, string]>

function headerPairs(raw: unknown): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  if (!Array.isArray(raw)) return pairs
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue
    const [name, value] = entry as [unknown, unknown]
    if (typeof name !== 'string' || typeof value !== 'string') continue
    pairs.push([name, value])
  }
  return pairs
}

/** The upgrade URL one instance dials (the id is not a secret). */
export function relayBridgeDialUrl(endpoint: string, id: string): string {
  const url = new URL(endpoint)
  url.searchParams.set('id', id)
  return url.href
}

/**
 * The `Host` one bridged request travels with.
 * @param frameHost - the public origin the object read from the request URL.
 * @param hostname - this instance's claimed relay hostname.
 * @returns a public origin, never the upstream authority this connector dials.
 */
export function bridgeUpstreamHost(frameHost: unknown, hostname: string): string {
  if (typeof frameHost === 'string' && frameHost !== '') return frameHost
  return hostname
}

/**
 * The upstream headers of one bridged request: the phone's own, minus the hops
 * this transport owns, with the public `Host` put back explicitly.
 */
export function bridgeUpstreamHeaders(frameHeaders: unknown, host: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [name, value] of headerPairs(frameHeaders)) {
    if (BRIDGE_HOP_BY_HOP.has(name.toLowerCase())) continue
    headers[name] = value
  }
  headers.host = host
  return headers
}

/** The headers of the bridge socket's own upgrade. */
export function bridgeUpgradeHeaders(endpoint: string, secret: string): Record<string, string> {
  return {
    host: new URL(endpoint).host,
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-key': randomBytes(16).toString('base64'),
    'sec-websocket-version': '13',
    [BRIDGE_AUTH_HEADER]: 'Bearer ' + secret,
  }
}

function encodeChunk(kind: number, id: number, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(5 + payload.byteLength)
  bytes[0] = kind
  new DataView(bytes.buffer).setUint32(1, id >>> 0)
  bytes.set(payload, 5)
  return bytes
}

function decodeChunk(data: Uint8Array): { kind: number; id: number; payload: Uint8Array } | undefined {
  if (data.byteLength < 5) return undefined
  return {
    kind: data[0],
    id: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1),
    payload: data.subarray(5),
  }
}

/** One client frame, masked as RFC 6455 requires of the dialing side. */
export function encodeBridgeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const length = payload.byteLength
  const head = length < 126 ? 6 : length < 65_536 ? 8 : 14
  const bytes = new Uint8Array(head + length)
  bytes[0] = 0x80 | opcode
  if (length < 126) {
    bytes[1] = 0x80 | length
  } else if (length < 65_536) {
    bytes[1] = 0x80 | 126
    bytes[2] = (length >>> 8) & 0xff
    bytes[3] = length & 0xff
  } else {
    bytes[1] = 0x80 | 127
    new DataView(bytes.buffer).setUint32(2, 0)
    new DataView(bytes.buffer).setUint32(6, length)
  }
  const mask = randomBytes(4)
  bytes.set(mask, head - 4)
  for (let index = 0; index < length; index += 1) bytes[head + index] = payload[index] ^ mask[index % 4]
  return bytes
}

/** One frame of a WebSocket the connector dialed. */
export interface BridgeFrame {
  opcode: number
  payload: Buffer
}

/**
 * A frame reader for the connector's own client side, reassembling fragmented
 * messages and unmasking nothing: only servers send unmasked frames here.
 */
export function createBridgeFrameParser(onFrame: (frame: BridgeFrame) => void): (incoming: Buffer) => void {
  let buffer: Buffer = Buffer.alloc(0)
  let continuation: Buffer | null = null
  let continuationOpcode = 0x1
  return (incoming: Buffer): void => {
    buffer = buffer.length === 0 ? incoming : Buffer.concat([buffer, incoming])
    for (;;) {
      if (buffer.length < 2) return
      const fin = (buffer[0] & 0x80) !== 0
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      const maskAt = offset
      if (masked) offset += 4
      if (buffer.length < offset + length) return
      let payload = Buffer.from(buffer.subarray(offset, offset + length))
      if (masked) {
        const mask = buffer.subarray(maskAt, maskAt + 4)
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
      }
      buffer = buffer.subarray(offset + length)
      if (opcode === 0x0) {
        continuation = continuation === null ? payload : Buffer.concat([continuation, payload])
        if (!fin) continue
        onFrame({ opcode: continuationOpcode, payload: continuation })
        continuation = null
        continue
      }
      if ((opcode === 0x1 || opcode === 0x2) && !fin) {
        continuation = payload
        continuationOpcode = opcode
        continue
      }
      onFrame({ opcode, payload })
    }
  }
}

/** The connector's observable state (logged, and read by the tests). */
export type RelayBridgeState =
  | { state: 'idle' }
  | { state: 'dialing' }
  | { state: 'connected'; instance: string }
  | { state: 'failed'; error: string }

/**
 * What the connector records on disk: its state plus the lease it dials.
 * The Desktop host runs this plugin in a process whose stdout nobody reads, so
 * without this record a connector that never attached (or a lease that never
 * claimed) leaves no trace at all.
 */
export interface RelayBridgeStateRecord {
  state: RelayBridgeState['state']
  instance: string
  hostname: string
  endpoint: string
  upstream: string
  /** When the record was written (ISO 8601). */
  at: string
  /** The dial failure, for a `failed` record. */
  error?: string
}

/** Where the connector records its state (`$DSH_HOME/remote-web-ui-relay-bridge.json`). */
export function relayBridgeStateFile(home: string = dshHome()): string {
  return join(home, 'remote-web-ui-relay-bridge.json')
}

/**
 * Record one connector state. Best effort on purpose: a home that cannot be
 * written must never take the socket down with it.
 * @param file - the record path (see `relayBridgeStateFile`).
 * @param record - the state and the lease it belongs to.
 */
export function writeRelayBridgeState(file: string, record: RelayBridgeStateRecord): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const staged = file + '.tmp'
    writeFileSync(staged, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
    renameSync(staged, file)
  } catch {
    // A record that cannot land is not worth a broken connector.
  }
}

/** Everything one bridge connector needs to run. */
export interface RelayBridgeConnectorOptions {
  /** The upgrade endpoint the claim reported. */
  endpoint: string
  /** The relay identity id. */
  id: string
  /** The relay identity secret (the same long-lived credential). */
  secret: string
  /** This instance's relay hostname, the fallback public origin. */
  hostname: string
  /** The local origin the connector serves, `http://127.0.0.1:<port>`. */
  upstream: string
  baseDelayMs?: number
  maxDelayMs?: number
  /** Schedule one retry; defaults to an unref'd node timer. */
  timerFn?: (fn: () => void, ms: number) => { unref?: () => void }
  onState?: (state: RelayBridgeState) => void
}

/** One upstream WebSocket the connector dialed for a phone. */
interface BridgePeer {
  socket: import('node:net').Socket
  closed: boolean
  close: (code: number, reason: string) => void
  text: (body: string) => void
  binary: (body: Buffer) => void
}

/**
 * The connector itself: one socket to the object, one upstream request or
 * WebSocket per stream id, and a reconnect that keeps the same credential.
 */
export class RelayBridgeConnector {
  private socket: import('node:net').Socket | undefined
  private parser: ((incoming: Buffer) => void) | undefined
  private timer: { unref?: () => void } | undefined
  private stateValue: RelayBridgeState = { state: 'idle' }
  private attempts = 0
  private disposed = false
  private readonly requests = new Map<number, http.ClientRequest>()
  private readonly peers = new Map<number, BridgePeer>()

  private readonly options: RelayBridgeConnectorOptions

  constructor(options: RelayBridgeConnectorOptions) {
    this.options = options
  }

  /** The connector's current state. */
  get state(): RelayBridgeState {
    return this.stateValue
  }

  /** Whether a bridge socket is attached right now. */
  get connected(): boolean {
    return this.socket !== undefined
  }

  /** Dial the object (or schedule the next attempt if the dial fails). */
  start(): void {
    if (this.disposed) return
    this.clearTimer()
    this.teardown()
    this.setState({ state: 'dialing' })
    this.dial()
  }

  /** Close the socket and stop retrying (the relay half was disposed). */
  stop(): void {
    this.disposed = true
    this.clearTimer()
    this.teardown()
    this.setState({ state: 'idle' })
  }

  private dial(): void {
    const { endpoint, id, secret } = this.options
    const url = relayBridgeDialUrl(endpoint, id)
    const target = new URL(url)
    const transport = target.protocol === 'wss:' ? https : http
    const request = transport.request({
      host: target.hostname,
      port: target.port === '' ? (target.protocol === 'wss:' ? 443 : 80) : Number(target.port),
      path: target.pathname + target.search,
      method: 'GET',
      headers: bridgeUpgradeHeaders(endpoint, secret),
    })
    request.on('upgrade', (response: http.IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
      if (response.statusCode !== 101) {
        socket.destroy()
        this.fail('upgrade answered ' + String(response.statusCode))
        return
      }
      this.attach(socket, head)
    })
    request.on('response', (response: http.IncomingMessage) => {
      response.resume()
      this.fail('refused with ' + String(response.statusCode))
    })
    request.on('error', (error: Error) => { this.fail(error.message) })
    request.end()
  }

  private attach(socket: import('node:net').Socket, head: Buffer): void {
    this.socket = socket
    this.attempts = 0
    this.parser = createBridgeFrameParser((frame) => { this.onBridgeFrame(frame) })
    socket.on('data', (incoming: Buffer) => { this.parser?.(incoming) })
    socket.on('error', () => undefined)
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      this.teardown()
      this.fail('socket closed')
    })
    if (head.length > 0) this.parser(head)
    this.setState({ state: 'connected', instance: this.options.id })
  }

  /** Send one control frame: a text frame, which is how the object tells a
   * control frame from a payload chunk. */
  private sendText(text: string): void {
    this.write(0x1, Buffer.from(text))
  }

  /** Send one payload frame: a binary frame carrying a chunk. */
  private sendChunk(bytes: Uint8Array): void {
    this.write(0x2, Buffer.from(bytes))
  }

  private write(opcode: number, body: Buffer): void {
    const socket = this.socket
    if (socket === undefined || socket.destroyed) return
    socket.write(encodeBridgeFrame(opcode, body))
  }

  private onBridgeFrame(frame: BridgeFrame): void {
    if (frame.opcode === 0x8) {
      this.socket?.destroy()
      return
    }
    if (frame.opcode === 0x9) {
      this.socket?.write(encodeBridgeFrame(0xa, frame.payload))
      return
    }
    if (frame.opcode === 0x1) {
      this.onControl(frame.payload.toString('utf8'))
      return
    }
    if (frame.opcode !== 0x2) return
    const chunk = decodeChunk(frame.payload)
    if (chunk === undefined) return
    if (chunk.kind === HTTP_BODY) {
      this.requests.get(chunk.id)?.write(Buffer.from(chunk.payload))
      return
    }
    const peer = this.peers.get(chunk.id)
    if (peer === undefined) return
    if (chunk.kind === WS_TEXT) peer.text(Buffer.from(chunk.payload).toString('utf8'))
    if (chunk.kind === WS_BINARY) peer.binary(Buffer.from(chunk.payload))
  }

  private onControl(raw: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const id = typeof frame.id === 'number' ? frame.id : -1
    switch (frame.t) {
      case 'req':
        this.startHttp(id, frame)
        return
      case 'end':
        this.requests.get(id)?.end()
        return
      case 'ws-open':
        void this.openSocket(id, frame)
        return
      case 'ws-close':
        this.peers.get(id)?.close(typeof frame.code === 'number' ? frame.code : 1000, String(frame.reason ?? ''))
        this.peers.delete(id)
        return
      case 'close': {
        const peer = this.peers.get(id)
        if (peer !== undefined) {
          this.peers.delete(id)
          peer.close(1000, String(frame.reason ?? 'closed'))
          return
        }
        const request = this.requests.get(id)
        if (request !== undefined) {
          this.requests.delete(id)
          request.destroy()
        }
        return
      }
      default:
    }
  }

  /**
   * Answer one bridged stream with 404 without dialing anything: the refusal is
   * complete here, so a non-whitelisted path costs the upstream nothing.
   * @param id - the stream the object opened.
   */
  private refuseNotFound(id: number): void {
    const body = Buffer.from(BRIDGE_NOT_FOUND_BODY)
    this.sendText(JSON.stringify({
      t: 'res',
      id,
      status: 404,
      statusText: 'Not Found',
      headers: [
        ['content-type', 'application/json'],
        ['content-length', String(body.byteLength)],
        ['connection', 'close'],
      ],
    }))
    this.sendChunk(encodeChunk(HTTP_BODY, id, body))
    this.sendText(JSON.stringify({ t: 'fin', id }))
  }

  /** Start one upstream HTTP request for a bridged stream. */
  private startHttp(id: number, frame: Record<string, unknown>): void {
    const path = typeof frame.url === 'string' && frame.url !== '' ? frame.url : '/'
    if (!isBridgeInboundPath(path)) {
      this.refuseNotFound(id)
      return
    }
    const upstream = new URL(this.options.upstream)
    const method = typeof frame.method === 'string' ? frame.method : 'GET'
    const host = bridgeUpstreamHost(frame.host, this.options.hostname)
    const request = http.request({
      host: upstream.hostname,
      port: upstream.port === '' ? 80 : Number(upstream.port),
      path,
      method,
      headers: bridgeUpstreamHeaders(frame.headers, host),
    }, (response: http.IncomingMessage) => {
      this.requests.delete(id)
      this.sendText(JSON.stringify({
        t: 'res',
        id,
        status: response.statusCode,
        statusText: response.statusMessage ?? '',
        headers: rawHeaderPairs(response.rawHeaders),
      }))
      response.on('data', (chunk: Buffer) => { this.sendChunk(encodeChunk(HTTP_BODY, id, chunk)) })
      response.on('end', () => { this.sendText(JSON.stringify({ t: 'fin', id })) })
      response.on('error', (error: Error) => { this.sendText(JSON.stringify({ t: 'fail', id, message: error.message })) })
    })
    request.on('error', (error: Error) => {
      this.requests.delete(id)
      this.sendText(JSON.stringify({ t: 'fail', id, message: error.message }))
    })
    this.requests.set(id, request)
  }

  /** Open one upstream WebSocket for a phone's upgrade. */
  private async openSocket(id: number, frame: Record<string, unknown>): Promise<void> {
    const path = typeof frame.url === 'string' && frame.url !== '' ? frame.url : '/'
    if (!isBridgeInboundPath(path)) {
      // The upgrade is refused with the same 404 an HTTP request gets, and no
      // upstream socket exists to close: nothing was dialed on its behalf.
      this.sendText(JSON.stringify({ t: 'ws-fail', id, message: '404 ' + BRIDGE_NOT_FOUND_BODY }))
      return
    }
    const upstream = new URL(this.options.upstream)
    const host = bridgeUpstreamHost(frame.host, this.options.hostname)
    const headers = bridgeUpstreamHeaders(frame.headers, host)
    headers.connection = 'Upgrade'
    headers.upgrade = 'websocket'
    headers['sec-websocket-key'] = randomBytes(16).toString('base64')
    headers['sec-websocket-version'] = '13'
    try {
      const dialed = await new Promise<{ socket: import('node:net').Socket; head: Buffer }>((resolve, reject) => {
        const request = http.request({
          host: upstream.hostname,
          port: upstream.port === '' ? 80 : Number(upstream.port),
          path,
          method: 'GET',
          headers,
        })
        request.on('upgrade', (response: http.IncomingMessage, socket: import('node:net').Socket, head: Buffer) => {
          resolve({ socket, head })
        })
        request.on('response', (response: http.IncomingMessage) => {
          response.resume()
          reject(new Error('upstream answered ' + String(response.statusCode) + ' instead of 101'))
        })
        request.on('error', (error: Error) => { reject(error) })
        request.end()
      })
      this.sendText(JSON.stringify({ t: 'ws-accept', id }))
      const peer: BridgePeer = {
        socket: dialed.socket,
        closed: false,
        close: (code: number, reason: string) => {
          if (peer.closed) return
          peer.closed = true
          const text = Buffer.from(reason)
          const payload = Buffer.alloc(2 + text.length)
          payload.writeUInt16BE(code, 0)
          text.copy(payload, 2)
          try {
            dialed.socket.write(encodeBridgeFrame(0x8, payload))
          } catch {
            // The socket is already gone.
          }
          dialed.socket.destroy()
        },
        text: (body: string) => {
          if (!peer.closed) dialed.socket.write(encodeBridgeFrame(0x1, Buffer.from(body)))
        },
        binary: (body: Buffer) => {
          if (!peer.closed) dialed.socket.write(encodeBridgeFrame(0x2, body))
        },
      }
      const parse = createBridgeFrameParser((incoming) => {
        if (incoming.opcode === 0x1) {
          this.sendChunk(encodeChunk(WS_TEXT, id, incoming.payload))
          return
        }
        if (incoming.opcode === 0x2) {
          this.sendChunk(encodeChunk(WS_BINARY, id, incoming.payload))
          return
        }
        if (incoming.opcode === 0x8) {
          const code = incoming.payload.length >= 2 ? incoming.payload.readUInt16BE(0) : 1005
          const reason = incoming.payload.length > 2 ? incoming.payload.subarray(2).toString('utf8') : ''
          this.peers.delete(id)
          peer.closed = true
          dialed.socket.destroy()
          this.sendText(JSON.stringify({ t: 'ws-close', id, code, reason }))
          return
        }
        if (incoming.opcode === 0x9) dialed.socket.write(encodeBridgeFrame(0xa, incoming.payload))
      })
      dialed.socket.on('data', parse)
      dialed.socket.on('error', () => undefined)
      dialed.socket.on('close', () => {
        if (!this.peers.delete(id)) return
        if (peer.closed) return
        peer.closed = true
        this.sendText(JSON.stringify({ t: 'ws-close', id, code: 1006, reason: 'upstream-closed' }))
      })
      this.peers.set(id, peer)
      if (dialed.head.length > 0) parse(dialed.head)
    } catch (error) {
      this.sendText(JSON.stringify({ t: 'ws-fail', id, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** Report one failed dial and retry with the same credential. */
  private fail(error: string): void {
    if (this.disposed) return
    this.setState({ state: 'failed', error })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.disposed) return
    const base = this.options.baseDelayMs ?? BRIDGE_RETRY_BASE_MS
    const max = this.options.maxDelayMs ?? BRIDGE_RETRY_MAX_MS
    const delay = Math.min(base * 2 ** this.attempts, max)
    this.attempts += 1
    const timerFn = this.options.timerFn ?? ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      timer.unref?.()
      return timer
    })
    this.timer = timerFn(() => {
      this.timer = undefined
      this.dial()
    }, delay)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer as unknown as NodeJS.Timeout)
    this.timer = undefined
  }

  /** Drop every stream this socket carried: the object re-opens them. */
  private teardown(): void {
    for (const [id, request] of this.requests) {
      this.requests.delete(id)
      request.destroy()
    }
    for (const [id, peer] of this.peers) {
      this.peers.delete(id)
      peer.close(1000, 'connector-closed')
    }
  }

  private setState(state: RelayBridgeState): void {
    this.stateValue = state
    try {
      this.options.onState?.(state)
    } catch {
      // A throwing observer must not break the socket lifecycle.
    }
  }
}

/** The plugin-side owner of one bridge connector. */
export interface RelayBridgeRunner {
  /** Start (or restart) the connector for one accepted lease. */
  start(start: RelayBridgeStart): void
  /** Stop it (the relay half was disposed). */
  stop(): void
  readonly state: RelayBridgeState
}

/**
 * Build the runner the relay pair drives: one connector per accepted lease,
 * rebuilt when a later claim names a different endpoint, and stopped with the
 * relay half. The bridge keeps its socket up while the instance's mode is
 * quick, so a server-side flip needs no plugin restart.
 * @param options - a state observer (logs and the on-disk record).
 */
export function createRelayBridgeRunner(options: {
  onState?: (state: RelayBridgeState) => void
  /** Where to record the state; `null` keeps the runner in memory only. */
  stateFile?: string | null
  /** The clock the record timestamps with (tests pass a fixed one). */
  now?: () => string
} = {}): RelayBridgeRunner {
  const stateFile = options.stateFile === undefined ? relayBridgeStateFile() : options.stateFile
  const now = options.now ?? (() => new Date().toISOString())
  let connector: RelayBridgeConnector | undefined
  let lease: { instance: string; hostname: string; endpoint: string; upstream: string } | undefined
  const observe = (state: RelayBridgeState): void => {
    const target = lease
    if (stateFile !== null) {
      writeRelayBridgeState(stateFile, {
        state: state.state,
        instance: target?.instance ?? 'none',
        hostname: target?.hostname ?? 'none',
        endpoint: target?.endpoint ?? 'none',
        upstream: target?.upstream ?? 'none',
        at: now(),
        ...(state.state === 'failed' ? { error: state.error } : {}),
      })
    }
    options.onState?.(state)
  }
  return {
    start(start: RelayBridgeStart): void {
      const grant = start.claim.bridge
      if (grant === undefined) return
      connector?.stop()
      lease = {
        instance: start.identity.id,
        hostname: start.claim.hostname,
        endpoint: grant.endpoint,
        upstream: 'http://127.0.0.1:' + String(start.port),
      }
      connector = new RelayBridgeConnector({
        endpoint: lease.endpoint,
        id: start.identity.id,
        secret: start.identity.secret,
        hostname: lease.hostname,
        upstream: lease.upstream,
        onState: observe,
      })
      connector.start()
    },
    stop(): void {
      connector?.stop()
      connector = undefined
    },
    get state(): RelayBridgeState {
      return connector?.state ?? { state: 'idle' }
    },
  }
}

/** Flatten a node raw header array into frame pairs. */
function rawHeaderPairs(raw: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let index = 0; index + 1 < raw.length; index += 2) pairs.push([raw[index], raw[index + 1]])
  return pairs
}
