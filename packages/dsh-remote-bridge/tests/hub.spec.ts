import { afterEach, describe, expect, it, vi } from 'vitest'
import { QUESTION_CLAIM_GRACE_MS, type ApprovalRequestLike } from '../src/core/hub.ts'
import type { QuestionAnswer, UserQuestionRequestLike } from '../src/core/questions.ts'
import { answerOf, makeHub, RecordingTransport, requestFrame, settle } from './support/harness.ts'

/**
 * Install the one timer kind this suite moves.
 *
 * Only the timeout pair is faked: the connection heartbeat is an interval and
 * stays real, so a minute of claim time passes without a phone that is not there
 * owing a pong, and `Date.now()` keeps running where the claim bookkeeping reads
 * it. `clearTimeout` has to be faked beside `setTimeout`, or a cancelled window
 * stays on the fake clock and fires anyway.
 */
function useClaimClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

/** One pending question as the host's waterfall carries it. */
function hostRequest(overrides: Partial<UserQuestionRequestLike> = {}): UserQuestionRequestLike {
  return {
    agent: { id: 's-1' },
    wait: { callId: 'c-1', timed: true },
    questions: [{ id: 'q-1', question: 'Which deck?', header: 'Deck', options: [{ label: 'Alpha' }, { label: 'Beta' }] }],
    ...overrides,
  }
}

/** One pending approval as the host carries it. */
function hostApproval(): ApprovalRequestLike {
  return { agent: { id: 's-1' }, toolName: 'bash', displayReason: { en: 'run a command' } }
}

/** The answer a phone sends for {@link hostRequest}'s single question. */
const ANSWER: QuestionAnswer = { answers: [{ id: 'q-1', selected: ['Alpha'] }] }

/** The host's own answerer with its panel open: in the desktop client this settles on a click. */
const desktopWaiting = (): Promise<QuestionAnswer> => new Promise<QuestionAnswer>(() => {})

/**
 * The host's own answerer as the panel shows it: a card that answers on a click.
 *
 * The panel is offered the same question at claim time, so most cases below have
 * two answerers. `calls` is how many times the panel was handed the question — one
 * card, shown once — and `answer` is the click that settles it.
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

/** Declare the question channel on one connection. */
async function declareQuestions(connection: { handleText(text: string): Promise<void> }, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: ['questions.v1'] }))
}

/** Declare the question channel AND the list capability on one connection. */
async function declareQuestionList(connection: { handleText(text: string): Promise<void> }, id = 1): Promise<void> {
  await connection.handleText(requestFrame(id, 'hello', { proto: 1, cap: ['questions.v1', 'questions.list.v1'] }))
}

/** @returns the payload of every `question.request` frame the carrier took. */
function questionPayloads(transport: RecordingTransport): Record<string, unknown>[] {
  return transport.ofType('ev').filter(frame => frame.m === 'question.request').map(frame => frame.p as Record<string, unknown>)
}

/** @returns how many times a question was logged as released to the next answerer. */
function releaseLines(logs: readonly string[]): string[] {
  return logs.filter(line => line.includes('user question(s) released'))
}

describe('question claim grace window', () => {
  afterEach(() => { vi.useRealTimers() })

  it('operator the last phone leaves and the held question is still listed and replayed', async () => {
    useClaimClock()
    // Given a claimed question and the only paired phone going away
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    harness.hub.question(hostRequest(), desktop.next)
    await settle()
    // When it goes away
    harness.hub.detach(harness.connection)
    await settle()
    // Then nothing was withdrawn: the claim is still held and still open, and the
    // panel that was offered the same question has not answered it
    expect(harness.questions.size).toBe(1)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(desktop.calls()).toBe(1)
    expect(releaseLines(harness.logs)).toEqual([])
    // And a phone that declares on that hub afterwards is handed the claim again,
    // the way the original broadcast handed it to the phones that were there
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declareQuestionList(returned)
    const replayed = questionPayloads(transport)
    expect(replayed).toHaveLength(1)
    expect(replayed[0]).toMatchObject({ sessionId: 's-1', callId: 'c-1', state: 'open' })
    // And a list read answers the same claim, because it is genuinely still held
    await returned.handleText(requestFrame(2, 'question.list', {}))
    const list = answerOf({ transport }, 2).r as { questions: Array<{ key: string; state: string }>; complete: boolean }
    expect(list.complete).toBe(true)
    expect(list.questions.map(row => row.key)).toEqual(['s-1/c-1'])
    expect(list.questions.map(row => row.state)).toEqual(['open'])
  })

  it('user of a phone that comes back inside the window keeps the claim past it', async () => {
    useClaimClock()
    // Given a claim whose phone left, and the same phone returning half-way
    // through the window
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    harness.hub.question(hostRequest(), desktop.next)
    await settle()
    const timersBefore = vi.getTimerCount()
    harness.hub.detach(harness.connection)
    // The departure armed exactly one timer for the whole claim table
    expect(vi.getTimerCount()).toBe(timersBefore + 1)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS / 2)
    const transport = new RecordingTransport()
    const returned = harness.hub.attach(transport, { deviceId: 'dev_returned' })
    await declareQuestions(returned)
    // The attach cancelled it instead of leaving it to fire
    expect(vi.getTimerCount()).toBe(timersBefore)
    // When the instant the window would have ended passes, twice over
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS * 2)
    // Then the claim is still held: the release was cancelled, not postponed, and
    // the panel that was offered the question has not answered it
    expect(harness.questions.size).toBe(1)
    expect(harness.questions.stateOf('c-1')).toBe('open')
    expect(desktop.calls()).toBe(1)
    expect(releaseLines(harness.logs)).toEqual([])
    // And it is still the phone's to answer
    await returned.handleText(requestFrame(2, 'question.answer', { sessionId: 's-1', callId: 'c-1', answers: ANSWER.answers }))
    expect(answerOf({ transport }, 2)).toEqual({ ok: true, r: { ok: true } })
  })

  it('operator the window expires and the claim is released exactly once', async () => {
    useClaimClock()
    // Given a claimed question whose phone left with the window running
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    const released = harness.hub.question(hostRequest(), desktop.next)
    await settle()
    const timersBefore = vi.getTimerCount()
    harness.hub.detach(harness.connection)
    expect(vi.getTimerCount()).toBe(timersBefore + 1)
    // When the window runs out
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    // Then the question went back to the host's own answerer chain, which was
    // already showing it, and that chain's answer is what the agent receives
    expect(harness.questions.size).toBe(0)
    expect(releaseLines(harness.logs)).toHaveLength(1)
    desktop.answer({ answers: [] })
    expect(await released).toEqual({ answers: [] })
    expect(desktop.calls()).toBe(1)
    // And the timer that did it is gone, so a second window changes nothing
    expect(vi.getTimerCount()).toBe(timersBefore)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS)
    expect(releaseLines(harness.logs)).toHaveLength(1)
  })

  it('operator the bridge unloads and releases at once with no window left behind', async () => {
    useClaimClock()
    // Given a blocking claim whose phone left with the window running
    const harness = makeHub({ questionIds: () => 'minted-1' })
    await declareQuestions(harness.connection)
    const desktop = desktopCard()
    const held = harness.hub.question(hostRequest({ wait: undefined }), desktop.next)
    await settle()
    const timersBefore = vi.getTimerCount()
    harness.hub.detach(harness.connection)
    expect(vi.getTimerCount()).toBe(timersBefore + 1)
    // When the bridge unloads rather than waiting the window out
    harness.hub.dispose()
    // Then the claim was released on the spot, not deferred to the window, and
    // the chain that was already offered the question settles the agent
    expect(harness.questions.size).toBe(0)
    desktop.answer({ answers: [] })
    expect(await held).toEqual({ answers: [] })
    expect(desktop.calls()).toBe(1)
    // And nothing was left scheduled that could release it a second time
    expect(vi.getTimerCount()).toBe(timersBefore)
    await vi.advanceTimersByTimeAsync(QUESTION_CLAIM_GRACE_MS * 2)
    expect(desktop.calls()).toBe(1)
  })

  it('user a continued claim is replayed as continued', async () => {
    useClaimClock()
    // Given a claim whose foreground wait the host already ended
    const harness = makeHub()
    await declareQuestions(harness.connection)
    const controller = new AbortController()
    const timeout = Object.assign(new Error('ask_user_question timed out before the user answered'), { code: 'ASK_TIMED_OUT' })
    const pending = harness.hub.question(hostRequest({ signal: controller.signal }), desktopWaiting)
    await settle()
    controller.abort(timeout)
    await expect(pending).rejects.toBe(timeout)
    expect(harness.questions.stateOf('c-1')).toBe('continued')
    // When a phone declares the channel afterwards
    const transport = new RecordingTransport()
    await declareQuestions(harness.hub.attach(transport, { deviceId: 'dev_returned' }))
    // Then the replayed card carries the claim's own state, not the `open` one
    // every claim used to be replayed as
    expect(questionPayloads(transport).map(payload => payload.state)).toEqual(['continued'])
  })

  it('operator an approval is still abandoned the instant the last phone leaves', async () => {
    useClaimClock()
    // Given an approval question claimed for the only paired phone
    const harness = makeHub()
    const pending = harness.hub.approve(hostApproval(), async () => 'unavailable' as const)
    // When that phone goes away
    harness.hub.detach(harness.connection)
    // Then the fail-closed answerer decided at once, without a window to wait
    expect(await pending).toBe('unavailable')
    expect(harness.approvals.openPrompts()).toEqual([])
    expect(harness.logs).toContain('1 approval question(s) withdrew: no paired device is connected')
  })
})
