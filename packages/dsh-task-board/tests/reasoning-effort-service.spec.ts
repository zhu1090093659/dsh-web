/**
 * The board's own launch path for a card's reasoning effort: the value goes
 * through the strict action gate and the ledger, and the Host hands it to the
 * execution session together with the model — using the SAME catalog snapshot
 * that freezes the acceptance contract, so one read decides both.
 *
 * The gateway is a contract fake (it answers exactly the calls one launch
 * makes) and the ledger is the real one in a scratch directory.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import type { ModelCatalogView } from '../src/core/model-catalog.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

const NOW = 1_700_000_000_000

const roots: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-board-effort-service-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A catalog declaring two efforts for the reasoner and none for the plain model. */
const catalog: ModelCatalogView = {
  default: { provider: 'deepseek', model: 'deepseek-chat' },
  groups: [{
    id: 'deepseek',
    models: [
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner', reasoning: { efforts: [{ id: 'high' }, { id: 'low' }], defaultEffort: 'low' } },
    ],
  }],
}

interface Harness {
  service: TaskBoardHostService
  selectModel: Array<Record<string, unknown>>
  /** Prompts actually queued into a session; a run that failed before prompting leaves this empty. */
  prompt: Array<Record<string, unknown>>
  /** Drain the fire-and-forget launch chain (gateway promises only). */
  settle: () => Promise<void>
}

/** A live board whose launch calls are recorded; `rejectSelectModel` refuses the model route. */
function harness(options: { catalog?: ModelCatalogView; rejectSelectModel?: boolean } = {}): Harness {
  const selectModel: Array<Record<string, unknown>> = []
  const prompt: Array<Record<string, unknown>> = []
  let created = 0
  const gateway = {
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
    invoke: async (request: { namespace: string; method: string; args: Record<string, unknown> }) => {
      if (request.namespace === 'agentPresets') return { presets: [] }
      const payload = (request.args.request ?? {}) as Record<string, unknown>
      if (request.method === 'create') {
        created += 1
        return { sessionId: 'session-' + String(created) }
      }
      if (request.method === 'rename') return { title: payload.title, seq: 1 }
      if (request.method === 'selectModel') {
        selectModel.push(payload)
        if (options.rejectSelectModel === true) throw new Error('session/selectModel refused the route')
        return { selected: { provider: payload.provider, model: payload.model } }
      }
      if (request.method === 'prompt') {
        prompt.push(payload)
        return { accepted: true }
      }
      throw new Error('unexpected gateway call: ' + request.method)
    },
  } as unknown as TypertGateway
  const service = new TaskBoardHostService(gateway, {
    ledger: new HostTaskLedger(scratch(), () => NOW),
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    ...(options.catalog === undefined ? {} : { modelCatalog: async () => options.catalog }),
    workspaceRegistry: fixtureWorkspaces(),
  })
  return {
    service,
    selectModel,
    prompt,
    settle: async () => { for (let turn = 0; turn < 50; turn += 1) await Promise.resolve() },
  }
}

/** One card created through the strict action gate the browser posts to. */
function seedCard(live: Harness, id: string, input: Record<string, unknown>): void {
  live.service.apply('seed-' + id, { kind: 'create', id, input: { title: id, description: '', prompt: 'do work', ...input } })
}

describe('reasoning effort on a board-launched execution', () => {
  it('user running a card that pins a declared effort sees it reach the new session', async () => {
    // Given a board whose catalog declares the effort for the pinned model
    const live = harness({ catalog })
    seedCard(live, 'task-a', { model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' })

    // When the user runs the card
    live.service.apply('run-task-a', { kind: 'run', taskId: 'task-a' })
    await live.settle()

    // Then the execution session is composed at that model route and that effort
    expect(live.selectModel).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.service.snapshot().tasks[0]?.executions).toHaveLength(1)
  })

  it('user running a card switched to a model without that level sees no effort sent', async () => {
    // Given a card whose effort its pinned plain model does not declare
    const live = harness({ catalog })
    seedCard(live, 'task-a', { model: 'deepseek/deepseek-chat', reasoningEffort: 'high' })

    // When the user runs the card
    live.service.apply('run-task-a', { kind: 'run', taskId: 'task-a' })
    await live.settle()

    // Then the model is selected without any effort, and the run still opens
    expect(live.selectModel).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-chat' }])
    expect(live.service.snapshot().tasks[0]?.executions).toHaveLength(1)
  })

  it('user running a card on a deployment without a model catalog sees the effort withheld', async () => {
    // Given a board that serves no host model catalog
    const live = harness()
    seedCard(live, 'task-a', { model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' })

    // When the user runs the card
    live.service.apply('run-task-a', { kind: 'run', taskId: 'task-a' })
    await live.settle()

    // Then nothing unverifiable is sent, while the model pin itself stands
    expect(live.selectModel).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-reasoner' }])
  })

  it('user clearing a card effort and running it again leaves the model at its own default', async () => {
    // Given a card whose effort was cleared through the board
    const live = harness({ catalog })
    seedCard(live, 'task-a', { model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' })
    live.service.apply('clear-task-a', { kind: 'update', taskId: 'task-a', patch: { reasoningEffort: '' } })

    // When the user runs the card
    live.service.apply('run-task-a', { kind: 'run', taskId: 'task-a' })
    await live.settle()

    // Then the card stores nothing and the session keeps the model's own default level
    expect(live.service.snapshot().tasks[0]?.reasoningEffort).toBeUndefined()
    expect(live.selectModel).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-reasoner' }])
  })

  it('user whose confirmed effort the session refuses sees the run fail with an empty prompt queue', async () => {
    // Given a card whose declared model/effort pair the gateway refuses
    const live = harness({ catalog, rejectSelectModel: true })
    seedCard(live, 'task-a', { model: 'deepseek/deepseek-reasoner', reasoningEffort: 'high' })

    // When the user runs the card
    live.service.apply('run-task-a', { kind: 'run', taskId: 'task-a' })
    await live.settle()

    // Then the attempt is recorded as a visible failure with the refusal reason,
    // and no prompt was ever queued into a session running at the wrong level
    const execution = live.service.snapshot().tasks[0]?.executions[0]
    expect(live.selectModel).toEqual([{ sessionId: 'session-1', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high' }])
    expect(live.prompt).toEqual([])
    expect(execution?.result).toBe('failed')
    expect(execution?.error).toContain('refused the route')
  })
})
