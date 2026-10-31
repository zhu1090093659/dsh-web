// @vitest-environment jsdom
/**
 * L2 semantic attributes of the board view (issue #506): the mounted board
 * container, the board root, every status column, and every task card opt
 * into the semantic-attrs/v1 enum (data-dsh-plugin / data-dsh-part) so skins
 * can target them without hash-class selectors.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskBoardPanel } from '../src/client/native-panel.tsx'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

beforeEach(() => {
  // These legacy row/density cases inspect done cards, not source-fold defaults.
  globalThis.localStorage?.setItem('dsh.taskBoard.sourceGroupFolds.v1', JSON.stringify({ 'done:local': false }))
})

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-dsh-taskboard-active')
  globalThis.localStorage?.removeItem('dsh.taskBoard.sourceGroupFolds.v1')
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: 'Task A',
    description: '',
    prompt: 'do it',
    status: 'todo',
    createdAt: 0,
    updatedAt: Date.now(),
    executions: [],
    ...overrides,
  }
}

function fakeController(
  snapshot?: Partial<ControllerSnapshot>,
  overrides?: Partial<BoardController>,
): BoardController {
  const state: ControllerSnapshot = {
    tasks: [task()],
    boardOpen: false,
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

describe('TaskBoard L2 semantic attributes (#506)', () => {
  it('tags the board root, the status columns, and the task cards', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<TaskBoard controller={fakeController()} />) })

    const board = container.querySelector('[data-dsh-taskboard-board]')
    expect(board).not.toBeNull()
    expect(board!.getAttribute('data-dsh-plugin')).toBe('task-board')
    expect(board!.querySelector('button[data-dsh-center-view-back]')).not.toBeNull()

    const columns = container.querySelectorAll('section[data-status]')
    expect(columns.length).toBeGreaterThan(0)
    for (const column of columns) {
      expect(column.getAttribute('data-dsh-part')).toBe('column')
    }

    const card = container.querySelector('[data-dsh-part="card"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('Task A')
  })

  it('tags the archive column as a column too', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({
      archiveView: true,
      tasks: [task({ archivedAt: Date.now(), status: 'done' })],
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const archive = container.querySelector('section[data-status="archived"]')
    expect(archive).not.toBeNull()
    expect(archive!.getAttribute('data-dsh-part')).toBe('column')
  })
})

describe('TaskBoard card drag-and-drop status changes (#1195)', () => {
  const openExecution = () => ({
    id: 'e-open', sessionId: undefined, startedAt: 0, endedAt: undefined, result: undefined, error: undefined,
  })

  it('operator sees cards draggable unless the runner is executing them or the board is pending', async () => {
    // Given a board holding a todo card, an executing card, a card parked in
    // the running column by hand, and a card awaiting a Host reply
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const controller = fakeController({
      tasks: [
        task({ id: 't-todo', status: 'todo', title: 'Todo card' }),
        task({ id: 't-executing', status: 'running', title: 'Executing card', executions: [openExecution()] }),
        task({ id: 't-parked', status: 'running', title: 'Parked card' }),
        task({ id: 't-pending', status: 'todo', title: 'Pending card' }),
      ],
      pendingTaskIds: ['t-pending'],
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const cardOf = (title: string) => Array.from(
      container.querySelectorAll('article[data-dsh-part="card"]'),
    ).find(card => card.textContent?.includes(title))

    // Then only the executing and the pending card refuse the drag
    expect(cardOf('Todo card')?.getAttribute('draggable')).toBe('true')
    expect(cardOf('Parked card')?.getAttribute('draggable')).toBe('true')
    expect(cardOf('Executing card')?.getAttribute('draggable')).toBe('false')
    expect(cardOf('Pending card')?.getAttribute('draggable')).toBe('false')
  })

  it('drops a backlog card onto the todo column and triggers controller.moveTask', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      {
        tasks: [task({ id: 't-backlog', status: 'backlog', title: 'Task Backlog' })],
      },
      {
        moveTask: (id, status) => { moveCalls.push({ id, status }) },
      },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const todoColumn = container.querySelector('section[data-status="todo"]')
    expect(todoColumn).not.toBeNull()

    // Simulate drag and drop
    const dataTransfer = {
      data: { 'text/plain': 't-backlog' } as Record<string, string>,
      setData(type: string, val: string) { this.data[type] = val },
      getData(type: string) { return this.data[type] ?? '' },
      dropEffect: 'none',
    }

    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer }),
      )
    })

    expect(moveCalls).toEqual([{ id: 't-backlog', status: 'todo' }])
  })

  it('operator cannot drop a card on its own column or drop an executing card', async () => {
    // Given a board holding a todo card and a card the runner is executing
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      {
        tasks: [
          task({ id: 't-todo', status: 'todo' }),
          task({ id: 't-running', status: 'running', executions: [openExecution()] }),
        ],
      },
      {
        moveTask: (id, status) => { moveCalls.push({ id, status }) },
      },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const todoColumn = container.querySelector('section[data-status="todo"]')

    // Dropping on the same column does nothing
    const sameColTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-todo' : ''),
    }
    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: sameColTransfer }),
      )
    })
    expect(moveCalls).toHaveLength(0)

    // Dropping a card the runner is executing does nothing
    const runningTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-running' : ''),
    }
    await act(async () => {
      todoColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer: runningTransfer }),
      )
    })
    expect(moveCalls).toHaveLength(0)
  })

  it('operator drops a todo card onto the done column and the board dispatches the move', async () => {
    // Given a board holding a todo card
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      {
        tasks: [task({ id: 't-todo', status: 'todo', title: 'Task Todo' })],
      },
      {
        moveTask: (id, status) => { moveCalls.push({ id, status }) },
      },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const doneColumn = container.querySelector('section[data-status="done"]')
    expect(doneColumn).not.toBeNull()

    // When the operator drops the card on the Done column
    const dataTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-todo' : ''),
    }
    await act(async () => {
      doneColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer }),
      )
    })

    // Then the board asks the controller for the done column
    expect(moveCalls).toEqual([{ id: 't-todo', status: 'done' }])
  })

  it('operator drops a todo card onto the running column and the board dispatches the move', async () => {
    // Given a board holding a todo card
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    const moveCalls: Array<{ id: string; status: string }> = []
    const controller = fakeController(
      { tasks: [task({ id: 't-todo', status: 'todo', title: 'Task Todo' })] },
      { moveTask: (id, status) => { moveCalls.push({ id, status }) } },
    )
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const runningColumn = container.querySelector('section[data-status="running"]')

    // When the operator parks the card in the running column by hand
    const dataTransfer = {
      getData: (type: string) => (type === 'text/plain' ? 't-todo' : ''),
    }
    await act(async () => {
      runningColumn!.dispatchEvent(
        Object.assign(new Event('drop', { bubbles: true, cancelable: true }), { dataTransfer }),
      )
    })

    // Then the board dispatches the manual move without opening a run
    expect(moveCalls).toEqual([{ id: 't-todo', status: 'running' }])
  })
})

describe('TaskBoard panel page lifecycle & interaction (#506, #1233)', () => {
  it('tags the panel page container with the L2 semantic anchor and plugin id', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    // The layout mounts this component as the keyed 'main' page; it carries the
    // container-query context the board's responsive rules read, so the board
    // lays out against the center column instead of the viewport.
    await act(async () => { root.render(<TaskBoardPanel controller={fakeController()} />) })

    const view = container.querySelector('[data-dsh-taskboard-view]')
    expect(view).not.toBeNull()
    expect(view!.getAttribute('data-dsh-plugin')).toBe('task-board')
    expect(view!.querySelector('[data-dsh-taskboard-board]')).not.toBeNull()
  })

  it('clicking the back button calls controller.closeBoard() (#1233)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    let closed = 0
    const controller = fakeController({}, {
      closeBoard: () => { closed += 1 },
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    const backButton = container.querySelector('button[data-dsh-center-view-back]') as HTMLButtonElement
    expect(backButton).not.toBeNull()
    await act(async () => { backButton.click() })
    expect(closed).toBe(1)
  })
})

describe('TaskBoard settled-column density and recency groups', () => {
  const settledRun = (endedAt: number) => ({ id: 'e-' + String(endedAt), sessionId: 's', startedAt: endedAt - 1, endedAt, result: 'succeeded' as const, error: undefined })

  it('operator sees a long done column compact, grouped, with the oldest group folded until expanded', async () => {
    // Given 31 done cards: one settled now and thirty settled a month ago, and no saved density
    globalThis.localStorage?.removeItem('dsh.taskBoard.compactColumns.v1')
    const now = Date.now()
    const old = now - 30 * 24 * 60 * 60 * 1000
    const tasks = [
      task({ id: 'fresh', title: 'Fresh card', status: 'done', executions: [settledRun(now)] }),
      ...Array.from({ length: 30 }, (_, index) => task({ id: 'old-' + String(index), title: 'Old card ' + String(index), status: 'done', executions: [settledRun(old - index)] })),
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => { root.render(<TaskBoard controller={fakeController({ tasks })} />) })
    const done = container.querySelector('section[data-status="done"]')!
    const cards = () => [...done.querySelectorAll('article[data-dsh-part="card"]')]

    // When the board renders
    // Then the done column starts compact, shows the recent group and folds the earlier one
    expect(cards().map(card => card.getAttribute('data-compact'))).toEqual(['true'])
    expect([...done.querySelectorAll('[data-dsh-part="card-group"][data-group]')].map(group => group.getAttribute('data-group'))).toEqual(['today', 'earlier'])
    const toggle = done.querySelector<HTMLButtonElement>('[data-group="earlier"] [data-dsh-part="card-group-toggle"]')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    // When the operator expands the folded group and switches the column to full cards
    await act(async () => { toggle.click() })
    await act(async () => { done.querySelector<HTMLButtonElement>('[data-dsh-part="density-toggle"]')!.click() })

    // Then every card renders full-size and the choice is stored
    expect(cards()).toHaveLength(31)
    expect(cards().every(card => card.getAttribute('data-compact') === null)).toBe(true)
    expect(globalThis.localStorage?.getItem('dsh.taskBoard.compactColumns.v1')).toBe('[]')
  })
})

describe('TaskBoard card rows, density switches and column rails', () => {
  const openRun = { id: 'e-open', sessionId: 'session-1', startedAt: 0, endedAt: undefined, result: undefined, error: undefined }
  const settledRun = (result: 'succeeded' | 'failed') => ({
    id: 'e-' + result, sessionId: 'session-1', startedAt: 0, endedAt: 1, result, error: undefined,
  })

  it('operator sees the same card rows in every column, whether a card idles, runs or has settled', async () => {
    // Given every column at full density and a board whose cards are idle,
    // running, succeeded and failed
    globalThis.localStorage?.setItem('dsh.taskBoard.compactColumns.v1', '[]')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    const controller = fakeController({
      tasks: [
        task({ id: 't-todo', status: 'todo', title: 'Todo card' }),
        task({ id: 't-running', status: 'running', title: 'Running card', executions: [openRun] }),
        task({ id: 't-done', status: 'done', title: 'Done card', executions: [settledRun('succeeded')] }),
        task({ id: 't-failed', status: 'failed', title: 'Failed card', executions: [settledRun('failed')] }),
      ],
    })
    await act(async () => { root.render(<TaskBoard controller={controller} />) })

    // When the board paints the four columns
    // Then every card shows the same rows: the status rail is reserved in all
    // of them, so a column never reflows when a card changes state
    const shapes = [...container.querySelectorAll('article[data-dsh-part="card"]')].map(
      card => [...card.children].map(node => node.tagName).join(','),
    )
    expect(shapes).toHaveLength(4)
    expect(new Set(shapes)).toEqual(new Set(['BUTTON,SPAN,SPAN,SPAN']))
  })

  it('operator finds one density switch in every board column header, and none in the archive header', async () => {
    // Given the board view
    const board = document.createElement('div')
    document.body.appendChild(board)
    const boardRoot = createRoot(board)
    roots.push(boardRoot)
    await act(async () => { boardRoot.render(<TaskBoard controller={fakeController()} />) })

    // When each column header paints
    // Then every board column offers exactly one density switch
    const boardColumns = [...board.querySelectorAll('section[data-status]')]
    expect(boardColumns.length).toBeGreaterThan(0)
    for (const column of boardColumns) {
      const header = column.querySelector('header')!
      // The header is the column's own: the count it paints is the number of
      // cards the column just rendered, so the switch sits on that column
      expect(header.querySelector('h3 + span')?.textContent).toBe(String(column.querySelectorAll('article[data-dsh-part="card"]').length))
      expect(header.querySelectorAll('button[data-dsh-part="density-toggle"]')).toHaveLength(1)
    }

    // And the archive column keeps its header without a density switch, so the
    // header height is the only thing the two views have to agree on
    const archive = document.createElement('div')
    document.body.appendChild(archive)
    const archiveRoot = createRoot(archive)
    roots.push(archiveRoot)
    await act(async () => {
      archiveRoot.render(<TaskBoard controller={fakeController({
        archiveView: true,
        tasks: [task({ archivedAt: Date.now(), status: 'done' })],
      })} />)
    })
    const archiveColumn = archive.querySelector('section[data-status="archived"]')!
    // The archive keeps the column header shape and counts its one card, while
    // the density switch stays out of it
    expect(archiveColumn.querySelector('header h3 + span')?.textContent).toBe('1')
    expect(archiveColumn.querySelectorAll('button[data-dsh-part="density-toggle"]')).toHaveLength(0)
  })
})
