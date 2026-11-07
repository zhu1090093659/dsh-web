/**
 * The bridge's process-wide connection registry and its claims on
 * `approval/request` and `user-questions/request`.
 *
 * The hub is what makes "phone not answering equals refusal" true: an approval
 * is claimed only while at least one paired device is connected, the publish has
 * to actually reach someone, and every other path (timeout, agent cancellation,
 * the last phone leaving) delegates to the next answerer, which the Host
 * normalizes to `'unavailable'`.
 *
 * A user question adds the one case where "reach someone" is the notification
 * rather than the socket: with no paired connection on the wire but a device on
 * the roster that registered for pushes, the question is claimed for that phone
 * and the alert is its delivery (§11.3, §32). One predicate decides it — "can a
 * device that is reachable right now receive a question card".
 *
 * The claim on `user-questions/request` follows the same rules, with three
 * differences that belong to the host's own semantics: delegating is not a
 * refusal, because only a phone that declares `questions.v1` is ever shown the
 * question; a question is named on the wire even when the host named none,
 * because a blocking ask carries no call id and the phone still needs a handle
 * to answer with; and the claim outlives the last paired device by a grace
 * window, because a phone whose app the system suspended has refused nothing.
 *
 * Claiming is not swallowing any more. Both claims hand the same question to the
 * host's own answerer chain the instant they exist, so the phone and the host's
 * own panel hold one card each and the first answer settles it. Yielding is not
 * delegating: the phone's card is only over once the other side really answered,
 * which is why a question chain that rejects and an approval chain that falls
 * through to its fail-closed `'unavailable'` end nothing here — the claim stays
 * exactly as answerable as it was before the other surface existed.
 *
 * A presented page (`ui_present`, protocol §35) is the second claim that takes a
 * grace window, and it takes the same one: the tool call it blocks is the agent's
 * own wait, the card is the only place its answer can come from, and a phone that
 * was suspended has refused nothing either. It differs in one direction only —
 * there is no "next answerer" to hand a card back to, so a window that runs out
 * ends the tool call as a refusal (§35.5: the host side reads it as a timeout)
 * rather than starting another answerer.
 * @module dsh-remote-bridge/core/hub
 */

import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalPrompt, PendingPromptView } from './approvals.ts'
import type { BridgeConnectionOptions, BridgeTransport, ConnectionAuth } from './connection.ts'
import { BridgeConnection } from './connection.ts'
import { CAP_APPROVALS, CAP_QUESTIONS, CAP_UI, TOPIC_APPROVAL_REQUEST, TOPIC_QUESTION_REQUEST, TOPIC_UI_REQUEST } from './protocol.ts'
import { questionPayload } from './questions.ts'
import type { ClaimedQuestion, QuestionAnswer, UserQuestionRequestLike } from './questions.ts'
import { isDeadPushToken, type PushDeliveryReport } from './push.ts'
import { uiPayload } from './ui.ts'
import type { JsonValue, UiCardView, UiPresentOutcome, UiRefusalReason } from './ui.ts'

/**
 * The fields of an approval question this bridge reads. Structural on purpose:
 * the event's own type is not exported from the package root, and only these
 * fields are ever touched.
 */
export interface ApprovalRequestLike {
  /** The agent asking; its id IS the session id (the event carries no session field). */
  readonly agent: { readonly id: string }
  readonly toolName: string
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}

/**
 * The gateway this hub reads, plus the one predicate the bridge's structural face
 * does not declare: whether a browser client that can answer these forwarded
 * waterfalls is open right now (`ctx.typertGateway.hasLiveClient`).
 *
 * Optional on purpose. A host without the Web GUI never has one, a capture-only
 * context implements only what the bridge calls, and absence reads as "no panel"
 * — the state in which a notification has always been the delivery.
 */
type PanelGateway = BridgeConnectionOptions['gateway'] & { readonly hasLiveClient?: () => boolean }

/** The summary line a phone shows for one question. */
export function approvalSummary(request: ApprovalRequestLike): string {
  return request.displayReason?.zh ?? request.displayReason?.en ?? request.toolName
}

/**
 * Whether an approval card is still the phone's to answer, or already over.
 *
 * A field of the payload rather than a second topic: a client written before it
 * knows no such key, so it reads exactly the frame it always read and the
 * question simply stays on screen until it is answered or refused.
 */
export type ApprovalState = 'open' | 'settled'

/** The `approval.request` payload one claim is published with. */
export interface ApprovalRequestPayload {
  readonly sessionId: string
  readonly id: string
  readonly summary: string
  readonly toolName: string
  /** Absent means `open`, which is what every frame published before this field carries. */
  readonly state?: ApprovalState
}

/**
 * The `approval.request` payload for one claim.
 *
 * The first broadcast, the replay of a still-open claim and the notice that the
 * host's own panel answered it all go through this one function, so the card a
 * phone was originally shown and the same card handed to it again after a
 * reconnect cannot drift apart. `state` is published only when it is not the
 * default, so every frame that existed before it is byte for byte what it was.
 * @param prompt - the claim being published.
 * @param state - `open` for a question a phone can answer, `settled` for the
 * notice that the host's own panel answered it first.
 */
function approvalPayload(prompt: PendingPromptView, state: ApprovalState = 'open'): ApprovalRequestPayload {
  return {
    sessionId: prompt.sessionId,
    id: prompt.id,
    summary: prompt.summary,
    toolName: prompt.toolName,
    ...(state === 'open' ? {} : { state }),
  }
}

/**
 * How long a user question outlives the last paired device, in milliseconds.
 *
 * A push notification carries a session link and nothing else: the phone can
 * draw a question card only while this bridge still holds the claim, and it has
 * to reconnect before it can read one. A phone whose app was suspended is gone
 * for tens of seconds, so releasing the claim the instant its socket drops
 * decides the question for it — the ask went back to the host's own answerer
 * chain, the Mac showed the card, and the tap that arrived afterwards opened a
 * session with nothing in it (measured 2026-10-23). The window is that reconnect
 * budget, not a second deadline: a claim no phone came back for is released on
 * expiry exactly as it was before.
 */
export const QUESTION_CLAIM_GRACE_MS = 60_000

// 同一个窗口也覆盖 §35 的整页卡：卡片同样只在「最后一次配对设备离开」时启动，只在
// 确有卡片被持有时启动，桥卸载时立即释放。窗口长度不新造旋钮——手机回来答题的时间
// 预算对提问与对卡片是同一件事，两处各写一个六万毫秒的常量只会让它们漂开。

/** Which path a user question takes right now (§11.3). */
type QuestionMode = 'online' | 'offline' | 'nobody'

/**
 * What the hub is built with: the bridge's shared options.
 *
 * A named type of its own so a suite can build a hub without the whole plugin,
 * and so the options this class reads stay one declaration.
 */
export interface BridgeHubOptions extends BridgeConnectionOptions {}

/**
 * What one `ui_present` call ended as, with the count of connections that took
 * the first frame.
 *
 * The count is here rather than in the card registry because it is a fact about
 * delivery: the registry owns the claim, the hub owns the fan-out, and a client
 * count read back out of the claim would be a second answer to the same question.
 * It rides the tool result so the desktop can say how many screens the page
 * reached (§35.10).
 */
export type UiPresentReply =
  | { readonly ok: true; readonly delivered: number; readonly type: string; readonly payload?: JsonValue }
  | { readonly ok: false; readonly delivered: number; readonly reason: UiRefusalReason }

/** The bridge's live connections plus the answerer it composes onto the approval chain. */
export class BridgeHub {
  readonly #options: BridgeHubOptions
  readonly #connections = new Set<BridgeConnection>()
  /**
   * The release this hub has scheduled for the user questions no paired device
   * can answer any more. The claim table is global, so one timer covers every
   * claim and there is never more than one of them.
   */
  #questionReleaseTimer: NodeJS.Timeout | undefined
  /**
   * 整页卡（§35）的那一个释放窗口。卡表是全局的，所以一个定时器覆盖每一张卡，
   * 同一时刻只可能有一个；它与 {@link #questionReleaseTimer} 各管各的通道。
   */
  #uiReleaseTimer: NodeJS.Timeout | undefined

  constructor(options: BridgeHubOptions) {
    this.#options = options
  }

  /** @returns how many paired devices could answer a question right now. */
  get pairedClients(): number {
    let count = 0
    for (const connection of this.#connections) if (connection.paired) count += 1
    return count
  }

  /**
   * Register one accepted socket.
   * @param transport - the carrier the connection writes through.
   * @param auth - the device the upgrade proved, when it carried a valid token.
   */
  attach(transport: BridgeTransport, auth?: ConnectionAuth): BridgeConnection {
    // The replay hook is wired here rather than by the caller: a phone that
    // reconnects mid-question was not there for the broadcast, and every
    // construction path has to hand it the live claims — the approval ones and
    // the user-question ones alike.
    const connection = new BridgeConnection(
      {
        ...this.#options,
        onDeclare: (fresh) => {
          this.replayQuestions(fresh)
          this.replayApprovals(fresh)
          this.replayUi(fresh)
        },
      },
      transport,
      auth,
    )
    this.#connections.add(connection)
    connection.startHeartbeat()
    // A paired device is the phone the window was being held open for: it is
    // here now, so the release it was waiting out is no longer due.
    if (connection.paired) this.#cancelQuestionRelease()
    if (auth !== undefined) void this.#options.roster.touch(auth.deviceId).catch(() => undefined)
    this.#options.log(`connection open (${auth === undefined ? 'unpaired' : `device ${auth.deviceId}`})`)
    return connection
  }

  /**
   * Forget one connection and abort everything it owns. When it was the last
   * paired device, every pending approval is withdrawn at once and every pending
   * user question is released when its grace window ends.
   */
  detach(connection: BridgeConnection): void {
    this.#connections.delete(connection)
    connection.dispose()
    if (this.pairedClients > 0) return
    // An approval takes no window: the tool behind it is the agent's own wait,
    // and a card no connected phone can answer must not hold it a second longer.
    this.#abandonApprovals()
    // A user question is delegated rather than refused, so the next answerer in
    // the host's chain decides and the question's own deadline still holds — but
    // only once the window in which the phone can come back for it has run out.
    if (this.#options.questions.size > 0) this.#armQuestionRelease()
    // 一张已经被手机看到的整页卡拿同一个窗口（§35.5），理由与提问逐字相同：那条
    // 工具调用唯一的答案通道就是这张卡，手机在系统挂起它的时候什么都没拒绝。
    if (this.#options.ui.size > 0) this.#armUiRelease()
  }

  /**
   * Publish one event to every paired device.
   * @returns how many connections actually took the frame.
   */
  broadcast(topic: string, payload: unknown): number {
    let delivered = 0
    for (const connection of this.#connections) {
      if (!connection.paired) continue
      if (connection.emit(topic, payload)) delivered += 1
    }
    return delivered
  }

  /**
   * Hand one freshly declared connection the questions it can now answer.
   *
   * Without this, a question raised while the phone was reconnecting stays on the
   * host with no card anywhere on the phone: the original broadcast was addressed
   * to clients that had already announced the channel.
   */
  replayQuestions(connection: BridgeConnection): void {
    if (!connection.paired || !connection.declares(CAP_QUESTIONS)) return
    // The claim's own state, not `open` for every claim: a question whose
    // foreground wait the host already ended is `continued`, and replaying it as
    // open tells the phone to wait on an agent that has already moved on. The
    // held set is read the way `question.list` publishes it, so the replayed card
    // and the row the phone reads back stay one shape.
    for (const held of this.#options.questions.listed()) {
      connection.emit(TOPIC_QUESTION_REQUEST, held.payload)
    }
  }

  /**
   * Hand one freshly declared connection the approvals it can now answer.
   *
   * The same shape as {@link replayQuestions} and for the same reason: the first
   * `approval.request` of a question was broadcast to the phones that were
   * connected at that instant, so a phone that reconnected — or a session screen
   * opened after the fact — holds no card and has no other way to learn the
   * question exists. Only unsettled questions are in the registry, so one that
   * was answered, one the bridge timed out and one withdrawn with the last phone
   * cannot be replayed.
   *
   * The replay emits a frame and nothing else: the claim keeps the deadline it
   * was opened with, so re-handing a question never lengthens how long the agent
   * waits for it.
   * @param connection - the connection that just declared its capabilities.
   */
  replayApprovals(connection: BridgeConnection): void {
    if (!connection.paired || !connection.declares(CAP_APPROVALS)) return
    for (const prompt of this.#options.approvals.openPrompts()) {
      connection.emit(TOPIC_APPROVAL_REQUEST, approvalPayload(prompt))
    }
  }

  /**
   * Hand one freshly declared connection the cards this bridge still holds (§35.5).
   *
   * Without this, a presentation raised while the phone was reconnecting stays on
   * the host with no page anywhere on the phone: the first `ui.request` was
   * addressed to the clients that had already announced the channel. The replay
   * emits a frame and nothing else — it claims no card and moves no deadline, so
   * re-handing a page never lengthens how long the agent waits for it.
   *
   * A phone that can take a card is on the wire, so the window that held those
   * cards for nobody is over: it is cancelled here rather than at attach, because
   * only a connection that DECLARED the channel can actually receive one (§11.5's
   * own judgement, which §35.5 reuses).
   * @param connection - the connection that just declared its capabilities.
   */
  replayUi(connection: BridgeConnection): void {
    if (!connection.paired || !connection.declares(CAP_UI)) return
    this.#cancelUiRelease()
    for (const held of this.#options.ui.listed()) {
      connection.emit(TOPIC_UI_REQUEST, held.payload)
    }
  }

  /**
   * Publish one event to every paired device that announced a capability.
   * @returns how many connections actually took the frame.
   */
  broadcastTo(capability: string, topic: string, payload: unknown): number {
    let delivered = 0
    for (const connection of this.#connections) {
      if (!connection.paired || !connection.declares(capability)) continue
      if (connection.emit(topic, payload)) delivered += 1
    }
    return delivered
  }

  /**
   * The body of this plugin's `approval/request` listener.
   *
   * The claim yields the moment it exists: the host's own panel is offered the
   * same question, so the phone and the panel hold one card each and the first
   * answer decides. A panel that answers first ends the phone's claim and the phone
   * is told; a phone that answers first leaves the panel's later answer ignored.
   * @param request - the pending question.
   * @param next - the rest of the answerer chain.
   * @returns the first decision, or whatever the next answerer says.
   */
  async approve(request: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    if (this.pairedClients === 0) return await next()
    const sessionId = request.agent.id
    const prompt = this.#options.approvals.open({
      sessionId,
      toolName: request.toolName,
      summary: approvalSummary(request),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
    const delivered = this.broadcast(TOPIC_APPROVAL_REQUEST, approvalPayload(prompt))
    // A question nobody could receive is withdrawn immediately instead of
    // waiting out the phone's timeout with the agent blocked on it.
    if (delivered === 0) this.#options.approvals.abandon([prompt.id])
    // Only a claim that reached someone is worth a notification: the question a
    // withdrawn claim stood for can no longer be answered by any phone, and a
    // notification about it would be a card with nothing behind it (§28.5).
    else {
      // A notification stands in for the host's own panel, so one is only sent
      // while that panel is not on the wire (§28).
      if (!this.#hasLiveClient()) this.#options.push?.notify('approval', sessionId)
      // The card is not a second answerer: it only says a tool is blocked, with
      // the fixed line and none of the tool's own reason text (§29).
      this.#options.liveActivity?.noteApproval(sessionId)
    }
    // The panel is offered the same question from here on. It is offered after
    // the card above rather than before it, so a decision that arrives at once
    // still follows the open frame on the wire instead of preceding it.
    const chain = this.#startApprovalChain(prompt, next)
    const answer = await prompt.answer
    return answer === undefined ? await chain : answer
  }

  /**
   * The body of this plugin's `user-questions/request` listener.
   *
   * Claimed only while a device that is reachable right now can be shown the
   * card: a paired connection that declared `questions.v1`, or — with no phone on
   * the wire — a roster device that registered for notifications, which the alert
   * reaches instead of a frame (§11.3, §32). The payload has no session field of
   * its own, so an ask that names no agent is delegated either. The wire id is the
   * host's own when the ask is timed, and minted here when it is blocking and the
   * host assigned none — either way the phone answers the id it was shown. A claim
   * nobody received is withdrawn at once instead of holding the agent until the
   * host's deadline. The host's own answerer chain is entered the instant the
   * claim exists, in every mode, so the host's panel shows the same question and
   * the first answer settles both. For a timed ask the host's own remaining wait
   * travels with the first frame as `expiresAt`, and every later move of that
   * deadline is re-published under the same call id.
   * @param request - the pending question batch.
   * @param next - the rest of the answerer chain.
   * @returns the phone's answer, the host's own deadline outcome, or whatever the next answerer says.
   */
  async question(request: UserQuestionRequestLike, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer> {
    const sessionId = request.agent?.id
    if (sessionId === undefined) return await next()
    // With no phone on the wire the roster decides, and reading it is the file the
    // mount already loaded: awaiting the memoized load keeps the first question of
    // a process from being delegated only because that read had not finished.
    if (this.pairedClients === 0) await this.#options.roster.load()
    const mode = this.#questionMode()
    // Nobody reachable can be shown this question: it belongs to the next answerer,
    // exactly as every other case this bridge cannot deliver does.
    if (mode === 'nobody') return await next()
    // A blocking ask carries no `wait`: the host has no call id for it, but the
    // phone needs a handle to answer with, so one is minted in this bridge's own
    // namespace. Resolving the promise held here needs no host identity.
    const hosted = request.wait?.callId
    const callId = hosted ?? this.#options.questions.mintCallId()
    const claim = this.#options.questions.open({
      sessionId,
      callId,
      hosted: hosted !== undefined,
      questions: request.questions,
      next,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      onSettled: (question): void => {
        // The phone's card has to go when the desktop answered it, or the phone
        // keeps offering a question that no longer exists.
        this.broadcastTo(CAP_QUESTIONS, TOPIC_QUESTION_REQUEST, questionPayload('settled', question))
        // The lock-screen card says the same thing: a card still asking for an
        // answer nobody owes any more is the one state it must never show.
        this.#options.liveActivity?.noteSettled(sessionId)
      },
      onContinued: (question): void => {
        // The foreground wait ended, but the question is still answerable: the
        // phone is told which state it is in instead of losing the question.
        this.broadcastTo(CAP_QUESTIONS, TOPIC_QUESTION_REQUEST, questionPayload('continued', question))
      },
      onDeadline: (question): void => {
        // The host moved its deadline. Re-publishing the open state under the same
        // call id updates the card the phone already holds instead of opening a
        // second one.
        this.broadcastTo(CAP_QUESTIONS, TOPIC_QUESTION_REQUEST, questionPayload('open', question))
      },
    })
    if (claim === undefined) return await next()
    // Claiming is not swallowing: the panel is offered this question from this
    // instant on, whatever mode claimed it, and the first answer settles both.
    claim.startHostChain()
    if (mode === 'offline') return await this.#holdOfflineClaim(sessionId, callId, claim)
    // The host's own first wait frame is folded into this same frame: a phone is
    // handed the question and how long it has together, rather than a card that a
    // second update then races. A claim with no frame publishes no deadline,
    // which is exactly the payload from before this channel existed.
    const expiresAt = await claim.deadline
    // The host's own lifetime can end while the first wait frame is still being
    // awaited — its signal aborts, so the claim is expired or already continued.
    // Publishing now would hand the phone a card nobody can retract, so that case
    // goes straight to the claim's own outcome: the host's reason, or its answer.
    if (this.#options.questions.stateOf(callId) !== 'open') return await claim.answer
    const delivered = this.broadcastTo(CAP_QUESTIONS, TOPIC_QUESTION_REQUEST, questionPayload('open', expiresAt === undefined ? claim : { ...claim, expiresAt }))
    // A client that cannot receive this is not going to receive it later: the claim
    // must not be left holding the host's ask with no card anywhere. A client that
    // *can* receive it but was reconnecting is a different case — it is handed the
    // live claims by `onDeclare` when it comes back.
    if (delivered === 0) this.#options.questions.withdraw([callId])
    // Same rule as the approval above: a question this bridge could not hand to
    // a connected phone is withdrawn at once, so a notification would announce
    // something already gone.
    else {
      // The same substitution as the approval above: the alert is the delivery
      // only while the host's own panel is not there to show the card.
      if (!this.#hasLiveClient()) this.#options.push?.notify('question', sessionId)
      // Only the first question's header and at most two option labels reach that
      // session's card: they are the choices the App can offer (§29.7: the card has
      // no controls of its own). The questions themselves stay on the wire, exactly
      // as the alert channel keeps them out of its body.
      const first = request.questions[0]
      this.#options.liveActivity?.noteQuestion(sessionId, {
        ...(first?.header === undefined ? {} : { header: first.header }),
        ...(first?.options === undefined ? {} : { optionLabels: first.options.map(option => option.label) }),
      })
    }
    return await claim.answer
  }

  /**
   * Present one page to the clients that declared `ui.v1` and wait for the user's
   * first action (§35).
   *
   * The body of the `ui_present` tool call. Claimed only while a paired
   * connection that declared the channel is on the wire: with none, a page would
   * reach nobody, so the call answers `unavailable` at once instead of holding the
   * agent on a wait no screen can end (§35.6 — the same judgement as §11.3's claim
   * exclusivity). A frame no connection took is not held either, for the same
   * reason.
   *
   * The card is announced `open` here and announced `settled` from the claim's own
   * notice, so both frames come out of one payload builder and the page a phone was
   * originally handed cannot drift from the one it reads back out of `ui.list`.
   * @param card - the page, under the host's own `ToolCallId`.
   * @param signal - the tool call's cancellation lifetime.
   * @returns the user's action, or the refusal that ended the wait.
   */
  async present(card: UiCardView, signal?: AbortSignal): Promise<UiPresentReply> {
    if (signal?.aborted === true) return { ok: false, delivered: 0, reason: 'cancelled' }
    if (!this.#uiReachable()) return { ok: false, delivered: 0, reason: 'unavailable' }
    const claim = this.#options.ui.open({
      ...card,
      ...(signal === undefined ? {} : { signal }),
      onSettled: (settled): void => {
        // The one notice every ending path uses: the client's card is over, whichever
        // side ended it — the user answering, the grace window, a cancelled turn.
        this.broadcastTo(CAP_UI, TOPIC_UI_REQUEST, uiPayload('settled', settled))
      },
    })
    if (claim === undefined) return { ok: false, delivered: 0, reason: 'unavailable' }
    const delivered = this.broadcastTo(CAP_UI, TOPIC_UI_REQUEST, uiPayload('open', claim))
    // A page nobody took is not kept: the agent must not wait for a card that no
    // screen is holding, and the claim is withdrawn rather than left open.
    if (delivered === 0) {
      this.#options.ui.withdraw([card.callId], 'unavailable')
      return { ok: false, delivered: 0, reason: 'unavailable' }
    }
    const outcome: UiPresentOutcome = await claim.outcome
    return outcome.ok
      ? {
          ok: true,
          delivered,
          type: outcome.type,
          ...(outcome.payload === undefined ? {} : { payload: outcome.payload }),
        }
      : { ok: false, delivered, reason: outcome.reason }
  }

  /** Close every connection and withdraw every question. Idempotent. */
  dispose(): void {
    // Unloading is not a phone going away: nothing can come back for these
    // claims, so every window is dropped and the release happens right here.
    this.#cancelQuestionRelease()
    // 卸载不是「手机离开了」：这些卡再也等不到动作，所以窗口立刻作废，释放就在
    // 这里发生（§35.5「桥卸载立即释放」），不留定时器。
    this.#cancelUiRelease()
    for (const connection of [...this.#connections]) {
      this.#connections.delete(connection)
      connection.dispose()
    }
    this.#options.approvals.abandonAll()
    this.#options.questions.withdrawAll()
    const cards = this.#options.ui.withdrawAll()
    if (cards > 0) this.#options.log(`${cards} presented page(s) released: the bridge unloaded`)
  }

  /**
   * Arm the one release of the user questions no paired device can answer.
   *
   * A second departure while a window is already running must not extend it, so
   * an armed timer is left alone: every claim it covers is released at the one
   * instant it was scheduled for.
   */
  #armQuestionRelease(): void {
    if (this.#questionReleaseTimer !== undefined) return
    const timer = setTimeout(() => {
      this.#questionReleaseTimer = undefined
      // Exactly what an immediate release does, approvals included: whatever is
      // still held when nobody is paired goes back to the host's own answerers.
      this.#abandonApprovals()
      this.#releaseQuestions()
    }, QUESTION_CLAIM_GRACE_MS)
    // A held question must never keep the host process alive, exactly like the
    // deadline timer one claim arms.
    timer.unref?.()
    this.#questionReleaseTimer = timer
  }

  /** Drop the pending window, if there is one. The claims it would release stay held. */
  #cancelQuestionRelease(): void {
    if (this.#questionReleaseTimer === undefined) return
    clearTimeout(this.#questionReleaseTimer)
    this.#questionReleaseTimer = undefined
  }

  /**
   * Which path a user question takes right now (§11.3).
   *
   * The one judgement behind both deliveries: can a device that is reachable
   * right now receive a question card, or does the alert have to stand in for it.
   * @returns `online` for the ordinary claim-and-broadcast path, `offline` for a
   * claim held for a phone reached by notification, and `nobody` when the question
   * has to go straight to the next answerer.
   */
  #questionMode(): QuestionMode {
    for (const connection of this.#connections) {
      if (connection.paired && connection.declares(CAP_QUESTIONS)) return 'online'
    }
    // A paired connection is on the wire and none of them declared the channel: no
    // one can be shown a card, and a claim held for the phone that was never there
    // would make the agent wait out a window for a decision nobody can give.
    if (this.pairedClients > 0) return 'nobody'
    // No key and no relay token, no sender: an alert that cannot be sent is not a
    // delivery, so the question is not claimed for a phone that would never learn
    // it exists.
    const push = this.#options.push
    if (push?.enabled !== true) return 'nobody'
    // Which rows count as reachable is the route's own question. Over the relay a
    // registration without a relay token is a phone this machine cannot tell
    // anything — the token is the whole credential there — while on the direct
    // route the APNs token on the same row is.
    const targets = push.mode === 'relay' ? this.#options.roster.relayTargets() : this.#options.roster.pushTargets()
    return targets.length > 0 ? 'offline' : 'nobody'
  }

  /**
   * Claim one question for a phone that is not on the wire (§32).
   *
   * No socket is paired, so this claim's own first frame would reach nobody: the
   * notification IS its delivery. Nothing is held on the phone's behalf any more —
   * the host's own chain was offered the same question at claim time — so the
   * claim lives exactly as long as any other: until the phone answers it, the
   * host's deadline ends it, or this bridge unloads.
   * @param sessionId - the session that asked.
   * @param callId - the wire id the phone will answer under.
   * @param claim - the claim this bridge just opened.
   * @returns the phone's answer, or whatever the next answerer says.
   */
  async #holdOfflineClaim(sessionId: string, callId: string, claim: ClaimedQuestion): Promise<QuestionAnswer> {
    // The same substitution the online path makes: with the panel on the wire it
    // is the delivery and the phone is not rung.
    if (!this.#hasLiveClient()) {
      // The report is the only way this bridge learns that the phone it announced
      // to is gone for good: a frame would have carried that fact, an alert does not.
      this.#options.push?.notify('question', sessionId, (report) => { this.#onQuestionPushed(callId, report) })
    }
    return await claim.answer
  }

  /**
   * Read one alert's delivery report (§32.5).
   *
   * Three APNs answers are final about a registration: 410 with `Unregistered`, or
   * `Unregistered`/`BadDeviceToken` on any status. The device is cleaned off the
   * roster, and the claim is kept only while some other registered device is still
   * there to be told; when the last one is gone the claim is given up, because no
   * phone can be told this question exists.
   * @param callId - the offline claim this notification was about.
   * @param report - how the announcement ended.
   */
  #onQuestionPushed(callId: string, report: PushDeliveryReport): void {
    const dead = report.failures.filter(failure => isDeadPushToken(failure)).map(failure => failure.deviceToken)
    if (dead.length === 0) return
    // The roster still lists these rows — the cleanup is a file write — so they are
    // subtracted here rather than waited out: a claim decision may not block on a disk.
    // Counted on the same road the question was claimed on, so a row that never held
    // the relay's token cannot outlive the only registration it had.
    const reachable = this.#options.push?.mode === 'relay'
      ? this.#options.roster.relayTargets()
      : this.#options.roster.pushTargets()
    const survivors = reachable.filter(({ push }) => !dead.includes(push.deviceToken))
    void this.#forgetDeadTokens(dead)
    if (survivors.length > 0) return
    this.#releaseUnreachableClaim(callId, 'APNs refused every device token on the roster')
  }

  /** Drop each dead registration from the roster, then let the watchers settle. */
  async #forgetDeadTokens(tokens: readonly string[]): Promise<void> {
    try {
      let dropped = false
      for (const token of tokens) dropped = (await this.#options.roster.removePush(token)) || dropped
      // A row that lost the card tokens of its install may have lost its last
      // watcher with them, and a watcher is a follow stream this bridge keeps open.
      if (dropped) this.#options.onPushRegistered?.()
    } catch (error) {
      this.#options.log(`a dead push registration could not be cleaned up: ${String(error)}`)
    }
  }

  /**
   * Give up one claim no phone can be told about any more.
   *
   * The one route for that fact — a roster whose every registered token APNs
   * refuses — so nobody settles the question twice: `withdraw` deletes the claim
   * before it hands the question to the chain that was started at claim time, and
   * the chain is memoized, so a second route releases nothing and announces
   * nothing.
   * @param callId - the claim to release.
   * @param reason - why, logged once when something really was released.
   */
  #releaseUnreachableClaim(callId: string, reason: string): void {
    const released = this.#options.questions.withdraw([callId])
    if (released > 0) this.#options.log(`an offline-claimed user question was released: ${reason}`)
  }

  /** Abandon every approval: no paired device is left to answer one. */
  #abandonApprovals(): void {
    const withdrawn = this.#options.approvals.abandonAll()
    if (withdrawn > 0) this.#options.log(`${withdrawn} approval question(s) withdrew: no paired device is connected`)
  }

  /**
   * Hand one approval question to the host's own answerers.
   *
   * The chain is entered once, at claim time, so the panel is shown the same card
   * the phone holds. Only a real decision ends the phone's claim: a rejection is
   * not an answer, and neither is the fail-closed `'unavailable'` the chain returns
   * when no panel took the question at all — the phone may still answer either way.
   * @param prompt - the claim the chain is answering for.
   * @param next - the rest of the answerer chain.
   * @returns the chain's outcome, rejection included, for the caller that has to
   * wait on it after the phone stopped being able to answer.
   */
  #startApprovalChain(prompt: ApprovalPrompt, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    let chain: Promise<ApprovalOutcome>
    try {
      chain = next()
    } catch (error) {
      chain = Promise.reject(error)
    }
    void chain.then(outcome => { this.#settleApprovalFromHost(prompt, outcome) }, () => undefined)
    return chain
  }

  /**
   * End one claim on the decision the host's own panel gave.
   *
   * The release decides, not the outcome alone: a claim the phone already answered
   * is not pending any more, so its answer stands and nothing is announced a second
   * time. `'unavailable'` is the chain's fail-closed default rather than a decision
   * — no panel took the question — and it leaves the claim exactly as it was.
   * @param prompt - the claim the chain was started for.
   * @param outcome - what the host's own answerers decided.
   */
  #settleApprovalFromHost(prompt: ApprovalPrompt, outcome: ApprovalOutcome): void {
    if (outcome === 'unavailable') return
    if (!this.#options.approvals.releaseToHost(prompt.id)) return
    this.broadcast(TOPIC_APPROVAL_REQUEST, approvalPayload(prompt, 'settled'))
  }

  /**
   * @returns whether a browser client that can answer these waterfalls is on the wire.
   *
   * The gateway's own predicate, read through the bridge's structural face. A
   * notification stands in for that panel, so it is only sent when the panel is not
   * there; a host without the Web GUI — and a capture-only test context — answers
   * `false`, which is the state in which the alert has always been the delivery.
   */
  #hasLiveClient(): boolean {
    const gateway: PanelGateway = this.#options.gateway
    return gateway.hasLiveClient?.() === true
  }

  /** Release every user question to the next answerer. */
  #releaseQuestions(): void {
    const released = this.#options.questions.withdrawAll()
    if (released > 0) this.#options.log(`${released} user question(s) released: no paired device is connected`)
  }

  /**
   * @returns whether a reachable right now connection can be shown a page (§35.6).
   *
   * The one predicate `ui_present` reads before it claims anything, and the reason
   * a call with nobody on the wire answers `unavailable` without holding the agent:
   * announcing a capability is the whole of what makes a client able to receive one.
   */
  #uiReachable(): boolean {
    for (const connection of this.#connections) {
      if (connection.paired && connection.declares(CAP_UI)) return true
    }
    return false
  }

  /**
   * Arm the one release of the presented pages no paired device can answer.
   *
   * The same shape as {@link #armQuestionRelease} and the same window: a second
   * departure while a window is already running must not extend it, so an armed
   * timer is left alone. Its expiry ends those tool calls as a refusal, which is
   * what §35.5 calls the host side reading the release as a timeout.
   */
  #armUiRelease(): void {
    if (this.#uiReleaseTimer !== undefined) return
    const timer = setTimeout(() => {
      this.#uiReleaseTimer = undefined
      const released = this.#options.ui.withdrawAll()
      if (released > 0) this.#options.log(`${released} presented page(s) released: the grace window ended`)
    }, QUESTION_CLAIM_GRACE_MS)
    // A held page must never keep the host process alive.
    timer.unref?.()
    this.#uiReleaseTimer = timer
  }

  /** Drop the pending card window, if there is one. The cards it would release stay held. */
  #cancelUiRelease(): void {
    if (this.#uiReleaseTimer === undefined) return
    clearTimeout(this.#uiReleaseTimer)
    this.#uiReleaseTimer = undefined
  }
}
