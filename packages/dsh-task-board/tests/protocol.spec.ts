import { describe, expect, it } from 'vitest'
import { createTask } from '../src/core/tasks.ts'
import { parseActionEnvelope } from '../src/protocol.ts'

describe('task-board action protocol', () => {
  it('accepts the versioned action union and rejects unknown executable fields', () => {
    expect(parseActionEnvelope({
      requestId: 'request-a',
      action: { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } },
    })?.action.kind).toBe('create')
    expect(parseActionEnvelope({
      requestId: 'request-b',
      action: { kind: 'update', taskId: 'task-a', patch: { command: 'powercfg /x' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'request-c',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { cron: '* * * * *', nextRunAt: 1 } },
    })).toBeUndefined()
  })

  it('accepts benign future import fields but rejects executable command fields', () => {
    const valid = createTask({ title: 'A', description: '', prompt: '' }, 1, 'task-a')
    expect(parseActionEnvelope({ requestId: 'ok', action: { kind: 'import', sourceId: 'browser', tasks: [valid] } })).toBeDefined()
    expect(parseActionEnvelope({ requestId: 'bad', action: {
      kind: 'import', sourceId: 'browser', tasks: [{ ...valid, shell: 'cmd.exe' }],
    } })).toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'future', action: {
      kind: 'import', sourceId: 'browser', tasks: [{ ...valid, futureDisplayHint: 'compact' }],
    } })?.action.kind).toBe('import')
  })

  it('rejects oversized request ids', () => {
    expect(parseActionEnvelope({
      requestId: 'x'.repeat(257),
      action: { kind: 'delete', taskId: 'task-a' },
    })).toBeUndefined()
  })

  it('rejects malformed schedule fields during legacy import', () => {
    const task = createTask({ title: 'legacy', description: '', prompt: '' }, 1, 'legacy')
    expect(parseActionEnvelope({
      requestId: 'import-a',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, cron: ['* * * * *'] } }] },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'import-b',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, cron: '* * * * *', nextRunAt: Number.NaN } }] },
    })).toBeUndefined()
  })
})
