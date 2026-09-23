/**
 * Controller archive behavior: every non-running task can be archived,
 * restore brings them back, the archive view toggles, and leaving the view
 * with an archived selection closes the selection.
 */
import { describe, expect, it } from 'vitest'
import { BoardController, type ControllerDeps } from '../src/core/controller.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000
let nextId = 0
const uuid = (): string => { nextId += 1; return 'id-' + nextId }

class FakeSessions {
  opened: string | undefined = undefined
  private listeners = new Set<() => void>()
  current(): string | undefined { return this.opened }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  open(id: string): void { this.opened = id }
}

function makeController(seed: TaskRecord[] = []) {
  const store = new InMemoryTaskStore()
  store.save(seed)
  const deps: ControllerDeps = {
    store,
    sessions: new FakeSessions() as never,
    now: () => NOW,
    uuid,
  }
  const controller = new BoardController(deps)
  controller.start()
  return { controller, store }
}

function task(id: string, status: TaskRecord['status']): TaskRecord {
  return { ...createTask({ title: id, description: '', prompt: id }, NOW, id), status }
}

describe('BoardController archive', () => {
  it('archives every non-running task and refuses running ones', () => {
    const done = task('done', 'done')
    const failed = task('failed', 'failed')
    const todo = task('todo', 'todo')
    const running = task('running', 'running')
    const { controller, store } = makeController([done, failed, todo, running])
    expect(controller.archiveTask('done')).toBe(true)
    expect(controller.archiveTask('failed')).toBe(true)
    // A scheduled task returns to todo after every run, so the duplicate flow
    // must be able to archive it (issue #1447).
    expect(controller.archiveTask('todo')).toBe(true)
    expect(controller.archiveTask('running')).toBe(false)
    const persisted = store.load()
    expect(persisted.find(item => item.id === 'done')?.archivedAt).toBe(NOW)
    expect(persisted.find(item => item.id === 'todo')?.archivedAt).toBe(NOW)
    expect(persisted.find(item => item.id === 'running')?.archivedAt).toBeUndefined()
  })

  it('restores an archived task back to its column', () => {
    const done = { ...task('done', 'done'), archivedAt: NOW }
    const { controller, store } = makeController([done])
    controller.openTask('done')
    expect(controller.restoreTask('done')).toBe(true)
    expect(store.load()[0]).toMatchObject({ id: 'done', status: 'done' })
    expect(store.load()[0].archivedAt).toBeUndefined()
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
    expect(controller.restoreTask('done')).toBe(false)
  })

  it('toggles the archive view and closes an archived selection on exit', () => {
    const done = { ...task('done', 'done'), archivedAt: NOW }
    const { controller } = makeController([done])
    expect(controller.getSnapshot().archiveView).toBe(false)
    controller.openTask('done')
    controller.toggleArchiveView()
    expect(controller.getSnapshot().archiveView).toBe(true)
    expect(controller.getSnapshot().selectedTaskId).toBe('done')
    controller.toggleArchiveView()
    expect(controller.getSnapshot().archiveView).toBe(false)
    expect(controller.getSnapshot().selectedTaskId).toBeUndefined()
  })
})
