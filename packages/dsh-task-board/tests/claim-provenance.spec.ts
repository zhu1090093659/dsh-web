// 领卡执行污点包裹与来源审计（issue #6）：
// 1) run/rerun 的发起方 sessionId 入账本（ExecutionRecord.initiatedBy）；
// 2) 冻结卡片开跑时捕获 freeze 来源（frozenAt/frozenBy）供追溯；
// 3) create/update 的发起方织入 freeze.frozenBy（来源会话）；
// 4) 协议 envelope 接受有界 initiator；
// 5) store 归一化往返新字段；
// 6) controller 把当前会话作为 run 的发起方传给 transport。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseActionEnvelope } from '../src/protocol.ts'
import { parseLedger } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { BoardController, type TaskBoardTransport } from '../src/core/controller.ts'
import type { TaskBoardAction, TaskBoardSnapshot } from '../src/protocol.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'

const roots: string[] = []
const NOW = new Date(2026, 7, 24, 9, 0, 0).getTime()

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-claim-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function freezeCard(): TaskRecord {
  return {
    ...createTask({ title: '续接卡', description: '', prompt: '继续干活' }, NOW - 1000, 'card-1'),
    freeze: { goal: '目标', progress: '进度', next: '下一步', frozenAt: NOW - 1000, frozenBy: 'session-source' },
  }
}

describe('protocol envelope initiator (issue #6)', () => {
  it('accepts an optional initiator session id and rejects malformed values', () => {
    const base = { requestId: 'req-1', action: { kind: 'run', taskId: 't-1' } }
    expect(parseActionEnvelope({ ...base, initiator: 'session-9' })).toMatchObject({ initiator: 'session-9' })
    expect(parseActionEnvelope(base)?.initiator).toBeUndefined()
    expect(parseActionEnvelope({ ...base, initiator: '' })).toBeUndefined()
    expect(parseActionEnvelope({ ...base, initiator: '   ' })).toBeUndefined()
    expect(parseActionEnvelope({ ...base, initiator: 'x'.repeat(257) })).toBeUndefined()
    expect(parseActionEnvelope({ ...base, initiator: 42 })).toBeUndefined()
  })

  it('carries an optional frozenBy through the freeze gate and rejects non-string values', () => {
    const freeze = { goal: 'g', progress: 'p', next: 'n' }
    const create = (input: unknown) => parseActionEnvelope({
      requestId: 'req-2',
      action: { kind: 'create', id: 't-9', input: { title: 'x', description: '', prompt: 'y', freeze: input } },
    })
    expect(create({ ...freeze, frozenBy: 'session-a' })?.action).toMatchObject({
      kind: 'create',
      input: { freeze: { goal: 'g', frozenBy: 'session-a' } },
    })
    expect(create({ ...freeze, frozenBy: 7 })).toBeUndefined()
  })
})

describe('ledger claim audit (issue #6)', () => {
  it('records the run initiator and captures the freeze origin on the execution record', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('req-run', { kind: 'create', id: 'card-1', input: { title: '续接卡', description: '', prompt: '继续干活', freeze: { goal: '目标', progress: '进度', next: '下一步' } } }, 'session-author')
    ledger.applyRequest('req-run-2', { kind: 'run', taskId: 'card-1' }, 'session-claimer')
    const task = ledger.state().tasks[0]
    expect(task.freeze?.frozenBy).toBe('session-author')
    const execution = task.executions[0]
    expect(execution.initiatedBy).toBe('session-claimer')
    expect(execution.frozenAt).toBe(task.freeze?.frozenAt)
    expect(execution.frozenBy).toBe('session-author')
  })

  it('leaves initiatedBy absent for cron-triggered runs and plain tasks', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('req-c', { kind: 'create', id: 'card-1', input: { title: 'x', description: '', prompt: 'y' } })
    ledger.openScheduled('card-1', undefined, NOW)
    const execution = ledger.state().tasks[0].executions[0]
    expect(execution.initiatedBy).toBeUndefined()
    expect(execution.frozenAt).toBeUndefined()
  })

  it('restamps frozenBy when the freeze snapshot is replaced via update', () => {
    const ledger = new HostTaskLedger(tempRoot(), () => NOW)
    ledger.applyRequest('req-c', { kind: 'create', id: 'card-1', input: { title: 'x', description: '', prompt: 'y', freeze: { goal: 'g', progress: 'p', next: 'n' } } }, 'session-old')
    ledger.applyRequest('req-u', { kind: 'update', taskId: 'card-1', patch: { freeze: { goal: 'g2', progress: 'p', next: 'n' } } }, 'session-new')
    const task = ledger.state().tasks[0]
    expect(task.freeze?.goal).toBe('g2')
    expect(task.freeze?.frozenBy).toBe('session-new')
  })

  it('round-trips the audit fields through the store normalization', () => {
    const card = freezeCard()
    card.executions = [{
      id: 'e1', sessionId: 's-run', startedAt: NOW, endedAt: NOW + 5, result: 'succeeded', error: undefined,
      initiatedBy: 'session-claimer', frozenAt: NOW - 1000, frozenBy: 'session-source',
    }]
    const restored = parseLedger(JSON.stringify([card]))[0]
    expect(restored.freeze?.frozenBy).toBe('session-source')
    expect(restored.executions[0].initiatedBy).toBe('session-claimer')
    expect(restored.executions[0].frozenAt).toBe(NOW - 1000)
    expect(restored.executions[0].frozenBy).toBe('session-source')
  })
})

describe('controller claim initiator (issue #6)', () => {
  it('passes the current session id as the run initiator to the transport', async () => {
    const initial = freezeCard()
    const initiators: Array<string | undefined> = []
    const running: TaskRecord = { ...initial, status: 'running', executions: [{ id: 'e1', sessionId: undefined, startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }
    const snapshot = (revision: number, tasks: readonly TaskRecord[]): TaskBoardSnapshot => ({
      schemaVersion: 3, revision, tasks: [...tasks],
      scheduler: { timeZone: 'UTC', ledgerId: 'ledger-a' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    })
    const transport: TaskBoardTransport = {
      bootstrap: async () => snapshot(1, [initial]),
      state: async () => snapshot(1, [initial]),
      action: async (_action: TaskBoardAction, initiator?: string) => { initiators.push(initiator); return snapshot(2, [running]) },
      subscribe: () => () => undefined,
    }
    const sessions = {
      list: { getSnapshot: () => ({ current: 'session-claimer' }), subscribe: () => () => {} },
      open: () => {},
    }
    const controller = new BoardController({ store: new InMemoryTaskStore(), sessions, transport, now: () => NOW })
    controller.start()
    await controller.retryHostSync()
    await controller.runTask('card-1')
    expect(initiators).toEqual(['session-claimer'])
    controller.dispose()
  })
})
