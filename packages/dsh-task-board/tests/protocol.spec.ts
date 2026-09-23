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

  it('accepts a task-content update patch (host rejects the blank title)', () => {
    expect(parseActionEnvelope({
      requestId: 'content-update',
      action: { kind: 'update', taskId: 'task-a', patch: { title: 'B', description: 'd', prompt: 'p' } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'content-update-blank',
      action: { kind: 'update', taskId: 'task-a', patch: { title: '' } },
    })?.action.kind).toBe('update')
  })

  it('accepts model pinning in create input and update patch (#1359)', () => {
    const createEnv = parseActionEnvelope({
      requestId: 'create-with-model',
      action: {
        kind: 'create',
        id: 'task-model',
        input: {
          title: 'Model task',
          description: '',
          prompt: 'prompt',
          model: 'deepseek-official/deepseek-v4-flash',
        },
      },
    })
    expect(createEnv?.action.kind).toBe('create')

    const updateEnv = parseActionEnvelope({
      requestId: 'update-with-model',
      action: {
        kind: 'update',
        taskId: 'task-model',
        patch: {
          model: 'openai/gpt-5-preview',
        },
      },
    })
    expect(updateEnv?.action.kind).toBe('update')

    // Rejects non-string model values
    expect(parseActionEnvelope({
      requestId: 'update-with-bad-model',
      action: {
        kind: 'update',
        taskId: 'task-model',
        patch: {
          model: 12345,
        },
      },
    })).toBeUndefined()
  })

  it('accepts the session-reuse opt-in in create input and update patch (#1419)', () => {
    expect(parseActionEnvelope({
      requestId: 'create-reuse',
      action: { kind: 'create', id: 'task-reuse', input: { title: 'R', description: '', prompt: 'p', reuseSession: true } },
    })?.action.kind).toBe('create')

    // false (and null) clear the opt-in; anything else is rejected outright.
    expect(parseActionEnvelope({
      requestId: 'update-reuse-off',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: false } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-reuse-null',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: null } },
    })?.action.kind).toBe('update')
    expect(parseActionEnvelope({
      requestId: 'update-reuse-bad',
      action: { kind: 'update', taskId: 'task-reuse', patch: { reuseSession: 'yes' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'create-reuse-bad',
      action: { kind: 'create', id: 'task-reuse', input: { title: 'R', description: '', prompt: 'p', reuseSession: 1 } },
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
