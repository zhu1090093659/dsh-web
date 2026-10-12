import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService, installStreamErrorGuards, safeConsoleError, type TeamSpawnInput } from '../src/host-service.ts'
import type { TaskBoardWorkspaceRegistry } from '../src/host-runner.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import { createTask, EXECUTION_HISTORY_LIMIT, startExecution, withSchedule } from '../src/core/tasks.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

type GatewayRequest = {
  namespace: string
  method: string
  args: Record<string, unknown>
  signal?: AbortSignal
}

type GatewayHandler = (request: GatewayRequest) => unknown | Promise<unknown>
type FollowHandler = (request: GatewayRequest) => AsyncIterable<unknown> | Promise<AsyncIterable<unknown>>

function emptyStream(): AsyncIterable<unknown> {
  return { async *[Symbol.asyncIterator]() {} }
}

function makeGateway(handler: GatewayHandler, follow?: FollowHandler) {
  const invoke = vi.fn(async (request: GatewayRequest) => handler(request))
  const stream = vi.fn(async (request: GatewayRequest) => follow === undefined ? emptyStream() : follow(request))
  const gateway = { invoke, stream } as unknown as TypertGateway
  return { gateway, invoke, stream }
}

function sessionEvent(type: string, seq: number, time: number, data: unknown) {
  return { type: 'event' as const, event: { type, seq, time, data } }
}

function snapshot(records: readonly unknown[], cursor: number, hasMore: boolean) {
  return { type: 'snapshot' as const, header: {}, cursor, records, hasMore, projections: {} }
}

/**
 * Drain the fire-and-forget launch chain. The chain is gateway promises and
 * teammate spawns only, so flushing the microtask queue is deterministic and
 * needs no timer.
 */
async function flushLaunchChain(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
}

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-task-board-service-'))
  roots.push(value)
  return value
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

/**
 * A controllable Host timer face. The board arms exactly one schedule timer at
 * its next target, so a test reads the armed delay and fires that timer instead
 * of advancing real wall-clock time by a fixed heartbeat.
 * @returns the timer face plus the most recent schedule arming.
 */
function timerProbe() {
  let last: { callback: () => void; delay: number } | undefined
  const timers = {
    timeout(callback: () => void, delay: number): () => void {
      last = { callback, delay }
      return () => {}
    },
    interval(): () => void {
      return () => {}
    },
  }
  return {
    timers,
    /** Delay of the most recently armed schedule timer, in ms. */
    get delay(): number { return last?.delay ?? 0 },
    /** Fire the most recently armed schedule timer and flush its launch chain. */
    async trigger(): Promise<void> {
      const armed = last
      last = undefined
      armed?.callback()
      for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
    },
  }
}


describe('team-run dispatch', () => {
  /**
   * The gateway a run needs: create, rename, then prompt each session. When
   * given a sink it records every prompt the Host queued, in order.
   */
  function sessionGateway(leadId: string, prompts?: Array<{ sessionId: string; text: string }>) {
    let created = 0
    return makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') {
        created += 1
        return { sessionId: created === 1 ? leadId : `session-${created}` }
      }
      if (request.method === 'rename') return { title: 'root', seq: 1 }
      if (request.method === 'prompt') {
        const args = request.args.request as { sessionId: string; content: Array<{ text: string }> }
        prompts?.push({ sessionId: args.sessionId, text: args.content[0].text })
        return { accepted: true }
      }
      throw new Error('unexpected gateway call')
    })
  }

  /**
   * Drain the fire-and-forget launch chain. The chain is gateway promises and
   * teammate spawns only, so flushing the microtask queue is deterministic and
   * needs no timer.
   */
  async function settleMicrotasks(): Promise<void> {
    for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
  }

  function seedTeam(ledger: HostTaskLedger): void {
    ledger.applyRequest('seed-root', {
      kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'root', teamRun: true },
    })
    ledger.applyRequest('seed-a', { kind: 'create', id: 'a', input: { title: 'collect carbon', description: '', prompt: 'collect', parentId: 'root' } })
    ledger.applyRequest('seed-b', { kind: 'create', id: 'b', input: { title: 'model', description: '', prompt: 'model', parentId: 'root' } })
  }

  it('user running a team card spawns one teammate per subtask inside the Lead session', async () => {
    // Given a team-mode root with two subtasks and a working team dispatcher
    let now = new Date(2026, 7, 16, 10, 0, 0).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    seedTeam(ledger)
    const spawns: TeamSpawnInput[] = []
    const prompts: Array<{ sessionId: string; text: string }> = []
    const { gateway } = sessionGateway('session-lead', prompts)
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => now,
      team: {
        async spawn(input) {
          spawns.push(input)
          return { sessionId: 'member-' + input.name }
        },
      },
    })

    // When the user runs the root
    service.apply('run-1', { kind: 'run', taskId: 'root' })
    await settleMicrotasks()

    // Then the teammates hang off the Lead session, one per subtask, named and prompted
    // (the full snapshot advertises that this deployment can serve team runs)
    expect(service.snapshot().teamRunAvailable).toBe(true)
    expect(prompts[0].sessionId).toBe('session-lead')
    expect(prompts[0].text).toContain('Agent Team 的 Lead')
    // Only the Lead is prompted by the Host: the teammates are spawned, and
    // their prompt travels with the spawn call instead.
    expect(prompts).toHaveLength(1)
    expect(spawns.map(input => input.leadSessionId)).toEqual(['session-lead', 'session-lead'])
    expect(spawns.map(input => input.name)).toEqual([
      expect.stringMatching(/^collect-carbon-[0-9a-f]{4}-[0-9a-f]{8}$/),
      expect.stringMatching(/^model-[0-9a-f]{4}-[0-9a-f]{8}$/),
    ])
    // Two members of one run group can never share a name: Agent Teams refuses
    // the second spawn, which is how three subtasks of a real run never started.
    expect(new Set(spawns.map(input => input.name)).size).toBe(spawns.length)
    expect(spawns[0].prompt).toContain('collect')
    const tasks = ledger.state().tasks
    expect(tasks.find(task => task.id === 'root')?.executions.at(-1)?.sessionId).toBe('session-lead')
    expect(tasks.find(task => task.id === 'a')?.executions.at(-1)?.sessionId).toBe('member-' + spawns[0].name)
    expect(tasks.find(task => task.id === 'b')?.executions.at(-1)?.sessionId).toBe('member-' + spawns[1].name)
  })

  it('user running a team card in a deployment without Agent Teams is refused before anything opens', () => {
    // Given a team-mode root and a service that serves no team dispatcher
    const ledger = new HostTaskLedger(root(), () => NOW)
    seedTeam(ledger)
    const { gateway } = sessionGateway('session-lead')
    const service = new TaskBoardHostService(gateway, { ledger, power: new PowerInhibitor({ platform: 'linux' }), now: () => NOW })

    // When the user runs it
    // Then the run is refused and no execution is opened
    expect(() => service.apply('run-1', { kind: 'run', taskId: 'root' })).toThrow('Agent Teams is unavailable')
    expect(ledger.state().tasks.every(task => task.executions.length === 0)).toBe(true)
    expect(service.snapshot().teamRunAvailable).toBe(false)
  })

  it('operator whose teammate cannot be provisioned sees a failed subtask fold into the Lead', async () => {
    // Given a team dispatcher that reports a provisioning failure
    const ledger = new HostTaskLedger(root(), () => NOW)
    seedTeam(ledger)
    const { gateway } = sessionGateway('session-lead')
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => NOW,
      team: { async spawn() { return { error: 'provider missing' } } },
    })

    // When the user runs it and the Lead turn settles
    service.apply('run-1', { kind: 'run', taskId: 'root' })
    await settleMicrotasks()
    const leadExecution = ledger.state().tasks.find(task => task.id === 'root')?.executions.at(-1)?.id
    if (leadExecution === undefined) throw new Error('no Lead execution')
    ledger.settle('root', leadExecution, 'succeeded')

    // Then each subtask records the spawn failure and the Lead fails with them
    const child = ledger.state().tasks.find(task => task.id === 'a')
    expect(child?.executions.at(-1)?.result).toBe('failed')
    expect(child?.executions.at(-1)?.error).toContain('provider missing')
    expect(ledger.state().tasks.find(task => task.id === 'root')?.status).toBe('failed')
  })
})
describe('run prompt shape', () => {
  it('user running a plain cascade sees the independent sessions named in the root prompt', async () => {
    // Given a root with one subtask and no team opt-in
    const ledger = new HostTaskLedger(root(), () => NOW)
    ledger.applyRequest('seed-root', { kind: 'create', id: 'root', input: { title: 'root', description: '', prompt: 'do it' } })
    ledger.applyRequest('seed-a', {
      kind: 'create', id: 'a', input: { title: 'collect carbon', description: '', prompt: 'collect', parentId: 'root' },
    })
    const prompts: Array<{ sessionId: string; text: string }> = []
    const { gateway } = ((): ReturnType<typeof makeGateway> => {
      let created = 0
      return makeGateway(request => {
        if (request.namespace !== 'session') throw new Error('unexpected namespace')
        if (request.method === 'create') {
          created += 1
          return { sessionId: `session-${created}` }
        }
        if (request.method === 'rename') return { title: 'x', seq: 1 }
        if (request.method === 'prompt') {
          const args = request.args.request as { sessionId: string; content: Array<{ text: string }> }
          prompts.push({ sessionId: args.sessionId, text: args.content[0].text })
          return { accepted: true }
        }
        throw new Error('unexpected gateway call')
      })
    })()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => NOW,
    })

    // When the user runs the parent
    service.apply('run-1', { kind: 'run', taskId: 'root' })
    await flushLaunchChain()

    // Then the root prompt names the independent session it opens...
    const rootPrompt = prompts.find(entry => entry.sessionId === 'session-1')?.text ?? ''
    expect(rootPrompt).toContain('并发开启 1 个独立 DSH 会话')
    expect(rootPrompt).toContain('collect carbon')

    // ...while the subtask prompt stays its own instruction
    expect(prompts.find(entry => entry.sessionId === 'session-2')?.text).toBe('collect')
  })
})

describe('TaskBoardHostService scheduling without a browser', () => {
  it('fires one due run and records its independent session', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'scheduled', input: {
        title: 'Scheduled', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *' },
      },
    })
    const create = vi.fn(async (_request: GatewayRequest) => ({ sessionId: 'session-scheduled' }))
    const prompt = vi.fn(async (_request: GatewayRequest) => ({ accepted: true }))
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') return create(request)
      if (request.method === 'rename') return { title: 'Scheduled', seq: 1 }
      if (request.method === 'prompt') return prompt(request)
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()
    // The next cron instant after 10:00:30 is 10:01:00: the armed delay is exact.
    expect(probe.delay).toBe(30_000)

    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await probe.trigger()
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    expect(ledger.state().tasks[0].executions[0].sessionId).toBe('session-scheduled')
    // The schedule rolled to 10:02:00 and re-armed one minute out.
    expect(probe.delay).toBe(60_000)
    service.dispose()
  })

  it('user arming a one-shot sees it fire once and arm no further timer', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    // Given a one-shot plan armed at 10:02
    const at = new Date(2026, 7, 16, 10, 2, 0).getTime()
    ledger.applyRequest('create', {
      kind: 'create', id: 'once', input: {
        title: 'Once', description: '', prompt: 'work', schedule: { enabled: true, mode: 'once', at },
      },
    })
    const create = vi.fn(async (_request: GatewayRequest) => ({ sessionId: 'session-once' }))
    const prompt = vi.fn(async (_request: GatewayRequest) => ({ accepted: true }))
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') return create(request)
      if (request.method === 'rename') return { title: 'Once', seq: 1 }
      if (request.method === 'prompt') return prompt(request)
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()
    // The armed delay is exactly the distance to the planned instant.
    expect(probe.delay).toBe(at - now)

    // When the planned instant arrives
    now = at
    await probe.trigger()

    // Then one real execution was created and the rule spent itself
    expect(create).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    expect(ledger.state().tasks[0].schedule).toMatchObject({
      enabled: false, runCount: 1, endedReason: 'fired',
    })
    expect(ledger.state().tasks[0].schedule?.nextRunAt).toBeUndefined()
    // Nothing is armed for later, so the service cannot fire it a second time.
    expect(probe.delay).toBe(0)
    service.dispose()
  })

  it('user capping a recurring rule at two sees it stop after the second fire', async () => {
    // Given a recurring rule capped at two runs
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'capped', input: {
        title: 'Capped', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *', maxRuns: 2 },
      },
    })
    let created = 0
    const { gateway } = makeGateway(request => {
      if (request.method === 'create') return { sessionId: 'session-' + String(++created) }
      if (request.method === 'rename') return { title: 'Capped', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()
    expect(probe.delay).toBe(30_000)

    // When the first occurrence fires
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await probe.trigger()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    expect(ledger.state().tasks[0].schedule?.runCount).toBe(1)
    // Settle the run so the next occurrence has an idle card; the counter is
    // driven by the scheduler, not by the outcome.
    ledger.settle('capped', ledger.state().tasks[0].executions[0].id, 'succeeded')
    expect(probe.delay).toBe(60_000)

    // When the second occurrence fires
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    await probe.trigger()
    // Then two executions exist and the rule stopped itself at its cap
    expect(ledger.state().tasks[0].executions).toHaveLength(2)
    expect(ledger.state().tasks[0].schedule).toMatchObject({ enabled: false, runCount: 2, endedReason: 'limit' })
    // The budget is spent: no timer is armed for 10:03:00 or anything later.
    expect(probe.delay).toBe(0)
    service.dispose()
  })

  it('user restarting after a one-shot instant sees the missed plan skipped', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    // Given a one-shot plan armed just after the start time
    const at = new Date(2026, 7, 16, 10, 1, 0).getTime()
    ledger.applyRequest('create', {
      kind: 'create', id: 'once', input: {
        title: 'Once', description: '', prompt: '', schedule: { enabled: true, mode: 'once', at },
      },
    })
    const create = vi.fn()
    const { gateway } = makeGateway(request => request.method === 'create' ? create(request) : { items: [] })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })

    // When the service starts long after the planned instant
    now = new Date(2026, 7, 16, 10, 5, 0).getTime()
    service.start()

    // Then the missed instant is skipped, never replayed, and nothing charged
    expect(create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].schedule).toMatchObject({ enabled: false, endedReason: 'missed', runCount: 0 })
    expect(probe.delay).toBe(0)
    service.dispose()
  })

  it('user whose scheduled launch fails sees the run refunded, not silently spent', async () => {
    // Given a recurring rule capped at two runs and a gateway whose session
    // creation fails
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'capped', input: {
        title: 'Capped', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *', maxRuns: 2 },
      },
    })
    let failCreate = true
    const { gateway } = makeGateway(request => {
      if (request.method === 'create') {
        if (failCreate) throw new Error('session create failed')
        return { sessionId: 'session-ok' }
      }
      if (request.method === 'rename') return { title: 'Capped', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()

    // When the first occurrence fires and its launch fails before a session
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await probe.trigger()

    // Then the failure is recorded, the run is refunded rather than spent, and
    // the rule stays armed at its next occurrence (no immediate retry)
    const afterFirst = ledger.state().tasks[0]
    expect(afterFirst.executions).toHaveLength(1)
    expect(afterFirst.executions[0].result).toBe('failed')
    expect(afterFirst.schedule?.runCount).toBe(0)
    expect(afterFirst.schedule?.enabled).toBe(true)
    expect(afterFirst.schedule?.skippedReason).toBe('launch-failed')
    expect(probe.delay).toBe(60_000)

    // When the next two occurrences fire and their launches succeed (each
    // settled so the following one has an idle card)
    failCreate = false
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    await probe.trigger()
    ledger.settle('capped', ledger.state().tasks[0].executions[1].id, 'succeeded')
    now = new Date(2026, 7, 16, 10, 3, 0).getTime()
    await probe.trigger()

    // Then exactly two real runs were counted and the rule stopped at its cap:
    // the refunded failure consumed nothing
    const afterThird = ledger.state().tasks[0]
    expect(afterThird.executions).toHaveLength(3)
    expect(afterThird.schedule?.runCount).toBe(2)
    expect(afterThird.schedule?.endedReason).toBe('limit')
    expect(probe.delay).toBe(0)
    service.dispose()
  })

  it('does not launch an imported archived task with a legacy enabled schedule', async () => {
    const now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    const base = createTask({ title: 'Archived', description: '', prompt: '' }, now - 60_000, 'archived')
    const archived = {
      ...withSchedule(base, { enabled: true, cron: '* * * * *', nextRunAt: now, lastTriggeredAt: undefined }, now - 60_000),
      status: 'done' as const,
      archivedAt: now - 30_000,
    }
    ledger.applyRequest('import', { kind: 'import', sourceId: 'legacy', tasks: [archived] })
    const create = vi.fn()
    const { gateway } = makeGateway(request => request.method === 'create' ? create(request) : { items: [] })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()

    // The archived card is not an armed target, so nothing was ever armed.
    expect(probe.delay).toBe(0)
    expect(create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].executions).toEqual([])
    service.dispose()
  })

  it('skips a due occurrence on the recovery tick and rolls from current Host time', async () => {
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'scheduled', input: {
        title: 'Scheduled', description: '', prompt: '', schedule: { enabled: true, cron: '* * * * *' },
      },
    })
    const create = vi.fn()
    const { gateway } = makeGateway(request => request.method === 'create' ? create(request) : { items: [] })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    // Boot is a recovery point: the 10:01:00 occurrence armed while the Host was
    // down is skipped, and the schedule rolls from the current Host time.
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    service.start()
    expect(create).not.toHaveBeenCalled()
    expect(ledger.state().tasks[0].executions).toEqual([])
    expect(ledger.state().tasks[0].schedule?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 3, 0).getTime())
    // The skipped occurrence arms the next one instead of firing the stale one.
    expect(probe.delay).toBe(60_000)
    service.dispose()
  })

  it('user saving a new-task card with a cron sees its timer armed without a restart (#1855)', async () => {
    // Given a board that is already running and holds no schedule of its own
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    const create = vi.fn(async (_request: GatewayRequest) => ({ sessionId: 'session-scheduled' }))
    const prompt = vi.fn(async (_request: GatewayRequest) => ({ accepted: true }))
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') return create(request)
      if (request.method === 'rename') return { title: 'Scheduled', seq: 1 }
      if (request.method === 'prompt') return prompt(request)
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()
    // No card is scheduled yet, so there is no occurrence to wait for.
    expect(probe.delay).toBe(0)

    // When the new-task dialog is saved with the schedule option enabled
    service.apply('create-1', {
      kind: 'create', id: 'scheduled', input: {
        title: 'Scheduled', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *' },
      },
    })

    // Then the rule is in the ledger AND the timer is armed for it at once,
    // rather than waiting out whatever was armed before or for another write
    const saved = ledger.state().tasks.find(task => task.id === 'scheduled')
    expect(saved?.schedule).toMatchObject({ enabled: true, cron: '* * * * *' })
    expect(saved?.schedule?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 1, 0).getTime())
    expect(probe.delay).toBe(30_000)

    // And the armed occurrence really runs the card at that instant
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await probe.trigger()
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).toHaveBeenCalledOnce()
    expect(ledger.state().tasks[0].executions).toHaveLength(1)
    service.dispose()
  })

  it('operator whose capped rule refunded a failed launch sees it re-armed', async () => {
    // Given a rule capped at a single run, and a gateway whose session create fails
    let now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create', {
      kind: 'create', id: 'capped', input: {
        title: 'Capped', description: '', prompt: 'work', schedule: { enabled: true, cron: '* * * * *', maxRuns: 1 },
      },
    })
    let failCreate = true
    const create = vi.fn(async (_request: GatewayRequest) => {
      if (failCreate) throw new Error('session create failed')
      return { sessionId: 'session-ok' }
    })
    const { gateway } = makeGateway(request => {
      if (request.method === 'create') return create(request)
      if (request.method === 'rename') return { title: 'Capped', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      throw new Error('unexpected gateway call')
    })
    const probe = timerProbe()
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: probe.timers,
      now: () => now,
    })
    service.start()
    expect(probe.delay).toBe(30_000)

    // When the only occurrence of the budget fires and its launch fails before
    // any session existed: the fire spent the cap and cleared the target, and
    // the refund then returned the run and restored that target
    now = new Date(2026, 7, 16, 10, 1, 0).getTime()
    await probe.trigger()
    const refunded = ledger.state().tasks[0].schedule
    expect(refunded).toMatchObject({ enabled: true, runCount: 0 })
    expect(refunded?.endedReason).toBeUndefined()
    expect(refunded?.nextRunAt).toBe(new Date(2026, 7, 16, 10, 2, 0).getTime())
    // The restored occurrence is armed, not left waiting for the next write
    expect(probe.delay).toBe(60_000)

    // And it serves that occurrence, spending the returned budget exactly once
    failCreate = false
    now = new Date(2026, 7, 16, 10, 2, 0).getTime()
    await probe.trigger()
    expect(ledger.state().tasks[0].executions).toHaveLength(2)
    expect(ledger.state().tasks[0].schedule).toMatchObject({ enabled: false, runCount: 1, endedReason: 'limit' })
    expect(probe.delay).toBe(0)
    service.dispose()
  })

  it('treats the first session snapshot after re-enable as unknown', () => {
    const { gateway } = makeGateway(() => ({ items: [] }))
    const service = new TaskBoardHostService(gateway, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    service.power.updateReasons({ runningSessions: 0, armedSchedules: 0, sessionStateKnown: true })
    service.setConfiguration(false, true)
    service.setConfiguration(true, true)
    expect(service.power.snapshot().sessionStateKnown).toBe(false)
    service.dispose()
  })

  it('returns the first ledger result for a duplicate request id', () => {
    const { gateway } = makeGateway(() => ({ items: [] }))
    const service = new TaskBoardHostService(gateway, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    const first = service.apply('request-a', {
      kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' },
    })
    service.apply('request-b', {
      kind: 'create', id: 'task-b', input: { title: 'B', description: '', prompt: '' },
    })
    const duplicate = service.apply('request-a', {
      kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' },
    })
    expect(duplicate.revision).toBeGreaterThan(first.revision)
    expect(duplicate.tasks.map(task => task.id)).toEqual(['task-a', 'task-b'])
    expect(() => service.apply('request-a', {
      kind: 'create', id: 'ignored', input: { title: 'ignored', description: '', prompt: '' },
    })).toThrow('different action')
    service.dispose()
  })

  it('continues settling an open execution after the plugin is disabled even if task status drifted', async () => {
    const ledger = new HostTaskLedger(root())
    const base = createTask({ title: 'A', description: '', prompt: '' }, 1_000, 'task-a')
    const opened = startExecution(base, 1_100, 'execution-a').task
    const imported = {
      ...opened,
      status: 'todo' as const,
      executions: opened.executions.map(execution => ({ ...execution, sessionId: 'session-a' })),
    }
    ledger.applyRequest('import', { kind: 'import', sourceId: 'browser', tasks: [imported] })
    const { gateway, stream } = makeGateway(request => {
      if (request.method === 'list') return { items: [{ sessionId: 'session-a', running: false }] }
      if (request.method === 'page') return {
        records: [sessionEvent('turn/end', 10, 1_200, { reason: { kind: 'completed' } })],
        hasMore: false,
      }
      throw new Error('unexpected gateway call')
    }, () => ({
      async *[Symbol.asyncIterator]() {
        yield snapshot([], 10, true)
      },
    }))
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    service.setConfiguration(false, false)
    await (service as unknown as { pollSessions(): Promise<void> }).pollSessions()
    expect(ledger.state().tasks[0].executions[0].result).toBe('succeeded')
    expect(ledger.state().tasks[0].status).toBe('done')
    expect(stream).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('operator sees an execution reported failed when its session history stays unreadable', async () => {
    // Given a running execution whose session history cannot be read at all
    const ledger = new HostTaskLedger(root())
    const base = createTask({ title: 'A', description: '', prompt: '' }, 1_000, 'task-a')
    const opened = startExecution(base, 1_100, 'execution-a').task
    const imported = {
      ...opened,
      status: 'running' as const,
      executions: opened.executions.map(execution => ({ ...execution, sessionId: 'session-a' })),
    }
    ledger.applyRequest('import', { kind: 'import', sourceId: 'browser', tasks: [imported] })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { gateway } = makeGateway(request => {
      if (request.method === 'list') return { items: [{ sessionId: 'session-a', running: false }] }
      throw new Error('history offline')
    }, () => ({
      async *[Symbol.asyncIterator]() {
        throw new Error('follow offline')
      },
    }))
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    try {
      const poll = service as unknown as { pollSessions(): Promise<void> }
      // When the poll meets the unreadable history
      await poll.pollSessions()
      // Then the first failure is only reported: a transient reader failure must
      // never fail a card
      expect(ledger.state().tasks[0].status).toBe('running')
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('history is unreadable'))
      // And a sustained one is reported as a failure instead of hanging the card
      for (let turn = 0; turn < 30; turn += 1) await poll.pollSessions()
      const settled = ledger.state().tasks[0]
      expect(settled.executions[0].result).toBe('failed')
      expect(settled.status).toBe('failed')
      expect(settled.executions[0].error).toContain('the outcome cannot be determined')
    } finally {
      errors.mockRestore()
      service.dispose()
    }
  })

  it('operator with an empty board sees no session roster read at all', async () => {
    // Given an idle board and a gateway that refuses any call but a roster read
    let rosterReads = 0
    const { gateway } = makeGateway(request => {
      if (request.method === 'list') { rosterReads += 1; return { items: [] } }
      throw new Error('unexpected gateway call')
    })
    const service = new TaskBoardHostService(gateway, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
    })

    // When the poll ticks while nothing is running and no schedule is armed
    const poll = service as unknown as { pollSessions(): Promise<void> }
    await poll.pollSessions()
    await poll.pollSessions()

    // Then the persisted session roster is never read
    expect(rosterReads).toBe(0)
    service.dispose()
  })

  it('operator whose running card is parked without an execution still gets roster reads', async () => {
    // Given a board with a card in the running column and no tracked execution
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'running' })
    const list = vi.fn(async () => ({ items: [{ sessionId: 'session-a', running: true }] }))
    const { gateway } = makeGateway(request => {
      if (request.method === 'list') return list()
      throw new Error('unexpected gateway call')
    })
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })

    // When the poll ticks
    await (service as unknown as { pollSessions(): Promise<void> }).pollSessions()

    // Then the roster is read, because a hand-moved card's verdict may arrive
    // from a settle this process never observed
    expect(list).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('operator watching an idle board sees the roster read resume once a card runs', async () => {
    // Given an idle board whose session tree is live
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    const list = vi.fn(async () => ({ items: [{ sessionId: 'session-a', running: true }] }))
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') return { sessionId: 'session-a' }
      if (request.method === 'rename') return { title: 'A', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      if (request.method === 'list') return list()
      throw new Error('unexpected gateway call')
    })
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    const poll = service as unknown as { pollSessions(): Promise<void> }
    await poll.pollSessions()
    const whileIdle = list.mock.calls.length

    // When the card is run
    service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await flushLaunchChain()
    await poll.pollSessions()

    // Then the roster is read again, so the run can be settled
    expect(whileIdle).toBe(0)
    expect(list.mock.calls.length).toBe(1)
    service.dispose()
  })

  it('operator whose session tree stays down sees the retry back off instead of keeping the cadence', async () => {
    // Given a board watching a card and a session tree that rejects every read
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'running' })
    const list = vi.fn(async (): Promise<{ items: Array<{ sessionId: string; running: boolean }> }> => {
      throw new Error('session tree offline')
    })
    const { gateway } = makeGateway(request => request.method === 'list' ? list() : { items: [] })
    const armed: Array<{ callback: () => void; delay: number }> = []
    const timers = {
      timeout(callback: () => void, delay: number): () => void {
        armed.push({ callback, delay })
        return () => {}
      },
      interval(): () => void {
        return () => {}
      },
    }
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      timers,
    })
    try {
      // When consecutive passes meet the failing session tree
      const schedule = service as unknown as { schedulePoll(): void }
      schedule.schedulePoll()
      await flushLaunchChain()
      schedule.schedulePoll()
      await flushLaunchChain()
      schedule.schedulePoll()
      await flushLaunchChain()

      // Then each failure arms a longer retry than the configured cadence, and
      // the retry replaces the fixed heartbeat instead of adding to it
      expect(armed.map(entry => entry.delay)).toEqual([10_000, 20_000, 40_000])

      // And a pass that finally reads the roster arms no retry at all
      list.mockImplementation(async () => ({ items: [{ sessionId: 'session-a', running: true }] }))
      schedule.schedulePoll()
      await flushLaunchChain()
      expect(armed).toHaveLength(3)

      // So the next failure starts the ramp over instead of continuing it
      list.mockImplementation(async () => { throw new Error('session tree offline again') })
      schedule.schedulePoll()
      await flushLaunchChain()
      expect(armed.at(-1)?.delay).toBe(10_000)
    } finally {
      service.dispose()
    }
  })

  it('holds exactly one recurring poll timer, and start() is idempotent', () => {
    const interval = vi.fn((_callback: () => void, _delay: number) => () => {})
    const { gateway } = makeGateway(() => ({ items: [] }))
    const service = new TaskBoardHostService(gateway, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: { timeout: () => () => {}, interval },
    })
    service.start()
    service.start()
    // The schedule is a one-shot re-armed at each target, not a heartbeat, so
    // the session-roster poll is the only recurring timer the board owns.
    expect(interval).toHaveBeenCalledOnce()
    expect(interval.mock.calls[0]?.[1]).toBe(5_000)
    service.dispose()
  })

  it('operator editing the poll cadence sees the recurring timer re-armed at the new interval', () => {
    // Given a started board on the default cadence
    const interval = vi.fn((_callback: () => void, _delay: number) => () => {})
    const { gateway } = makeGateway(() => ({ items: [] }))
    const service = new TaskBoardHostService(gateway, {
      ledger: new HostTaskLedger(root()),
      power: new PowerInhibitor({ platform: 'linux' }),
      timers: { timeout: () => () => {}, interval },
    })
    service.start()
    expect(interval).toHaveBeenCalledOnce()

    // When the settings commit a slower cadence
    service.setConfiguration(true, false, 30)

    // Then the recurring timer is replaced at that cadence
    expect(interval).toHaveBeenCalledTimes(2)
    expect(interval.mock.calls[1]?.[1]).toBe(30_000)
    service.dispose()
  })

})

describe('TaskBoardHostService poll heartbeat', () => {
  function sessionsList(items: Array<{ sessionId: string; running: boolean }>) {
    return makeGateway(request => {
      if (request.namespace !== 'session' || request.method !== 'list') throw new Error('unexpected gateway call')
      return { items }
    }).gateway
  }

  it('does not push SSE frames while the session and power snapshots stay unchanged', async () => {
    // Given a board that is actually watching a card, so it does poll
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'running' })
    const service = new TaskBoardHostService(sessionsList([]), {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    let pushes = 0
    service.subscribe(() => { pushes += 1 })
    const poll = service as unknown as { pollSessions(): Promise<void> }
    await poll.pollSessions()
    // The first poll flips sessionStateKnown, so exactly one push is expected.
    expect(pushes).toBe(1)
    await poll.pollSessions()
    await poll.pollSessions()
    expect(pushes).toBe(1)
    service.dispose()
  })

  it('pushes an SSE frame when the running-session count changes', async () => {
    let items: Array<{ sessionId: string; running: boolean }> = []
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session' || request.method !== 'list') throw new Error('unexpected gateway call')
      return { items }
    })
    // Given a board that is watching a card, so it does poll
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    ledger.applyRequest('move', { kind: 'move', taskId: 'task-a', status: 'running' })
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    let pushes = 0
    service.subscribe(() => { pushes += 1 })
    const poll = service as unknown as { pollSessions(): Promise<void> }
    await poll.pollSessions()
    await poll.pollSessions()
    const before = pushes
    items = [{ sessionId: 'session-a', running: true }]
    await poll.pollSessions()
    expect(pushes).toBe(before + 1)
    service.dispose()
  })

  it('user running a parent starts one session per subtask with the inherited contract', async () => {
    // Given a parent and a subtask that inherits its pinned permission
    const now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root(), () => now)
    ledger.applyRequest('create-parent', {
      kind: 'create', id: 'parent', input: { title: 'Parent', description: '', prompt: 'work', permission: 'read-only', goalRun: true },
    })
    ledger.applyRequest('create-child', {
      kind: 'create', id: 'child', input: { title: 'Child', description: '', prompt: 'child work', parentId: 'parent', goalRun: true },
    })
    const sessions: string[] = []
    const permissions: string[] = []
    const { gateway } = makeGateway(request => {
      if (request.namespace !== 'session') throw new Error('unexpected namespace')
      if (request.method === 'create') {
        const sessionId = 'session-' + String(sessions.length + 1)
        sessions.push(sessionId)
        return { sessionId }
      }
      if (request.method === 'rename') return { title: 'renamed', seq: 1 }
      if (request.method === 'prompt') return { accepted: true }
      throw new Error('unexpected gateway call')
    })
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => now,
      // The native-/goal master switch is on AND both cards opted in: the
      // option is off by default, so this case asserts that every member of a
      // cascade that asked for it arms its own goal.
      goalRunEnabled: () => true,
      commandDispatcher: {
        execute: async (_sessionId, line) => { permissions.push(line); return { kind: 'success', text: 'ok' } as const },
      },
    })

    // When the user runs the parent
    service.apply('run-1', { kind: 'run', taskId: 'parent' })

    // Then both cards run in their own session under the inherited permission
    await vi.waitFor(() => {
      const attached = ledger.state().tasks.map(task => task.executions[0]?.sessionId)
      expect(new Set(attached).size).toBe(2)
    })
    expect([...sessions].sort()).toEqual(['session-1', 'session-2'])
    expect(permissions.filter(line => line.startsWith('/permission')).sort()).toEqual(['/permission read-only', '/permission read-only'])
    // Every member of the run also arms its own goal (each card opted in),
    // each with that member's own composed prompt.
    expect(permissions.filter(line => line.startsWith('/goal '))).toHaveLength(2)
    expect(ledger.state().tasks.map(task => task.status)).toEqual(['running', 'running'])
    service.dispose()
  })

  it('eventPayload carries revision/scheduler/power and never the task list', () => {
    const ledger = new HostTaskLedger(root())
    ledger.applyRequest('create', { kind: 'create', id: 'task-a', input: { title: 'A', description: '', prompt: '' } })
    const service = new TaskBoardHostService(sessionsList([]), {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    const payload = service.eventPayload()
    expect(payload).not.toHaveProperty('tasks')
    expect(payload.revision).toBe(ledger.state().revision)
    expect(payload.scheduler).toEqual(ledger.summary().scheduler)
    expect(payload.power).toEqual(service.power.snapshot())
    service.dispose()
  })

  it('settles open executions from the one session list each poll already fetched', async () => {
    const ledger = new HostTaskLedger(root())
    const base = createTask({ title: 'A', description: '', prompt: '' }, 1_000, 'task-a')
    const opened = startExecution(base, 1_100, 'execution-a').task
    const imported = {
      ...opened,
      executions: opened.executions.map(execution => ({ ...execution, sessionId: 'session-a' })),
    }
    ledger.applyRequest('import', { kind: 'import', sourceId: 'browser', tasks: [imported] })
    const list = vi.fn(async () => ({ items: [{ sessionId: 'session-a', running: false }] }))
    const page = vi.fn(async () => ({
      records: [sessionEvent('turn/end', 10, 1_200, { reason: { kind: 'completed' } })],
      hasMore: false,
    }))
    const { gateway, stream } = makeGateway(request => {
      if (request.method === 'list') return list()
      if (request.method === 'page') return page()
      throw new Error('unexpected gateway call')
    }, () => ({
      async *[Symbol.asyncIterator]() {
        yield snapshot([], 10, true)
      },
    }))
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
    })
    await (service as unknown as { pollSessions(): Promise<void> }).pollSessions()
    expect(ledger.state().tasks[0].executions[0].result).toBe('succeeded')
    expect(list).toHaveBeenCalledOnce()
    expect(stream).toHaveBeenCalledOnce()
    expect(page).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('keeps hot polling and scheduling off the full-state clone', async () => {
    const now = new Date(2026, 7, 16, 10, 0, 30).getTime()
    const ledger = new HostTaskLedger(root())
    const base = createTask({ title: 'A', description: '', prompt: '' }, now - 10_000, 'task-a')
    const executions = Array.from({ length: 2_000 }, (_, index) => ({
      id: 'settled-' + index,
      sessionId: 'old-session-' + index,
      startedAt: now - 8_000 - index * 2,
      endedAt: now - 7_999 - index * 2,
      result: 'succeeded' as const,
      error: undefined,
    }))
    const opened = startExecution({ ...base, executions }, now - 1_000, 'execution-open').task
    ledger.applyRequest('import', {
      kind: 'import',
      sourceId: 'browser',
      tasks: [{
        ...opened,
        executions: opened.executions.map(execution => execution.id === 'execution-open'
          ? { ...execution, sessionId: 'session-open' }
          : execution),
      }],
    })
    let sessionStateAvailable = false
    const list = vi.fn(async () => {
      if (!sessionStateAvailable) throw new Error('temporary list failure')
      return { items: [{ sessionId: 'session-open', running: true }] }
    })
    const { gateway } = makeGateway(request => request.method === 'list' ? list() : { items: [] })
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => now,
    })
    const state = vi.spyOn(ledger, 'state')
    const runtimeView = vi.spyOn(ledger, 'runtimeView')

    await (service as unknown as { pollSessions(): Promise<void> }).pollSessions()
    expect(runtimeView).toHaveBeenCalledOnce()
    sessionStateAvailable = true
    await (service as unknown as { pollSessions(): Promise<void> }).pollSessions()
    // Arming the schedule reads only the ledger's next target, never the
    // full-state clone the browser snapshot needs.
    service.refreshSchedule()

    expect(state).not.toHaveBeenCalled()
    // One projection decides whether the pass may stand down, and the second
    // re-reads what the roster RPC was in flight for.
    expect(runtimeView).toHaveBeenCalledTimes(3)
    // The 2,000-entry fixture is trimmed to the retention limit on append and
    // import, keeping snapshot and ledger size bounded.
    const snapshotValue = service.snapshot()
    expect(snapshotValue.tasks[0].executions).toHaveLength(EXECUTION_HISTORY_LIMIT)
    expect(snapshotValue.tasks[0].executions.at(-1)?.id).toBe('execution-open')
    expect(state).toHaveBeenCalledOnce()
    service.dispose()
  })

  it('installs error guards on streams without crashing on emitted error (#1427)', () => {
    installStreamErrorGuards()
    expect(() => {
      process.stderr.emit('error', Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))
      process.stdout.emit('error', Object.assign(new Error('EPIPE: broken pipe'), { code: 'EPIPE' }))
    }).not.toThrow()
  })

  it('safeConsoleError suppresses console.error exceptions (#1427)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      throw Object.assign(new Error('ENOSPC: write failed'), { code: 'ENOSPC' })
    })
    expect(() => {
      safeConsoleError('test message', new Error('sample'))
    }).not.toThrow()
    errorSpy.mockRestore()
  })
})

describe('workspace inheritance on creation', () => {
  function registryFace(items: readonly { id: string; updatedAt: string; sessionIds: readonly string[] }[]): TaskBoardWorkspaceRegistry {
    return { list: () => items } as unknown as TaskBoardWorkspaceRegistry
  }

  const deployments: readonly { id: string; updatedAt: string; sessionIds: readonly string[] }[] = [
    // The other workspace is the more recent one, so a passing test cannot be
    // riding on the recency fallback.
    { id: 'ws-other', updatedAt: '2026-09-30T09:00:00.000Z', sessionIds: ['session-other'] },
    { id: 'ws-mine', updatedAt: '2026-09-30T08:00:00.000Z', sessionIds: ['session-mine'] },
  ]

  function serviceFor(ledger: HostTaskLedger): TaskBoardHostService {
    const { gateway } = makeGateway(() => { throw new Error('creation must not call the gateway') })
    return new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => NOW,
      workspaceRegistry: registryFace(deployments),
    })
  }

  it('operator sees a root card created from a session inherit that session workspace', () => {
    // Given a deployment where session-mine lives in the older workspace
    const ledger = new HostTaskLedger(root(), () => NOW)
    const service = serviceFor(ledger)

    // When a root card is created from that session
    service.apply('create-1', {
      kind: 'create', id: 'card', input: { title: 'Card', description: '', prompt: 'work' },
    }, 'session-mine')

    // Then it carries the creating session's workspace, not the recent one
    expect(ledger.state().tasks.find(task => task.id === 'card')?.workspaceId).toBe('ws-mine')
    service.dispose()
  })

  it('operator sees an explicit pin win and a subtask inherit its lineage', () => {
    // Given the same deployment and a parent card created without a workspace
    const ledger = new HostTaskLedger(root(), () => NOW)
    const service = serviceFor(ledger)
    service.apply('create-parent', {
      kind: 'create', id: 'parent', input: { title: 'Parent', description: '', prompt: 'work' },
    }, 'session-of-nobody')

    // When a pinned root card and a subtask are created from session-mine
    service.apply('create-pinned', {
      kind: 'create', id: 'pinned', input: { title: 'Pinned', description: '', prompt: 'work', workspaceId: 'ws-explicit' },
    }, 'session-mine')
    service.apply('create-child', {
      kind: 'create', id: 'child', input: { title: 'Child', description: '', prompt: 'work', parentId: 'parent' },
    }, 'session-mine')

    // Then the explicit pin is kept, and the subtask keeps inheriting its parent instead
    const tasks = ledger.state().tasks
    expect(tasks.find(task => task.id === 'pinned')?.workspaceId).toBe('ws-explicit')
    expect(tasks.find(task => task.id === 'child')?.workspaceId).toBeUndefined()
    service.dispose()
  })
})
