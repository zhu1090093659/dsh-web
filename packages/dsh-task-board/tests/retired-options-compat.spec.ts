/**
 * Retired execution options in an existing ledger.
 *
 * A v7 document written before the options were removed may still carry
 * `goalRun` / `skipVerification` on a card and a `verification` block on an
 * execution. Such a row must load with every other field intact — never be
 * rejected — and the retired fields must be dropped rather than carried into
 * the next commit, so no removed option survives a load and no new value is
 * ever written for one. A card that asked for them then runs one plain turn:
 * no `/goal` command is dispatched and `session/projections` is never read.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-retired-'))
  roots.push(root)
  return root
}

/**
 * The v7 ledger document an older build leaves behind: one card that opted into
 * both retired options, with a settled execution carrying an acceptance block,
 * and every other field a card can hold.
 */
function legacyDocument(): Record<string, unknown> {
  return {
    schemaVersion: TASK_BOARD_SCHEMA_VERSION,
    revision: 7,
    tasks: [{
      id: 'legacy',
      title: 'Legacy card',
      description: 'written by a build that still had the options',
      prompt: 'do the work',
      status: 'todo',
      createdAt: NOW,
      updatedAt: NOW,
      workspaceId: 'workspace-a',
      mode: 'preset-a',
      permission: 'read-only',
      model: 'vendor/model',
      reasoningEffort: 'high',
      reuseSession: true,
      goalRun: true,
      skipVerification: true,
      tags: [{ name: 'ops', promptPrefix: '前缀' }],
      executions: [{
        id: 'old-run',
        sessionId: 'session-old',
        startedAt: NOW - 1_000,
        endedAt: NOW - 500,
        result: 'succeeded',
        summary: { text: 'the earlier run finished', seq: 12 },
        verification: {
          contract: {
            enabled: true, modelSource: 'inherit', route: { provider: 'p', model: 'm' }, preset: 'coding', threshold: 0.65,
          },
          attempts: [{
            index: 1,
            at: NOW - 600,
            stage: 'quality',
            passed: true,
            score: 0.9,
            baseline: 0.1,
            criteria: [],
            findings: [],
            usage: { calls: 1, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
            evidence: { chars: 0, omittedCharacters: 0, entries: 0, hash: '' },
            route: { provider: 'p', model: 'm' },
            channel: 'explicit-tag',
            rounds: 2,
          }],
          applicability: 'enforced',
        },
      }],
    }],
    scheduler: { timeZone: 'UTC' },
    recentRequests: [],
  }
}

function writeDocument(dir: string, document: Record<string, unknown>): void {
  writeFileSync(join(dir, 'ledger-v2.json'), JSON.stringify(document, null, 2))
}

function readDocument(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'ledger-v2.json'), 'utf8')) as Record<string, unknown>
}

type GatewayRequest = { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }

/** A gateway that answers the one launch path and records every method it saw. */
function launchGateway(): { gateway: TypertGateway; methods: string[] } {
  const methods: string[] = []
  const invoke = vi.fn(async (request: GatewayRequest) => {
    methods.push(request.namespace + '/' + request.method)
    if (request.namespace === 'agentPresets' && request.method === 'list') return { presets: [{ id: 'preset-a' }] }
    if (request.namespace !== 'session') throw new Error('unexpected namespace ' + request.namespace)
    // The card opted into session reuse, so the launch reads the roster first.
    if (request.method === 'list') return { items: [] }
    if (request.method === 'create') return { sessionId: 'session-new' }
    if (request.method === 'rename') return { title: 'Legacy card', seq: 1 }
    if (request.method === 'selectModel') return { selected: true }
    if (request.method === 'prompt') return { accepted: true }
    throw new Error('unexpected gateway call ' + request.method)
  })
  const stream = vi.fn(async () => ({ async *[Symbol.asyncIterator]() {} }))
  return { gateway: { invoke, stream } as unknown as TypertGateway, methods }
}

describe('a ledger carrying the retired execution options', () => {
  it('user reloading such a card keeps every other field and loses the retired ones', () => {
    // Given a v7 document written by a build that still had the options
    const dir = tempRoot()
    writeDocument(dir, legacyDocument())

    // When the Host loads it
    const ledger = new HostTaskLedger(dir, () => NOW)
    const task = ledger.state().tasks[0] as unknown as Record<string, unknown>
    const execution = (task.executions as Record<string, unknown>[])[0]

    // Then the row itself is kept, with every carried field intact
    expect(task).toMatchObject({
      id: 'legacy',
      title: 'Legacy card',
      description: 'written by a build that still had the options',
      prompt: 'do the work',
      status: 'todo',
      workspaceId: 'workspace-a',
      mode: 'preset-a',
      permission: 'read-only',
      model: 'vendor/model',
      reasoningEffort: 'high',
      reuseSession: true,
      tags: [{ name: 'ops', promptPrefix: '前缀' }],
    })
    expect(execution).toMatchObject({ id: 'old-run', sessionId: 'session-old', result: 'succeeded', summary: { text: 'the earlier run finished', seq: 12 } })

    // And the retired fields are gone as KEYS, not merely blanked
    expect('goalRun' in task).toBe(false)
    expect('skipVerification' in task).toBe(false)
    expect('verification' in execution).toBe(false)

    // When the Host commits anything at all
    ledger.applyRequest('move-legacy', { kind: 'move', taskId: 'legacy', status: 'backlog' })

    // Then the persisted document is still v7 and carries no retired field back
    const onDisk = readDocument(dir)
    expect(onDisk.schemaVersion).toBe(TASK_BOARD_SCHEMA_VERSION)
    const stored = (onDisk.tasks as Record<string, unknown>[])[0]
    const storedExecution = (stored.executions as Record<string, unknown>[])[0]
    expect('goalRun' in stored).toBe(false)
    expect('skipVerification' in stored).toBe(false)
    expect('verification' in storedExecution).toBe(false)
    expect(stored.title).toBe('Legacy card')
    expect(storedExecution.summary).toEqual({ text: 'the earlier run finished', seq: 12 })
  })

  it('user running such a card gets one plain turn: no /goal and no projections read', async () => {
    // Given a loaded card that asked for both retired options
    const dir = tempRoot()
    writeDocument(dir, legacyDocument())
    const ledger = new HostTaskLedger(dir, () => NOW)
    const { gateway, methods } = launchGateway()
    const dispatched: string[] = []
    const service = new TaskBoardHostService(gateway, {
      ledger,
      power: new PowerInhibitor({ platform: 'linux' }),
      now: () => NOW,
      workspaceRegistry: fixtureWorkspaces(['workspace-a']),
      modelCatalog: async () => ({ groups: [] }),
      commandDispatcher: {
        execute: async (_sessionId, line) => { dispatched.push(line); return { kind: 'success', text: 'ok' } as const },
      },
    })

    // When the user runs it
    service.apply('run-legacy', { kind: 'run', taskId: 'legacy' })

    // Then the execution reaches its session
    await vi.waitFor(() => {
      expect(ledger.getTask('legacy')?.executions.at(-1)?.sessionId).toBe('session-new')
    })

    // And it ran one plain turn: the only command is the pinned permission, the
    // goal phase was never read, and the execution records no acceptance block
    expect(dispatched).toEqual(['/permission read-only'])
    expect(methods).not.toContain('session/projections')
    expect(methods.filter(method => method === 'session/prompt')).toHaveLength(1)
    const execution = ledger.getTask('legacy')?.executions.at(-1) as Record<string, unknown> | undefined
    expect(execution?.verification).toBeUndefined()
    service.dispose()
  })
})
