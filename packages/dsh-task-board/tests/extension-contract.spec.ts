/**
 * The task board's external provider extension contract, exercised through the
 * real registry and the real Host service: registration, version negotiation,
 * the board x extension enable gate, tool registration/disposal, event
 * isolation, the hoisted content/running gates, payload bounds, and action
 * routing.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { TaskBoardHostService } from '../src/host-service.ts'
import { TaskBoardExtensionError, type TaskBoardExtensionToolRegistry } from '../src/host/extension-registry.ts'
import { startExecution, type TaskRecord } from '../src/core/tasks.ts'
import {
  TASK_BOARD_API_VERSION,
  type TaskBoardExtension,
  type TaskBoardExtensionHost,
} from '../src/core/extension.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

let scratchHome: string | undefined
let previousHome: string | undefined
const roots: string[] = []

beforeEach(() => {
  previousHome = process.env.DSH_HOME
  scratchHome = mkdtempSync(join(tmpdir(), 'dsh-ext-contract-'))
  process.env.DSH_HOME = scratchHome
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (scratchHome !== undefined) rmSync(scratchHome, { recursive: true, force: true })
  scratchHome = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
})

function fakeGateway(): TypertGateway {
  return {
    invoke: async () => ({ presets: [], items: [] }),
    stream: async () => ({ async *[Symbol.asyncIterator]() {} }),
  } as unknown as TypertGateway
}

/** A board with a throwaway home directory. */
function makeBoard(): TaskBoardHostService {
  const host = new TaskBoardHostService(fakeGateway())
  return host
}

/** A tool registry double that records registrations and honors disposers. */
class FakeToolRegistry implements TaskBoardExtensionToolRegistry {
  names: string[] = []
  register(definition: ToolDefinition): () => void {
    this.names.push(definition.name)
    return () => { this.names = this.names.filter(name => name !== definition.name) }
  }
}

/** Admit one extension and capture the capability face it receives. */
function admit(host: TaskBoardHostService, extension: TaskBoardExtension): { face: () => TaskBoardExtensionHost, release: () => void } {
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

function makeTaskInput(title: string): { title: string, description: string, prompt: string } {
  return { title, description: '', prompt: 'p' }
}

/**
 * Drain the fire-and-forget launch chain. The chain is gateway promises and the
 * admission queue only, so flushing the microtask queue is deterministic and
 * needs no timer.
 */
async function flushLaunchChain(): Promise<void> {
  for (let turn = 0; turn < 80; turn += 1) await Promise.resolve()
}

describe('extension registry contract', () => {
  it('operator registering the same extension twice starts it once and the release handle is idempotent', () => {
    // Given one extension definition
    const host = makeBoard()
    let starts = 0
    let stops = 0
    const extension: TaskBoardExtension = {
      id: 'once',
      apiVersion: TASK_BOARD_API_VERSION,
      start: () => { starts += 1 },
      stop: () => { stops += 1 },
    }

    // When the same definition is registered twice and both handles are released
    const off1 = host.registerExtension(extension)
    const off2 = host.registerExtension(extension)
    off1()
    off2()

    // Then the provider started exactly once and stopped exactly once
    expect(starts).toBe(1)
    expect(stops).toBe(1)
    expect(host.extensions.isActive('once')).toBe(false)
    host.dispose()
  })

  it('operator registering a mismatched contract version sees a diagnosable refusal and the board keeps serving', () => {
    // Given an extension built against a different contract version
    const host = makeBoard()
    let error: unknown

    // When it is registered while another card write happens on the board
    try {
      host.registerExtension({ id: 'stale', apiVersion: TASK_BOARD_API_VERSION + 1 })
    } catch (cause) {
      error = cause
    }
    host.apply('c1', { kind: 'create', id: 't1', input: makeTaskInput('T1') })

    // Then the refusal names the version mismatch and the board still serves
    // cards and still admits a correctly versioned provider
    expect(error).toBeInstanceOf(TaskBoardExtensionError)
    expect((error as TaskBoardExtensionError).code).toBe('api-version-mismatch')
    expect(host.snapshot().tasks).toHaveLength(1)
    expect(host.registerExtension({ id: 'fresh', apiVersion: TASK_BOARD_API_VERSION })).toBeTypeOf('function')
    host.dispose()
  })

  it('operator switching either the board or the extension off stops the provider, and back on starts it again', () => {
    // Given an admitted provider behind a volatile enable switch
    const host = makeBoard()
    let extensionEnabled = true
    let starts = 0
    let stops = 0
    host.registerExtension({
      id: 'gated',
      apiVersion: TASK_BOARD_API_VERSION,
      enabled: () => extensionEnabled,
      start: () => { starts += 1 },
      stop: () => { stops += 1 },
    })
    expect(starts).toBe(1)

    // When the extension switch turns off, then the board switch turns off and
    // back on with the extension switch on
    extensionEnabled = false
    host.setConfiguration(true, false)
    const afterExtensionOff = host.extensions.isActive('gated')
    const stopsAfterExtensionOff = stops
    extensionEnabled = true
    host.setConfiguration(false, false)
    const whileBoardOff = host.extensions.isActive('gated')
    host.setConfiguration(true, false)

    // Then each gate alone keeps the provider stopped, and both on restarts it
    expect(afterExtensionOff).toBe(false)
    expect(stopsAfterExtensionOff).toBe(1)
    expect(whileBoardOff).toBe(false)
    expect(host.extensions.isActive('gated')).toBe(true)
    expect(starts).toBe(2)
    host.dispose()
  })

  it('operator switching the board off unregisters provider tools and back on restores them', () => {
    // Given a board whose tool registry double is attached and one provider tool
    const host = makeBoard()
    const tools = new FakeToolRegistry()
    host.extensions.setToolRegistry(() => tools)
    admit(host, {
      id: 'tooled',
      apiVersion: TASK_BOARD_API_VERSION,
      start: face => {
        face.registerTool({ name: 'fake_tool', description: 'x', parameters: {}, execute: async () => ({}) } as unknown as ToolDefinition)
      },
    })
    const whileOn = [...tools.names]

    // When the board master switch goes off and back on
    host.setConfiguration(false, false)
    const whileOff = [...tools.names]
    host.setConfiguration(true, false)
    const afterRestore = [...tools.names]

    // Then the provider tool leaves the registry while off and returns once on,
    // without duplicating
    expect(whileOn).toEqual(['fake_tool'])
    expect(whileOff).toEqual([])
    expect(afterRestore).toEqual(['fake_tool'])
    host.dispose()
  })

  it('operator sees a throwing event callback logged and isolated while healthy callbacks still run', () => {
    // Given a provider whose first status listener throws
    const host = makeBoard()
    let healthy = 0
    admit(host, {
      id: 'listener',
      apiVersion: TASK_BOARD_API_VERSION,
      start: capabilities => {
        capabilities.events.onStatusChanged(() => { throw new Error('provider feedback loop') })
        capabilities.events.onStatusChanged(() => { healthy += 1 })
      },
    })
    host.apply('c1', { kind: 'create', id: 't1', input: makeTaskInput('T1') })

    // When a real status change is applied to the board
    expect(() => host.apply('m1', { kind: 'move', taskId: 't1', status: 'done' })).not.toThrow()

    // Then the throwing listener did not break the action and the healthy
    // listener still observed the change
    expect(host.ledger.getTask('t1')?.status).toBe('done')
    expect(healthy).toBe(1)
    host.dispose()
  })

  it('operator cannot patch the content of a started card through the provider face', () => {
    // Given a card that has already started executing
    const host = makeBoard()
    const { face } = admit(host, { id: 'editor', apiVersion: TASK_BOARD_API_VERSION })
    host.apply('c1', { kind: 'create', id: 't1', input: makeTaskInput('T1') })
    const task = host.ledger.getTask('t1') as TaskRecord
    host.ledger.saveTaskRecord(startExecution(task, 100, 'exec-1').task)

    // When the provider tries to patch its content
    let error: unknown
    try {
      face().tasks.patchContent('t1', { title: 'rewritten' })
    } catch (cause) {
      error = cause
    }

    // Then the board's own content gate refuses it and the recorded title stays
    expect((error as TaskBoardExtensionError).code).toBe('content-frozen')
    expect(host.ledger.getTask('t1')?.title).toBe('T1')
    host.dispose()
  })

  it('operator cannot move a card the runner is executing through the provider face', () => {
    // Given a card whose runner holds an open execution
    const host = makeBoard()
    const { face } = admit(host, { id: 'mover', apiVersion: TASK_BOARD_API_VERSION })
    host.apply('c1', { kind: 'create', id: 't1', input: makeTaskInput('T1') })
    const task = host.ledger.getTask('t1') as TaskRecord
    host.ledger.saveTaskRecord(startExecution(task, 100, 'exec-1').task)

    // When the provider asks to move it
    let refusal: unknown
    try {
      face().tasks.setStatus('t1', 'done')
    } catch (cause) {
      refusal = cause
    }

    // Then the running lock refuses the move and leaves the column untouched
    expect(String(refusal)).toContain('running task cannot be moved')
    expect(host.ledger.getTask('t1')?.status).toBe('running')
    host.dispose()
  })

  it('operator sees a non-JSON or oversized payload refused instead of entering the ledger', () => {
    // Given a stored card and a provider capability face
    const host = makeBoard()
    const { face } = admit(host, { id: 'payload', apiVersion: TASK_BOARD_API_VERSION })
    host.apply('c1', { kind: 'create', id: 't1', input: makeTaskInput('T1') })

    // When the provider writes a function-valued payload, an oversized payload,
    // and creates a card with a bigint payload
    const refusedWrite = (() => {
      try {
        face().integration.write('t1', { bad: () => {} })
        return undefined
      } catch (cause) {
        return cause
      }
    })()
    const refusedOversize = (() => {
      try {
        face().integration.write('t1', { blob: 'x'.repeat(65 * 1024) })
        return undefined
      } catch (cause) {
        return cause
      }
    })()
    const refusedCreate = (() => {
      try {
        face().tasks.create(makeTaskInput('T2'), { payload: { bad: [1n] } as unknown as Record<string, unknown> })
        return undefined
      } catch (cause) {
        return cause
      }
    })()

    // Then every refused payload is a diagnosable invalid-payload error and
    // nothing entered the stored container
    expect((refusedWrite as TaskBoardExtensionError).code).toBe('invalid-payload')
    expect((refusedOversize as TaskBoardExtensionError).code).toBe('invalid-payload')
    expect((refusedCreate as TaskBoardExtensionError).code).toBe('invalid-payload')
    expect(host.ledger.getTask('t1')?.integrations).toBeUndefined()
    host.dispose()
  })

  it('operator dispatches a provider action through the board channel and unknown ids are refused', async () => {
    // Given a registered router provider
    const host = makeBoard()
    let seen: unknown
    admit(host, {
      id: 'router',
      apiVersion: TASK_BOARD_API_VERSION,
      handleAction: (request) => { seen = request; return { ok: true, echoed: request.action } },
    })

    // When a known action is dispatched, then an unknown extension id, then
    // another known action
    const applied = await host.apply('x1', { kind: 'extension-action', extensionId: 'router', action: 'ping', taskId: 't1' })
    let unknownError: unknown
    try {
      await host.apply('x2', { kind: 'extension-action', extensionId: 'missing', action: 'ping' })
    } catch (cause) {
      unknownError = cause
    }
    const second = await host.apply('x3', { kind: 'extension-action', extensionId: 'router', action: 'other' })

    // Then the known actions reach the provider with the routed shape, the
    // unknown id is refused by name, and each response is the board snapshot
    expect(applied.tasks).toEqual([])
    expect(second.tasks).toEqual([])
    expect(String(unknownError)).toContain('no extension "missing" is registered')
    expect(seen).toEqual({ extensionId: 'router', action: 'other' })
    host.dispose()
  })

  it('operator creating a card with execution targets reads them back from the board', () => {
    // Given a provider creating a card for an agent that runs at its own
    // composition
    const host = makeBoard()
    const { face } = admit(host, { id: 'mirror', apiVersion: TASK_BOARD_API_VERSION })

    // When the draft names the preset, the model and the reasoning level
    const created = face().tasks.create({
      ...makeTaskInput('Pinned'),
      mode: 'reviewer',
      model: 'provider/model-a',
      reasoningEffort: 'high',
    })

    // Then the stored card carries exactly those targets, readable through the
    // same face and present in the board snapshot
    const stored = face().tasks.get(created.id)
    expect([stored?.mode, stored?.model, stored?.reasoningEffort]).toEqual(['reviewer', 'provider/model-a', 'high'])
    expect(host.snapshot().tasks.find(task => task.id === created.id)?.mode).toBe('reviewer')
    host.dispose()
  })

  it('operator creating a card with no execution targets gets the card the board always minted', () => {
    // Given a provider that names nothing but the content
    const host = makeBoard()
    const { face } = admit(host, { id: 'mirror', apiVersion: TASK_BOARD_API_VERSION })

    // When it creates the card
    const created = face().tasks.create(makeTaskInput('Plain'))

    // Then no target is pinned and the rest of the card is what it always was
    const stored = face().tasks.get(created.id)
    expect([stored?.mode, stored?.model, stored?.reasoningEffort]).toEqual([undefined, undefined, undefined])
    expect([stored?.status, stored?.title, stored?.integrations]).toEqual(['todo', 'Plain', undefined])
    host.dispose()
  })

  it('operator creating a card with blank execution targets gets no pin at all', () => {
    // Given a provider whose draft carries whitespace where a target would go
    const host = makeBoard()
    const { face } = admit(host, { id: 'mirror', apiVersion: TASK_BOARD_API_VERSION })

    // When it creates the card
    const created = face().tasks.create({
      ...makeTaskInput('Blank'),
      mode: '   ',
      model: '',
      reasoningEffort: ' ',
    })

    // Then the board's own target normalization drops all three instead of
    // storing empty strings
    const stored = face().tasks.get(created.id)
    expect([stored?.mode, stored?.model, stored?.reasoningEffort]).toEqual([undefined, undefined, undefined])
    host.dispose()
  })

  it('operator creating a card with an unknown preset sees the run refused, not the create', async () => {
    // Given a provider pinning a preset this deployment does not register, on a
    // board that serves a workspace
    const host = new TaskBoardHostService(fakeGateway(), { workspaceRegistry: fixtureWorkspaces() })
    const { face } = admit(host, { id: 'mirror', apiVersion: TASK_BOARD_API_VERSION })
    const created = face().tasks.create({ ...makeTaskInput('Pinned'), mode: 'not-a-preset' })

    // When the board runs it
    host.apply('run-1', { kind: 'run', taskId: created.id })
    await flushLaunchChain()

    // Then the create stored the pin as given and the board's own launch gate
    // failed the run closed with its own reason
    const task = host.ledger.getTask(created.id)
    expect(task?.mode).toBe('not-a-preset')
    expect(task?.status).toBe('failed')
    expect(task?.executions.at(-1)?.error).toContain('agent preset not found: not-a-preset')
    host.dispose()
  })

  it('operator whose provider action returns ok: false sees the refusal propagated instead of silent success', async () => {
    // Given a provider whose action handler refuses with a domain reason
    const host = makeBoard()
    admit(host, {
      id: 'refuser',
      apiVersion: TASK_BOARD_API_VERSION,
      handleAction: () => ({ ok: false, error: 'host alias not configured' }),
    })

    // When the action is dispatched through the board
    // Then the board rejects with the provider's refusal reason
    await expect(host.apply('refuse-1', {
      kind: 'extension-action',
      extensionId: 'refuser',
      action: 'set-target',
    })).rejects.toThrow('host alias not configured')
    host.dispose()
  })

  it('operator watching live SSE events receives a refresh when a provider publishes updated state', () => {
    // Given a board subscribed to SSE payloads and one admitted provider
    const host = makeBoard()
    const { face } = admit(host, { id: 'streamer', apiVersion: TASK_BOARD_API_VERSION })
    const events: Array<{ revision: number; extensionsRevision?: number }> = []
    const unsub = host.subscribe(() => { events.push(host.eventPayload()) })
    const beforeRev = host.snapshot().extensionsRevision ?? 0

    // When the provider publishes a new summary (for example a live log window)
    face().publish({ logs: { t1: { text: 'line 1\n' } } })

    // Then extensionsRevision advances and an SSE event is emitted
    const afterRev = host.snapshot().extensionsRevision ?? 0
    expect(afterRev).toBeGreaterThan(beforeRev)
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events.at(-1)?.extensionsRevision).toBe(afterRev)
    unsub()
    host.dispose()
  })

  it('operator with a scheduled card already in the running column sees the next trigger skipped as busy', () => {
    // Given a scheduled card currently in the running column (e.g. an external SSH run)
    const host = makeBoard()
    const dueAt = Date.now() + 60_000
    host.apply('c-sched', {
      kind: 'create',
      id: 't-sched',
      input: {
        ...makeTaskInput('Remote scheduled'),
        schedule: { mode: 'once', at: dueAt, enabled: true, timeZone: 'UTC' },
      },
    })
    const card = host.ledger.getTask('t-sched') as TaskRecord
    host.ledger.saveTaskRecord({ ...card, status: 'running' })

    // When the scheduler attempts to open a scheduled run for it
    const opened = host.ledger.openScheduled('t-sched', dueAt)

    // Then no run opens and the schedule records endedReason = 'busy'
    expect(opened).toEqual([])
    expect(host.ledger.getTask('t-sched')?.schedule?.endedReason).toBe('busy')
    host.dispose()
  })
})
