import { describe, expect, it } from 'vitest'
import { failureOfLastTurn, isRetryableError, planForTurn, verdictFor } from '../src/core/retry-policy.ts'
import { assistantMsg, imageUserMsg, interruptedMsg, maxTokens, modelRetry, snapshot, toolResult, turnErr, userMsg } from './fixtures.ts'

describe('isRetryableError', () => {
  const retryable = [
    ['timeout', 'request timed out'],
    ['request_timeout', ''],
    ['network', 'network error'],
    ['ECONNRESET', 'socket hang up'],
    ['rate_limit_exceeded', 'too many requests'],
    ['429', 'rate limited'],
    ['503', 'service unavailable'],
    ['empty_response', 'model returned an empty response'],
    ['fetch failed', ''],
  ]
  for (const [code, message] of retryable) {
    it(`classifies "${code} ${message}" as retryable`, () => {
      expect(isRetryableError(code, message)).toBe(true)
    })
  }

  const nonRetryable = [
    ['401', 'unauthorized'],
    ['credential-rejected', 'invalid api key'],
    ['permission_denied', 'not allowed'],
    ['invalid-request', 'bad arguments'],
    ['insufficient_quota', 'billing quota exceeded'],
    ['cancelled', 'turn was cancelled'],
    ['context_length_exceeded', 'prompt too long'],
  ]
  for (const [code, message] of nonRetryable) {
    it(`classifies "${code} ${message}" as NOT retryable`, () => {
      expect(isRetryableError(code, message)).toBe(false)
    })
  }
})

describe('failureOfLastTurn', () => {
  it('finds a turn-error failure on the last completed turn', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'request timed out', 'timeout')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    const failure = failureOfLastTurn(snap)
    expect(failure).not.toBeNull()
    expect(failure?.kind).toBe('turn-error')
    expect(failure?.turn).toBe(2)
    expect(failure?.code).toBe('timeout')
    expect(failure?.hasTools).toBe(false)
  })

  it('detects crash-interrupted turns (lastAgentError) vs user stops (no error)', () => {
    const crashed = snapshot({
      nodes: [userMsg(1, 'a'), interruptedMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
      lastAgentError: 'host crashed',
    })
    expect(failureOfLastTurn(crashed)?.kind).toBe('interrupted')
    expect(failureOfLastTurn(crashed)?.message).toBe('host crashed')

    const stopped = snapshot({
      nodes: [userMsg(1, 'a'), interruptedMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(failureOfLastTurn(stopped)?.kind).toBe('interrupted')
    expect(failureOfLastTurn(stopped)?.message).toBeNull()
  })

  it('detects max-tokens failures and tool activity', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), toolResult(2), maxTokens(4, 1)],
      turnEnds: new Map([[1, 4]]),
    })
    const failure = failureOfLastTurn(snap)
    expect(failure?.kind).toBe('max-tokens')
    expect(failure?.hasTools).toBe(true)
  })

  it('returns null while running or when the last turn succeeded', () => {
    expect(failureOfLastTurn(snapshot({ running: true }))).toBeNull()
    expect(failureOfLastTurn(snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    }))).toBeNull()
  })
})

describe('verdictFor', () => {
  const failed = (extraNodes: unknown[] = [], over: Record<string, unknown> = {}) => snapshot({
    nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'request timed out', 'timeout'), ...(extraNodes as never[])],
    turnEnds: new Map([[1, 3], [2, 9]]),
    ...over,
  })

  it('auto-retries a clean model/API failure', () => {
    const verdict = verdictFor(failed())
    expect(verdict.action).toBe('auto')
    if (verdict.action === 'auto') {
      expect(verdict.plan.text).toBe('b')
      expect(verdict.plan.forkAtSeq).toBe(3)
    }
  })

  it('stands down while the host owns a scheduled/started retry', () => {
    expect(verdictFor(failed([modelRetry(8, 2, 'scheduled')])).action).toBe('none')
    expect(verdictFor(failed([modelRetry(8, 2, 'started')])).action).toBe('none')
    // A cancelled host retry leaves the failure to us again.
    expect(verdictFor(failed([modelRetry(8, 2, 'cancelled')])).action).toBe('auto')
  })

  it('never auto-retries non-recoverable errors', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'permission denied', 'permission_denied')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    expect(verdictFor(snap).action).toBe('manual')
  })

  it('never auto-retries tool-involved turns (side effects cannot be confirmed safe)', () => {
    const withTool = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), toolResult(7), turnErr(9, 2, 'timeout', 'timeout')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    expect(verdictFor(withTool).action).toBe('manual')
  })

  it('auto-retries crash-interrupted turns without tools, but not user stops', () => {
    const crashed = snapshot({
      nodes: [userMsg(1, 'a'), interruptedMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
      lastAgentError: 'boom',
    })
    expect(verdictFor(crashed).action).toBe('auto')

    const stopped = snapshot({
      nodes: [userMsg(1, 'a'), interruptedMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(verdictFor(stopped).action).toBe('manual')
  })

  it('never auto-retries max-tokens failures', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), maxTokens(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(verdictFor(snap).action).toBe('manual')
  })

  it('does not retry while running and returns none on success', () => {
    expect(verdictFor(failed([], { running: true })).action).toBe('none')
    const ok = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(verdictFor(ok).action).toBe('none')
  })
})

describe('planForTurn', () => {
  it('builds a replay plan from the turn opener text and the pre-turn boundary', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), turnErr(9, 2, 'x', 'timeout')],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    expect(planForTurn(snap, 2)).toEqual({ text: 'b', forkAtSeq: 3, messageSeq: 5 })
    expect(planForTurn(snap, 1)).toEqual({ text: 'a', forkAtSeq: null, messageSeq: 1 })
  })

  it('refuses to replay image messages', () => {
    const snap = snapshot({
      nodes: [imageUserMsg(1), turnErr(3, 1, 'x', 'timeout')],
      turnEnds: new Map([[1, 3]]),
    })
    expect(planForTurn(snap, 1)).toBeNull()
  })
})
