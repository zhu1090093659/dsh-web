/**
 * The attempt store: one relayed `authorization.begin()` per id. The store
 * owns the interaction half — notices accumulate with monotonic sequence
 * numbers, a pending prompt parks with its resolver until the browser answers
 * or the prompt's own signal withdraws it, and every terminal outcome is
 * recorded exactly once.
 *
 * Relaying is deliberately HTTP-shaped: the browser polls a snapshot, answers
 * a pending prompt with one POST, and cancels with another. No streaming
 * infrastructure, matching the rest of the dsh-web family's host routes.
 * @module @linxin666/dsh-provider-signin/host/attempts
 */

import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import type {
  AttemptNotice, AttemptPending, AttemptStatus, AttemptView,
} from '../core/types.ts'

/** One stored prompt with the resolver that completes it. */
interface PendingPrompt {
  view: AttemptPending
  resolve: (value: string) => void
  reject: (error: unknown) => void
  withdrawn: boolean
}

/** One relayed attempt. */
interface Attempt {
  key: string
  status: AttemptStatus
  notices: AttemptNotice[]
  noticeSeq: number
  pending: PendingPrompt | undefined
  error: string | undefined
  readonly abort: AbortController
}

/** Cap on retained notices per attempt: a chatty flow cannot grow this without bound. */
const NOTICE_CAP = 200

/**
 * Store of relayed attempts. All methods are synchronous; the only async work
 * (the authorization attempt itself) lives in the caller's `begin()` promise.
 */
export class AttemptStore {
  private readonly attempts = new Map<string, Attempt>()

  /**
   * Create an attempt record for `key` and hand back its id, the request
   * signal `begin()` must be given, the relay interaction halves, and the
   * outcome recorder the route half settles the `begin()` promise with.
   */
  create(key: string): {
    id: string
    signal: AbortSignal
    notify: (notice: AuthorizationNotice) => void
    prompt: (prompt: AuthorizationPrompt) => Promise<string>
    settled: (status: Exclude<AttemptStatus, 'running'>, error?: string) => void
  } {
    const id = crypto.randomUUID()
    const attempt: Attempt = {
      key,
      status: 'running',
      notices: [],
      noticeSeq: 0,
      pending: undefined,
      error: undefined,
      abort: new AbortController(),
    }
    this.attempts.set(id, attempt)
    // Bounded retention: terminal attempts stay until the next create for the
    // same key, so the browser's next poll still observes the outcome.
    for (const [existing, record] of this.attempts) {
      if (record.key === key && existing !== id && record.status !== 'running') this.attempts.delete(existing)
    }
    return {
      id,
      signal: attempt.abort.signal,
      notify: (notice) => {
        if (attempt.status !== 'running') return
        attempt.noticeSeq += 1
        attempt.notices.push({
          seq: attempt.noticeSeq,
          message: notice.message,
          ...notice.url === undefined ? {} : { url: notice.url },
          ...notice.code === undefined ? {} : { code: notice.code },
        })
        if (attempt.notices.length > NOTICE_CAP) attempt.notices.splice(0, attempt.notices.length - NOTICE_CAP)
      },
      prompt: (prompt) => new Promise<string>((resolve, reject) => {
        if (attempt.status !== 'running') {
          reject(new Error('the attempt has already ended'))
          return
        }
        const view: AttemptPending = prompt.kind === 'select'
          ? {
              id: crypto.randomUUID(),
              kind: 'select',
              message: prompt.message,
              options: prompt.options.map(option => ({ ...option })),
            }
          : {
              id: crypto.randomUUID(),
              kind: prompt.kind,
              message: prompt.message,
              ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
            }
        const pending: PendingPrompt = {
          view,
          resolve,
          reject,
          withdrawn: false,
        }
        attempt.pending = pending
        // A flow racing a typed code against a browser callback withdraws the
        // losing prompt through the prompt's own signal. That withdrawal is
        // the FLOW retiring a question, not the human declining, so it must
        // reject with a plain error — a declined rejection here would make a
        // later genuine failure settle as `cancelled`.
        prompt.signal?.addEventListener('abort', () => {
          if (attempt.pending === pending) attempt.pending = undefined
          pending.withdrawn = true
          pending.reject(new Error('the prompt was withdrawn by the flow'))
        }, { once: true })
      }),
      settled: (status, error) => {
        this.settled(id, status, error)
      },
    }
  }

  /** Record a terminal outcome exactly once, releasing any pending prompt. */
  private settled(id: string, status: Exclude<AttemptStatus, 'running'>, error?: string): void {
    const attempt = this.attempts.get(id)
    if (attempt === undefined || attempt.status !== 'running') return
    attempt.status = status
    attempt.error = error
    const pending = attempt.pending
    attempt.pending = undefined
    if (pending !== undefined && !pending.withdrawn) {
      pending.withdrawn = true
      // The attempt ended under the human's cancel or an upstream settlement:
      // the flow sees a decline, which the seam reports as `cancelled`.
      pending.reject(new AuthorizationDeclinedError())
    }
  }

  /** Mark an attempt failed from the route half (a begin() rejection). */
  fail(id: string, error: string): void {
    this.settled(id, 'failed', error)
  }

  /** Cancel one attempt (the human withdrew). */
  cancel(id: string): void {
    const attempt = this.attempts.get(id)
    if (attempt === undefined || attempt.status !== 'running') return
    attempt.abort.abort()
    this.settled(id, 'cancelled')
  }

  /** Answer the pending prompt; `false` when the id is unknown, stale, or not waiting. */
  answer(id: string, pendingId: string, value: string): boolean {
    const attempt = this.attempts.get(id)
    const pending = attempt?.pending
    if (attempt === undefined || pending === undefined || pending.view.id !== pendingId || pending.withdrawn) {
      return false
    }
    attempt.pending = undefined
    pending.withdrawn = true
    pending.resolve(value)
    return true
  }

  /** Client snapshot: notices after `since`, plus the pending prompt if any. */
  view(id: string, since: number): AttemptView | undefined {
    const attempt = this.attempts.get(id)
    if (attempt === undefined) return undefined
    return {
      id,
      key: attempt.key,
      status: attempt.status,
      notices: attempt.notices.filter(notice => notice.seq > since),
      ...attempt.pending === undefined ? {} : { pending: attempt.pending.view },
      ...attempt.error === undefined ? {} : { error: attempt.error },
    }
  }

  /** Cancel every running attempt (host disposal). */
  dispose(): void {
    for (const [id, attempt] of this.attempts) {
      if (attempt.status === 'running') {
        attempt.abort.abort()
        this.settled(id, 'cancelled')
      }
    }
    this.attempts.clear()
  }
}
