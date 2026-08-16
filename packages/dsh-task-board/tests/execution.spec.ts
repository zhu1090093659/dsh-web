/**
 * Execution-service tests: real dsh session driving — session creation,
 * prompt delivery, rename, and settlement from the watched snapshot.
 */
import { describe, expect, it, vi } from 'vitest'
import { ExecutionService, type ExecutionEnvironment, type SessionDriver } from '../src/core/execution.ts'
import { createTask, startExecution, type NewTaskInput } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

/** Controllable SessionDriver fake. */
class FakeDriver implements SessionDriver {
  renameCalls: string[] = []
  promptCalls: unknown[] = []
  promptResult: { ok: true } | { ok: false; error: unknown } = { ok: true }
  commandCalls: string[] = []
  commandResult: { ok: true; matched: boolean } | { ok: false; error: unknown } = { ok: true, matched: true }
  private snapshot: { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> } = {
    running: false,
    lastAgentError: null,
    turnEnds: new Map(),
  }
  private listeners = new Set<() => void>()

  async rename(title: string): Promise<unknown> {
    this.renameCalls.push(title)
    return { ok: true, value: { title, seq: 1 } }
  }

  async prompt(content: unknown[], _mode: 'queue'): Promise<{ ok: true } | { ok: false; error: unknown }> {
    this.promptCalls.push(content)
    return this.promptResult
  }

  async command(line: string): Promise<{ ok: true; matched: boolean } | { ok: false; error: unknown }> {
    this.commandCalls.push(line)
    return this.commandResult
  }

  getSnapshot(): { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> } {
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  setSnapshot(snapshot: { running: boolean; lastAgentError?: string | null; turns?: number }): void {
    const turns = new Map<number, number>()
    for (let i = 1; i <= (snapshot.turns ?? 0); i += 1) turns.set(i, i * 10)
    this.snapshot = { running: snapshot.running, lastAgentError: snapshot.lastAgentError ?? null, turnEnds: turns }
    for (const fn of [...this.listeners]) fn()
  }
}

/** Fake env: workspace list, session creation, and one driver per session id. */
function makeEnv(overrides: {
  recentWorkspaceId?: string | undefined
  items?: Array<{ workspaceId: string }>
  promptResult?: { ok: true } | { ok: false; error: unknown }
  connectedSummary?: { blank?: boolean; agentPreset?: string }
  presets?: {
    select(sessionId: string, agentPreset: string): Promise<{ ok: true } | { ok: false; error: unknown }>
  } | 'absent'
  commandResult?: { ok: true; matched: boolean } | { ok: false; error: unknown }
} = {}) {
  const drivers = new Map<string, FakeDriver>()
  const summaries = new Map<string, { running: boolean; blank?: boolean; agentPreset?: string }>()
  const connectCalls: string[] = []
  const presetSelectCalls: Array<[string, string]> = []
  const noteAgentPresetCalls: Array<[string, string]> = []
  const env: ExecutionEnvironment = {
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(summaries) }),
        subscribe: () => () => {},
      },
      binding: (id: string) => {
        const driver = drivers.get(id)
        return driver === undefined ? undefined : { session: driver }
      },
      noteAgentPreset: (sessionId, agentPreset) => { noteAgentPresetCalls.push([sessionId, agentPreset]) },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: overrides.items ?? [{ workspaceId: 'ws-1' }],
          recentWorkspaceId: overrides.recentWorkspaceId,
        }),
      },
      connectWorkspace: async (id: string) => {
        connectCalls.push(id)
        const driver = new FakeDriver()
        if (overrides.promptResult !== undefined) driver.promptResult = overrides.promptResult
        if (overrides.commandResult !== undefined) driver.commandResult = overrides.commandResult
        drivers.set('s-1', driver)
        summaries.set('s-1', { running: false, ...overrides.connectedSummary })
        return 's-1'
      },
    },
    ...(overrides.presets === 'absent' ? {} : {
      presets: overrides.presets ?? {
        select: async (sessionId, agentPreset) => {
          presetSelectCalls.push([sessionId, agentPreset])
          return { ok: true }
        },
      },
    }),
  }
  return { env, drivers, summaries, connectCalls, presetSelectCalls, noteAgentPresetCalls }
}

function sampleTask(overrides: Partial<NewTaskInput> = {}) {
  return createTask({ title: '写个脚本', description: '', prompt: '写一个 bash 脚本，打印 hello', ...overrides }, NOW, 'task-1')
}

describe('ExecutionService.run', () => {
  it('creates a session in the recent workspace, sends the task prompt, and settles succeeded on turn completion', async () => {
    const { env, drivers, connectCalls } = makeEnv({ recentWorkspaceId: 'ws-recent' })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    const promise = service.run(task, execution, event => { events.push(event.kind) })

    await promise
    expect(connectCalls).toEqual(['ws-recent'])
    expect(drivers.get('s-1')?.renameCalls).toEqual(['写个脚本'])
    expect(drivers.get('s-1')?.promptCalls).toEqual([[{ type: 'text', text: '写一个 bash 脚本，打印 hello' }]])
    expect(events).toEqual(['started'])

    // Turn starts…
    drivers.get('s-1')?.setSnapshot({ running: true, turns: 0 })
    // …and completes.
    drivers.get('s-1')?.setSnapshot({ running: false, turns: 1 })
    expect(events).toEqual(['started', 'settled'])
  })

  it('falls back to the task title when the prompt is blank', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = createTask({ title: '只是标题', description: '', prompt: '  ' }, NOW, 'task-2')
    const { execution } = startExecution(task, NOW, 'exec-1')
    const promise = service.run(task, execution, () => {})
    await promise
    expect(drivers.get('s-1')?.promptCalls[0]).toEqual([{ type: 'text', text: '只是标题' }])
  })

  it('settles failed when the agent reports an error', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await promise
    drivers.get('s-1')?.setSnapshot({ running: true })
    drivers.get('s-1')?.setSnapshot({ running: false, lastAgentError: '模型调用失败', turns: 1 })
    expect(events.at(-1)).toEqual({
      kind: 'settled', taskId: 'task-1', executionId: 'exec-1', outcome: 'failed', error: '模型调用失败',
    })
  })

  it('settles failed when the prompt is rejected', async () => {
    const { env } = makeEnv({ promptResult: { ok: false, error: { code: 'bad-request', message: 'nope' } } })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)?.kind).toBe('settled')
    expect(events.at(-1)?.outcome).toBe('failed')
  })

  it('settles a turn that completes while the prompt round-trip is in flight', async () => {
    // A driver whose prompt() advances the turn to completion before it
    // resolves: the watch must catch it without a later subscription change.
    const connected = new FakeDriver()
    const env: ExecutionEnvironment = {
      sessions: {
        list: { getSnapshot: () => ({ phase: 'ready', byId: {} }), subscribe: () => () => {} },
        binding: () => ({ session: connected }),
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1' }], recentWorkspaceId: undefined }) },
        connectWorkspace: async () => 's-1',
      },
    }
    connected.prompt = async () => {
      connected.setSnapshot({ running: false, turns: 1 })
      return { ok: true }
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.map(e => e.kind)).toEqual(['started', 'settled'])
    expect(events[1]).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('settles failed when no workspace is available', async () => {
    const { env } = makeEnv({ items: [], recentWorkspaceId: undefined })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('workspace')
  })

  it('settles failed when the execution session never becomes ready', async () => {
    const env: ExecutionEnvironment = {
      sessions: {
        list: { getSnapshot: () => ({ phase: 'ready', byId: {} }), subscribe: () => () => {} },
        binding: () => undefined,
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1' }], recentWorkspaceId: undefined }) },
        connectWorkspace: async () => 's-1',
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('never rejects — thrown wiring failures become settled-failed events', async () => {
    const env: ExecutionEnvironment = {
      sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }), subscribe: () => () => {} }, binding: () => undefined },
      workspaces: {
        list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }) },
        connectWorkspace: async () => { throw new Error('boom') },
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    await expect(service.run(task, execution, event => { events.push(event.kind) })).resolves.toBeUndefined()
    expect(events).toEqual(['settled'])
  })
})

describe('ExecutionService.run execution targets', () => {
  it('connects the task-pinned workspace instead of the recent one', async () => {
    const { env, connectCalls, drivers } = makeEnv({ recentWorkspaceId: 'ws-recent', items: [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }] })
    const service = new ExecutionService(env)
    const task = sampleTask({ workspaceId: 'ws-2' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(connectCalls).toEqual(['ws-2'])
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('settles failed when the task-pinned workspace is missing from the list', async () => {
    const { env } = makeEnv({ items: [{ workspaceId: 'ws-1' }] })
    const service = new ExecutionService(env)
    const task = sampleTask({ workspaceId: 'ws-gone' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('workspace')
  })

  it('recomposes the preset before the first prompt and records the switch', async () => {
    const { env, drivers, presetSelectCalls, noteAgentPresetCalls } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(presetSelectCalls).toEqual([['s-1', 'anchored']])
    expect(noteAgentPresetCalls).toEqual([['s-1', 'anchored']])
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
    drivers.get('s-1')?.setSnapshot({ running: false, turns: 1 })
    expect(events.map(e => e.kind)).toEqual(['started', 'settled'])
  })

  it('skips the preset switch when the session already runs it', async () => {
    const { env, presetSelectCalls, drivers } = makeEnv({ connectedSummary: { blank: true, agentPreset: 'anchored' } })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(presetSelectCalls).toEqual([])
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('coalesces concurrent preset switches for one session into a single RPC', async () => {
    // The list mirror lags a just-applied switch, so two runs reaching the
    // gate together would both fire select without the in-flight guard.
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const { env, presetSelectCalls, noteAgentPresetCalls, drivers } = makeEnv({
      presets: {
        select: async (sessionId, agentPreset) => {
          presetSelectCalls.push([sessionId, agentPreset])
          await gate
          return { ok: true }
        },
      },
    })
    const service = new ExecutionService(env)
    const events: Array<{ kind: string; outcome?: string }> = []
    const run = (execId: string) => {
      const task = sampleTask({ mode: 'anchored' })
      const { execution } = startExecution(task, NOW, execId)
      return service.run(task, execution, event => { events.push(event) })
    }
    const first = run('exec-1')
    const second = run('exec-2')
    // Both runs reach the preset gate before we release it, so the second
    // one must ride the first one's in-flight call.
    await vi.waitFor(() => {
      expect(presetSelectCalls).toHaveLength(1)
    })
    release()
    await Promise.all([first, second])
    expect(presetSelectCalls).toEqual([['s-1', 'anchored']])
    expect(noteAgentPresetCalls).toEqual([['s-1', 'anchored'], ['s-1', 'anchored']])
    const totalPrompts = [...drivers.values()].reduce((sum, driver) => sum + driver.promptCalls.length, 0)
    expect(totalPrompts).toBe(2)
    // Settle both watches by completing one turn on whichever driver(s) the
    // runs bound to (both may share the same fake driver).
    for (const driver of drivers.values()) {
      driver.setSnapshot({ running: true, turns: 0 })
      driver.setSnapshot({ running: false, turns: 1 })
    }
    expect(events.filter(event => event.kind === 'settled').length).toBe(2)
  })

  it('forgets a shared switch failure so a later run can switch again', async () => {
    let calls = 0
    const { env, presetSelectCalls, drivers } = makeEnv({
      presets: {
        select: async (sessionId, agentPreset) => {
          calls += 1
          presetSelectCalls.push([sessionId, agentPreset])
          if (calls === 1) return { ok: false, error: { message: 'agent-preset-locked' } }
          return { ok: true }
        },
      },
    })
    const service = new ExecutionService(env)
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    const run = (execId: string) => {
      const task = sampleTask({ mode: 'anchored' })
      const { execution } = startExecution(task, NOW, execId)
      return service.run(task, execution, event => { events.push(event) })
    }
    await run('exec-1')
    await run('exec-2')
    expect(presetSelectCalls).toEqual([['s-1', 'anchored'], ['s-1', 'anchored']])
    // The first run settled failed at the switch without prompting.
    expect(events.filter(event => event.kind === 'settled')[0]).toMatchObject({ kind: 'settled', outcome: 'failed' })
    // Complete a turn on the second run's session so its watch settles.
    const driver = drivers.get('s-1')
    driver?.setSnapshot({ running: true, turns: 0 })
    driver?.setSnapshot({ running: false, turns: 1 })
    const settled = events.filter(event => event.kind === 'settled')
    expect(settled[1]).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('settles failed without prompting when the session is not blank', async () => {
    const { env, drivers } = makeEnv({ connectedSummary: { blank: false } })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('not blank')
    expect(drivers.get('s-1')?.promptCalls).toEqual([])
  })

  it('settles failed when no preset face is wired and the task pins a mode', async () => {
    const { env } = makeEnv({ presets: 'absent' })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('preset')
  })

  it('settles failed when the preset switch is rejected, without prompting', async () => {
    const { env, drivers } = makeEnv({ presets: { select: async () => ({ ok: false, error: { message: 'agent-preset-locked' } }) } })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('rejected')
    expect(drivers.get('s-1')?.promptCalls).toEqual([])
  })

  it('counts an already-running preset conflict as applied', async () => {
    const { env, drivers, noteAgentPresetCalls } = makeEnv({
      presets: { select: async () => ({ ok: false, error: { code: 'agent-preset-conflict', message: 'x', details: { existingPreset: 'anchored' } } }) },
    })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
    expect(noteAgentPresetCalls).toEqual([['s-1', 'anchored']])
    drivers.get('s-1')?.setSnapshot({ running: false, turns: 1 })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('still fails on a preset conflict for a different preset', async () => {
    const { env, drivers } = makeEnv({
      presets: { select: async () => ({ ok: false, error: { code: 'agent-preset-conflict', message: 'x', details: { existingPreset: 'other' } } }) },
    })
    const service = new ExecutionService(env)
    const task = sampleTask({ mode: 'anchored' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(drivers.get('s-1')?.promptCalls).toEqual([])
  })

  it('applies the permission command before the first prompt', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask({ permission: 'danger-full-access' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(drivers.get('s-1')?.commandCalls).toEqual(['/permission danger-full-access'])
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('settles failed when no command claims the permission line', async () => {
    const { env, drivers } = makeEnv({ commandResult: { ok: true, matched: false } })
    const service = new ExecutionService(env)
    const task = sampleTask({ permission: 'read-only' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('not recognized')
    expect(drivers.get('s-1')?.promptCalls).toEqual([])
  })

  it('settles failed when the permission command is rejected', async () => {
    const { env, drivers } = makeEnv({ commandResult: { ok: false, error: { message: 'nope' } } })
    const service = new ExecutionService(env)
    const task = sampleTask({ permission: 'workspace-write' })
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(drivers.get('s-1')?.promptCalls).toEqual([])
  })

  it('falls back to the recent workspace when the task pins none', async () => {
    const { env, connectCalls } = makeEnv({ recentWorkspaceId: 'ws-recent' })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(connectCalls).toEqual(['ws-recent'])
  })
})

describe('ExecutionService.reconcile', () => {
  it('settles a task whose execution session no longer exists', async () => {
    const { env } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-gone' })) }
    const event = await service.reconcile(withSession)
    expect(event).toMatchObject({ kind: 'settled', outcome: 'cancelled' })
  })

  it('settles a finished session by its agent error (warm snapshot)', async () => {
    const { env, drivers, summaries } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    summaries.set('s-1', { running: false })
    drivers.get('s-1')!.setSnapshot({ running: false, lastAgentError: 'x', turns: 1 })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = {
      ...running,
      executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })),
    }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('settles a finished cold session as succeeded via the list summary', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('detects failure of a cold session from the raw history tail', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false })
    const service = new ExecutionService({
      ...env,
      history: {
        loadTail: async () => ({
          events: [
            { type: 'user/message' },
            { type: 'turn/end', data: { reason: { kind: 'error' } } },
          ],
        }),
      },
    })
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('falls back to succeeded when the history tail has no error turn', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false })
    const service = new ExecutionService({
      ...env,
      history: {
        loadTail: async () => ({
          events: [
            { type: 'user/message' },
            { type: 'turn/end', data: { reason: { kind: 'completed' } } },
          ],
        }),
      },
    })
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('stays pending while the session is still running', async () => {
    const { env, drivers, summaries } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    summaries.set('s-1', { running: true })
    drivers.get('s-1')!.setSnapshot({ running: true, turns: 1 })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toBeUndefined()
  })

  it('waits for the session-list baseline before judging a session missing', async () => {
    const { env, summaries } = makeEnv()
    // Baseline not ready yet: even though byId is empty, no cancel verdict.
    const pendingEnv: ExecutionEnvironment = {
      ...env,
      sessions: {
        ...env.sessions,
        list: { getSnapshot: () => ({ phase: 'pending' as const, byId: {} }), subscribe: () => () => {} },
      },
    }
    const service = new ExecutionService(pendingEnv)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toBeUndefined()

    // Once ready with the session present, the finished session settles.
    summaries.set('s-1', { running: false })
    const readyService = new ExecutionService(env)
    expect(await readyService.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })

    // A ready list without the session is a genuine cancel.
    const missingEnv: ExecutionEnvironment = {
      ...env,
      sessions: {
        ...env.sessions,
        list: { getSnapshot: () => ({ phase: 'ready' as const, byId: {} }), subscribe: () => () => {} },
      },
    }
    expect(await new ExecutionService(missingEnv).reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'cancelled' })
  })

  it('ignores tasks with no open execution', async () => {
    const { env } = makeEnv()
    const service = new ExecutionService(env)
    expect(await service.reconcile(sampleTask())).toBeUndefined()
    const { task: running } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = {
      ...running,
      executions: running.executions.map(e => ({ ...e, endedAt: NOW, result: 'succeeded' as const })),
    }
    expect(await service.reconcile(settled)).toBeUndefined()
  })
})
