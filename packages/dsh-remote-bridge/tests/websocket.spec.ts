import type { IncomingMessage } from 'node:http'
import { Duplex, PassThrough } from 'node:stream'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { OPCODE_BINARY, OPCODE_CLOSE, OPCODE_TEXT, encodeTextFrame } from '../src/core/ws-frames.ts'
import { WebSocketCarrier, bearerTokenOf, isWebSocketUpgrade, presentedTokenOf, queryTokenOf, serveUpgrade } from '../src/host/websocket.ts'
import { makeBareHub, nextTurn, requestFrame, settle } from './support/harness.ts'

/** The handshake key of the WebSocket specification's own example. */
const WEB_SOCKET_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='

const HANDSHAKE_END = Buffer.from('\r\n\r\n')

/** One masked client frame, as a browser or iOS client sends it. */
function maskedFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const mask = Buffer.from([0x5a, 0x6b, 0x7c, 0x8d])
  const masked = Buffer.from(payload.map((byte, index) => byte ^ (mask[index % 4] ?? 0)))
  const header = payload.length < 126
    ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length])
    : Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  return Buffer.concat([header, mask, masked])
}

/** One unmasked server frame read back off the wire. */
interface ServerFrame {
  readonly opcode: number
  readonly payload: Buffer
}

/** A socket pair carrying a real byte stream in both directions. */
interface SocketPair {
  /** The client end of the inbound direction: writing here is the client talking. */
  readonly inbound: PassThrough
  /** The server end of the outbound direction: reading here is the client listening. */
  readonly outbound: PassThrough
  /** The duplex the carrier is handed. */
  readonly socket: Duplex
  /** @returns everything the carrier has written. */
  serverBytes: () => Buffer
}

/**
 * A socket pair built from two real streams: the client's bytes enter through
 * `inbound` and the carrier's bytes leave through `outbound`, exactly as on a TCP
 * connection, with no shared read side.
 *
 * A bare `PassThrough` cannot stand in for a socket here: the carrier writes to
 * the socket and reads from it, so a loopback stream would feed the carrier's own
 * handshake bytes and frames back into its own frame loop.
 */
function socketPair(): SocketPair {
  const inbound = new PassThrough()
  const outbound = new PassThrough()
  const chunks: Buffer[] = []
  outbound.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  return {
    inbound,
    outbound,
    socket: Duplex.from({ readable: inbound, writable: outbound }) as unknown as Duplex,
    serverBytes: () => Buffer.concat(chunks),
  }
}

/** A carrier over a real socket pair, handshake already written. */
function openCarrier(): { carrier: WebSocketCarrier; socket: Duplex; bytes: () => Buffer } {
  const pair = socketPair()
  const carrier = new WebSocketCarrier(pair.socket)
  carrier.handshake('dGhlIHNhbXBsZSBub25jZQ==')
  return { carrier, socket: pair.socket, bytes: pair.serverBytes }
}

/** Everything written before the handshake finished. */
function handshakeOf(bytes: Buffer): string {
  return bytes.subarray(0, bytes.indexOf(HANDSHAKE_END) + HANDSHAKE_END.length).toString('latin1')
}

/** Every unmasked server frame written after the handshake. */
function serverFrames(bytes: Buffer): ServerFrame[] {
  let rest = bytes.subarray(bytes.indexOf(HANDSHAKE_END) + HANDSHAKE_END.length)
  const frames: ServerFrame[] = []
  while (rest.length >= 2) {
    const opcode = (rest[0] ?? 0) & 0x0f
    let length = rest[1] ?? 0
    let offset = 2
    if (length === 126) {
      length = rest.readUInt16BE(2)
      offset = 4
    }
    frames.push({ opcode, payload: rest.subarray(offset, offset + length) })
    rest = rest.subarray(offset + length)
  }
  return frames
}

/** A frame body past the compression threshold: one turn's entries, wide enough to shrink. */
function largeFrameText(): string {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    seq: index + 1,
    kind: 'assistant/message',
    text: 'The bridge writes one JSON object per frame and measures it against the same 10 MiB cap in both directions.',
  }))
  return JSON.stringify({ t: 'res', id: 2, ok: true, r: { turns: [{ seq: 1, reason: 'stop', entries }] } })
}

/** Twenty sessions' worth of roster: one listing wide enough to be worth compressing. */
function rosterItems(): readonly unknown[] {
  return Array.from({ length: 20 }, (_, index) => ({
    sessionId: `sess_${index.toString().padStart(2, '0')}`,
    updatedAt: 1_735_689_600_000 + index,
    running: index % 3 === 0,
    cwd: `/Users/zcl/code/iphone_remote_use_dsh/packages/dsh-remote-bridge/tests/session-${index}`,
    blank: false,
  }))
}

/**
 * Serve one real upgrade over a socket pair, greet the bridge as a paired device,
 * and list the roster.
 * @param declaresDeflate - whether the hello declares `frame.deflate.v1`.
 * @returns every server frame written after the handshake, in order.
 */
async function listedAnswer(declaresDeflate: boolean): Promise<ServerFrame[]> {
  const pair = socketPair()
  const bare = makeBareHub()
  bare.gateway.handler = async call => (call.method === 'list' ? { items: rosterItems() } : { accepted: true })
  serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head: Buffer.alloc(0), hub: bare.hub, auth: { deviceId: 'dev_ws' } })
  const hello = requestFrame(1, 'hello', { proto: 1, ...(declaresDeflate ? { cap: ['frame.deflate.v1'] } : {}) })
  pair.inbound.write(Buffer.concat([
    maskedFrame(OPCODE_TEXT, Buffer.from(hello)),
    maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(2, 'session.list'))),
  ]))
  await nextTurn()
  await settle()
  return serverFrames(pair.serverBytes())
}

/** A request stub whose handshake fields the test chooses. */
function fakeRequest(headers: Record<string, string>, url = '/ios/v1'): IncomingMessage {
  return { headers, url } as unknown as IncomingMessage
}

describe('WebSocket carrier', () => {
  it('user completes the handshake and the response carries the derived accept value', () => {
    // Given a carrier over a freshly accepted socket
    const { carrier, bytes } = openCarrier()
    // When the handshake is written for a client key
    carrier.handshake('dGhlIHNhbXBsZSBub25jZQ==')
    // Then the response is a switching-protocols answer naming the accept value from the specification
    const response = handshakeOf(bytes())
    expect(response.startsWith('HTTP/1.1 101 Switching Protocols\r\n')).toBe(true)
    expect(response.includes('sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')).toBe(true)
  })

  it('user sends a text message and it reaches the connection handler', () => {
    // Given a carrier with a message handler
    const { carrier } = openCarrier()
    const messages: string[] = []
    carrier.onMessage(text => { messages.push(text) })
    // When a masked text frame arrives
    carrier.feed(maskedFrame(OPCODE_TEXT, Buffer.from('{"t":"req","id":1,"m":"hello"}')))
    // Then the handler saw exactly that text
    expect(messages).toEqual(['{"t":"req","id":1,"m":"hello"}'])
  })

  it('user sends two frames in one read and both reach the handler in order', () => {
    // Given a carrier with a message handler
    const { carrier } = openCarrier()
    const messages: string[] = []
    carrier.onMessage(text => { messages.push(text) })
    // When a single chunk carries two frames
    carrier.feed(Buffer.concat([
      maskedFrame(OPCODE_TEXT, Buffer.from('one')),
      maskedFrame(OPCODE_TEXT, Buffer.from('two')),
    ]))
    // Then the frame loop consumed both
    expect(messages).toEqual(['one', 'two'])
  })

  it('user sends a binary frame and the socket is closed as unsupported data', () => {
    // Given a carrier over a socket
    const { carrier, bytes } = openCarrier()
    // When a binary frame arrives
    carrier.feed(maskedFrame(OPCODE_BINARY, Buffer.from([1, 2, 3])))
    // Then the peer is told which rule it broke
    const frames = serverFrames(bytes())
    expect(frames.map(frame => frame.opcode)).toEqual([OPCODE_CLOSE])
    expect(frames[0]?.payload.readUInt16BE(0)).toBe(1003)
    expect(carrier.closed).toBe(true)
  })

  it('user sends an unmasked frame and the carrier closes the socket exactly once', () => {
    // Given a carrier with a teardown hook
    const { carrier, bytes } = openCarrier()
    let closes = 0
    carrier.onClose(() => { closes += 1 })
    // When an unmasked frame arrives and the carrier is then closed again
    carrier.feed(Buffer.from([0x81, 0x02, 0x68, 0x69]))
    carrier.close(1000, '')
    // Then the peer was told it broke the protocol and the hook ran once
    expect(serverFrames(bytes())[0]?.payload.readUInt16BE(0)).toBe(1002)
    expect(closes).toBe(1)
  })

  it('operator drops the socket and the teardown hook runs once', async () => {
    // Given a carrier over a socket
    const { carrier, socket } = openCarrier()
    let closes = 0
    carrier.onClose(() => { closes += 1 })
    // When the socket goes away underneath it
    socket.destroy()
    await nextTurn()
    // Then the connection is torn down exactly once
    expect(closes).toBe(1)
    expect(carrier.closed).toBe(true)
  })

  it('user sends a close frame and the session ends without an error code', () => {
    // Given a carrier over a socket
    const { carrier, bytes } = openCarrier()
    let closes = 0
    carrier.onClose(() => { closes += 1 })
    // When the client closes normally
    carrier.feed(maskedFrame(OPCODE_CLOSE, Buffer.alloc(0)))
    // Then the carrier echoes a normal close and nothing else will be delivered
    expect(serverFrames(bytes())[0]?.payload.readUInt16BE(0)).toBe(1000)
    expect(closes).toBe(1)
  })

  it('user sends a message after the carrier closed and it is ignored', () => {
    // Given a carrier that has already been closed
    const { carrier } = openCarrier()
    const messages: string[] = []
    carrier.onMessage(text => { messages.push(text) })
    carrier.close(1000, '')
    // When a late frame arrives
    carrier.feed(maskedFrame(OPCODE_TEXT, Buffer.from('too late')))
    // Then it is dropped instead of reaching a connection that is gone
    expect(messages).toEqual([])
  })

  it('user without the capability is written the same text frame as before, byte for byte', () => {
    // Given a carrier whose peer declared nothing, and one frame past the threshold
    const { carrier, bytes } = openCarrier()
    const text = largeFrameText()
    // When the frame is sent
    carrier.send(text)
    // Then the bytes after the handshake are exactly the text frame this carrier always wrote
    const written = bytes()
    const frames = written.subarray(written.indexOf(HANDSHAKE_END) + HANDSHAKE_END.length)
    expect(frames).toEqual(encodeTextFrame(text))
  })

  it('user declaring the capability is written a binary frame that inflates into the same text', () => {
    // Given a carrier whose peer declared frame.deflate.v1
    const { carrier, bytes } = openCarrier()
    carrier.frameDeflate(true)
    const small = '{"t":"pong","ts":1735689600000}'
    const text = largeFrameText()
    // When one frame below the threshold and one past it are sent
    carrier.send(small)
    carrier.send(text)
    // Then the small one stays text and the large one is raw DEFLATE of that same frame
    const frames = serverFrames(bytes())
    expect(frames.map(frame => frame.opcode)).toEqual([OPCODE_TEXT, OPCODE_BINARY])
    expect(frames[0]?.payload.toString('utf8')).toBe(small)
    expect(inflateRawSync(frames[1]?.payload ?? Buffer.alloc(0)).toString('utf8')).toBe(text)
  })

  it('operator reads the token from the header first and the query second', () => {
    // Given an upgrade carrying both forms, one carrying only the query, and one carrying neither
    const both = fakeRequest({ authorization: 'Bearer from-header' }, '/ios/v1?token=from-query')
    const queryOnly = fakeRequest({}, '/ios/v1?token=from-query')
    const neither = fakeRequest({})
    // When each token is resolved
    const resolved = [both, queryOnly, neither].map(request => presentedTokenOf(request))
    // Then the header wins, the query is the fallback, and no token means unpaired
    expect(resolved).toEqual(['from-header', 'from-query', undefined])
    expect(bearerTokenOf(both)).toBe('from-header')
    expect(queryTokenOf(neither.url)).toBeUndefined()
  })

  it('operator inspects an upgrade request and only a WebSocket upgrade is accepted', () => {
    // Given one request that upgrades and one plain request
    const upgrading = fakeRequest({ upgrade: 'websocket' })
    const plain = fakeRequest({})
    // When the upgrade header is read
    const verdicts = [upgrading, plain].map(request => isWebSocketUpgrade(request))
    // Then only the WebSocket upgrade passes
    expect(verdicts).toEqual([true, false])
  })
})

describe('WebSocket carrier over a real socket', () => {
  it('user connects over a socket and the greeting sent into it is answered', async () => {
    // Given the production upgrade handoff over a real duplex
    const pair = socketPair()
    const bare = makeBareHub()
    serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head: Buffer.alloc(0), hub: bare.hub })
    // When the client writes a hello frame into the socket, with nobody calling feed()
    pair.inbound.write(maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(1, 'hello', { proto: 1 }))))
    await nextTurn()
    await settle()
    // Then the answer travelled back out through the socket
    const frames = serverFrames(pair.serverBytes())
    expect(frames.map(frame => frame.opcode)).toEqual([OPCODE_TEXT])
    expect(JSON.parse(frames[0]?.payload.toString('utf8') ?? '') as unknown).toEqual({
      t: 'res',
      id: 1,
      ok: true,
      r: { proto: 1, minor: 22, server: 'dsh-remote-bridge', capabilities: ['session.snapshot.trim.v1', 'session.snapshot.page.v1', 'questions.v1', 'questions.list.v1', 'subagent.thread.v1', 'jobs.v1', 'agents.v1', 'delta.v1', 'session.list.omit-archived.v1', 'session.deep-history.v1', 'frame.deflate.v1', 'session.list.compact.v1', 'session.snapshot.since.v1', 'session.fork.v1', 'commands.v1', 'workspace.v1', 'session.admin.v1', 'squads.v1', 'push.v1', 'usage.v1', 'usage.stats.v1', 'ui.v1', 'ui.list.v1', 'session.attachment.path.v1'], resume: 'snapshot', auth: 'unpaired' },
    })
  })

  it('user whose greeting arrived with the upgrade request still receives the answer', async () => {
    // Given a client whose first frame rode the upgrade request as leftover `head` bytes
    const pair = socketPair()
    const bare = makeBareHub()
    const head = maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(2, 'hello', { proto: 1 })))
    // When the upgrade is handed over with no further socket traffic at all
    serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head, hub: bare.hub })
    await nextTurn()
    await settle()
    // Then the leftover bytes were parsed, not discarded
    const answers = serverFrames(pair.serverBytes()).map(frame => JSON.parse(frame.payload.toString('utf8')) as { id: number; ok: boolean })
    expect(answers).toEqual([{ t: 'res', id: 2, ok: true, r: { proto: 1, minor: 22, server: 'dsh-remote-bridge', capabilities: ['session.snapshot.trim.v1', 'session.snapshot.page.v1', 'questions.v1', 'questions.list.v1', 'subagent.thread.v1', 'jobs.v1', 'agents.v1', 'delta.v1', 'session.list.omit-archived.v1', 'session.deep-history.v1', 'frame.deflate.v1', 'session.list.compact.v1', 'session.snapshot.since.v1', 'session.fork.v1', 'commands.v1', 'workspace.v1', 'session.admin.v1', 'squads.v1', 'push.v1', 'usage.v1', 'usage.stats.v1', 'ui.v1', 'ui.list.v1', 'session.attachment.path.v1'], resume: 'snapshot', auth: 'unpaired' } }])
  })

  it('user declaring the capability receives the listing as one binary frame whose inflate is the text answer', async () => {
    // Given two paired connections listing the same roster, one declaring the capability
    const declaring = await listedAnswer(true)
    const plain = await listedAnswer(false)
    // When both listings are answered
    const textAnswer = plain[1]?.payload
    const binaryAnswer = declaring[1]
    if (textAnswer === undefined || binaryAnswer === undefined) throw new Error('both connections should answer the listing')
    // Then the declaring one was answered in a binary frame that inflates back into the text frame
    expect(declaring[0]?.opcode).toBe(OPCODE_TEXT)
    expect(binaryAnswer.opcode).toBe(OPCODE_BINARY)
    expect(inflateRawSync(binaryAnswer.payload).equals(textAnswer)).toBe(true)
    // And the compressed frame is what saved the bytes
    expect(binaryAnswer.payload.length).toBeLessThan(textAnswer.length)
  })

  it('user who declared nothing is answered the listing as text frames only', async () => {
    // Given a paired connection that declared no capability
    const frames = await listedAnswer(false)
    // When the listing is answered
    const answer = JSON.parse(frames[1]?.payload.toString('utf8') ?? '') as { r?: { sessions?: unknown[] } }
    // Then every frame is text, and the roster crossed whole
    expect(frames.map(frame => frame.opcode)).toEqual([OPCODE_TEXT, OPCODE_TEXT])
    expect(answer.r?.sessions).toHaveLength(rosterItems().length)
  })

  it('operator accepts a socket and Nagle is switched off on it', () => {
    // Given an accepted duplex that reports its Nagle switch
    const pair = socketPair()
    const calls: boolean[] = []
    ;(pair.socket as unknown as { setNoDelay: (noDelay: boolean) => void }).setNoDelay = value => { calls.push(value) }
    // When the upgrade is handed over
    serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head: Buffer.alloc(0), hub: makeBareHub().hub })
    // Then each frame is written out as it is handed over
    expect(calls).toEqual([true])
  })

  it('user writes two frames into the socket in one chunk and both are answered in order', async () => {
    // Given the production handoff over a real duplex
    const pair = socketPair()
    const bare = makeBareHub()
    serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head: Buffer.alloc(0), hub: bare.hub })
    // When two frames arrive in a single chunk of bytes
    pair.inbound.write(Buffer.concat([
      maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(1, 'hello', { proto: 1 }))),
      maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(2, 'session.list'))),
    ]))
    await nextTurn()
    await settle()
    // Then both were parsed out of the stream and both were answered
    const answers = serverFrames(pair.serverBytes()).map(frame => JSON.parse(frame.payload.toString('utf8')) as { id: number })
    expect(answers.map(answer => answer.id)).toEqual([1, 2])
  })

  it('operator hands the carrier bytes before the message handler exists and they are still answered', async () => {
    // Given bytes that reached the socket before any upgrade was handed over
    const pair = socketPair()
    const bare = makeBareHub()
    pair.inbound.write(maskedFrame(OPCODE_TEXT, Buffer.from(requestFrame(3, 'hello', { proto: 1 }))))
    await nextTurn()
    // When the upgrade is wired up afterwards
    serveUpgrade({ socket: pair.socket, secWebSocketKey: WEB_SOCKET_KEY, head: Buffer.alloc(0), hub: bare.hub })
    await nextTurn()
    await settle()
    // Then the frame that arrived first is delivered instead of being dropped
    const answers = serverFrames(pair.serverBytes()).map(frame => JSON.parse(frame.payload.toString('utf8')) as unknown)
    expect(answers).toEqual([
      { t: 'res', id: 3, ok: true, r: { proto: 1, minor: 22, server: 'dsh-remote-bridge', capabilities: ['session.snapshot.trim.v1', 'session.snapshot.page.v1', 'questions.v1', 'questions.list.v1', 'subagent.thread.v1', 'jobs.v1', 'agents.v1', 'delta.v1', 'session.list.omit-archived.v1', 'session.deep-history.v1', 'frame.deflate.v1', 'session.list.compact.v1', 'session.snapshot.since.v1', 'session.fork.v1', 'commands.v1', 'workspace.v1', 'session.admin.v1', 'squads.v1', 'push.v1', 'usage.v1', 'usage.stats.v1', 'ui.v1', 'ui.list.v1', 'session.attachment.path.v1'], resume: 'snapshot', auth: 'unpaired' } },
    ])
  })
})

