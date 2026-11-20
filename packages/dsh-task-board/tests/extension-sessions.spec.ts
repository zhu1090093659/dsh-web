/**
 * The two optional execution capabilities of the external provider contract:
 * delivering a follow-up message into a card's execution session, and re-running
 * an executed card in that session with rework instructions.
 *
 * Everything runs through the real registry and the real Host service over a
 * scripted gateway, so what is asserted is the board's own behaviour: the
 * session the board really prompts, the execution record it really writes, and
 * the refusals it gives when a card has nothing to deliver to or to rework.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { TaskBoardExtensionError, TaskBoardExtensionRegistry } from '../src/host/extension-registry.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import { startExecution, type TaskPermission, type TaskRecord } from '../src/core/tasks.ts'
import {
  TASK_BOARD_API_VERSION,
  TASK_BOARD_MESSAGE_MAX_LENGTH,
  type TaskBoardExtension,
  type TaskBoardExtensionHost,
} from '../src/core/extension.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ext-sessions-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown> }

/** One message the board queued into a session, with the call that carried it. */
interface DeliveredPrompt {
  sessionId: string
  text: string
  mode: string
}

interface Script {
  /** Sessions the host roster shows, and whether each is running. */
  roster?: Array<{ sessionId: string; running: boolean }>
  /** The roster read itself fails, which is neither "idle" nor "gone". */
  rosterUnreadable?: boolean
  /** A session this host cannot reach: a prompt into it rejects. */
  unreachable?: string
}

/**
 * The gateway a launch and a delivery need: the preset registry, the session
 * roster, session creation, and prompts. It records every prompt so a test can
 * read which session the board delivered into and what it said.
 */
function scriptedGateway(script: Script = {}) {
  const prompts: DeliveredPrompt[] = []
  const creates: Array<{ workspaceId?: string; agentPreset?: string }> = []
  let created = 0
  async function invoke(request: GatewayRequest): Promise<unknown> {
    const body = (request.args.request ?? {}) as Record<string, unknown>
    if (request.namespace === 'agentPresets' && request.method === 'list') return { presets: [] }
    if (request.namespace !== 'session') throw new Error('unexpected namespace: ' + request.namespace)
    if (request.method === 'modelCatalog') return {}
    if (request.method === 'list') {
      if (script.rosterUnreadable === true) throw new Error('session roster is unavailable')
      return { items: script.roster ?? [] }
    }
    if (request.method === 'create') {
      created += 1
      creates.push(body as { workspaceId?: string; agentPreset?: string })
      return { sessionId: 'session-' + String(created) }
    }
    if (request.method === 'rename') return { title: 'x', seq: 1 }
    if (request.method === 'projections') return { values: {} }
    if (request.method === 'prompt') {
      const sessionId = String(body.sessionId)
      if (sessionId === script.unreachable) throw new Error('session ' + sessionId + ' is not attached to this host')
      const content = body.content as Array<{ text: string }>
      prompts.push({ sessionId, text: content[0].text, mode: String(body.mode) })
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
  options: { sessionDefaultPermission?: TaskPermission; archive?: readonly string[] } = {},
): TaskBoardHostService {
  const ledger = new HostTaskLedger(tempDir(), () => NOW, options.sessionDefaultPermission === undefined
    ? {}
    : { sessionDefaultPermission: options.sessionDefaultPermission })
  return new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    workspaceRegistry: fixtureWorkspaces(['workspace-fixture'], options.archive === undefined ? {} : { archive: options.archive }),
  })
}

/** Admit one extension and capture the capability face it receives. */
function admit(host: TaskBoardHostService, extension: TaskBoardExtension): { face: () => TaskBoardExtensionHost; release: () => void } {
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

/** Create one card through the board's own create action. */
function seedCard(host: TaskBoardHostService, input: { permission?: TaskPermission } = {}): TaskRecord {
  host.apply('seed-create', {
    kind: 'create',
    id: 'card',
    input: {
      title: 'Card',
      description: 'desc',
      prompt: 'do the work',
      ...(input.permission === undefined ? {} : { permission: input.permission }),
    },
  })
  return host.ledger.getTask('card') as TaskRecord
}

/**
 * Make one card already executed: its run is open (or settled) and it recorded
 * the session the follow-up and rework faces address.
 */
function seedExecuted(host: TaskBoardHostService, options: { sessionId?: string | undefined; settle?: boolean } = {}): TaskRecord {
  const task = seedCard(host)
  host.ledger.saveTaskRecord(startExecution(task, NOW, 'exec-1').task)
  if (options.sessionId !== undefined) host.ledger.attachSession('card', 'exec-1', options.sessionId)
  if (options.settle !== false) host.ledger.settle('card', 'exec-1', 'succeeded')
  return host.ledger.getTask('card') as TaskRecord
}

/** The refusal a face call raised, for asserting its code and wording. */
function refusalOf(call: () => unknown): unknown {
  try {
    call()
    return undefined
  } catch (error) {
    return error
  }
}

/** The refusal an async face call raised. */
async function asyncRefusalOf(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call()
    return undefined
  } catch (error) {
    return error
  }
}

describe('follow-up delivery into an execution session', () => {
  it('operator queues a provider follow-up into the session of a card that is still running', async () => {
    // Given a card whose run is going and recorded its session
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-live', settle: false })

    // When the provider delivers a message with surrounding whitespace
    await face().sessions?.followUp('card', '  what did the tests say?  ')

    // Then exactly that session was queued the trimmed message, behind whatever
    // the session is doing, and the card itself was not touched
    expect(prompts).toEqual([{ sessionId: 'session-live', text: 'what did the tests say?', mode: 'queue' }])
    expect(host.ledger.getTask('card')?.status).toBe('running')
    host.dispose()
  })

  it('operator sees a provider follow-up reach the most recent session of a finished card', async () => {
    // Given a card whose only run settled in a recorded session
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-done' })

    // When the provider answers a question on it
    await face().sessions?.followUp('card', 'thanks, one more thing')

    // Then the settled run's own session received the message
    expect(prompts.map(prompt => [prompt.sessionId, prompt.text])).toEqual([['session-done', 'thanks, one more thing']])
    expect(host.ledger.getTask('card')?.status).toBe('done')
    host.dispose()
  })

  it('operator gets a diagnosable refusal for a follow-up naming a card that does not exist', async () => {
    // Given a board and a provider face
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })

    // When the provider delivers to an unknown card id
    const refusal = await asyncRefusalOf(async () => { await face().sessions?.followUp('missing', 'hello') })

    // Then the refusal names the unknown id and nothing was delivered
    expect((refusal as TaskBoardExtensionError).code).toBe('task-not-found')
    expect(String(refusal)).toContain('no task with id missing')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator gets a refusal for a follow-up on a card that never executed', async () => {
    // Given a card with no execution record at all
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)

    // When the provider tries to deliver into it
    const refusal = await asyncRefusalOf(async () => { await face().sessions?.followUp('card', 'hello') })

    // Then there is no session to address and the refusal says so
    expect((refusal as TaskBoardExtensionError).code).toBe('not-executed')
    expect(String(refusal)).toContain('has never executed')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator gets a refusal for a follow-up on an archived card', async () => {
    // Given an executed card that has been archived
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-done' })
    host.apply('archive-card', { kind: 'archive', taskId: 'card' })

    // When the provider tries to deliver into it
    const refusal = await asyncRefusalOf(async () => { await face().sessions?.followUp('card', 'hello') })

    // Then the archived card's execution is closed and nothing was delivered
    expect((refusal as TaskBoardExtensionError).code).toBe('task-archived')
    expect(String(refusal)).toContain('is archived')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator sees a follow-up refused when the recorded session no longer accepts messages', async () => {
    // Given an executed card whose session the host can no longer reach
    const { gateway, prompts } = scriptedGateway({ unreachable: 'session-gone' })
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-gone' })

    // When the provider delivers into it
    const refusal = await asyncRefusalOf(async () => { await face().sessions?.followUp('card', 'hello') })

    // Then the gateway refusal surfaces as an unreachable session, not as a
    // silent success, and the gateway's own words are kept
    expect((refusal as TaskBoardExtensionError).code).toBe('session-unreachable')
    expect(String(refusal)).toContain('session-gone')
    expect(String(refusal)).toContain('is not attached to this host')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator gets a refusal for a follow-up on a card whose executions recorded no session', async () => {
    // Given one card whose settled run recorded no session, and one card whose
    // current run has not attached a session yet
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, {})
    host.apply('seed-create-two', {
      kind: 'create',
      id: 'live',
      input: { title: 'Live', description: '', prompt: 'p' },
    })
    host.ledger.saveTaskRecord(startExecution(host.ledger.getTask('live') as TaskRecord, NOW, 'exec-live').task)

    // When the provider delivers into either of them
    const settled = await asyncRefusalOf(async () => { await face().sessions?.followUp('card', 'hello') })
    const live = await asyncRefusalOf(async () => { await face().sessions?.followUp('live', 'hello') })

    // Then both name the missing session, and nothing was addressed
    expect((settled as TaskBoardExtensionError).code).toBe('session-unreachable')
    expect(String(settled)).toContain('records no execution session')
    expect((live as TaskBoardExtensionError).code).toBe('session-unreachable')
    expect(String(live)).toContain('has not attached a session yet')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator gets an input refusal for a blank or oversized follow-up', async () => {
    // Given an executed card and a provider face
    const { gateway, prompts } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'chat', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-done' })

    // When the provider sends whitespace, then a message past the bound
    const blank = await asyncRefusalOf(async () => { await face().sessions?.followUp('card', '   ') })
    const oversized = await asyncRefusalOf(async () => {
      await face().sessions?.followUp('card', 'x'.repeat(TASK_BOARD_MESSAGE_MAX_LENGTH + 1))
    })

    // Then both are diagnosable input refusals and no session was addressed
    expect((blank as TaskBoardExtensionError).code).toBe('invalid-text')
    expect((oversized as TaskBoardExtensionError).code).toBe('invalid-text')
    expect(prompts).toEqual([])
    host.dispose()
  })

  it('operator sees both optional capabilities refused on a deployment without their seams', async () => {
    // Given a registry admitted without any delivery or rework seam
    const ledger = new HostTaskLedger(tempDir(), () => NOW)
    const registry = new TaskBoardExtensionRegistry({ ledger })
    let captured: TaskBoardExtensionHost | undefined
    registry.registerExtension({
      id: 'bare',
      apiVersion: TASK_BOARD_API_VERSION,
      start: (capabilities) => { captured = capabilities },
    })
    ledger.applyRequest('seed-create', { kind: 'create', id: 'card', input: { title: 'Card', description: '', prompt: 'p' } })
    const task = ledger.getTask('card') as TaskRecord
    ledger.saveTaskRecord(startExecution(task, NOW, 'exec-1').task)
    ledger.attachSession('card', 'exec-1', 'session-1')

    // When that provider delivers into the card and reworks it
    const delivery = await asyncRefusalOf(async () => { await captured?.sessions?.followUp('card', 'hello') })
    const rework = refusalOf(() => { captured?.tasks.rework?.('card', 'try again') })

    // Then both are named as unavailable instead of looking delivered
    expect((delivery as TaskBoardExtensionError).code).toBe('unavailable')
    expect((rework as TaskBoardExtensionError).code).toBe('unavailable')
    registry.dispose()
  })
})

describe('rework of an executed card', () => {
  /** Run one card for real, then settle it, so its session is a launch result. */
  async function runAndSettle(host: TaskBoardHostService): Promise<void> {
    host.apply('run-card', { kind: 'run', taskId: 'card' })
    await flushLaunchChain()
    const execution = host.ledger.getTask('card')?.executions.at(-1)
    host.ledger.settle('card', execution?.id ?? '', 'succeeded')
  }

  it('operator sees a rework continue the original session with the reviewer instructions', async () => {
    // Given a card that ran once in session-1 and settled, with that session
    // still present and idle in the host roster
    const { gateway, prompts, creates } = scriptedGateway({ roster: [{ sessionId: 'session-1', running: false }] })
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)
    await runAndSettle(host)
    expect(creates).toHaveLength(1)
    prompts.length = 0

    // When the provider sends the work back with rework instructions
    face().tasks.rework?.('card', '  cover the failure path too  ')
    await flushLaunchChain()

    // Then no second conversation was created: the rework was queued into the
    // recorded session, the prompt carries the reviewer's instruction as well as
    // the card body, and the execution record says why this run exists
    expect(creates).toHaveLength(1)
    expect(prompts).toHaveLength(1)
    expect(prompts[0].sessionId).toBe('session-1')
    expect(prompts[0].text).toContain('cover the failure path too')
    expect(prompts[0].text).toContain('do the work')
    const reworked = host.ledger.getTask('card') as TaskRecord
    expect(reworked.status).toBe('running')
    expect(reworked.executions.at(-1)?.rework).toEqual({ instructions: 'cover the failure path too' })
    host.dispose()
  })

  it('operator sees a rework of an archived conversation refuse with that reason', async () => {
    // Given a card that ran once in session-1 and settled, and a registry that
    // reports that conversation archived
    const { gateway, prompts } = scriptedGateway({ roster: [{ sessionId: 'session-1', running: false }] })
    const host = makeBoard(gateway, { archive: ['session-1'] })
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)
    await runAndSettle(host)
    prompts.length = 0

    // When the provider sends the work back into that conversation
    face().tasks.rework?.('card', 'cover the failure path too')
    await flushLaunchChain()

    // Then nothing was prompted into the archived session, and the failure
    // names both the archive and the conversation the operator has to unarchive
    expect(prompts).toHaveLength(0)
    const settled = host.ledger.getTask('card') as TaskRecord
    expect(settled.status).toBe('failed')
    expect(settled.executions.at(-1)?.error).toContain('is archived')
    expect(settled.executions.at(-1)?.error).toContain('session-1')
    host.dispose()
  })

  it('operator sees a rework whose roster read failed refuse for that reason', async () => {
    // Given a card that ran once and settled, and a host whose roster read now
    // fails, so neither "idle" nor "gone" can be established
    const { gateway, prompts } = scriptedGateway({ rosterUnreadable: true })
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-1' })

    // When the provider sends the work back
    face().tasks.rework?.('card', 'cover the failure path too')
    await flushLaunchChain()

    // Then the refusal blames evidence it could not confirm, not a conversation
    // it knows is missing
    expect(prompts).toHaveLength(0)
    const settled = host.ledger.getTask('card') as TaskRecord
    expect(settled.status).toBe('failed')
    expect(settled.executions.at(-1)?.error).toContain('could not be confirmed as present and idle')
    host.dispose()
  })

  it('operator sees a rework leave the executed card content exactly as it ran', async () => {
    // Given a card that already ran
    const { gateway } = scriptedGateway({ roster: [{ sessionId: 'session-1', running: false }] })
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)
    await runAndSettle(host)

    // When the provider reworks it
    face().tasks.rework?.('card', 'tighten the summary')
    await flushLaunchChain()

    // Then the frozen title, description and prompt are untouched, and the
    // content gate still refuses a patch on the same card
    const frozen = host.ledger.getTask('card') as TaskRecord
    expect([frozen.title, frozen.description, frozen.prompt]).toEqual(['Card', 'desc', 'do the work'])
    expect((refusalOf(() => { face().tasks.patchContent('card', { prompt: 'rewritten' }) }) as TaskBoardExtensionError).code)
      .toBe('content-frozen')
    host.dispose()
  })

  it('operator gets a diagnosable refusal when reworking a card that does not exist', () => {
    // Given a board and a provider face
    const { gateway } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })

    // When the provider reworks an unknown card id
    const refusal = refusalOf(() => { face().tasks.rework?.('missing', 'try again') })

    // Then the refusal names the unknown id and the board still serves
    expect((refusal as TaskBoardExtensionError).code).toBe('task-not-found')
    expect(String(refusal)).toContain('no task with id missing')
    expect(host.ledger.allTasks()).toEqual([])
    host.dispose()
  })

  it('operator gets a refusal when reworking a card that never executed', async () => {
    // Given a card with no execution record
    const { gateway, prompts, creates } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)

    // When the provider reworks it
    const refusal = refusalOf(() => { face().tasks.rework?.('card', 'try again') })

    // Then there is nothing to rework and no run was opened
    expect((refusal as TaskBoardExtensionError).code).toBe('not-executed')
    expect(String(refusal)).toContain('there is no run to rework')
    expect(host.ledger.getTask('card')?.executions).toEqual([])
    expect([creates.length, prompts.length]).toEqual([0, 0])
    host.dispose()
  })

  it('operator gets a refusal when reworking a card that is still running', async () => {
    // Given a card whose run is still going
    const { gateway, creates } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-live', settle: false })

    // When the provider reworks it
    const refusal = refusalOf(() => { face().tasks.rework?.('card', 'try again') })

    // Then the running lock refuses it and the card keeps its single execution
    expect((refusal as TaskBoardExtensionError).code).toBe('running')
    expect(String(refusal)).toContain('is still running')
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    expect(creates).toEqual([])
    host.dispose()
  })

  it('operator gets a refusal when reworking an archived card', async () => {
    // Given an executed card that has been archived
    const { gateway } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-done' })
    host.apply('archive-card', { kind: 'archive', taskId: 'card' })

    // When the provider reworks it
    const refusal = refusalOf(() => { face().tasks.rework?.('card', 'try again') })

    // Then the archived card stays read-only
    expect((refusal as TaskBoardExtensionError).code).toBe('task-archived')
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    host.dispose()
  })

  it('operator gets a refusal when reworking a card whose run recorded no session', async () => {
    // Given an executed card whose run never attached a session
    const { gateway } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, {})

    // When the provider reworks it
    const refusal = refusalOf(() => { face().tasks.rework?.('card', 'try again') })

    // Then there is no conversation to continue and no run was opened
    expect((refusal as TaskBoardExtensionError).code).toBe('session-unreachable')
    expect(String(refusal)).toContain('records no execution session')
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    host.dispose()
  })

  it('operator sees an unconfirmed elevated card refused by the permission gate on rework', () => {
    // Given an executed card pinned above the session default permission and
    // never confirmed
    const { gateway, creates } = scriptedGateway()
    const host = makeBoard(gateway, { sessionDefaultPermission: 'read-only' })
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    const task = seedCard(host, { permission: 'workspace-write' })
    host.ledger.saveTaskRecord(startExecution(task, NOW, 'exec-1').task)
    host.ledger.attachSession('card', 'exec-1', 'session-1')
    host.ledger.settle('card', 'exec-1', 'succeeded')

    // When the provider reworks it
    const refusal = refusalOf(() => { face().tasks.rework?.('card', 'try again') })

    // Then the board's own confirmation gate refuses the run, in its own words,
    // and no execution was opened
    expect(String(refusal)).toContain('confirmation-required')
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    expect(creates).toEqual([])
    host.dispose()
  })

  it('operator sees a rework fail the run when the recorded session is gone', async () => {
    // Given an executed card whose recorded session is absent from the roster
    const { gateway, prompts, creates } = scriptedGateway({ roster: [{ sessionId: 'session-other', running: false }] })
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedCard(host)
    await runAndSettle(host)

    // When the provider reworks it
    face().tasks.rework?.('card', 'try again')
    await flushLaunchChain()

    // Then the run opened, refused to start a fresh conversation, and settled
    // failed with the reason a human reads on the card
    const failed = host.ledger.getTask('card') as TaskRecord
    expect(failed.status).toBe('failed')
    expect(failed.executions.at(-1)?.error).toContain('rework')
    expect(failed.executions.at(-1)?.error).toContain('session roster')
    expect(creates).toHaveLength(1)
    expect(prompts).toHaveLength(1)
    expect(prompts[0].text).toBe('do the work')
    host.dispose()
  })

  it('operator gets an input refusal for blank rework instructions', () => {
    // Given an executed card
    const { gateway } = scriptedGateway()
    const host = makeBoard(gateway)
    const { face } = admit(host, { id: 'review', apiVersion: TASK_BOARD_API_VERSION })
    seedExecuted(host, { sessionId: 'session-done' })

    // When the provider sends blank rework instructions
    const refusal = refusalOf(() => { face().tasks.rework?.('card', '   ') })

    // Then the request is refused as unusable input and the card keeps its run
    expect((refusal as TaskBoardExtensionError).code).toBe('invalid-text')
    expect(host.ledger.getTask('card')?.executions).toHaveLength(1)
    host.dispose()
  })
})
