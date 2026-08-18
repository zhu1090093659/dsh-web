/** Deterministic motion scheduler shared by current and future renderers. */

import type { PetIntent } from './intent.ts'

export interface PetIntentSchedulerState {
  current?: PetIntent
  queued: PetIntent[]
}

function copyIntent(intent: PetIntent): PetIntent {
  return {
    ...intent,
    ...(intent.speech === undefined ? {} : { speech: { ...intent.speech } }),
    sourceTaskIds: [...intent.sourceTaskIds],
  }
}

function expired(intent: PetIntent, nowMs: number): boolean {
  return intent.expiresAt !== undefined && intent.expiresAt <= nowMs
}

/** Priority scheduler whose queue contains motions only; speech remains out-of-band. */
export class PetIntentScheduler {
  private current: PetIntent | undefined
  private queued: PetIntent[] = []
  private nowMs = 0

  /** Submit one semantic motion without replaying an already-known ID. */
  submit(intent: PetIntent): PetIntentSchedulerState {
    this.nowMs = Math.max(this.nowMs, intent.createdAt)
    this.prune()
    if (expired(intent, this.nowMs)
      || this.current?.id === intent.id
      || this.queued.some(candidate => candidate.id === intent.id)) {
      return this.state()
    }

    const next = copyIntent(intent)
    if (this.current === undefined) {
      this.current = next
      return this.state()
    }

    // Activity is state, not an effect: a later semantic activity always
    // replaces an older activity even when its numeric priority decreases.
    if (next.source === 'activity' && this.current.source === 'activity') {
      this.current = next
      this.queued = this.queued.filter(candidate => candidate.source !== 'activity')
      return this.state()
    }

    if (next.priority > this.current.priority && this.current.interruptible) {
      if (this.current.playback !== 'once') this.enqueue(this.current)
      this.current = next
      return this.state()
    }

    this.enqueue(next)
    return this.state()
  }

  /** Complete an emitted motion and promote the highest-priority valid fallback. */
  complete(intentId: string): PetIntentSchedulerState {
    if (this.current?.id === intentId) this.current = undefined
    else this.queued = this.queued.filter(intent => intent.id !== intentId)
    this.prune()
    this.promote()
    return this.state()
  }

  /** Remove expired motions at a caller-controlled time. */
  tick(nowMs: number): PetIntentSchedulerState {
    if (!Number.isFinite(nowMs)) throw new TypeError('pet intent scheduler requires a finite clock')
    this.nowMs = Math.max(this.nowMs, nowMs)
    this.prune()
    this.promote()
    return this.state()
  }

  /** Forget all renderer state, for example after renderer disposal. */
  reset(): void {
    this.current = undefined
    this.queued = []
    this.nowMs = 0
  }

  private enqueue(intent: PetIntent): void {
    if (intent.source === 'activity') {
      this.queued = this.queued.filter(candidate => candidate.source !== 'activity')
    }
    this.queued.push(copyIntent(intent))
  }

  private prune(): void {
    if (this.current !== undefined && expired(this.current, this.nowMs)) this.current = undefined
    this.queued = this.queued.filter(intent => !expired(intent, this.nowMs))
  }

  private promote(): void {
    if (this.current !== undefined || this.queued.length === 0) return
    let selected = 0
    for (let index = 1; index < this.queued.length; index += 1) {
      const candidate = this.queued[index]!
      const current = this.queued[selected]!
      if (candidate.priority > current.priority
        || (candidate.priority === current.priority && candidate.createdAt > current.createdAt)) {
        selected = index
      }
    }
    this.current = this.queued.splice(selected, 1)[0]
  }

  private state(): PetIntentSchedulerState {
    return {
      ...(this.current === undefined ? {} : { current: copyIntent(this.current) }),
      queued: this.queued.map(copyIntent),
    }
  }
}
