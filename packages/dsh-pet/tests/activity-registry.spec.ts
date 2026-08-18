import { describe, expect, it } from 'vitest'
import { ActivityRegistry } from '../src/core/activity-registry.ts'
import { selectPrimaryTask } from '../src/core/primary-task.ts'
import { petTaskId, type PetTaskSnapshot } from '../src/core/protocol.ts'

const instance = { instanceId: 'web-profile', bootId: 'boot-a' }

function task(
  sessionId: string,
  phase: PetTaskSnapshot['phase'],
  updatedAt: number,
): PetTaskSnapshot {
  const identity = { ...instance, sessionId }
  return {
    ...identity,
    taskId: petTaskId(identity),
    phase,
    startedAt: 10,
    phaseStartedAt: updatedAt,
    updatedAt,
    ...(phase === 'done' || phase === 'failed' ? { finishedAt: updatedAt } : {}),
  }
}

describe('ActivityRegistry', () => {
  it('retains simultaneous sessions and stable phase timing', () => {
    let now = 100
    const registry = new ActivityRegistry({ now: () => now })

    registry.update({ ...instance, sessionId: 'a', phase: 'thinking', statusLine: '分析中' })
    now = 110
    registry.update({
      ...instance,
      sessionId: 'b',
      phase: 'tool',
      statusLine: '正在使用 search',
      tool: { name: 'search', activeCount: 1, completedCount: 0 },
    })
    now = 120
    registry.update({ ...instance, sessionId: 'a', phase: 'review', statusLine: '整理中' })
    now = 125
    registry.update({ ...instance, sessionId: 'a', phase: 'review', statusLine: '继续整理' })

    const snapshot = registry.snapshot()
    expect(snapshot).toMatchObject({
      protocolVersion: 2,
      sequence: 4,
      emittedAt: 125,
      summary: { active: 2, waiting: 0, blocked: 0, failed: 0, completedRecently: 0 },
    })
    expect(snapshot.tasks).toHaveLength(2)
    expect(snapshot.tasks.find(item => item.sessionId === 'a')).toMatchObject({
      phase: 'review',
      startedAt: 100,
      phaseStartedAt: 120,
      updatedAt: 125,
      statusLine: '继续整理',
    })
    expect(snapshot.tasks.find(item => item.sessionId === 'b')?.tool).toEqual({
      name: 'search', activeCount: 1, completedCount: 0,
    })
  })

  it('uses instance and boot identity to prevent session ID collisions', () => {
    const registry = new ActivityRegistry({ now: () => 100 })
    registry.update({ instanceId: 'one', bootId: 'boot-a', sessionId: 'same', phase: 'thinking' })
    registry.update({ instanceId: 'two', bootId: 'boot-a', sessionId: 'same', phase: 'thinking' })
    registry.update({ instanceId: 'one', bootId: 'boot-b', sessionId: 'same', phase: 'thinking' })

    const ids = registry.snapshot().tasks.map(item => item.taskId)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toContain('v2:one:boot-a:same')
    expect(ids).toContain('v2:two:boot-a:same')
    expect(ids).toContain('v2:one:boot-b:same')
  })

  it('uses receive order when concurrent events share a wall-clock millisecond', () => {
    const registry = new ActivityRegistry({ now: () => 100 })
    registry.update({ ...instance, sessionId: 'a', phase: 'thinking' })
    registry.update({ ...instance, sessionId: 'b', phase: 'tool' })
    expect(registry.snapshot().primaryTaskId).toBe(petTaskId({ ...instance, sessionId: 'b' }))

    registry.update({ ...instance, sessionId: 'a', phase: 'review' })
    expect(registry.snapshot().primaryTaskId).toBe(petTaskId({ ...instance, sessionId: 'a' }))
  })

  it('removes disposed tasks and never leaks mutable snapshots', () => {
    const registry = new ActivityRegistry({ now: () => 100 })
    const identity = { ...instance, sessionId: 'a' }
    registry.update({
      ...identity,
      phase: 'tool',
      tool: { name: 'shell', activeCount: 1, completedCount: 0 },
    })
    const first = registry.snapshot()
    const firstTask = first.tasks[0]
    if (firstTask === undefined || firstTask.tool === undefined) throw new Error('missing task')
    firstTask.tool.activeCount = 99

    expect(registry.snapshot().tasks[0]?.tool?.activeCount).toBe(1)
    expect(registry.remove(identity)).toBe(true)
    expect(registry.snapshot()).toMatchObject({
      sequence: 2,
      tasks: [],
      summary: { active: 0, waiting: 0, blocked: 0, failed: 0, completedRecently: 0 },
    })
  })

  it('retains only exact valid progress and reports blocked work separately', () => {
    const registry = new ActivityRegistry({ now: () => 100 })
    const identity = { ...instance, sessionId: 'progress' }
    registry.update({
      ...identity,
      phase: 'tool',
      progress: { current: 3, total: 10, unit: ' files ' },
      tool: { name: 'build', activeCount: 1, completedCount: 2, failedCount: 1 },
    })

    expect(registry.snapshot().tasks[0]).toMatchObject({
      progress: { current: 3, total: 10, unit: 'files' },
      tool: { failedCount: 1 },
    })
    registry.update({ ...identity, phase: 'blocked', progress: { current: 11, total: 10 } })
    expect(registry.snapshot()).toMatchObject({
      summary: { active: 1, waiting: 0, blocked: 1, failed: 0, completedRecently: 0 },
      tasks: [{ phase: 'blocked' }],
    })
    expect(registry.snapshot().tasks[0]?.progress).toBeUndefined()
  })

  it('selects urgent, explicit, active, and completed tasks deterministically', () => {
    const waitingInput = task('input', 'waiting_input', 80)
    const failed = task('failed', 'failed', 95)
    const pinned = task('pinned', 'thinking', 70)
    const focused = task('focused', 'tool', 90)
    const done = task('done', 'done', 99)
    const tasks = [done, focused, pinned, failed, waitingInput]

    expect(selectPrimaryTask(tasks, {
      nowMs: 100,
      pinnedTaskId: pinned.taskId,
      focusedTaskId: focused.taskId,
    })?.taskId).toBe(waitingInput.taskId)

    expect(selectPrimaryTask(tasks.filter(item => item !== waitingInput), {
      nowMs: 100,
      pinnedTaskId: pinned.taskId,
      focusedTaskId: focused.taskId,
    })?.taskId).toBe(failed.taskId)

    expect(selectPrimaryTask(tasks.filter(item => item !== waitingInput), {
      nowMs: 100_000,
      pinnedTaskId: pinned.taskId,
      focusedTaskId: focused.taskId,
    })?.taskId).toBe(pinned.taskId)

    expect(selectPrimaryTask([done, focused, pinned], {
      nowMs: 100,
      focusedTaskId: focused.taskId,
    })?.taskId).toBe(focused.taskId)

    expect(selectPrimaryTask([done, focused, pinned], { nowMs: 100 })?.taskId).toBe(focused.taskId)
    expect(selectPrimaryTask([done], { nowMs: 100 })?.taskId).toBe(done.taskId)
  })
})
