// @vitest-environment jsdom
/**
 * Reasoning-effort picker: the model catalog publishes which effort levels a
 * model route actually accepts, so both execution-target editors offer that
 * real list next to the model field, default to "leave it to the model/Host",
 * and never carry an effort the picked model cannot honor.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { t } from '../src/client/locales.ts'
import { openFormSection } from './form-sections.ts'
import type { BoardController, ControllerSnapshot, ExecutionModelOption } from '../src/core/controller.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import type { TaskUpdatePatch } from '../src/core/use-cases/task-update.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** A roster carrying one reasoning model, one that declares none, and one with no levels. */
const MODELS: ExecutionModelOption[] = [
  { id: 'acme/reasoner', name: 'Reasoner', provider: 'acme', reasoning: { supported: true, efforts: ['low', 'high'] } },
  { id: 'acme/plain', name: 'Plain', provider: 'acme', reasoning: { supported: false } },
]

/** Find the control of one labelled execution field (the label wraps its control). */
function fieldControl<T extends HTMLElement>(container: HTMLElement, label: string, tag: string): T | undefined {
  const field = [...container.querySelectorAll('label')]
    .find(node => node.querySelector('span')?.textContent === label)
  return field?.querySelector<T>(tag) ?? undefined
}

function setSelect(element: HTMLSelectElement, value: string): void {
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

/** A task record for the detail editor. */
function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: 'Task A', description: 'desc', prompt: 'do it' }, 0, 't1'), ...overrides }
}

function detailSnapshot(taskRecord: TaskRecord, pendingTaskIds: string[] = []): ControllerSnapshot {
  return {
    tasks: [taskRecord],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: taskRecord.id,
    executionOptions: { workspaces: [], presets: [], models: MODELS },
    pendingTaskIds,
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      sessionDefaultPermission: 'read-only',
    },
  }
}

async function renderDetail(
  taskRecord: TaskRecord,
  updateTask: (id: string, patch: TaskUpdatePatch) => Promise<boolean> = async () => true,
  pendingTaskIds: string[] = [],
): Promise<HTMLElement> {
  const snapshot = detailSnapshot(taskRecord, pendingTaskIds)
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    updateTask,
    closeTask: vi.fn(),
    retryHostSync: vi.fn(async () => true),
    openSession: vi.fn(),
    moveTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    restoreTask: vi.fn(),
    rerunTask: vi.fn(async () => {}),
    setSchedule: vi.fn(() => true),
    isHostBacked: () => false,
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<TaskDetail controller={controller} task={taskRecord} />) })
  return container
}

function renderCreateModal(): { container: HTMLElement; createTaskConfirmed: ReturnType<typeof vi.fn> } {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models: MODELS },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    },
  }
  const createTaskConfirmed = vi.fn(async () => ({ id: 'task-new' } as TaskRecord))
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed,
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<NewTaskModal controller={controller} onClose={() => {}} />) })
  openFormSection(container, t('new.section.execution'))
  return { container, createTaskConfirmed }
}

describe('reasoning effort in the new-task dialog', () => {
  it('user pinning a reasoning model is offered exactly the catalog levels', () => {
    // Given an open new-task dialog whose execution region is expanded
    const { container } = renderCreateModal()

    // Then no model is pinned, so the effort follows the model and cannot be chosen yet
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    expect(effort.disabled).toBe(true)
    expect(effort.value).toBe('')
    expect(container.textContent).toContain(t('exec.reasoning.hint.pickModel'))

    // When the user pins the model that declares reasoning
    const model = fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!
    act(() => { setSelect(model, 'acme/reasoner') })

    // Then the picker offers the declared levels plus the inherit default
    expect(effort.disabled).toBe(false)
    expect([...effort.options].map(option => option.value)).toEqual(['', 'low', 'high'])
    expect(effort.value).toBe('')
    expect(container.textContent).toContain(t('exec.reasoning.hint.inherit'))
  })

  it('user leaving the effort alone creates a task that pins no effort', async () => {
    // Given a dialog with a reasoning model pinned and no effort chosen
    const { container, createTaskConfirmed } = renderCreateModal()
    act(() => { setSelect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!, 'acme/reasoner') })

    // When the user submits
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // Then the create carries the model alone: the effort stays at the model/Host default
    const payload = createTaskConfirmed.mock.calls[0]![0] as { model?: string; reasoningEffort?: string }
    expect(payload.model).toBe('acme/reasoner')
    expect(payload.reasoningEffort).toBeUndefined()
  })

  it('user choosing an effort creates a task that pins it', async () => {
    // Given a dialog with a reasoning model pinned
    const { container, createTaskConfirmed } = renderCreateModal()
    act(() => { setSelect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!, 'acme/reasoner') })

    // When the user picks one of the offered levels
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    act(() => { setSelect(effort, 'high') })

    // Then the create carries it
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect((createTaskConfirmed.mock.calls[0]![0] as { reasoningEffort?: string }).reasoningEffort).toBe('high')
  })

  it('user switching to a model that declares no reasoning loses the picked effort', async () => {
    // Given a dialog whose effort was already picked for a reasoning model
    const { container, createTaskConfirmed } = renderCreateModal()
    const model = fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!
    act(() => { setSelect(model, 'acme/reasoner') })
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    act(() => { setSelect(effort, 'high') })

    // When the user switches to a model that cannot honor it
    act(() => { setSelect(model, 'acme/plain') })

    // Then the stale choice is gone instead of being sent
    expect(effort.value).toBe('')
    expect(effort.disabled).toBe(true)
    expect(container.textContent).toContain(t('exec.reasoning.hint.noEfforts'))
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect((createTaskConfirmed.mock.calls[0]![0] as { reasoningEffort?: string }).reasoningEffort).toBeUndefined()
  })

  it('user collapsing the execution region still reads the pinned effort in its summary', () => {
    // Given a dialog with a model and an effort pinned
    const { container } = renderCreateModal()
    act(() => { setSelect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!, 'acme/reasoner') })
    act(() => { setSelect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!, 'high') })

    // When the user collapses the execution region
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="form-section"] > button')]
        .find(button => (button.textContent ?? '').startsWith(t('new.section.execution')))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Then the summary still reports the pinned effort rather than hiding it
    const summary = [...container.querySelectorAll('[data-dsh-part="form-section"] > button')]
      .find(button => (button.textContent ?? '').startsWith(t('new.section.execution')))!.textContent
    expect(summary).toContain('Reasoner')
    expect(summary).toContain('high')
  })
})

describe('reasoning effort in the task detail editor', () => {
  it('operator opening a card that pinned an effort sees it selected', async () => {
    // Given a card pinned to a reasoning model and one of its levels
    // When the operator opens its detail view
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'high' }))

    // Then the editor shows exactly that pair
    expect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!.value).toBe('acme/reasoner')
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    expect(effort.value).toBe('high')
    expect(effort.disabled).toBe(false)
    expect([...effort.options].map(option => option.value)).toEqual(['', 'low', 'high'])
  })

  it('operator picking another level writes it through the controller', async () => {
    // Given a card pinned to one level
    const updateTask = vi.fn(async () => true)
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'high' }), updateTask)

    // When the user picks the other level
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!, 'low') })

    // Then the change is written as an action
    expect(updateTask).toHaveBeenCalledWith('t1', { reasoningEffort: 'low' })
  })

  it('operator returning the effort to the default clears it on the wire', async () => {
    // Given a card pinned to one level
    const updateTask = vi.fn(async () => true)
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'high' }), updateTask)

    // When the user picks the inherit row
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!, '') })

    // Then the clear travels as an empty value, which survives JSON (an
    // undefined key would be dropped by the transport and never arrive)
    expect(updateTask).toHaveBeenCalledWith('t1', { reasoningEffort: '' })
  })

  it('operator switching to a model that declares no reasoning clears the stale effort with it', async () => {
    // Given a card pinned to a reasoning model and level
    const updateTask = vi.fn(async () => true)
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'high' }), updateTask)

    // When the user picks a model that cannot honor that level
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!, 'acme/plain') })

    // Then both halves travel together, so no invalid effort survives the switch
    expect(updateTask).toHaveBeenCalledWith('t1', { model: 'acme/plain', reasoningEffort: '' })
  })

  it('operator returning the model to the Host default clears that pin and the effort', async () => {
    // Given a card pinned to a model and one of its levels
    const updateTask = vi.fn(async () => true)
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'high' }), updateTask)

    // When the user picks the inherit row of the model picker
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('new.model'), 'select')!, '') })

    // Then the clear is sent as blank text, which survives the JSON transport,
    // and the effort goes with the model it was bound to
    expect(updateTask).toHaveBeenCalledWith('t1', { model: '', reasoningEffort: '' })
  })

  it('operator on a card whose pinned model left the roster keeps the stored effort visible', async () => {
    // Given a card pinned to a model this deployment no longer lists
    // When the operator opens its detail view
    const container = await renderDetail(task({ model: 'acme/gone', reasoningEffort: 'high' }))

    // Then the stale value is shown read-only with the reason, not silently dropped
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    expect(effort.value).toBe('high')
    expect(effort.disabled).toBe(true)
    expect([...effort.options].map(option => option.value)).toContain('high')
    expect(container.textContent).toContain(t('exec.reasoning.hint.unknownModel'))
  })

  it('operator on a card whose known model dropped the stored level sees it, but cannot pick it back', async () => {
    // Given a card pinned to a model that still declares levels, one that the
    // catalog no longer lists among them
    const updateTask = vi.fn(async () => true)
    // When the operator opens its detail view
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'medium' }), updateTask)

    // Then the picker stays operable and keeps reading the stored level
    const effort = fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!
    expect(effort.disabled).toBe(false)
    expect(effort.value).toBe('medium')
    expect(container.textContent).toContain(t('exec.reasoning.hint.inherit'))

    // And that removed level is still shown, marked as unknown and read-only
    const removed = [...effort.options].find(option => option.value === 'medium')!
    expect(removed.textContent).toBe(`medium${t('exec.reasoning.unknown')}`)
    expect(removed.disabled).toBe(true)

    // And every level the catalog really declares stays selectable
    const declared = [...effort.options].filter(option => option.value !== '' && option.value !== 'medium')
    expect(declared.map(option => option.value)).toEqual(['low', 'high'])
    expect(declared.some(option => option.disabled)).toBe(false)

    // And merely opening the card writes nothing: the stored value is not cleared
    expect(updateTask).not.toHaveBeenCalled()
  })

  it('operator on that card can still switch to a declared level or back to the default', async () => {
    // Given a card whose stored level its known model no longer lists
    const updateTask = vi.fn(async () => true)
    const container = await renderDetail(task({ model: 'acme/reasoner', reasoningEffort: 'medium' }), updateTask)

    // When the operator switches to a level the model really declares
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!, 'low') })

    // Then it travels as the stored protocol writes it
    expect(updateTask).toHaveBeenCalledWith('t1', { reasoningEffort: 'low' })

    // When the operator then returns the effort to the default
    await act(async () => { setSelect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!, '') })

    // Then the clear travels as blank text, the value that survives JSON
    expect(updateTask).toHaveBeenLastCalledWith('t1', { reasoningEffort: '' })
  })

  it('operator reading a card with a mutation in flight finds the effort picker locked', async () => {
    // Given a card whose execution targets are being written right now
    const pinned = task({ model: 'acme/reasoner', reasoningEffort: 'high' })

    // When the operator opens its detail view
    const container = await renderDetail(pinned, undefined, [pinned.id])

    // Then the picker is read-only with the rest of the form while it is pending
    expect(fieldControl<HTMLSelectElement>(container, t('exec.reasoning'), 'select')!.disabled).toBe(true)
  })
})
