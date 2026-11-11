// @vitest-environment jsdom
/**
 * Issue #1110: the detail overlay offers editing of task content (title,
 * description, prompt) only while the task has never started executing.
 * Running and settled tasks fail closed — no edit affordance — and the edit
 * modal saves through the controller only after validating the title.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { t } from '../src/client/locales.ts'
import { openFormSection } from './form-sections.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { TaskUpdatePatch } from '../src/core/use-cases/task-update.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Task A', description: 'desc', prompt: 'do it' }, 0, 't1'),
    ...overrides,
  }
}

function controllerFake(
  taskRecord: TaskRecord,
  updateTask: (id: string, patch: TaskUpdatePatch) => Promise<boolean> = async () => true,
): { controller: BoardController; snapshot: ControllerSnapshot } {
  const snapshot: ControllerSnapshot = {
    tasks: [taskRecord],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: taskRecord.id,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      sessionDefaultPermission: 'read-only',
    },
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    closeTask: vi.fn(),
    retryHostSync: vi.fn(async () => true),
    openSession: vi.fn(),
    updateTask,
    moveTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    restoreTask: vi.fn(),
    rerunTask: vi.fn(async () => {}),
    setSchedule: vi.fn(() => true),
    isHostBacked: () => false,
  } as unknown as BoardController
  return { controller, snapshot }
}

async function renderDetail(
  taskRecord: TaskRecord,
  updateTask?: (id: string, patch: TaskUpdatePatch) => Promise<boolean>,
): Promise<{ container: HTMLElement; controller: BoardController; snapshot: ControllerSnapshot }> {
  const { controller, snapshot } = controllerFake(taskRecord, updateTask)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<TaskDetail controller={controller} task={taskRecord} />) })
  return { container, controller, snapshot }
}

function editButtonOf(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(button => button.textContent === '编辑')
}

function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}


describe('task content editing before execution (issue #1110)', () => {
  it('offers the edit button for a task that has never executed', async () => {
    const { container } = await renderDetail(task())
    const editButton = editButtonOf(container)
    expect(editButton).toBeDefined()
    await act(async () => { editButton!.click() })
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })

  it('hides the edit button for a running task', async () => {
    const { container } = await renderDetail(task({
      status: 'running',
      executions: [{ id: 'e-run', sessionId: undefined, startedAt: 1, endedAt: undefined, result: undefined, error: undefined }],
    }))
    expect(editButtonOf(container)).toBeUndefined()
  })

  it('hides the edit button for a settled task', async () => {
    const { container } = await renderDetail(task({
      status: 'done',
      executions: [{ id: 'e-done', sessionId: undefined, startedAt: 1, endedAt: 2, result: 'succeeded', error: undefined }],
    }))
    expect(editButtonOf(container)).toBeUndefined()
  })

  it('saves edited content through the controller and closes', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    const title = dialog!.querySelector('input') as HTMLInputElement
    const textareas = dialog!.querySelectorAll('textarea')
    expect(title.value).toBe('Task A')
    expect(textareas[0].value).toBe('desc')
    expect(textareas[1].value).toBe('do it')

    await act(async () => {
      setFieldValue(title, 'Renamed')
      setFieldValue(textareas[0] as HTMLTextAreaElement, 'new desc')
      setFieldValue(textareas[1] as HTMLTextAreaElement, 'new prompt')
    })

    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(updateTask).toHaveBeenCalledOnce()
    expect(updateTask).toHaveBeenCalledWith('t1', { title: 'Renamed', description: 'new desc', prompt: 'new prompt' })
    // The save closes the overlay on its exit leg: the surface leaves once its
    // reversible exit transition has run, not on the click's own tick.
    await vi.waitFor(() => {
      expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).toBeNull()
    })
  })

  it('keeps the modal open and does not save a blank title', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    await act(async () => { setFieldValue(dialog!.querySelector('input') as HTMLInputElement, '   ') })
    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(updateTask).not.toHaveBeenCalled()
    expect(container.textContent).toContain('标题不能为空')
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })

  it('stays open with the Host error when the update is rejected', async () => {
    const { container, snapshot } = await renderDetail(task(), async () => {
      snapshot.transportError = 'task has already been executed'
      return false
    })
    await act(async () => { editButtonOf(container)!.click() })
    const dialog = container.querySelector('[role="dialog"][aria-label="编辑任务"]')
    const save = dialog!.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => { save.click() })
    expect(container.textContent).toContain('task has already been executed')
    expect(container.querySelector('[role="dialog"][aria-label="编辑任务"]')).not.toBeNull()
  })
})

describe('session reuse toggle (#1419)', () => {
  function reuseCheckbox(container: HTMLElement): HTMLInputElement {
    const label = [...container.querySelectorAll('label')].find(node => node.textContent?.includes('在同一对话继续'))
    expect(label).toBeDefined()
    return label!.querySelector('input') as HTMLInputElement
  }

  it('starts unchecked and opts the task in through the controller', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task(), updateTask)
    openFormSection(container, t('detail.settings.run'))
    const checkbox = reuseCheckbox(container)
    expect(checkbox.checked).toBe(false)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { reuseSession: true })
  })

  it('shows an opted-in task as checked and clears the opt-in on unclick', async () => {
    const updateTask = vi.fn(async () => true)
    const { container } = await renderDetail(task({ reuseSession: true }), updateTask)
    openFormSection(container, t('detail.settings.run'))
    const checkbox = reuseCheckbox(container)
    expect(checkbox.checked).toBe(true)
    await act(async () => { checkbox.click() })
    expect(updateTask).toHaveBeenCalledWith('t1', { reuseSession: false })
  })
})

describe('schedule zone editing', () => {
  it('user changing the schedule zone persists it through the controller', async () => {
    // Given a card whose rule is pinned to a zone
    const { container, controller } = await renderDetail(task({
      schedule: { enabled: true, mode: 'cron', cron: '0 9 * * *', timeZone: 'Asia/Shanghai', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 0 },
    }))

    // When the user picks a different zone and then the Host default
    openFormSection(container, '定时运行')
    const zoneSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === '时区')!
    expect(zoneSelect.value).toBe('Asia/Shanghai')
    await act(async () => {
      zoneSelect.value = 'Europe/London'
      zoneSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => {
      zoneSelect.value = ''
      zoneSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Then each choice is written as an action, and clearing sends null
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { timeZone: 'Europe/London' })
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { timeZone: null })
  })

})

describe('schedule plan editing', () => {
  it('user switching a rule to a one-shot persists the planned instant', async () => {
    // Given a card with no schedule yet
    const { container, controller } = await renderDetail(task())

    // When the user picks the one-shot plan
    openFormSection(container, '定时运行')
    const modeSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === '调度方式')!
    expect(modeSelect.value).toBe('cron')
    await act(async () => {
      modeSelect.value = 'once'
      modeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // Then the editor offers a datetime field and the switch submitted a
    // future instant (its default), not a past one
    const atInput = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    expect(atInput.getAttribute('aria-label')).toBe('执行时间')
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { mode: 'once', at: expect.any(Number) })

    // And a chosen wall clock is parsed in the rule zone and persisted. A
    // datetime-local reports through `change`, which jsdom does not derive
    // from an input event.
    await act(async () => {
      setFieldValue(atInput, '2030-01-02T03:04')
      atInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // React delegates `onBlur` to the bubbling `focusout` event.
    await act(async () => { atInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { mode: 'once', at: Date.UTC(2030, 0, 2, 3, 4) })
  })

  it('user picking a run cap writes it and reads the rule budget', async () => {
    // Given a rule that already ran once under a two-run cap
    const { container, controller } = await renderDetail(task({
      schedule: { enabled: true, mode: 'cron', cron: '* * * * *', nextRunAt: undefined, lastTriggeredAt: undefined, runCount: 1, maxRuns: 2 },
    }))

    // Then the ledger's own budget is shown, not a client-side guess
    openFormSection(container, '定时运行')
    expect(container.textContent).toContain('1/2')

    // When the user clears the cap
    const capSelect = [...container.querySelectorAll<HTMLSelectElement>('select')]
      .find(candidate => candidate.getAttribute('aria-label') === '次数上限')!
    expect(capSelect.value).toBe('2')
    await act(async () => {
      capSelect.value = 'unlimited'
      capSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { maxRuns: null })

    // And cancelling the future plan disarms it
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === '关闭调度')!
    await act(async () => { cancel.click() })
    expect(controller.setSchedule).toHaveBeenCalledWith('t1', { enabled: false })
  })

  it('operator opening a spent one-shot sees the planned instant and the end state', async () => {
    // Given a one-shot that already fired
    // When the operator opens its card
    const { container } = await renderDetail(task({
      schedule: {
        enabled: false,
        mode: 'once',
        at: Date.UTC(2026, 9, 9, 4, 0),
        nextRunAt: undefined,
        lastTriggeredAt: Date.UTC(2026, 9, 9, 4, 0),
        runCount: 1,
        endedAt: Date.UTC(2026, 9, 9, 4, 0),
        endedReason: 'fired',
      },
    }))

    // Then the detail states both the planned instant and how it ended
    openFormSection(container, '定时运行')
    const atInput = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    expect(atInput.value).toBe('2026-10-09T04:00')
    expect(container.textContent).toContain('调度已结束')
    expect(container.textContent).toContain('单次计划已执行')
  })
})
