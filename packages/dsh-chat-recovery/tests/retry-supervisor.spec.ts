import { describe, expect, it } from 'vitest'
import { RetrySupervisor, type PromptOutcome, type RetryPorts, type RetryState } from '../src/core/retry-supervisor.ts'
import { assistantMsg, interruptedMsg, SRC, snapshot, toolResult, turnErr, userMsg } from './fixtures.ts'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'

/** The failed source turn used by most tests: turn 2 fails with a timeout. */
function failedSource(over: Record<string, unknown> = {}): ConversationSnapshot {
  return snapshot({
    nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'request timed out', 'timeout')],
    turnEnds: new Map([[1, 3], [2, 9]]),
    ...over,
  })
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

/** A controllable async result for lifecycle race tests. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakePorts implements RetryPorts {
  current: SessionId | undefined = SRC
  snaps = new Map<string, ConversationSnapshot>()
  cwds = new Map<string, string>([[SRC, '/work']])
  forked: Array<{ sessionId: SessionId; atSeq?: number }> = []
  blanks: Array<string | undefined> = []
  opened: string[] = []
  prompts: Array<{ id: SessionId; text: string }> = []
  promptResult: PromptOutcome = { ok: true }
  promptDeferred: Deferred<PromptOutcome> | undefined
  forkDeferred: Deferred<SessionId> | undefined
  timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = []
  failFork = false

  currentId = (): SessionId | undefined => this.current
  snapshot = (id: SessionId): ConversationSnapshot | undefined => this.snaps.get(id)
  cwdOf = (id: SessionId): string | undefined => this.cwds.get(id)
  fork = async (opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId> => {
    if (this.failFork) throw new Error('fork failed')
    this.forked.push({ sessionId: opts.sessionId, atSeq: opts.atSeq })
    if (this.forkDeferred !== undefined) return this.forkDeferred.promise
    return (`child${this.forked.length}`) as SessionId
  }
  connectBlank = async (cwd: string | undefined): Promise<SessionId> => {
    this.blanks.push(cwd)
    return (`blank${this.blanks.length}`) as SessionId
  }
  open = (id: SessionId): void => {
    this.opened.push(id)
    this.current = id
  }
  prompt = async (id: SessionId, text: string): Promise<PromptOutcome> => {
    this.prompts.push({ id, text })
    if (this.promptDeferred !== undefined) return this.promptDeferred.promise
    return this.promptResult
  }
  schedule = (fn: () => void, ms: number): (() => void) => {
    const timer = { fn, ms, cancelled: false }
    this.timers.push(timer)
    return () => { timer.cancelled = true }
  }

  fireTimers(): void {
    for (const timer of this.timers.splice(0)) {
      if (timer.cancelled) continue
      timer.cancelled = true
      timer.fn()
    }
  }

  activeTimerCount(): number {
    return this.timers.filter((timer) => !timer.cancelled).length
  }

  /** The retry child: turn 2 = the replayed prompt, still failing recoverably. */
  setChildFailing(childId: SessionId, errorMessage = 'request timed out'): void {
    this.snaps.set(childId, snapshot({
      sessionId: childId as SessionId,
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, errorMessage, 'timeout')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    }))
  }

  setChildRunning(childId: SessionId): void {
    this.snaps.set(childId, snapshot({
      sessionId: childId as SessionId,
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b')],
      turnEnds: new Map([[1, 3]]),
      running: true,
    }))
  }

  setChildSucceeded(childId: SessionId): void {
    this.snaps.set(childId, snapshot({
      sessionId: childId as SessionId,
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), assistantMsg(9, 2)],
      turnEnds: new Map([[1, 3], [2, 9]]),
    }))
  }
}

function make(ports: FakePorts): { supervisor: RetrySupervisor; ports: FakePorts } {
  return { supervisor: new RetrySupervisor(ports, { autoRetry: true }), ports }
}

describe('default retry policy', () => {
  it('does not create retry forks automatically unless fork-per-attempt automation is enabled', () => {
    const ports = new FakePorts()
    ports.snaps.set(SRC, failedSource())
    const supervisor = new RetrySupervisor(ports)

    supervisor.review()

    expect(supervisor.getSnapshot().phase).toBe('idle')
    expect(ports.timers).toHaveLength(0)
    expect(ports.forked).toHaveLength(0)
  })
})

describe('auto retry cycle', () => {
  it('arms on a recoverable failure, forks the prefix before the failed turn, and prompts once per child', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())

    supervisor.review()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'waiting', kind: 'auto', attempt: 1, maxAttempts: 5, delayMs: 1000, sourceId: SRC })

    ports.fireTimers()
    await Promise.resolve()
    expect(ports.forked).toEqual([{ sessionId: SRC, atSeq: 3 }])
    expect(ports.opened).toEqual(['child1'])
    expect(ports.prompts).toEqual([{ id: 'child1' as SessionId, text: 'b' }])
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'running', targetId: 'child1' })
  })

  it('retries up to 5 extra attempts with exponential backoff, then exhausts and returns to the source', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    const delays: number[] = []

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      ports.fireTimers()
      await Promise.resolve()
      await Promise.resolve()
      expect(supervisor.getSnapshot().phase).toBe('running')
      const child = ports.opened[ports.opened.length - 1]
      expect(ports.prompts.filter((p) => p.id === child)).toHaveLength(attempt)
      ports.setChildFailing(child as SessionId)
      supervisor.review()
      if (attempt < 5) {
        expect(supervisor.getSnapshot().phase).toBe('waiting')
        const pending = ports.timers[ports.timers.length - 1]
        delays.push(pending.ms)
      }
    }

    expect(delays).toEqual([2000, 4000, 8000, 16000])
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'exhausted', maxAttempts: 5 })
    // One child per cycle (issues #797, #880): the first attempt forks the
    // child at the pre-turn anchor, and every later attempt continues inside
    // it — a failed turn must never spawn more than one extra session.
    expect(ports.forked).toEqual([{ sessionId: SRC, atSeq: 3 }])
    expect(new Set(ports.prompts.map((p) => p.id)).size).toBe(1)
    // The user is returned to the original failed turn.
    expect(ports.opened[ports.opened.length - 1]).toBe(SRC)
  })

  it('starts the next attempt when the child settles before the previous prompt call returns', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    const firstPrompt = deferred<PromptOutcome>()
    ports.promptDeferred = firstPrompt
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()

    ports.setChildFailing('child1' as SessionId)
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('waiting')

    ports.promptDeferred = undefined
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'running', targetId: 'child1' })

    firstPrompt.resolve({ ok: false, code: 'timeout', message: 'late result' })
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'running', targetId: 'child1' })
    expect(ports.forked).toHaveLength(1)
    expect(ports.activeTimerCount()).toBe(0)
  })

  it('finishes done once the child turn settles with a finalized assistant message', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    ports.setChildSucceeded('child1' as SessionId)
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('done')
  })

  it('falls back to a blank sibling session when the failed turn was the first turn', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, snapshot({
      nodes: [userMsg(1, 'first'), turnErr(3, 1, 'timeout', 'timeout')],
      turnEnds: new Map([[1, 3]]),
    }))
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    expect(ports.forked).toHaveLength(0)
    expect(ports.blanks).toEqual(['/work'])
    expect(ports.prompts).toEqual([{ id: 'blank1' as SessionId, text: 'first' }])
  })
})

describe('cancel semantics', () => {
  it('cancel during the wait stops everything: no fork, no prompt', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    supervisor.cancel()
    expect(supervisor.getSnapshot().phase).toBe('cancelled')
    ports.fireTimers()
    await Promise.resolve()
    expect(ports.forked).toHaveLength(0)
    expect(ports.prompts).toHaveLength(0)
  })

  it('navigating away during the wait cancels the cycle', () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.current = 'other-session' as SessionId
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('cancelled')
  })

  it('the user sending their own message into the source during the wait cancels the cycle', () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.snaps.set(SRC, failedSource({ nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'x', 'timeout'), userMsg(11, 'new message')] }))
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('cancelled')
  })

  it('the user pressing Stop inside the retry child counts as cancel, not failure', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    ports.snaps.set('child1', snapshot({
      sessionId: 'child1' as SessionId,
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), interruptedMsg(9, 2)],
      turnEnds: new Map([[1, 3], [2, 9]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('cancelled')
  })

  it('does not re-arm the same failed turn after subscription reviews a cancelled wait', () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()

    supervisor.cancel()
    supervisor.review()
    supervisor.review()

    expect(supervisor.getSnapshot().phase).toBe('idle')
    expect(ports.activeTimerCount()).toBe(0)

    // A genuinely newer failed turn remains eligible for automatic recovery.
    ports.snaps.set(SRC, failedSource({
      nodes: [
        userMsg(1, 'a'),
        assistantMsg(3, 1),
        userMsg(5, 'b'),
        turnErr(9, 2, 'request timed out', 'timeout'),
        userMsg(11, 'new turn'),
        turnErr(14, 3, 'request timed out', 'timeout'),
      ],
      turnEnds: new Map([[1, 3], [2, 9], [3, 14]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'waiting', sourceId: SRC, attempt: 1 })
    expect(ports.activeTimerCount()).toBe(1)
  })

  it('ignores a retryable prompt result that arrives after cancel', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.promptDeferred = deferred<PromptOutcome>()
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().phase).toBe('running')

    supervisor.cancel()
    ports.promptDeferred.resolve({ ok: false, code: 'timeout', message: 'request timed out' })
    await Promise.resolve()
    await Promise.resolve()

    expect(supervisor.getSnapshot().phase).toBe('cancelled')
    expect(ports.activeTimerCount()).toBe(0)
  })

  it('absorbs a prompt rejection that arrives after cancel', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.promptDeferred = deferred<PromptOutcome>()
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()

    supervisor.cancel()
    ports.promptDeferred.reject(new Error('prompt transport failed'))
    await Promise.resolve()
    await Promise.resolve()

    expect(supervisor.getSnapshot().phase).toBe('cancelled')
    expect(ports.activeTimerCount()).toBe(0)
  })

  it('keeps a late fork failure from overwriting cancel', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.forkDeferred = deferred<SessionId>()
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()

    supervisor.cancel()
    ports.forkDeferred.reject(new Error('fork transport failed'))
    await Promise.resolve()
    await Promise.resolve()

    expect(supervisor.getSnapshot().phase).toBe('cancelled')
    expect(ports.opened).toHaveLength(0)
    expect(ports.activeTimerCount()).toBe(0)
  })

  it('quarantines the running retry child until its cancelled attempt settles', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    const child = 'child1' as SessionId
    ports.setChildRunning(child)
    supervisor.review()

    supervisor.cancel()
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('cancelled')

    ports.setChildFailing(child)
    supervisor.review()
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('idle')
    expect(ports.activeTimerCount()).toBe(0)

    ports.snaps.set(child, snapshot({
      sessionId: child,
      nodes: [
        userMsg(1, 'a'),
        assistantMsg(3, 1),
        userMsg(5, 'b'),
        turnErr(9, 2, 'request timed out', 'timeout'),
        userMsg(11, 'new turn'),
        turnErr(14, 3, 'request timed out', 'timeout'),
      ],
      turnEnds: new Map([[1, 3], [2, 9], [3, 14]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'waiting', sourceId: child, attempt: 1 })
  })

  it('manual retry inside the retry child continues the child instead of forking again', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    const child = 'child1' as SessionId
    ports.setChildFailing(child)
    supervisor.review() // running -> retryable -> waiting (attempt 2 armed)
    supervisor.cancel()
    supervisor.review() // cancelled -> child settled -> reset to idle
    expect(supervisor.getSnapshot().phase).toBe('idle')

    supervisor.manualRetry(child)
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'running', targetId: child, kind: 'manual' })
    expect(ports.forked).toHaveLength(1)
    expect(ports.prompts.map((p) => p.id)).toEqual([child, child])
  })

  it('a new cycle on the source forks a fresh child instead of reusing the old one', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    const child = 'child1' as SessionId
    ports.setChildFailing(child)
    supervisor.review() // running -> waiting (attempt 2 armed)
    supervisor.cancel()
    supervisor.review() // reset to idle
    expect(supervisor.getSnapshot().phase).toBe('idle')

    supervisor.manualRetry(SRC)
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'running', targetId: 'child2', kind: 'manual' })
    expect(ports.forked).toEqual([{ sessionId: SRC, atSeq: 3 }, { sessionId: SRC, atSeq: 3 }])
    expect(ports.prompts.map((p) => p.id)).toEqual([child, 'child2'])
  })

  it('does not schedule work when a prompt settles after dispose', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.promptDeferred = deferred<PromptOutcome>()
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().phase).toBe('running')

    supervisor.dispose()
    ports.promptDeferred.resolve({ ok: false, code: 'timeout', message: 'request timed out' })
    await Promise.resolve()
    await Promise.resolve()
    supervisor.review()

    expect(ports.activeTimerCount()).toBe(0)
    expect(ports.opened).toEqual(['child1'])
  })
})

describe('non-retryable and manual paths', () => {
  it('does not arm on a permission failure', () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'permission denied', 'permission_denied')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('idle')
    expect(ports.timers).toHaveLength(0)
  })

  it('does not arm on tool-involved turns, but manual retry re-runs them once', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), toolResult(7), turnErr(9, 2, 'timeout', 'timeout')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('idle')

    supervisor.manualRetry(SRC)
    await Promise.resolve()
    await Promise.resolve()
    expect(ports.forked).toHaveLength(1)
    expect(ports.prompts).toEqual([{ id: 'child1', text: 'b' }])
    expect(supervisor.getSnapshot()).toMatchObject({ kind: 'manual', maxAttempts: 1 })
  })

  it('a retryable prompt rejection schedules the next attempt; a business rejection ends the cycle', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.promptResult = { ok: false, code: 'network error', message: 'connection reset' }
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().phase).toBe('waiting')
    expect(ports.timers[ports.timers.length - 1].ms).toBe(2000)

    ports.promptResult = { ok: false, code: 'invalid-request', message: 'bad args' }
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()
    expect(supervisor.getSnapshot().phase).toBe('failed')
    expect(ports.opened[ports.opened.length - 1]).toBe(SRC)
  })

  it('settles an exceptional prompt rejection as a failed cycle', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.promptDeferred = deferred<PromptOutcome>()
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    await Promise.resolve()

    ports.promptDeferred.reject(new Error('prompt transport failed'))
    await Promise.resolve()
    await Promise.resolve()

    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'failed', reason: 'prompt transport failed' })
    expect(ports.opened[ports.opened.length - 1]).toBe(SRC)
    expect(ports.activeTimerCount()).toBe(0)
  })

  it('a fork failure ends the cycle without touching the original session', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    ports.failFork = true
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    expect(supervisor.getSnapshot()).toMatchObject({ phase: 'failed', reason: 'fork failed' })
    expect(ports.prompts).toHaveLength(0)
  })
})

describe('state lifecycle', () => {
  it('resets to idle once the session moves past the settled turn', async () => {
    const { supervisor, ports } = make(new FakePorts())
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    ports.fireTimers()
    await Promise.resolve()
    ports.setChildSucceeded('child1' as SessionId)
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('done')
    // The user starts a brand-new turn in the child: the supervisor disarms.
    ports.snaps.set('child1', snapshot({
      sessionId: 'child1' as SessionId,
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), assistantMsg(9, 2), userMsg(11, 'next'), assistantMsg(14, 3)],
      turnEnds: new Map([[1, 3], [2, 9], [3, 14]]),
    }))
    supervisor.review()
    expect(supervisor.getSnapshot().phase).toBe('idle')
  })

  it('getSnapshot is stable between changes and notifies subscribers', async () => {
    const { supervisor, ports } = make(new FakePorts())
    const states: RetryState[] = []
    supervisor.subscribe(() => states.push(supervisor.getSnapshot()))
    ports.snaps.set(SRC, failedSource())
    supervisor.review()
    expect(states.length).toBeGreaterThan(0)
    expect(states[states.length - 1].phase).toBe('waiting')
  })
})
