/**
 * Goal acceptance at execution start and at settlement: the frozen contract,
 * the applicability of each run shape, and the rule that a succeeded verdict
 * without a matching acceptance pass record cannot settle a card as done.
 *
 * The Host service, the ledger and the runner are the real ones; only the
 * gateway and the model catalog are contract-shaped fakes.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { NEVER_INVOKED_VERIFICATION_REASON, NO_MATCHING_PASS_VERIFICATION_REASON, TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import { resolveContract, type ModelCatalogView, type VerificationSettings } from '../src/core/verification.ts'

const NOW = 1_700_000_000_000
const roots: string[] = []
afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-task-board-verify-'))
  roots.push(value)
  return value
}

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }

const WIRE_ARGS: Record<string, Record<string, readonly string[]>> = {
  agentPresets: { list: [] },
  session: {
    create: ['request'],
    rename: ['request'],
    prompt: ['request'],
    selectModel: ['request'],
    list: ['_request'],
    follow: ['request'],
    page: ['request'],
    projections: ['request'],
    modelCatalog: [],
  },
}

function assertWireArgs(request: GatewayRequest): void {
  const expected = WIRE_ARGS[request.namespace]?.[request.method]
  if (expected === undefined) throw new Error('unexpected endpoint ' + request.namespace + '/' + request.method)
  const actual = Object.keys(request.args)
  const drift = [...expected.filter(key => !actual.includes(key)), ...actual.filter(key => !expected.includes(key))]
  if (drift.length !== 0) throw new Error('arguments-invalid for ' + request.namespace + '/' + request.method + ': ' + drift.join(','))
}

function sessionEvent(type: string, seq: number, time: number, data: unknown) {
  return { type: 'event' as const, event: { type, seq, time, data } }
}

function snapshot(records: readonly unknown[], cursor: number, hasMore: boolean) {
  return { type: 'snapshot' as const, header: {}, cursor, records, hasMore, projections: {} }
}

async function settleMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 60; turn += 1) await Promise.resolve()
}

/** The host model catalog: the acceptance contract resolves its route from it. */
function catalog(): ModelCatalogView {
  return {
    default: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    groups: [{ id: 'deepseek-official', models: [{ id: 'deepseek-flash', reasoning: { efforts: [{ id: 'high' }], defaultEffort: 'high' } }] }],
  }
}

/** A deployments' timetable probe: the board arms one poll interval and one schedule timeout. */
function timers() {
  const intervals: Array<() => void> = []
  const timeouts: Array<{ callback: () => void; delay: number }> = []
  return {
    face: {
      timeout(callback: () => void, delay: number): () => void {
        timeouts.push({ callback, delay })
        return () => {}
      },
      interval(callback: () => void): () => void {
        intervals.push(callback)
        return () => {}
      },
    },
    /** Run every armed poll once, as the 5 s heartbeat would. */
    async poll(): Promise<void> {
      for (const callback of [...intervals]) callback()
      await settleMicrotasks()
      await settleMicrotasks()
    },
    /** Fire the most recently armed schedule timer. */
    async fireSchedule(): Promise<void> {
      const armed = timeouts.pop()
      armed?.callback()
      await settleMicrotasks()
    },
    get lastDelay(): number { return timeouts.at(-1)?.delay ?? 0 },
  }
}

/** The command results the runner accepts from its dispatcher. */
type CommandResultLike =
  | { readonly kind: 'success', readonly text?: string }
  | { readonly kind: 'error', readonly text: string }

interface Harness {
  service: TaskBoardHostService
  ledger: HostTaskLedger
  settings: VerificationSettings
  timer: ReturnType<typeof timers>
  goals: { phase: string }
  turn: { reason: string }
  commandResult: CommandResultLike
  /** The Host clock the test can advance (the scheduler fires on it). */
  clock: { value: number }
}

/** Build the real service over a gateway double. */
function harness(overrides: {
  settings?: VerificationSettings
  catalog?: ModelCatalogView
  commandResult?: CommandResultLike
  now?: () => number
} = {}): Harness {
  const clock = { value: overrides.now === undefined ? NOW : overrides.now() }
  const now = (): number => clock.value
  const ledger = new HostTaskLedger(root(), now)
  const settings = overrides.settings ?? { enabled: true, model: '', reasoningEffort: '' }
  // 'none' means the deployment holds no goal for the session at all.
  const goals = { phase: 'none' }
  const turn = { reason: 'completed' }
  const commandResult: CommandResultLike = overrides.commandResult ?? { kind: 'success' }
  const timer = timers()
  let created = 0
  const gateway = {
    invoke: async (request: GatewayRequest) => {
      assertWireArgs(request)
      if (request.namespace === 'agentPresets') return { presets: [] }
      switch (request.method) {
        case 'create':
          created += 1
          return { sessionId: 'session-' + String(created) }
        case 'rename':
          return { title: 'renamed', seq: 1 }
        case 'prompt':
          return { accepted: true }
        case 'selectModel':
          return { ok: true }
        case 'modelCatalog':
          return overrides.catalog ?? catalog()
        case 'projections':
          return goals.phase === 'none'
            ? { values: {} }
            : { values: { goal: { goal: { id: 'goal-1', revision: 2, phase: goals.phase }, roundsStarted: 1 } } }
        case 'list':
          return { items: [{ sessionId: 'session-1', running: false, agentAvailable: false, updatedAt: NOW, blank: false }] }
        default:
          throw new Error('unexpected gateway call ' + request.method)
      }
    },
    stream: async (request: GatewayRequest) => {
      assertWireArgs(request)
      if (request.method !== 'follow') throw new Error('unexpected stream ' + request.method)
      return {
        async *[Symbol.asyncIterator]() {
          yield snapshot([sessionEvent('turn/end', 10, NOW + 100, { reason: { kind: turn.reason } })], 10, false)
        },
      }
    },
  } as unknown as TypertGateway
  const service = new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now,
    timers: timer.face,
    commandDispatcher: { execute: async () => commandResult },
    verificationSettings: () => settings,
    verificationCatalog: async () => overrides.catalog ?? catalog(),
  })
  service.start()
  return { service, ledger, settings, timer, goals, turn, commandResult, clock }
}

/** Seed one plain task. */
function seed(ledger: HostTaskLedger, input: { id: string, goalRun?: boolean, skipVerification?: boolean, schedule?: { enabled: boolean, cron: string } } = { id: 'task-a' }): void {
  ledger.applyRequest('seed-' + input.id, {
    kind: 'create',
    id: input.id,
    input: {
      title: 'Ship it',
      description: '',
      prompt: 'do work',
      ...(input.goalRun === undefined ? {} : { goalRun: input.goalRun }),
      ...(input.skipVerification === undefined ? {} : { skipVerification: input.skipVerification }),
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    },
  })
}

/** The latest execution of one task. */
function executionOf(harnessed: Harness, taskId = 'task-a') {
  const execution = harnessed.ledger.getTask(taskId)?.executions.at(-1)
  if (execution === undefined) throw new Error('no execution')
  return execution
}

describe('goal acceptance at execution start', () => {
  it('user running a goal task sees the acceptance contract frozen and bound before the prompt', async () => {
    // Given: acceptance on with the host-inherited judge route
    const h = harness()
    seed(h.ledger)

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the execution carries the resolved contract, is enforced, and is
    // already bound to its session.
    const execution = executionOf(h)
    expect(execution.sessionId).toBe('session-1')
    expect(execution.verification?.contract.enabled).toBe(true)
    expect(execution.verification?.contract.modelSource).toBe('inherit')
    expect(execution.verification?.contract.route).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' })
    expect(execution.verification?.applicability).toBe('enforced')
    expect(execution.verification?.attempts).toHaveLength(0)
  })

  it('user switching task acceptance off sees the execution open without enforcement', async () => {
    // Given: the switch off
    const h = harness({ settings: { enabled: false, model: '', reasoningEffort: '' } })
    seed(h.ledger)

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the contract records the switch and nothing is enforced.
    const execution = executionOf(h)
    expect(execution.verification?.contract.enabled).toBe(false)
    expect(execution.verification?.applicability).toBe('disabled')
  })

  it('user whose card checks Skip acceptance sees the gate off with its own reason', async () => {
    // Given: the board-wide switch ON, but this card opted out
    const h = harness()
    seed(h.ledger, { id: 'task-a', skipVerification: true })

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: nothing is enforced, and the record names the CARD, not the switch.
    const execution = executionOf(h)
    expect(execution.verification?.contract.enabled).toBe(false)
    expect(execution.verification?.applicability).toBe('skipped')
  })

  it('user opting a card back in sees the board-wide switch decide again', async () => {
    // Given: the same card with the opt-out cleared
    const h = harness()
    seed(h.ledger, { id: 'task-a' })

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the gate is enforced exactly as on a card that never touched it.
    const execution = executionOf(h)
    expect(execution.verification?.contract.enabled).toBe(true)
    expect(execution.verification?.applicability).toBe('enforced')
  })

  it('user whose task pins a single plain turn sees no enforcement', async () => {
    // Given: a card opted out of goal form
    const h = harness()
    seed(h.ledger, { id: 'task-a', goalRun: false })

    // When: the user runs it
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the run never becomes a goal run, and acceptance does not govern it.
    expect(executionOf(h).verification?.applicability).toBe('goal-unavailable')
  })

  it('user whose deployment refuses /goal sees the execution record that acceptance could not be enforced', async () => {
    // Given: a /goal refusal
    const h = harness({ commandResult: { kind: 'error', text: 'no goal command' } })
    seed(h.ledger)

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the refusal is recorded explicitly instead of silently looking verified.
    expect(executionOf(h).verification?.applicability).toBe('goal-unavailable')
    expect(executionOf(h).verification?.contract.enabled).toBe(true)
  })

  it('user pinning a judge model the catalog does not declare sees the explicit route frozen without a blind effort', async () => {
    // Given: an explicit model with an effort its adapter does not declare
    const h = harness({ settings: { enabled: true, model: 'deepseek-official/deepseek-flash', reasoningEffort: 'max' } })
    seed(h.ledger)

    // When: the user runs the card
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the incompatible level is never sent; the fallback is recorded.
    const contract = executionOf(h).verification?.contract
    expect(contract?.modelSource).toBe('explicit')
    expect(contract?.route).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' })
    expect(contract?.effortFallback).toEqual({ requested: 'max', resolved: 'high' })
  })

  it('user whose scheduled run opens sees the same frozen acceptance contract', async () => {
    // Given: a card with an armed every-minute schedule
    const h = harness()
    seed(h.ledger, { id: 'task-a', schedule: { enabled: true, cron: '* * * * *' } })
    h.service.refreshSchedule()
    const delay = h.timer.lastDelay

    // When: the Host clock reaches the armed trigger and it fires
    h.clock.value += delay
    await h.timer.fireSchedule()

    // Then: the cron execution was opened with an enforced, frozen contract.
    const executions = h.ledger.getTask('task-a')?.executions ?? []
    expect(executions).toHaveLength(1)
    expect(executions[0]!.verification?.contract.route).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' })
    expect(executions[0]!.verification?.applicability).toBe('enforced')
    expect(delay).toBeGreaterThan(0)
  })

  it('user reading the resolved acceptance options sees the configuration and the catalog', async () => {
    // Given: a live configuration that inherits the host route
    const h = harness()

    // When: the settings card asks for the resolved options
    const options = await h.service.verificationOptions()

    // Then: the resolved contract and the catalog travel together.
    expect(options.settings.enabled).toBe(true)
    expect(options.contract.route?.model).toBe('deepseek-flash')
    expect(options.catalog.default?.provider).toBe('deepseek-official')
  })
})

describe('goal acceptance at settlement', () => {
  it('user whose goal completed without the acceptance gate ever running sees the never-invoked reason', async () => {
    // Given: a running goal execution whose acceptance recorded nothing
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    h.goals.phase = 'complete'

    // When: the roster poll observes a completed turn
    await h.timer.poll()

    // Then: the succeeded verdict is refused, and the reason names the missing
    // completion call rather than a delivery the judge rejected.
    const execution = executionOf(h)
    expect(execution.result).toBe('failed')
    expect(execution.error).toBe(NEVER_INVOKED_VERIFICATION_REASON)
    expect(h.ledger.getTask('task-a')?.status).toBe('failed')
  })

  it('user reading a failed card is told which of the two directions to investigate', () => {
    // Given the two terminal reasons the board can settle a goal execution with
    const neverInvoked = NEVER_INVOKED_VERIFICATION_REASON
    const judged = NO_MATCHING_PASS_VERIFICATION_REASON

    // When the card error text is read
    const blamed = [neverInvoked.includes('update_goal'), judged.includes('update_goal')]

    // Then each names its own cause: a missing completion call (a tool-adherence
    // problem, explicitly not a quality verdict) versus a judged delivery, and
    // neither text can be mistaken for the other.
    expect(blamed).toEqual([true, false])
    expect(neverInvoked).toContain('这不是质量判负')
    expect(judged).toContain('没有匹配的验收通过记录')
  })

  it('user whose judge rejected the work sees the no-matching-pass reason instead', async () => {
    // Given: a running goal execution holding a quality verdict that failed
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const execution = executionOf(h)
    const contract = execution.verification!.contract
    h.ledger.setVerification('task-a', execution.id, {
      contract,
      attempts: [{
        index: 1,
        at: NOW + 50,
        stage: 'quality',
        passed: false,
        score: 0.3,
        baseline: 0.1,
        criteria: [],
        findings: ['the patch was never applied'],
        usage: { calls: 6, inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
        evidence: { chars: 10, omittedCharacters: 0, entries: 1, hash: 'h' },
        route: contract.route!,
        channel: 'explicit-tag',
        rounds: 2,
      }],
      applicability: 'enforced',
    })
    h.goals.phase = 'complete'

    // When: the poll observes the completed goal with the judged cycle on record
    await h.timer.poll()

    // Then: the judge ran and refused, so the card fails with the judged-work
    // reason and never blames a missing completion call.
    const settled = executionOf(h)
    expect(settled.result).toBe('failed')
    expect(settled.error).toBe(NO_MATCHING_PASS_VERIFICATION_REASON)
    expect(settled.error).not.toContain('update_goal')
  })

  it('user whose judge route only produced anomalies sees the no-matching-pass reason', async () => {
    // Given: the #1828 shape — the gate opened and every attempt was an anomaly
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const execution = executionOf(h)
    const contract = execution.verification!.contract
    h.ledger.setVerification('task-a', execution.id, {
      contract,
      attempts: [{
        index: 1,
        at: NOW + 50,
        stage: 'exception',
        passed: false,
        score: 0,
        baseline: 0,
        criteria: [],
        findings: [],
        usage: { calls: 1, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
        evidence: { chars: 0, omittedCharacters: 0, entries: 0, hash: '' },
        route: contract.route!,
        channel: 'explicit-tag',
        rounds: 0,
        error: 'judge request timed out after 150 s',
      }],
      applicability: 'enforced',
    })
    h.goals.phase = 'complete'

    // When: the poll settles the run
    await h.timer.poll()

    // Then: the judge was reached, so this is not a never-invoked gate.
    const settled = executionOf(h)
    expect(settled.result).toBe('failed')
    expect(settled.error).toBe(NO_MATCHING_PASS_VERIFICATION_REASON)
  })

  it('user whose goal was paused before acceptance sees it fail rather than pass', async () => {
    // Given: a running goal execution that the user paused
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    h.goals.phase = 'paused'

    // When: the poll reads the paused goal with a completed turn
    await h.timer.poll()

    // Then: paused is not a pass: the card fails, and since the judge never ran
    // the reason is the never-invoked one.
    expect(executionOf(h).result).toBe('failed')
    expect(executionOf(h).error).toBe(NEVER_INVOKED_VERIFICATION_REASON)
  })

  it('user whose goal projection cannot be read is not settled as verified', async () => {
    // Given: a running goal execution and a gateway that cannot answer projections
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    // Only the projection read fails; the roster still answers.
    const runner = h.service.runner as unknown as { invoke: (namespace: string, method: string, request: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown> }
    const original = runner.invoke.bind(runner)
    runner.invoke = async (namespace, method, request, signal) =>
      method === 'projections' ? Promise.reject(new Error('projection unreadable')) : await original(namespace, method, request, signal)

    // When: the poll runs
    await h.timer.poll()

    // Then: the old fallback path does not turn an unreadable projection into a
    // pass: the execution is refused and the card fails, naming the acceptance
    // that never ran.
    expect(executionOf(h).result).toBe('failed')
    expect(executionOf(h).error).toBe(NEVER_INVOKED_VERIFICATION_REASON)
    expect(h.ledger.getTask('task-a')?.status).toBe('failed')
  })

  it('user whose acceptance passed sees the card settle done', async () => {
    // Given: a running goal execution that already holds a pass record
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const execution = executionOf(h)
    const contract = execution.verification!.contract
    h.ledger.setVerification('task-a', execution.id, {
      contract,
      attempts: [{
        index: 1,
        at: NOW + 50,
        stage: 'quality',
        passed: true,
        score: 0.9,
        baseline: 0,
        criteria: [],
        findings: [],
        usage: { calls: 6, inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
        evidence: { chars: 10, omittedCharacters: 0, entries: 1, hash: 'h' },
        route: contract.route!,
        channel: 'explicit-tag',
        rounds: 2,
      }],
      applicability: 'enforced',
    })
    h.goals.phase = 'complete'

    // When: the poll observes the completed goal
    await h.timer.poll()

    // Then: the matching pass record settles the card as done.
    expect(executionOf(h).result).toBe('succeeded')
    expect(h.ledger.getTask('task-a')?.status).toBe('done')
  })

  it('user whose acceptance cycle already failed sees the card settle failed without another inspection', async () => {
    // Given: an execution whose gate closed the cycle with a recorded reason
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const execution = executionOf(h)
    h.ledger.setVerification('task-a', execution.id, {
      ...execution.verification!,
      failedReason: 'goal 验收第 2 次仍未通过（总分 10.0%，阈值 65%）',
      failedAt: NOW + 60,
    })

    // When: the poll runs while the goal is still active
    await h.timer.poll()

    // Then: the recorded verdict settles the card instead of holding it in the
    // running column forever.
    expect(executionOf(h).result).toBe('failed')
    expect(executionOf(h).error).toContain('第 2 次仍未通过')
  })

  it('user running a plain-turn task sees the historical turn verdict settle it', async () => {
    // Given: a card pinned to a single plain turn
    const h = harness()
    seed(h.ledger, { id: 'task-a', goalRun: false })
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // When: the poll observes its completed turn
    await h.timer.poll()

    // Then: no acceptance is required of a non-goal execution.
    expect(executionOf(h).result).toBe('succeeded')
  })

  it('user whose card skipped acceptance sees the turn verdict settle it', async () => {
    // Given: a goal-form run on a card that opted out
    const h = harness()
    seed(h.ledger, { id: 'task-a', skipVerification: true })
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    expect(executionOf(h).verification?.applicability).toBe('skipped')

    // When: the poll observes its completed turn
    await h.timer.poll()

    // Then: the card settles on the historical verdict, with no pass record.
    expect(executionOf(h).result).toBe('succeeded')
  })

  it('user with an execution that started before the feature sees it settle on the historical verdict', async () => {
    // Given: an open execution carrying no acceptance block (a pre-v5 record)
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const execution = executionOf(h)
    h.ledger.setVerification('task-a', execution.id, undefined as never)
    expect(executionOf(h).verification).toBeUndefined()

    // When: the poll observes its completed turn
    await h.timer.poll()

    // Then: nothing is retroactively enforced.
    expect(executionOf(h).result).toBe('succeeded')
  })

  it('user switching acceptance on later sees only later executions enforced', async () => {
    // Given: a card whose first execution ran while acceptance was off
    const offSettings: VerificationSettings = { enabled: false, model: '', reasoningEffort: '' }
    const h = harness({ settings: offSettings })
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const first = executionOf(h)
    expect(first.verification?.contract.enabled).toBe(false)
    h.ledger.settle('task-a', first.id, 'succeeded')

    // When: acceptance is switched on and the card runs again
    const enabled: VerificationSettings = { enabled: true, model: '', reasoningEffort: '' }
    const h2 = harness({ settings: enabled })
    seed(h2.ledger)
    h2.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the new execution is enforced with its own contract, while the old
    // record keeps the switch state it ran under.
    expect(executionOf(h2).verification?.contract.enabled).toBe(true)
    expect(executionOf(h2).verification?.applicability).toBe('enforced')
    expect(first.verification?.contract.enabled).toBe(false)
  })

  it('user with a reused session sees the acceptance contract of the new execution', async () => {
    // Given: a task that reuses its session and already settled once
    const h = harness()
    seed(h.ledger)
    h.service.apply('run-1', { kind: 'run', taskId: 'task-a' })
    await settleMicrotasks()
    const first = executionOf(h)
    h.ledger.settle('task-a', first.id, 'failed', 'first attempt')
    h.ledger.applyRequest('reuse-flag', { kind: 'update', taskId: 'task-a', patch: { reuseSession: true } })

    // When: the card runs again in the same session
    h.service.apply('run-2', { kind: 'rerun', taskId: 'task-a' })
    await settleMicrotasks()

    // Then: the new execution carries its OWN contract and an untouched budget.
    const second = h.ledger.getTask('task-a')!.executions.at(-1)!
    expect(second.id).not.toBe(first.id)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.verification?.attempts).toHaveLength(0)
    expect(second.verification?.contract.enabled).toBe(true)
  })
})

describe('goal acceptance contract resolution', () => {
  it('user whose configured model is not a route sees the host default substituted and reported', () => {
    // Given: a hand-edited configuration that names no provider
    const settings: VerificationSettings = { enabled: true, model: 'deepseek-flash', reasoningEffort: '' }

    // When: the contract resolves against the host catalog
    const contract = resolveContract(settings, catalog())

    // Then: the host default is used and the configuration problem is reported.
    expect(contract.modelSource).toBe('inherit')
    expect(contract.route?.model).toBe('deepseek-flash')
  })
})
