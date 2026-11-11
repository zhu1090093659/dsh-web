import { describe, expect, it } from 'vitest'
import { TAG_NAME_MAX_LENGTH, createTask } from '../src/core/tasks.ts'
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

  it('operator setting a schedule zone gets it carried, and an unusable one rejected', () => {
    // Given a resolvable zone, a clearing null and unusable names
    // When each action envelope is parsed
    // Then the resolvable zone and the null survive and the bad names do not
    expect(parseActionEnvelope({
      requestId: 'zone-set',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { cron: '0 9 * * *', timeZone: 'Asia/Shanghai' } },
    })?.action).toEqual({ kind: 'set-schedule', taskId: 'task-a', patch: { cron: '0 9 * * *', timeZone: 'Asia/Shanghai' } })
    expect(parseActionEnvelope({
      requestId: 'zone-clear',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: null } },
    })?.action).toEqual({ kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: null } })
    // An unknown zone never reaches the Host.
    expect(parseActionEnvelope({
      requestId: 'zone-bad',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: 'Not/AZone' } },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'zone-empty',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { timeZone: '' } },
    })).toBeUndefined()
  })

  it('operator creating a card with a zone gets it accepted, and an unusable one rejected', () => {
    // Given a valid and an unknown creation-time zone
    // When each create envelope is parsed
    // Then only the valid zone produces a create action
    expect(parseActionEnvelope({
      requestId: 'create-zone',
      action: {
        kind: 'create', id: 'task-zone',
        input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Europe/London' } },
      },
    })?.action.kind).toBe('create')
    expect(parseActionEnvelope({
      requestId: 'create-zone-bad',
      action: {
        kind: 'create', id: 'task-zone-bad',
        input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, cron: '0 9 * * *', timeZone: 'Nowhere/Nope' } },
      },
    })).toBeUndefined()
  })

  it('operator setting a one-shot plan or cap gets it carried, unusable values refused', () => {
    // Given a one-shot plan and a capped recurring rule
    // When their envelopes are parsed
    // Then they survive and a malformed instant, cap or mode does not
    expect(parseActionEnvelope({
      requestId: 'once-set',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { mode: 'once', at: 1_800_000_000_000, enabled: true } },
    })?.action).toEqual({ kind: 'set-schedule', taskId: 'task-a', patch: { mode: 'once', at: 1_800_000_000_000, enabled: true } })
    expect(parseActionEnvelope({
      requestId: 'cap-set',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { cron: '0 9 * * *', maxRuns: 2 } },
    })?.action.kind).toBe('set-schedule')
    expect(parseActionEnvelope({
      requestId: 'cap-clear',
      action: { kind: 'set-schedule', taskId: 'task-a', patch: { maxRuns: null } },
    })?.action.kind).toBe('set-schedule')
    expect(parseActionEnvelope({ requestId: 'once-frac', action: { kind: 'set-schedule', taskId: 'task-a', patch: { mode: 'once', at: 1.5 } } })).toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'cap-zero', action: { kind: 'set-schedule', taskId: 'task-a', patch: { maxRuns: 0 } } })).toBeUndefined()
    expect(parseActionEnvelope({ requestId: 'mode-bad', action: { kind: 'set-schedule', taskId: 'task-a', patch: { mode: 'later' } } })).toBeUndefined()
  })

  it('operator creating a card with a one-shot plan gets it carried, an unusable one refused', () => {
    // Given a creation-time one-shot plan and a capped recurring plan
    // When each create envelope is parsed
    // Then the plans survive the gate and a fractional instant does not
    expect(parseActionEnvelope({
      requestId: 'create-once',
      action: { kind: 'create', id: 'task-once', input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, mode: 'once', at: 1_800_000_000_000 } } },
    })?.action).toEqual({ kind: 'create', id: 'task-once', input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, mode: 'once', at: 1_800_000_000_000 } } })
    expect(parseActionEnvelope({
      requestId: 'create-cap',
      action: { kind: 'create', id: 'task-cap', input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, cron: '* * * * *', maxRuns: 2 } } },
    })?.action.kind).toBe('create')
    expect(parseActionEnvelope({
      requestId: 'create-once-frac',
      action: { kind: 'create', id: 'task-once-frac', input: { title: 'T', description: '', prompt: '', schedule: { enabled: true, mode: 'once', at: 1.5 } } },
    })).toBeUndefined()
  })

  it('operator importing a one-shot rule gets it carried, an unusable one refused', () => {
    // Given a legacy task and one-shot / capped imports
    const task = createTask({ title: 'legacy', description: '', prompt: '' }, 1, 'legacy')
    // When each import envelope is parsed
    // Then a usable one-shot travels and an unusable plan is refused
    expect(parseActionEnvelope({
      requestId: 'import-once',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, mode: 'once', at: 1_800_000_000_000, runCount: 0 } }] },
    })?.action.kind).toBe('import')
    expect(parseActionEnvelope({
      requestId: 'import-once-bad',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, mode: 'once' } }] },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'import-cap-bad',
      action: { kind: 'import', sourceId: 'browser-a', tasks: [{ ...task, schedule: { enabled: true, cron: '* * * * *', maxRuns: 0 } }] },
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

  it('operator importing a card keeps its model pin together with its level and refuses a malformed one', () => {
    // Given an exported card pinning a model with a level, and a hand-edited export with a numeric model
    const pinned = { ...createTask({ title: 'A', description: '', prompt: '' }, 1, 'task-a'), model: 'acme/a', reasoningEffort: 'high' }

    // When the import gate parses both
    const kept = parseActionEnvelope({ requestId: 'import-pair', action: { kind: 'import', sourceId: 'browser', tasks: [pinned] } })
    const malformed = parseActionEnvelope({ requestId: 'import-bad-model', action: { kind: 'import', sourceId: 'browser', tasks: [{ ...pinned, model: 42 }] } })

    // Then the pair travels together and a malformed pin is refused
    expect(kept?.action.kind === 'import' ? kept.action.tasks[0] : undefined).toMatchObject({ model: 'acme/a', reasoningEffort: 'high' })
    expect(malformed).toBeUndefined()
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

describe('label management actions', () => {
  it('operator renaming a label on the wire gets it carried, and a blank or over-long name rejected', () => {
    // Given a rename envelope, a blank name and a name past the tag cap
    // When each is parsed
    // Then only the well-formed rename survives
    const accepted = parseActionEnvelope({
      requestId: 'rename-tag',
      action: { kind: 'rename-tag', from: 'ship', to: 'release' },
    })
    expect(accepted?.action.kind).toBe('rename-tag')
    expect(accepted?.action).toMatchObject({ from: 'ship', to: 'release' })
    expect(parseActionEnvelope({
      requestId: 'rename-tag-blank',
      action: { kind: 'rename-tag', from: 'ship', to: '   ' },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'rename-tag-long',
      action: { kind: 'rename-tag', from: 'ship', to: 'x'.repeat(TAG_NAME_MAX_LENGTH + 1) },
    })).toBeUndefined()
  })

  it('operator deleting a label on the wire gets it carried, and an unnamed or extra-keyed action rejected', () => {
    // Given a delete envelope, a blank name and an action carrying an unknown key
    // When each is parsed
    // Then only the well-formed delete survives
    const accepted = parseActionEnvelope({
      requestId: 'delete-tag',
      action: { kind: 'delete-tag', name: 'ship' },
    })
    expect(accepted?.action.kind).toBe('delete-tag')
    expect(parseActionEnvelope({
      requestId: 'delete-tag-blank',
      action: { kind: 'delete-tag', name: '' },
    })).toBeUndefined()
    expect(parseActionEnvelope({
      requestId: 'delete-tag-extra',
      action: { kind: 'delete-tag', name: 'ship', taskId: 'task-a' },
    })).toBeUndefined()
  })
})

describe('external outcome actions', () => {
  it('operator reporting work finished outside this Host gets it carried with its caller', () => {
    // Given an outside agent reporting a succeeded outcome with a summary
    // When the envelope is parsed
    const accepted = parseActionEnvelope({
      requestId: 'ext-ok',
      action: { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: 'codex', summary: '  tests green  ' },
    })

    // Then the verdict, the caller and the trimmed note all survive
    expect(accepted?.action).toEqual({
      kind: 'record-external-outcome',
      taskId: 'task-a',
      result: 'succeeded',
      initiatedBy: 'codex',
      summary: 'tests green',
    })
  })

  it('operator cannot report running or cancelled, an unnamed caller, or a verdict carrying extra keys', () => {
    // Given envelopes that each break one of the action's own rules
    // When each is parsed
    const rejected = [
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'running', initiatedBy: 'codex' },
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'cancelled', initiatedBy: 'codex' },
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: '   ' },
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded' },
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: 'codex', sessionId: 's-1' },
      { kind: 'record-external-outcome', taskId: 'task-a', result: 'succeeded', initiatedBy: 'c'.repeat(201) },
    ]

    // Then none survives: only a real outside verdict with an identifiable caller does
    const outcomes = rejected.map((action, index) => parseActionEnvelope({ requestId: 'ext-rejected-' + String(index), action }))
    expect(outcomes).toEqual(rejected.map(() => undefined))
  })
})

