import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUESTION_CLAIM_GRACE_MS } from '../src/core/hub.ts'
import { ControllableStream, requestFrame, answerOf, makeBareHub, makeConnection, makeHub, RecordingTransport, settle, type FakeGateway } from './support/harness.ts'
import type { QuestionAnswer, UserQuestionRequestLike } from '../src/core/questions.ts'

/** The host's own foreground deadline, in the shape `askTimed` raises it. */
function hostTimeout(): Error & { code: string } {
  return Object.assign(new Error('ask_user_question timed out before the user answered'), { code: 'ASK_TIMED_OUT' })
}

/** One pending question as the host's waterfall carries it. */
function hostRequest(overrides: Partial<UserQuestionRequestLike> = {}): UserQuestionRequestLike {
  return {
    agent: { id: 's-1' },
    wait: { callId: 'c-1', timed: true },
    questions: [
      {
        id: 'q-1',
        question: 'Which deck?',
        header: 'Deck',
        detail: 'Pick exactly one.',
        options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
        multiSelect: false,
      },
    ],
    ...overrides,
  }
}

/** The answer a phone sends for {@link hostRequest}'s single question. */
const ANSWER: QuestionAnswer = { answers: [{ id: 'q-1', selected: ['Alpha'] }] }

/**
 * The host's own answerer with its panel open and nobody having touched it: in the
 * desktop client this settles when a human clicks. Pending is the honest model,
 * and it is what lets the phone and the desktop race each other.
 */
const desktopWaiting = (): Promise<QuestionAnswer> => new Promise<QuestionAnswer>(() => {})

/**
 * The same answerer with the click the suite decides on.
 *
 * `calls` is how many times the panel was offered the question — the claim is
 * supposed to hand it over exactly once — and `answer` is the click that settles
 * it, whether that lands before or long after the phone's own answer.
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

/** Declare the question capability on one connection. */
async function declareQuestions(connection: { handleText(text: string): Promise<void> }, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: ['questions.v1'] }))
}

/**
 * Route one hub's wait subscriptions to a stream the suite drives.
 *
 * The stream takes the request's cancellation signal exactly as the host does, so
 * aborting the subscription is observable as an ended stream.
 * @param gateway - the hub's gateway double.
 * @param stream - the stream the suite pushes wait frames into.
 */
function followWaitStream(gateway: FakeGateway, stream: ControllableStream): void {
  gateway.follow = (call) => (
    call.method === 'attachWait' ? stream.attach(call.signal).iterable() : new ControllableStream().iterable()
  )
}

/** @returns the payload of every `question.request` frame the carrier took. */
function questionPayloads(transport: RecordingTransport): Record<string, unknown>[] {
  return transport.ofType('ev')
    .filter(frame => frame.m === 'question.request')
    .map(frame => frame.p as Record<string, unknown>)
}

describe('user question bridge', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator runs with no paired device and the question is delegated untouched', async () => {
    // Given a hub whose only connection never paired
    const harness = makeHub({ paired: false })
    let delegated = 0
    const answerer = async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    }
    // When the host asks
    const outcome = await harness.hub.question(hostRequest(), answerer)
    // Then the next answerer decided, nothing was published and nothing is held
    expect(delegated).toBe(1)
    expect(outcome).toEqual({ answers: [] })
    expect(harness.transport.ofType('ev')).toEqual([])
    expect(harness.questions.size).toBe(0)
  })

  it('user of a client that declares the capability receives the whole question batch in contract field names', async () => {
    // Given a paired phone that announced questions.v1
    const harness = makeHub()
    await declareQuestions(harness.connection)
    // When the host asks
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    // The publication waits for the host's own wait subscription, which this
    // host answers with no frame: the payload is the one from before that channel.
    await settle()
    // Then the event carries the frozen payload, and the host's ask is still open
    expect(questionPayloads(harness.transport)).toEqual([
      {
        sessionId: 's-1',
        callId: 'c-1',
        state: 'open',
        questions: [
          {
            id: 'q-1',
            question: 'Which deck?',
            header: 'Deck',
            detail: 'Pick exactly one.',
            options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
            multiSelect: false,
          },
        ],
      },
    ])
    expect(harness.questions.size).toBe(1)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    // When the user answers it, the host's own ask is settled with that batch
    await harness.connection.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf(harness, 2)).toEqual({ ok: true, r: { ok: true } })
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
    // And nothing was sent to the host's Remote surface: the open question IS the ask
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator the panel answers first and the phone is told the question is over', async () => {
    // Given a paired phone that announced the channel, and the panel that was
    // offered the same question the instant the claim existed
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    expect(desktop.calls()).toBe(1)
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open'])
    // When the panel's click lands first
    const fromPanel: QuestionAnswer = { answers: [{ id: 'q-1', selected: ['Beta'] }] }
    desktop.answer(fromPanel)
    // Then that answer is the one the host is answered with
    expect(await pending).toEqual(fromPanel)
    // And the phone's card is over
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open', 'settled'])
    // And the claim is released, so nothing lists it and a tap that arrives late
    // is refused instead of being forwarded a second time
    expect(harness.questions.size).toBe(0)
    expect(harness.questions.listed()).toEqual([])
    await harness.connection.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf(harness, 2).e?.code).toBe('question-unknown')
  })

  it('user the panel chain refusing is not a verdict and the phone still answers', async () => {
    // Given a paired phone and a host whose own answerer chain refuses outright,
    // which is what a host with no panel on the wire raises
    const harness = makeHub()
    await declareQuestions(harness.connection)
    let calls = 0
    const pending = harness.hub.question(hostRequest(), async () => {
      calls += 1
      throw Object.assign(new Error('no user-questions answerer accepted the request'), { code: 'NO_PROVIDER' })
    })
    await settle()
    // Then the claim is untouched: nothing was announced as over and the phone's
    // card is still the one that decides
    expect(calls).toBe(1)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open'])
    // When the phone answers it
    await harness.connection.handleText(requestFrame(4, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then the host receives the phone's answer rather than the chain's refusal
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('user answers a continued question and the host receives the answer method call', async () => {
    // Given a claimed question whose foreground deadline is the host's own
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const timeout = hostTimeout()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    await settle()
    // When the host's deadline elapses
    controller.abort(timeout)
    // Then the host's own reason crosses back into its ask unchanged
    await expect(pending).rejects.toBe(timeout)
    // And the phone is told the question is still answerable, but no longer foreground
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open', 'continued'])
    expect(harness.questions.stateOf('c-1')).toBe('continued')
    // When the user answers the continued question
    harness.gateway.handler = async () => true
    await harness.connection.handleText(requestFrame(3, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then it travelled through the host's Remote answer, exactly as the descriptor declares
    expect(answerOf(harness, 3)).toEqual({ ok: true, r: { ok: true } })
    expect(harness.gateway.lastArgs('userQuestions', 'answer')).toEqual({
      agentId: 's-1',
      callId: 'c-1',
      answer: { answers: ANSWER.answers },
    })
    expect(harness.questions.size).toBe(0)
  })

  it('user answers a continued question and a host failure crosses with the host code', async () => {
    // Given a continued question
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const timeout = hostTimeout()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    controller.abort(timeout)
    await expect(pending).rejects.toBe(timeout)
    // When the host refuses the reply it already queued
    harness.gateway.handler = async () => { throw Object.assign(new Error('a reply is already queued for this question'), { code: 'REPLY_QUEUED' }) }
    await harness.connection.handleText(requestFrame(4, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then the phone sees the host's own code and message rather than a bridge verdict
    expect(answerOf(harness, 4).e).toEqual({ code: 'REPLY_QUEUED', msg: 'a reply is already queued for this question' })
    expect(harness.questions.size).toBe(1)
  })

  it('user answers a continued question the host already forgot and the claim is kept for a retry', async () => {
    // Given a continued question
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const timeout = hostTimeout()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    controller.abort(timeout)
    await expect(pending).rejects.toBe(timeout)
    // When the host answers that it no longer holds the question
    harness.gateway.handler = async () => false
    await harness.connection.handleText(requestFrame(13, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then the phone is told the host has nothing to take, and the claim survives a later try
    expect(answerOf(harness, 13).e?.code).toBe('question-unknown')
    expect(harness.questions.stateOf('c-1')).toBe('continued')
    harness.gateway.handler = async () => true
    await harness.connection.handleText(requestFrame(14, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf(harness, 14)).toEqual({ ok: true, r: { ok: true } })
    expect(harness.questions.size).toBe(0)
  })

  it('operator unloads the bridge and every held question is delegated', async () => {
    // Given two claimed questions whose panels have not answered them
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const firstPanel = desktopCard()
    const secondPanel = desktopCard()
    const first = harness.hub.question(hostRequest(), firstPanel.next)
    const second = harness.hub.question(hostRequest({ wait: { callId: 'c-2', timed: true } }), secondPanel.next)
    await settle()
    expect(harness.questions.size).toBe(2)
    // When the plugin is torn down
    harness.hub.dispose()
    // Then both were handed back to the chains that were already holding them
    expect(harness.questions.size).toBe(0)
    firstPanel.answer({ answers: [{ id: 'q-1', selected: [] }] })
    secondPanel.answer({ answers: [{ id: 'q-1', selected: [] }] })
    expect(await first).toEqual({ answers: [{ id: 'q-1', selected: [] }] })
    expect(await second).toEqual({ answers: [{ id: 'q-1', selected: [] }] })
  })

  it('user answers a call this bridge never claimed and is refused as unknown', async () => {
    // Given a paired phone that announced the capability
    const harness = makeConnection({ paired: true })
    await declareQuestions(harness.connection)
    // When it answers a call id no bridge claim carries
    await harness.connection.handleText(requestFrame(5, 'question.answer', { sessionId: 's-1', callId: 'c-nope', answers: ANSWER.answers }))
    // Then the refusal is unknown and nothing reached the host
    expect(answerOf(harness, 5).e?.code).toBe('question-unknown')
    expect(harness.gateway.invocations).toEqual([])
  })

  it('user answers a claimed call from another session and is refused as unknown', async () => {
    // Given one claimed question on session s-1
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    // When the phone names a different session for that call id
    await harness.connection.handleText(requestFrame(6, 'question.answer', { sessionId: 's-2', callId: 'c-1', answers: ANSWER.answers }))
    // Then the claim is not handed to whoever names it
    expect(answerOf(harness, 6).e?.code).toBe('question-unknown')
    expect(harness.questions.size).toBe(1)
    // And the real session can still answer it
    await harness.connection.handleText(requestFrame(7, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('user answers twice and the second answer is refused as unknown', async () => {
    // Given a question already answered
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await harness.connection.handleText(requestFrame(8, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // When the same call is answered again
    await harness.connection.handleText(requestFrame(9, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then the stale answer is refused and the first one stands
    expect(answerOf(harness, 9).e?.code).toBe('question-unknown')
    expect(await pending).toEqual(ANSWER)
  })

  it('user sends an answer batch of the wrong shape and is refused with the argument names', async () => {
    // Given a paired phone that announced the capability
    const harness = makeConnection({ paired: true })
    await declareQuestions(harness.connection)
    // When the batch is not a list of {id, selected[]}
    await harness.connection.handleText(requestFrame(10, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: [{ id: 'q-1', selected: 'Alpha' }] }))
    await harness.connection.handleText(requestFrame(11, 'question.answer', { sessionId: 's-1', callId: 'c-1' }))
    // Then both are refused by the argument contract, not as unknown questions
    expect(answerOf(harness, 10).e?.code).toBe('invalid-args')
    expect(answerOf(harness, 11).e?.code).toBe('invalid-args')
    expect(harness.questions.size).toBe(0)
  })

  it('operator a phone that reconnects is handed the question it missed', async () => {
    // Given a question already waiting, which the phone saw once
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    const before = questionPayloads(harness.transport).length
    // When that phone declares the channel again after reconnecting
    await declareQuestions(harness.connection, 9)
    // Then it is shown the live question again, under the same call id
    const replayed = questionPayloads(harness.transport).slice(before)
    expect(replayed.map(payload => payload.callId)).toEqual(['c-1'])
    expect(replayed[0]?.state).toBe('open')
    // And the host is still waiting, not answered by the replay
    await harness.connection.handleText(requestFrame(10, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('user of a client written before the channel sees no event and its answer is an unknown method', async () => {
    // Given a paired phone that never declared the capability
    const harness = makeHub()
    let delegated = 0
    const answerer = async (): Promise<QuestionAnswer> => {
      delegated += 1
      return { answers: [] }
    }
    // When the host asks
    const outcome = await harness.hub.question(hostRequest(), answerer)
    // Then nothing was published, nothing is held, and the next answerer decided
    expect(harness.transport.ofType('ev')).toEqual([])
    expect(harness.questions.size).toBe(0)
    expect(delegated).toBe(1)
    expect(outcome).toEqual({ answers: [] })
    // And the method it does not know is still an unknown method, as before
    await harness.connection.handleText(requestFrame(12, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf(harness, 12).e).toEqual({ code: 'unknown-method', msg: 'unknown method question.answer' })
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator keeps one legacy phone on the wire while another declares the channel', async () => {
    // Given two paired phones, only one of which declared questions.v1
    const bare = makeBareHub()
    const declared = new RecordingTransport()
    const legacy = new RecordingTransport()
    const declaring = bare.hub.attach(declared, { deviceId: 'dev_declared' })
    const legacyConnection = bare.hub.attach(legacy, { deviceId: 'dev_legacy' })
    await declareQuestions(declaring)
    await legacyConnection.handleText(requestFrame(1, 'hello', { proto: 1 }))
    // When the host asks
    const pending = bare.hub.question(hostRequest(), desktopWaiting)
    await settle()
    // Then exactly the declaring phone was shown the question
    expect(questionPayloads(declared)).toHaveLength(1)
    expect(legacy.ofType('ev')).toEqual([])
    // And that phone's answer settled it
    await declaring.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('operator a phone answers no question and the bridge holds it until the host decides', async () => {
    // Given a claimed question nobody answers
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const timeout = hostTimeout()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    // When the host's own deadline elapses without any client timer of ours involved
    controller.abort(timeout)
    // Then the ask was released by the host's reason alone and the claim is still answerable
    await expect(pending).rejects.toBe(timeout)
    expect(harness.questions.stateOf('c-1')).toBe('continued')
  })

  it('operator cancels the agent turn and the claim is dropped instead of kept answerable', async () => {
    // Given a claimed question whose turn is cancelled
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const cancelled = Object.assign(new Error('the turn was cancelled'), { code: 'ASK_ABORTED' })
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    // When the turn's own lifetime ends
    controller.abort(cancelled)
    // Then the ask crosses back verbatim and nothing stays answerable
    await expect(pending).rejects.toBe(cancelled)
    expect(harness.questions.size).toBe(0)
    // And no card was published: the host ended the ask before its first wait frame,
    // so a card reaching the phone is one the bridge could no longer retract
    expect(questionPayloads(harness.transport)).toEqual([])
  })

  it('operator loses the last phone and the claimed question is delegated when the window ends', async () => {
    // Given a claimed question on a hub whose only phone is about to go away
    // Only the timeout pair is faked: the heartbeat interval stays real, so the
    // minute of claim time below never pings a phone that is not there.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = makeHub()
    await declareQuestions(harness.connection)
    // The panel holds the same card and nobody has clicked it: this case is about
    // the hand-back, not about which surface answers first.
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // When the connection closes, and the grace window it leaves behind runs out
    harness.hub.detach(harness.connection)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    // Then the question went back to that panel rather than being refused or left
    // hanging, and its answer is the one the agent receives
    expect(harness.questions.size).toBe(0)
    expect(harness.logs).toContain('1 user question(s) released: no paired device is connected')
    desktop.answer({ answers: [] })
    expect(await pending).toEqual({ answers: [] })
  })

  it('user answers a blocking ask and the phone was given a bridge-minted call id', async () => {
    // Given a blocking ask — the ask_user_question schema without a timeout, which
    // carries no wait and therefore no host call id at all
    const harness = makeHub({ questionIds: () => 'minted-1' })
    await declareQuestions(harness.connection)
    // When the host asks
    const pending = harness.hub.question(hostRequest({ wait: undefined }), desktopWaiting)
    await settle()
    // Then the phone is still shown the question, named by an id in the bridge's own namespace
    const payload = questionPayloads(harness.transport)[0]
    expect(payload).toMatchObject({ sessionId: 's-1', callId: 'bridge:minted-1', state: 'open' })
    expect(payload?.expiresAt).toBeUndefined()
    expect((payload!.questions as unknown[]).length).toBe(1)
    expect(harness.questions.stateOf('bridge:minted-1')).toBe('open')
    // When the user answers with that handle, the host's own ask is settled with it
    await harness.connection.handleText(requestFrame(20, 'question.answer', { sessionId: 's-1', callId: 'bridge:minted-1', answers: ANSWER.answers }))
    expect(answerOf(harness, 20)).toEqual({ ok: true, r: { ok: true } })
    expect(await pending).toEqual(ANSWER)
    // And a blocking question never needs the host's late-answer path
    expect(harness.gateway.invocations).toEqual([])
    expect(harness.questions.size).toBe(0)
  })

  it('user answers a minted call this bridge never issued and is refused as unknown', async () => {
    // Given a paired phone that announced the capability
    const harness = makeConnection({ paired: true, questionIds: () => 'minted-2' })
    await declareQuestions(harness.connection)
    // When it answers a bridge-looking id no claim ever carried
    await harness.connection.handleText(requestFrame(21, 'question.answer', { sessionId: 's-1', callId: 'bridge:minted-2', answers: ANSWER.answers }))
    // Then the prefix buys no trust: an id this bridge did not hold is unknown
    expect(answerOf(harness, 21).e?.code).toBe('question-unknown')
    expect(harness.gateway.invocations).toEqual([])
  })

  it('operator runs with no paired device and a blocking question is still delegated', async () => {
    // Given a hub whose only connection never paired
    const harness = makeHub({ paired: false, questionIds: () => 'minted-3' })
    let delegated = 0
    // When a blocking ask arrives
    const outcome = await harness.hub.question(hostRequest({ wait: undefined }), async () => {
      delegated += 1
      return { answers: [] }
    })
    // Then it is still the next answerer's, and no minted id was ever published
    expect(delegated).toBe(1)
    expect(outcome).toEqual({ answers: [] })
    expect(harness.transport.ofType('ev')).toEqual([])
    expect(harness.questions.size).toBe(0)
  })

  it('operator a minted id and a host call id never stand in for each other', async () => {
    // Given one blocking ask and one timed ask held at the same time
    const harness = makeHub({ questionIds: () => 'minted-4' })
    await declareQuestions(harness.connection)
    const blocking = harness.hub.question(hostRequest({ wait: undefined }), desktopWaiting)
    const timed = harness.hub.question(hostRequest(), desktopWaiting)
    // When the minted handle is answered
    await harness.connection.handleText(requestFrame(22, 'question.answer', { sessionId: 's-1', callId: 'bridge:minted-4', answers: ANSWER.answers }))
    // Then only the blocking ask settled, and the timed one is still open on its own id
    expect(await blocking).toEqual(ANSWER)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    // When the host call id is answered
    await harness.connection.handleText(requestFrame(23, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    // Then only the timed ask settled
    expect(await timed).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('operator a host ask that names no agent is never claimed', async () => {
    // Given a request with no agent, and so no session for the payload
    const harness = makeHub()
    await declareQuestions(harness.connection)
    let delegated = 0
    // When it arrives
    const outcome = await harness.hub.question(hostRequest({ agent: undefined }), async () => {
      delegated += 1
      return { answers: [] }
    })
    // Then it belongs to the next answerer and nothing was published or held
    expect(delegated).toBe(1)
    expect(outcome).toEqual({ answers: [] })
    expect(harness.questions.size).toBe(0)
    expect(harness.transport.ofType('ev')).toEqual([])
  })

  it('user the phone answers first and the panel answer that arrives afterwards is ignored', async () => {
    // Given a paired phone that announced the channel, and the panel holding the
    // same question
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // The panel was offered the question the instant the claim existed
    expect(desktop.calls()).toBe(1)
    // When the phone answers it, and the panel's click lands afterwards
    await harness.connection.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
    const cards = questionPayloads(harness.transport).length
    desktop.answer({ answers: [{ id: 'q-1', selected: ['Beta'] }] })
    await settle()
    // Then the phone's answer is the one the host received: the late panel answer
    // settled nothing a second time and announced no second card
    expect(questionPayloads(harness.transport)).toHaveLength(cards)
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open'])
  })

  it('operator the phone goes away and the claim is handed back with a settled notice', async () => {
    // Given a claimed question on a hub whose only phone is about to leave
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const pending = harness.hub.question(hostRequest(), async () => ANSWER)
    // When the last phone goes away
    harness.hub.detach(harness.connection)
    // Then the host's own answerer takes over
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('user a timed question carries the absolute deadline the host wait reported', async () => {
    // Given a paired phone and a host whose own wait reports four seconds left
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    // When that first frame arrives
    waitStream.push({ remainingMs: 4000 })
    await settle()
    // Then the subscription spoke for the bridge's own peer, carried exactly the
    // declared arguments, and could be cancelled through the request's signal
    const waitCall = harness.gateway.streamRequests[0]
    expect(waitCall?.args).toEqual({ agentId: 's-1', callId: 'c-1' })
    expect(waitCall?.peer).toBe(harness.ownerPeer)
    expect(waitCall?.signal).toBeInstanceOf(AbortSignal)
    // And the one card the phone received carries the host's absolute deadline
    const payloads = questionPayloads(harness.transport)
    expect(payloads).toHaveLength(1)
    expect(payloads[0]).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open', expiresAt: 1_004_000 })
    // And the question is answerable exactly as before
    await harness.connection.handleText(requestFrame(30, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('user a blocking question carries no deadline and the host is never asked for one', async () => {
    // Given a blocking ask, which the host gives no wait at all
    const harness = makeHub({ questionIds: () => 'minted-5' })
    await declareQuestions(harness.connection)
    // When the host asks
    const pending = harness.hub.question(hostRequest({ wait: undefined }), desktopWaiting)
    await settle()
    // Then no wait subscription was opened, and the payload has no such key at all
    expect(harness.gateway.streamRequests).toEqual([])
    const payload = questionPayloads(harness.transport)[0]
    expect(payload).toMatchObject({ sessionId: 's-1', callId: 'bridge:minted-5', state: 'open' })
    expect(payload).not.toHaveProperty('expiresAt')
    expect(harness.questions.listed()).toEqual([{
      key: 's-1/bridge:minted-5',
      sessionId: 's-1',
      state: 'open',
      payload: { sessionId: 's-1', callId: 'bridge:minted-5', state: 'open', questions: expect.any(Array) },
    }])
    // And it stays answerable with the minted handle
    await harness.connection.handleText(requestFrame(31, 'question.answer', { sessionId: 's-1', callId: 'bridge:minted-5', answers: ANSWER.answers }))
    expect(answerOf(harness, 31)).toEqual({ ok: true, r: { ok: true } })
    expect(await pending).toEqual(ANSWER)
  })

  it('operator the phone answers a timed question and its wait subscription is closed', async () => {
    // Given a timed question whose deadline the host reported
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    waitStream.push({ remainingMs: 4000 })
    await settle()
    const before = questionPayloads(harness.transport).length
    // When the phone answers it
    await harness.connection.handleText(requestFrame(32, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    // Then the subscription was cancelled with the claim
    expect(waitStream.aborted).toBe(true)
    // And a frame that arrives afterwards reaches no phone, because nobody reads it
    waitStream.push({ remainingMs: 100 })
    await settle()
    expect(questionPayloads(harness.transport)).toHaveLength(before)
  })

  it('operator the claim is withdrawn and its wait subscription stops with it', async () => {
    // Given a timed question whose deadline the host reported
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const desktop = desktopCard()
    const pending = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    waitStream.push({ remainingMs: 4000 })
    await settle()
    // When the bridge unloads and the claim is handed back at once
    harness.hub.dispose()
    desktop.answer(ANSWER)
    expect(await pending).toEqual(ANSWER)
    // The phone is already gone, so nothing can carry the settled notice to it
    const afterWithdraw = questionPayloads(harness.transport)
    expect(afterWithdraw.map(payload => payload.state)).toEqual(['open'])
    // Then the subscription stopped with the claim
    expect(waitStream.aborted).toBe(true)
    // And no later frame is published to anyone
    waitStream.push({ remainingMs: 200 })
    await settle()
    expect(questionPayloads(harness.transport)).toHaveLength(afterWithdraw.length)
  })

  it('operator the host moves its deadline and the phone is told at most once a second', async () => {
    // Given a timed question whose deadline the host reported at t = 1_000_000
    let clock = 1_000_000
    const harness = makeHub({ questionNow: () => clock })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    waitStream.push({ remainingMs: 4000 })
    await settle()
    // When a frame arrives well inside the minimum interval it is dropped
    clock = 1_000_400
    waitStream.push({ remainingMs: 3600 })
    await settle()
    // Then the card the phone already holds is left untouched
    expect(questionPayloads(harness.transport)).toHaveLength(1)
    // And a frame after the interval updates the card the phone already holds
    clock = 1_001_500
    waitStream.push({ remainingMs: 2000 })
    await settle()
    const payloads = questionPayloads(harness.transport)
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open', expiresAt: 1_003_500 })
    // And the claim is still the one the phone answers
    await harness.connection.handleText(requestFrame(33, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('user a wait subscription that ends without a frame leaves the question published without a deadline', async () => {
    // Given a host whose wait subscription ends before saying anything
    const harness = makeHub()
    await declareQuestions(harness.connection)
    // When the host asks
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    // Then the question is published exactly as it was before this channel, and answerable
    const payload = questionPayloads(harness.transport)[0]
    expect(payload).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open' })
    expect(payload).not.toHaveProperty('expiresAt')
    await harness.connection.handleText(requestFrame(34, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('user a wait subscription that fails leaves the question published without a deadline', async () => {
    // Given a host whose wait service refuses the subscription outright
    const harness = makeHub()
    await declareQuestions(harness.connection)
    harness.gateway.follow = (call) => {
      if (call.method !== 'attachWait') return new ControllableStream().iterable()
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(Object.assign(new Error('no wait service'), { code: 'SERVICE_UNAVAILABLE' })),
        }),
      }
    }
    // When the host asks
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    // Then the failure is only a log line, never a verdict on the question
    expect(harness.logs.some(entry => entry.includes('userQuestions/attachWait failed'))).toBe(true)
    const payload = questionPayloads(harness.transport)[0]
    expect(payload).toMatchObject({ state: 'open' })
    expect(payload).not.toHaveProperty('expiresAt')
    // And the phone can still answer it
    await harness.connection.handleText(requestFrame(35, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    expect(harness.questions.size).toBe(0)
  })

  it('operator the host deadline arrives and the bridge lets go so the host can time the ask out', async () => {
    // Given a timed question whose deadline the host reported as four seconds away
    vi.useFakeTimers()
    let clock = 1_000_000
    const harness = makeHub({ questionNow: () => clock })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const controller = new AbortController()
    const timeout = hostTimeout()
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    await settle()
    waitStream.push({ remainingMs: 4000 })
    await settle()
    expect(questionPayloads(harness.transport)[0]?.expiresAt).toBe(1_004_000)
    // When that deadline arrives with nobody having answered
    clock = 1_004_000
    await vi.advanceTimersByTimeAsync(4000)
    // Then the bridge released the host's wait, whose own timer only resumes once nobody holds it
    expect(waitStream.aborted).toBe(true)
    // And the host's own ASK_TIMED_OUT still turns the claim continued, as it did before
    controller.abort(timeout)
    await expect(pending).rejects.toBe(timeout)
    expect(harness.questions.stateOf('c-1')).toBe('continued')
    expect(questionPayloads(harness.transport).map(payload => payload.state)).toEqual(['open', 'continued'])
  })

  it('operator a phone that reconnects is handed the deadline the question already carries', async () => {
    // Given a timed question whose deadline the host reported
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    waitStream.push({ remainingMs: 4000 })
    await settle()
    const before = questionPayloads(harness.transport).length
    // When that phone declares the channel again after reconnecting
    await declareQuestions(harness.connection, 9)
    // Then the replayed card carries the same host deadline, under the same call id
    const replayed = questionPayloads(harness.transport).slice(before)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open', expiresAt: 1_004_000 })
    // And the host is still waiting, not answered by the replay
    await harness.connection.handleText(requestFrame(36, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('operator the host abandons the ask before its first wait frame and no card is ever published', async () => {
    // Given a timed question whose wait subscription has reported nothing yet
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    const waitStream = new ControllableStream()
    followWaitStream(harness.gateway, waitStream)
    const controller = new AbortController()
    const cancelled = Object.assign(new Error('the turn was cancelled'), { code: 'ASK_ABORTED' })
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    await settle()
    // When the host's own lifetime ends before any frame arrives
    controller.abort(cancelled)
    // Then its reason crosses back unchanged
    await expect(pending).rejects.toBe(cancelled)
    // And no card reached the phone, because a claim nobody can retract is worse
    // than no card at all
    expect(questionPayloads(harness.transport)).toEqual([])
    // And the subscription went with the claim
    expect(waitStream.aborted).toBe(true)
    expect(harness.questions.size).toBe(0)
  })

  it('operator the bridge releases the wait itself and that release is not logged as a failure', async () => {
    // Given a wait subscription whose reads fail once cancelled, which is what the
    // gateway's own cancellable stream reports for an aborted Remote call
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestions(harness.connection)
    harness.gateway.follow = (call) => {
      const signal = call.signal
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Remote invocation "userQuestions/attachWait" was aborted'), { code: 'gateway/cancelled' }))
            }, { once: true })
          }),
        }),
      }
    }
    // When the phone answers an ask the host never reported a wait for
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    await harness.connection.handleText(requestFrame(37, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
    await settle()
    // Then releasing the subscription on purpose was not reported as a fault
    expect(harness.logs.filter(entry => entry.includes('attachWait'))).toEqual([])
  })
})

/** Declare the question channel AND the list capability on one connection. */
async function declareQuestionList(connection: { handleText(text: string): Promise<void> }, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: ['questions.v1', 'questions.list.v1'] }))
}

/**
 * Route one hub's wait subscriptions to a stream per call, so a suite can drive
 * each question's deadline on its own.
 * @param gateway - the hub's gateway double.
 * @returns the streams, in the order the subscriptions opened.
 */
function followWaitStreams(gateway: FakeGateway): ControllableStream[] {
  const streams: ControllableStream[] = []
  gateway.follow = (call) => {
    if (call.method !== 'attachWait') return new ControllableStream().iterable()
    const stream = new ControllableStream()
    streams.push(stream)
    return stream.attach(call.signal).iterable()
  }
  return streams
}

describe('held question list', () => {
  afterEach(() => { vi.useRealTimers() })

  it('user of a phone that reconnects reads back every question the bridge still holds', async () => {
    // Given a bridge holding one open question with a published deadline and one
    // whose foreground wait the host already ended
    const harness = makeHub({ questionNow: () => 1_000_000 })
    await declareQuestionList(harness.connection)
    const waits = followWaitStreams(harness.gateway)
    harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    waits[0]?.push({ remainingMs: 4000 })
    await settle()
    const controller = new AbortController()
    const timeout = hostTimeout()
    const continued = harness.hub.question(hostRequest({ wait: { callId: 'c-2', timed: true }, signal: controller.signal }), desktopWaiting)
    await settle()
    controller.abort(timeout)
    await expect(continued).rejects.toBe(timeout)
    // When that phone asks what is still held
    await harness.connection.handleText(requestFrame(40, 'question.list', {}))
    // Then the answer is the whole set, marked complete, keyed the way the phone
    // keys its own cards
    const answer = answerOf(harness, 40).r as { questions: Array<Record<string, unknown>>; complete: boolean }
    expect(answer.complete).toBe(true)
    expect(answer.questions.map(row => row.key)).toEqual(['s-1/c-1', 's-1/c-2'])
    expect(answer.questions.map(row => row.sessionId)).toEqual(['s-1', 's-1'])
    expect(answer.questions.map(row => row.state)).toEqual(['open', 'continued'])
    // And each row repeats the question.request payload verbatim — the card the
    // phone was handed and the row it reads back are one shape, deadline included
    expect(answer.questions[0]?.payload).toEqual(questionPayloads(harness.transport)[0])
    expect(answer.questions[0]?.payload).toMatchObject({ callId: 'c-1', state: 'open', expiresAt: 1_004_000 })
    expect(answer.questions[1]?.payload).toMatchObject({ callId: 'c-2', state: 'continued' })
    expect(answer.questions[1]?.payload).not.toHaveProperty('expiresAt')
  })

  it('user whose phone was away when the last device left finds nothing left to answer', async () => {
    // Given a question the bridge holds for the only paired phone
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const harness = makeHub()
    await declareQuestionList(harness.connection)
    harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    expect(harness.questions.size).toBe(1)
    // When that phone goes away and the window kept for it runs out, which
    // delegates the question to the next answerer
    harness.hub.detach(harness.connection)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    expect(harness.questions.size).toBe(0)
    // Then the phone that comes back is told the set is empty, not handed a ghost
    const transport = new RecordingTransport()
    const reconnected = harness.hub.attach(transport, { deviceId: 'dev_back' })
    await declareQuestionList(reconnected, 1)
    await reconnected.handleText(requestFrame(2, 'question.list', {}))
    expect(answerOf({ transport }, 2)).toEqual({ ok: true, r: { questions: [], complete: true } })
  })

  it('user of a client that never declared the list capability is told the method does not exist', async () => {
    // Given a paired phone that declared the question channel only, as every
    // client written before the list existed does
    const harness = makeHub()
    await declareQuestions(harness.connection)
    harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    // When it asks for the list anyway
    await harness.connection.handleText(requestFrame(41, 'question.list', {}))
    // Then the method is not part of its protocol and no claim registry was read
    expect(answerOf(harness, 41).e).toEqual({ code: 'unknown-method', msg: 'unknown method question.list' })
    expect(harness.gateway.invocations).toEqual([])
    // And the one card it does receive is the payload it always received
    expect(questionPayloads(harness.transport)).toEqual([
      {
        sessionId: 's-1',
        callId: 'c-1',
        state: 'open',
        questions: [
          {
            id: 'q-1',
            question: 'Which deck?',
            header: 'Deck',
            detail: 'Pick exactly one.',
            options: [{ label: 'Alpha', description: 'the first' }, { label: 'Beta' }],
            multiSelect: false,
          },
        ],
      },
    ])
  })

  it('operator sees the list leave the held question, its deadline and the host untouched', async () => {
    // Given one claimed question and its wait subscription
    const harness = makeHub()
    await declareQuestionList(harness.connection)
    const pending = harness.hub.question(hostRequest(), desktopWaiting)
    await settle()
    const cards = questionPayloads(harness.transport).length
    const calls = harness.gateway.invocations.length
    const streams = harness.gateway.streamRequests.length
    // When the phone reads the list twice
    await harness.connection.handleText(requestFrame(50, 'question.list', {}))
    await harness.connection.handleText(requestFrame(51, 'question.list', {}))
    // Then the question is still held, still open, and nothing was published,
    // asked of the host or re-subscribed
    expect(harness.questions.size).toBe(1)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(questionPayloads(harness.transport)).toHaveLength(cards)
    expect(harness.gateway.invocations).toHaveLength(calls)
    expect(harness.gateway.streamRequests).toHaveLength(streams)
    // And it is still answerable afterwards
    await harness.connection.handleText(requestFrame(52, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(await pending).toEqual(ANSWER)
  })

  it('user sends a list request that names a session and is refused by the argument contract', async () => {
    // Given a paired phone that declared both names
    const harness = makeHub()
    await declareQuestionList(harness.connection)
    // When it scopes the list to one session, which the global set does not take
    await harness.connection.handleText(requestFrame(53, 'question.list', { sessionId: 's-1' }))
    // Then the argument contract refuses it instead of silently ignoring the scope
    expect(answerOf(harness, 53).e?.code).toBe('invalid-args')
  })

})

