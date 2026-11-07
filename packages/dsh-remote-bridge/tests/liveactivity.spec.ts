import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceRoster, type PushRegistration } from '../src/core/devices.ts'
import {
  ACTIVITY_STATUS_LINE,
  APPLE_REFERENCE_OFFSET_SECONDS,
  LIVE_ACTIVITY_INTERVAL_MS,
  LIVE_ACTIVITY_PER_MINUTE,
  LIVE_ACTIVITY_ROW_LIMIT,
  LIVE_ACTIVITY_ROW_NAME_MAX,
  LiveActivityNotifier,
  buildLiveActivityNotification,
  normalizeActivityRowName,
  statusLineOf,
  type LiveActivityAddress,
  type LiveActivityNotification,
  type LiveActivitySender,
} from '../src/core/liveactivity.ts'
import { CAP_PUSH } from '../src/core/protocol.ts'
import type { PushSendResult } from '../src/core/push.ts'
import { liveActivityRequestSpec, liveActivityTopicOf } from '../src/host/apns.ts'
import { ControllableStream, answerOf, makeConnection, makeHub, requestFrame, settle } from './support/harness.ts'

/** One follow record as DSH writes it. */
function record(type: string, seq: number, time: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time, data } }
}

/** The card of one session; every suite addresses its cards this way. */
function cardOf(sessionId: string, index = 1): LiveActivityAddress {
  return {
    activityId: 'act-' + index,
    token: 'ff00aa' + index,
    sessionId,
    environment: 'sandbox',
    bundle: 'dev.dsh.Whale',
  }
}

/** The one card these suites push to: the card of session s-1. */
const CARD: LiveActivityAddress = cardOf('s-1')

/** The clock these suites start at. */
const CLOCK_START = 1_700_000_000_000

/** A recording sender: what the notifier actually asked to deliver, in order. */
interface CardRecorder {
  readonly sent: { readonly target: LiveActivityAddress; readonly notification: LiveActivityNotification }[]
  readonly sender: LiveActivitySender
}

function recorder(): CardRecorder {
  const sent: { target: LiveActivityAddress; notification: LiveActivityNotification }[] = []
  return {
    sent,
    sender: {
      async sendLiveActivity(target, notification) {
        sent.push({ target, notification })
        return { ok: true, status: 200 }
      },
    },
  }
}

/** @returns every delivery one card took, in order. */
function sentTo(sink: CardRecorder, activityId: string): LiveActivityNotification[] {
  return sink.sent.filter(entry => entry.target.activityId === activityId).map(entry => entry.notification)
}

/** A notifier over one card list and a clock the suite owns. */
function notifierAt(
  sender: LiveActivitySender | undefined,
  clock: { now: number },
  extra: {
    readonly targets?: readonly LiveActivityAddress[]
    readonly logs?: string[]
    readonly retire?: (activityId: string, token: string) => Promise<boolean> | boolean | void
  } = {},
): LiveActivityNotifier {
  const logs = extra.logs
  return new LiveActivityNotifier({
    targets: () => extra.targets ?? [CARD],
    ...(sender === undefined ? {} : { sender }),
    now: () => clock.now,
    ...(logs === undefined ? {} : { log: (message: string): void => { logs.push(message) } }),
    ...(extra.retire === undefined ? {} : { retire: extra.retire }),
  })
}

/**
 * The host's own answerer with the panel open and nobody having clicked it.
 *
 * Both surfaces hold the same question now and the first answer settles it, so a
 * card a human has not touched is the state that leaves the phone's the one that
 * decides.
 */
const panelWaiting = (): Promise<never> => new Promise<never>(() => {})

/** One roster row in the shape every probe entry of a real table has. */
function rosterRow(deviceId = 'dev_probe0'): Record<string, unknown> {
  return {
    deviceId,
    pubKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0',
    fingerprint: 'fingerprint-0',
    createdAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    tokenHash: 'hash-0',
  }
}

/** A registration as a phone with these cards would send it. */
function registrationOf(tokens: readonly { activityId: string; token: string; sessionId?: string }[]): PushRegistration {
  return { deviceToken: 'aabbccdd', environment: 'sandbox', bundle: 'dev.dsh.Whale', liveActivityTokens: tokens, registeredAt: 1_700_000_000_000 }
}

/** The targets a roster row hands the notifier, exactly as the plugin wires it. */
function targetsOf(roster: DeviceRoster): readonly LiveActivityAddress[] {
  return roster.pushTargets().flatMap(({ push }) => (push.liveActivityTokens ?? []).map(({ activityId, token, sessionId }) => ({
    activityId,
    token,
    ...(sessionId === undefined ? {} : { sessionId }),
    environment: push.environment,
    bundle: push.bundle,
  })))
}

async function rosterFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-card-'))
  return join(directory, 'remote-bridge', 'devices.json')
}

/** Write one roster file, creating the directory it lives in. */
async function writeRoster(file: string, body: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body), 'utf8')
}

describe('live activity: the request APNs receives', () => {
  it('operator reads the card request and every header is the frozen one', () => {
    // Given one sandbox card and its provider token
    // When each one's delivery request is built
    const sandbox = liveActivityRequestSpec(CARD, 'jwt')
    const production = liveActivityRequestSpec({ ...CARD, environment: 'production' }, 'jwt')
    // Then the token of the card is the path, not the device's token
    expect(sandbox.path).toBe('/3/device/ff00aa1')
    expect(production.authority).toBe('api.push.apple.com')
    expect(sandbox.authority).toBe('api.sandbox.push.apple.com')
    // And the four frozen headers are exactly what a Live Activity requires
    expect(sandbox.headers['apns-push-type']).toBe('liveactivity')
    expect(sandbox.headers['apns-topic']).toBe('dev.dsh.Whale.push-type.liveactivity')
    expect(sandbox.headers['apns-priority']).toBe('10')
    expect(sandbox.headers['apns-expiration']).toBe('0')
    expect(sandbox.headers.authorization).toBe('bearer jwt')
    // And the topic suffix is appended once, never twice
    expect(liveActivityTopicOf('dev.dsh.Whale')).toBe('dev.dsh.Whale.push-type.liveactivity')
    expect(liveActivityTopicOf('dev.dsh.Whale.push-type.liveactivity')).toBe('dev.dsh.Whale.push-type.liveactivity')
  })

  it('operator builds a running card and the body holds exactly the frozen key set', () => {
    // Given the delivery moment a card is built for
    // When one running card is built
    const notification = buildLiveActivityNotification({
      event: 'update',
      phase: 'running',
      statusLine: ACTIVITY_STATUS_LINE.running,
      runningCount: 2,
      now: CLOCK_START,
    })
    // Then the body is one aps block and nothing else
    expect(Object.keys(notification)).toEqual(['aps'])
    expect(Object.keys(notification.aps).sort()).toEqual(['content-state', 'event', 'relevance-score', 'stale-date', 'timestamp'])
    // And the content state is the four keys a running card carries
    expect(Object.keys(notification.aps['content-state'])).toEqual(['phase', 'statusLine', 'asOf', 'runningCount'])
    // And every derived number is the one the contract names
    expect(notification.aps.timestamp).toBe(1_700_000_000)
    expect(notification.aps['stale-date']).toBe(1_700_000_090)
    expect(notification.aps['relevance-score']).toBe(60)
    expect(notification.aps['content-state'].runningCount).toBe(2)
    // And asOf is seconds since Apple's reference date, never Unix seconds: the
    // difference is the whole reason ActivityKit can decode the card at all
    expect(notification.aps['content-state'].asOf).toBe(1_700_000_000 - APPLE_REFERENCE_OFFSET_SECONDS)
    expect(notification.aps['content-state'].asOf).toBe(721_692_800)
    expect(notification.aps['content-state'].asOf).not.toBe(notification.aps.timestamp)
  })

  it('operator reads the four relevance scores and the one-label-less state', () => {
    // Given one delivery moment and the four phases a card can report
    const phases = ['waitingForAnswer', 'failed', 'running', 'ended'] as const
    // When each is built
    const scores = phases.map(phase => buildLiveActivityNotification({
      event: phase === 'ended' || phase === 'failed' ? 'end' : 'update',
      phase,
      statusLine: ACTIVITY_STATUS_LINE.running,
      runningCount: 1,
      now: CLOCK_START,
    }).aps['relevance-score'])
    // Then the score is the frozen one per phase
    expect(scores).toEqual([100, 90, 60, 10])
    // And a card with no question carries neither question key
    expect(Object.keys(buildLiveActivityNotification({
      event: 'update',
      phase: 'waitingForAnswer',
      statusLine: ACTIVITY_STATUS_LINE.waitingForAnswer,
      runningCount: 1,
      now: CLOCK_START,
    }).aps['content-state'])).toEqual(['phase', 'statusLine', 'asOf', 'runningCount'])
  })

  it('operator sees the question keys and the two-choice limit the card carries', () => {
    // Given a question with a header and three options
    // When its card is built
    const notification = buildLiveActivityNotification({
      event: 'update',
      phase: 'waitingForAnswer',
      statusLine: ACTIVITY_STATUS_LINE.waitingForAnswer,
      questionHeader: 'Deck',
      optionLabels: ['Alpha', 'Bravo', 'Charlie'],
      runningCount: 1,
      now: CLOCK_START,
    })
    // Then the key order is the frozen one and the score is the highest there is
    expect(Object.keys(notification.aps['content-state'])).toEqual(['phase', 'statusLine', 'questionHeader', 'optionLabels', 'asOf', 'runningCount'])
    expect(notification.aps['relevance-score']).toBe(100)
    // And only the two labels the App can offer as choices remain
    expect(notification.aps['content-state'].optionLabels).toEqual(['Alpha', 'Bravo'])
    expect(notification.aps['content-state'].questionHeader).toBe('Deck')
  })

  it('operator ends a card and only a dismissed one carries a dismissal date', () => {
    // Given one ended card and the same card dismissed on delivery
    // When both bodies are built
    const ended = { event: 'end', phase: 'ended', statusLine: ACTIVITY_STATUS_LINE.ended, runningCount: 1, now: CLOCK_START } as const
    const normal = buildLiveActivityNotification(ended)
    const dismissed = buildLiveActivityNotification({ ...ended, dismiss: true })
    // Then a normal end is the five keys, with no dismissal date to hurry it away
    expect(Object.keys(normal.aps)).toEqual(['timestamp', 'event', 'content-state', 'stale-date', 'relevance-score'])
    expect(normal.aps['content-state'].phase).toBe('ended')
    expect(normal.aps['relevance-score']).toBe(10)
    // And a dismissed one names the delivery second as the moment it goes
    expect(dismissed.aps['dismissal-date']).toBe(dismissed.aps.timestamp)
    expect(dismissed.aps['dismissal-date']).toBe(1_700_000_000)
    // And asking to dismiss an update changes nothing: only an end can dismiss
    expect(buildLiveActivityNotification({ ...ended, event: 'update', phase: 'running', dismiss: true }).aps).not.toHaveProperty('dismissal-date')
  })
})

describe('live activity: what the bridge sends, and what it drops', () => {
  it('operator sees the same card content once, however often the roster repeats it', async () => {
    // Given a bridge with one card and one running session
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    // Then one card went out
    expect(sink.sent).toHaveLength(1)
    // When a later listing says exactly the same thing
    clock.now += 10 * LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    // Then nothing new is sent: the card already says it
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps['content-state']).toMatchObject({ phase: 'running', runningCount: 1 })
  })

  it('operator gets one update per five seconds and the dropped one is never replayed', async () => {
    // Given a bridge that just updated its card
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    expect(sink.sent).toHaveLength(1)
    // When that same session asks a question one second later
    clock.now += 1_000
    notifier.noteQuestion('s-1', { header: 'Deck' })
    await settle()
    // Then the card is not updated yet, and the drop is not queued for later
    expect(sink.sent).toHaveLength(1)
    // When the five seconds have passed and the same question is still open
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-1', { header: 'Deck' })
    await settle()
    // Then exactly that one update goes out, and only once
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent.map(entry => entry.notification.aps['content-state'].phase)).toEqual(['running', 'waitingForAnswer'])
    await settle()
    expect(sink.sent).toHaveLength(2)
  })

  it('operator sees the whole bridge capped at thirty cards a minute', async () => {
    // Given one card per session, thirty-five sessions running
    const clock = { now: CLOCK_START }
    const cards = Array.from({ length: LIVE_ACTIVITY_PER_MINUTE + 5 }, (_, index) => cardOf('s-' + String(index), index))
    const rows = cards.map(card => ({ id: card.sessionId ?? '', agentRunning: true }))
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    // When that one listing is served
    notifier.noteRoster(rows)
    await settle()
    // Then the cap is what went out and the rest was dropped
    expect(sink.sent).toHaveLength(LIVE_ACTIVITY_PER_MINUTE)
    expect(sink.sent.map(entry => entry.target.activityId)).toEqual(cards.slice(0, LIVE_ACTIVITY_PER_MINUTE).map(card => card.activityId))
  })

  it('operator runs a bridge with no signing key and the card path never wakes', async () => {
    // Given a bridge with no sender at all — the default deployment
    const clock = { now: CLOCK_START }
    const logs: string[] = []
    let targetReads = 0
    let clockReads = 0
    const notifier = new LiveActivityNotifier({
      targets: () => { targetReads += 1; return [CARD] },
      now: () => { clockReads += 1; return clock.now },
      log: (message: string): void => { logs.push(message) },
    })
    // Then it reports itself disabled
    expect(notifier.enabled).toBe(false)
    // When every entry point is driven anyway
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    notifier.noteQuestion('s-1', { header: 'Deck' })
    notifier.noteApproval('s-1')
    notifier.noteTurnEnd('s-1', 'completed')
    notifier.noteSettled('s-1')
    await settle()
    // Then nothing was read, nothing was sent and not one line was logged
    expect(targetReads).toBe(0)
    expect(clockReads).toBe(0)
    expect(logs).toEqual([])
  })

  it('user registers a card token and the answer does not wait for any sender', async () => {
    // Given a paired phone on a bridge whose card path is off
    const file = await rosterFile()
    await writeRoster(file, { version: 2, devices: [rosterRow('dev_harness')] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const harness = makeConnection({ paired: true, roster, liveActivity: notifierAt(undefined, { now: CLOCK_START }) })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_PUSH] }))
    // When it registers the card it just created, naming the session it shows
    await harness.connection.handleText(requestFrame(2, 'push.register', {
      deviceToken: 'aabbccdd',
      environment: 'sandbox',
      bundle: 'dev.dsh.Whale',
      liveActivityTokens: [{ activityId: 'act-1', token: 'ff00', sessionId: 's-1' }],
    }))
    // Then the answer is the same empty acknowledgement as before this channel
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    // And the token is on the row with the session it belongs to
    expect(roster.pushTargets()[0]?.push.liveActivityTokens).toEqual([{ activityId: 'act-1', token: 'ff00', sessionId: 's-1' }])
    const written = JSON.parse(await readFile(file, 'utf8')) as { devices: { push?: Record<string, unknown> }[] }
    expect(written.devices[0]?.push).toMatchObject({ liveActivityTokens: [{ activityId: 'act-1', token: 'ff00', sessionId: 's-1' }] })
  })

  it('operator registers a card token that names no session and that card is never pushed to', async () => {
    // Given a device whose one card carries no session id, as a client written
    // before that field existed leaves it
    const file = await rosterFile()
    await writeRoster(file, { version: 2, devices: [{ ...rosterRow(), push: registrationOf([{ activityId: 'act-1', token: 'ff00' }]) }] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const logs: string[] = []
    const notifier = notifierAt(sink.sender, clock, { targets: targetsOf(roster), logs })
    // When a session runs and then its turn ends
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    notifier.noteTurnEnd('s-1', 'completed')
    await settle()
    // Then not one card was pushed, because that card has no session to show
    expect(sink.sent).toHaveLength(0)
    // And the bridge said so exactly once, instead of guessing at a state
    expect(logs.filter(line => line.includes('names no session'))).toHaveLength(1)
    // And the token is still on the row: an unaddressable card is a fact about the
    // client, not a reason to forget a token it may yet re-register
    expect(roster.pushTargets()[0]?.push.liveActivityTokens).toEqual([{ activityId: 'act-1', token: 'ff00' }])
  })

  it('operator reads a card whose session id is not text and the token survives unaddressed', async () => {
    // Given a row whose card carries a session id no client could have meant
    const file = await rosterFile()
    await writeRoster(file, {
      version: 2,
      devices: [{ ...rosterRow(), push: { ...registrationOf([]), liveActivityTokens: [{ activityId: 'act-1', token: 'ff00', sessionId: 7 }] } }],
    })
    const roster = new DeviceRoster({ file })
    // When it is read
    await roster.load()
    // Then the device is still paired and the token is still held
    expect(roster.devices()).toHaveLength(1)
    // And the unreadable session id was dropped rather than repaired, so the card
    // names no session and is never pushed to
    expect(roster.pushTargets()[0]?.push.liveActivityTokens).toEqual([{ activityId: 'act-1', token: 'ff00' }])
    expect(targetsOf(roster)[0]?.sessionId).toBeUndefined()
  })
})

describe('live activity: a token APNs reports dead', () => {
  it('operator loses the dead card tokens and keeps the live one, with no retry', async () => {
    // Given a roster row holding three cards, one per session
    const file = await rosterFile()
    await writeRoster(file, {
      version: 2,
      devices: [{
        ...rosterRow(),
        push: registrationOf([
          { activityId: 'act-gone', token: 'ff00', sessionId: 's-1' },
          { activityId: 'act-bad', token: 'ff01', sessionId: 's-2' },
          { activityId: 'act-live', token: 'ff02', sessionId: 's-3' },
        ]),
      }],
    })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const clock = { now: CLOCK_START }
    const attempted: string[] = []
    let retirement: Promise<boolean> = Promise.resolve(false)
    const sender: LiveActivitySender = {
      async sendLiveActivity(target): Promise<PushSendResult> {
        attempted.push(target.activityId)
        if (target.activityId === 'act-gone') return { ok: false, status: 410, reason: 'Unregistered' }
        if (target.activityId === 'act-bad') return { ok: false, status: 400, reason: 'BadDeviceToken' }
        return { ok: true, status: 200 }
      },
    }
    const notifier = new LiveActivityNotifier({
      targets: () => targetsOf(roster),
      sender,
      now: () => clock.now,
      retire: (activityId, token) => {
        retirement = roster.removeLiveActivityToken(activityId, token)
        return retirement
      },
    })
    // When all three sessions are listed as running
    notifier.noteRoster([{ id: 's-1', agentRunning: true }, { id: 's-2', agentRunning: true }, { id: 's-3', agentRunning: true }])
    await settle()
    await retirement
    // Then all three were attempted once and the two dead tokens left the file
    expect(attempted).toEqual(['act-gone', 'act-bad', 'act-live'])
    const written = JSON.parse(await readFile(file, 'utf8')) as { devices: { push?: { liveActivityTokens?: unknown[] } }[] }
    expect(written.devices[0]?.push?.liveActivityTokens).toEqual([{ activityId: 'act-live', token: 'ff02', sessionId: 's-3' }])
    // And the next card goes to the one card that still exists, so a refused token
    // is never tried again
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    attempted.length = 0
    notifier.noteTurnEnd('s-3', 'completed')
    await settle()
    expect(attempted).toEqual(['act-live'])
    expect(roster.pushTargets()[0]?.push.liveActivityTokens).toEqual([{ activityId: 'act-live', token: 'ff02', sessionId: 's-3' }])
  })

  it('operator drops a card token whose device row no longer holds it, and says so', async () => {
    // Given a sender that always answers 410 and a roster that holds no such token
    const clock = { now: CLOCK_START }
    const logs: string[] = []
    let retirement: Promise<boolean> = Promise.resolve(true)
    const notifier = notifierAt(
      { async sendLiveActivity(): Promise<PushSendResult> { return { ok: false, status: 410, reason: 'Unregistered' } } },
      clock,
      { logs, retire: () => { retirement = Promise.resolve(false); return retirement } },
    )
    // When one running state is announced
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    await retirement
    // Then the failure is one line, the retirement reported no row, and nothing threw
    expect(logs.some(line => line.includes('was not delivered (410 Unregistered)'))).toBe(true)
    expect(logs.some(line => line.includes('matched no device row'))).toBe(true)
    expect(notifier.enabled).toBe(true)
  })
})

describe('live activity: the state the bridge projects', () => {
  it('user sees the card end with the turn it follows', async () => {
    // Given a paired connection whose bridge can reach the card of s-1
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    const harness = makeConnection({ paired: true, liveActivity: notifier })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_PUSH] }))
    const stream = new ControllableStream()
    harness.gateway.follow = call => stream.attach(call.signal).iterable()
    const pending = harness.connection.handleText(requestFrame(90, 'session.snapshot', { sessionId: 's-1' }))
    stream.push({ type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] })
    await pending
    // When that turn ends normally
    stream.push(record('turn/end', 12, 201, { turn: 1, reason: { kind: 'completed' } }))
    await settle()
    // Then the card is ended, and says so in the one line the alert channel uses
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps.event).toBe('end')
    expect(sink.sent[0]?.notification.aps['content-state']).toMatchObject({
      phase: 'ended',
      statusLine: 'Turn finished',
      runningCount: 1,
    })
    // And it is not dismissed: this bridge never listed that session, so it cannot
    // claim the session left a roster it was never in
    expect(sink.sent[0]?.notification.aps).not.toHaveProperty('dismissal-date')
  })

  it('user sees a failed turn on the card without the reason text', async () => {
    // Given a bridge able to reach the card of s-1
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    const harness = makeConnection({ paired: true, liveActivity: notifier })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_PUSH] }))
    const stream = new ControllableStream()
    harness.gateway.follow = call => stream.attach(call.signal).iterable()
    const pending = harness.connection.handleText(requestFrame(90, 'session.snapshot', { sessionId: 's-1' }))
    stream.push({ type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] })
    await pending
    // When the turn ends abnormally
    stream.push(record('turn/end', 20, 301, { turn: 2, reason: { kind: 'error', message: 'the tool exploded' } }))
    await settle()
    // Then the phase is failed, at the failed score, and the reason never crosses
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps.event).toBe('end')
    expect(sink.sent[0]?.notification.aps['content-state'].phase).toBe('failed')
    expect(sink.sent[0]?.notification.aps['relevance-score']).toBe(90)
    expect(JSON.stringify(sink.sent[0]?.notification)).not.toContain('the tool exploded')
  })

  it('user lists sessions and each card reports the bridge-wide running count', async () => {
    // Given one card per session for two sessions
    const clock = { now: CLOCK_START }
    const cards = [cardOf('s-1', 1), cardOf('s-2', 2)]
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    const harness = makeConnection({ paired: true, liveActivity: notifier })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    harness.gateway.handler = async () => ({
      items: [
        { sessionId: 's-1', running: true, updatedAt: 2, blank: false },
        { sessionId: 's-2', running: true, updatedAt: 1, blank: false },
        { sessionId: 's-3', running: false, updatedAt: 0, blank: false },
      ],
    })
    // When it lists them
    await harness.connection.handleText(requestFrame(2, 'session.list'))
    await settle()
    // Then each card reports its own session running, and the count is the total:
    // two sessions run, so the number on both cards is 2, not 1
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent.map(entry => entry.target.activityId)).toEqual(['act-1', 'act-2'])
    expect(sentTo(sink, 'act-1')[0]?.aps['content-state']).toMatchObject({ phase: 'running', statusLine: 'Running', runningCount: 2 })
    expect(sentTo(sink, 'act-2')[0]?.aps['content-state']).toMatchObject({ phase: 'running', runningCount: 2 })
    // And a listing where neither of those sessions runs raises no card at all
    harness.gateway.handler = async () => ({ items: [{ sessionId: 's-3', running: true, updatedAt: 0, blank: false }] })
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    await harness.connection.handleText(requestFrame(3, 'session.list'))
    await settle()
    expect(sink.sent).toHaveLength(2)
  })

  it('user is handed a question and only its own card carries the choices', async () => {
    // Given a hub whose bridge can reach the card of s-1, with one phone declaring questions
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    const harness = makeHub({ liveActivity: notifier })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['questions.v1'] }))
    // When the host asks something with three options
    void harness.hub.question({
      agent: { id: 's-1' },
      questions: [{
        id: 'q-1',
        question: 'Which deck should ship?',
        header: 'Deck',
        detail: 'Pick exactly one.',
        options: [{ label: 'Alpha' }, { label: 'Bravo' }, { label: 'Charlie' }],
        multiSelect: false,
      }],
    }, panelWaiting)
    await settle()
    // Then the card is waiting for an answer, with the header and two choices
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps.event).toBe('update')
    expect(sink.sent[0]?.notification.aps['content-state']).toMatchObject({
      phase: 'waitingForAnswer',
      statusLine: 'Waiting for your answer',
      questionHeader: 'Deck',
      optionLabels: ['Alpha', 'Bravo'],
    })
    // And not one word of the question itself crossed
    const wire = JSON.stringify(sink.sent[0]?.notification)
    expect(wire).not.toContain('Which deck should ship?')
    expect(wire).not.toContain('Pick exactly one.')
  })

  it('user asking in one session leaves the other session card alone', async () => {
    // Given two cards, one per session, and both sessions running
    const clock = { now: CLOCK_START }
    const cards = [cardOf('s-1', 1), cardOf('s-2', 2)]
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    notifier.noteRoster([{ id: 's-1', agentRunning: true }, { id: 's-2', agentRunning: true }])
    await settle()
    expect(sink.sent).toHaveLength(2)
    // When the session s-1 asks a question
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-1', { header: 'Deck', optionLabels: ['Alpha', 'Bravo'] })
    await settle()
    // Then only that session's card takes the new order
    expect(sink.sent).toHaveLength(3)
    expect(sentTo(sink, 'act-1').map(entry => entry.aps['content-state'].phase)).toEqual(['running', 'waitingForAnswer'])
    // And the other session's card still says what is true for it
    expect(sentTo(sink, 'act-2').map(entry => entry.aps['content-state'].phase)).toEqual(['running'])
    expect(sentTo(sink, 'act-2')[0]?.aps['content-state']).not.toHaveProperty('questionHeader')
  })

  it('user sees three cards carry their own session state, not one shared state', async () => {
    // Given three cards, one per session, and all three sessions running
    const clock = { now: CLOCK_START }
    const cards = [cardOf('s-1', 1), cardOf('s-2', 2), cardOf('s-3', 3)]
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    notifier.noteRoster([
      { id: 's-1', agentRunning: true },
      { id: 's-2', agentRunning: true },
      { id: 's-3', agentRunning: true },
    ])
    await settle()
    // Then every card was told its own session runs, with the total beside it
    expect(sink.sent).toHaveLength(3)
    expect(sink.sent.map(entry => entry.notification.aps['content-state'].runningCount)).toEqual([3, 3, 3])
    // When s-2 asks, and then s-3 ends its turn
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-2', { header: 'Deck' })
    await settle()
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteTurnEnd('s-3', 'completed')
    await settle()
    // Then each card ends up describing its own session, and no card carries
    // another session's fact
    expect(sentTo(sink, 'act-1').map(entry => entry.aps['content-state'].phase)).toEqual(['running'])
    expect(sentTo(sink, 'act-2').map(entry => entry.aps['content-state'].phase)).toEqual(['running', 'waitingForAnswer'])
    expect(sentTo(sink, 'act-2')[1]?.aps['content-state'].questionHeader).toBe('Deck')
    expect(sentTo(sink, 'act-3').map(entry => entry.aps.event)).toEqual(['update', 'end'])
    expect(sentTo(sink, 'act-3')[1]?.aps['content-state'].phase).toBe('ended')
    expect(sentTo(sink, 'act-1')[0]?.aps['content-state']).not.toHaveProperty('questionHeader')
  })

  it('user sees an approval blocking the agent and the tool reason stays home', async () => {
    // Given a hub whose bridge can reach the card of s-1, with one phone declaring approvals
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    const harness = makeHub({ liveActivity: notifier })
    await harness.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: ['approvals.v1'] }))
    // When a tool asks for an approval whose reason must not leave this machine
    void harness.hub.approve({
      agent: { id: 's-1' },
      toolName: 'bash',
      displayReason: { en: 'Remove the build directory', zh: '删除构建目录' },
    }, async () => 'rejected')
    await settle()
    // Then the card waits for the answer with the fixed approval line
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps['content-state']).toMatchObject({ phase: 'waitingForAnswer', statusLine: 'Waiting for your answer' })
    // And it carries no question keys at all, and no reason text
    expect(Object.keys(sink.sent[0]?.notification.aps['content-state'] ?? {})).toEqual(['phase', 'statusLine', 'asOf', 'runningCount', 'rows'])
    const wire = JSON.stringify(sink.sent[0]?.notification)
    expect(wire).not.toContain('bash')
    expect(wire).not.toContain('删除构建目录')
    expect(wire).not.toContain('Remove the build directory')
  })

  it('operator sees a card dismissed when the session it described left the roster', async () => {
    // Given a bridge that listed one running session
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    expect(sink.sent).toHaveLength(1)
    // When a later listing no longer names it, and its turn ends
    clock.now += 5 * LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteRoster([{ id: 's-9', agentRunning: false }])
    notifier.noteTurnEnd('s-1', 'completed')
    await settle()
    // Then the end is dismissed on delivery instead of lingering on the lock screen
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent[1]?.notification.aps.event).toBe('end')
    expect(sink.sent[1]?.notification.aps['dismissal-date']).toBe(sink.sent[1]?.notification.aps.timestamp)
  })

  it('operator sees the card leave the waiting state once the question is settled', async () => {
    // Given a card waiting on a question, with its own session still running
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    notifier.noteRoster([{ id: 's-1', agentRunning: true }])
    await settle()
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-1', { header: 'Deck' })
    await settle()
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent[1]?.notification.aps['content-state'].phase).toBe('waitingForAnswer')
    // When the desktop answers it
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteSettled('s-1')
    await settle()
    // Then the card is back to what is true for that session now
    expect(sink.sent).toHaveLength(3)
    expect(sink.sent[2]?.notification.aps['content-state']).toMatchObject({ phase: 'running', runningCount: 1 })
  })

  it('operator gets the card without any frame waiting for a delivery', async () => {
    // Given a sender that never answers
    const clock = { now: CLOCK_START }
    let release: (result: PushSendResult) => void = () => undefined
    const delivery = new Promise<PushSendResult>((resolve) => { release = resolve })
    const attempted: string[] = []
    const sender: LiveActivitySender = {
      async sendLiveActivity(target): Promise<PushSendResult> {
        attempted.push(target.activityId)
        return await delivery
      },
    }
    const notifier = notifierAt(sender, clock)
    // When a turn ends on the frame path
    notifier.noteTurnEnd('s-1', 'completed')
    // Then the call returned before anything was even attempted
    expect(attempted).toEqual([])
    // And the delivery started on its own, without the caller awaiting it
    await settle()
    expect(attempted).toEqual(['act-1'])
    release({ ok: true, status: 200 })
    await settle()
  })
})

describe('live activity: the rows one card lays out', () => {
  it('operator reads a row name with the path, the brackets and the dangling tail gone', () => {
    // Given the host titles a roster really carries, including the one a phone
    // saw on a real device: the first message plus the absolute path it ran in
    const titles = [
      '你是本仓 (/Users/zcl/code/iphone_remote_use_dsh)',
      '你是本仓（/Users/zcl/code/x）',
      'Ship the deck ()',
      'Ship the deck (   )',
      '  Draft   the copy  ',
      '你是本仓 (/Users/zcl/code/x) - ',
      'Ship (main)',
      'Fix it (beta',
    ]
    // When each is normalized
    const names = titles.map(normalizeActivityRowName)
    // Then what is left is the name alone: no path, no separator, no empty group
    expect(names).toEqual([
      '你是本仓',
      '你是本仓',
      'Ship the deck',
      'Ship the deck',
      'Draft the copy',
      '你是本仓',
      'Ship (main)',
      'Fix it (beta',
    ])
  })

  it('operator never gets a name that ends on a separator or a half-taken group', () => {
    // Given one title per tail a host title can end on, and one longer than a row
    const titles = [
      'Tail (/a)',
      'Tail（/a）',
      'Tail ()',
      'Tail - ',
      'Tail ·(/a)',
      'x'.repeat(120) + ' (/a)',
      'Tail (/a))',
    ]
    // When each is normalized and cut to the row budget
    const names = titles.map(normalizeActivityRowName)
    // Then the path group goes whole, brackets included, and no separator is left
    expect(names.slice(0, 5)).toEqual(['Tail', 'Tail', 'Tail', 'Tail', 'Tail'])
    // And a closing bracket that outlived the group it closed goes with it
    expect(names[6]).toBe('Tail')
    // And a name longer than the budget is cut rather than left to push the card
    expect(Array.from(names[5] ?? '')).toHaveLength(LIVE_ACTIVITY_ROW_NAME_MAX)
    // And no name ends on a separator
    for (const name of names) expect(name).not.toMatch(/[\s·/\\-]$/u)
  })

  it('operator reads the frozen keys first and the rows last', () => {
    // Given one card built with four rows, one more than a card can lay out
    const rows = [1, 2, 3, 4].map(index => ({ name: 'Session ' + String(index), status: ACTIVITY_STATUS_LINE.running, phase: 'running' as const }))
    // When it is built
    const notification = buildLiveActivityNotification({
      event: 'update',
      phase: 'running',
      statusLine: ACTIVITY_STATUS_LINE.running,
      runningCount: 4,
      rows,
      now: CLOCK_START,
    })
    // Then the six frozen keys keep their order and the rows are appended last
    expect(Object.keys(notification.aps['content-state'])).toEqual(['phase', 'statusLine', 'asOf', 'runningCount', 'rows'])
    // And the fourth row is dropped, never wrapped or paged
    expect(notification.aps['content-state'].rows).toHaveLength(LIVE_ACTIVITY_ROW_LIMIT)
    expect(notification.aps['content-state'].rows?.map(row => row.name)).toEqual(['Session 1', 'Session 2', 'Session 3'])
    // And a card built without rows carries no such key at all: that is the
    // shape an old bridge sends, and the App lays out one row of its own
    expect(buildLiveActivityNotification({
      event: 'update',
      phase: 'running',
      statusLine: ACTIVITY_STATUS_LINE.running,
      runningCount: 1,
      now: CLOCK_START,
    }).aps['content-state']).not.toHaveProperty('rows')
  })

  it('operator reads the waiting sessions first and the running ones by recency', async () => {
    // Given three running sessions and two sessions that are listed but idle
    const clock = { now: CLOCK_START }
    const cards = ['s-1', 's-2', 's-3', 's-8', 's-9'].map((id, index) => cardOf(id, index + 1))
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    notifier.noteRoster([
      { id: 's-1', title: 'First (/Users/zcl/code/one)', updatedAt: 10, agentRunning: true },
      { id: 's-2', title: 'Second', updatedAt: 20, agentRunning: true },
      { id: 's-3', title: 'Third', updatedAt: 30, agentRunning: true },
      { id: 's-8', title: 'Question later', updatedAt: 5, agentRunning: false },
      { id: 's-9', title: 'Question first', updatedAt: 6, agentRunning: false },
    ])
    await settle()
    // Then every card lays the running sessions out most recently updated first
    expect(sentTo(sink, 'act-1')[0]?.aps['content-state'].rows).toEqual([
      { name: 'Third', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
      { name: 'Second', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
      { name: 'First', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
    // When the idle session s-9 asks a question
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-9', { header: 'Deck' })
    await settle()
    // Then the question leads the card and the fourth session is dropped
    expect(sentTo(sink, 'act-5')[0]?.aps['content-state'].rows).toEqual([
      { name: 'Question first', status: ACTIVITY_STATUS_LINE.waitingForAnswer, phase: 'waitingForAnswer' },
      { name: 'Third', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
      { name: 'Second', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
    // When a second session asks later
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-8', { header: 'Deck' })
    await settle()
    // Then the two questions keep the order they arrived in, ahead of the work
    expect(sentTo(sink, 'act-4')[0]?.aps['content-state'].rows).toEqual([
      { name: 'Question first', status: ACTIVITY_STATUS_LINE.waitingForAnswer, phase: 'waitingForAnswer' },
      { name: 'Question later', status: ACTIVITY_STATUS_LINE.waitingForAnswer, phase: 'waitingForAnswer' },
      { name: 'Third', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
  })

  it('operator never sees a finished turn as a row, only the work and the waiting', async () => {
    // Given two running sessions, both titled
    const clock = { now: CLOCK_START }
    const cards = [cardOf('s-1', 1), cardOf('s-2', 2)]
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    notifier.noteRoster([
      { id: 's-1', title: 'Only', updatedAt: 10, agentRunning: true },
      { id: 's-2', title: 'Other', updatedAt: 20, agentRunning: true },
    ])
    await settle()
    // Then both rows are running
    expect(sentTo(sink, 'act-1')[0]?.aps['content-state'].rows?.map(row => row.phase)).toEqual(['running', 'running'])
    // When s-1 asks a question
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-1', { header: 'Deck' })
    await settle()
    // Then its own row is the waiting one
    expect(sentTo(sink, 'act-1')[1]?.aps['content-state'].rows?.[0]).toEqual({
      name: 'Only',
      status: ACTIVITY_STATUS_LINE.waitingForAnswer,
      phase: 'waitingForAnswer',
    })
    // When that question settles and its turn ends abnormally
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteSettled('s-1')
    await settle()
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteTurnEnd('s-1', 'error')
    await settle()
    // Then the card says failed once, in its own phase, and its rows hold only
    // the session that is still running: a finished turn is not a row
    const failed = sentTo(sink, 'act-1').at(-1)?.aps['content-state']
    expect(failed?.phase).toBe('failed')
    expect(failed?.rows).toEqual([
      { name: 'Other', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
    // When a later turn of the same session ends normally
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteTurnEnd('s-1', 'completed')
    await settle()
    // Then the phase moved on and the rows still name nobody who left
    const ended = sentTo(sink, 'act-1').at(-1)?.aps['content-state']
    expect(ended?.phase).toBe('ended')
    expect(ended?.rows).toEqual([
      { name: 'Other', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
  })

  it('operator is not sent a card twice, but a renamed row is something new to say', async () => {
    // Given one card whose session runs under a title
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    notifier.noteRoster([{ id: 's-1', title: 'Draft the copy', updatedAt: 10, agentRunning: true }])
    await settle()
    expect(sink.sent).toHaveLength(1)
    // When the next listing says exactly the same thing
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteRoster([{ id: 's-1', title: 'Draft the copy', updatedAt: 10, agentRunning: true }])
    await settle()
    // Then nothing is sent: the card already says it
    expect(sink.sent).toHaveLength(1)
    // When the host appends the path it runs in, which the row may not carry
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteRoster([{ id: 's-1', title: 'Draft the copy (/Users/zcl/code/x)', updatedAt: 10, agentRunning: true }])
    await settle()
    // Then the card reads the same, so it is not sent again either
    expect(sink.sent).toHaveLength(1)
    // When the name itself changes
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteRoster([{ id: 's-1', title: 'Draft the final copy', updatedAt: 10, agentRunning: true }])
    await settle()
    // Then that is a new thing to say, and the rows carry it
    expect(sink.sent).toHaveLength(2)
    expect(sink.sent[1]?.notification.aps['content-state'].rows).toEqual([
      { name: 'Draft the final copy', status: ACTIVITY_STATUS_LINE.running, phase: 'running' },
    ])
  })

  it('operator sees no rows at all when the host never titled the session', async () => {
    // Given a roster row with a blank title, as a session that just started has
    const clock = { now: CLOCK_START }
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock)
    // When that roster is served
    notifier.noteRoster([{ id: 's-1', title: '   ', updatedAt: 1, agentRunning: true }])
    await settle()
    // Then the key is still on the wire, because this bridge speaks the rows
    // protocol, and it is empty because a row without a name is no row (§30.4)
    expect(sink.sent).toHaveLength(1)
    expect(sink.sent[0]?.notification.aps['content-state']).toHaveProperty('rows')
    expect(sink.sent[0]?.notification.aps['content-state'].rows).toEqual([])
    // And the single-session keys are exactly what they were
    expect(sink.sent[0]?.notification.aps['content-state']).toMatchObject({ phase: 'running', statusLine: ACTIVITY_STATUS_LINE.running, runningCount: 1 })
  })

  it('operator reads the fixed English phrase for each of the four phases', () => {
    // Given the four phases a card can report
    const phases = ['running', 'waitingForAnswer', 'failed', 'ended'] as const
    // When each one's fixed line is read
    const lines = phases.map(statusLineOf)
    // Then it is the App's own word, verbatim
    expect(lines).toEqual(['Running', 'Waiting for your answer', 'Stopped', 'Turn finished'])
    // And every one of them is ASCII: the card is the App's surface, so a
    // bridge-side translation would put a second language on the same glass
    for (const line of lines) expect(line).toMatch(/^[\x20-\x7E]+$/u)
  })

  it('operator reads no non-ASCII character in either phrase field of a card', async () => {
    // Given one card per session, one running and one waiting for an answer
    const clock = { now: CLOCK_START }
    const cards = [cardOf('s-1', 1), cardOf('s-9', 2)]
    const sink = recorder()
    const notifier = notifierAt(sink.sender, clock, { targets: cards })
    notifier.noteRoster([
      { id: 's-1', title: '你是本仓 (/Users/zcl/code/x)', updatedAt: 5, agentRunning: true },
      { id: 's-9', title: 'Review the plan', updatedAt: 4, agentRunning: false },
    ])
    await settle()
    // When the idle session asks a question
    clock.now += LIVE_ACTIVITY_INTERVAL_MS
    notifier.noteQuestion('s-9', { header: 'Deck' })
    await settle()
    // Then the card's own line and both row statuses are ASCII only
    const content = sentTo(sink, 'act-2')[0]?.aps['content-state']
    expect(content?.statusLine).toMatch(/^[\x20-\x7E]+$/u)
    expect(content?.rows).toHaveLength(2)
    for (const row of content?.rows ?? []) expect(row.status).toMatch(/^[\x20-\x7E]+$/u)
    // And the names are the host's own titles, so a non-ASCII one survives: the
    // rule covers the phrase table, not the name the host gave its session
    expect(content?.rows?.map(row => row.name)).toEqual(['Review the plan', '你是本仓'])
  })
})
