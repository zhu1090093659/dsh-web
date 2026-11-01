import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRoster, ROSTER_VERSION, type PushRegistration } from '../src/core/devices.ts'
import {
  LiveActivityNotifier,
  type LiveActivityAddress,
  type LiveActivityNotification,
} from '../src/core/liveactivity.ts'
import {
  PushNotifier,
  type PushAddress,
  type PushNotification,
  type PushSendResult,
  type PushSender,
} from '../src/core/push.ts'
import {
  buildRelayLiveActivity,
  buildRelayNotification,
  pushChannelLine,
  pushRouteOf,
  RELAY_DEFAULT_URL,
  RELAY_PATH,
  relayUrlFromEnv,
  RelaySender,
  type RelayFetch,
} from '../src/host/relay.ts'
import type { QuestionAnswer, UserQuestionRequestLike } from '../src/core/questions.ts'
import { answerOf, ControllableStream, makeBareHub, makeConnection, makeHub, requestFrame, settle } from './support/harness.ts'
import { CAP_PUSH } from '../src/core/protocol.ts'

/** The bundle every phone in these suites registered under. */
const BUNDLE = 'dev.dsh.Whale'
/** The APNs token one phone registered. */
const DEVICE_TOKEN = 'aabbccdd'

/** One delivery the notifier asked a sender to make. */
interface Delivered {
  readonly target: PushAddress
  readonly notification: PushNotification
}

/** A sender that records what it was asked to deliver and accepts everything. */
function recordingSender(): { readonly sent: Delivered[]; readonly sender: PushSender } {
  const sent: Delivered[] = []
  return {
    sent,
    sender: {
      async send(target, notification) {
        sent.push({ target, notification })
        return { ok: true, status: 200 }
      },
    },
  }
}

/** One request the stub centre received. */
interface CentreRequest {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: Record<string, unknown>
}

/** A stub centre: records every request, answers from a script. */
interface Centre {
  readonly requests: CentreRequest[]
  readonly fetch: RelayFetch
}

/**
 * A stub for the hosted relay.
 * @param answer - what the centre answers for one parsed body; an Error models a
 * connection that never answered.
 * @returns the recordings and the fetch to inject.
 */
function stubCentre(answer: (body: Record<string, unknown>) => { status: number; body: string } | Error): Centre {
  const requests: CentreRequest[] = []
  return {
    requests,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body) as Record<string, unknown>
      requests.push({ url, headers: { ...init.headers }, body })
      const result = answer(body)
      if (result instanceof Error) throw result
      return { status: result.status, text: async () => result.body }
    },
  }
}

/** A centre that accepts every delivery to one device. */
function acceptingCentre(): Centre {
  return stubCentre(() => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 1, dead: 0 }) }))
}

/** The address one relay-mode roster row becomes. */
function relayAddress(relayToken = 'relay-token-1'): PushAddress {
  return { deviceToken: DEVICE_TOKEN, environment: 'sandbox', bundle: BUNDLE, relayToken }
}

/** The registration one phone sends through `push.register` on the relay road. */
function relayRegistration(relayToken?: string): PushRegistration {
  return {
    deviceToken: DEVICE_TOKEN,
    environment: 'sandbox',
    bundle: BUNDLE,
    ...(relayToken === undefined ? {} : { relayToken }),
    registeredAt: 1_700_000_000_000,
  }
}

/** A temporary roster path. */
async function rosterFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-relay-'))
  return join(directory, 'remote-bridge', 'devices.json')
}

/** One row in the shape every probe entry of a real table has. */
function rowOf(index: number, push?: PushRegistration): Record<string, unknown> {
  return {
    deviceId: index === 0 ? 'dev_harness' : `dev_probe${index}`,
    pubKey: `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE${index}`,
    fingerprint: `fingerprint-${index}`,
    createdAt: 1_700_000_000_000 + index,
    lastSeenAt: 1_700_000_000_000 + index,
    tokenHash: `hash-${index}`,
    ...(push === undefined ? {} : { push }),
  }
}

/** Write one roster file, creating the directory it lives in. */
async function writeRoster(file: string, body: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body), 'utf8')
}

/** A loaded roster over one file. */
async function loadedRoster(file: string, logs: string[] = []): Promise<DeviceRoster> {
  const roster = new DeviceRoster({ file, log: message => { logs.push(message) } })
  await roster.load()
  return roster
}

/** Two timed questions in the shape the host's waterfall carries them. */
function hostRequest(): UserQuestionRequestLike {
  return {
    agent: { id: 's-1' },
    wait: { callId: 'c-1', timed: true },
    questions: [{ id: 'q-1', question: 'Which deck?', header: 'Deck', options: [{ label: 'Alpha' }, { label: 'Beta' }] }],
  }
}

/** Complete one connection's hello with exactly one capability. */
async function declare(connection: { handleText(text: string): Promise<void> }, capability: string, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: [capability] }))
}

describe('relay: which road the channel stands on', () => {
  it('operator holds a local key and not one request reaches the centre', async () => {
    // Given a machine with its own APNs key and a roster row that also holds a relay token
    const centre = acceptingCentre()
    const relay = new RelaySender({ url: 'https://relay.test', fetch: centre.fetch })
    const local = recordingSender()
    // When one event is announced over the route the wiring picks
    const route = pushRouteOf(true, true)
    const push = new PushNotifier({
      targets: () => [relayAddress()],
      sender: local.sender,
      mode: route,
      titles: () => '重构推送通道',
      now: () => 1_000,
    })
    push.notify('turn-end', 's-1')
    await settle()
    // Then the local key signed for it
    expect(route).toBe('direct')
    expect(push.enabled).toBe(true)
    expect(push.mode).toBe('direct')
    expect(local.sent).toHaveLength(1)
    // And the centre was never asked, although the relay client was in hand
    expect(centre.requests).toHaveLength(0)
    expect(await relay.send(relayAddress(), { aps: { alert: { title: 'x', body: 'y' }, sound: 'default' }, s: 's-1', st: 'turn-end', url: 'whale://session/s-1' })).toEqual({ ok: true, status: 200 })
    expect(centre.requests).toHaveLength(1)
  })

  it('operator holds no key and one relay token and the question crosses the centre', async () => {
    // Given a machine with no Apple key and one paired row holding a relay token
    const centre = acceptingCentre()
    const push = new PushNotifier({
      targets: () => [relayAddress()],
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      mode: pushRouteOf(false, true),
      available: () => true,
      titles: () => '重构推送通道',
      now: () => 1_000,
    })
    push.noteSessions([{ id: 's-1', cwd: '/Users/zcl/code/dsh-web' }])
    // When a question is announced
    push.notify('question', 's-1')
    await settle()
    // Then exactly one request went to the relay's one path
    expect(push.mode).toBe('relay')
    expect(centre.requests).toHaveLength(1)
    expect(centre.requests[0]?.url).toBe(`https://relay.test${RELAY_PATH}`)
    expect(centre.requests[0]?.headers.authorization).toBe('Bearer relay-token-1')
    // And the body is the frozen one: the event, the address and no session content
    expect(centre.requests[0]?.body).toEqual({
      event: 'question',
      sessionId: 's-1',
      title: '重构推送通道',
      workspace: 'dsh-web',
    })
    expect(Object.keys(centre.requests[0]?.body ?? {}).sort()).toEqual(['event', 'sessionId', 'title', 'workspace'])
  })

  it('operator holds neither a key nor a relay token and the channel is off', async () => {
    // Given a machine with no Apple key and no relay token on any row
    const centre = acceptingCentre()
    let clockReads = 0
    const push = new PushNotifier({
      targets: () => [relayAddress()],
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      mode: pushRouteOf(false, false),
      available: () => false,
      now: () => {
        clockReads += 1
        return 1_000
      },
      log: () => undefined,
    })
    // Then the channel reports itself off
    expect(pushRouteOf(false, false)).toBe('off')
    expect(push.enabled).toBe(false)
    // When an event would have been announced
    push.notify('turn-end', 's-1')
    await settle()
    // Then nothing was sent, no target was read and no clock was consulted
    expect(centre.requests).toHaveLength(0)
    expect(clockReads).toBe(0)
  })

  it('operator moves the relay with one environment variable and reads the default otherwise', () => {
    // Given no environment variable names a relay
    // Then the default is the account service the App already signs into
    expect(relayUrlFromEnv({})).toBe(RELAY_DEFAULT_URL)
    expect(RELAY_DEFAULT_URL).toBe('https://account.dsh-market.com')
    // When a deployment names its own relay, a trailing slash is not part of the route
    expect(relayUrlFromEnv({ DSH_REMOTE_BRIDGE_RELAY_URL: 'https://relay.test/' })).toBe('https://relay.test')
    expect(relayUrlFromEnv({ DSH_REMOTE_BRIDGE_RELAY_URL: '  https://relay.test  ' })).toBe('https://relay.test')
  })

  it('operator reads one mount line per road and each names the credential it reads', () => {
    // Given the three roads a bridge can stand on
    // When each road is turned into the line the host prints
    // Then the three roads are three lines, and each says what it stands on
    expect(pushChannelLine({ route: 'direct', keyId: 'ABC123DEFG', teamId: 'TEAM123456' }))
      .toBe('push: direct (APNs key ABC123DEFG of team TEAM123456)')
    expect(pushChannelLine({ route: 'relay', relayUrl: 'https://relay.test' })).toBe('push: relay (https://relay.test)')
    expect(pushChannelLine({ route: 'off' })).toBe('push: off (no APNs key on this machine and no paired device holds a relay token)')
  })
})

describe('relay: the bodies the frozen contract names', () => {
  it('operator reads the notification body and it carries no session content', () => {
    // Given a notification built exactly as the direct path builds one
    const notification: PushNotification = {
      aps: { alert: { title: '回合结束', body: '回合结束' }, sound: 'default' },
      s: 's-1',
      st: 'turn-end',
      url: 'whale://session/s-1',
    }
    // When it is turned into the relay's body
    const body = buildRelayNotification(notification)
    // Then only the four fields the contract names cross, and the deep link does not
    expect(body).toEqual({ event: 'turn-end', sessionId: 's-1', title: '回合结束' })
    expect(Object.keys(body).sort()).toEqual(['event', 'sessionId', 'title'])
  })

  it('operator reads the card body and the content state crosses verbatim', () => {
    // Given one card that names its session
    const target: LiveActivityAddress = {
      activityId: 'act-1',
      token: 'card-token-1',
      sessionId: 's-1',
      environment: 'sandbox',
      bundle: BUNDLE,
      relayToken: 'relay-token-1',
    }
    const notification: LiveActivityNotification = {
      aps: {
        timestamp: 1_700_000_000,
        event: 'update',
        'content-state': { phase: 'running', statusLine: 'Running', asOf: 1, runningCount: 1 },
        'stale-date': 1_700_000_090,
        'relevance-score': 50,
      },
    }
    // When it becomes the relay's body
    const body = buildRelayLiveActivity(target, notification)
    // Then the frozen five keys are there and the state is the App's own
    expect(body).toEqual({
      event: 'live-activity',
      sessionId: 's-1',
      activityId: 'act-1',
      activityEvent: 'update',
      contentState: { phase: 'running', statusLine: 'Running', asOf: 1, runningCount: 1 },
    })
    // And a card that names no session has nothing to relay at all
    expect(buildRelayLiveActivity({ ...target, sessionId: undefined }, notification)).toBeUndefined()
  })

  it('operator reads a card dismissed on delivery only when the direct payload dismisses it', () => {
    // Given one card and the end the direct path builds for a turn that finished
    const target: LiveActivityAddress = {
      activityId: 'act-1',
      token: 'card-token-1',
      sessionId: 's-1',
      environment: 'sandbox',
      bundle: BUNDLE,
      relayToken: 'relay-token-1',
    }
    const ended: LiveActivityNotification = {
      aps: {
        timestamp: 1_700_000_000,
        event: 'end',
        'content-state': { phase: 'ended', statusLine: 'Turn finished', asOf: 721_692_800, runningCount: 0 },
        'stale-date': 1_700_000_090,
        'relevance-score': 10,
      },
    }
    // Then a card the payload leaves alone carries no dismiss key at all
    expect(buildRelayLiveActivity(target, ended)).not.toHaveProperty('dismiss')
    // When the session left the roster, the direct payload writes the dismissal date
    const dismissed = buildRelayLiveActivity(target, { ...ended, aps: { ...ended.aps, 'dismissal-date': 1_700_000_000 } })
    // Then the card crosses as one that goes on delivery, and never as `false`
    expect(dismissed).toMatchObject({ activityEvent: 'end', dismiss: true })
    expect(Object.keys(dismissed ?? {})).toEqual(['event', 'sessionId', 'activityId', 'activityEvent', 'contentState', 'dismiss'])
    // And an update is never dismissed, because §29.3 dismisses only an end
    expect(buildRelayLiveActivity(target, { ...ended, aps: { ...ended.aps, event: 'update' } })).not.toHaveProperty('dismiss')
  })
})

describe('relay: a centre that refuses', () => {
  /** @returns one relay sender over the answer the centre gives. */
  function senderOver(answer: () => { status: number; body: string } | Error): { centre: Centre; sender: RelaySender } {
    const centre = stubCentre(answer)
    return { centre, sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch, timeoutMs: 50 }) }
  }

  it('operator reads a 401 and the delivery is one failure, not an exception', async () => {
    // Given a centre that refuses the relay token
    const { sender } = senderOver(() => ({ status: 401, body: JSON.stringify({ ok: false, code: 'unauthorized' }) }))
    // When one delivery is attempted
    const result = await sender.send(relayAddress(), {
      aps: { alert: { title: 'x', body: 'y' }, sound: 'default' },
      s: 's-1',
      st: 'question',
      url: 'whale://session/s-1',
    })
    // Then the answer is the one this bridge can read, and it resolves
    expect(result).toEqual({ ok: false, status: 401, reason: 'unauthorized' })
  })

  it('operator reads a 500, a timeout and an unreadable body as failures with a reason', async () => {
    // Given three broken centres
    const five = senderOver(() => ({ status: 500, body: 'oops' }))
    const timeout = senderOver(() => new Error('The operation was aborted due to timeout'))
    const garbage = senderOver(() => ({ status: 200, body: 'not json' }))
    const delivery: PushNotification = {
      aps: { alert: { title: 'x', body: 'y' }, sound: 'default' },
      s: 's-1',
      st: 'approval' as const,
      url: 'whale://session/s-1',
    }
    // When each centre is asked to deliver it
    // Then each is a failure this bridge can log, and none of them throws
    expect(await five.sender.send(relayAddress(), delivery)).toEqual({ ok: false, status: 500, reason: 'relay answered 500' })
    expect(await timeout.sender.send(relayAddress(), delivery)).toEqual({
      ok: false,
      reason: 'relay request failed: Error: The operation was aborted due to timeout',
    })
    expect(await garbage.sender.send(relayAddress(), delivery)).toEqual({
      ok: false,
      status: 200,
      reason: 'the relay answered no usable result',
    })
  })

  it('operator reads a row without a relay token and nothing is posted at all', async () => {
    // Given a device row that registered no relay token
    const { centre, sender } = senderOver(() => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 1 }) }))
    // When a delivery is attempted for it
    const result = await sender.send({ ...relayAddress(), relayToken: undefined }, {
      aps: { alert: { title: 'x', body: 'y' }, sound: 'default' },
      s: 's-1',
      st: 'turn-end',
      url: 'whale://session/s-1',
    })
    // Then the answer names the missing credential and no request was made
    expect(result).toEqual({ ok: false, reason: 'this device row holds no relay token' })
    expect(centre.requests).toHaveLength(0)
  })

  it('operator reads a delivery that landed on nothing and it is reported rather than claimed', async () => {
    // Given a centre that delivered to nobody and retired nothing
    const { sender } = senderOver(() => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 0, dead: 0 }) }))
    // When one delivery is attempted for that row
    // Then the failure is the honest answer
    expect(await sender.send(relayAddress(), {
      aps: { alert: { title: 'x', body: 'y' }, sound: 'default' },
      s: 's-1',
      st: 'turn-end',
      url: 'whale://session/s-1',
    })).toEqual({ ok: false, status: 200, reason: 'the relay delivered to no device' })
  })

  it('user keeps its follow stream while the centre refuses every event', async () => {
    // Given a bridge standing on a centre that answers 500 to everything
    const logs: string[] = []
    const centre = stubCentre(() => ({ status: 500, body: 'down' }))
    const clock = { now: 1_000 }
    const push = new PushNotifier({
      targets: () => [relayAddress()],
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      mode: 'relay',
      available: () => true,
      now: () => clock.now,
      log: message => { logs.push(message) },
    })
    const harness = makeHub({ paired: true, push })
    await declare(harness.connection, CAP_PUSH)
    // When a turn ends while the phone follows the session
    const stream = new ControllableStream()
    harness.gateway.follow = call => stream.attach(call.signal).iterable()
    const opening = harness.connection.handleText(requestFrame(90, 'session.snapshot', { sessionId: 's-1' }))
    stream.push({ type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] })
    await opening
    stream.push({ type: 'event', event: { type: 'turn/end', seq: 12, time: 201, data: { turn: 1, reason: { kind: 'completed' } } } })
    await settle()
    // Then the centre was asked, refused, and the failure is one log line
    expect(centre.requests).toHaveLength(1)
    expect(logs.filter(line => line.includes('was not delivered')).join(' '))
      .toContain('push turn-end for s-1 was not delivered (500 relay answered 500)')
    // And the event still reached the phone: the broadcast frame is exactly the one the
    // refusal never saw, and the stream it went out on stays open
    expect(harness.transport.ofType('ev').map(frame => frame.m)).toEqual(['session.delta'])
    expect(harness.transport.closed).toBeUndefined()
    expect(answerOf(harness, 90).ok).toBe(true)
  })

  it('operator sends both card events through the centre and retires a token it reports dead', async () => {
    // Given a card whose token the centre will retire
    const centre = stubCentre(() => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 0, dead: 1 }) }))
    const retired: { activityId: string; token: string }[] = []
    const logs: string[] = []
    const clock = { now: 1_700_000_000_000 }
    const liveActivity = new LiveActivityNotifier({
      targets: () => [{
        activityId: 'act-1',
        token: 'card-token-1',
        sessionId: 's-1',
        environment: 'sandbox',
        bundle: BUNDLE,
        relayToken: 'relay-token-1',
      }],
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      available: () => true,
      now: () => clock.now,
      log: message => { logs.push(message) },
      retire: (activityId, token) => { retired.push({ activityId, token }); return true },
    })
    // When a question reaches the phone, and then the turn ends
    liveActivity.noteQuestion('s-1', { header: 'Deck', optionLabels: ['Alpha'] })
    await settle()
    clock.now += 10_000
    liveActivity.noteTurnEnd('s-1', 'completed')
    await settle()
    // Then two deliveries crossed, one update and one end
    expect(centre.requests.map(request => request.body.activityEvent)).toEqual(['update', 'end'])
    expect(centre.requests[0]?.body).toMatchObject({
      event: 'live-activity',
      sessionId: 's-1',
      activityId: 'act-1',
      contentState: { phase: 'waitingForAnswer', statusLine: 'Waiting for your answer', questionHeader: 'Deck', optionLabels: ['Alpha'] },
    })
    expect(centre.requests[1]?.body).toMatchObject({ contentState: { phase: 'ended', statusLine: 'Turn finished' } })
    // And the token the centre retired was dropped through the roster's own path
    expect(retired).toEqual([
      { activityId: 'act-1', token: 'card-token-1' },
      { activityId: 'act-1', token: 'card-token-1' },
    ])
    expect(logs.filter(line => line.includes('was not delivered')).length).toBe(2)
  })

  it('operator reads every body the centre actually got and only the dismissed end says so', async () => {
    // Given a card whose bridge stands on a centre that accepts everything
    const centre = stubCentre(() => ({ status: 200, body: JSON.stringify({ ok: true, delivered: 1, dead: 0 }) }))
    const clock = { now: 1_700_000_000_000 }
    const liveActivity = new LiveActivityNotifier({
      targets: () => [{
        activityId: 'act-1',
        token: 'card-token-1',
        sessionId: 's-1',
        environment: 'sandbox',
        bundle: BUNDLE,
        relayToken: 'relay-token-1',
      }],
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      available: () => true,
      now: () => clock.now,
    })
    // When s-1 is listed running, its turn ends while it is still listed, and then a
    // later listing no longer names it and its turn ends again
    liveActivity.noteRoster([{ id: 's-1', agentRunning: true, title: 'Deck' }])
    await settle()
    clock.now += 10_000
    liveActivity.noteTurnEnd('s-1', 'completed')
    await settle()
    clock.now += 10_000
    liveActivity.noteRoster([{ id: 's-9', agentRunning: true, title: 'Other' }])
    await settle()
    clock.now += 10_000
    liveActivity.noteTurnEnd('s-1', 'completed')
    await settle()
    // Then the centre received exactly three bodies: an update, an end, and an end
    // that dismisses, whose dismissal date the service stamps itself
    expect(centre.requests.map(request => request.body)).toEqual([
      {
        event: 'live-activity',
        sessionId: 's-1',
        activityId: 'act-1',
        activityEvent: 'update',
        contentState: {
          phase: 'running',
          statusLine: 'Running',
          asOf: 721_692_800,
          runningCount: 1,
          rows: [{ name: 'Deck', status: 'Running', phase: 'running' }],
        },
      },
      {
        event: 'live-activity',
        sessionId: 's-1',
        activityId: 'act-1',
        activityEvent: 'end',
        contentState: {
          phase: 'ended',
          statusLine: 'Turn finished',
          asOf: 721_692_810,
          // A card never says zero sessions run; the state clamps it to one.
          runningCount: 1,
          rows: [],
        },
      },
      {
        event: 'live-activity',
        sessionId: 's-1',
        activityId: 'act-1',
        activityEvent: 'end',
        contentState: {
          phase: 'ended',
          statusLine: 'Turn finished',
          asOf: 721_692_830,
          runningCount: 1,
          rows: [{ name: 'Other', status: 'Running', phase: 'running' }],
        },
        dismiss: true,
      },
    ])
    // And nothing but the dismissed one names it, so no body ever says `false`
    expect(centre.requests.map(request => 'dismiss' in request.body)).toEqual([false, false, true])
  })
})

describe('relay: the roster carries the token across schema versions', () => {
  it('operator opens a version-2 table and every field and every phone survives into version 4', async () => {
    // Given a version-2 table holding one phone with a full registration and no relay token
    const file = await rosterFile()
    const registration = relayRegistration()
    await writeRoster(file, { version: 2, devices: [rowOf(0, { ...registration, locale: 'zh-Hans' }), { ...rowOf(1) }] })
    const logs: string[] = []
    // When it is read
    const roster = await loadedRoster(file, logs)
    // Then both phones are paired, the registration kept every field, and the older schema was named
    expect(roster.devices()).toHaveLength(2)
    expect(roster.pushTargets()).toEqual([{ deviceId: 'dev_harness', push: { ...registration, locale: 'zh-Hans' } }])
    expect(roster.relayTargets()).toHaveLength(0)
    expect(logs.some(line => line.includes(`is schema 2; reading it as ${ROSTER_VERSION}`))).toBe(true)
    // When the phone registers its relay token
    expect(await roster.registerPush('dev_harness', { ...registration, locale: 'zh-Hans', relayToken: 'relay-token-1' })).toBe(true)
    // Then the file is written as version 4 and the token is on that row
    const written = JSON.parse(await readFile(file, 'utf8')) as { version: number; devices: { push?: Record<string, unknown> }[] }
    expect(written.version).toBe(4)
    expect(ROSTER_VERSION).toBe(4)
    expect(written.devices[0]?.push?.relayToken).toBe('relay-token-1')
    // And it reads back with nothing lost and exactly one reachable row
    const reloaded = await loadedRoster(file)
    expect(reloaded.devices()).toHaveLength(2)
    expect(reloaded.relayTargets()).toEqual([
      { deviceId: 'dev_harness', push: { ...registration, locale: 'zh-Hans', relayToken: 'relay-token-1' } },
    ])
  })

  it('user registers twice and the relay token it already had is the one on disk', async () => {
    // Given a paired connection over a real roster file
    const file = await rosterFile()
    await writeRoster(file, { version: 2, devices: [rowOf(0)] })
    const roster = await loadedRoster(file)
    const harness = makeConnection({ paired: true, roster })
    await declare(harness.connection, 'push.v1')
    // When it registers its APNs token and its relay token
    await harness.connection.handleText(requestFrame(2, 'push.register', { ...relayRegistration('relay-token-1') }))
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    // And registers again with the same token the account service reissued
    await harness.connection.handleText(requestFrame(3, 'push.register', { ...relayRegistration('relay-token-1') }))
    // Then one row holds one token, unchanged
    expect(roster.devices()).toHaveLength(1)
    expect(roster.relayTargets()).toHaveLength(1)
    expect(roster.relayTargets()[0]?.push).toMatchObject({
      deviceToken: DEVICE_TOKEN,
      bundle: BUNDLE,
      relayToken: 'relay-token-1',
    })
    const written = JSON.parse(await readFile(file, 'utf8')) as { version: number; devices: { push?: Record<string, unknown> }[] }
    expect(written.version).toBe(4)
    expect(written.devices[0]?.push?.relayToken).toBe('relay-token-1')
  })

  it('user sends a relay token that is not a string and nothing is written', async () => {
    // Given a paired connection over a roster with no registration
    const file = await rosterFile()
    await writeRoster(file, { version: 3, devices: [rowOf(0)] })
    const roster = await loadedRoster(file)
    const harness = makeConnection({ paired: true, roster })
    await declare(harness.connection, 'push.v1')
    // When it registers with a relay token that is not the string the account service issued
    await harness.connection.handleText(requestFrame(2, 'push.register', { ...relayRegistration(), relayToken: 7 }))
    // Then the registration is refused and the row still asks for no notification
    expect(answerOf(harness, 2).e?.code).toBe('invalid-args')
    expect(roster.pushTargets()).toHaveLength(0)
  })
})

describe('relay: the question that is held for a phone the centre can reach', () => {
  it('operator holds the question for the row that holds a relay token', async () => {
    // Given a bridge with no phone on the wire, a centre that accepts, and one row holding a relay token
    const file = await rosterFile()
    await writeRoster(file, { version: 3, devices: [rowOf(0, relayRegistration('relay-token-1'))] })
    const roster = await loadedRoster(file)
    const centre = acceptingCentre()
    const push = new PushNotifier({
      targets: () => roster.relayTargets().map(({ push: registration }) => ({
        deviceToken: registration.deviceToken,
        environment: registration.environment,
        bundle: registration.bundle,
        ...(registration.relayToken === undefined ? {} : { relayToken: registration.relayToken }),
      })),
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      mode: 'relay',
      available: () => roster.relayTargets().length > 0,
      now: () => 1_000,
    })
    const bare = makeBareHub({ roster, push })
    let delegated = 0
    // When the host asks a question
    void bare.hub.question(hostRequest(), async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    })
    await settle()
    // Then the bridge claimed it for that phone instead of handing it on
    expect(bare.questions.stateOf('c-1')).toBe('open')
    expect(delegated).toBe(0)
    // And the centre was asked to tell it
    expect(centre.requests.map(request => request.body.event)).toEqual(['question'])
  })

  it('operator holds no relay token and the question goes straight back to the host', async () => {
    // Given the same bridge, but the only registration on the roster predates the relay
    const file = await rosterFile()
    await writeRoster(file, { version: 3, devices: [rowOf(0, relayRegistration())] })
    const roster = await loadedRoster(file)
    const centre = acceptingCentre()
    const push = new PushNotifier({
      targets: () => roster.relayTargets().map(({ push: registration }) => ({
        deviceToken: registration.deviceToken,
        environment: registration.environment,
        bundle: registration.bundle,
      })),
      sender: new RelaySender({ url: 'https://relay.test', fetch: centre.fetch }),
      mode: 'relay',
      available: () => roster.relayTargets().length > 0,
      now: () => 1_000,
    })
    const bare = makeBareHub({ roster, push })
    let delegated = 0
    // When the host asks a question
    void bare.hub.question(hostRequest(), async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    })
    await settle()
    // Then nothing was claimed for a phone no route reaches
    expect(bare.questions.size).toBe(0)
    expect(delegated).toBe(1)
    expect(centre.requests).toHaveLength(0)
  })
})
