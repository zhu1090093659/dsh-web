import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { TaskBoardHostService } from '../src/host-service.ts'
import { PowerInhibitor } from '../src/power-inhibitor.ts'
import { TASK_BOARD_SCHEMA_VERSION } from '../src/protocol.ts'
import { fixtureWorkspaces } from './workspace-fixture.ts'

const roots: string[] = []
const NOW = 1_700_000_000_000

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true })
})

function tempRoot(): string {
  const value = mkdtempSync(join(tmpdir(), 'dsh-task-board-archived-reuse-'))
  roots.push(value)
  return value
}

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }

/**
 * The ledger a deployment holds for a card that keeps one conversation: one
 * settled run in `session-old` and nothing else.
 * @returns the v7 document the Host loads.
 */
function ledgerDocument(): Record<string, unknown> {
  return {
    schemaVersion: TASK_BOARD_SCHEMA_VERSION,
    revision: 3,
    tasks: [{
      id: 'scheduled',
      title: 'Scheduled update',
      description: '',
      prompt: 'do the work',
      status: 'todo',
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
      workspaceId: 'workspace-a',
      permission: 'read-only',
      reuseSession: true,
      executions: [{
        id: 'run-old',
        sessionId: 'session-old',
        startedAt: NOW - 1_000,
        endedAt: NOW - 500,
        result: 'succeeded',
      }],
    }],
    scheduler: { timeZone: 'UTC' },
    recentRequests: [],
  }
}

/**
 * A gateway that serves one launch and records the session every prompt lands
 * in. The roster reports the previous conversation as present and idle, which
 * is the state a card that keeps one conversation is normally in.
 * @param options.rosterUnreadable - make the roster read itself fail, which is
 *   neither "idle" nor "gone".
 * @returns the gateway plus the session ids the launch prompted.
 */
function launchGateway(options: { rosterUnreadable?: boolean } = {}): { gateway: TypertGateway; prompted: string[] } {
  const prompted: string[] = []
  const invoke = vi.fn(async (request: GatewayRequest) => {
    if (request.namespace !== 'session') throw new Error('unexpected namespace ' + request.namespace)
    if (request.method === 'list') {
      if (options.rosterUnreadable === true) throw new Error('session roster is unavailable')
      return { items: [{ sessionId: 'session-old', running: false }] }
    }
    if (request.method === 'create') return { sessionId: 'session-fresh' }
    if (request.method === 'rename') return { title: 'Scheduled update', seq: 1 }
    if (request.method === 'prompt') {
      prompted.push((request.args.request as { sessionId: string }).sessionId)
      return { accepted: true }
    }
    throw new Error('unexpected gateway call ' + request.method)
  })
  const stream = vi.fn(async () => ({ async *[Symbol.asyncIterator]() {} }))
  return { gateway: { invoke, stream } as unknown as TypertGateway, prompted }
}

/**
 * The Host service a spec drives through one run action.
 * @param dir - ledger directory holding the written document.
 * @param gateway - the launch gateway.
 * @param archive - archived session ids the registry reports; omitted models a
 *   deployment whose registry face reports none.
 * @returns the ledger and the started service.
 */
function startService(dir: string, gateway: TypertGateway, archive?: readonly string[]) {
  const ledger = new HostTaskLedger(dir, () => NOW)
  const service = new TaskBoardHostService(gateway, {
    ledger,
    power: new PowerInhibitor({ platform: 'linux' }),
    now: () => NOW,
    workspaceRegistry: fixtureWorkspaces(['workspace-a'], archive === undefined ? {} : { archive }),
    modelCatalog: async () => ({ groups: [] }),
    commandDispatcher: {
      execute: async () => ({ kind: 'success', text: 'ok' } as const),
    },
  })
  return { ledger, service }
}

describe('a card whose reused conversation is archived (#2068)', () => {
  it('operator running it reaches a fresh conversation instead of failing blocked', async () => {
    // Given a card that keeps one conversation, whose registry reports that
    // conversation archived
    const dir = tempRoot()
    writeFileSync(join(dir, 'ledger-v2.json'), JSON.stringify(ledgerDocument(), null, 2))
    const { gateway, prompted } = launchGateway()
    const { ledger, service } = startService(dir, gateway, ['session-old'])

    // When the operator runs the card
    service.apply('run-archived', { kind: 'run', taskId: 'scheduled' })

    // Then the execution lands in a fresh conversation, never the archived one,
    // and it reaches it without a failure being recorded on the run
    await vi.waitFor(() => {
      expect(ledger.getTask('scheduled')?.executions.at(-1)?.sessionId).toBe('session-fresh')
    })
    expect(prompted).toEqual(['session-fresh'])
    const execution = ledger.getTask('scheduled')?.executions.at(-1)
    expect(execution?.error).toBeUndefined()
    expect(ledger.getTask('scheduled')?.status).toBe('running')
    service.dispose()
  })

  it('operator running it while the registry reports no archive set keeps the conversation', async () => {
    // Given the same card, on a deployment whose registry face reports no
    // archive set at all
    const dir = tempRoot()
    writeFileSync(join(dir, 'ledger-v2.json'), JSON.stringify(ledgerDocument(), null, 2))
    const { gateway, prompted } = launchGateway()
    const { ledger, service } = startService(dir, gateway)

    // When the operator runs the card
    service.apply('run-live', { kind: 'run', taskId: 'scheduled' })

    // Then the run continues the existing conversation, exactly as before
    await vi.waitFor(() => {
      expect(ledger.getTask('scheduled')?.executions.at(-1)?.sessionId).toBe('session-old')
    })
    expect(prompted).toEqual(['session-old'])
    service.dispose()
  })

  it('operator running it while the roster read fails still reaches a fresh conversation', async () => {
    // Given the same card, on a host whose session roster cannot be read right
    // now, so neither "idle" nor "gone" can be established
    const dir = tempRoot()
    writeFileSync(join(dir, 'ledger-v2.json'), JSON.stringify(ledgerDocument(), null, 2))
    const { gateway, prompted } = launchGateway({ rosterUnreadable: true })
    const { ledger, service } = startService(dir, gateway)

    // When the operator runs the card
    service.apply('run-roster-down', { kind: 'run', taskId: 'scheduled' })

    // Then the launch mints a fresh conversation instead of failing the run
    await vi.waitFor(() => {
      expect(ledger.getTask('scheduled')?.executions.at(-1)?.sessionId).toBe('session-fresh')
    })
    expect(prompted).toEqual(['session-fresh'])
    expect(ledger.getTask('scheduled')?.executions.at(-1)?.error).toBeUndefined()
    service.dispose()
  })
})
