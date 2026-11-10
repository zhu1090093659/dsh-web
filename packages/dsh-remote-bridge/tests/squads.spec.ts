/**
 * The squads channel: the dsh-agents squad domain behind one capability, the five
 * commands a phone reads and drives it with, and the two ways a Host reaches that
 * domain — the plugin's own loopback routes, and its ledger read-only when no
 * route can be reached.
 * @module tests/squads
 */

import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CAP_SQUADS } from '../src/core/protocol.ts'
import { squadsStateOf, SquadRefusal, type SquadMemberRunRequest, type SquadRunRequest, type SquadTransport } from '../src/core/squads.ts'
import { LoopbackSquads } from '../src/host/squads.ts'
import { answerOf, makeConnection, requestFrame, type ConnectionHarness } from './support/harness.ts'

/**
 * One squad domain exactly as the plugin publishes it: both definition
 * timestamps, the member backlink, the run goal and the preset list, so the
 * mapping is asserted against a body that carries every field a client must not
 * see.
 */
function stateDocument(): Record<string, unknown> {
  return {
    teams: [
      {
        id: 'squad-1',
        name: 'Ship it',
        description: 'the release squad',
        workspaceId: 'w-1',
        leadPreset: 'liangshen',
        order: 2,
        createdAt: 1760000000000,
        updatedAt: 1760000000500,
        members: [
          {
            id: 'm-1',
            teamId: 'squad-1',
            name: 'Lead',
            preset: 'liangshen',
            permission: 'workspace-write',
            createdAt: 1760000000000,
            updatedAt: 1760000000000,
          },
          {
            id: 'm-2',
            teamId: 'squad-1',
            name: 'Reviewer',
            model: 'deepseek/deepseek-chat',
            reasoningEffort: 'high',
            brief: 'read the diff before the merge',
            createdAt: 1760000000100,
            updatedAt: 1760000000100,
          },
        ],
      },
    ],
    runs: [
      { id: 'run-1', teamId: 'squad-1', memberId: 'm-1', sessionId: 's-1', createdAt: 1760000001000, status: 'running' },
      {
        id: 'run-2',
        teamId: 'squad-1',
        sessionId: 's-2',
        createdAt: 1760000002000,
        status: 'failed',
        failure: 'session/create refused',
        kind: 'squad',
        goal: 'ship 0.5.0',
      },
    ],
    host: { ownerPid: 4242 },
    presets: ['liangshen', 'coder'],
  }
}

/** The frozen body that same domain crosses as. */
function expectedState(): Record<string, unknown> {
  return {
    squads: [
      {
        id: 'squad-1',
        name: 'Ship it',
        description: 'the release squad',
        workspaceId: 'w-1',
        leadPreset: 'liangshen',
        order: 2,
        members: [
          { id: 'm-1', name: 'Lead', preset: 'liangshen', permission: 'workspace-write' },
          { id: 'm-2', name: 'Reviewer', model: 'deepseek/deepseek-chat', reasoningEffort: 'high', brief: 'read the diff before the merge' },
        ],
      },
    ],
    runs: [
      { id: 'run-1', squadId: 'squad-1', kind: 'member', memberId: 'm-1', sessionId: 's-1', createdAt: 1760000001000, status: 'running' },
      {
        id: 'run-2',
        squadId: 'squad-1',
        kind: 'squad',
        sessionId: 's-2',
        createdAt: 1760000002000,
        status: 'failed',
        failure: 'session/create refused',
      },
    ],
    presets: ['liangshen', 'coder'],
    host: { ownerPid: 4242 },
  }
}

/** One member launch as the plugin records it: no member field drift, no goal. */
function memberRunDocument(): Record<string, unknown> {
  return { run: { id: 'run-9', teamId: 'squad-1', memberId: 'm-2', sessionId: 's-9', createdAt: 1760000009000, status: 'running' } }
}

/** One whole-squad launch as the plugin records it: a squad run names no member. */
function squadRunDocument(): Record<string, unknown> {
  return { run: { id: 'run-8', teamId: 'squad-1', sessionId: 's-8', createdAt: 1760000008000, status: 'running', kind: 'squad', goal: 'ship it' } }
}

/** A squad domain a test scripts: what the reads answer, what each launch is asked, and how often. */
class FakeSquadHost implements SquadTransport {
  readonly launches: { readonly kind: string; readonly request: unknown }[] = []
  reads = 0
  stateAnswer: () => Promise<unknown> = async () => stateDocument()
  runAnswer: (request: unknown) => Promise<unknown> = async () => memberRunDocument()
  squadRunAnswer: (request: unknown) => Promise<unknown> = async () => squadRunDocument()

  state(): Promise<unknown> {
    this.reads += 1
    return this.stateAnswer()
  }

  runMember(request: SquadMemberRunRequest): Promise<unknown> {
    this.launches.push({ kind: 'member', request })
    return this.runAnswer(request)
  }

  runSquad(request: SquadRunRequest): Promise<unknown> {
    this.launches.push({ kind: 'squad', request })
    return this.squadRunAnswer(request)
  }
}

/**
 * One paired connection that greeted the bridge with the given capabilities.
 * @param host - the squad domain behind it, or undefined for a host serving none.
 * @param options.cap - the capabilities the greeting declares.
 * @param options.paired - whether the connection carries a device token.
 * @returns the harness, so a suite can read what crossed.
 */
async function squadConnection(
  host: FakeSquadHost | undefined,
  options: { readonly cap?: readonly string[]; readonly paired?: boolean } = {},
): Promise<ConnectionHarness> {
  const harness = makeConnection({
    paired: options.paired ?? true,
    ...(host === undefined ? {} : { squads: host }),
  })
  await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [...(options.cap ?? [CAP_SQUADS])] }))
  return harness
}

/** One request a real loopback endpoint received. */
interface SeenRequest {
  readonly method: string
  readonly url: string
  readonly origin: string | undefined
  readonly body: unknown
}

/** A real loopback endpoint a test answers with, recording what each request carried. */
interface TestEndpoint {
  readonly origin: string
  readonly seen: SeenRequest[]
  close(): Promise<void>
}

/**
 * Run one real loopback endpoint.
 * @param answer - the status and JSON body to reply with, per request.
 * @returns the origin to address it at, every request it saw, and the disposer.
 */
async function serveEndpoint(answer: (request: SeenRequest) => { status: number; body: unknown }): Promise<TestEndpoint> {
  const seen: SeenRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const request: SeenRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        origin: req.headers.origin,
        body: text === '' ? undefined : JSON.parse(text) as unknown,
      }
      seen.push(request)
      const reply = answer(request)
      res.writeHead(reply.status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: 'http://127.0.0.1:' + String(port),
    seen,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => (error === undefined ? resolve() : reject(error)))
    }),
  }
}

/** An origin nothing listens on: bound once, then closed, so a call to it cannot connect. */
async function closedOrigin(): Promise<string> {
  const endpoint = await serveEndpoint(() => ({ status: 200, body: {} }))
  await endpoint.close()
  return endpoint.origin
}

const workDirs: string[] = []

afterAll(() => {
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true })
})

/** One plugin-owned directory holding the ledger and lock a dsh-agents Host would have written. */
function ledgerDirectory(options: { readonly ledger?: unknown; readonly raw?: string; readonly lock?: unknown } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-squads-'))
  workDirs.push(dir)
  if (options.raw !== undefined) writeFileSync(join(dir, 'ledger.json'), options.raw)
  else if (options.ledger !== undefined) writeFileSync(join(dir, 'ledger.json'), JSON.stringify(options.ledger))
  if (options.lock !== undefined) writeFileSync(join(dir, 'ledger.json.lock'), JSON.stringify(options.lock))
  return dir
}

/** The persisted document the plugin writes, without the pids and presets its route adds. */
function ledgerDocument(): Record<string, unknown> {
  const state = stateDocument()
  return { schemaVersion: 1, revision: 7, teams: state.teams, runs: state.runs }
}

/** One loopback transport over the given origin and ledger directory. */
function transportTo(origin: string, directory: string): LoopbackSquads {
  return new LoopbackSquads({ origin: () => origin, ledgerDirectory: () => directory, log: () => undefined })
}

describe('the squads channel as one capability', () => {
  it('operator greeting the bridge is told the channel and the minor that carries it', async () => {
    // Given a paired connection
    const harness = await squadConnection(undefined)
    // When it greets the bridge
    const hello = answerOf(harness, 1).r as { minor: number; capabilities: string[] }
    // Then the announcement names the capability beside the minor that carries it
    expect(hello.minor).toBe(22)
    expect(hello.capabilities).toContain(CAP_SQUADS)
    // And greeting alone asked the domain for nothing
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator on a client written before the channel is told all five commands are unknown', async () => {
    // Given a paired connection that declared the neighbouring channels only
    const host = new FakeSquadHost()
    const harness = await squadConnection(host, { cap: ['agents.v1', 'commands.v1'] })
    // When it reaches for every squads command
    const commands: readonly (readonly [string, Record<string, unknown>])[] = [
      ['squads.state', {}],
      ['squads.list', {}],
      ['squads.runs', {}],
      ['squads.runMember', { squadId: 'squad-1', memberId: 'm-1' }],
      ['squads.runSquad', { squadId: 'squad-1' }],
    ]
    let id = 2
    for (const [method, payload] of commands) {
      await harness.connection.handleText(requestFrame(id, method, payload))
      expect(answerOf(harness, id)).toEqual({ ok: false, e: { code: 'unknown-method', msg: 'unknown method ' + method } })
      id += 1
    }
    // Then the domain was neither read nor launched
    expect(host.reads).toBe(0)
    expect(host.launches).toEqual([])
  })

  it('operator who declared the channel but calls nothing costs the host nothing', async () => {
    // Given a paired connection
    const host = new FakeSquadHost()
    // When it greets the bridge and sends no call at all
    await squadConnection(host)
    // Then nothing was read and nothing was launched
    expect(host.reads).toBe(0)
    expect(host.launches).toEqual([])
  })

  it('operator without a device token is told the channel needs pairing', async () => {
    // Given an unpaired connection that declared the channel
    const host = new FakeSquadHost()
    const harness = await squadConnection(host, { paired: false })
    // When it asks for the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the pairing gate answers, not the capability
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'unpaired', msg: 'this connection is not paired' } })
    expect(host.reads).toBe(0)
  })
})

describe('squads.state', () => {
  it('user reading the state is handed both halves mapped field by field', async () => {
    // Given a host whose domain carries timestamps, backlinks and a goal
    const harness = await squadConnection(new FakeSquadHost())
    // When the phone reads the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then every contract field crossed and nothing else did
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: expectedState() })
  })

  it('user reading a domain whose list is empty is told so, not refused', async () => {
    // Given a host that serves a domain with nothing in it
    const host = new FakeSquadHost()
    host.stateAnswer = async () => ({ teams: [], runs: [], host: {} })
    const harness = await squadConnection(host)
    // When the phone reads the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the answer is an empty domain with no pid, and no invented preset list
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { squads: [], runs: [], host: {} } })
  })

  it('user whose host serves no squad domain is refused instead of shown an empty board', async () => {
    // Given a host with no dsh-agents domain at all
    const harness = await squadConnection(undefined)
    // When the phone reads the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the refusal names this bridge's own capability code
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'squads-unavailable', msg: 'this host serves no dsh-agents squad domain' } })
  })

  it('user whose host answers an unreadable body is refused instead of shown a repaired one', async () => {
    // Given a host whose answer is not one squad domain
    const host = new FakeSquadHost()
    host.stateAnswer = async () => ({ teams: 'the release squad', runs: [] })
    const harness = await squadConnection(host)
    // When the phone reads the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the read is refused rather than answered with rows this bridge invented
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'squads-unavailable', msg: 'the dsh-agents state answer is not a squad domain this bridge can read' } })
  })
})

describe('squads.list and squads.runs', () => {
  it('user listing squads is handed the definitions half of one read', async () => {
    // Given a host whose domain carries both halves
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone lists squads
    await harness.connection.handleText(requestFrame(2, 'squads.list'))
    // Then exactly the squads half crossed, and the domain was read once
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { squads: expectedState().squads } })
    expect(host.reads).toBe(1)
  })

  it('user listing runs is handed the run half of one read', async () => {
    // Given a host whose domain carries both halves
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone lists runs
    await harness.connection.handleText(requestFrame(2, 'squads.runs'))
    // Then exactly the runs half crossed
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { runs: expectedState().runs } })
    expect(host.reads).toBe(1)
  })
})

describe('squads.runMember and squads.runSquad', () => {
  it('user launching one member is handed the run the plugin recorded', async () => {
    // Given a host whose domain launches one member
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone launches that member with a first message
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-2', firstMessage: 'read the diff' }))
    // Then the request crossed with both names and the message, unchanged
    expect(host.launches).toEqual([{ kind: 'member', request: { squadId: 'squad-1', memberId: 'm-2', firstMessage: 'read the diff' } }])
    // And the answer is the run with the squad it belongs to, not the team it was stored under
    expect(answerOf(harness, 2)).toEqual({
      ok: true,
      r: { run: { id: 'run-9', squadId: 'squad-1', kind: 'member', memberId: 'm-2', sessionId: 's-9', createdAt: 1760000009000, status: 'running' } },
    })
  })

  it('user launching a member without a first message sends no message field at all', async () => {
    // Given a host whose domain launches one member
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone launches it with no message
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-2' }))
    // Then no field was invented for the message
    expect(host.launches).toEqual([{ kind: 'member', request: { squadId: 'squad-1', memberId: 'm-2' } }])
  })

  it('user launching a whole squad is handed the Lead run and its goal crosses', async () => {
    // Given a host whose domain launches the Lead session of one squad
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone launches it with a goal
    await harness.connection.handleText(requestFrame(2, 'squads.runSquad', { squadId: 'squad-1', goal: 'ship 0.5.0' }))
    // Then the goal crossed and the answer carries no member the squad run never had
    expect(host.launches).toEqual([{ kind: 'squad', request: { squadId: 'squad-1', goal: 'ship 0.5.0' } }])
    expect(answerOf(harness, 2)).toEqual({
      ok: true,
      r: { run: { id: 'run-8', squadId: 'squad-1', kind: 'squad', sessionId: 's-8', createdAt: 1760000008000, status: 'running' } },
    })
  })

  it('user naming no squad or no member is refused here, and the host is asked nothing', async () => {
    // Given a host whose domain launches anything it is asked for
    const host = new FakeSquadHost()
    const harness = await squadConnection(host)
    // When the phone sends a launch without the names the command needs
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1' }))
    await harness.connection.handleText(requestFrame(3, 'squads.runSquad', { squadId: 42 }))
    // Then both are refused with this bridge's own code and nothing was launched
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'squads.runMember requires squadId and memberId' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'invalid-args', msg: 'squads.runSquad requires squadId' } })
    expect(host.launches).toEqual([])
  })

  it('user launching on a host with no squad domain is refused by the same code as the read', async () => {
    // Given a host with no dsh-agents domain at all
    const harness = await squadConnection(undefined)
    // When the phone launches a member and a squad
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-1' }))
    await harness.connection.handleText(requestFrame(3, 'squads.runSquad', { squadId: 'squad-1' }))
    // Then neither is pretended
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'squads-unavailable', msg: 'this host serves no dsh-agents squad domain' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'squads-unavailable', msg: 'this host serves no dsh-agents squad domain' } })
  })
})

describe('the refusals the squad domain raises', () => {
  it('user naming a squad or a member the domain does not hold is told the domain own code', async () => {
    // Given a domain that refuses both names the way the plugin does
    const host = new FakeSquadHost()
    host.runAnswer = async () => { throw new SquadRefusal('team-not-found', 'no team has that id') }
    host.squadRunAnswer = async () => { throw new SquadRefusal('member-not-found', 'no member with that id exists in the addressed team') }
    const harness = await squadConnection(host)
    // When the phone launches both
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-404', memberId: 'm-1' }))
    await harness.connection.handleText(requestFrame(3, 'squads.runSquad', { squadId: 'squad-1' }))
    // Then each refusal crossed with its own code and text, renamed by nothing here
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'team-not-found', msg: 'no team has that id' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'member-not-found', msg: 'no member with that id exists in the addressed team' } })
  })

  it('user whose squad pins an unusable preset or an unusable workspace is told the domain own code', async () => {
    // Given a domain that refuses the preset pin and then the workspace pin
    const answers = [
      new SquadRefusal('preset-unknown', 'the pinned agent preset is not in this host registry'),
      new SquadRefusal('workspace-unavailable', 'this deployment serves no workspace registry to validate the pin against'),
    ]
    const host = new FakeSquadHost()
    let index = 0
    host.runAnswer = async () => {
      const answer = answers[index] ?? answers[answers.length - 1]
      index += 1
      throw answer
    }
    const harness = await squadConnection(host)
    // When the phone launches that member twice
    await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-1' }))
    await harness.connection.handleText(requestFrame(3, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-2' }))
    // Then both codes crossed unchanged
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'preset-unknown', msg: 'the pinned agent preset is not in this host registry' } })
    expect(answerOf(harness, 3)).toEqual({ ok: false, e: { code: 'workspace-unavailable', msg: 'this deployment serves no workspace registry to validate the pin against' } })
  })

  it('user whose transport fails without a code is told the domain is unreachable', async () => {
    // Given a transport that throws something it did not attribute
    const host = new FakeSquadHost()
    host.stateAnswer = async () => { throw new Error('the loopback call was cut') }
    const harness = await squadConnection(host)
    // When the phone reads the state
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the refusal names no squad answer was read, keeping the failure text
    expect(answerOf(harness, 2)).toEqual({ ok: false, e: { code: 'squads-unavailable', msg: 'the loopback call was cut' } })
    expect(harness.logs.some(line => line.includes('squad domain read failed'))).toBe(true)
  })
})

describe('the squad domain over this host own loopback origin', () => {
  it('operator reading the domain sees the plugin state route addressed with this host origin header', async () => {
    // Given a real endpoint answering the plugin state document
    const endpoint = await serveEndpoint(() => ({ status: 200, body: stateDocument() }))
    try {
      // When one transport reads the domain
      const mapped = squadsStateOf(await transportTo(endpoint.origin, ledgerDirectory()).state())
      // Then the same frozen body crossed, off the plugin own route
      expect(mapped).toEqual(expectedState())
      // And the request was the plugin own route, carrying this host origin
      expect(endpoint.seen).toEqual([{ method: 'GET', url: '/dsh-agents/api/state', origin: endpoint.origin, body: undefined }])
    } finally {
      await endpoint.close()
    }
  })

  it('operator launching one member sees the plugin run route addressed with its own key names', async () => {
    // Given a real endpoint answering the plugin run document
    const endpoint = await serveEndpoint(() => ({ status: 200, body: memberRunDocument() }))
    try {
      // When the phone launches one member through the real transport
      const harness = makeConnection({ paired: true, squads: transportTo(endpoint.origin, ledgerDirectory()) })
      await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_SQUADS] }))
      await harness.connection.handleText(requestFrame(2, 'squads.runMember', { squadId: 'squad-1', memberId: 'm-2', firstMessage: 'read the diff' }))
      // Then the plugin was asked with its own key names
      expect(endpoint.seen).toEqual([
        { method: 'POST', url: '/dsh-agents/api/run', origin: endpoint.origin, body: { teamId: 'squad-1', memberId: 'm-2', firstMessage: 'read the diff' } },
      ])
      // And the answer crossed as a run of that squad
      expect(answerOf(harness, 2)).toEqual({
        ok: true,
        r: { run: { id: 'run-9', squadId: 'squad-1', kind: 'member', memberId: 'm-2', sessionId: 's-9', createdAt: 1760000009000, status: 'running' } },
      })
    } finally {
      await endpoint.close()
    }
  })

  it('operator launching a whole squad sees the plugin squad run route addressed with the goal', async () => {
    // Given a real endpoint answering the plugin squad run document
    const endpoint = await serveEndpoint(() => ({ status: 200, body: squadRunDocument() }))
    try {
      // When one transport launches the Lead session
      const run = await transportTo(endpoint.origin, ledgerDirectory()).runSquad({ squadId: 'squad-1', goal: 'ship it' })
      // Then the goal crossed under the plugin own key and the run came back
      expect(endpoint.seen).toEqual([
        { method: 'POST', url: '/dsh-agents/api/squad/run', origin: endpoint.origin, body: { teamId: 'squad-1', goal: 'ship it' } },
      ])
      expect(run).toEqual(squadRunDocument())
    } finally {
      await endpoint.close()
    }
  })

  it('operator whose loopback call the plugin browser fence refuses is told the plugin own code', async () => {
    // Given an endpoint whose browser fence refused the call
    const endpoint = await serveEndpoint(() => ({
      status: 403,
      body: { ok: false, code: 'forbidden', error: 'this route is served to this machine own browser only' },
    }))
    try {
      // When one transport reads the domain
      // Then the refusal is the plugin own, code and text alike
      await expect(transportTo(endpoint.origin, ledgerDirectory()).state()).rejects.toMatchObject({
        code: 'forbidden',
        message: 'this route is served to this machine own browser only',
      })
    } finally {
      await endpoint.close()
    }
  })

  it('operator on a host that serves no such route is refused as an unavailable domain', async () => {
    // Given an endpoint that answers a body this plugin never writes
    const endpoint = await serveEndpoint(() => ({ status: 404, body: { error: 'not found' } }))
    try {
      // When one transport reads the domain
      // Then the answer says the route is not served, rather than falling back silently
      await expect(transportTo(endpoint.origin, ledgerDirectory()).state()).rejects.toMatchObject({ code: 'squads-unavailable' })
    } finally {
      await endpoint.close()
    }
  })
})

describe('the ledger a host falls back to when no loopback route can answer', () => {
  it('operator whose loopback call cannot connect reads definitions and runs out of the ledger', async () => {
    // Given no origin answering and a ledger the plugin already wrote
    const origin = await closedOrigin()
    const directory = ledgerDirectory({ ledger: ledgerDocument(), lock: { pid: 5150, token: 'owner-token', startedAt: 1760000000000 } })
    // When the phone reads the state through the same connection path
    const harness = makeConnection({ paired: true, squads: transportTo(origin, directory) })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_SQUADS] }))
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the same frozen body crossed, the owning pid read out of the lock
    expect(answerOf(harness, 2)).toEqual({
      ok: true,
      r: {
        squads: expectedState().squads,
        runs: expectedState().runs,
        host: { ownerPid: 5150 },
      },
    })
    // And the two halves read from the same document
    await harness.connection.handleText(requestFrame(3, 'squads.list'))
    await harness.connection.handleText(requestFrame(4, 'squads.runs'))
    expect(answerOf(harness, 3)).toEqual({ ok: true, r: { squads: expectedState().squads } })
    expect(answerOf(harness, 4)).toEqual({ ok: true, r: { runs: expectedState().runs } })
  })

  it('operator launching when only the ledger can be read is refused instead of shown a run', async () => {
    // Given no origin answering and a readable ledger
    const origin = await closedOrigin()
    const directory = ledgerDirectory({ ledger: ledgerDocument() })
    const transport = transportTo(origin, directory)
    // When the phone launches a member and a squad
    // Then both are refused with the run capability code instead of a run that never started
    await expect(transport.runMember({ squadId: 'squad-1', memberId: 'm-1' })).rejects.toMatchObject({ code: 'squads-run-unavailable' })
    await expect(transport.runSquad({ squadId: 'squad-1', goal: 'ship it' })).rejects.toMatchObject({ code: 'squads-run-unavailable' })
  })

  it('operator on a host holding neither an answer nor a ledger is refused as an unavailable domain', async () => {
    // Given no origin answering and no ledger beside it
    const origin = await closedOrigin()
    // When the phone reads the state
    // Then the refusal says the domain is not served here
    await expect(transportTo(origin, ledgerDirectory()).state()).rejects.toMatchObject({ code: 'squads-unavailable' })
  })

  it('operator on a host whose ledger this build does not read is refused as corrupt', async () => {
    // Given ledgers that are not the document the plugin writes
    const origin = await closedOrigin()
    // When a transport reads each one
    // Then the plugin own corruption code crossed, and nothing was rewritten
    await expect(transportTo(origin, ledgerDirectory({ raw: '{"schemaVersion":1,' })).state()).rejects.toMatchObject({ code: 'ledger-corrupt' })
    await expect(transportTo(origin, ledgerDirectory({ ledger: { schemaVersion: 9, revision: 1, teams: [], runs: [] } })).state())
      .rejects.toMatchObject({ code: 'ledger-corrupt' })
    await expect(transportTo(origin, ledgerDirectory({ ledger: { schemaVersion: 1, revision: 1.5, teams: [], runs: [] } })).state())
      .rejects.toMatchObject({ code: 'ledger-corrupt' })
  })

  it('operator whose ledger row this build cannot read is refused rather than handed a row', async () => {
    // Given a ledger whose document is sound and whose one team row is not
    const origin = await closedOrigin()
    const directory = ledgerDirectory({ ledger: { schemaVersion: 1, revision: 1, teams: [{ id: 'squad-1' }], runs: [] } })
    // When the phone reads the state
    const harness = makeConnection({ paired: true, squads: transportTo(origin, directory) })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_SQUADS] }))
    await harness.connection.handleText(requestFrame(2, 'squads.state'))
    // Then the row is refused by the one mapping both paths share
    expect(answerOf(harness, 2)).toEqual({
      ok: false,
      e: { code: 'squads-unavailable', msg: 'the dsh-agents answer carries a squad row without an id and a name this bridge cannot read' },
    })
  })
})
