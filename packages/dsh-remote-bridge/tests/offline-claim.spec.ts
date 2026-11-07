import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceRoster, ROSTER_VERSION } from '../src/core/devices.ts'
import { PushNotifier, type PushAddress, type PushNotification, type PushSendResult, type PushSender } from '../src/core/push.ts'
import type { QuestionAnswer, UserQuestionRequestLike } from '../src/core/questions.ts'
import { answerOf, makeBareHub, RecordingTransport, requestFrame, settle, type BareHubHarness } from './support/harness.ts'

/**
 * Install the one timer kind these suites move.
 *
 * Only the timeout pair is faked: the connection heartbeat is an interval and
 * stays real, and `Date.now()` keeps running where the claim bookkeeping reads it.
 * `clearTimeout` has to be faked beside `setTimeout`, or a cancelled window stays
 * on the fake clock and fires anyway.
 */
function useClaimClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/** One alert the bridge asked APNs to deliver. */
interface SentAlert {
  readonly target: PushAddress
  readonly notification: PushNotification
}

/** A push channel whose deliveries the suite scripts per device. */
interface PushSink {
  readonly sent: SentAlert[]
  readonly sender: PushSender
}

/**
 * A recording sender over a scripted answer.
 *
 * The notifier beside it advances its clock a minute per reading, so no alert in
 * these suites is ever suppressed by the dedupe window or the rolling-minute cap:
 * "only one notification went out" is then a statement about the bridge rather
 * than about the rate limiter.
 * @param answer - what this APNs answers per device; the default accepts.
 * @returns the recordings and the sender to inject.
 */
function pushSink(answer: (target: PushAddress) => PushSendResult = () => ({ ok: true, status: 200 })): PushSink {
  const sent: SentAlert[] = []
  return {
    sent,
    sender: {
      async send(target, notification) {
        sent.push({ target, notification })
        return answer(target)
      },
    },
  }
}

/**
 * A roster that keeps every cleanup write the bridge starts without awaiting it.
 *
 * `removePush` is a file write and a claim decision must not wait on a disk, so the
 * bridge calls it and moves on. A suite that has to see the table afterwards needs
 * those promises themselves: the roster stays the real one, with its real file, and
 * only the removals are remembered beside it.
 */
class CleanupRoster extends DeviceRoster {
  readonly #removals: Promise<boolean>[] = []

  /** @returns the removal each cleanup asked for, in the order the bridge asked. */
  get removals(): readonly Promise<boolean>[] {
    return this.#removals
  }

  override removePush(deviceToken: string): Promise<boolean> {
    const removal = super.removePush(deviceToken)
    this.#removals.push(removal)
    return removal
  }
}

/**
 * A real roster file holding one paired device per token, each registered for
 * notifications, read back into a `DeviceRoster`.
 *
 * Loaded before the hub sees it: the bridge awaits the memoized load on the
 * question path, and a suite that left it pending would be timing a disk read
 * instead of asserting a decision.
 * @param tokens - one APNs token per paired device, in roster order.
 * @returns the loaded roster.
 */
async function rosterWith(tokens: readonly string[]): Promise<CleanupRoster> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-remote-bridge-offline-'))
  const file = join(directory, 'remote-bridge', 'devices.json')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({
    version: ROSTER_VERSION,
    devices: tokens.map((deviceToken, index) => ({
      deviceId: `dev_${index}`,
      pubKey: `MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE${index}`,
      fingerprint: `fingerprint-${index}`,
      createdAt: 1_700_000_000_000 + index,
      lastSeenAt: 1_700_000_000_000 + index,
      tokenHash: `hash-${index}`,
      push: { deviceToken, environment: 'sandbox', bundle: 'dev.dsh.Whale', registeredAt: 1_700_000_000_000 },
    })),
  }), 'utf8')
  const roster = new CleanupRoster({ file })
  await roster.load()
  return roster
}

/** What one offline-claim suite needs beyond the shared bare hub. */
interface OfflineHarness extends BareHubHarness {
  readonly roster: CleanupRoster
  readonly sink: PushSink
}

/** Options for {@link offlineHarness}. */
interface OfflineOptions {
  /** One notification registration per token; the default is a roster with none. */
  readonly tokens?: readonly string[]
  /** What APNs answers per device; the default accepts. */
  readonly answer?: (target: PushAddress) => PushSendResult
  /** False models a bridge with no APNs signing key, whose channel is inert. */
  readonly send?: boolean
  /** The id source of a call id this bridge mints; the default is random. */
  readonly mintedId?: string
}

/**
 * A hub with no connection on the wire, one loaded roster, and a push channel
 * that records every alert it was asked to deliver.
 * @param options - the roster's tokens and the sender's script.
 * @returns the hub, its roster and the recording sink.
 */
async function offlineHarness(options: OfflineOptions = {}): Promise<OfflineHarness> {
  const roster = await rosterWith(options.tokens ?? [])
  const sink = pushSink(options.answer)
  let clock = 1_700_000_000_000
  const push = new PushNotifier({
    targets: () => roster.pushTargets().map(({ push: registration }) => ({
      deviceToken: registration.deviceToken,
      environment: registration.environment,
      bundle: registration.bundle,
    })),
    ...(options.send === false ? {} : { sender: sink.sender }),
    now: () => {
      clock += 60_000
      return clock
    },
    log: () => undefined,
  })
  const bare = makeBareHub({
    roster,
    push,
    ...(options.mintedId === undefined ? {} : { questionIds: () => options.mintedId as string }),
  })
  return { ...bare, roster, sink }
}

/** One timed question as the host's waterfall carries it. */
function hostRequest(overrides: Partial<UserQuestionRequestLike> = {}): UserQuestionRequestLike {
  return {
    agent: { id: 's-1' },
    wait: { callId: 'c-1', timed: true },
    questions: [{ id: 'q-1', question: 'Which deck?', header: 'Deck', options: [{ label: 'Alpha' }, { label: 'Beta' }] }],
    ...overrides,
  }
}

/** The answer a phone sends for {@link hostRequest}'s single question. */
const ANSWER: QuestionAnswer = { answers: [{ id: 'q-1', selected: ['Alpha'] }] }

/** Complete one connection's hello with exactly one capability. */
async function declare(connection: { handleText(text: string): Promise<void> }, capability: string, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: [capability] }))
}

/** @returns every `question.request` payload the carrier took. */
function questionCards(transport: RecordingTransport): Record<string, unknown>[] {
  return transport.ofType('ev').filter(frame => frame.m === 'question.request').map(frame => frame.p as Record<string, unknown>)
}

/**
 * Wait for a roster cleanup the bridge starts without awaiting it.
 *
 * `removePush` is a file write and a claim decision must not wait on a disk, so
 * each removal it asked for is awaited here instead. The dead tokens are dropped one
 * write after another, and a turn count would time how long a loaded runner takes to
 * flush two files rather than wait for the completion the assertion is about: the
 * list is re-read after every wait, so the second removal's own write is awaited too.
 */
async function untilRegistrations(roster: CleanupRoster, expected: number): Promise<void> {
  for (let seen = 0; seen < roster.removals.length; seen += 1) await roster.removals[seen]?.catch(() => undefined)
  expect(roster.pushTargets()).toHaveLength(expected)
}

/**
 * The host's own answerer as the panel shows it: a card that answers on a click.
 *
 * The claim hands the panel the same question the moment it is created, so every
 * case below has two answerers. `calls` is how many times the panel was offered
 * the question — one card, shown once — and `answer` is the click.
 */
interface DesktopCard {
  readonly next: () => Promise<QuestionAnswer>
  readonly calls: () => number
  readonly answer: (value: QuestionAnswer) => void
}

/** Build one {@link DesktopCard}: a chain that answers only when the suite clicks. */
function desktopCard(): DesktopCard {
  let clicks = 0
  let settle: (value: QuestionAnswer) => void = () => undefined
  const pending = new Promise<QuestionAnswer>(resolve => { settle = resolve })
  return {
    next: () => {
      clicks += 1
      return pending
    },
    calls: () => clicks,
    answer: (value) => { settle(value) },
  }
}

/** @returns the log lines that say a claim was given up. */
function releaseLines(logs: readonly string[]): string[] {
  return logs.filter(line => line.includes('was released'))
}

describe('offline question claim: the phone that is not on the wire', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator claims a question for the away phone, alerts it once and offers the panel the same card', async () => {
    // Given a bridge with no phone on the wire and one paired device that registered for notifications
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    // When the host asks a question
    void harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // Then the bridge holds the claim itself instead of handing the ask on, and
    // the host's own panel is showing the same question rather than being told
    // about it later
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(harness.questions.size).toBe(1)
    expect(desktop.calls()).toBe(1)
    // And that device was told exactly once, in the payload the alert channel always carried
    expect(harness.sink.sent).toHaveLength(1)
    expect(harness.sink.sent[0]?.target.deviceToken).toBe('token-1')
    expect(harness.sink.sent[0]?.notification).toEqual({
      aps: { alert: { title: '有待回答的问题', body: '有待回答的问题' }, sound: 'default' },
      s: 's-1',
      st: 'question',
      url: 'whale://session/s-1',
    })
  })

  it('operator delegates the question at once when no device ever registered for notifications', async () => {
    // Given a bridge with no phone on the wire and a roster whose devices asked for nothing
    useClaimClock()
    const harness = await offlineHarness()
    let delegated = 0
    // When the host asks
    const answer = await harness.hub.question(hostRequest(), async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    })
    // Then the next answerer decided, and this bridge held nothing and told nobody
    expect(answer).toEqual({ answers: [] })
    expect(delegated).toBe(1)
    expect(harness.questions.size).toBe(0)
    expect(harness.sink.sent).toEqual([])
  })

  it('operator delegates when the roster holds a token but this bridge has no signing key', async () => {
    // Given a roster with a registration and a bridge whose push channel is inert
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'], send: false })
    let delegated = 0
    // When the host asks
    const answer = await harness.hub.question(hostRequest(), async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    })
    // Then the question is not claimed for a phone that could never be told about it
    expect(answer).toEqual({ answers: [] })
    expect(delegated).toBe(1)
    expect(harness.questions.size).toBe(0)
    expect(harness.sink.sent).toEqual([])
  })

  it('user opens the app and is handed the card, with no second alert', async () => {
    // Given a held offline claim and the panel holding the same card
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    void harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // When a phone that declares the question channel comes online
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declare(returned, 'questions.v1')
    await settle()
    // Then it was handed the live claim, the way the original broadcast would have
    expect(questionCards(transport)).toHaveLength(1)
    expect(questionCards(transport)[0]).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open' })
    // And that phone was not told twice
    expect(harness.sink.sent).toHaveLength(1)
    // When it answers, the ordinary answer path settles the host's own ask
    await returned.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf({ transport }, 2)).toEqual({ ok: true, r: { ok: true } })
    expect(harness.questions.size).toBe(0)
    expect(desktop.calls()).toBe(1)
  })

  it('user the away phone answers first and the panel answer landing afterwards is ignored', async () => {
    // Given a held offline claim and a phone that came back for it
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declare(returned, 'questions.v1')
    // When that phone answers, and the panel's click lands afterwards
    await returned.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    const cards = questionCards(transport).length
    desktop.answer({ answers: [{ id: 'q-1', selected: ['Beta'] }] })
    await settle()
    // Then the phone's answer is the one the host received, and the late panel
    // answer announced no second card
    expect(questionCards(transport)).toHaveLength(cards)
    expect(harness.questions.size).toBe(0)
  })

  it('user the panel answers an away phone question and the claim is released', async () => {
    // Given a held offline claim
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // When the panel's click lands first
    const fromPanel: QuestionAnswer = { answers: [{ id: 'q-1', selected: ['Beta'] }] }
    desktop.answer(fromPanel)
    // Then the host is answered with that, and a phone that reconnects afterwards
    // finds nothing left to answer
    expect(await pending).toEqual(fromPanel)
    expect(harness.questions.size).toBe(0)
    expect(harness.sink.sent).toHaveLength(1)
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declare(returned, 'questions.v1')
    await settle()
    expect(questionCards(transport)).toEqual([])
  })

  it('operator arms no window for the claim and no claim time releases it', async () => {
    // Given a bridge that already had these timers and a held offline claim
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    const timersBefore = vi.getTimerCount()
    // When the host asks with no phone on the wire
    void harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // Then no window was armed for it: there is nothing to hold on the phone's
    // behalf, because the host's own chain was already offered the question
    expect(vi.getTimerCount()).toBe(timersBefore)
    // And no amount of claim time releases, re-announces or re-delegates it
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(harness.questions.size).toBe(1)
    expect(desktop.calls()).toBe(1)
    expect(releaseLines(harness.logs)).toEqual([])
    expect(harness.sink.sent).toHaveLength(1)
  })

  it('operator the host itself ends the ask and nothing is left scheduled', async () => {
    // Given a held offline claim and the timers this process already had
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const timersBefore = vi.getTimerCount()
    const controller = new AbortController()
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktop.next)
    await settle()
    expect(vi.getTimerCount()).toBe(timersBefore)
    // When the host's own lifetime ends the ask before any phone comes back
    const cancelled = Object.assign(new Error('the ask was cancelled'), { code: 'ASK_CANCELLED' })
    controller.abort(cancelled)
    await expect(pending).rejects.toBe(cancelled)
    // Then the claim is gone and nothing is left scheduled behind it
    expect(harness.questions.size).toBe(0)
    expect(vi.getTimerCount()).toBe(timersBefore)
  })

  it('user a client that cannot receive the card is shown nothing and the claim stays', async () => {
    // Given a held offline claim
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'] })
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // When a client written before the question channel completes its hello
    const transport = new RecordingTransport()
    const legacy = harness.hub.attach(transport, { deviceId: 'dev_legacy' })
    await declare(legacy, 'session.snapshot.trim.v1')
    await settle()
    // Then it was shown no card, and the claim is untouched: it belongs to the
    // phone that was told, not to a socket that cannot draw it
    expect(questionCards(transport)).toEqual([])
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(harness.questions.size).toBe(1)
    expect(desktop.calls()).toBe(1)
    expect(releaseLines(harness.logs)).toEqual([])
    expect(harness.sink.sent).toHaveLength(1)
    // And the panel that holds it is still the one that can end it
    desktop.answer(ANSWER)
    expect(await pending).toEqual(ANSWER)
  })

  it('operator gives the claim up when APNs refuses the only registered token', async () => {
    // Given one registered device whose token APNs will never accept again
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-dead'], answer: () => ({ ok: false, status: 410, reason: 'Unregistered' }) })
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    // When the alert comes back as unregistered
    await settle()
    await untilRegistrations(harness.roster, 0)
    // Then the claim was given up, because no phone is left that could be told
    expect(harness.questions.size).toBe(0)
    expect(releaseLines(harness.logs)).toHaveLength(1)
    // And the panel that was already showing the question settles the agent
    desktop.answer({ answers: [] })
    expect(await pending).toEqual({ answers: [] })
    // And nothing was sent twice
    expect(harness.sink.sent).toHaveLength(1)
  })

  it('operator gives the claim up once when APNs refuses every registered token', async () => {
    // Given two registered devices, both refused with the same final answer
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-a', 'token-b'], answer: () => ({ ok: false, status: 400, reason: 'BadDeviceToken' }) })
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    // When both alerts come back dead
    await settle()
    await untilRegistrations(harness.roster, 0)
    // Then the question reached no phone, the claim was given up once, and the
    // panel that holds it settles the agent
    expect(harness.questions.size).toBe(0)
    expect(releaseLines(harness.logs)).toHaveLength(1)
    desktop.answer({ answers: [] })
    expect(await pending).toEqual({ answers: [] })
    expect(harness.sink.sent).toHaveLength(2)
  })

  it('user on the second phone is still reached when the first token is refused', async () => {
    // Given two registered devices, only the first one dead
    useClaimClock()
    const harness = await offlineHarness({
      tokens: ['token-dead', 'token-live'],
      answer: target => (target.deviceToken === 'token-dead' ? { ok: false, status: 410, reason: 'Unregistered' } : { ok: true, status: 200 }),
    })
    const desktop = desktopCard()
    // When the host asks a question with no phone on the wire
    void harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // Then both were attempted, and the claim is kept because one phone was told
    // and can answer it
    expect(harness.sink.sent.map(alert => alert.target.deviceToken)).toEqual(['token-dead', 'token-live'])
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(desktop.calls()).toBe(1)
    // And only the dead registration left the roster
    await untilRegistrations(harness.roster, 1)
    expect(harness.roster.pushTargets()[0]?.push.deviceToken).toBe('token-live')
  })

  it('operator claims a blocking ask for the away phone too, and the phone answers it', async () => {
    // Given a blocking ask: the host named no call id and declared no deadline
    useClaimClock()
    const harness = await offlineHarness({ tokens: ['token-1'], mintedId: 'minted-1' })
    const desktop = desktopCard()
    // When the host asks it with no phone on the wire
    const pending = harness.hub.question(hostRequest({ wait: undefined }), desktop.next)
    await settle()
    // Then it is claimed under the id this bridge minted, the alert went out, and
    // the panel is holding the same question
    expect(harness.questions.stateOf('bridge:minted-1')).toBe('open')
    expect(desktop.calls()).toBe(1)
    expect(harness.sink.sent).toHaveLength(1)
    // And the phone answers it the ordinary way
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declare(returned, 'questions.v1')
    await returned.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'bridge:minted-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })
})
