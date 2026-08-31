/**
 * Continuation-card data plane (issue #4): the first full vertical slice
 * action -> protocol gate -> controller -> Host ledger -> snapshot read-back,
 * plus the board filter over frozen snapshot text.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BoardController, type TaskBoardTransport } from '../src/core/controller.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import type { TaskRecord } from '../src/core/tasks.ts'
import { HostTaskLedger } from '../src/host-ledger.ts'
import { parseActionEnvelope, TASK_BOARD_API_PREFIX, type TaskBoardSnapshot } from '../src/protocol.ts'
import { matchesFilter } from '../src/client/board/TaskBoard.tsx'
import { createTask } from '../src/core/tasks.ts'
import { requiresPermissionConfirmation } from '../src/core/handover.ts'

const NOW = 1_700_000_000_000
let nextId = 0
const uuid = (): string => { nextId += 1; return `id-${nextId}` }

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-task-board-cont-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function envelope(action: unknown): ReturnType<typeof parseActionEnvelope> {
  return parseActionEnvelope({ requestId: `req-${uuid()}`, action })
}

describe('continuation card: protocol gate reuses the T2 security gates', () => {
  it('accepts a create action with a freeze snapshot and redacts sensitive patterns in place', () => {
    const parsed = envelope({
      kind: 'create', id: 'card-1',
      input: {
        title: '续接：数据面', description: '', prompt: 'p',
        freeze: { goal: 'Bearer abcdefghijklmnop', progress: '进度文本', next: '下一步文本' },
      },
    })
    expect(parsed).toBeDefined()
    if (parsed === undefined) return
    expect(parsed.action.kind).toBe('create')
    if (parsed.action.kind !== 'create') return
    expect(parsed.action.input.freeze?.goal).toBe('[REDACTED]')
    expect(parsed.action.input.freeze?.progress).toBe('进度文本')
    expect(parsed.action.input.freeze?.redacted).toBe(true)
  })

  it('rejects a freeze snapshot carrying a slash-prefixed DSH command line', () => {
    expect(envelope({
      kind: 'create', id: 'card-1',
      input: { title: 't', description: '', prompt: 'p', freeze: { goal: '目标', progress: '/permission danger-full-access', next: '下一步' } },
    })).toBeUndefined()
  })

  it('rejects a freeze field over the 8 KiB byte limit', () => {
    expect(envelope({
      kind: 'create', id: 'card-1',
      input: { title: 't', description: '', prompt: 'p', freeze: { goal: '长'.repeat(8193 / 2), progress: '', next: '' } },
    })).toBeUndefined()
  })

  it('rejects a non-string freeze field shape', () => {
    expect(envelope({
      kind: 'create', id: 'card-1',
      input: { title: 't', description: '', prompt: 'p', freeze: { goal: 1, progress: '', next: '' } },
    })).toBeUndefined()
  })

  it('accepts an update action replacing or clearing the freeze (null clears)', () => {
    const replaced = envelope({ kind: 'update', taskId: 'task-1', patch: { freeze: { goal: 'g2', progress: 'p2', next: 'n2' } } })
    expect(replaced?.action.kind).toBe('update')
    if (replaced?.action.kind === 'update') expect(replaced.action.patch.freeze?.goal).toBe('g2')
    const cleared = envelope({ kind: 'update', taskId: 'task-1', patch: { freeze: null } })
    expect(cleared?.action.kind).toBe('update')
    if (cleared?.action.kind === 'update') expect(cleared.action.patch.freeze).toBeNull()
  })
})

describe('continuation card: vertical action -> controller -> ledger -> snapshot read-back', () => {
  function makeController(root: string): { controller: BoardController; ledger: HostTaskLedger } {
    const ledger = new HostTaskLedger(root, () => NOW)
    const toSnapshot = (state: { revision: number; tasks: TaskRecord[]; scheduler: TaskBoardSnapshot['scheduler'] }): TaskBoardSnapshot => ({
      schemaVersion: 3,
      revision: state.revision,
      tasks: state.tasks,
      scheduler: state.scheduler,
      power: {
        platform: 'linux', phase: 'unsupported', enabled: false,
        runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
      },
    })
    const transport: TaskBoardTransport = {
      bootstrap: async () => toSnapshot(ledger.state()),
      state: async () => toSnapshot(ledger.state()),
      action: async action => toSnapshot(ledger.applyRequest(uuid(), action).state),
      subscribe: listener => ledger.subscribe(() => { listener(toSnapshot(ledger.state())) }),
    }
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      sessions: fakeSessions(),
      transport,
      now: () => NOW,
      uuid,
    })
    controller.start()
    return { controller, ledger }
  }

  function fakeSessions() {
    const listeners = new Set<() => void>()
    return {
      list: {
        getSnapshot: () => ({ current: undefined }),
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      },
      open: () => {},
    }
  }

  it('creates a card whose freeze persists through the ledger and reads back from disk', async () => {
    const root = tempRoot()
    const { controller, ledger } = makeController(root)
    const created = await controller.createTaskConfirmed({
      title: '续接卡片', description: '', prompt: 'p',
      freeze: { goal: '目标文本', progress: '进度文本', next: '下一步文本', redacted: true },
    })
    expect(created?.freeze).toMatchObject({ goal: '目标文本', progress: '进度文本', next: '下一步文本', redacted: true, frozenAt: NOW })

    // Disk read-back: a fresh ledger over the same directory keeps the freeze.
    ledger.dispose()
    const reopened = new HostTaskLedger(root, () => NOW)
    const persisted = reopened.state().tasks.find(task => task.title === '续接卡片')
    expect(persisted?.freeze).toMatchObject({ goal: '目标文本', next: '下一步文本', frozenAt: NOW })
  })

  it('updates and clears the freeze through the update action', async () => {
    const root = tempRoot()
    const { controller } = makeController(root)
    const created = await controller.createTaskConfirmed({
      title: 'c', description: '', prompt: 'p',
      freeze: { goal: 'g1', progress: 'p1', next: 'n1' },
    })
    const id = created?.id
    expect(id).toBeDefined()
    if (id === undefined) return

    controller.updateTask(id, { freeze: { goal: 'g2', progress: 'p2', next: 'n2' } })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(controller.getSnapshot().tasks.find(task => task.id === id)?.freeze?.goal).toBe('g2')

    controller.updateTask(id, { freeze: null })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(controller.getSnapshot().tasks.find(task => task.id === id)?.freeze).toBeUndefined()
  })

  it('keeps the freeze across archive and restore (board parity for continuation cards)', async () => {
    const root = tempRoot()
    const { controller, ledger } = makeController(root)
    const created = await controller.createTaskConfirmed({
      title: 'c', description: '', prompt: 'p',
      freeze: { goal: 'g', progress: 'p', next: 'n' },
    })
    const id = created?.id
    if (id === undefined) return
    // Settle the task so it becomes archivable.
    ledger.applyRequest(uuid(), { kind: 'run', taskId: id })
    ledger.settle(id, ledger.state().tasks[0]!.executions[0]!.id, 'failed')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(controller.archiveTask(id)).toBe(true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(controller.getSnapshot().tasks.find(task => task.id === id)?.archivedAt).toBeDefined()
    expect(controller.restoreTask(id)).toBe(true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const restored = controller.getSnapshot().tasks.find(task => task.id === id)
    expect(restored?.archivedAt).toBeUndefined()
    expect(restored?.freeze?.goal).toBe('g')
  })
})

describe('board filter covers frozen snapshot text', () => {
  it('matches a filter term found only inside the freeze fields', () => {
    const task = createTask({ title: 't', description: 'd', prompt: 'p', freeze: { goal: '重构解析器', progress: '', next: '' } }, NOW, 'id-1')
    expect(matchesFilter(task, '解析器')).toBe(true)
    expect(matchesFilter(task, '不存在词')).toBe(false)
  })
})

describe('continuation card: import keeps the freeze snapshot', () => {
  it('round-trips a frozen task through the import action whitelist', () => {
    const parsed = envelope({
      kind: 'import', sourceId: 'browser-x',
      tasks: [{ ...createTask({ title: 'c', description: '', prompt: 'p' }, NOW, 'card-i'), freeze: { goal: 'g', progress: 'p', next: 'n', frozenAt: NOW } }],
    })
    expect(parsed?.action.kind).toBe('import')
    if (parsed?.action.kind !== 'import') return
    expect(parsed.action.tasks[0]?.freeze).toMatchObject({ goal: 'g', frozenAt: NOW })
  })

  // 对抗场景 b（提权）：import 不是人工确认动作，伪造的确认戳必须被剥除，
  // 高于会话默认权限的绑定导入后重新武装 confirm-permission 门。
  it('strips an imported permissionConfirmedAt stamp so the confirmation gate re-arms', () => {
    const parsed = envelope({
      kind: 'import', sourceId: 'browser-evil',
      tasks: [{
        ...createTask({ title: 'c', description: '', prompt: 'p' }, NOW, 'card-evil'),
        handover: { permission: 'danger-full-access', references: [], bundledAt: NOW },
        permissionConfirmedAt: NOW,
      }],
    })
    expect(parsed?.action.kind).toBe('import')
    if (parsed?.action.kind !== 'import') return
    const task = parsed.action.tasks[0]
    expect(task?.handover?.permission).toBe('danger-full-access')
    expect(task?.permissionConfirmedAt).toBeUndefined()
    expect(requiresPermissionConfirmation(task!)).toBe(true)
  })
})

// Keep the API prefix import honest (the action protocol stays the only production mutation path).
expect(TASK_BOARD_API_PREFIX).toBe('/api/task-board')
