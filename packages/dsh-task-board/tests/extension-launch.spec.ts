/**
 * The optional launch seam of the external provider contract: a provider is
 * asked once per run — before a session exists and before an execution record is
 * written — whether the run is its own.
 *
 * Everything runs through the real registry, the real ledger and the real Host
 * service over a scripted gateway, so what is asserted is the board's own
 * behaviour: the prompt it really queues, the session it really creates, the
 * record it really writes, and what it writes instead when a provider takes the
 * run over.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { buildTaskBoardTools } from '../src/host/agent-tools.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import type { TaskBoardExtensionLogger } from '../src/host/extension-registry.ts'
import { startExecution, type TaskPermission, type TaskRecord, type TaskTag } from '../src/core/tasks.ts'
import {
  TASK_BOARD_API_VERSION,
  type TaskBoardLaunchContext,
  type TaskBoardLaunchDecision,
  type TaskBoardLaunchHandler,
  type TaskBoardLaunchTrigger,
  type TaskBoardExtension,
  type TaskBoardExtensionHost,
} from '../src/core/extension.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000
const MINUTE = 60_000

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ext-launch-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown> }

/** One message the board queued into a session. */
interface DeliveredPrompt {
  sessionId: string
  text: string
  mode: string
}

/**
 * The gateway a launch needs: the preset registry, the session roster, session
 * creation, renames and prompts. It records every create and every prompt, so a
 * test can read which session the board asked for and what it said.
 */
function scriptedGateway(script: { roster?: Array<{ sessionId: string; running: boolean }> } = {}) {
  const prompts: DeliveredPrompt[] = []
  const creates: Array<{ workspaceId?: string; agentPreset?: string }> = []
  let created = 0
  async function invoke(request: GatewayRequest): Promise<unknown> {
    const body = (request.args.request ?? {}) as Record<string, unknown>
    if (request.namespace === 'agentPresets' && request.method === 'list') return { presets: [] }
    if (request.namespace !== 'session') throw new Error('unexpected namespace: ' + request.namespace)
    if (request.method === 'modelCatalog') return {}
    if (request.method === 'list') return { items: script.roster ?? [] }
    if (request.method === 'create') {
      created += 1
      creates.push(body as { workspaceId?: string; agentPreset?: string })
      return { sessionId: 'session-' + String(created) }
    }
    if (request.method === 'rename') return { title: 'x', seq: 1 }
    if (request.method === 'projections') return { values: {} }
    if (request.method === 'prompt') {
      const content = body.content as Array<{ text: string }>
      prompts.push({ sessionId: String(body.sessionId), text: content[0].text, mode: String(body.mode) })
      return { accepted: true }
    }
    throw new Error('unexpected gateway call: ' + request.method)
  }
  return { gateway: { invoke } as unknown as TypertGateway, prompts, creates }
}

/**
 * Drain the fire-and-forget launch chain. The chain is gateway promises and the
 * admission queue only, so flushing the microtask queue is deterministic and
 * needs no timer.
 */
async function flushLaunchChain(): Promise<void> {
  for (let turn = 0; turn < 80; turn += 1) await Promise.resolve()
}

function makeBoard(
  gateway: TypertGateway,
  options: { sessionDefaultPermission?: TaskPermission; extensionLogger?: TaskBoardExtensionLogger } = {},
): TaskBoardHostService {
  const ledger = new HostTaskLedger(tempDir(), () => NOW, options.sessionDefaultPermission === undefined
    ? {}
    : { sessionDefaultPermission: options.sessionDefaultPermission })
  return new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    workspaceRegistry: fixtureWorkspaces(),
    ...(options.extensionLogger === undefined ? {} : { extensionLogger: options.extensionLogger }),
  })
}

/**
 * The board's own logging seat. Injecting it instead of watching the process
 * console is how a test reads what the registry reported, in the registry's own
 * words.
 */
function recordingLogger(): { logger: TaskBoardExtensionLogger; warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []
  return {
    warnings,
    errors,
    logger: {
      warn: (message: string) => { warnings.push(message) },
      error: (message: string) => { errors.push(message) },
    },
  }
}

/** Admit one provider and capture the capability face it receives. */
function admit(
  host: TaskBoardHostService,
  extension: TaskBoardExtension,
): { face: () => TaskBoardExtensionHost; release: () => void } {
  let captured: TaskBoardExtensionHost | undefined
  const previousStart = extension.start
  const release = host.registerExtension({
    ...extension,
    start(face) {
      captured = face
      previousStart?.(face)
    },
  })
  return {
    face: () => {
      if (captured === undefined) throw new Error('extension was not started')
      return captured
    },
    release,
  }
}

/** The tag every seeded card carries, so a prompt's tag section is exercised too. */
const TAG: TaskTag = { name: 'line', promptPrefix: 'Focus on the parser.' }

/** The tag section of a seeded card's prompt. */
const TAG_SECTION = '标签提示（任务看板标签，每次执行前注入）：\n- [line] Focus on the parser.'

/** The prompt a seeded card gets when nothing is injected ahead of its tag section. */
const UNTOUCHED_PROMPT = TAG_SECTION + '\n\ndo the work'

/** Create one card through the board's own create action. */
function seedCard(host: TaskBoardHostService, id = 'card'): TaskRecord {
  host.apply('seed-create-' + id, {
    kind: 'create',
    id,
    input: { title: 'Card', description: 'desc', prompt: 'do the work', tags: [TAG] },
  })
  return host.ledger.getTask(id) as TaskRecord
}

/** Make one card already executed and settled, so a rerun has something to redo. */
function seedSettled(host: TaskBoardHostService, id = 'card'): void {
  const task = seedCard(host, id)
  host.ledger.saveTaskRecord(startExecution(task, NOW, 'exec-' + id).task)
  host.ledger.attachSession(id, 'exec-' + id, 'session-settled')
  host.ledger.settle(id, 'exec-' + id, 'succeeded')
}

/** Record every launch a handler is asked about, and answer with its decision. */
function recordingHandler(
  decide: (task: TaskRecord, context: TaskBoardLaunchContext) => TaskBoardLaunchDecision | undefined,
): { handler: TaskBoardLaunchHandler; seen: Array<{ taskId: string; trigger: TaskBoardLaunchTrigger }> } {
  const seen: Array<{ taskId: string; trigger: TaskBoardLaunchTrigger }> = []
  return {
    seen,
    handler: (task, context) => {
      seen.push({ taskId: task.id, trigger: context.trigger })
      return decide(task, context)
    },
  }
}

/**
 * One task's latest execution with the ids this board mints per run removed:
 * everything left is what the launch wrote.
 */
function recordOf(host: TaskBoardHostService, taskId: string): Record<string, unknown> {
  const latest = host.ledger.getTask(taskId)?.executions.at(-1)
  if (latest === undefined) return {}
  const record: Record<string, unknown> = { ...latest }
  delete record.id
  delete record.runGroupId
  return record
}

/** A board with one provider whose handler records every launch it is asked about. */
function boardWithHandler(
  decide: (task: TaskRecord, context: TaskBoardLaunchContext) => TaskBoardLaunchDecision | undefined = () => undefined,
  boardOptions: { extensionLogger?: TaskBoardExtensionLogger } = {},
) {
  const { gateway, prompts, creates } = scriptedGateway()
  const host = makeBoard(gateway, boardOptions)
  const { face, release } = admit(host, { id: 'worker', apiVersion: TASK_BOARD_API_VERSION })
  const recorded = recordingHandler(decide)
  face().launch?.intercept(recorded.handler)
  return { host, prompts, creates, recorded, release }
}

describe('a launch nobody intercepts', () => {
  it('operator running a card with the seam in place but unused gets the unchanged session, prompt and run record', async () => {
    // Given a board whose provider holds the launch face but registers no handler
    const { gateway, prompts, creates } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'worker', apiVersion: TASK_BOARD_API_VERSION })
    expect(typeof face().launch?.intercept).toBe('function')
    seedCard(host)

    // When the operator runs the card
    host.apply('run-card', { kind: 'run', taskId: 'card' }, 'session-operator')
    await flushLaunchChain()

    // Then the session asked for, the prompt queued and the run recorded are
    // exactly what a board without the seam produces: the tag section, then the
    // card body, and nothing injected in front of either
    expect(creates).toEqual([{ workspaceId: 'workspace-fixture' }])
    expect(prompts).toEqual([{ sessionId: 'session-1', text: UNTOUCHED_PROMPT, mode: 'queue' }])
    expect(recordOf(host, 'card')).toEqual({ sessionId: 'session-1', startedAt: NOW, initiatedBy: 'session-operator' })
    expect(host.ledger.getTask('card')?.status).toBe('running')
    expect(host.ledger.getTask('card')?.updatedAt).toBe(NOW)
    host.dispose()
  })
})

describe('a launch a provider keeps local', () => {
  it('operator sees the handler preamble open the prompt and the rest of it unchanged', async () => {
    // Given a provider that keeps the run in the board's own session and states
    // its context in a preamble typed with surrounding whitespace
    const { host, prompts, creates } = boardWithHandler(() => ({
      kind: 'local',
      promptPreamble: '  Run this card against the lab host.  ',
    }))
    seedCard(host)

    // When the operator runs the card
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()

    // Then the board's own session launched it, and the prompt is the trimmed
    // preamble followed by exactly the text an unintercepted run produces
    expect(creates).toHaveLength(1)
    expect(prompts).toEqual([{
      sessionId: 'session-1',
      text: 'Run this card against the lab host.\n\n' + UNTOUCHED_PROMPT,
      mode: 'queue',
    }])
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    host.dispose()
  })
})

describe('a launch a provider takes over', () => {
  it('operator sees no session and no open execution, and the provider settles the card through the ledger', async () => {
    // Given a provider that takes every run over
    const { host, prompts, creates } = boardWithHandler(() => ({ kind: 'external' }))
    seedCard(host, 'card')
    seedCard(host, 'other')

    // When the operator runs both cards
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    host.apply('run-other', { kind: 'run', taskId: 'other' })
    await flushLaunchChain()

    // Then the board created no session, queued no prompt and wrote no
    // execution: it only parked each card in the running column
    expect(creates).toEqual([])
    expect(prompts).toEqual([])
    expect(host.ledger.getTask('card')?.status).toBe('running')
    expect(host.ledger.getTask('card')?.executions).toEqual([])
    expect(host.ledger.getTask('other')?.status).toBe('running')
    expect(host.ledger.getTask('other')?.executions).toEqual([])

    // When the provider records what its own runs reached
    host.apply('settle-card', {
      kind: 'record-external-outcome',
      taskId: 'card',
      result: 'succeeded',
      initiatedBy: 'agent-on-the-lab-host',
    })
    host.apply('settle-other', {
      kind: 'record-external-outcome',
      taskId: 'other',
      result: 'failed',
      initiatedBy: 'agent-on-the-lab-host',
      summary: 'the build broke',
    })

    // Then each card left the running column with one record naming who did the
    // work outside this Host
    const done = host.ledger.getTask('card') as TaskRecord
    expect(done.status).toBe('done')
    expect(done.executions.at(-1)).toMatchObject({
      result: 'succeeded',
      external: true,
      initiatedBy: 'agent-on-the-lab-host',
      sessionId: undefined,
    })
    const failed = host.ledger.getTask('other') as TaskRecord
    expect(failed.status).toBe('failed')
    expect(failed.executions.at(-1)).toMatchObject({
      result: 'failed',
      external: true,
      initiatedBy: 'agent-on-the-lab-host',
      error: 'the build broke',
    })
    host.dispose()
  })
})

describe('the trigger a launch handler receives', () => {
  it('operator running a card from the board reports a manual launch', async () => {
    // Given a board whose provider records the trigger of every launch
    const { host, recorded } = boardWithHandler()
    seedCard(host)

    // When the operator runs the card
    host.apply('run-card', { kind: 'run', taskId: 'card' }, 'session-operator')
    await flushLaunchChain()

    // Then the launch named the board's own run entry
    expect(recorded.seen).toEqual([{ taskId: 'card', trigger: 'manual' }])
    host.dispose()
  })

  it('operator re-running a settled card reports a rerun', async () => {
    // Given a card that already ran and settled
    const { host, recorded } = boardWithHandler()
    seedSettled(host)

    // When the operator re-runs it
    host.apply('rerun-card', { kind: 'rerun', taskId: 'card' }, 'session-operator')
    await flushLaunchChain()

    // Then the launch named the rerun entry
    expect(recorded.seen).toEqual([{ taskId: 'card', trigger: 'rerun' }])
    host.dispose()
  })

  it('operator sees a due schedule reach the handler as a scheduled launch', async () => {
    // Given a card armed with a one-shot plan
    const { host, recorded } = boardWithHandler()
    host.apply('create-scheduled', {
      kind: 'create',
      id: 'card',
      input: {
        title: 'Card',
        description: 'desc',
        prompt: 'do the work',
        schedule: { enabled: true, mode: 'once', at: NOW + MINUTE },
      },
    })

    // When the planned instant arrives
    host.ledger.openScheduled('card', NOW + MINUTE)
    await flushLaunchChain()

    // Then the launch named the scheduler, and the occurrence was spent
    expect(recorded.seen).toEqual([{ taskId: 'card', trigger: 'schedule' }])
    expect(host.ledger.getTask('card')?.schedule?.runCount).toBe(1)
    host.dispose()
  })

  it('operator sees the run tool reach the handler as a tool launch', async () => {
    // Given a board whose provider records the trigger of every launch
    const { host, recorded } = boardWithHandler()
    seedCard(host)
    const tool = buildTaskBoardTools(host).find(candidate => candidate.name === 'task_board_run')
    if (tool === undefined) throw new Error('task_board_run is not registered')

    // When an agent session runs the card through the tool
    await tool.execute({ taskId: 'card' }, { agent: { session: { id: 'session-agent' } } } as never)
    await flushLaunchChain()

    // Then the launch named the tool rather than a person, and carried the
    // caller's session as the run's origin
    expect(recorded.seen).toEqual([{ taskId: 'card', trigger: 'tool' }])
    expect(recordOf(host, 'card')).toMatchObject({ initiatedBy: 'session-agent' })
    host.dispose()
  })
})

describe('a provider whose handler fails', () => {
  it('operator sees a throwing handler treated as no interception, with the failure recorded', async () => {
    // Given a provider whose handler throws
    const log = recordingLogger()
    const { host, prompts, creates } = boardWithHandler(() => {
      throw new Error('the provider is not ready')
    }, { extensionLogger: log.logger })
    seedCard(host)

    // When the operator runs the card
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()

    // Then the launch proceeded exactly as an unintercepted one, and the
    // provider's failure was recorded instead of swallowed
    expect(creates).toHaveLength(1)
    expect(prompts).toEqual([{ sessionId: 'session-1', text: UNTOUCHED_PROMPT, mode: 'queue' }])
    expect(log.errors).toEqual([
      '[dsh-task-board] extension "worker" launch handler failed; the launch proceeds unhandled',
    ])
    host.dispose()
  })

  it('operator sees a throwing handler leave the next provider free to decide the launch', async () => {
    // Given a provider whose handler throws, registered ahead of one that keeps
    // the run local with its own preamble
    const log = recordingLogger()
    const { gateway } = scriptedGateway()
    const host = makeBoard(gateway, { extensionLogger: log.logger })
    const { face } = admit(host, { id: 'broken', apiVersion: TASK_BOARD_API_VERSION })
    face().launch?.intercept(() => { throw new Error('the provider is not ready') })
    const keeper = recordingHandler(() => ({ kind: 'local', promptPreamble: 'Handled by the next provider.' }))
    face().launch?.intercept(keeper.handler)
    seedCard(host)

    // When the operator runs the card
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()

    // Then the broken handler cost only its own interception
    expect(keeper.seen).toEqual([{ taskId: 'card', trigger: 'manual' }])
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    expect(log.errors).toHaveLength(1)
    host.dispose()
  })
})

describe('a provider that stops running', () => {
  it('operator sees a switched-off provider stop intercepting launches', async () => {
    // Given a provider that takes runs over while it is enabled
    let enabled = true
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const recorded = recordingHandler(() => ({ kind: 'external' }))
    const { face } = admit(host, { id: 'worker', apiVersion: TASK_BOARD_API_VERSION, enabled: () => enabled })
    face().launch?.intercept(recorded.handler)
    seedCard(host, 'card')
    seedCard(host, 'other')
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()
    expect(recorded.seen.map(entry => entry.taskId)).toEqual(['card'])
    expect(prompts).toEqual([])

    // When the provider switches itself off and the board re-evaluates the gate
    enabled = false
    host.extensions.setEnabled(true)
    host.apply('run-other', { kind: 'run', taskId: 'other' })
    await flushLaunchChain()

    // Then it was not consulted again and the card ran in the board's own session
    expect(recorded.seen.map(entry => entry.taskId)).toEqual(['card'])
    expect(prompts).toEqual([{ sessionId: 'session-1', text: UNTOUCHED_PROMPT, mode: 'queue' }])
    expect(host.ledger.getTask('other')?.executions).toHaveLength(1)
    host.dispose()
  })

  it('operator sees an unregistered provider stop intercepting launches', async () => {
    // Given a registered provider that takes runs over
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const recorded = recordingHandler(() => ({ kind: 'external' }))
    const { face, release } = admit(host, { id: 'worker', apiVersion: TASK_BOARD_API_VERSION })
    face().launch?.intercept(recorded.handler)
    seedCard(host, 'card')
    seedCard(host, 'other')
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()
    expect(recorded.seen.map(entry => entry.taskId)).toEqual(['card'])

    // When the provider is unregistered and the next card runs
    release()
    host.apply('run-other', { kind: 'run', taskId: 'other' })
    await flushLaunchChain()

    // Then its handler was released with the registration
    expect(recorded.seen.map(entry => entry.taskId)).toEqual(['card'])
    expect(prompts).toEqual([{ sessionId: 'session-1', text: UNTOUCHED_PROMPT, mode: 'queue' }])
    host.dispose()
  })
})
