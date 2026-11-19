/**
 * The payload a card stores about its remote runs: what parsing accepts, and
 * the promise that a trimmed payload is always smaller than the board's ceiling
 * no matter how much history a card accumulated.
 */
import { describe, expect, it } from 'vitest'
import { SSH_LEDGER_LIMIT_BYTES, parseSshLedgerPayload, sshLedgerPayloadBytes, trimSshLedgerPayload } from '../src/core/ledger.ts'
import type { SshLedgerPayload } from '../src/core/ledger.ts'
import type { SshRunRecord } from '../src/core/target.ts'

/** One settled run record with a summary of the given size. */
function runRecord(index: number, summaryLength = 2_048): SshRunRecord {
  return {
    runId: 'run-20261119-' + String(index).padStart(4, '0'),
    phase: index % 3 === 0 ? 'failed' : 'succeeded',
    startedAt: 1_700_000_000_000 + index * 1_000,
    finishedAt: 1_700_000_000_500 + index * 1_000,
    exitCode: index % 3 === 0 ? 1 : 0,
    sessionId: 'session-' + String(index),
    bytes: 8_192 + index,
    branch: 'dsh-task/run-' + String(index),
    summary: 's'.repeat(summaryLength),
    error: index % 3 === 0 ? 'e'.repeat(summaryLength) : undefined,
  }
}

/** A target the payload always pins. */
const target = {
  mode: 'direct',
  host: 'build-box',
  agent: { kind: 'claude' },
  workspace: { kind: 'in-place', path: '/srv/work/repo' },
} as const

describe('ledger payload trimming', () => {
  it('operator leaving 200 runs of history behind still stores a payload under the board ceiling', () => {
    // Given a card whose history grew to 200 runs with 2 KiB summaries each
    const payload: SshLedgerPayload = {
      version: 1,
      updatedAt: 1_700_000_000_000,
      target,
      activeRun: runRecord(200),
      history: Array.from({ length: 200 }, (_unused, index) => runRecord(index)),
    }

    // When it is trimmed
    const trimmed = trimSshLedgerPayload(payload)

    // Then the stored bytes are strictly under 64 KiB, the history is capped, and the newest run survives
    expect(sshLedgerPayloadBytes(trimmed)).toBeLessThan(SSH_LEDGER_LIMIT_BYTES)
    expect(trimmed.history.length).toBeLessThanOrEqual(50)
    expect(trimmed.history.at(-1)?.runId).toBe('run-20261119-0199')
    expect(trimmed.activeRun?.runId).toBe('run-20261119-0200')
  })

  it('operator reading a summary longer than the budget gets it cut, not dropped', () => {
    // Given one run whose summary is far beyond the stored budget
    const payload: SshLedgerPayload = {
      version: 1,
      updatedAt: 1,
      history: [{ runId: 'run-1', phase: 'succeeded', startedAt: 1, summary: 'x'.repeat(50_000) }],
    }

    // When it is trimmed
    const trimmed = trimSshLedgerPayload(payload)

    // Then the run stays and its summary is cut to the budget
    expect(trimmed.history).toHaveLength(1)
    expect(trimmed.history[0].summary).toHaveLength(512)
  })

  it('operator setting a tiny budget loses the oldest history first and the target last', () => {
    // Given a payload with history, an active run and a target
    const payload: SshLedgerPayload = {
      version: 1,
      updatedAt: 1,
      target,
      activeRun: runRecord(9),
      history: Array.from({ length: 5 }, (_unused, index) => runRecord(index)),
    }

    // When it is trimmed to a budget only a bare payload can meet
    const trimmed = trimSshLedgerPayload(payload, { maxBytes: 120 })

    // Then nothing but the version and timestamp is left, and it still fits
    expect(sshLedgerPayloadBytes(trimmed)).toBeLessThan(120)
    expect(trimmed.history).toEqual([])
    expect(trimmed.activeRun).toBeUndefined()
    expect(trimmed.target).toBeUndefined()
  })

  it('operator asking for a smaller history cap keeps the newest records', () => {
    // Given ten runs of history
    const payload: SshLedgerPayload = {
      version: 1,
      updatedAt: 1,
      history: Array.from({ length: 10 }, (_unused, index) => runRecord(index, 32)),
    }

    // When it is trimmed to three records
    const trimmed = trimSshLedgerPayload(payload, { maxHistory: 3 })

    // Then the last three are the ones kept
    expect(trimmed.history.map(record => record.runId)).toEqual([
      'run-20261119-0007',
      'run-20261119-0008',
      'run-20261119-0009',
    ])
  })
})

describe('ledger payload parsing', () => {
  it('operator reading a payload this package wrote gets every part back', () => {
    // Given a payload with a target, an active run and one history record
    const payload: SshLedgerPayload = {
      version: 1,
      updatedAt: 1_700_000_000_000,
      target,
      activeRun: runRecord(2),
      history: [runRecord(1)],
    }

    // When it is parsed
    const parsed = parseSshLedgerPayload(payload)

    // Then the payload comes back whole
    expect(parsed).toEqual({ ok: true, value: payload })
  })

  it('operator reading a payload from a newer schema is refused with the version it expects', () => {
    // Given a payload written by a later version of this package
    const payload = { version: 2, updatedAt: 1, history: [] }

    // When it is parsed
    const parsed = parseSshLedgerPayload(payload)

    // Then the refusal names the version
    expect(parsed).toEqual({ ok: false, errors: [{ path: 'version', message: 'must be 1' }] })
  })

  it('operator reading a payload whose history holds one bad record keeps the rest of the account', () => {
    // Given a history with a corrupted entry between two good ones
    const payload = {
      version: 1,
      updatedAt: 1,
      history: [runRecord(1), { runId: 'run-broken', phase: 'nope', startedAt: 'yesterday' }, runRecord(3)],
    }

    // When it is parsed
    const parsed = parseSshLedgerPayload(payload)

    // Then the two good records survive and the corrupted one is gone
    expect(parsed.ok).toBe(true)
    expect(parsed).toEqual({
      ok: true,
      value: { version: 1, updatedAt: 1, history: [runRecord(1), runRecord(3)] },
    })
  })

  it('operator reading something that is not a payload gets a diagnostic instead of an exception', () => {
    // Given values that are not payloads
    const malformed = [null, 42, [], 'payload']

    // When each is parsed
    const parsed = malformed.map(parseSshLedgerPayload)

    // Then each is refused with the same reason
    expect(parsed).toEqual(malformed.map(() => ({ ok: false, errors: [{ path: '', message: 'must be an object' }] })))
  })
})
