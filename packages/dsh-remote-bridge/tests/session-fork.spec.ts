/**
 * The fork channel: the host's `session/fork` forwarded behind one capability,
 * the fork point a caller may name, and the announcement that puts the method in
 * a client's protocol at all.
 * @module tests/session-fork
 */

import { describe, expect, it } from 'vitest'
import { CAP_AGENTS, CAP_SESSION_FORK, SERVED_CAPABILITIES } from '../src/core/protocol.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** The host's own answer to a fork: one new session id, nothing else. */
function forked(): Record<string, unknown> {
  return { sessionId: 'session-forked' }
}

/**
 * Hold the connection until the bridge has answered one request.
 * @returns the harness so a suite can read what crossed.
 */
async function forkingConnection(options: { readonly cap?: readonly string[]; readonly paired?: boolean } = {}): Promise<ConnectionHarness> {
  const harness = makeConnection({ paired: options.paired ?? true })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...(options.cap ?? [CAP_SESSION_FORK])] }))
  harness.gateway.handler = async call => call.namespace === 'session' && call.method === 'fork' ? forked() : { accepted: true }
  return harness
}

describe('session.fork', () => {
  it('operator forking a session at an event seq has the fork point forwarded and the answer returned unchanged', async () => {
    // Given a host that opens a new session from a named source event
    const harness = await forkingConnection()
    // When the phone forks the session at seq 41
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source', atSeq: 41 }))
    // Then the fork point crossed as the endpoint's single request argument, unrenamed
    expect(harness.gateway.lastArgs('session', 'fork')).toEqual({ request: { sessionId: 'session-source', atSeq: 41 } })
    // And the answer is the host's own body: one key, the new session id
    const answer = answerOf(harness, 2)
    expect(answer.ok).toBe(true)
    expect(answer.r).toEqual({ sessionId: 'session-forked' })
    expect(Object.keys(answer.r as Record<string, unknown>)).toEqual(['sessionId'])
  })

  it('operator who names no fork point leaves atSeq off the host request entirely', async () => {
    // Given a host whose newest finished turn is the fork point when none is named
    const harness = await forkingConnection()
    // When the phone forks without an atSeq
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then the host request carries sessionId alone: an absent fork point was not invented here
    const args = harness.gateway.lastArgs('session', 'fork') as { request: Record<string, unknown> }
    expect(args).toEqual({ request: { sessionId: 'session-source' } })
    expect(Object.hasOwn(args.request, 'atSeq')).toBe(false)
  })

  it('operator naming a fork point that is not an event seq is refused before the host is asked', async () => {
    // Given a host that would answer any fork it was sent
    const harness = await forkingConnection()
    // When the phone names a cut no event log could have — zero, a negative, a
    // fraction, a string, null, an object
    const cuts: unknown[] = [0, -3, 1.5, '41', null, { seq: 41 }]
    for (const [index, atSeq] of cuts.entries()) {
      await harness.connection.handleText(requestFrame(10 + index, 'session.fork', { sessionId: 'session-source', atSeq }))
    }
    // Then each is refused by this bridge, and no fork was ever forwarded
    for (const index of cuts.keys()) {
      expect(answerOf(harness, 10 + index)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.fork atSeq must be a positive integer' } })
    }
    expect(harness.gateway.countOf('session', 'fork')).toBe(0)
  })

  it('operator forking without a session id is refused before the host is asked', async () => {
    // Given a host that would answer any fork it was sent
    const harness = await forkingConnection()
    // When the phone omits the source session, or names one with no text in it
    await harness.connection.handleText(requestFrame(2, 'session.fork', {}))
    await harness.connection.handleText(requestFrame(3, 'session.fork', { sessionId: '' }))
    // Then both are refused here, and the host was asked nothing
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.fork requires sessionId' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.fork requires sessionId' } })
    expect(harness.gateway.countOf('session', 'fork')).toBe(0)
  })

  it('operator whose host refuses a fork is told the host code and text unchanged', async () => {
    // Given a host that cannot fork this session and says so in its own words
    const harness = await forkingConnection()
    harness.gateway.handler = async () => {
      throw Object.assign(new Error('this host forks no session while an agent turn is running'), { code: 'session/fork-unavailable' })
    }
    // When the phone forks that session
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-busy' }))
    // Then the refusal is the host's own, with nothing added and nothing renamed
    expect(answerOf(harness, 2)).toEqual({
      ok: false,
      e: { code: 'session/fork-unavailable', msg: 'this host forks no session while an agent turn is running' },
    })
  })

  it('operator whose host fails without a code is still told the host text', async () => {
    // Given a fork that crashed carrying no code at all
    const harness = await forkingConnection()
    harness.gateway.handler = async () => { throw new Error('the fork writer crashed') }
    // When the phone forks a session
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then the only code left is this bridge's own internal, and the host's text is the message
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'internal', msg: 'the fork writer crashed' } })
  })

  it('operator whose host answers more than a session id receives exactly what the host wrote', async () => {
    // Given a host answer carrying a key this bridge has no name for
    const harness = await forkingConnection()
    harness.gateway.handler = async () => ({ sessionId: 'session-forked', forkedAtSeq: 41 })
    // When the phone forks a session
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then the body crossed verbatim: this bridge neither filters nor renames host keys
    expect(answerOf(harness, 2).r).toEqual({ sessionId: 'session-forked', forkedAtSeq: 41 })
  })
})

describe('session.fork.v1', () => {
  it('operator who never declared the fork channel has the method refused as unknown and no fork is forwarded', async () => {
    // Given a connection that declared nothing at all
    const harness = await forkingConnection({ cap: [] })
    // When the phone calls the fork method anyway
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then the method does not exist for this client, exactly as before the channel
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method session.fork' } })
    // And no fork was asked of the host on its behalf
    expect(harness.gateway.countOf('session', 'fork')).toBe(0)
  })

  it('operator who declared another channel but not this one is still told the method is unknown', async () => {
    // Given a connection that declared the agent channel only
    const harness = await forkingConnection({ cap: [CAP_AGENTS] })
    // When the phone calls the fork method
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then one capability does not open another: the fork channel is still absent
    expect(answerOf(harness, 2).e?.code).toBe('unknown-method')
    expect(harness.gateway.countOf('session', 'fork')).toBe(0)
  })

  it('operator who is not paired is refused before the fork reaches the host', async () => {
    // Given a connection that declared the channel but presented no device token
    const harness = await forkingConnection({ paired: false })
    // When the phone forks a session
    await harness.connection.handleText(requestFrame(2, 'session.fork', { sessionId: 'session-source' }))
    // Then pairing comes first, and the host was asked nothing
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unpaired', msg: 'this connection is not paired' } })
    expect(harness.gateway.countOf('session', 'fork')).toBe(0)
  })

  it('user greets the bridge and finds the fork channel among the served capabilities with the minor beside it', async () => {
    // Given a client that greets the bridge without declaring anything
    const harness = makeConnection({ paired: true })
    // When the handshake is answered
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, client: 'ios/0.1' }))
    // Then the announcement carries the minor and lists this channel; a channel that
    // shipped after it appends behind it, so its position is not what is asserted
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toEqual([...SERVED_CAPABILITIES])
    expect(hello.capabilities).toContain(CAP_SESSION_FORK)
  })
})
