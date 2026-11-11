// @vitest-environment jsdom
/**
 * The display form of a model row in every place the board offers one: the
 * model name, then the provider that publishes it.
 *
 * Two providers may publish one model name, and they are two different routes
 * — so a picker that showed only the name offered two identical rows, and the
 * operator could not tell which route a card would pin. Every picker and every
 * collapsed summary reads the label from the one shared formatter, so they
 * cannot drift apart.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { openFormSection } from './form-sections.ts'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot, ExecutionModelOption } from '../src/core/controller.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  window.localStorage.clear()
})

/** A roster where two providers publish one model name, plus a bare row. */
const MODELS: ExecutionModelOption[] = [
  { id: 'alpha/shared', name: 'Shared', provider: 'alpha', reasoning: { supported: true, efforts: ['low', 'high'] } },
  { id: 'beta/shared', name: 'Shared', provider: 'beta', reasoning: { supported: false } },
]

/** The select of one labelled execution field (the label wraps its control). */
function fieldControl(container: HTMLElement, label: string): HTMLSelectElement {
  const field = [...container.querySelectorAll('label')]
    .find(node => node.querySelector('span')?.textContent === label)
  const select = field?.querySelector<HTMLSelectElement>('select') ?? null
  if (select === null) throw new Error(`no select for the "${label}" field`)
  return select
}

/** The option labels of one select, in render order. */
function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map(option => option.textContent ?? '')
}

/** The option values of one select, in render order. */
function optionValues(select: HTMLSelectElement): string[] {
  return [...select.options].map(option => option.value)
}

function setSelect(element: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Render the new-task modal over a roster, the way the board opens it. */
function renderModal(models: ExecutionModelOption[]): HTMLElement {
  const snapshot: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models },
    pendingTaskIds: [],
    canParseTask: true,
  }
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    createTaskConfirmed: vi.fn(),
    parseTaskDraft: vi.fn(async () => ({ title: 't', description: 'd', prompt: 'p' })),
  } as unknown as BoardController
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<NewTaskModal controller={controller} onClose={() => undefined} />) })
  openFormSection(container, t('new.section.execution'))
  openFormSection(container, t('new.section.parse'))
  return container
}

/** Render the detail editor of one card, the way the board opens it. */
async function renderDetail(taskRecord: TaskRecord, models: ExecutionModelOption[]): Promise<HTMLElement> {
  const snapshot: ControllerSnapshot = {
    tasks: [taskRecord],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: taskRecord.id,
    executionOptions: { workspaces: [], presets: [], models },
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
    updateTask: vi.fn(async () => true),
    closeTask: vi.fn(),
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

/** A task record for the detail editor. */
function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: 'Task A', description: 'desc', prompt: 'do it' }, 0, 't1'), ...overrides }
}

describe('the model rows of the new-task dialog', () => {
  it('user sees two providers publishing one model name as two different rows', () => {
    // Given a roster where two providers publish the same model name
    const container = renderModal(MODELS)

    // When the user reads the model picker of the open dialog
    const select = fieldControl(container, t('new.model'))

    // Then each row names its own provider, and the stored route is untouched
    expect(optionLabels(select)).toEqual([t('exec.model.default'), 'Shared · alpha', 'Shared · beta'])
    expect(optionValues(select)).toEqual(['', 'alpha/shared', 'beta/shared'])
  })

  it('user sees the same names in the AI parse picker', () => {
    // Given a roster where two providers publish the same model name
    const container = renderModal(MODELS)

    // When the user reads the model picker of the parse region
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="ai-parse"] select')!

    // Then the parse picker names the provider too, and keeps the route as its value
    expect(optionLabels(select)).toEqual([t('exec.model.default'), 'Shared · alpha', 'Shared · beta'])
    expect(optionValues(select)).toEqual(['', 'alpha/shared', 'beta/shared'])
  })

  it('user on a deployment whose roster names no provider sees the bare model name', () => {
    // Given a roster row from the flat discovery list, which names no provider
    const container = renderModal([{ id: 'bare', name: 'Bare' }])

    // When the user reads the model picker
    const select = fieldControl(container, t('new.model'))

    // Then the row keeps its name alone instead of claiming a provider
    expect(optionLabels(select)).toEqual([t('exec.model.default'), 'Bare'])
  })

  it('user collapsing the execution region still reads the provider beside the model', () => {
    // Given an open new-task dialog whose roster publishes the model twice
    const container = renderModal(MODELS)

    // When the user pins one of them and collapses the execution region
    setSelect(fieldControl(container, t('new.model')), 'beta/shared')
    act(() => {
      [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-part="form-section"] > button')]
        .find(button => (button.textContent ?? '').startsWith(t('new.section.execution')))!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Then the collapsed line names the pinned model and the provider it came from
    const summary = [...container.querySelectorAll('[data-dsh-part="form-section"] > button')]
      .find(button => (button.textContent ?? '').startsWith(t('new.section.execution')))!.textContent
    expect(summary).toContain('Shared · beta')
  })
})

describe('the model rows of the detail editor', () => {
  it('operator sees two providers publishing one model name as two different rows', async () => {
    // Given a card whose roster publishes the same model name twice
    const container = await renderDetail(task({ model: 'alpha/shared' }), MODELS)

    // When the operator reads the model picker
    const select = fieldControl(container, t('new.model'))

    // Then each row names its own provider, and the pinned route is untouched
    expect(optionLabels(select)).toEqual([t('exec.model.default'), 'Shared · alpha', 'Shared · beta'])
    expect(optionValues(select)).toEqual(['', 'alpha/shared', 'beta/shared'])
    expect(select.value).toBe('alpha/shared')
  })

  it('operator on a card pinned to a route the deployment dropped sees that route itself', async () => {
    // Given a card pinned to a model this deployment no longer lists
    const container = await renderDetail(task({ model: 'alpha/gone' }), MODELS)

    // When the operator reads the model picker
    const select = fieldControl(container, t('new.model'))

    // Then the stale route stays selectable as itself, marked as unknown
    const unknown = [...select.options].find(option => option.value === 'alpha/gone')!
    expect(unknown.textContent).toBe(`alpha/gone${t('exec.model.unknown')}`)
    expect(select.value).toBe('alpha/gone')
  })
})
