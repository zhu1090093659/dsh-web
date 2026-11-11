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
import { resolveHostTimeZone } from '../src/core/schedule.ts'
import { openFormSection } from './form-sections.ts'
import { t } from '../src/client/locales.ts'
import { parseZonedInput } from '../src/client/schedule-zone.ts'
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
    // The host zone matches the runtime's own,
    // so the schedule plan is read in the same zone the production client
    // resolves.
    host: {
      revision: 1,
      scheduler: { timeZone: resolveHostTimeZone() },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    },
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

/** The new-task dialog's session-reuse checkbox (unchecked by default). */
function reuseCheckbox(container: HTMLElement): HTMLInputElement {
  openFormSection(container, t('new.section.run'))
  const label = [...container.querySelectorAll('label')].find(node => node.textContent?.includes(t('exec.reuseSession')))
  if (label === undefined) throw new Error('no session-reuse option in the new-task dialog')
  return label.querySelector('input') as HTMLInputElement
}

/** The run-mode region's header button, which carries its collapsed summary. */
function runSectionHeader(container: HTMLElement): HTMLButtonElement {
  const header = [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="form-section"] > button')]
    .find(button => (button.textContent ?? '').startsWith(t('new.section.run')))
  if (header === undefined) throw new Error('no run-mode region in the new-task dialog')
  return header
}

/** Collapse the run-mode region again so its header renders the summary. */
function collapseRunSection(container: HTMLElement): void {
  act(() => { runSectionHeader(container).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
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

  it('user creating a task with defaults sends no retired run-mode fields', async () => {
    // Given an open new-task modal whose run region was never touched
    const { container, createTaskConfirmed } = renderModal()
    expect(reuseCheckbox(container).checked).toBe(false)

    // When the user creates the task
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Then the payload carries neither a goal nor an acceptance field
    const payload = createTaskConfirmed.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('goalRun')
    expect(payload).not.toHaveProperty('skipVerification')
  })

  it('user reading the collapsed run summary sees only whether the conversation is reused', () => {
    // Given a new-task modal with the run region collapsed
    const { container } = renderModal()
    const checkbox = reuseCheckbox(container)
    collapseRunSection(container)
    expect(runSectionHeader(container).textContent).toContain(t('new.summary.none'))

    // When the user checks session reuse and collapses the region again
    openFormSection(container, t('new.section.run'))
    act(() => { checkbox.click() })
    collapseRunSection(container)

    // Then the summary names the reuse and nothing else
    expect(runSectionHeader(container).textContent).toContain(t('exec.reuseSession'))
    expect(runSectionHeader(container).textContent).not.toContain(t('new.summary.none'))
  })
})

/** Write a value into a controlled field the way a user would. */
function setFieldValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Expand the schedule region and switch scheduled runs on. */
function enableSchedule(container: HTMLElement): void {
  openFormSection(container, t('new.section.schedule'))
  const toggle = [...container.querySelectorAll('label')]
    .find(node => node.textContent?.includes(t('detail.schedule.enable')))!
  act(() => { (toggle.querySelector('input') as HTMLInputElement).click() })
}

function labeledSelect(container: HTMLElement, label: string): HTMLSelectElement {
  const select = [...container.querySelectorAll<HTMLSelectElement>('select')]
    .find(candidate => candidate.getAttribute('aria-label') === label)
  if (select === undefined) throw new Error('no select labelled ' + label)
  return select
}

describe('new-task schedule plan (#1851)', () => {
  it('user creating a one-shot card sends the planned instant and its mode', async () => {
    // Given an open new-task modal with scheduled runs enabled
    const { container, createTaskConfirmed } = renderModal()
    enableSchedule(container)

    // When the user switches to the one-shot plan and picks a future wall clock
    const modeSelect = labeledSelect(container, t('detail.schedule.mode'))
    act(() => { modeSelect.value = 'once'; modeSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    const atInput = container.querySelector<HTMLInputElement>('input[type="datetime-local"]')!
    act(() => { setFieldValue(atInput, '2030-01-02T03:04') })

    // Then the create payload carries a one-shot plan and no cron expression
    const form = container.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const payload = createTaskConfirmed.mock.calls[0]![0] as { schedule?: { enabled?: boolean; mode?: string; at?: number; cron?: string } }
    expect(payload.schedule?.enabled).toBe(true)
    expect(payload.schedule?.mode).toBe('once')
    expect(payload.schedule?.at).toBe(parseZonedInput('2030-01-02T03:04'))
    expect(payload.schedule?.cron).toBeUndefined()
  })

  it('user capping a recurring card sends the run limit alongside the expression', async () => {
    // Given an open new-task modal with scheduled runs enabled
    const { container, createTaskConfirmed } = renderModal()
    enableSchedule(container)

    // When the user keeps the recurring plan, sets an expression, and types a
    // custom run limit
    const cronInput = container.querySelector<HTMLInputElement>('input[aria-label="' + t('detail.schedule.cron') + '"]')!
    act(() => { setFieldValue(cronInput, '* * * * *') })
    const capSelect = labeledSelect(container, t('detail.schedule.maxRuns'))
    act(() => { capSelect.value = 'custom'; capSelect.dispatchEvent(new Event('change', { bubbles: true })) })
    const capInput = container.querySelector<HTMLInputElement>('input[type="number"][aria-label="' + t('detail.schedule.maxRuns') + '"]')!
    act(() => { setFieldValue(capInput, '3') })

    // Then the create payload carries the recurring plan with its cap
    const form = container.querySelector('form')!
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const payload = createTaskConfirmed.mock.calls[0]![0] as { schedule?: { mode?: string; cron?: string; maxRuns?: number; at?: number } }
    expect(payload.schedule?.mode).toBe('cron')
    expect(payload.schedule?.cron).toBe('* * * * *')
    expect(payload.schedule?.maxRuns).toBe(3)
    expect(payload.schedule?.at).toBeUndefined()
  })
})
