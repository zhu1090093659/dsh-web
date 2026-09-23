// @vitest-environment jsdom
/**
 * Task-board project partition (issue #1536): the board offers a project row,
 * narrows the columns to the open project, seeds the new-task form with it,
 * and registers a new project through the same runtime call the GUI's own
 * "add project" uses.
 *
 * The live DSH Web GUI cannot be driven from this process (its per-process
 * token is not available here), so real React rendering against jsdom is the
 * strongest user-visible evidence this environment supports.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NEW_PROJECT_VALUE, TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: 'Task A',
    description: '',
    prompt: 'do it',
    status: 'todo',
    createdAt: 0,
    updatedAt: 1,
    executions: [],
    ...overrides,
  }
}

function fakeController(
  snapshot: Partial<ControllerSnapshot>,
  overrides: Partial<BoardController> = {},
): BoardController {
  const state: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    ...snapshot,
  }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    closeBoard: () => {},
    toggleArchiveView: () => {},
    retryHostSync: async () => {},
    openTask: () => {},
    moveTask: () => {},
    ...overrides,
  } as unknown as BoardController
}

function render(controller: BoardController): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<TaskBoard controller={controller} />) })
  return container
}

/** React's value tracker swallows a direct assignment, so use the native setter. */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!
  act(() => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function buttonWith(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(label))
  if (button === undefined) throw new Error(`no button labelled ${label}`)
  return button as HTMLButtonElement
}

function cards(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('button[data-dsh-part="card"]')]
}

const projects = [
  { workspaceId: 'w1', title: 'Alpha' },
  { workspaceId: 'w2', title: 'Beta' },
]

describe('TaskBoard project partition (#1536)', () => {
  it('offers the all-projects entry and every known project', () => {
    const container = render(fakeController({
      tasks: [task({ workspaceId: 'w1' })],
      executionOptions: { workspaces: projects, presets: [] },
    }))
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="project-filter"]')
    expect(select).not.toBeNull()
    expect([...select!.options].map(option => option.textContent)).toEqual([t('board.projectAll'), 'Alpha', 'Beta'])
  })

  it('narrows the columns to the open project and restores every task afterwards', () => {
    const container = render(fakeController({
      tasks: [
        task({ id: 'a', title: 'Alpha task', workspaceId: 'w1' }),
        task({ id: 'b', title: 'Beta task', workspaceId: 'w2' }),
        task({ id: 'c', title: 'Unassigned task' }),
      ],
      executionOptions: { workspaces: projects, presets: [] },
    }))
    expect(cards(container)).toHaveLength(3)
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="project-filter"]')!
    choose(select, 'w1')
    expect(cards(container)).toHaveLength(1)
    expect(cards(container)[0]!.textContent).toContain('Alpha task')
    choose(select, '')
    expect(cards(container)).toHaveLength(3)
  })

  it('seeds the new-task form with the open project', () => {
    const container = render(fakeController({
      tasks: [task({ workspaceId: 'w1' })],
      executionOptions: { workspaces: projects, presets: [] },
    }))
    choose(container.querySelector<HTMLSelectElement>('[data-dsh-part="project-filter"]')!, 'w1')
    act(() => { buttonWith(container, t('board.new')).click() })
    const workspaceSelect = [...container.querySelectorAll('select')]
      .find(select => [...select.options].some(option => option.textContent === t('exec.workspace.recent')))
    expect(workspaceSelect).toBeDefined()
    expect(workspaceSelect!.value).toBe('w1')
  })

  it('registers a new project through the runtime and switches to it', async () => {
    const createWorkspace = vi.fn(async () => ({ workspaceId: 'w-new' }))
    const container = render(fakeController({
      tasks: [task({ workspaceId: 'w1' })],
      executionOptions: { workspaces: projects, presets: [] },
      canCreateWorkspace: true,
    }, { createWorkspace }))
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="project-filter"]')!
    choose(select, NEW_PROJECT_VALUE)
    const dialog = container.querySelector<HTMLElement>('[data-dsh-part="project-dialog"]')
    expect(dialog).not.toBeNull()
    // The create button stays inert until a path is typed.
    expect(buttonWith(dialog!, t('board.projectCreate')).disabled).toBe(true)
    typeInto(dialog!.querySelector('input')!, 'C:/work/new-project')
    await act(async () => { buttonWith(dialog!, t('board.projectCreate')).click() })
    expect(createWorkspace).toHaveBeenCalledWith('C:/work/new-project')
    expect(container.querySelector('[data-dsh-part="project-dialog"]')).toBeNull()
    // The board switched to the new project: the w1 card is filtered out.
    expect(cards(container)).toHaveLength(0)
  })

  it('keeps the dialog open and shows the reason when registration fails', async () => {
    const createWorkspace = vi.fn(async () => { throw new Error('directory does not exist') })
    const container = render(fakeController({
      tasks: [],
      executionOptions: { workspaces: projects, presets: [] },
      canCreateWorkspace: true,
    }, { createWorkspace }))
    const select = container.querySelector<HTMLSelectElement>('[data-dsh-part="project-filter"]')!
    choose(select, NEW_PROJECT_VALUE)
    const dialog = container.querySelector<HTMLElement>('[data-dsh-part="project-dialog"]')!
    typeInto(dialog.querySelector('input')!, 'C:/missing')
    await act(async () => { buttonWith(dialog, t('board.projectCreate')).click() })
    expect(dialog.textContent).toContain('directory does not exist')
  })

  it('hides the project row when the deployment knows no project and cannot create one', () => {
    const container = render(fakeController({ tasks: [task()] }))
    expect(container.querySelector('[data-dsh-part="project-filter"]')).toBeNull()
  })
})
