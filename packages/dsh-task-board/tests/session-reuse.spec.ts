import { describe, expect, it } from 'vitest'
import { createTask, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'
import { reusableSessionId } from '../src/core/session-reuse.ts'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Scheduled', description: '', prompt: 'run' }, 1, 'task-a'),
    ...overrides,
  }
}

function execution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'exec-1',
    sessionId: 'session-a',
    startedAt: 10,
    endedAt: 20,
    result: 'succeeded',
    error: undefined,
    ...overrides,
  }
}

describe('reusableSessionId (#1419)', () => {
  it('continues in the settled session when the task opted in and the session is idle', () => {
    expect(reusableSessionId(task({ reuseSession: true, executions: [execution()] }), new Set(['session-a']))).toBe('session-a')
  })

  it('mints a fresh session when the task did not opt in', () => {
    expect(reusableSessionId(task({ executions: [execution()] }), new Set(['session-a']))).toBeUndefined()
    expect(reusableSessionId(task({ reuseSession: false, executions: [execution()] }), new Set(['session-a']))).toBeUndefined()
  })

  it('never reuses while the roster is unknown', () => {
    expect(reusableSessionId(task({ reuseSession: true, executions: [execution()] }), undefined)).toBeUndefined()
  })

  it('mints a fresh session when the previous session is running or gone', () => {
    const opted = task({ reuseSession: true, executions: [execution()] })
    expect(reusableSessionId(opted, new Set(['session-b']))).toBeUndefined()
    expect(reusableSessionId(opted, new Set())).toBeUndefined()
  })

  it('reuses the newest settled session while the current run is still open (#1587)', () => {
    // The launch path calls this AFTER startExecution appended this run's own
    // open record, so the array tail is always an unsettled row at that point.
    const launching = task({
      reuseSession: true,
      executions: [
        execution({ id: 'exec-1', sessionId: 'session-done', endedAt: 20 }),
        execution({ id: 'exec-2', sessionId: undefined, startedAt: 30, endedAt: undefined, result: undefined }),
      ],
    })
    expect(reusableSessionId(launching, new Set(['session-done']))).toBe('session-done')
    expect(reusableSessionId(launching, new Set(['session-other']))).toBeUndefined()
  })

  it('skips unsettled and session-less rows when looking back for the newest settled session', () => {
    const skipped = task({
      reuseSession: true,
      executions: [
        execution({ id: 'exec-1', sessionId: undefined, endedAt: 20 }),
        execution({ id: 'exec-2', sessionId: 'session-done', endedAt: 40 }),
        execution({ id: 'exec-3', sessionId: 'session-open', startedAt: 50, endedAt: undefined, result: undefined }),
      ],
    })
    expect(reusableSessionId(skipped, new Set(['session-done']))).toBe('session-done')
  })

  it('mints a fresh session when the newest execution is still open or has no session', () => {
    const open = task({ reuseSession: true, executions: [execution({ endedAt: undefined, result: undefined })] })
    expect(reusableSessionId(open, new Set(['session-a']))).toBeUndefined()
    const noSession = task({ reuseSession: true, executions: [execution({ sessionId: undefined })] })
    expect(reusableSessionId(noSession, new Set(['session-a']))).toBeUndefined()
    expect(reusableSessionId(task({ reuseSession: true }), new Set(['session-a']))).toBeUndefined()
  })

  it('follows the newest execution after a reuse chain', () => {
    const chained = task({
      reuseSession: true,
      executions: [execution({ id: 'exec-1' }), execution({ id: 'exec-2', sessionId: 'session-a', startedAt: 30, endedAt: 40 })],
    })
    expect(reusableSessionId(chained, new Set(['session-a']))).toBe('session-a')
    expect(reusableSessionId(chained, new Set(['session-old']))).toBeUndefined()
  })
})
