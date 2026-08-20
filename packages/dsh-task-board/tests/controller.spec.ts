/**
 * Controller tests: orchestration — persistence, view state, navigation
 * awareness, and the full run loop (running → started(sessionId) → settled).
 */
import { describe, expect, it } from 'vitest'
import { BoardController, type ControllerDeps } from '../src/core/controller.ts'
import { ExecutionService, type ExecutionEvent } from '../src/core/execution.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000
let nextId = 0
const uuid = (): string => { nextId += 1; return `id-${nextId}` }

/** Flush pending microtasks (async controller paths). */
const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

/** Controllable sessions face (selection + open). */
class FakeSessions {
  current: string | undefined = undefined
  openCalls: string[] = []
  private listeners = new Set<() => void>()
  list = {
    getSnapshot: (): { current: string | undefined } => ({ current: this.current }),
    subscribe: (fn: () => void): (() => void) => {
      this.listeners.add(fn)
      return () => { this.listeners.delete(fn) }
    },
  }
  open(id: string): void {
    this.openCalls.push(id)
    this.setCurrent(id)
  }
  setCurrent(id: string | undefined): void {
    this.current = id
    for (const fn of [...this.listeners]) fn()
  }
}

/** Controllable ExecutionService stub: captures run calls, fires events on demand. */
class StubExec {
  runCalls: Array<{ taskId: string; executionId: string; fire: (event: ExecutionEvent) => void }> = []
  reconcileResult: ExecutionEvent | undefined = undefined
  async run(task: { id: string }, execution: { id: string }, onEvent: (event: ExecutionEvent) => void): Promise<void> {
    this.runCalls.push({ taskId: task.id, executionId: execution.id, fire: onEvent })
  }
  reconcile(): ExecutionEvent | undefined {
    return this.reconcileResult
  }
}

function makeController(stub = new StubExec()) {
  const sessions = new FakeSessions()
  const store = new InMemoryTaskStore()
  const deps: ControllerDeps = {
    store,
    exec: stub as unknown as ExecutionService,
    sessions,
    now: () => NOW,
    uuid,
  }
  const controller = new BoardController(deps)
  controller.start()
  return { controller, sessions, store, stub }
}

function seedTask(store: InMemoryTaskStore, overrides: Partial<Parameters<typeof createTask>[0] & { id: string }> = {}) {
  const task = createTask(
    { title: '任务A', description: '描述', prompt: 'prompt A', ...overrides },
    NOW,
    overrides.id ?? 'task-a',
  )
  store.save([task])
  return task
}

describe('BoardController execution options', () => {
  it('starts with empty picker option sets and merges partial updates', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().executionOptions).toEqual({ workspaces: [], presets: [] })
    controller.setExecutionOptions({ workspaces: [{ workspaceId: 'ws-1', title: 'One' }] })
    expect(controller.getSnapshot().executionOptions.workspaces).toEqual([{ workspaceId: 'ws-1', title: 'One' }])
    expect(controller.getSnapshot().executionOptions.presets).toEqual([])
    controller.setExecutionOptions({ presets: [{ id: 'anchored', isDefault: true }] })
    expect(controller.getSnapshot().executionOptions).toEqual({
      workspaces: [{ workspaceId: 'ws-1', title: 'One' }],
      presets: [{ id: 'anchored', isDefault: true }],
    })
  })

  it('creates tasks carrying execution targets and updates them back', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '', workspaceId: 'ws-1', mode: 'anchored', permission: 'read-only' })
    expect(task?.workspaceId).toBe('ws-1')
    expect(task?.mode).toBe('anchored')
    expect(task?.permission).toBe('read-only')
    controller.updateTask(task!.id, { workspaceId: undefined, mode: undefined, permission: undefined })
    const after = controller.getSnapshot().tasks[0]
    expect(after.workspaceId).toBeUndefined()
    expect(after.mode).toBeUndefined()
    expect(after.permission).toBeUndefined()
  })
})

describe('BoardController lifecycle', () => {
  it('loads the persisted ledger on start', () => {
    const { store } = makeController()
    seedTask(store)
    const reloaded = new BoardController({
      store, exec: new StubExec() as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => NOW, uuid,
    })
    reloaded.start()
    expect(reloaded.getSnapshot().tasks.map(task => task.id)).toEqual(['task-a'])
  })

  it('reloadFromStore replaces the in-memory ledger from the persisted store, silently', () => {
    const { controller, store } = makeController()
    controller.createTask({ title: 'a', description: '', prompt: '' })
    // A sibling tab deletes the task behind this controller's back (the
    // persisted store is rewritten); the scheduler-facing reload must pick
    // the freshest truth up without re-rendering UI subscribers.
    store.save([])
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    controller.reloadFromStore()
    expect(controller.getSnapshot().tasks).toEqual([])
    expect(notified).toBe(0)
  })

  it('dispose unsubscribes (no more notifications)', () => {
    const { controller, sessions } = makeController()
    let count = 0
    controller.subscribe(() => { count += 1 })
    controller.dispose()
    sessions.setCurrent('s-1')
    expect(count).toBe(0)
  })
})

describe('task mutations', () => {
  it('creates, persists, and rejects blank titles', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: ' 新任务 ', description: '', prompt: '' })
    expect(task).toBeDefined()
    expect(controller.getSnapshot().tasks).toHaveLength(1)
    expect(store.load()[0].title).toBe('新任务')
    expect(controller.createTask({ title: '   ', description: '', prompt: '' })).toBeUndefined()
  })

  it('uses the default uuid path to mint UUIDv4 task ids', () => {
    const controller = new BoardController({
      store: new InMemoryTaskStore(),
      exec: new StubExec() as unknown as ExecutionService,
      sessions: new FakeSessions(),
      now: () => NOW,
    })
    controller.start()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    // crypto.randomUUID is available under node, so the result is provider-agnostic.
    expect(task.id).not.toMatch(/^t-/)
  })

  it('deletes and clears the selection when the selected task is removed', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.openTask(task.id)
    controller.deleteTask(task.id)
    expect(controller.getSnapshot().tasks).toHaveLength(0)
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(store.load()).toEqual([])
  })

  it('updates and moves tasks with persistence', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.updateTask(task.id, { title: 'y' })
    controller.moveTask(task.id, 'backlog')
    const persisted = store.load()[0]
    expect(persisted.title).toBe('y')
    expect(persisted.status).toBe('backlog')
  })
})

describe('view state', () => {
  it('toggles the board and reflects it in the snapshot', () => {
    const { controller } = makeController()
    expect(controller.getSnapshot().boardOpen).toBe(false)
    controller.openBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
    controller.openBoard() // idempotent
    expect(controller.getSnapshot().boardOpen).toBe(true)
    controller.closeBoard()
    expect(controller.getSnapshot().boardOpen).toBe(false)
    controller.toggleBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
  })

  it('closes the board when the user navigates to a session', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    expect(controller.getSnapshot().boardOpen).toBe(true)
    sessions.setCurrent('s-2')
    expect(controller.getSnapshot().boardOpen).toBe(false)
  })

  it('closes the board when a new session is started (selection cleared)', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    sessions.setCurrent(undefined)
    expect(controller.getSnapshot().boardOpen).toBe(false)
  })

  it('stays open on unrelated session-list changes (status updates of the same selection)', () => {
    const { controller, sessions } = makeController()
    sessions.setCurrent('s-1')
    controller.openBoard()
    // A notification with an unchanged selection must not close the board.
    for (const fn of [...(sessions as unknown as { listeners: Set<() => void> }).listeners]) fn()
    expect(controller.getSnapshot().boardOpen).toBe(true)
  })

  it('openTask/closeTask manage the selection', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.openTask(task.id)
    expect(controller.getSnapshot().selectedTaskId).toBe(task.id)
    controller.closeTask()
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
  })

  it('openSession selects the session on the runtime', () => {
    const { controller, sessions } = makeController()
    controller.openSession('exec-session')
    expect(sessions.openCalls).toEqual(['exec-session'])
  })
})

describe('run loop', () => {
  it('moves to running, attaches the session id, and settles on completion', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    const taskId = task.id

    await controller.runTask(taskId)
    expect(exec.runCalls).toHaveLength(1)
    expect(exec.runCalls[0].taskId).toBe(taskId)
    const executionId = exec.runCalls[0].executionId
    expect(store.load()[0].status).toBe('running')

    // The execution service reports the session…
    exec.runCalls[0].fire({ kind: 'started', taskId, executionId, sessionId: 's-9' })
    expect(store.load()[0].executions[0].sessionId).toBe('s-9')
    expect(store.load()[0].status).toBe('running')

    // A second run call while running is ignored.
    await controller.runTask(taskId)
    expect(exec.runCalls).toHaveLength(1)

    // …and settles it.
    exec.runCalls[0].fire({ kind: 'settled', taskId, executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('done')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })

  it('settles failed tasks into the failed column', async () => {
    const stub = new StubExec()
    const { controller, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed', error: 'boom' })
    expect(store.load()[0].status).toBe('failed')
    expect(store.load()[0].executions[0].error).toBe('boom')
  })

  it('rerunTask re-plans a settled task to todo before running again', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '任务A', description: '', prompt: '干活' })!
    await controller.runTask(task.id)
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId: exec.runCalls[0].executionId, outcome: 'failed' })
    expect(controller.getSnapshot().tasks[0].status).toBe('failed')
    await controller.rerunTask(task.id)
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    expect(exec.runCalls).toHaveLength(2)
  })

  it('rejects manual runs and reruns of archived tasks', async () => {
    const stub = new StubExec()
    const { controller, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: '归档任务', description: '', prompt: '干活' })!
    controller.moveTask(task.id, 'done')
    expect(controller.archiveTask(task.id)).toBe(true)

    expect(await controller.runTask(task.id)).toBe(false)
    await controller.rerunTask(task.id)

    expect(exec.runCalls).toHaveLength(0)
    expect(controller.getSnapshot().tasks[0]).toMatchObject({ status: 'done', archivedAt: NOW })
  })

  it('reconciles running tasks left over from a previous load', async () => {
    const stub = new StubExec()
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    const { store } = makeController(stub)
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const reloaded = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions: new FakeSessions(), now: () => NOW, uuid,
    })
    reloaded.start()
    await flush()
    expect(reloaded.getSnapshot().tasks[0].status).toBe('todo')
  })

  it('settles an orphaned running execution on the next session-list change', async () => {
    const stub = new StubExec()
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    // Start resolves while the exec still reports nothing to settle…
    stub.reconcileResult = undefined
    controller.start()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('running')
    // …then a later list change settles the orphan without a page reload.
    stub.reconcileResult = { kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' }
    sessions.setCurrent('s-new')
    await flush()
    await flush()
    expect(controller.getSnapshot().tasks[0].status).toBe('todo')
  })

  it('coalesces a burst of session-list changes into one reconcile pass', async () => {
    let reconcileCalls = 0
    const stub = {
      runCalls: [],
      run: async () => {},
      reconcile: () => { reconcileCalls += 1; return undefined },
    }
    const store = new InMemoryTaskStore()
    const task = seedTask(store, { id: 'task-a' })
    store.save([{ ...task, status: 'running', executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }])
    const sessions = new FakeSessions()
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService,
      sessions, now: () => NOW, uuid, reconcileDebounceMs: 20,
    })
    controller.start()
    await flush()
    const before = reconcileCalls
    for (let i = 0; i < 5; i += 1) sessions.setCurrent('s-' + i)
    await new Promise(resolve => { setTimeout(resolve, 50) })
    expect(reconcileCalls - before).toBe(1)
  })

  it('keeps a page-launched run running on list updates; only the watch settles it', async () => {
    const stub = new StubExec()
    const { controller, sessions, store, stub: exec } = makeController(stub)
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    // Start a run; attach its session id.
    await controller.runTask(task.id)
    const executionId = exec.runCalls[0].executionId
    exec.runCalls[0].fire({ kind: 'started', taskId: task.id, executionId, sessionId: 's-1' })
    expect(store.load()[0].status).toBe('running')

    // A session-list notification (the executing session appearing in the
    // list while its turn has not started yet) must NOT settle the run via
    // reconciliation: a freshly created session is idle, not completed.
    stub.reconcileResult = { kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' }
    sessions.setCurrent('s-2')
    await flush()
    expect(store.load()[0].status).toBe('running')

    // The live watch settles on the turn boundary.
    exec.runCalls[0].fire({ kind: 'settled', taskId: task.id, executionId, outcome: 'succeeded' })
    expect(store.load()[0].status).toBe('done')
    expect(store.load()[0].executions[0].result).toBe('succeeded')
  })
})

describe('scheduling', () => {
  it('setSchedule enables a rule and computes the next run instant', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(true)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeDefined()
  })

  it('does not let archived tasks re-enable their schedules', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(true)
    controller.moveTask(task.id, 'done')
    expect(controller.archiveTask(task.id)).toBe(true)
    expect(store.load()[0].schedule).toMatchObject({ enabled: false, nextRunAt: undefined })
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(false)
  })

  it('rejects blank or invalid cron expressions without touching state', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.setSchedule(task.id, { enabled: true, cron: 'not a cron' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true, cron: '   ' })).toBe(false)
    expect(controller.setSchedule(task.id, { enabled: true })).toBe(false) // no existing cron → blank → rejected
    expect(store.load()[0].schedule).toBeUndefined()
  })

  it('disabling a rule clears the next run instant but keeps the cron', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    expect(controller.setSchedule(task.id, { enabled: false })).toBe(true)
    const persisted = store.load()[0]
    expect(persisted.schedule?.enabled).toBe(false)
    expect(persisted.schedule?.cron).toBe('* * * * *')
    expect(persisted.schedule?.nextRunAt).toBeUndefined()
  })

  it('recomputes the next run when the cron changes while enabled', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    const first = store.load()[0].schedule?.nextRunAt
    controller.setSchedule(task.id, { cron: '*/5 * * * *' })
    const second = store.load()[0].schedule?.nextRunAt
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
  })

  it('applyScheduleNextRun rolls the schedule forward for the scheduler', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })
    controller.applyScheduleNextRun(task.id, 1_234_567_890, 1_234_500_000)
    const persisted = store.load()[0]
    expect(persisted.schedule?.nextRunAt).toBe(1_234_567_890)
    expect(persisted.schedule?.lastTriggeredAt).toBe(1_234_500_000)
  })

  it('applyScheduleNextRun is a no-op for tasks without a schedule rule', () => {
    const { controller } = makeController()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(() => controller.applyScheduleNextRun(task.id, 1, 2)).not.toThrow()
    expect(controller.getSnapshot().tasks[0].schedule).toBeUndefined()
  })
})

/** Store that can simulate a sibling tab writing the ledger. */
class ExternalAwareStore extends InMemoryTaskStore {
  listeners = new Set<() => void>()
  subscribeExternal(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Simulate another tab persisting a new ledger document. */
  writeFromElsewhere(tasks: readonly TaskRecord[]): void {
    this.save(tasks)
    for (const listener of [...this.listeners]) listener()
  }
}

describe('external (cross-tab) ledger changes', () => {
  function makeWithExternalStore() {
    const sessions = new FakeSessions()
    const store = new ExternalAwareStore()
    const controller = new BoardController({
      store,
      exec: new StubExec() as unknown as ExecutionService,
      sessions,
      now: () => NOW,
      uuid,
    })
    controller.start()
    return { controller, sessions, store }
  }

  it('reloads the ledger when a sibling tab deletes a task', () => {
    const { controller, store } = makeWithExternalStore()
    const task = controller.createTask({ title: 'x', description: '', prompt: '' })!
    expect(controller.getSnapshot().tasks.map(t => t.id)).toEqual([task.id])
    // Another tab deletes the task and persists; this tab must drop it too,
    // so its scheduler can never fire (or write back) the deleted task.
    store.writeFromElsewhere([])
    expect(controller.getSnapshot().tasks).toHaveLength(0)
    expect(store.load()).toEqual([])
  })

  it('reloads a task created in a sibling tab', () => {
    const { controller, store } = makeWithExternalStore()
    expect(controller.getSnapshot().tasks).toHaveLength(0)
    const task = createTask({ title: '从别的标签页创建', description: '', prompt: '' }, NOW, 'other-tab')
    store.writeFromElsewhere([task])
    expect(controller.getSnapshot().tasks.map(t => t.id)).toEqual(['other-tab'])
  })

  it('keeps a sibling-tab edit made while reconcile is in flight', async () => {
    let resolveReconcile: ((event: ExecutionEvent | undefined) => void) | undefined
    let reconcileCalls = 0
    const stub = {
      reconcile: (): Promise<ExecutionEvent | undefined> => {
        reconcileCalls += 1
        // The startup pass finds the orphan but has nothing to settle yet;
        // every later call stays parked until the test resolves it.
        if (reconcileCalls === 1) return Promise.resolve(undefined)
        return new Promise(resolve => { resolveReconcile = resolve })
      },
    }
    const store = new ExternalAwareStore()
    const sessions = new FakeSessions()
    const orphan = seedTask(store, { id: 'task-a', title: '旧标题' })
    const running = {
      ...orphan,
      status: 'running' as const,
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }
    store.save([running])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService, sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    expect(reconcileCalls).toBe(1)
    expect(controller.getSnapshot().tasks[0].status).toBe('running')

    // A session-list change starts the reconcile we want to race.
    sessions.setCurrent('s-new')
    await flush()
    expect(reconcileCalls).toBe(2)
    expect(resolveReconcile).toBeDefined()

    // While reconcile awaits, a sibling tab renames the task and this tab
    // reloads the ledger through the storage event.
    store.writeFromElsewhere([{ ...running, title: '外部新标题', updatedAt: NOW + 1 }])
    expect(controller.getSnapshot().tasks[0].title).toBe('外部新标题')

    // The settle event computed from the pre-edit snapshot arrives late.
    resolveReconcile!({ kind: 'settled', taskId: 'task-a', executionId: 'e1', outcome: 'cancelled', error: 'gone' })
    await flush()
    await flush()

    const settled = controller.getSnapshot().tasks[0]
    expect(settled.title).toBe('外部新标题')
    expect(settled.status).toBe('todo')
    expect(settled.executions[0]).toMatchObject({ id: 'e1', result: 'cancelled', error: 'gone' })
    const persisted = store.load()[0]
    expect(persisted.title).toBe('外部新标题')
    expect(JSON.stringify(store.load())).not.toContain('旧标题')
  })

  it('re-arms a session change that arrives while reconcile is in flight', async () => {
    let resolveFirst: (() => void) | undefined
    let reconcileCalls = 0
    const stub = {
      reconcile: (task: { id: string }): Promise<ExecutionEvent | undefined> => {
        reconcileCalls += 1
        if (task.id === 'task-a') {
          // The startup pass for A parks; a later pass finds A still running.
          if (reconcileCalls === 1) return new Promise(resolve => { resolveFirst = () => resolve(undefined) })
          return Promise.resolve(undefined)
        }
        // B's session already finished: settle it.
        return Promise.resolve({ kind: 'settled', taskId: 'task-b', executionId: 'e2', outcome: 'succeeded', error: undefined })
      },
    }
    const store = new ExternalAwareStore()
    const sessions = new FakeSessions()
    const seedA = seedTask(store, { id: 'task-a', title: 'A' })
    const seedB = seedTask(store, { id: 'task-b', title: 'B' })
    const runningA = { ...seedA, status: 'running' as const, executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }
    const runningB = { ...seedB, status: 'running' as const, executions: [{ id: 'e2', sessionId: 's-2', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }] }
    store.save([runningA, runningB])
    const controller = new BoardController({
      store, exec: stub as unknown as ExecutionService, sessions, now: () => NOW, uuid, reconcileDebounceMs: 0,
    })
    controller.start()
    await flush()
    // The startup pass is parked on A.
    expect(reconcileCalls).toBe(1)
    expect(resolveFirst).toBeDefined()

    // B's session finishes while A's reconcile is still in flight; the change
    // must re-arm the debounce, not drop B.
    sessions.setCurrent('s-other')
    await flush()
    resolveFirst!()
    await flush()
    await flush()
    await flush()

    // The re-armed pass settled B instead of dropping the notification.
    const b = controller.getSnapshot().tasks.find(t => t.id === 'task-b')
    expect(b?.status).toBe('done')
    expect(reconcileCalls).toBeGreaterThanOrEqual(3)
  })

  it('stops reacting to external changes after dispose', () => {
    const { controller, store } = makeWithExternalStore()
    let notified = 0
    controller.subscribe(() => { notified += 1 })
    controller.dispose()
    store.writeFromElsewhere([])
    expect(notified).toBe(0)
  })
})
