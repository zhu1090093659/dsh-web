/**
 * Pure task-domain tests: creation, status transitions, execution settlement.
 */
import { describe, expect, it } from 'vitest'
import {
  canMoveManually, createTask, EXECUTION_HISTORY_LIMIT, executionLabel, retainRecentExecutions,
  settleExecution, startExecution, withSchedule, withStatus,
} from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function sampleTask() {
  return createTask(
    { title: '  修复登录页样式  ', description: '按钮颜色不对', prompt: '请修复登录页按钮的样式问题' },
    NOW,
    'task-1',
  )
}

describe('createTask', () => {
  it('trims inputs, defaults to todo, and records timestamps', () => {
    const task = sampleTask()
    expect(task.title).toBe('修复登录页样式')
    expect(task.description).toBe('按钮颜色不对')
    expect(task.prompt).toBe('请修复登录页按钮的样式问题')
    expect(task.status).toBe('todo')
    expect(task.createdAt).toBe(NOW)
    expect(task.updatedAt).toBe(NOW)
    expect(task.executions).toEqual([])
  })

  it('keeps ids and empty optional fields intact', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, NOW, 'task-2')
    expect(task.id).toBe('task-2')
    expect(task.description).toBe('')
    expect(task.prompt).toBe('')
    expect(task.workspaceId).toBeUndefined()
    expect(task.mode).toBeUndefined()
    expect(task.permission).toBeUndefined()
  })

  it('carries the execution targets and collapses blank ones', () => {
    const task = createTask(
      { title: 'x', description: '', prompt: '', workspaceId: '  ws-1  ', mode: 'anchored', permission: 'danger-full-access' },
      NOW,
      'task-3',
    )
    expect(task.workspaceId).toBe('ws-1')
    expect(task.mode).toBe('anchored')
    expect(task.permission).toBe('danger-full-access')
    const blank = createTask(
      { title: 'x', description: '', prompt: '', workspaceId: '   ', mode: '', permission: undefined },
      NOW,
      'task-4',
    )
    expect(blank.workspaceId).toBeUndefined()
    expect(blank.mode).toBeUndefined()
    expect(blank.permission).toBeUndefined()
  })

  it('drops unknown permission strings', () => {
    const task = createTask(
      { title: 'x', description: '', prompt: '', permission: 'root' as never },
      NOW,
      'task-5',
    )
    expect(task.permission).toBeUndefined()
  })
})

describe('status transitions', () => {
  it('manual moves are allowed only to backlog/todo', () => {
    expect(canMoveManually('todo', 'backlog')).toBe(true)
    expect(canMoveManually('failed', 'todo')).toBe(true)
    expect(canMoveManually('done', 'backlog')).toBe(true)
    expect(canMoveManually('todo', 'running')).toBe(false)
    expect(canMoveManually('backlog', 'done')).toBe(false)
  })

  it('withStatus bumps updatedAt and swaps the status', () => {
    const moved = withStatus(sampleTask(), 'backlog', NOW + 1)
    expect(moved.status).toBe('backlog')
    expect(moved.updatedAt).toBe(NOW + 1)
  })

  it('startExecution moves to running and appends an open execution', () => {
    const { task, execution } = startExecution(sampleTask(), NOW + 5, 'exec-1')
    expect(task.status).toBe('running')
    expect(task.executions).toHaveLength(1)
    expect(execution.id).toBe('exec-1')
    expect(execution.startedAt).toBe(NOW + 5)
    expect(execution.endedAt).toBeUndefined()
    expect(execution.result).toBeUndefined()
    expect(task.updatedAt).toBe(NOW + 5)
  })
})

describe('settleExecution', () => {
  it('settles a run as done on success', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 10, undefined)
    expect(settled.status).toBe('done')
    expect(settled.executions[0].endedAt).toBe(NOW + 10)
    expect(settled.executions[0].result).toBe('succeeded')
    expect(settled.executions[0].error).toBeUndefined()
  })

  it('settles a run as failed on failure', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'failed', NOW + 10, 'boom')
    expect(settled.status).toBe('failed')
    expect(settled.executions[0].result).toBe('failed')
    expect(settled.executions[0].error).toBe('boom')
  })

  it('cancelled runs return a non-running task to todo', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'cancelled', NOW + 10, 'interrupted')
    expect(settled.status).toBe('todo')
    expect(settled.executions[0].result).toBe('cancelled')
  })

  it('keeps recurring task in todo on successful execution', () => {
    const recurring = withSchedule(sampleTask(), { enabled: true, cron: '0 12 * * *' }, NOW)
    const { task } = startExecution(recurring, NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 10, undefined)
    expect(settled.status).toBe('todo')
    expect(settled.executions[0].result).toBe('succeeded')
  })

  it('is a no-op for unknown or already-settled executions', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    expect(settleExecution(task, 'nope', 'succeeded', NOW + 1, undefined)).toBe(task)
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 1, undefined)
    // Second settle with the same id does not overwrite the outcome.
    const again = settleExecution(settled, 'exec-1', 'failed', NOW + 2, 'late')
    expect(again.executions[0].result).toBe('succeeded')
    expect(again.executions[0].endedAt).toBe(NOW + 1)
  })

  it('keeps sibling executions intact', () => {
    let task = sampleTask()
    const first = startExecution(task, NOW, 'exec-1')
    task = first.task
    const second = startExecution(task, NOW + 1, 'exec-2')
    const settled = settleExecution(second.task, 'exec-2', 'succeeded', NOW + 2, undefined)
    expect(settled.executions).toHaveLength(2)
    expect(settled.executions[0].result).toBeUndefined()
    expect(settled.executions[1].result).toBe('succeeded')
  })
})

describe('execution history retention', () => {
  it('trims the oldest run when a 21st execution starts', () => {
    let task = sampleTask()
    for (let i = 1; i <= EXECUTION_HISTORY_LIMIT; i += 1) {
      const started = startExecution(task, NOW + i, `exec-${i}`)
      task = settleExecution(started.task, `exec-${i}`, 'succeeded', NOW + i + 1, undefined)
    }
    const opened = startExecution(task, NOW + EXECUTION_HISTORY_LIMIT + 1, `exec-${EXECUTION_HISTORY_LIMIT + 1}`)
    expect(opened.task.executions).toHaveLength(EXECUTION_HISTORY_LIMIT)
    expect(opened.task.executions[0].id).toBe('exec-2')
    expect(opened.task.executions.at(-1)?.id).toBe(`exec-${EXECUTION_HISTORY_LIMIT + 1}`)
    expect(opened.task.executions.at(-1)?.endedAt).toBeUndefined()
  })

  it('trims only settled history, never the running execution', () => {
    const settled = Array.from({ length: EXECUTION_HISTORY_LIMIT + 5 }, (_, index) => ({
      id: `settled-${index}`,
      sessionId: `session-${index}`,
      startedAt: index,
      endedAt: index + 1,
      result: 'succeeded' as const,
      error: undefined,
    }))
    const running = {
      id: 'running',
      sessionId: 'session-open',
      startedAt: EXECUTION_HISTORY_LIMIT + 10,
      endedAt: undefined,
      result: undefined,
      error: undefined,
    }
    const kept = retainRecentExecutions([...settled, running])
    expect(kept).toHaveLength(EXECUTION_HISTORY_LIMIT)
    expect(kept.at(-1)?.id).toBe('running')
    expect(kept.at(-1)?.endedAt).toBeUndefined()
    expect(kept.slice(0, -1).map(entry => entry.id)).toEqual(
      Array.from({ length: EXECUTION_HISTORY_LIMIT - 1 }, (_, index) => `settled-${index + 6}`),
    )
  })

  it('copies lists within the limit without reordering', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const kept = retainRecentExecutions(task.executions)
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe('exec-1')
    expect(kept).not.toBe(task.executions)
  })
})

describe('executionLabel', () => {
  it('describes open and settled runs', () => {
    const { execution } = startExecution(sampleTask(), NOW, 'e1')
    expect(executionLabel(execution)).toBe('running')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'succeeded' })).toBe('succeeded')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'failed' })).toBe('failed')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'cancelled' })).toBe('cancelled')
  })
})

describe('withSchedule', () => {
  it('creates a schedule rule on a task without one and bumps updatedAt', () => {
    const task = sampleTask()
    const scheduled = withSchedule(task, { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100 }, NOW + 1)
    expect(scheduled.schedule).toEqual({ enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100, lastTriggeredAt: undefined })
    expect(scheduled.updatedAt).toBe(NOW + 1)
    expect(task.schedule).toBeUndefined() // original untouched
  })

  it('merges partial patches and keeps untouched schedule fields', () => {
    const task = withSchedule(
      sampleTask(),
      { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100, lastTriggeredAt: NOW },
      NOW,
    )
    const rolled = withSchedule(task, { nextRunAt: NOW + 200 }, NOW + 2)
    expect(rolled.schedule).toEqual({ enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 200, lastTriggeredAt: NOW })
  })

  it('keeps executions and other task fields intact', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const scheduled = withSchedule(task, { enabled: false, cron: '*/10 * * * *' }, NOW + 1)
    expect(scheduled.executions).toHaveLength(1)
    expect(scheduled.status).toBe('running')
  })

  it('explicit undefined clears a field (disarming nextRunAt)', () => {
    const task = withSchedule(
      sampleTask(),
      { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100 },
      NOW,
    )
    const cleared = withSchedule(task, { nextRunAt: undefined }, NOW + 1)
    expect(cleared.schedule?.enabled).toBe(true)
    expect(cleared.schedule?.cron).toBe('0 9 * * *')
    expect(cleared.schedule?.nextRunAt).toBeUndefined()
  })
})
