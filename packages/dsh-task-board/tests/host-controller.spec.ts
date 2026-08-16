import { describe, expect, it, vi } from 'vitest'
import { BoardController, type SessionsControllerFace, type TaskBoardTransport } from '../src/core/controller.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { TaskBoardSnapshot } from '../src/protocol.ts'

function snapshot(revision: number, tasks: TaskRecord[] = []): TaskBoardSnapshot {
  return {
    schemaVersion: 2,
    revision,
    tasks,
    scheduler: { timeZone: 'UTC' },
    power: {
      platform: 'linux', phase: 'unsupported', enabled: false,
      runningSessions: 0, armedSchedules: 0, sessionStateKnown: true,
    },
  }
}

function sessions(): SessionsControllerFace {
  return {
    list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => undefined },
    open: vi.fn(),
  }
}

describe('Host-backed BoardController', () => {
  it('keeps a create pending and invisible until the Host confirms it', async () => {
    let resolveAction!: (value: TaskBoardSnapshot) => void
    const action = vi.fn(() => new Promise<TaskBoardSnapshot>(resolve => { resolveAction = resolve }))
    const transport: TaskBoardTransport = {
      bootstrap: async () => snapshot(0),
      state: async () => snapshot(0),
      action,
      subscribe: () => () => undefined,
    }
    const controller = new BoardController({
      store: new InMemoryTaskStore(), sessions: sessions(), transport, uuid: () => 'task-a', now: () => 1,
    })
    controller.start()
    await Promise.resolve()
    const creating = controller.createTaskConfirmed({ title: 'A', description: 'draft', prompt: 'work' })
    expect(controller.getSnapshot().pendingTaskIds).toEqual(['task-a'])
    expect(controller.getSnapshot().tasks).toEqual([])
    const confirmed = createTask({ title: 'A', description: 'draft', prompt: 'work' }, 1, 'task-a')
    resolveAction(snapshot(1, [confirmed]))
    await expect(creating).resolves.toEqual(confirmed)
    expect(controller.getSnapshot().pendingTaskIds).toEqual([])
    controller.dispose()
  })

  it('preserves confirmed state on an action failure and ignores stale revisions', async () => {
    const confirmed = createTask({ title: 'A', description: '', prompt: '' }, 1, 'task-a')
    let onEvent: (() => void) | undefined
    let remoteState = snapshot(2, [confirmed])
    const transport: TaskBoardTransport = {
      bootstrap: async () => remoteState,
      state: async () => remoteState,
      action: async () => { throw new Error('host unavailable') },
      subscribe: listener => { onEvent = listener; return () => undefined },
    }
    const controller = new BoardController({ store: new InMemoryTaskStore(), sessions: sessions(), transport })
    controller.start()
    await Promise.resolve()
    expect(await controller.runTask('task-a')).toBe(false)
    expect(controller.getSnapshot().tasks).toEqual([confirmed])
    expect(controller.getSnapshot().transportError).toBe('host unavailable')

    remoteState = snapshot(1, [])
    onEvent?.()
    await Promise.resolve()
    expect(controller.getSnapshot().host?.revision).toBe(2)
    expect(controller.getSnapshot().tasks).toEqual([confirmed])
    controller.dispose()
  })
})
