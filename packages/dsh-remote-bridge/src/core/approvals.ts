/**
 * The bridge's claims on `approval/request`.
 *
 * The agent asks a waterfall question and the bridge claims it only while a
 * paired phone can actually answer; every other outcome delegates to `next()`,
 * which the Host normalizes to the fail-closed `'unavailable'`. A phone that
 * never answers therefore equals a refusal, which is the intended default: an
 * unreachable operator must not silently authorize a tool.
 * @module dsh-remote-bridge/core/approvals
 */

import { randomBase64Url } from './crypto.ts'

/** How long a claimed question waits for a phone before delegating. */
export const APPROVAL_TIMEOUT_MS = 120_000
/** Entropy of one question id. */
export const APPROVAL_ID_BYTES = 16

/** The two decisions a phone may send back. */
export type ClaimedDecision = 'allowed-once' | 'rejected'
/** A claim's answer: a decision, or `undefined` for "the bridge withdraws, ask the next answerer". */
export type ApprovalAnswer = ClaimedDecision | undefined

export interface ApprovalPromptInput {
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
  /** Cancellation lifetime of the pending request; aborting withdraws the question. */
  readonly signal?: AbortSignal
}

/** One claimed question, as handed back to the bridge. */
export interface ApprovalPrompt {
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
  /** Settles exactly once, with a decision or `undefined` to delegate. */
  readonly answer: Promise<ApprovalAnswer>
}

/**
 * One live question as a second delivery publishes it.
 *
 * The same four fields the first broadcast carries, so a card a phone was shown
 * and the same card handed to it again after a reconnect cannot be spelled
 * differently.
 */
export interface PendingPromptView {
  readonly id: string
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
}

/** One live question. */
interface PendingPrompt {
  readonly sessionId: string
  readonly toolName: string
  readonly summary: string
  readonly settle: (answer: ApprovalAnswer) => void
  readonly timer: NodeJS.Timeout
  readonly detached: () => void
}

export interface ApprovalRegistryOptions {
  readonly timeoutMs?: number
  /** Id source, injectable so a test can answer the exact id it was given. */
  readonly random?: (byteLength: number) => string
}

/**
 * Pending approval questions for one bridge process.
 *
 * One timer per question, one `settle` for every path (answer, timeout, agent
 * cancellation, connection loss), so a question can never be answered twice and
 * a withdrawn question leaves no timer or abort listener behind.
 */
export class ApprovalRegistry {
  readonly #timeoutMs: number
  readonly #random: (byteLength: number) => string
  readonly #pending = new Map<string, PendingPrompt>()

  constructor(options: ApprovalRegistryOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? APPROVAL_TIMEOUT_MS
    this.#random = options.random ?? randomBase64Url
  }

  /** @returns how many questions are currently waiting for a phone. */
  get size(): number {
    return this.#pending.size
  }

  /**
   * Every question still waiting for a phone, in claim order.
   *
   * Only a live claim can be named here: {@link #settle} is the single path out
   * of the pending map, and an answer, the bridge's own timeout, the agent's
   * cancellation and every withdrawal all pass through it before this reads the
   * map again. A question this bridge released therefore cannot come back to a
   * client that reconnects.
   * @returns the fields a second delivery republishes, oldest claim first.
   */
  openPrompts(): readonly PendingPromptView[] {
    return [...this.#pending].map(([id, entry]) => ({ id, sessionId: entry.sessionId, toolName: entry.toolName, summary: entry.summary }))
  }

  /**
   * Claim one question.
   * @param input - session identity, tool name, presentation summary, and the agent's own lifetime.
   * @returns the prompt to publish, with its answer promise.
   */
  open(input: ApprovalPromptInput): ApprovalPrompt {
    const id = this.#random(APPROVAL_ID_BYTES)
    let settle: (answer: ApprovalAnswer) => void = () => undefined
    const answer = new Promise<ApprovalAnswer>(resolve => { settle = resolve })
    const withdraw = (): void => { this.#withdraw(id) }
    const timer = setTimeout(withdraw, this.#timeoutMs)
    timer.unref?.()
    const signal = input.signal
    const detached = signal === undefined ? (): void => undefined : (): void => { signal.removeEventListener('abort', withdraw) }
    signal?.addEventListener('abort', withdraw, { once: true })
    this.#pending.set(id, { sessionId: input.sessionId, toolName: input.toolName, summary: input.summary, settle, timer, detached })
    return { id, sessionId: input.sessionId, toolName: input.toolName, summary: input.summary, answer }
  }

  /**
   * Answer one question.
   * @returns whether the id was still pending; a stale, expired or unknown id is refused.
   */
  resolve(id: string, decision: ClaimedDecision): boolean {
    return this.#settle(id, decision) !== undefined
  }

  /**
   * Release one question the host's own panel answered first.
   *
   * The release is not a decision: the panel's answer travels back through the
   * answerer chain it came from, so the claim only has to stop being pending —
   * which is what also makes a later answer from the phone refuse as unknown
   * instead of settling a question that is already over.
   * @returns whether this call released it; false when the phone already had.
   */
  releaseToHost(id: string): boolean {
    return this.#settle(id, undefined) === true
  }

  /**
   * Withdraw the named questions, delegating each to the next answerer.
   * @returns how many were still pending.
   */
  abandon(ids: readonly string[]): number {
    let withdrawn = 0
    for (const id of ids) if (this.#settle(id, undefined) !== undefined) withdrawn += 1
    return withdrawn
  }

  /**
   * Withdraw every pending question, delegating each to the next answerer.
   * Called when the last paired phone goes away: a question nobody can answer
   * must not hold the agent until its own timeout.
   * @returns how many questions were withdrawn.
   */
  abandonAll(): number {
    return this.abandon([...this.#pending.keys()])
  }

  /**
   * Settle one question at most once.
   * @returns whether this call is the one that settled it.
   */
  #settle(id: string, answer: ApprovalAnswer): boolean | undefined {
    const entry = this.#pending.get(id)
    if (entry === undefined) return undefined
    this.#pending.delete(id)
    clearTimeout(entry.timer)
    entry.detached()
    entry.settle(answer)
    return true
  }

  /** Withdraw without caring whether it was still pending (timeout and abort paths). */
  #withdraw(id: string): void {
    this.#settle(id, undefined)
  }
}
