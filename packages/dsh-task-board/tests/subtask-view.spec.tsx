// @vitest-environment jsdom
/**
 * Subtask surfaces in the Web GUI: the detail block that lists a task's
 * subtasks and offers the add/link actions, the new-subtask form inheriting
 * the parent execution contract, and the board's hide-subtasks filter.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { LinkSubtaskModal } from '../src/client/board/LinkSubtaskModal.tsx'
import { NewTaskModal } from '../src/client/board/NewTaskModal.tsx'
import { openFormSection } from './form-sections.ts'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { t } from '../src/client/locales.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
const NOW = 1_700_000_000_000

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  globalThis.localStorage?.removeItem('dsh.taskBoard.sourceGroupFolds.v1')
})

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return { ...createTask({ title: id, description: '', prompt: id }, NOW, id), ...overrides }
}

interface FakeController {
  controller: BoardController
  links: Array<{ id: string; parentId: string | null }>
  created: Array<Record<string, unknown>>
  /** Every card write the surface performed, in order. */
  patches: Array<{ id: string; patch: Record<string, unknown> }>
  tasks: TaskRecord[]
}

/** A controller fake backed by a real task list: the actions record their own domain effect. */
function fakeController(tasks: TaskRecord[], options: { maxSubtaskDepth?: number } = {}): FakeController {
  const state: ControllerSnapshot = {
    tasks,
    boardOpen: true,
    archiveView: false,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [], models: [{ id: 'p/m', name: 'p/m' }] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      sessionDefaultPermission: 'read-only',
      ...(options.maxSubtaskDepth === undefined ? {} : { maxSubtaskDepth: options.maxSubtaskDepth }),
    },
  }
  const links: FakeController['links'] = []
  const created: FakeController['created'] = []
  const patches: FakeController['patches'] = []
  const controller = {
    getSnapshot: () => state,
    subscribe: () => () => {},
    isHostBacked: () => true,
    openTask: () => {},
    closeTask: () => {},
    closeBoard: () => {},
    toggleArchiveView: () => {},
    moveTask: () => {},
    rerunTask: async () => {},
    archiveTask: () => false,
    restoreTask: () => false,
    deleteTask: () => {},
    updateTask: async (id: string, patch: Record<string, unknown>) => { patches.push({ id, patch }); return true },
    setSchedule: () => true,
    retryHostSync: async () => true,
    confirmPermission: async () => true,
    setParent: async (id: string, parentId: string | null) => { links.push({ id, parentId }); return true },
    createTaskConfirmed: async (input: Record<string, unknown>) => { created.push(input); return { id: 'created-task' } as TaskRecord },
  } as unknown as BoardController
  return { controller, links, created, patches, tasks }
}

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent === label)
  if (found === undefined) throw new Error('no button labelled ' + label)
  return found as HTMLButtonElement
}

function click(container: HTMLElement, label: string): void {
  act(() => { button(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('task detail subtask block', () => {
  it('user opening a parent task sees its subtasks and the add controls', () => {
    // Given a root task with one subtask on the board
    const parent = task('parent')
    const child = task('child', { parentId: 'parent' })
    const { controller } = fakeController([parent, child])

    // When the user opens the parent detail
    const container = render(<TaskDetail controller={controller} task={parent} />)

    // Then the block lists the subtask and offers both add actions
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain('child')
    const add = button(container, t('detail.subtasks.add'))
    expect(add.textContent).toBe(t('detail.subtasks.add'))
    // The leading mark is the board's own vector glyph, not a text "+", so the
    // control's text is exactly its label.
    expect(add.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(button(container, t('detail.subtasks.link')).textContent).toBe(t('detail.subtasks.link'))
  })

  it('user opening a parent whose subtasks are all finished is told a run will not repeat them', () => {
    // Given a root whose subtasks both sit in the done column
    const parent = task('parent')
    const first = task('first', { parentId: 'parent', status: 'done' })
    const second = task('second', { parentId: 'parent', status: 'done' })
    const { controller } = fakeController([parent, first, second])

    // When the user opens the parent detail
    const container = render(<TaskDetail controller={controller} task={parent} />)

    // Then the block explains the run instead of promising the subtasks
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain(t('detail.subtasks.runHintSettled'))
  })

  it('user opening a parent with one unfinished subtask is told what the run will do', () => {
    // Given a root with one finished and one unfinished subtask
    const parent = task('parent')
    const done = task('done-child', { parentId: 'parent', status: 'done' })
    const open = task('open-child', { parentId: 'parent' })
    const { controller } = fakeController([parent, done, open])

    // When the user opens the parent detail
    const container = render(<TaskDetail controller={controller} task={parent} />)

    // Then the note counts the unfinished subtask alone
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain(t('detail.subtasks.runHint', { count: '1' }))
  })

  it('user opening a parent with unfinished descendants is told what the run does and which preset it is fixed to', () => {
    // Given a three-level board where the child and its own subtask are both open
    const parent = task('parent')
    const child = task('child', { parentId: 'parent' })
    const grandchild = task('grandchild', { parentId: 'child' })
    const { controller } = fakeController([parent, child, grandchild], { maxSubtaskDepth: 3 })

    // When the user opens the root detail
    const container = render(<TaskDetail controller={controller} task={parent} />)

    // Then the note counts every unfinished descendant, states the single
    // session this card opens, and names the preset that run is fixed to
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain(t('detail.subtasks.runHint', { count: '2' }))
    expect(section?.textContent).toContain('liangshen')

    // And it is a sentence, never a control: the card stores no such field
    expect(section?.querySelector('input')).toBeNull()
  })

  it('user opening a card with no subtasks gets no run note', () => {
    // Given a lone card on the board
    const parent = task('parent')
    const { controller } = fakeController([parent])

    // When the user opens it
    const container = render(<TaskDetail controller={controller} task={parent} />)

    // Then the block says it has none and explains nothing about a run
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain(t('detail.subtasks.empty'))
    expect(section?.textContent).not.toContain(t('detail.subtasks.runHintSettled'))
    expect(section?.textContent).not.toContain('liangshen')
  })

  it('user opening a subtask at the depth limit sees the limit instead of the add controls', () => {
    // Given a board limited to one subtask level and a card that already is a subtask
    const parent = task('parent')
    const child = task('child', { parentId: 'parent' })
    const { controller } = fakeController([parent, child], { maxSubtaskDepth: 1 })

    // When the user opens the subtask detail
    const container = render(<TaskDetail controller={controller} task={child} />)

    // Then the depth rule is explained and no add control is offered
    const section = container.querySelector('[data-dsh-part="subtasks"]')
    expect(section?.textContent).toContain(t('detail.subtasks.depthLimit', { depth: '1' }))
    expect([...container.querySelectorAll('button')].some(candidate => candidate.textContent === t('detail.subtasks.add'))).toBe(false)
    expect(controller.getSnapshot().tasks.find(entry => entry.id === 'child')?.parentId).toBe('parent')
  })

  it('user detaching a subtask records the cleared parent link', () => {
    // Given a root with one subtask
    const parent = task('parent')
    const child = task('child', { parentId: 'parent' })
    const { controller, links } = fakeController([parent, child])

    // When the user detaches the subtask from the detail block
    const container = render(<TaskDetail controller={controller} task={parent} />)
    click(container, t('detail.subtasks.detach'))

    // Then the controller is asked to clear that exact link
    expect(links).toEqual([{ id: 'child', parentId: null }])
  })
})

describe('execution history provenance', () => {
  it('user reading a card finished outside this Host sees who finished it, not a session', () => {
    // Given a card whose last run was reported by an outside agent
    const { controller, tasks } = fakeController([task('task-a', {
      status: 'done',
      executions: [{
        id: 'ext-1',
        sessionId: undefined,
        startedAt: NOW,
        endedAt: NOW,
        result: 'succeeded',
        error: 'fixed the parser',
        initiatedBy: 'codex',
        external: true,
      }],
    })])

    // When the user opens the card and its execution history
    const container = render(<TaskDetail controller={controller} task={tasks[0]!} />)
    openFormSection(container, t('detail.execution'))

    // Then the row names the outside agent and is marked as external
    expect(container.textContent).toContain('codex')
    expect(container.textContent).not.toContain(t('detail.viewSession'))
    expect(container.querySelectorAll('[data-external="true"]')).toHaveLength(1)
  })

  it('user reading a card this Host ran still sees the initiating session', () => {
    // Given a card with a normal Host-run execution
    const { controller, tasks } = fakeController([task('task-a', {
      status: 'done',
      executions: [{
        id: 'run-1',
        sessionId: 'session-a',
        startedAt: NOW,
        endedAt: NOW,
        result: 'succeeded',
        error: undefined,
        initiatedBy: 'session-a',
      }],
    })])

    // When the user opens the card and its execution history
    const container = render(<TaskDetail controller={controller} task={tasks[0]!} />)
    openFormSection(container, t('detail.execution'))

    // Then the row still carries the session and is not marked external
    expect(container.textContent).toContain(t('detail.execution.initiator', { session: 'session-a' }))
    expect(container.querySelector('[data-external="true"]')).toBeNull()
  })
})

describe('linking an existing task', () => {
  it('user linking a free task leaves the parent card itself untouched', async () => {
    // Given an open parent and one free on-board task
    const parent = task('parent')
    const free = task('free')
    const { controller, patches } = fakeController([parent, free])

    // When the user links the free task under the parent
    const container = render(<LinkSubtaskModal controller={controller} parent={parent} onClose={() => {}} />)
    await act(async () => {
      button(container, t('link.subtask.confirm')).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    // Then the join is the only write: nothing is set on the parent alongside it
    expect(patches).toEqual([])
  })

  it('user picking a free task in the linker records it under the open parent', () => {
    // Given an open parent and one free on-board task
    const parent = task('parent')
    const free = task('free')
    const { controller, links } = fakeController([parent, free])

    // When the user opens the linker and confirms the free task
    const container = render(<LinkSubtaskModal controller={controller} parent={parent} onClose={() => {}} />)
    click(container, t('link.subtask.confirm'))

    // Then the link names the free task and the open parent
    expect(links).toEqual([{ id: 'free', parentId: 'parent' }])
  })

  it('user with nothing to link sees the empty explanation', () => {
    // Given a board where the only other task already carries a parent
    const parent = task('parent')
    const taken = task('taken', { parentId: 'other' })
    const { controller } = fakeController([parent, taken])

    // When the user opens the linker
    const container = render(<LinkSubtaskModal controller={controller} parent={parent} onClose={() => {}} />)

    // Then no candidate is offered and the empty copy is shown
    expect(container.textContent).toContain(t('link.subtask.empty'))
  })

  it('user picking a candidate gets one secondary action per row, never a second submit', () => {
    // Given one linkable task and the linker open above its parent
    const parent = task('parent')
    const free = task('free')
    const { controller } = fakeController([parent, free])
    const container = render(<LinkSubtaskModal controller={controller} parent={parent} onClose={() => {}} />)

    // When the linker paints one row per candidate
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
    const cancel = buttons.find(button => button.textContent === t('new.cancel'))
    const rowActions = buttons.filter(button => button.textContent === t('link.subtask.confirm'))

    // Then each row action wears the same secondary style as the dismiss, so a
    // list of candidates never paints several competing primary actions
    expect(rowActions).toHaveLength(1)
    expect(rowActions[0].className).toBe(cancel?.className)

    // And the dialog commits nothing of its own: no row is a form submit
    expect(container.querySelector('button[type="submit"]')).toBeNull()
  })
})

describe('new subtask form', () => {
  it('user creating a subtask sends the parent link and leaves the permission to inherit', () => {
    // Given a parent pinned to a workspace, preset, permission, and model
    const parent = task('parent', { workspaceId: 'ws-1', mode: 'preset-1', permission: 'workspace-write', model: 'p/m' })
    const { controller, created } = fakeController([parent])

    // When the user submits the subtask form created from the parent
    const container = render(<NewTaskModal controller={controller} parentTask={parent} onClose={() => {}} />)
    const form = container.querySelector('form')
    if (form === null) throw new Error('no modal form')
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    // Then the payload carries the parent link and its targets, while the
    // permission stays unset so the Host inherits the binding AND its
    // confirmation stamp instead of pinning a fresh unconfirmed one
    expect(created).toEqual([{
      title: '',
      description: '',
      prompt: '',
      parentId: 'parent',
      freeze: undefined,
      handover: undefined,
      workspaceId: 'ws-1',
      mode: 'preset-1',
      permission: undefined,
      model: 'p/m',
      schedule: undefined,
    }])
  })

  it('user creating a subtask writes nothing onto the parent card', async () => {
    // Given a parent pinned to a workspace and a preset
    const parent = task('parent', { workspaceId: 'ws-1', mode: 'preset-1' })
    const { controller, created, patches } = fakeController([parent])

    // When the user submits the subtask form created from the parent
    const container = render(<NewTaskModal controller={controller} parentTask={parent} onClose={() => {}} />)
    const form = container.querySelector('form')
    if (form === null) throw new Error('no modal form')
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    // Then the link rides on the new card and the parent keeps exactly what the
    // user pinned on it
    expect(created[0]?.parentId).toBe('parent')
    expect(patches).toEqual([])
  })

  it('user creating a subtask of a confirmed elevated parent sees the inherited binding', () => {
    // Given an elevated parent whose binding a human already confirmed
    const parent = task('parent', { permission: 'danger-full-access', permissionConfirmedAt: NOW })
    const { controller, created } = fakeController([parent])

    // When the user opens the subtask form
    const container = render(<NewTaskModal controller={controller} parentTask={parent} onClose={() => {}} />)

    // Then the permission picker offers the inherited binding and sends no pin
    expect(container.textContent).toContain(t('exec.permission.inheritParent', { permission: t('exec.permission.danger-full-access') }))
    const form = container.querySelector('form')
    if (form === null) throw new Error('no modal form')
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(created[0]?.permission).toBeUndefined()
  })
})

describe('new subtask form with a stale parent target', () => {
  it('user creating a subtask still sees the parent workspace the form will send', () => {
    // Given a parent pinned to a workspace the runtime no longer lists
    const parent = task('parent', { workspaceId: 'ws-gone', mode: 'preset-gone', model: 'model-gone' })
    const { controller, created } = fakeController([parent])

    // When the user opens the subtask form created from that parent
    const container = render(<NewTaskModal controller={controller} parentTask={parent} onClose={() => {}} />)
    openFormSection(container, t('new.section.execution'))

    // Then each stale pin stays visible as a selectable row
    expect([...container.querySelectorAll('option')].map(option => option.value)).toEqual(
      expect.arrayContaining(['ws-gone', 'preset-gone', 'model-gone']),
    )

    // And submitting sends exactly those values, not the runtime defaults
    const form = container.querySelector('form')
    if (form === null) throw new Error('no modal form')
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(created).toEqual([expect.objectContaining({ workspaceId: 'ws-gone', mode: 'preset-gone', model: 'model-gone' })])
  })
})

describe('board subtask filter', () => {
  it('user opening a crowded board sees parent cards with a rolled-up child state', () => {
    // Given a board holding one parent and one done plus one failed subtask
    const parent = task('parent')
    const done = task('child-done', { parentId: 'parent', status: 'done' })
    const failed = task('child-failed', { parentId: 'parent', status: 'failed' })
    const { controller } = fakeController([parent, done, failed])
    // This case inspects the flat list, not the new done-source default fold.
    globalThis.localStorage?.setItem('dsh.taskBoard.sourceGroupFolds.v1', JSON.stringify({ 'done:local': false }))

    // When the user opens the board
    const container = render(<TaskBoard controller={controller} />)

    // Then the subtask cards stay collapsed into the parent badge
    expect(container.textContent).toContain('parent')
    expect(container.textContent).not.toContain('child-done')
    expect(container.textContent).not.toContain('child-failed')
    expect(container.textContent).toContain(t('card.subtasks', { count: '2' }))
    expect(container.textContent).toContain(t('card.subtasksFailed', { count: '1' }))

    // When the user reveals the subtasks
    click(container, t('board.showSubtasks'))

    // Then every card is listed flat
    expect(container.textContent).toContain('child-done')
    expect(container.textContent).toContain('child-failed')
  })

  it('user searching for a subtask title finds it although subtasks start hidden', () => {
    // Given a board holding a parent and a subtask whose title is distinctive
    const parent = task('parent')
    const child = task('collect carbon factors', { parentId: 'parent' })
    const { controller } = fakeController([parent, child])
    const container = render(<TaskBoard controller={controller} />)
    const search = container.querySelector('input')
    if (search === null) throw new Error('no search input')

    // When the user types the subtask title into the board search
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'carbon')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Then the matching subtask is revealed by the filter itself
    expect(container.textContent).toContain('collect carbon factors')
  })
})
