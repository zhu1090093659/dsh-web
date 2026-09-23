// @vitest-environment jsdom
/**
 * "Create and run" in the new-task modal (issue #1621): the task is created
 * through the Host and started in the same gesture; a refused start leaves the
 * created task in place and opens it instead of reporting a failed creation.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** The Host-confirmed task; the modal only reads its id back. */
const created = { id: 'task-new' } as TaskRecord

function renderModal(options: { started?: boolean } = {}): {
  container: HTMLElement
  createTaskConfirmed: ReturnType<typeof vi.fn>
  runTask: ReturnType<typeof vi.fn>
  openTask: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models: [] },
    pendingTaskIds: [],
  }
  const createTaskConfirmed = vi.fn(async () => created)
  const runTask = vi.fn(async () => options.started ?? true)
  const openTask = vi.fn()
  const onClose = vi.fn()
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed,
    runTask,
    openTask,
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<NewTaskModal controller={controller} onClose={onClose} />) })
  return { container, createTaskConfirmed, runTask, openTask, onClose }
}

function actionButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label)
  if (button === undefined) throw new Error(`no button labelled ${label}`)
  return button as HTMLButtonElement
}

describe('new-task "create and run" (#1621)', () => {
  it('user creating and running gets the task started in the same gesture', async () => {
    // Given an open new-task modal
    const { container, createTaskConfirmed, runTask, openTask, onClose } = renderModal()

    // When the user submits the "create and run" action
    await act(async () => {
      actionButton(container, t('new.createAndRun')).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Then the task is created, started, and the modal closes on the start
    expect(createTaskConfirmed).toHaveBeenCalledOnce()
    expect(runTask).toHaveBeenCalledWith('task-new')
    expect(openTask).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('user whose start is refused lands on the created task', async () => {
    // Given a start that needs confirmation first, so the run is refused while
    // the creation itself already succeeded
    const { container, runTask, openTask, onClose } = renderModal({ started: false })

    // When the user submits the "create and run" action
    await act(async () => {
      actionButton(container, t('new.createAndRun')).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Then the created task is opened instead of the creation reading as failed
    expect(runTask).toHaveBeenCalledWith('task-new')
    expect(openTask).toHaveBeenCalledWith('task-new')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('user submitting the plain create action gets an unscheduled task without an execution', async () => {
    // Given an open new-task modal with an empty form
    const { container, createTaskConfirmed, runTask } = renderModal()
    const form = container.querySelector('form')
    if (form === null) throw new Error('no modal form')

    // When the user submits the plain create action
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Then the Host receives one plain, unscheduled task and no run is requested
    const payload = createTaskConfirmed.mock.calls[0]![0] as { title: string; schedule?: unknown }
    expect(payload.title).toBe('')
    expect(payload.schedule).toBeUndefined()
    expect(createTaskConfirmed).toHaveBeenCalledOnce()
    expect(runTask).not.toHaveBeenCalled()
  })
})
