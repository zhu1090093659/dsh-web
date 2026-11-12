/**
 * Decision questions asked by a team card's session, routed through the hub.
 *
 * The Host's question waterfall is shared by every answerer on the machine, so
 * this module claims exactly one case and delegates everything else: a request
 * whose `agent.id` — the session id, since the event carries no session field —
 * is the session of a card this extension mirrors. Every other conversation on
 * the machine keeps its own answerer, and the local surface stays available for
 * a claimed question because the claim holds the ask while the hub's reviewers
 * answer it.
 *
 * Tool permission approvals are NOT part of this module and have no listener at
 * all: `approval/request` belongs to the local machine's security domain
 * (`team-hub/PROTOCOL.md` section 6), so this provider never puts one on the
 * wire.
 *
 * @module dsh-task-board-team/host/questions
 */
import type { HubClient } from './hub-client.ts'
import { HubError } from './hub-client.ts'
import {
  answerToHost,
  buildQuestionReport,
  isReportable,
  unansweredAnswer,
  type QuestionAnswer,
  type QuestionItem,
  type QuestionRequestShape,
} from '../core/question-report.ts'
import { findTaskBySession, readTaskIssueLink } from '../core/identity.ts'
import type { TaskBoardExtensionHost, TaskBoardLinkedTask } from '../core/contract.ts'
import type { HostTimerFace } from '../core/timers.ts'

/**
 * Default local fallback wait, in milliseconds.
 *
 * Zero means "no local cap": the claim holds the ask until the hub settles it
 * (answered, expired or withdrawn), which is what the acceptance loop needs — a
 * member answering from a lock-screen push may take far longer than any fixed
 * window. A deployment that wants the local surface back sooner turns the
 * fallback on and names its own number of minutes.
 */
export const DEFAULT_QUESTION_WAIT_MS = 0

/** One question this Host reported and is still waiting on. */
export interface PendingQuestionView {
  /** Local claim id. */
  id: string
  /** Card the asking session belongs to. */
  taskId: string
  /** Issue the question belongs to. */
  issueId: string
  /** The question text, as the browser renders it. */
  question: string
  /** Hub question id, once the hub stored it. */
  hubQuestionId?: string
  /** Instant the question was reported (ms epoch). */
  askedAt: number
}

interface PendingQuestion extends PendingQuestionView {
  item: QuestionItem
  settle(answer: QuestionAnswer | undefined): void
}

export interface QuestionRouterOptions {
  hub: HubClient
  host: TaskBoardExtensionHost
  /** Every card this extension mirrors; read live so a deleted card is not answered. */
  linked: () => readonly TaskBoardLinkedTask[]
  timers: HostTimerFace
  now: () => number
  /** Mint the local claim id. */
  uuid: () => string
  /** Called whenever the pending set changes, so the summary can republish. */
  onChange?: () => void
  /**
   * Local fallback wait for one claim, read per question.
   *
   * Absent or zero means the claim waits for the hub's own terminal state; a
   * positive number withdraws the question after that long and hands the ask back
   * to the next answerer.
   */
  fallbackWaitMs?: () => number | undefined
  log?: (message: string, detail?: unknown) => void
}

/**
 * The provider's claims on the Host's process-wide question waterfall.
 */
export class QuestionRouter {
  readonly #options: QuestionRouterOptions
  readonly #pending = new Map<string, PendingQuestion>()

  constructor(options: QuestionRouterOptions) {
    this.#options = options
  }

  /** Every question this Host is still waiting on, oldest claim first. */
  pending(): readonly PendingQuestionView[] {
    return [...this.#pending.values()].map(entry => ({
      id: entry.id,
      taskId: entry.taskId,
      issueId: entry.issueId,
      question: entry.question,
      ...(entry.hubQuestionId === undefined ? {} : { hubQuestionId: entry.hubQuestionId }),
      askedAt: entry.askedAt,
    }))
  }

  /**
   * The waterfall body: claim one question that belongs to a team card, and
   * delegate every other request to the next answerer.
   * @param request - the pending question batch.
   * @param next - the rest of the answerer chain.
   * @returns the team's answer, or whatever the next answerer says.
   */
  async request(request: QuestionRequestShape, next: () => Promise<QuestionAnswer>): Promise<QuestionAnswer> {
    const sessionId = request.agent?.id
    if (sessionId === undefined) return await next()
    // The claim is scoped to a mirrored card's own session: a question asked in
    // any other conversation on this machine is none of this provider's business.
    const task = findTaskBySession(this.#options.linked(), sessionId)
    if (task === undefined) return await next()
    const link = readTaskIssueLink(task)
    if (link === undefined) return await next()
    const item = request.questions[0]
    if (item === undefined || !isReportable(item)) return await next()

    const id = this.#options.uuid()
    let settle: (answer: QuestionAnswer | undefined) => void = () => undefined
    const answer = new Promise<QuestionAnswer | undefined>(resolve => { settle = resolve })
    let questionId: string
    try {
      const question = await this.#options.hub.createQuestion(link.issueId, buildQuestionReport(item))
      questionId = question.id
    } catch (error) {
      // A hub that cannot take the question must not take the agent with it: the
      // local surface answers, exactly as it did before this provider existed.
      this.#options.log?.('question report failed', error)
      return await next()
    }

    const entry: PendingQuestion = {
      id,
      taskId: task.id,
      issueId: link.issueId,
      question: item.question,
      hubQuestionId: questionId,
      askedAt: this.#options.now(),
      item,
      settle,
    }
    this.#pending.set(id, entry)
    this.#options.onChange?.()

    const waitMs = this.#options.fallbackWaitMs?.()
    const cancelWait = waitMs === undefined || waitMs <= 0
      ? (): void => {}
      : this.#options.timers.timeout(() => { void this.#expireLocally(id) }, waitMs)
    const abort = (): void => { void this.#withdraw(id) }
    request.signal?.addEventListener('abort', abort, { once: true })

    const settled = await answer
    cancelWait()
    request.signal?.removeEventListener('abort', abort)
    return settled ?? await next()
  }

  /**
   * Settle one question with a team answer.
   * @param payload - the hub's `question.answered` payload.
   * @returns whether this Host was waiting on that question.
   */
  answered(payload: Record<string, unknown>): boolean {
    const questionId = typeof payload.question_id === 'string' ? payload.question_id : undefined
    if (questionId === undefined) return false
    const entry = this.#byHubId(questionId)
    if (entry === undefined) return false
    const answer = readAnswerPayload(payload.answer)
    this.#settle(entry.id, answerToHost(entry.item, answer))
    return true
  }

  /**
   * End one question as unanswered, the way the hub's expiry does.
   * @param payload - the hub's `question.expired` payload.
   * @returns whether this Host was waiting on that question.
   */
  expired(payload: Record<string, unknown>): boolean {
    const questionId = typeof payload.question_id === 'string' ? payload.question_id : undefined
    if (questionId === undefined) return false
    const entry = this.#byHubId(questionId)
    if (entry === undefined) return false
    this.#settle(entry.id, unansweredAnswer())
    return true
  }

  /**
   * Drop one question the hub reported withdrawn.
   * @param payload - the hub's `question.withdrawn` payload.
   * @returns whether this Host was waiting on that question.
   */
  withdrawn(payload: Record<string, unknown>): boolean {
    const questionId = typeof payload.question_id === 'string' ? payload.question_id : undefined
    if (questionId === undefined) return false
    const entry = this.#byHubId(questionId)
    if (entry === undefined) return false
    this.#settle(entry.id, unansweredAnswer())
    return true
  }

  /** Drop every claim, delegating each to the next answerer. */
  dispose(): void {
    for (const id of [...this.#pending.keys()]) this.#settle(id, undefined)
  }

  /**
   * The local ask was cancelled: tell the hub, then let the next answerer take it.
   */
  async #withdraw(id: string): Promise<void> {
    const entry = this.#pending.get(id)
    if (entry === undefined) return
    if (entry.hubQuestionId !== undefined) {
      try {
        await this.#options.hub.withdrawQuestion(entry.hubQuestionId)
      } catch (error) {
        // A question the hub already closed needs no second close; a hub that
        // is down costs the dismissal, not the agent's turn.
        if (!(error instanceof HubError) || error.code !== 'QUESTION_NOT_PENDING') {
          this.#options.log?.('question withdraw failed', error)
        }
      }
    }
    this.#settle(id, undefined)
  }

  /** The local wait window ended: withdraw on the hub and return to the machine. */
  async #expireLocally(id: string): Promise<void> {
    await this.#withdraw(id)
  }

  #byHubId(questionId: string): PendingQuestion | undefined {
    for (const entry of this.#pending.values()) {
      if (entry.hubQuestionId === questionId) return entry
    }
    return undefined
  }

  #settle(id: string, answer: QuestionAnswer | undefined): boolean {
    const entry = this.#pending.get(id)
    if (entry === undefined) return false
    this.#pending.delete(id)
    entry.settle(answer)
    this.#options.onChange?.()
    return true
  }
}

/**
 * Read the hub's answer member into the shape the mapping needs.
 *
 * Protocol amendment A2 fixes this shape as `{ selected: string[], custom?: string }`
 * (or null while a question is still unanswered), so a null answer reads as an
 * empty selection instead of being mistaken for a custom-only reply.
 */
function readAnswerPayload(raw: unknown): { selected: readonly string[]; custom?: string } {
  if (typeof raw !== 'object' || raw === null) return { selected: [] }
  const answer = raw as Record<string, unknown>
  const selected = Array.isArray(answer.selected)
    ? answer.selected.filter((value): value is string => typeof value === 'string')
    : []
  const custom = typeof answer.custom === 'string' ? answer.custom : undefined
  return { selected, ...(custom === undefined ? {} : { custom }) }
}