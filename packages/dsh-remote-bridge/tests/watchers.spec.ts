import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DeviceRoster } from '../src/core/devices.ts'
import {
  LiveActivityNotifier,
  type LiveActivityAddress,
  type LiveActivityNotification,
  type LiveActivitySender,
} from '../src/core/liveactivity.ts'
import { createOwnerPeer } from '../src/core/owner-peer.ts'
import { CAP_PUSH } from '../src/core/protocol.ts'
import { PushNotifier, type PushAddress, type PushNotification, type PushSendResult, type PushSender } from '../src/core/push.ts'
import { TurnEndQuietGate } from '../src/core/turn-end-quiet.ts'
import { StandingWatchers } from '../src/host/watchers.ts'
import { ControllableStream, FakeGateway, makeConnection, requestFrame, settle } from './support/harness.ts'

/** One follow record as DSH writes it. */
function record(type: string, seq: number, time: number, data: unknown): unknown {
  return { type: 'event', event: { type, seq, time, data } }
}

/** The baseline frame every follow stream opens with. */
const BASELINE = { type: 'snapshot', header: {}, cursor: 0, hasMore: false, projections: {}, records: [] }

/** The card of session s-1. */
const CARD: LiveActivityAddress = { activityId: 'act-1', token: 'ff00aa', sessionId: 's-1', environment: 'sandbox', bundle: 'dev.dsh.Whale' }

/** The one phone a notification is addressed to. */
const PHONE: PushAddress = { deviceToken: 'aabbccdd', environment: 'sandbox', bundle: 'dev.dsh.Whale' }

/** What both push paths actually delivered, in order. */
interface Sinks {
  readonly cards: LiveActivityNotification[]
  readonly notices: PushNotification[]
  readonly liveActivity: LiveActivityNotifier
  readonly push: PushNotifier
}

/** Both paths over one clock, recording what they sent. */
function sinksAt(clock: { now: number }): Sinks {
  const cards: LiveActivityNotification[] = []
  const notices: PushNotification[] = []
  const cardSender: LiveActivitySender = {
    async sendLiveActivity(target, notification): Promise<PushSendResult> {
      cards.push(notification)
      return { ok: true, status: 200 }
    },
  }
  const phoneSender: PushSender = {
    async send(target, notification): Promise<PushSendResult> {
      notices.push(notification)
      return { ok: true, status: 200 }
    },
  }
  return {
    cards,
    notices,
    liveActivity: new LiveActivityNotifier({ targets: () => [CARD], sender: cardSender, now: () => clock.now }),
    push: new PushNotifier({ targets: () => [PHONE], sender: phoneSender, now: () => clock.now }),
  }
}

/** One watcher set over a scripted gateway, plus the streams it asked for. */
interface WatchHarness {
  readonly watchers: StandingWatchers
  readonly gateway: FakeGateway
  readonly streams: ControllableStream[]
  readonly logs: string[]
  /** The roster view the watcher reconciles against; a test may change it. */
  readonly sessions: string[]
  readonly sink: Sinks | undefined
}

function watchHarness(extra: {
  readonly sessions?: readonly string[]
  readonly sink?: Sinks
  readonly limit?: number
  readonly reopenMs?: number
  readonly gate?: TurnEndQuietGate
} = {}): WatchHarness {
  const gateway = new FakeGateway()
  const streams: ControllableStream[] = []
  gateway.follow = (call) => {
    const stream = new ControllableStream()
    streams.push(stream)
    return stream.attach(call.signal).iterable()
  }
  const logs: string[] = []
  const sessions = [...(extra.sessions ?? [])]
  const sink = extra.sink
  const watchers = new StandingWatchers({
    gateway,
    peer: createOwnerPeer(new Context()),
    sessions: () => sessions,
    log: (message: string): void => { logs.push(message) },
    ...(sink === undefined ? {} : { liveActivity: sink.liveActivity, push: sink.push }),
    ...(extra.gate === undefined ? {} : { turnEndQuiet: extra.gate }),
    ...(extra.limit === undefined ? {} : { limit: extra.limit }),
    ...(extra.reopenMs === undefined ? {} : { reopenMs: extra.reopenMs }),
  })
  return { watchers, gateway, streams, logs, sessions, sink }
}

/**
 * Give the watcher loop enough event-loop turns to reach a pending re-arm.
 *
 * A re-arm is a zero-delay timer, and a timer only runs on the loop's next timer
 * phase, so a bounded run of check-phase ticks is what makes this deterministic
 * without a sleep.
 */
async function turn(): Promise<void> {
  await settle()
  for (let index = 0; index < 10; index += 1) await new Promise<void>((resolve) => { setImmediate(resolve) })
  await settle()
}

/** One roster row in the shape every probe entry of a real table has. */
function rosterRow(deviceId: string): Record<string, unknown> {
  return {
    deviceId,
    pubKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0',
    fingerprint: 'fingerprint-0',
    createdAt: 1_700_000_000_000,
    lastSeenAt: 1_700_000_000_000,
    tokenHash: 'hash-0',
  }
}

async function rosterFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-watcher-'))
  return join(directory, 'remote-bridge', 'devices.json')
}

/** Write one roster file, creating the directory it lives in. */
async function writeRoster(file: string, body: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(body), 'utf8')
}

describe('standing watchers: the stream the bridge keeps for a card', () => {
  it('operator arms one stream per session that holds a card', () => {
    // Given a roster view naming one session with a card
    // When the watchers reconcile
    const harness = watchHarness({ sessions: ['s-1'], sink: sinksAt({ now: 1_700_000_000_000 }) })
    harness.watchers.sync()
    // Then exactly one follow stream was asked for, addressed as an ordinary session
    expect(harness.watchers.size).toBe(1)
    expect(harness.gateway.streamRequests).toHaveLength(1)
    expect(harness.gateway.streamRequests[0]?.namespace).toBe('session')
    expect(harness.gateway.streamRequests[0]?.method).toBe('follow')
    expect(harness.gateway.streamRequests[0]?.args).toMatchObject({
      request: { address: { kind: 'session', sessionId: 's-1' }, assistantStream: true },
    })
    // And the line an operator greps for says why it exists
    expect(harness.logs).toContain('watcher open session=s-1 reason=cards')
    harness.watchers.dispose()
  })

  it('user sees the card end when the watched turn ends', async () => {
    // Given a watcher attached to the session its card belongs to
    const sink = sinksAt({ now: 1_700_000_000_000 })
    const harness = watchHarness({ sessions: ['s-1'], sink })
    harness.watchers.sync()
    harness.streams[0]?.push(BASELINE)
    // When that session ends a turn with no client attached at all
    harness.streams[0]?.push(record('turn/end', 12, 201, { turn: 1, reason: { kind: 'completed' } }))
    await turn()
    // Then the card is ended for that session
    expect(sink.cards).toHaveLength(1)
    expect(sink.cards[0]?.aps.event).toBe('end')
    expect(sink.cards[0]?.aps['content-state']).toMatchObject({ phase: 'ended', statusLine: 'Turn finished' })
    // And the notification of §28.5 went with it
    expect(sink.notices).toHaveLength(1)
    expect(sink.notices[0]?.st).toBe('turn-end')
    // And both are named in one grep-able line
    expect(harness.logs).toContain('watcher turn-end session=s-1 reason=completed pushed=card')
    harness.watchers.dispose()
  })

  it('user is told the turn ended only once the session is quiet', async () => {
    // Given a watcher whose turn ends through a gate over a session the host still reports busy
    const clock = { now: 1_700_000_000_000 }
    const sink = sinksAt(clock)
    const lines: string[] = []
    let quiet = false
    const gate = new TurnEndQuietGate({
      push: sink.push,
      liveActivity: sink.liveActivity,
      probe: async () => (quiet ? { quiet: true } : { quiet: false, busy: 'job-live(job-1)' }),
      now: () => clock.now,
      log: (message: string): void => { lines.push(message) },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = watchHarness({ sessions: ['s-1'], sink, gate })
    try {
      harness.watchers.sync()
      harness.streams[0]?.push(BASELINE)
      // When the turn ends while the host still holds a job under that session
      harness.streams[0]?.push(record('turn/end', 12, 201, { turn: 1, reason: { kind: 'completed' } }))
      await turn()
      // Then neither channel has said anything yet
      expect(sink.notices).toHaveLength(0)
      expect(sink.cards).toHaveLength(0)
      // And the host's still-busy answer keeps holding it
      clock.now += 5_000
      vi.advanceTimersByTime(5_000)
      await turn()
      expect(sink.notices).toHaveLength(0)
      // When the host finally answers quiet
      quiet = true
      clock.now += 5_000
      vi.advanceTimersByTime(5_000)
      await turn()
      // Then one notification and one card end went out, for the turn that ended
      expect(sink.notices).toHaveLength(1)
      expect(sink.notices[0]?.st).toBe('turn-end')
      expect(sink.cards).toHaveLength(1)
      expect(sink.cards[0]?.aps.event).toBe('end')
      expect(lines).toContain('turn-end quiet session=s-1 waited=10000ms event=turn-end')
    } finally {
      gate.dispose()
      harness.watchers.dispose()
      vi.useRealTimers()
    }
  })

  it('operator runs a bridge with no push path and no stream is ever opened', () => {
    // Given a bridge whose two push paths are both off
    // When the watchers reconcile over a session that holds a card
    const harness = watchHarness({ sessions: ['s-1'] })
    harness.watchers.sync()
    // Then nothing was opened and nothing was logged
    expect(harness.watchers.enabled).toBe(false)
    expect(harness.watchers.size).toBe(0)
    expect(harness.streams).toHaveLength(0)
    expect(harness.logs).toEqual([])
  })

  it('operator sees the stream close when the session loses its last card', () => {
    // Given one open watcher
    const harness = watchHarness({ sessions: ['s-1'], sink: sinksAt({ now: 1_700_000_000_000 }) })
    harness.watchers.sync()
    expect(harness.streams[0]?.aborted).toBe(false)
    // When the roster no longer names a card for that session
    harness.sessions.length = 0
    harness.watchers.sync()
    // Then the stream was aborted and the set is empty again
    expect(harness.watchers.size).toBe(0)
    expect(harness.streams[0]?.aborted).toBe(true)
    expect(harness.logs).toContain('watcher close session=s-1 reason=cards-gone')
  })

  it('operator sees the watch count capped and the refusal logged once', () => {
    // Given three sessions with cards and room for two
    const harness = watchHarness({ sessions: ['s-1', 's-2', 's-3'], limit: 2, sink: sinksAt({ now: 1_700_000_000_000 }) })
    // When the watchers reconcile twice
    harness.watchers.sync()
    // Then two streams are open and the third is refused
    expect(harness.watchers.size).toBe(2)
    expect(harness.streams).toHaveLength(2)
    expect(harness.logs.filter(line => line.includes('watcher refused session=s-3'))).toHaveLength(1)
    harness.watchers.sync()
    // And the second reconcile does not repeat the refusal
    expect(harness.watchers.size).toBe(2)
    expect(harness.logs.filter(line => line.includes('watcher refused session=s-3'))).toHaveLength(1)
    harness.watchers.dispose()
  })

  it('operator sees the next turn when a stream ended on its own', async () => {
    // Given a watcher whose session still holds its card
    const sink = sinksAt({ now: 1_700_000_000_000 })
    const harness = watchHarness({ sessions: ['s-1'], sink, reopenMs: 0 })
    // Only the re-arm delay is virtual: the drain itself stays real, so the
    // stream ending and the next stream opening are both observable in order.
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      harness.watchers.sync()
      harness.streams[0]?.push(BASELINE)
      // When the host ends the stream with no turn end in it
      harness.streams[0]?.end()
      await settle()
      vi.advanceTimersByTime(5)
      await settle()
    } finally {
      vi.useRealTimers()
    }
    // Then a fresh stream was opened for the same session
    expect(harness.gateway.streamRequests).toHaveLength(2)
    expect(harness.watchers.size).toBe(1)
    // And the next turn on it still reaches the card
    harness.streams[1]?.push(BASELINE)
    harness.streams[1]?.push(record('turn/end', 30, 401, { turn: 2, reason: { kind: 'completed' } }))
    await turn()
    expect(sink.cards).toHaveLength(1)
    expect(sink.cards[0]?.aps.event).toBe('end')
    harness.watchers.dispose()
  })

  it('operator survives a stream the host refuses, and no frame is touched', async () => {
    // Given a gateway that refuses the follow stream
    const harness = watchHarness({ sessions: ['s-1'], sink: sinksAt({ now: 1_700_000_000_000 }) })
    harness.gateway.follow = () => { throw new Error('gateway exploded') }
    // When the watchers reconcile
    harness.watchers.sync()
    await turn()
    // Then the failure is one line, the set is empty and nothing threw
    expect(harness.logs.some(line => line.includes('watcher stream refused session=s-1'))).toBe(true)
    expect(harness.watchers.size).toBe(0)
    // And it is not retried in a loop: a refusal is not a stream that ended
    expect(harness.gateway.streamRequests).toHaveLength(1)
    harness.watchers.dispose()
  })

  it('operator sees one turn end however many streams report it', async () => {
    // Given a watcher on a session a phone is also following: two reports of one end
    const sink = sinksAt({ now: 1_700_000_000_000 })
    const harness = watchHarness({ sessions: ['s-1'], sink })
    harness.watchers.sync()
    harness.streams[0]?.push(BASELINE)
    // When the same turn end arrives twice, in the same millisecond
    harness.streams[0]?.push(record('turn/end', 12, 201, { turn: 1, reason: { kind: 'completed' } }))
    harness.streams[0]?.push(record('turn/end', 13, 202, { turn: 1, reason: { kind: 'completed' } }))
    await turn()
    // Then the §29 content key and the §28.5 window collapse them
    expect(sink.cards).toHaveLength(1)
    expect(sink.notices).toHaveLength(1)
    // And both reports were still observed by the watcher
    expect(harness.logs.filter(line => line.startsWith('watcher turn-end'))).toHaveLength(2)
    harness.watchers.dispose()
  })

  it('operator closes every stream when the bridge goes away', () => {
    // Given one open watcher
    const harness = watchHarness({ sessions: ['s-1'], sink: sinksAt({ now: 1_700_000_000_000 }) })
    harness.watchers.sync()
    // When the plugin disposes
    harness.watchers.dispose()
    // Then the stream is aborted and nothing is re-armed
    expect(harness.streams[0]?.aborted).toBe(true)
    expect(harness.watchers.size).toBe(0)
    harness.watchers.sync()
    expect(harness.streams).toHaveLength(1)
  })

  it('user registering a card is what arms the watcher for that session', async () => {
    // Given a paired phone and a watcher set that is armed from the roster
    const file = await rosterFile()
    await writeRoster(file, { version: 2, devices: [rosterRow('dev_harness')] })
    const roster = new DeviceRoster({ file })
    await roster.load()
    const harness = watchHarness({ sink: sinksAt({ now: 1_700_000_000_000 }) })
    const sessions = (): readonly string[] => {
      const ids = new Set<string>()
      for (const { push } of roster.pushTargets()) {
        for (const token of push.liveActivityTokens ?? []) if (token.sessionId !== undefined) ids.add(token.sessionId)
      }
      return [...ids]
    }
    const watchers = new StandingWatchers({
      gateway: harness.gateway,
      peer: createOwnerPeer(new Context()),
      sessions,
      liveActivity: harness.sink?.liveActivity as LiveActivityNotifier,
      push: harness.sink?.push as PushNotifier,
      log: (message: string): void => { harness.logs.push(message) },
    })
    const connection = makeConnection({ paired: true, roster, onPushRegistered: () => { watchers.sync() } })
    await connection.connection.handleText(requestFrame(1, 'hello', { proto: 1, cap: [CAP_PUSH] }))
    expect(watchers.size).toBe(0)
    // When it registers the card of session s-1
    await connection.connection.handleText(requestFrame(2, 'push.register', {
      deviceToken: 'aabbccdd',
      environment: 'sandbox',
      bundle: 'dev.dsh.Whale',
      liveActivityTokens: [{ activityId: 'act-1', token: 'ff00', sessionId: 's-1' }],
    }))
    // Then one standing stream was opened for that session, and only that one
    expect(watchers.size).toBe(1)
    expect(harness.gateway.streamRequests).toHaveLength(1)
    expect(harness.gateway.streamRequests[0]?.args).toMatchObject({ request: { address: { kind: 'session', sessionId: 's-1' } } })
    expect(harness.logs).toContain('watcher open session=s-1 reason=cards')
    watchers.dispose()
    connection.connection.dispose()
  })
})
