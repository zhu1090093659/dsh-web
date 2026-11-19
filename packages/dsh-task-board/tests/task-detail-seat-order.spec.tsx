// @vitest-environment jsdom
/**
 * Where a provider's task-detail block reads inside the panel.
 *
 * A provider contributes one section into `task-board.detail.section` — the SSH
 * execution target, a GitHub issue block — and the board decides where that
 * section lands. The decision under test: it closes the execution-settings
 * block, because it answers the same question those pickers do (where and how
 * this card runs), and it therefore reads before the scheduled-runs fold and
 * the execution-history fold instead of trailing the card's content.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { t } from '../src/client/locales.ts'
import { TaskBoardSeatsProvider, EMPTY_TASK_BOARD_SEATS, type TaskBoardSeats } from '../src/client/seats.tsx'
import css from '../src/client/board.module.css'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { createTask, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
})

/** One card with the fields the detail view reads. */
function card(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Seat card', description: 'body', prompt: 'do the thing' }, 0, 'card-1'),
    ...overrides,
  }
}

/** One settled execution record, so the history fold has a summary to show. */
function run(id: string, startedAt: number): ExecutionRecord {
  return { id, sessionId: `session-${id}`, startedAt, endedAt: startedAt + 1000, result: 'succeeded', error: undefined }
}

/** A controller whose snapshot is the one board state the test needs. */
function controller(task: TaskRecord): BoardController {
  const state: ControllerSnapshot = {
    tasks: [task],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: task.id,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: {
      revision: 1,
      scheduler: { timeZone: 'UTC' },
      power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
      sessionDefaultPermission: 'read-only',
    } as ControllerSnapshot['host'],
  }
  return {
    getSnapshot: () => state,
    isHostBacked: () => false,
    subscribe: () => () => {},
    closeTask: vi.fn(),
    retryHostSync: vi.fn(async () => true),
    openSession: vi.fn(),
    confirmPermission: vi.fn(async () => true),
    updateTask: vi.fn(async () => true),
    moveTask: vi.fn(),
    deleteTask: vi.fn(),
    archiveTask: vi.fn(),
    restoreTask: vi.fn(),
    rerunTask: vi.fn(async () => {}),
    setSchedule: vi.fn(() => true),
    setParent: vi.fn(async () => true),
    openTask: vi.fn(),
    dispatchExtension: vi.fn(async () => true),
  } as unknown as BoardController
}

/** One provider seat set whose detail sections are labelled, in registration order. */
function seatsOf(...labels: readonly string[]): TaskBoardSeats {
  return {
    ...EMPTY_TASK_BOARD_SEATS,
    detailSection: () => (
      <>
        {labels.map(label => (
          <section key={label} data-seat={label}>
            <h4>{label}</h4>
            <p>{label} body</p>
          </section>
        ))}
      </>
    ),
  }
}

/** Render the detail panel over one card, with or without provider seats. */
function renderDetail(task: TaskRecord, seats?: TaskBoardSeats): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const panel = <TaskDetail controller={controller(task)} task={task} />
  act(() => {
    root.render(seats === undefined ? panel : <TaskBoardSeatsProvider value={seats}>{panel}</TaskBoardSeatsProvider>)
  })
  return container
}

/**
 * Every block label the detail body paints, in document order: the section
 * headings and the fold rows. A provider's own blocks are excluded, so the same
 * list answers "did moving the seat change anything for a page without one".
 */
function blockOrder(container: HTMLElement): string[] {
  const body = container.querySelector('[role="dialog"] .' + css.detailBody) as HTMLElement
  const labels: string[] = []
  // The section headings and the fold rows' titles are the whole reading
  // skeleton; a fold row's summary is data, not structure, so it is skipped.
  for (const node of body.querySelectorAll('h4, [class*="formSectionTitle"]')) {
    if (node.closest('[data-seat]') !== null) continue
    labels.push((node.textContent ?? '').trim())
  }
  return labels
}

/** The execution column of the panel. */
function rightColumn(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-detail-column="execution"]') as HTMLElement
}

/** The seat renders before this other node, in document order. */
function readsBefore(first: Node, second: Node): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('provider seat in the detail panel', () => {
  it('user reading a card finds the provider block right after the execution settings', () => {
    // Given a card and one provider contributing a detail section
    const task = card({ executions: [run('e1', 1_000)] })
    const container = renderDetail(task, seatsOf('执行目标'))

    // When the panel renders
    const seat = container.querySelector('[data-seat="执行目标"]') as HTMLElement
    const settingsHeading = [...container.querySelectorAll('h4')].find(node => node.textContent === t('detail.executionSettings')) as HTMLElement
    const settings = settingsHeading.parentElement as HTMLElement
    const schedule = [...container.querySelectorAll('button[aria-expanded]')].find(node => (node.textContent ?? '').startsWith(t('detail.schedule'))) as HTMLElement
    const history = [...container.querySelectorAll('button[aria-expanded]')].find(node => (node.textContent ?? '').startsWith(t('detail.execution'))) as HTMLElement

    // Then the seat sits in the execution column, after the settings block and
    // before both folds, so the run stack reads settings, target, schedule, history
    expect(seat.textContent).toContain('执行目标')
    expect(rightColumn(container).contains(seat)).toBe(true)
    expect(container.querySelector('[data-detail-column="content"]')!.contains(seat)).toBe(false)
    expect(readsBefore(settings, seat)).toBe(true)
    expect(readsBefore(seat, schedule)).toBe(true)
    expect(readsBefore(seat, history)).toBe(true)

    // And the folds keep their own group: the seat joins the stack without
    // splitting the two folds away from the settings fold's group
    const group = schedule.parentElement?.parentElement
    expect(group).toBe(history.parentElement?.parentElement)
    expect(group?.parentElement).toBe(rightColumn(container))
    expect([...group!.children]).toEqual([
      settings,
      seat.parentElement,
      schedule.parentElement,
      history.parentElement,
    ])
  })

  it('user with two providers reads their blocks in the order the providers registered', () => {
    // Given two providers contributing a detail section each
    const container = renderDetail(card(), seatsOf('执行目标', 'GitHub Issue'))

    // When the panel renders
    const markers = [...container.querySelectorAll('[data-seat]')]

    // Then both land in the same place, still in registration order
    expect(markers.map(node => node.getAttribute('data-seat'))).toEqual(['执行目标', 'GitHub Issue'])
    expect(readsBefore(markers[0]!, markers[1]!)).toBe(true)
  })

  it('user of a page without any provider sees the same panel a provider block would sit inside', () => {
    // Given a card, and the same card rendered with one provider block
    const task = card({ executions: [run('e1', 1_000)] })
    const bare = blockOrder(renderDetail(task))
    const seated = blockOrder(renderDetail(task, seatsOf('执行目标')))

    // When both panels paint their blocks
    // Then the provider adds its own block and changes nothing else: the section
    // and fold order is identical either way, and the seat adds no other node
    expect(seated).toEqual(bare)
    expect(bare).toEqual([
      t('detail.description'),
      t('detail.prompt'),
      t('detail.subtasks'),
      t('detail.executionSettings'),
      t('detail.settings.run'),
      t('detail.schedule'),
      t('detail.execution'),
      t('board.status'),
    ])

    // And an empty seat contributes no readable node at all
    const container = renderDetail(task)
    const stack = container.querySelector('.' + css.detailSeat) as HTMLElement
    expect(stack.textContent).toBe('')
    expect(stack.childElementCount).toBe(0)
  })

  it('user opening an archived card still reads the provider block, before the history it explains', () => {
    // Given an archived card whose only run stack left is the history fold
    const task = card({ executions: [run('e1', 1_000)], archivedAt: 5_000 })
    const container = renderDetail(task, seatsOf('执行目标'))

    // When the panel renders
    const seat = container.querySelector('[data-seat="执行目标"]') as HTMLElement
    const history = [...container.querySelectorAll('button[aria-expanded]')].find(node => (node.textContent ?? '').startsWith(t('detail.execution'))) as HTMLElement

    // Then the block is still there, and still reads before that fold
    expect(seat.textContent).toContain('执行目标 body')
    expect(rightColumn(container).contains(seat)).toBe(true)
    expect(readsBefore(seat, history)).toBe(true)
  })
})
