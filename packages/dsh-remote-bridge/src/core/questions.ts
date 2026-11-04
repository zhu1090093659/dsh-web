/**
 * The bridge's claims on `user-questions/request`: which questions a phone may
 * answer, and the one path an answer travels back into the host.
 *
 * The host asks in two shapes, and they are two shapes of the SAME channel:
 *
 * - a timed ask (`askTimed`, the tool schema that declares a `timeout`) rides
 *   the waterfall with a `wait.callId`. While it is open the bridge HOLDS the
 *   host's promise, so the answer is that promise's resolution — exactly what an
 *   in-process answerer does, and the only way an open question can be answered
 *   at all (`ctx.userQuestions.answer` refuses an open question by returning
 *   false). Once the host's own deadline released the model, the ask is gone and
 *   the question can only be answered through the host's Remote `answer`, which
 *   steers the reply into the agent as a queued user message.
 * - a blocking ask (the schema without `timeout`, which is the `ask_user_question`
 *   a phone actually shows) carries NO `wait` at all, and the host assigns no
 *   call id. It is still claimed, and the bridge mints its own opaque id for the
 *   wire — resolving the promise it holds needs no host identity at all. Such a
 *   question is only ever `open`: the host has no deadline for it, so it never
 *   becomes `continued` and never takes the Remote `answer` path.
 *
 * Every claim is one record keyed by the id published on the wire, so an answer
 * that arrives late still lands, and an answer for an id this bridge never
 * claimed is refused instead of being forwarded to the host blindly.
 *
 * The bridge invents no deadline, for either shape: a timed ask's deadline is
 * the host's own and is only propagated here, and a blocking ask simply has
 * none — a phone that never answers leaves it open for as long as the asker
 * waits. It also never fabricates a refusal: a question nobody can answer is
 * delegated to `next()`, never answered with a decision the operator did not
 * make.
 *
 * A timed ask's deadline is read back from the host itself
 * (`userQuestions/attachWait`) and published as `expiresAt`, so the phone can
 * count down the wait the host is actually serving. Holding that subscription
 * parks the host's own deadline timer, so this module also has to let go at the
 * instant the deadline it learned has passed: only then does the host raise
 * `ASK_TIMED_OUT` and hand the claim its `continued` state.
 *
 * The types below mirror `@deepseek-ai/dsh-user-questions` field for field. The
 * package is not a dependency of this one (it is the host's, not the bridge's),
 * so the contract is declared locally instead of imported.
 * @module dsh-remote-bridge/core/questions
 */

import { randomBase64Url } from './crypto.ts'
import { errorCodeOf, failureText, withServiceUnavailableRetry } from './gateway-errors.ts'
import { CODE_INTERNAL, CODE_QUESTION_UNKNOWN } from './protocol.ts'
import { wireArgs, type BridgeGateway, type GatewayPeer } from './wire.ts'

/** One selectable answer offered by the asker. */
export interface QuestionOption {
  readonly label: string
  readonly description?: string
}

/** One question, in the field names protocol v1 publishes. */
export interface QuestionItem {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options?: readonly QuestionOption[]
  readonly multiSelect?: boolean
}

/**
 * One item of the answer batch. `selected` is a mutable array because the host's
 * own answer item declares it mutable, and a readonly array is not assignable to
 * a mutable one - the host's `user-questions/request` handler is typed with its
 * own answer type, so this mirror has to stay assignable to it.
 */
export interface QuestionAnswerItem {
  readonly id: string
  readonly selected: string[]
  readonly custom?: string
}

/**
 * The whole answer batch the host's ask is settled with. `answers` is mutable for
 * the same reason {@link QuestionAnswerItem} keeps `selected` mutable.
 */
export interface QuestionAnswer {
  readonly answers: QuestionAnswerItem[]
}

/**
 * The `question.request` payload for one claim, and the `payload` of every
 * `question.list` entry.
 *
 * One function for both so the card a phone was handed and the card it reads back
 * out of a list cannot drift apart: `expiresAt` appears only once the claim
 * learned the host's own deadline, and a blocking ask publishes no such key at
 * all rather than an empty or null one.
 * @param state - whether the foreground ask still holds the question.
 * @param question - the claim being published.
 * @returns the frozen payload body.
 */
export function questionPayload(state: QuestionState, question: ClaimedQuestionView): QuestionRequestPayload {
  return {
    sessionId: question.sessionId,
    callId: question.callId,
    state,
    questions: question.questions,
    ...(question.expiresAt === undefined ? {} : { expiresAt: question.expiresAt }),
  }
}

/**
 * The identity a client knows one question card by.
 *
 * The same `sessionId/callId` pair the phone already derives for its own card,
 * so a list entry and the card it describes are compared as one name instead of
 * two fields that could be recombined differently on each side.
 * @param sessionId - the session that asked.
 * @param callId - the wire call id the client answers with.
 * @returns the card key.
 */
export function questionKey(sessionId: string, callId: string): string {
  return sessionId + '/' + callId
}

/** One question this bridge still holds, as `question.list` publishes it. */
export interface ListedQuestion {
  /** {@link questionKey}: the card identity the client holds it under. */
  readonly key: string
  readonly sessionId: string
  /** `open` or `continued`; a settled question is not held and never listed. */
  readonly state: QuestionState
  /** The `question.request` payload, byte for byte the shape that channel froze. */
  readonly payload: QuestionRequestPayload
}

/**
 * The body of one `question.list` answer.
 *
 * `complete` is what a client is allowed to act on: only a complete list may
 * retire a card it does not carry, so a bridge that could answer only part of the
 * set must say `false` rather than let the difference read as "the question is
 * over".
 */
export interface QuestionListPayload {
  readonly questions: readonly ListedQuestion[]
  readonly complete: boolean
}

/** Whether a question still holds the foreground ask, or only its late reply. */
/**
 * `open` while the ask is still waiting, `continued` once the host's foreground
 * wait ended but a late answer can still be steered in, and `settled` as the
 * one-way notice that the phone's card is over — the host's own UI answered it, or
 * none was left to answer it once the claim's grace window ended. `settled` is
 * published, never held.
 */
export type QuestionState = 'open' | 'continued' | 'settled'

/** `question.request`'s payload, as frozen by the contract. */
export interface QuestionRequestPayload {
  readonly sessionId: string
  readonly callId: string
  readonly state: QuestionState
  readonly questions: readonly QuestionItem[]
  /** Epoch milliseconds; absent when the host published no readable deadline. */
  readonly expiresAt?: number
}

/**
 * The fields of a host question request this bridge reads.
 *
 * Structural on purpose, for the reason the approval listener is: the event's
 * own type is not reachable from here, and only these fields are ever touched.
 * `wait` is the host's own field for the timed schema — it is what carries the
 * call id, and it is absent for a legacy blocking ask, which this bridge
 * therefore delegates rather than claims.
 */
export interface UserQuestionRequestLike {
  readonly questions: readonly QuestionItem[]
  /** The agent asking; its id IS the session id (the event carries no session field). */
  readonly agent?: { readonly id: string }
  readonly signal?: AbortSignal
  readonly wait?: { readonly callId?: string; readonly timed?: boolean }
}

/** The identity and content of one claim, as the hub publishes it. */
export interface ClaimedQuestionView {
  readonly sessionId: string
  readonly callId: string
  readonly questions: readonly QuestionItem[]
  /**
   * Epoch milliseconds at which the host's own deadline falls — the absolute
   * form of the remaining wait the host reported through `attachWait`.
   *
   * Absent when the host said nothing: a blocking ask has no deadline at all,
   * and a timed one is only known once a wait frame arrived.
   */
  readonly expiresAt?: number
}

/** One claim the hub holds while the host's ask is still open. */
export interface ClaimedQuestion extends ClaimedQuestionView {
  /** The host's ask: the phone's answer, or whatever the next answerer says. */
  readonly answer: Promise<QuestionAnswer>
  /**
   * Epoch milliseconds at which the host's own deadline falls, from the first
   * wait frame of this claim.
   *
   * Resolves undefined when there is no deadline to publish — a blocking ask, a
   * failed subscription, or a stream that ended before its first frame — and
   * never rejects: a phone must be shown the question whether or not the host
   * would say how long it has.
   */
  readonly deadline: Promise<number | undefined>
}

/** What one `question.answer` produced: acknowledgement, or the refusal to send. */
export type QuestionReply = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly msg: string }

/** The code the host raises when its own foreground deadline ends the ask. */
export const QUESTION_TIMED_OUT_CODE = 'ASK_TIMED_OUT'
/**
 * Prefix of a call id this bridge minted for a question the host never named.
 *
 * A blocking ask has no host call id, but the phone still needs one opaque
 * handle to answer with. The prefix keeps that handle in a namespace of its own,
 * so a minted id can never be mistaken for a host `ToolCallId` — by this bridge
 * or by anything reading the wire.
 */
export const MINTED_CALL_ID_PREFIX = 'bridge:'
/** Entropy of one minted call id. */
export const MINTED_CALL_ID_BYTES = 16
/**
 * How often at most a phone is told that the host's deadline moved, in
 * milliseconds.
 *
 * The host re-reports its remaining wait on every touch of the wait, which can
 * be far more often than a countdown needs; one update per second keeps the
 * wire quiet without the phone ever showing a stale second.
 */
export const QUESTION_WAIT_BROADCAST_MIN_INTERVAL_MS = 1000

export interface OpenQuestionInput {
  readonly sessionId: string
  /** The id published on the wire: the host's own, or one this bridge minted. */
  readonly callId: string
  /**
   * Whether `callId` is the host's own tool call identity.
   *
   * Only a hosted claim can ever be `continued`: the state is what a host
   * deadline produces, and the late-answer path needs a real call id to address.
   */
  readonly hosted: boolean
  readonly questions: readonly QuestionItem[]
  /** The rest of the answerer chain, used when the bridge withdraws. */
  readonly next: () => Promise<QuestionAnswer>
  /** The host's own cancellation lifetime for this ask. */
  readonly signal?: AbortSignal
  /** Called once when the host's deadline released the model but the question stayed answerable. */
  readonly onContinued?: (question: ClaimedQuestionView) => void
  /**
   * Called when a later wait frame moved the host's deadline, so a phone that
   * already holds the card can update it in place.
   *
   * The first frame is not reported here: it is what {@link ClaimedQuestion.deadline}
   * hands the hub for the question's own first broadcast, so reporting it would
   * publish the same deadline twice.
   */
  readonly onDeadline?: (question: ClaimedQuestionView) => void
  /**
   * Called when the claim leaves this bridge without the phone answering it — the
   * host's own UI answered first, or the last paired client went away. The phone
   * still holds a card for it and has to be told, or it keeps offering a question
   * that no longer exists.
   */
  readonly onSettled?: (question: ClaimedQuestionView) => void
}

/** One live claim, with every path that settles it. */
interface Claim {
  readonly sessionId: string
  readonly callId: string
  readonly hosted: boolean
  readonly questions: readonly QuestionItem[]
  state: QuestionState
  readonly settle: (answer: QuestionAnswer) => void
  readonly fail: (reason: unknown) => void
  readonly delegate: () => void
  readonly detach: () => void
  readonly onContinued: ((question: ClaimedQuestionView) => void) | undefined
  /** Tells the phone its card is over; set from the input's `onSettled`. */
  readonly notifySettled: () => void
  /** Epoch milliseconds of the host's deadline, once a wait frame reported one. */
  expiresAt: number | undefined
  /** End the wait subscription and its timer. Idempotent. */
  readonly stopWait: () => void
}

export interface QuestionClaimsOptions {
  readonly gateway: BridgeGateway
  /** The in-process owner peer every gateway call speaks for; the bridge never derives it from a client frame. */
  readonly peer: GatewayPeer
  readonly log: (message: string) => void
  /** Id source, injectable so a test can answer the exact id it was given. */
  readonly random?: (byteLength: number) => string
  /**
   * Clock the deadline bookkeeping reads, injectable so a suite can move the
   * remaining wait instead of sleeping through it.
   */
  readonly now?: () => number
}

/** @returns whether a failure is the host's own foreground deadline. */
function isTimedOut(reason: unknown): boolean {
  return (reason as { code?: unknown } | null | undefined)?.code === QUESTION_TIMED_OUT_CODE
}

/**
 * The publishable view of one claim.
 *
 * The deadline key is spread in rather than set to undefined: a blocking ask has
 * no expiry at all, and the phone must see no such field instead of a null one.
 * @param record - the live claim.
 * @returns the claim's fields as the hub publishes them.
 */
function viewOf(record: Claim): ClaimedQuestionView {
  return {
    sessionId: record.sessionId,
    callId: record.callId,
    questions: record.questions,
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
  }
}

/**
 * Read the remaining wait out of one `attachWait` frame.
 * @param frame - the frame as the gateway delivered it.
 * @returns the remaining milliseconds, or undefined when the frame is not usable.
 */
function remainingOf(frame: unknown): number | undefined {
  const remaining = (frame as { remainingMs?: unknown } | null | undefined)?.remainingMs
  if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0) return undefined
  return remaining
}

/**
 * Project a host question into the contract's own fields.
 *
 * Explicitly field by field: the host's items carry presentation intents this
 * protocol does not publish, and a payload that grew a key the contract does
 * not declare would be a wire change nobody agreed to.
 * @param items - the host's question batch.
 * @returns the same questions in protocol vocabulary.
 */
export function projectQuestions(items: readonly QuestionItem[]): readonly QuestionItem[] {
  return items.map(item => ({
    id: item.id,
    question: item.question,
    ...(item.header === undefined ? {} : { header: item.header }),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    ...(item.options === undefined
      ? {}
      : {
          options: item.options.map(option => ({
            label: option.label,
            ...(option.description === undefined ? {} : { description: option.description }),
          })),
        }),
    ...(item.multiSelect === undefined ? {} : { multiSelect: item.multiSelect }),
  }))
}

/**
 * Pending questions of one bridge process.
 *
 * One record per id published on the wire — the host's own, or one minted here
 * for a blocking ask — and one settle for every path (answer, the host's
 * deadline, the last phone leaving, bridge unload), so a question can never be
 * settled twice and a withdrawn claim leaves no abort listener behind.
 */
export class QuestionClaims {
  readonly #gateway: BridgeGateway
  readonly #peer: GatewayPeer
  readonly #log: (message: string) => void
  readonly #random: (byteLength: number) => string
  readonly #now: () => number
  readonly #claims = new Map<string, Claim>()

  constructor(options: QuestionClaimsOptions) {
    this.#gateway = options.gateway
    this.#peer = options.peer
    this.#log = options.log
    this.#random = options.random ?? randomBase64Url
    this.#now = options.now ?? Date.now
  }

  /** @returns how many questions this bridge currently holds. */
  get size(): number {
    return this.#claims.size
  }

  /**
   * Mint the opaque wire id of a question the host never named.
   * @returns an id in this bridge's own namespace.
   */
  mintCallId(): string {
    return `${MINTED_CALL_ID_PREFIX}${this.#random(MINTED_CALL_ID_BYTES)}`
  }

  /** @returns the state of one claimed call, or undefined when it is not claimed. */
  stateOf(callId: string): QuestionState | undefined {
    return this.#claims.get(callId)?.state
  }

  /**
   * Claim one question.
   * @param input - session identity, wire call id and its provenance, questions, the rest of the chain, and the host's lifetime.
   * @returns the claim the hub publishes, or undefined when this call id is already claimed.
   */
  open(input: OpenQuestionInput): ClaimedQuestion | undefined {
    if (this.#claims.has(input.callId)) return undefined
    let settle: (answer: QuestionAnswer) => void = () => undefined
    let fail: (reason: unknown) => void = () => undefined
    const answer = new Promise<QuestionAnswer>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    const signal = input.signal
    const onAbort = (): void => { this.#expire(input.callId, signal?.reason) }
    // The rest of the answerer chain is the host's own UI, and it must keep
    // showing the question: claiming here used to swallow it. Started once, at
    // claim time, so both surfaces display it and the first answer settles it.
    // A rejection is not a verdict — the phone may still answer — so it is
    // remembered for a later withdraw instead of failing the claim now.
    let nextStarted: Promise<QuestionAnswer> | undefined
    const startNext = (): Promise<QuestionAnswer> => {
      if (nextStarted === undefined) {
        try {
          nextStarted = input.next()
        } catch (error) {
          nextStarted = Promise.reject(error)
        }
      }
      return nextStarted
    }
    // The host parks its own deadline timer while a waiter is attached, so this
    // subscription must let go at the instant the deadline it reported has
    // passed: only then does the host raise ASK_TIMED_OUT, which is what turns
    // the claim into today's `continued` one. Every settling path stops it.
    const wait = new AbortController()
    let waitTimer: NodeJS.Timeout | undefined
    let stopped = false
    // The resolver is installed by the executor below; a claim that closes before
    // the first frame needs calling it early, and that early call must be a no-op.
    const deferred: { resolve?: (deadline: number | undefined) => void } = {}
    const deadline = new Promise<number | undefined>((resolve) => { deferred.resolve = resolve })
    const resolveDeadline = (value: number | undefined): void => { deferred.resolve?.(value) }
    const stopWait = (): void => {
      if (stopped) return
      stopped = true
      if (waitTimer !== undefined) {
        clearTimeout(waitTimer)
        waitTimer = undefined
      }
      wait.abort()
      // A claim that closes before the host said anything must not leave the hub
      // awaiting a first frame that will never come.
      resolveDeadline(undefined)
    }
    const record: Claim = {
      sessionId: input.sessionId,
      callId: input.callId,
      hosted: input.hosted,
      questions: projectQuestions(input.questions),
      state: 'open',
      expiresAt: undefined,
      notifySettled: (): void => { input.onSettled?.(viewOf(record)) },
      settle,
      fail,
      delegate: (): void => {
        void startNext().then(settle, fail)
      },
      detach: (): void => { signal?.removeEventListener('abort', onAbort) },
      onContinued: input.onContinued,
      stopWait,
    }
    /** Arm the timer that lets go of the wait when the host's own deadline is due. */
    const armDeadline = (expiresAt: number): void => {
      if (waitTimer !== undefined) clearTimeout(waitTimer)
      waitTimer = setTimeout(() => { stopWait() }, Math.max(0, expiresAt - this.#now()))
      // A question waiting on a phone must never keep the host process alive.
      waitTimer.unref?.()
    }
    /**
     * Follow the host's own remaining wait and report it when it moves.
     *
     * A failure here is not a verdict on the question: the phone can answer it
     * without ever knowing the deadline, so every error only ends the
     * subscription instead of failing the claim.
     */
    const trackWait = async (): Promise<void> => {
      if (stopped) return
      let frames = 0
      let lastBroadcast = 0
      try {
        const stream = await this.#gateway.stream({
          namespace: 'userQuestions',
          method: 'attachWait',
          args: wireArgs('userQuestions', 'attachWait', { agentId: input.sessionId, callId: input.callId }),
          peer: this.#peer,
          signal: wait.signal,
        })
        const iterator = stream[Symbol.asyncIterator]()
        try {
          for (;;) {
            const next = await iterator.next()
            if (next.done === true) return
            const remaining = remainingOf(next.value)
            if (remaining === undefined) continue
            const at = this.#now()
            const expiresAt = at + remaining
            record.expiresAt = expiresAt
            armDeadline(expiresAt)
            // The first frame IS the deadline: the hub is already awaiting it for
            // the question's own broadcast, so only later frames move a card.
            if (frames === 0) {
              frames = 1
              lastBroadcast = at
              resolveDeadline(expiresAt)
              continue
            }
            if (at - lastBroadcast < QUESTION_WAIT_BROADCAST_MIN_INTERVAL_MS) continue
            lastBroadcast = at
            input.onDeadline?.(viewOf(record))
          }
        } finally {
          await iterator.return?.()
        }
      } catch (error) {
        // Releasing the wait on purpose — its deadline arrived, the claim settled —
        // aborts the stream, and the gateway reports an aborted Remote stream as a
        // failed read of its own (`gateway/cancelled`). That is the normal path,
        // not a fault, so only an end nobody asked for is logged.
        if (!stopped) this.#log(`userQuestions/attachWait failed: ${failureText(error)}`)
      } finally {
        // No frame, no deadline: the hub publishes the question without one
        // instead of waiting on a wait the host never reported. A no-op once a
        // frame already settled it.
        resolveDeadline(undefined)
      }
    }
    this.#claims.set(input.callId, record)
    // The rest of the chain is NOT started here. A connected phone takes the
    // question on its own, and the host's own panel would otherwise stay open
    // after the phone answered it — the bridge has no way to close that panel.
    // A phone that is absent, or a claim that is withdrawn, still delegates.
    if (signal?.aborted === true) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    if (input.hosted) void trackWait()
    // A blocking ask carries no host deadline at all: nothing to follow, nothing to publish.
    else resolveDeadline(undefined)
    return { ...viewOf(record), answer, deadline }
  }

  /**
   * Answer one claimed question.
   *
   * An open claim is settled by resolving the host's own ask; a continued one
   * only through the host's Remote `answer`, whose result and failures cross
   * unchanged.
   * @param sessionId - the session the client believes owns the question.
   * @param callId - the wire call id the client was shown.
   * @param answer - the complete answer batch.
   */
  async answer(sessionId: string, callId: string, answer: QuestionAnswer): Promise<QuestionReply> {
    const record = this.#claims.get(callId)
    if (record === undefined || record.sessionId !== sessionId) {
      return { ok: false, code: CODE_QUESTION_UNKNOWN, msg: 'the question is unknown, already answered or not this bridge\'s to answer' }
    }
    if (record.state === 'open') {
      this.#claims.delete(callId)
      record.detach()
      record.stopWait()
      record.settle({ answers: answer.answers })
      return { ok: true }
    }
    // Unreachable today: only a host deadline marks a claim continued, and only a
    // hosted claim can reach one. Kept as the invariant an answer path must hold.
    if (!record.hosted) {
      return { ok: false, code: CODE_QUESTION_UNKNOWN, msg: 'the question is not one the host can take a late answer for' }
    }
    return await this.#forward(sessionId, callId, answer)
  }

  /**
   * Every question this bridge still holds, as `question.list` publishes it.
   *
   * The claim registry IS the answer: a question leaves it the moment it is
   * answered, settled by the host's own UI, withdrawn with the last paired phone
   * or expired, so a card missing from this list is a card no one can answer any
   * more. Both live states are listed — `continued` is still answerable through
   * the host's late-answer path — and a settled question is never here, because
   * it is never held.
   * @returns one entry per held claim, in claim order.
   */
  listed(): readonly ListedQuestion[] {
    return [...this.#claims.values()].map(record => ({
      key: questionKey(record.sessionId, record.callId),
      sessionId: record.sessionId,
      state: record.state,
      payload: questionPayload(record.state, viewOf(record)),
    }))
  }

  /**
   * Withdraw the named questions, delegating each to the next answerer.
   * @returns how many were still open and therefore delegated.
   */
  withdraw(callIds: readonly string[]): number {
    let withdrawn = 0
    for (const callId of callIds) {
      const record = this.#claims.get(callId)
      if (record === undefined) continue
      this.#claims.delete(callId)
      record.detach()
      record.stopWait()
      record.notifySettled()
      if (record.state !== 'open') continue
      record.delegate()
      withdrawn += 1
    }
    return withdrawn
  }

  /**
   * Withdraw every claim, delegating each open question to the next answerer.
   * Called when the last paired phone has been gone long enough that no grace
   * window is still running, and when the bridge unloads: a question nobody can
   * answer must not hold the agent until its own deadline.
   * @returns how many questions were still open.
   */
  withdrawAll(): number {
    return this.withdraw([...this.#claims.keys()])
  }

  /**
   * Ask the host to steer one continued answer into its agent.
   *
   * A host that answers `false` no longer holds the question; it is reported,
   * not swallowed, and the claim is kept so a client that answered a beat too
   * early can retry once the host has folded the pending result.
   */
  async #forward(sessionId: string, callId: string, answer: QuestionAnswer): Promise<QuestionReply> {
    try {
      const accepted = await withServiceUnavailableRetry(() => this.#gateway.invoke({
        namespace: 'userQuestions',
        method: 'answer',
        args: wireArgs('userQuestions', 'answer', { agentId: sessionId, callId, answer: { answers: answer.answers } }),
        peer: this.#peer,
      }))
      if (accepted !== true) {
        return { ok: false, code: CODE_QUESTION_UNKNOWN, msg: 'the host does not hold this question as answerable yet' }
      }
      const record = this.#claims.get(callId)
      this.#claims.delete(callId)
      // The late answer is the end of this ask: nothing is left to count down.
      record?.stopWait()
      return { ok: true }
    } catch (error) {
      this.#log(`userQuestions/answer failed: ${failureText(error)}`)
      return { ok: false, code: errorCodeOf(error, CODE_INTERNAL), msg: failureText(error) }
    }
  }

  /**
   * Settle one open claim from the host's own cancellation lifetime.
   *
   * The reason is propagated verbatim, so the host's deadline still maps to its
   * pending result. Only a deadline keeps the claim: every other abort means
   * the ask itself is gone.
   */
  #expire(callId: string, reason: unknown): void {
    const record = this.#claims.get(callId)
    if (record === undefined || record.state !== 'open') return
    record.detach()
    record.stopWait()
    record.fail(reason)
    // Only a host deadline keeps a claim answerable, and only for an id the host
    // itself assigned: a minted one has no host question behind it, so nothing
    // could ever take a late answer.
    if (!record.hosted || !isTimedOut(reason)) {
      this.#claims.delete(callId)
      return
    }
    record.state = 'continued'
    record.onContinued?.(viewOf(record))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers for structured user input; the bridge claims it
     * while a paired phone is connected, and delegates every other case. The
     * parameters are the ones this package reads — the host's own declaration
     * is not reachable from here.
     * @mode waterfall
     */
    'user-questions/request'(this: unknown, request: UserQuestionRequestLike, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer>
  }
}
