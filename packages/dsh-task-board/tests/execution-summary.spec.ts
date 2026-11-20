/**
 * Execution summaries: what a settled run leaves behind.
 *
 * A successful execution used to record only a verdict, so a parent card could
 * see that a subtask succeeded without seeing what it produced. These cases pin
 * the reader (last assistant prose of this run, bounded, absent when there is
 * none), the persisted shape (old documents decode, hand-edited ones degrade the
 * field and not the run), and the settlement paths (plain, cascade fold, and the
 * board snapshot the phone reads).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { EXECUTION_SUMMARY_LIMIT, createTask, startExecution, type ExecutionSummary, type TaskRecord } from '../src/core/tasks.ts'
import { executionSummaryOf, normalizeExecutionSummary, truncateExecutionSummary } from '../src/core/execution-summary.ts'
import { parseLedger } from '../src/core/store.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TASK_BOARD_SCHEMA_VERSION } from '../src/protocol.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-summary-'))
  roots.push(root)
  return root
}

/** One session event in the shape both hosts read. */
function event(type: string, seq: number, time: number, data: unknown) {
  return { type, seq, time, data }
}

/** One assistant message carrying a single text block. */
function said(text: string) {
  return { message: { content: [{ type: 'text', text }] } }
}

/** A gateway that must never be called: these cases settle through the ledger. */
function silentGateway(): TypertGateway {
  return {
    invoke: async () => { throw new Error('unexpected gateway call') },
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
  } as unknown as TypertGateway
}

describe('reading what a run left behind', () => {
  it('operator gets the last assistant message of the run with the seq it came from', () => {
    // Given a turn that spoke, called a tool, then spoke again before it ended
    const events = [
      event('assistant/message', 4, 2_000, said('starting on the ledger')),
      event('tool/call', 5, 2_100, { name: 'bash', arguments: '{}' }),
      event('assistant/message', 6, 2_200, said('summary field recorded')),
      event('turn/end', 7, 2_300, { reason: { kind: 'completed' } }),
    ]

    // When the board reads what this execution leaves behind
    const summary = executionSummaryOf(events, 1_000)

    // Then the closing message is the summary, cited by its event seq
    expect(summary).toEqual({ text: 'summary field recorded', seq: 6 })
  })

  it('operator does not read an earlier execution of the same reused session', () => {
    // Given a reused session holding an earlier run's closing message
    const events = [
      event('assistant/message', 2, 500, said('the earlier run said this')),
      event('assistant/message', 9, 5_000, said('this run said that')),
    ]

    // When the board reads the run that started at 1_000
    const summary = executionSummaryOf(events, 1_000)

    // Then only the later message belongs to it
    expect(summary).toEqual({ text: 'this run said that', seq: 9 })
  })

  it('operator gets no summary on a run that left no assistant prose', () => {
    // Given a turn whose only assistant message carried a tool call
    const events = [
      event('assistant/message', 3, 2_000, { message: { content: [{ type: 'tool-call', name: 'bash', arguments: '{}' }] } }),
      event('turn/end', 4, 2_100, { reason: { kind: 'completed' } }),
    ]

    // When the board reads what this execution leaves behind
    // Then there is nothing to record, rather than an empty string
    expect(executionSummaryOf(events, 1_000)).toBeUndefined()
  })

  it('operator sees an overlong closing message bounded with its omitted head announced', () => {
    // Given a closing message longer than the recorded limit
    const text = 'x'.repeat(EXECUTION_SUMMARY_LIMIT + 500)

    // When the board bounds it
    const bounded = truncateExecutionSummary(text)

    // Then the ledger holds no more than the limit, keeps the conclusion, and says what it dropped
    expect(bounded.length).toBe(EXECUTION_SUMMARY_LIMIT)
    expect(bounded.startsWith('[truncated 500 chars] ')).toBe(true)
    expect(bounded.endsWith('x'.repeat(200))).toBe(true)
  })

  it('operator keeps a hand-edited summary readable without trusting it', () => {
    // Given a stored summary in several shapes a hand edit can produce
    // When each is repaired
    // Then prose survives trimmed, an overlong text is bounded, and unusable ones are dropped
    expect(normalizeExecutionSummary({ text: '  shipped  ', seq: 12 })).toEqual({ text: 'shipped', seq: 12 })
    expect(normalizeExecutionSummary({ text: '   ', seq: 12 })).toBeUndefined()
    // An external conclusion was never read out of a session, so it has no seq.
    expect(normalizeExecutionSummary({ text: 'shipped' })).toEqual({ text: 'shipped' })
    expect(normalizeExecutionSummary({ text: 'shipped', seq: 'x' })).toBeUndefined()
    expect(normalizeExecutionSummary('shipped')).toBeUndefined()
    expect(normalizeExecutionSummary({ text: 'x'.repeat(EXECUTION_SUMMARY_LIMIT + 1), seq: 3 })?.text.length).toBe(EXECUTION_SUMMARY_LIMIT)
  })
})

describe('persisting what a run left behind', () => {
  /** One task row carrying a settled execution with the given summary value. */
  function rowWithSummary(summary: unknown): TaskRecord {
    const opened = startExecution(createTask({ title: 'A', description: 'd', prompt: 'p' }, NOW, 'task-a'), NOW, 'execution-1')
    return {
      ...opened.task,
      executions: opened.task.executions.map(execution => ({
        ...execution,
        endedAt: NOW + 1_000,
        result: 'succeeded' as const,
        summary: summary as ExecutionSummary | undefined,
      })),
    }
  }

  it('operator reads a recorded summary back out of the persisted ledger', () => {
    // Given a ledger document whose execution carries a summary
    const document = JSON.stringify([rowWithSummary({ text: 'shipped the summary field', seq: 42 })])

    // When the Host parses it
    const [task] = parseLedger(document)

    // Then the text and its event seq survive verbatim
    expect(task.executions[0].summary).toEqual({ text: 'shipped the summary field', seq: 42 })
  })

  it('operator reads a ledger written before executions carried summaries', () => {
    // Given a stored row whose execution predates the field
    const legacy = rowWithSummary(undefined)
    const document = JSON.stringify([{ ...legacy, executions: legacy.executions.map(execution => ({ ...execution, summary: undefined })) }])

    // When the Host parses it
    const [task] = parseLedger(document)

    // Then the row decodes and the run carries no summary (an undefined field,
    // which the persisted JSON omits entirely)
    expect(task.title).toBe('A')
    expect(task.executions).toHaveLength(1)
    expect(task.executions[0].summary).toBeUndefined()
  })

  it('operator keeps a run whose stored summary is unusable', () => {
    // Given a stored execution whose summary is malformed
    const document = JSON.stringify([rowWithSummary({ text: 7, seq: 'later' })])

    // When the Host parses it
    const [task] = parseLedger(document)

    // Then the verdict survives and only the unusable summary is gone
    expect(task.executions[0].result).toBe('succeeded')
    expect(task.executions[0].summary).toBeUndefined()
  })
})

describe('settling with what a run left behind', () => {
  it('operator sees a settled execution carry the text its run left behind', () => {
    // Given a card the Host opened and ran
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create-1', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: 'p' } })
    const executionId = ledger.applyRequest('run-1', { kind: 'run', taskId: 'task-a' }).state.tasks[0].executions[0].id

    // When it settles with the closing text the reader recovered
    ledger.settle('task-a', executionId, 'succeeded', undefined, { text: 'shipped it', seq: 42 })

    // Then the record holds the verdict and the text beside it
    expect(ledger.state().tasks[0].executions[0].summary).toEqual({ text: 'shipped it', seq: 42 })
  })

  it('operator settles a run that left no text and gets no summary field', () => {
    // Given a card the Host opened and ran with nothing to read back
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create-1', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: 'p' } })
    const executionId = ledger.applyRequest('run-1', { kind: 'run', taskId: 'task-a' }).state.tasks[0].executions[0].id

    // When it settles without a summary
    ledger.settle('task-a', executionId, 'failed', 'agent turn ended with an error')

    // Then the settlement is unchanged and no empty summary was invented
    const execution = ledger.state().tasks[0].executions[0]
    expect(execution.error).toBe('agent turn ended with an error')
    expect(Object.hasOwn(execution, 'summary')).toBe(false)
  })

  it('operator sees a historical run group keep the parent own summary when the tree settles', () => {
    // Given a stored run group whose parent turn settled with its closing text
    // while its member is still open: a group the Host opened before it stopped
    // spreading one run across a subtree
    const dir = tempRoot()
    writeFileSync(join(dir, 'ledger-v2.json'), JSON.stringify({
      schemaVersion: TASK_BOARD_SCHEMA_VERSION,
      revision: 1,
      tasks: [
        { id: 'root', title: 'root', description: '', prompt: 'root', status: 'running', createdAt: NOW, updatedAt: NOW, executions: [{ id: 'root-run', sessionId: 'session-root', startedAt: NOW, runGroupId: 'g-old', ownResult: 'succeeded', summary: { text: 'root turn finished', seq: 11 } }] },
        { id: 'a', title: 'a', description: '', prompt: 'a', status: 'running', createdAt: NOW, updatedAt: NOW, executions: [{ id: 'a-run', sessionId: 'session-a', startedAt: NOW, runGroupId: 'g-old' }] },
      ],
      scheduler: { timeZone: 'UTC' },
      recentRequests: [],
    }, null, 2))
    const ledger = new HostTaskLedger(dir, () => NOW)

    // When the last member settles and the fold finalizes the parent
    ledger.settle('a', 'a-run', 'succeeded')

    // Then the parent is settled with the group verdict and keeps what its own turn said
    const settled = ledger.state().tasks.find(task => task.id === 'root')?.executions[0]
    expect(settled?.endedAt).toBe(NOW)
    expect(settled?.result).toBe('succeeded')
    expect(settled?.summary).toEqual({ text: 'root turn finished', seq: 11 })
  })

  it('operator sees the settled run and its summary in the board snapshot', () => {
    // Given a card whose foreground run settled with what it left behind
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('create-1', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: 'p' } })
    const executionId = ledger.applyRequest('run-1', { kind: 'run', taskId: 'task-a' }).state.tasks[0].executions[0].id
    ledger.settle('task-a', executionId, 'succeeded', undefined, { text: 'shipped it', seq: 42 })
    const service = new TaskBoardHostService(silentGateway(), {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => NOW,
    })

    // When a phone reads the board snapshot
    const snapshot = service.snapshot()

    // Then the execution carries the summary beside its verdict
    expect(snapshot.tasks[0].executions[0]).toMatchObject({
      result: 'succeeded',
      summary: { text: 'shipped it', seq: 42 },
    })
  })
})
