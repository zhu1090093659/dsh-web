import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerOf, makeConnection, requestFrame, titlesDouble } from './support/harness.ts'
import { IDLE_PING_MS, LIVENESS_TIMEOUT_MS } from '../src/core/connection.ts'
import { SessionMeta } from '../src/core/session-meta.ts'
import { CLOSE_LIVENESS_TIMEOUT } from '../src/core/ws-frames.ts'

describe('protocol v1 authorization and dispatch', () => {
  afterEach(() => { vi.useRealTimers() })
  it('user greets the bridge before pairing and is told the connection is unpaired', async () => {
    // Given a connection that presented no device token
    const harness = makeConnection()
    // When the user sends the handshake
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, minor: 1, client: 'ios/0.1' }))
    // Then the handshake answers with this bridge's identity and the unpaired state
    expect(answerOf(harness, 1)).toEqual({
      ok: true,
      r: { proto: 1, minor: 22, server: 'dsh-remote-bridge', capabilities: ['session.snapshot.trim.v1', 'session.snapshot.page.v1', 'questions.v1', 'questions.list.v1', 'subagent.thread.v1', 'jobs.v1', 'agents.v1', 'delta.v1', 'session.list.omit-archived.v1', 'session.deep-history.v1', 'frame.deflate.v1', 'session.list.compact.v1', 'session.snapshot.since.v1', 'session.fork.v1', 'commands.v1', 'workspace.v1', 'session.admin.v1', 'squads.v1', 'push.v1', 'usage.v1', 'usage.stats.v1', 'ui.v1', 'ui.list.v1', 'session.attachment.path.v1'], resume: 'snapshot', auth: 'unpaired' },
    })
  })

  it('user greets the bridge with a protocol this one does not speak and is refused', async () => {
    // Given a client that announces protocol 2
    const harness = makeConnection()
    // When the user sends the handshake
    await harness.connection.handleText(requestFrame(2, 'hello', { proto: 2 }))
    // Then the version is refused by name instead of being answered as if compatible
    expect(answerOf(harness, 2).e?.code).toBe('proto-unsupported')
  })

  it('user unpaired reaches for a session and is refused without touching the host', async () => {
    // Given a connection with no device token
    const harness = makeConnection()
    // When the user lists sessions
    await harness.connection.handleText(requestFrame(3, 'session.list'))
    // Then the refusal is unpaired and no gateway call was made at all
    expect(answerOf(harness, 3).e?.code).toBe('unpaired')
    expect(harness.gateway.invocations).toEqual([])
  })

  it('user unpaired tries to answer an approval and is refused', async () => {
    // Given an unpaired connection and a question id that was never issued
    const harness = makeConnection()
    // When the user answers it
    await harness.connection.handleText(requestFrame(4, 'approval.resolve', { id: 'q-1', decision: 'allowed-once' }))
    // Then pairing is required before any approval can be answered
    expect(answerOf(harness, 4).e?.code).toBe('unpaired')
  })

  it('user unpaired may still begin and finish pairing', async () => {
    // Given an unpaired connection and a live bootstrap token
    const harness = makeConnection()
    const ticket = harness.pairing.issueToken()
    // When the user begins pairing with that token
    await harness.connection.handleText(requestFrame(5, 'pair.begin', { token: ticket.value }))
    // Then the bridge mints the nonce to sign and reports when it stops being accepted
    const answer = answerOf(harness, 5)
    const issued = answer.r as { nonce: string; expiresAt: number }
    expect(answer.ok).toBe(true)
    expect(issued.nonce.length).toBeGreaterThan(0)
    expect(issued.expiresAt).toBeGreaterThan(ticket.expiresAt)
  })

  it('user paired lists sessions through the gateway', async () => {
    // Given a paired connection and a host that serves one session
    const harness = makeConnection({ paired: true })
    harness.gateway.handler = async () => ({ items: [{ sessionId: 's-1', updatedAt: 5, running: false, blank: true, agentAvailable: true }] })
    // When the user lists sessions
    await harness.connection.handleText(requestFrame(6, 'session.list'))
    // Then the roster crosses in the protocol's own field names
    expect(answerOf(harness, 6).r).toEqual({ mode: 'reset', token: '', sessions: [{ id: 's-1', title: '', updatedAt: 5, agentRunning: false, blank: true }] })
  })

  it('user unpaired reaches for session titles and is refused without reading a title', async () => {
    // Given an unpaired connection on a host whose title service records every read
    const titles = titlesDouble({ 's-1': 'Plan the trip' })
    const harness = makeConnection({ sessionMeta: new SessionMeta(() => titles.faces, () => Date.now(), () => {}) })
    // When the user asks for that title
    await harness.connection.handleText(requestFrame(9, 'session.titles', { ids: ['s-1'] }))
    // Then pairing is required before any title is read
    expect(answerOf(harness, 9).e?.code).toBe('unpaired')
    expect(titles.reads).toEqual([])
  })

  it('user calls a method this protocol does not define and is refused by name', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When the user calls a method outside the frozen set
    await harness.connection.handleText(requestFrame(7, 'session.rename', { sessionId: 's-1' }))
    // Then the refusal names the unknown method and nothing reaches the host
    expect(answerOf(harness, 7).e?.code).toBe('unknown-method')
    expect(harness.gateway.invocations).toEqual([])
  })

  it('user sends a prompt without its text and is refused with the argument names', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When the user prompts with only a session and a request id
    await harness.connection.handleText(requestFrame(8, 'session.prompt', { sessionId: 's-1', requestId: 'r-1' }))
    // Then the refusal is about the arguments and no prompt was sent
    const answer = answerOf(harness, 8)
    expect(answer.e?.code).toBe('invalid-args')
    expect(answer.e?.msg).toBe('session.prompt requires sessionId, text and requestId')
    expect(harness.gateway.countOf('session', 'prompt')).toBe(0)
  })

  it('user sends a frame the envelope cannot read and still receives a correlation', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When the user sends a frame that is not JSON
    await harness.connection.handleText('{oops')
    // Then the refusal arrives on the reserved id so the socket does not go silent
    expect(harness.transport.frames()).toEqual([
      { t: 'res', id: 0, ok: false, e: { code: 'malformed', msg: 'frame is not JSON' } },
    ])
  })

  it('user answers the bridge heartbeat and receives nothing back', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When the user replies with a pong
    await harness.connection.handleText(JSON.stringify({ t: 'pong', ts: 1 }))
    // Then no frame is written: a pong only proves the socket is alive
    expect(harness.transport.frames()).toEqual([])
  })

  it('user leaves the socket idle and the bridge keeps it alive with a heartbeat', async () => {
    // Given a connection whose idle period the test controls
    vi.useFakeTimers()
    const harness = makeConnection({ paired: true, heartbeatMs: 20_000 })
    harness.connection.startHeartbeat()
    // When the socket has been quiet for one idle period
    await vi.advanceTimersByTimeAsync(20_000)
    // Then the bridge pinged it exactly once, and answers a client ping with its own timestamp echoed
    expect(harness.transport.ofType('ping')).toHaveLength(1)
    const pinged = harness.transport.ofType('ping')[0] as unknown as { ts: number }
    await harness.connection.handleText(JSON.stringify({ t: 'ping', ts: pinged.ts + 1 }))
    expect(harness.transport.ofType('pong')).toEqual([{ t: 'pong', ts: pinged.ts + 1 }])
    harness.connection.dispose()
    // Then a disposed connection stops heartbeating
    await vi.advanceTimersByTimeAsync(60_000)
    expect(harness.transport.ofType('ping')).toHaveLength(1)
  })

  it('user stops answering the heartbeat and the bridge closes the socket on the liveness deadline', async () => {
    // Given a connection whose heartbeat the test drives on a fake clock
    vi.useFakeTimers()
    const harness = makeConnection({ paired: true, heartbeatMs: IDLE_PING_MS })
    harness.connection.startHeartbeat()
    // When one idle period passes, the ping goes out and nothing closes yet: the
    // deadline only exists because that ping was sent
    await vi.advanceTimersByTimeAsync(IDLE_PING_MS)
    expect(harness.transport.ofType('ping')).toHaveLength(1)
    expect(harness.transport.closed).toBeUndefined()
    // When the user answers nothing and the deadline expires
    await vi.advanceTimersByTimeAsync(LIVENESS_TIMEOUT_MS)
    // Then the existing teardown path closes the socket under the liveness code
    expect(harness.transport.closed).toEqual({
      code: CLOSE_LIVENESS_TIMEOUT,
      reason: `no frame within ${LIVENESS_TIMEOUT_MS} ms of a liveness ping`,
    })
    expect(harness.connection.disposed).toBe(true)
    // Then one log line names the deadline, and the heartbeat is gone with it
    expect(harness.logs).toContain(`connection closed on the liveness deadline: no frame within ${LIVENESS_TIMEOUT_MS} ms of a liveness ping`)
    await vi.advanceTimersByTimeAsync(IDLE_PING_MS * 3)
    expect(harness.transport.ofType('ping')).toHaveLength(1)
  })

  it('user answers every ping and stays connected across several ping cycles', async () => {
    // Given a connection the bridge probes after each idle period
    vi.useFakeTimers()
    const harness = makeConnection({ paired: true, heartbeatMs: IDLE_PING_MS })
    harness.connection.startHeartbeat()
    // When three idle periods pass and the user answers every ping at once
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      // The next ping is one full idle period after the previous one, and the last
      // advance already spent a whole deadline of it.
      await vi.advanceTimersByTimeAsync(cycle === 1 ? IDLE_PING_MS : IDLE_PING_MS - LIVENESS_TIMEOUT_MS)
      expect(harness.transport.ofType('ping')).toHaveLength(cycle)
      await harness.connection.handleText(JSON.stringify({ t: 'pong', ts: cycle }))
      // Then a whole deadline passes after each answer without the socket closing
      await vi.advanceTimersByTimeAsync(LIVENESS_TIMEOUT_MS)
      expect(harness.transport.closed).toBeUndefined()
    }
    // Then the connection survived all three cycles
    expect(harness.connection.disposed).toBe(false)
    expect(harness.transport.ofType('ping')).toHaveLength(3)
  })

  it('user sends an unrelated frame and satisfies the liveness deadline without a pong', async () => {
    // Given a connection with one outstanding liveness ping
    vi.useFakeTimers()
    const harness = makeConnection({ paired: true, heartbeatMs: IDLE_PING_MS })
    harness.connection.startHeartbeat()
    await vi.advanceTimersByTimeAsync(IDLE_PING_MS)
    expect(harness.transport.ofType('ping')).toHaveLength(1)
    // When the user sends a frame that is not the pong the bridge asked for
    await harness.connection.handleText(JSON.stringify({ t: 'ping', ts: 42 }))
    // Then the existing client-ping answer is unchanged
    expect(harness.transport.ofType('pong')).toEqual([{ t: 'pong', ts: 42 }])
    // Then that frame alone satisfies the deadline the host's ping armed
    await vi.advanceTimersByTimeAsync(LIVENESS_TIMEOUT_MS)
    expect(harness.transport.closed).toBeUndefined()
    expect(harness.connection.disposed).toBe(false)
  })
})
