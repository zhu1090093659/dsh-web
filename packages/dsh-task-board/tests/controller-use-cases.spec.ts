/**
 * Controller use-case unit tests: the extracted create/update/delete/schedule
 * domain transitions in isolation (no store/exec/sessions faces), plus a
 * smoke check that BoardController routes through them with the same external
 * contract.
 */
import { describe, expect, it } from 'vitest'
import { BoardController, selectedTaskOf, type ControllerDeps } from '../src/core/controller.ts'
import { ExecutionService } from '../src/core/execution.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { applyCreateTask } from '../src/core/use-cases/task-create.ts'
import { applyDeleteTask } from '../src/core/use-cases/task-delete.ts'
import { applyScheduleNextRun, applySetSchedule } from '../src/core/use-cases/task-schedule.ts'
import { applyUpdateTask } from '../src/core/use-cases/task-update.ts'

const NOW = 1_700_000_000_000

/** A ready-made ledger seed for transition tests. */
function seed(n = 0): TaskRecord[] {
  return Array.from({ length: n }, (_, index) =>
    createTask({ title: `t${index}`, description: '', prompt: '' }, NOW, `id-${index}`))
}

describe('use-case: create', () => {
  it('mints a task and appends it to the ledger', () => {
    const before = seed()
    const result = applyCreateTask(before, { title: ' 新任务 ', description: ' d ', prompt: ' p ' }, NOW, 'id-x')
    expect(result.task?.title).toBe('新任务')
    expect(result.tasks).toHaveLength(before.length + 1)
    expect(result.tasks[result.tasks.length - 1].id).toBe('id-x')
  })

  it('rejects a blank title and leaves the ledger untouched', () => {
    const before = seed()
    const result = applyCreateTask(before, { title: '   ', description: '', prompt: '' }, NOW, 'id-x')
    expect(result.task).toBeUndefined()
    expect(result.tasks).toHaveLength(before.length)
    expect(result.tasks).toBe(before) // identical reference: no transition
  })
})

describe('use-case: update', () => {
  it('applies an editable patch with a fresh updatedAt', () => {
    const updated = applyUpdateTask(seed(2), 'id-0', { title: 'renamed' }, NOW + 5)
    expect(updated[0].title).toBe('renamed')
    expect(updated[0].updatedAt).toBe(NOW + 5)
    expect(updated[1].title).toBe('t1') // untouched
    expect(updated[1].updatedAt).toBe(NOW)
  })

  it('leaves the ledger unchanged for an unknown id', () => {
    const updated = applyUpdateTask(seed(2), 'missing', { title: 'x' }, NOW)
    expect(updated.map(t => t.id)).toEqual(['id-0', 'id-1'])
  })

  it('applies execution-target patches and clears pins with undefined', () => {
    const pinned = applyUpdateTask(seed(2), 'id-0', { workspaceId: 'ws-1', mode: 'anchored', permission: 'read-only' }, NOW + 6)
    expect(pinned[0].workspaceId).toBe('ws-1')
    expect(pinned[0].mode).toBe('anchored')
    expect(pinned[0].permission).toBe('read-only')

    const cleared = applyUpdateTask(pinned, 'id-0', { workspaceId: undefined, mode: undefined, permission: undefined }, NOW + 7)
    expect(cleared[0].workspaceId).toBeUndefined()
    expect(cleared[0].mode).toBeUndefined()
    expect(cleared[0].permission).toBeUndefined()
  })

  it('collapses blank target strings and keeps an unknown permission out', () => {
    const blank = applyUpdateTask(seed(2), 'id-0', { workspaceId: '   ', mode: '' }, NOW + 6)
    expect(blank[0].workspaceId).toBeUndefined()
    expect(blank[0].mode).toBeUndefined()

    const pinned = applyUpdateTask(seed(2), 'id-0', { permission: 'workspace-write' }, NOW + 6)
    const invalid = applyUpdateTask(pinned, 'id-0', { permission: 'root' as never }, NOW + 7)
    expect(invalid[0].permission).toBe('workspace-write')
  })
})

describe('use-case: delete', () => {
  it('drops the task and clears a selection pointing at it', () => {
    const result = applyDeleteTask(seed(3), 'id-1', 'id-1')
    expect(result.tasks.map(t => t.id)).toEqual(['id-0', 'id-2'])
    expect(result.selectionCleared).toBe(true)
  })

  it('keeps the selection when deleting an unrelated task', () => {
    const result = applyDeleteTask(seed(3), 'id-2', 'id-0')
    expect(result.tasks).toHaveLength(2)
    expect(result.selectionCleared).toBe(false)
  })
})

describe('use-case: schedule', () => {
  it('arms an enabled rule and computes the next run instant', () => {
    const before = seed(1)
    const result = applySetSchedule(before, 'id-0', { enabled: true, cron: '* * * * *' }, NOW)
    expect(result.applied).toBe(true)
    const schedule = result.tasks[0].schedule
    expect(schedule?.enabled).toBe(true)
    expect(schedule?.cron).toBe('* * * * *')
    expect(schedule?.nextRunAt).toBeDefined()
  })

  it('rejects a blank or invalid cron without changing the ledger', () => {
    const before = seed(1)
    const invalid = applySetSchedule(before, 'id-0', { enabled: true, cron: 'not a cron' }, NOW)
    const blank = applySetSchedule(before, 'id-0', { enabled: true, cron: '   ' }, NOW)
    const unknown = applySetSchedule(before, 'missing', { enabled: true, cron: '* * * * *' }, NOW)
    expect(invalid.applied).toBe(false)
    expect(blank.applied).toBe(false)
    expect(unknown.applied).toBe(false)
    expect(invalid.tasks).toBe(before)
    expect(blank.tasks).toBe(before)
  })

  it('disabling a rule clears nextRunAt but keeps the cron', () => {
    const armed = applySetSchedule(seed(1), 'id-0', { enabled: true, cron: '* * * * *' }, NOW)
    const disarmed = applySetSchedule(armed.tasks, 'id-0', { enabled: false }, NOW)
    const schedule = disarmed.tasks[0].schedule!
    expect(schedule.enabled).toBe(false)
    expect(schedule.cron).toBe('* * * * *')
    expect(schedule.nextRunAt).toBeUndefined()
  })

  it('rolls a ruler forward via applyScheduleNextRun', () => {
    const armed = applySetSchedule(seed(1), 'id-0', { enabled: true, cron: '* * * * *' }, NOW)
    const rolled = applyScheduleNextRun(armed.tasks, 'id-0', 1_000_002, 1_000_001, NOW)
    expect(rolled[0].schedule?.nextRunAt).toBe(1_000_002)
    expect(rolled[0].schedule?.lastTriggeredAt).toBe(1_000_001)
  })

  it('applyScheduleNextRun is a no-op for tasks without a rule', () => {
    const rolled = applyScheduleNextRun(seed(1), 'id-0', 1, 2, NOW)
    expect(rolled[0].schedule).toBeUndefined()
  })
})

/** Minimal sessions/exec faces for a controller smoke test. */
class FakeSessions {
  current: string | undefined = undefined
  openCalls: string[] = []
  list = {
    getSnapshot: (): { current: string | undefined } => ({ current: this.current }),
    subscribe: (): (() => void) => () => { },
  }
  open(id: string): void { this.openCalls.push(id) }
}

function makeController() {
  const store = new InMemoryTaskStore()
  const controller = new BoardController({
    store,
    exec: new (class { run = async () => { }; reconcile = () => undefined })() as unknown as ExecutionService,
    sessions: new FakeSessions(),
    now: () => NOW,
    uuid: () => 'id-x',
  })
  controller.start()
  return { controller, store }
}

describe('BoardController routes use-cases (external contract)', () => {
  it('createTask/updateTask/deleteTask/setSchedule keep the public behavior', () => {
    const { controller, store } = makeController()
    const task = controller.createTask({ title: ' 新任务 ', description: '', prompt: '' })!
    expect(selectedTaskOf(controller.getSnapshot())).toBeUndefined()
    controller.openTask(task.id)
    expect(selectedTaskOf(controller.getSnapshot())!.id).toBe(task.id)
    controller.updateTask(task.id, { title: 'renamed' })
    expect(controller.getSnapshot().tasks[0].title).toBe('renamed')
    expect(controller.setSchedule(task.id, { enabled: true, cron: '* * * * *' })).toBe(true)
    expect(store.load()[0].schedule?.enabled).toBe(true)
    controller.applyScheduleNextRun(task.id, 1_000_002, 1_000_001)
    expect(controller.getSnapshot().tasks[0].schedule?.nextRunAt).toBe(1_000_002)
    controller.deleteTask(task.id)
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(controller.getSnapshot().tasks).toHaveLength(0)
  })
})
