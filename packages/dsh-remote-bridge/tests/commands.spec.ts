/**
 * The command channel: the host's slash-command registry and one session's skill
 * catalog behind one capability, the directory the two fold into, and the
 * dispatch that reports whether a line the phone wrote resolved.
 * @module tests/commands
 */

import { describe, expect, it } from 'vitest'
import { CAP_COMMANDS, SERVED_CAPABILITIES } from '../src/core/protocol.ts'
import { commandsUnavailable } from '../src/core/commands.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/** The host registry's effective view for one Agent, in the registry's own order. */
const COMMANDS: readonly Record<string, unknown>[] = [
  { name: 'compact', description: 'compact the conversation above', definitionId: 'compact' },
  { name: 'plan', description: 'plan before acting', input: { hint: 'what to plan' } },
]

/** That session's skill catalog, in the catalog's own order. */
const SKILLS: readonly Record<string, unknown>[] = [
  { name: 'adversarial-acceptance', description: 'review a deliverable before handing it over', modelInvocable: true },
  { name: 'handoff', description: 'compress this session into a hand-off', modelInvocable: true, path: '/skills/handoff/SKILL.md' },
]

/** A host whose two catalogs answer the tables above and whose dispatch resolves every line. */
function catalogs(call: { readonly namespace: string; readonly method: string }): unknown {
  if (call.namespace === 'commands' && call.method === 'list') return [...COMMANDS]
  if (call.namespace === 'skills' && call.method === 'list') return { skills: [...SKILLS] }
  if (call.namespace === 'commands' && call.method === 'execute') return { commandId: 'cmd-1', result: { kind: 'success' } }
  return { accepted: true }
}

/**
 * Hold the connection until the bridge has answered the handshake.
 * @param options.cap - the capabilities the greeting declares.
 * @param options.paired - whether the connection carries a device token.
 * @returns the harness, so a suite can read what crossed.
 */
async function commandConnection(options: { readonly cap?: readonly string[]; readonly paired?: boolean } = {}): Promise<ConnectionHarness> {
  const harness = makeConnection({ paired: options.paired ?? true })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...(options.cap ?? [CAP_COMMANDS])] }))
  harness.gateway.handler = async call => catalogs(call)
  return harness
}

/** @returns how many calls the bridge made into the two catalogs and the dispatch. */
function channelCalls(harness: ConnectionHarness): number {
  return harness.gateway.countOf('commands', 'list') + harness.gateway.countOf('skills', 'list') + harness.gateway.countOf('commands', 'execute')
}

describe('session.commands', () => {
  it('operator opening the directory is handed every command first and every skill after, each with the line that runs it', async () => {
    // Given a host whose registry offers two commands and whose session sees two skills
    const harness = await commandConnection()
    // When the phone asks for the session's directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then the answer names the session and lists both catalogs in one flat order
    const answer = answerOf(harness, 2)
    expect(answer.ok).toBe(true)
    const body = answer.r as { sessionId: string; items: { name: string; description: string; kind: string; line: string }[] }
    expect(body.sessionId).toBe('s-1')
    // And every command comes before every skill, each in the host's own order
    expect(body.items.map(item => item.name)).toEqual(['compact', 'plan', 'adversarial-acceptance', 'handoff'])
    expect(body.items.map(item => item.kind)).toEqual(['command', 'command', 'skill', 'skill'])
    // And the summary is the host's own, unedited
    expect(body.items.map(item => item.description)).toEqual([
      'compact the conversation above',
      'plan before acting',
      'review a deliverable before handing it over',
      'compress this session into a hand-off',
    ])
    // And each row carries the whole draft line, separator space included
    expect(body.items.map(item => item.line)).toEqual(['/compact ', '/plan ', '/adversarial-acceptance ', '/handoff '])
  })

  it('operator listing a session asks the registry by agent id and the catalog by session id, on the endpoints the host declares', async () => {
    // Given a host serving both catalogs
    const harness = await commandConnection()
    // When the phone lists that session's directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then the registry was addressed by its own agent argument, one key and no request wrapper
    expect(harness.gateway.lastArgs('commands', 'list')).toEqual({ agentId: 's-1' })
    // And the skill catalog was addressed by the session it answers for
    expect(harness.gateway.lastArgs('skills', 'list')).toEqual({ request: { sessionId: 's-1' } })
  })

  it('operator listing a directory twice pays for two live reads, because nothing here is cached across calls', async () => {
    // Given a host whose catalogs answer the same table twice
    const harness = await commandConnection()
    // When the phone lists the directory twice
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    await harness.connection.handleText(requestFrame(3, 'session.commands', { sessionId: 's-1' }))
    // Then both catalogs were read again: a command registered between the two calls is in the second answer
    expect(harness.gateway.countOf('commands', 'list')).toBe(2)
    expect(harness.gateway.countOf('skills', 'list')).toBe(2)
    expect(answerOf(harness, 2).r).toEqual(answerOf(harness, 3).r)
  })

  it('operator whose host answers a row with no name is handed the rest of the directory rather than a slash-undefined row', async () => {
    // Given a registry answer carrying a row this bridge cannot render
    const harness = await commandConnection()
    harness.gateway.handler = async call => (call.namespace === 'commands' && call.method === 'list'
      ? [{ name: 'compact', description: 'compact the conversation above' }, { description: 'no name at all' }, { name: 'plan' }]
      : { skills: [] })
    // When the phone lists the directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then only the rows carrying both a name and a summary crossed
    const body = answerOf(harness, 2).r as { items: { name: string; description: string }[] }
    expect(body.items).toEqual([{ name: 'compact', description: 'compact the conversation above', kind: 'command', line: '/compact ' }])
  })

  it('operator whose host composes no command registry is told the channel is unavailable, not that the call failed', async () => {
    // Given a host whose gateway exports no such endpoint at all
    const harness = await commandConnection()
    harness.gateway.handler = async call => {
      if (call.namespace === 'commands') {
        throw Object.assign(new Error('no active Remote method exports this endpoint'), { code: 'gateway/invocation-unavailable' })
      }
      return { skills: [] }
    }
    // When the phone lists the directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then the answer is this bridge's own code for a host that serves no such channel
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'commands-unavailable', msg: 'this host serves no commands/list endpoint' } })
  })

  it('operator whose host composes no skill catalog is told the same, and the second read is not attempted', async () => {
    // Given a host that serves the registry but no skill catalog
    const harness = await commandConnection()
    harness.gateway.handler = async call => {
      if (call.namespace === 'skills') {
        throw Object.assign(new Error('its strict definition was withdrawn'), { code: 'gateway/definition-unavailable' })
      }
      return [...COMMANDS]
    }
    // When the phone lists the directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then the channel is reported unavailable and the answer carries no partial directory
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'commands-unavailable', msg: 'this host serves no skills/list endpoint' } })
  })

  it('operator is told the channel is unavailable only when the endpoint is absent, never when the service is activating', () => {
    // Given the two failures the gateway raises before a call runs, and one it raises during one
    // When each is read as a channel failure
    // Then only an endpoint nothing exports is this bridge's own code; an activation window
    // and a refusal a handler raised keep their own codes, because both can pass
    expect(commandsUnavailable('gateway/invocation-unavailable')).toBe(true)
    expect(commandsUnavailable('definition-unavailable')).toBe(true)
    expect(commandsUnavailable('gateway/service-unavailable')).toBe(false)
    expect(commandsUnavailable('commands/unknown-command')).toBe(false)
  })

  it('operator listing without a session id is refused before either catalog is read', async () => {
    // Given a host that would answer any directory it was asked for
    const harness = await commandConnection()
    // When the phone omits the session, or names one with no text in it
    await harness.connection.handleText(requestFrame(2, 'session.commands', {}))
    await harness.connection.handleText(requestFrame(3, 'session.commands', { sessionId: '' }))
    // Then both are refused here, and nothing was read
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.commands requires sessionId' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.commands requires sessionId' } })
    expect(channelCalls(harness)).toBe(0)
  })
})

describe('session.command', () => {
  it('operator running a line the host resolves has it forwarded unchanged and is told it matched', async () => {
    // Given a host whose registry knows /compact
    const harness = await commandConnection()
    // When the phone runs that line
    await harness.connection.handleText(requestFrame(2, 'session.command', { sessionId: 's-1', line: '/compact ' }))
    // Then the line crossed exactly as written, with an empty attachment list
    expect(harness.gateway.lastArgs('commands', 'execute')).toEqual({ agentId: 's-1', line: '/compact ', submittedAttachments: [] })
    // And the answer is the one decided fact: the host resolved it
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { matched: true } })
  })

  it('operator running a line the host resolves to nothing is told it did not match, and nothing ran', async () => {
    // Given a host whose registry has no entry for a skill's gesture
    const harness = await commandConnection()
    harness.gateway.handler = async () => undefined
    // When the phone runs a skill line, a name the registry never had, and text with no slash at all
    await harness.connection.handleText(requestFrame(2, 'session.command', { sessionId: 's-1', line: '/adversarial-acceptance ' }))
    await harness.connection.handleText(requestFrame(3, 'session.command', { sessionId: 's-1', line: '/not-a-command' }))
    await harness.connection.handleText(requestFrame(4, 'session.command', { sessionId: 's-1', line: 'compact' }))
    // Then each answer says the host resolved nothing, and each line still crossed
    for (const id of [2, 3, 4]) expect(answerOf(harness, id)).toEqual({ ok: true, r: { matched: false } })
    expect(harness.gateway.countOf('commands', 'execute')).toBe(3)
  })

  it('operator whose host refuses the dispatch is told the host code and text unchanged', async () => {
    // Given a registry whose handler fails in its own vocabulary
    const harness = await commandConnection()
    harness.gateway.handler = async () => {
      throw Object.assign(new Error('this agent has no /compact'), { code: 'commands/unknown-command' })
    }
    // When the phone runs that line
    await harness.connection.handleText(requestFrame(2, 'session.command', { sessionId: 's-1', line: '/compact' }))
    // Then the refusal is the host's own, with nothing renamed
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'commands/unknown-command', msg: 'this agent has no /compact' } })
  })

  it('operator running a line on a host with no command service is told the channel is unavailable', async () => {
    // Given a gateway that exports no dispatch endpoint
    const harness = await commandConnection()
    harness.gateway.handler = async () => {
      throw Object.assign(new Error('no active Remote method exports this endpoint'), { code: 'gateway/invocation-unavailable' })
    }
    // When the phone runs a line
    await harness.connection.handleText(requestFrame(2, 'session.command', { sessionId: 's-1', line: '/compact' }))
    // Then the bridge answers its own code for an absent channel
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'commands-unavailable', msg: 'this host serves no commands/execute endpoint' } })
  })

  it('operator running a line that names no session or no line is refused before the host is asked', async () => {
    // Given a host that would dispatch any line it was sent
    const harness = await commandConnection()
    // When the phone omits the session, the line, or sends an empty line
    await harness.connection.handleText(requestFrame(2, 'session.command', { line: '/compact' }))
    await harness.connection.handleText(requestFrame(3, 'session.command', { sessionId: 's-1' }))
    await harness.connection.handleText(requestFrame(4, 'session.command', { sessionId: 's-1', line: '' }))
    // Then all three are refused here and no dispatch crossed
    for (const id of [2, 3, 4]) {
      expect(answerOf(harness, id)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'session.command requires sessionId and line' } })
    }
    expect(channelCalls(harness)).toBe(0)
  })
})

describe('commands.v1', () => {
  it('operator who never declared the channel has both methods refused as unknown and no catalog is read', async () => {
    // Given a connection that declared nothing at all
    const harness = await commandConnection({ cap: [] })
    // When the phone calls either method anyway
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    await harness.connection.handleText(requestFrame(3, 'session.command', { sessionId: 's-1', line: '/compact' }))
    // Then both are absent from this client's protocol, exactly as before the channel
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method session.commands' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method session.command' } })
    // And the host was asked nothing on its behalf: not one gateway call
    expect(channelCalls(harness)).toBe(0)
  })

  it('operator who is not paired is refused before the channel reaches the host', async () => {
    // Given a connection that declared the channel but presented no device token
    const harness = await commandConnection({ paired: false })
    // When the phone lists the directory
    await harness.connection.handleText(requestFrame(2, 'session.commands', { sessionId: 's-1' }))
    // Then pairing comes first, and nothing was read
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unpaired', msg: 'this connection is not paired' } })
    expect(channelCalls(harness)).toBe(0)
  })

  it('user greets the bridge and finds the command channel in the served capabilities with the minor beside it', async () => {
    // Given a client that greets the bridge without declaring anything
    const harness = makeConnection({ paired: true })
    // When the handshake is answered
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, client: 'ios/0.1' }))
    // Then the announcement carries the capability this channel added and the minor it raised
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toEqual([...SERVED_CAPABILITIES])
    expect(hello.capabilities).toContain(CAP_COMMANDS)
  })
})
