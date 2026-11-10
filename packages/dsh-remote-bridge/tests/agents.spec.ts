/**
 * The agent channel: the host's Agent-preset roster and session creation from a
 * preset, both forwarded rather than interpreted, and the capability that puts
 * them in a client's protocol at all.
 * @module tests/agents
 */

import { describe, expect, it } from 'vitest'
import { CAP_AGENTS } from '../src/core/protocol.ts'
import { answerOf, makeConnection, requestFrame } from './support/harness.ts'

/** A preset roster shaped the way the host registry publishes one. */
function roster(): Record<string, unknown> {
  return {
    presets: [
      { id: 'liangshen', label: 'Liangshen', description: 'a generalist', isDefault: true, plugins: ['dsh-liangshen'] },
      { id: 'coder', label: 'Coder', description: '', isDefault: false, plugins: [] },
    ],
    // A key this bridge has no name for, which is exactly why it must survive.
    defaultId: 'liangshen',
  }
}

/** A creation request whose shape this bridge has never been taught. */
function creation(): Record<string, unknown> {
  return {
    agentPreset: 'liangshen',
    cwd: '/Users/zcl/code/x',
    model: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' },
    // A field no version of this bridge documents: dropped would mean rewritten.
    permission: { mode: 'workspace-write', preset: 'standard' },
  }
}

/** One paired connection that declared the agent channel, and the host it speaks to. */
async function declaringConnection() {
  const harness = makeConnection({ paired: true })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_AGENTS] }))
  return harness
}

describe('presets.list', () => {
  it('operator reading the preset roster receives the host answer byte for byte', async () => {
    // Given a host whose registry answers a roster carrying keys this bridge does not read
    const harness = await declaringConnection()
    const answered = roster()
    harness.gateway.handler = async call =>
      call.namespace === 'agentPresets' && call.method === 'list' ? answered : { accepted: true }
    // When the phone lists presets
    await harness.connection.handleText(requestFrame(2, 'presets.list'))
    // Then the answer is the host's own body, and the endpoint took no argument
    expect(JSON.stringify(answerOf(harness, 2).r)).toBe(JSON.stringify(answered))
    expect(harness.gateway.lastArgs('agentPresets', 'list')).toEqual({})
  })

  it('operator whose host refuses the roster is told the host code and text unchanged', async () => {
    // Given a host whose registry fails with a code of its own
    const harness = await declaringConnection()
    harness.gateway.handler = async () => {
      throw Object.assign(new Error('the agent-preset registry is not composed on this host'), { code: 'agentPresets/unavailable' })
    }
    // When the phone lists presets
    await harness.connection.handleText(requestFrame(3, 'presets.list'))
    // Then the host's own code and text crossed, with no code table of this bridge's invented
    expect(answerOf(harness, 3)).toEqual({
      ok: false,
      e: { code: 'agentPresets/unavailable', msg: 'the agent-preset registry is not composed on this host' },
    })
  })

  it('operator whose host fails without a code is still told the host text', async () => {
    // Given a host failure that carries no code at all
    const harness = await declaringConnection()
    harness.gateway.handler = async () => { throw new Error('preset discovery crashed') }
    // When the phone lists presets
    await harness.connection.handleText(requestFrame(4, 'presets.list'))
    // Then the only code left is this bridge's own internal, and the host's text is the message
    expect(answerOf(harness, 4)).toEqual({ ok: false, e: { code: 'internal', msg: 'preset discovery crashed' } })
  })
})

describe('session.create', () => {
  it('operator creating an Agent from a preset has the whole request forwarded unchanged', async () => {
    // Given a host that answers a creation with a value of its own
    const harness = await declaringConnection()
    const answered = { sessionId: 'session-new', agentPreset: 'liangshen', workspace: { id: 'w-1' }, created: true }
    harness.gateway.handler = async call =>
      call.namespace === 'session' && call.method === 'create' ? answered : { accepted: true }
    const request = creation()
    // When the phone creates a session from that preset
    await harness.connection.handleText(requestFrame(2, 'session.create', request))
    // Then the request crossed as the endpoint's single named argument, unrenamed and undefaulted
    expect(harness.gateway.lastArgs('session', 'create')).toEqual({ request })
    // And the answer is the host's own body
    expect(JSON.stringify(answerOf(harness, 2).r)).toBe(JSON.stringify(answered))
  })

  it('operator whose host rejects a creation is told the host reason in full', async () => {
    // Given a host that refuses the request with a code and a sentence of its own
    const harness = await declaringConnection()
    harness.gateway.handler = async () => {
      throw Object.assign(new Error('agentPreset liangshen has no workspace this host can open'), { code: 'session/invalid-request' })
    }
    // When the phone creates a session
    await harness.connection.handleText(requestFrame(3, 'session.create', creation()))
    // Then the refusal is the host's own, with nothing added and nothing renamed
    expect(answerOf(harness, 3)).toEqual({
      ok: false,
      e: { code: 'session/invalid-request', msg: 'agentPreset liangshen has no workspace this host can open' },
    })
  })

  it('operator creating a session without a preset name is refused by the host, not by the bridge', async () => {
    // Given a host that rejects a body missing the field it requires
    const harness = await declaringConnection()
    const seen: unknown[] = []
    harness.gateway.handler = async call => {
      seen.push(call.args)
      throw Object.assign(new Error('request.agentPreset is required'), { code: 'gateway/arguments-invalid' })
    }
    // When the phone sends an empty creation request
    await harness.connection.handleText(requestFrame(4, 'session.create', {}))
    // Then the empty body still reached the host, and its refusal came back unchanged
    expect(seen).toEqual([{ request: {} }])
    expect(answerOf(harness, 4)).toEqual({ ok: false, e: { code: 'gateway/arguments-invalid', msg: 'request.agentPreset is required' } })
  })
})

describe('the agent channel as one capability', () => {
  it('operator greeting the bridge is told the channel and the minor that carries it', async () => {
    // Given a paired connection
    const harness = makeConnection({ paired: true })
    // When it greets the bridge
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // Then the announcement names the capability and the minor version beside it
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toContain(CAP_AGENTS)
    // And greeting alone asked the host for nothing
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator on a client written before the channel is told both methods are unknown', async () => {
    // Given a paired connection that declared unrelated capabilities only
    const harness = makeConnection({ paired: true })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['jobs.v1', 'delta.v1'] }))
    // When it reaches for either new method
    await harness.connection.handleText(requestFrame(2, 'presets.list'))
    await harness.connection.handleText(requestFrame(3, 'session.create', creation()))
    // Then both are unknown to it, exactly as they were before this channel existed
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method presets.list' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method session.create' } })
    // And no request was made on its behalf
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator who declared the channel but calls nothing costs the host nothing', async () => {
    // Given a paired connection that declared the channel
    const harness = await declaringConnection()
    // When it sends no call at all
    // Then the host was never asked for a preset roster or a creation
    expect(harness.gateway.invocations).toEqual([])
    expect(harness.gateway.countOf('agentPresets', 'list')).toBe(0)
    expect(harness.gateway.countOf('session', 'create')).toBe(0)
  })
})
