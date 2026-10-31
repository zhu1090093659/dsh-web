// @vitest-environment jsdom
/** Repository/source grouping across the real board columns and archive. */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { SOURCE_GROUP_FOLDS_KEY } from '../src/client/board/source-group.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { createTask, type TaskRecord, type TaskStatus } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const NOW = Date.now()

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  globalThis.localStorage?.removeItem(SOURCE_GROUP_FOLDS_KEY)
  globalThis.localStorage?.removeItem('dsh.taskBoard.compactColumns.v1')
})

function task(id: string, status: TaskStatus, source?: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  const record = createTask({
    title: id,
    description: '',
    prompt: 'p',
    status,
    ...(source === undefined ? {} : { integrations: { fake: { source } } }),
  }, NOW, id)
  return { ...record, ...overrides }
}

function selector(task: TaskRecord): { id: string, label: string } | undefined {
  const source = (task.integrations?.fake as { source?: string } | undefined)?.source
  return source === undefined ? undefined : { id: 'fake:' + source.toLowerCase(), label: source }
}

function controller(tasks: TaskRecord[], archiveView = false): BoardController {
  const snapshot: ControllerSnapshot = {
    tasks,
    boardOpen: true,
    archiveView,
    selectedTaskId: undefined,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    grouping: [selector],
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    closeBoard: () => {},
    toggleArchiveView: () => {},
    retryHostSync: async () => {},
    openTask: () => {},
    moveTask: () => {},
  } as unknown as BoardController
}

function render(tasks: TaskRecord[], archiveView = false): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<TaskBoard controller={controller(tasks, archiveView)} />) })
  return container
}

function sourceGroups(column: Element): Element[] {
  return [...column.querySelectorAll('[data-dsh-part="card-group"]:not([data-group])')]
}

function sourceLabels(column: Element): Array<string | null | undefined> {
  return sourceGroups(column).map(group => group.querySelector('span')?.textContent)
}

describe('TaskBoard source grouping', () => {
  it('operator sees every main column and the archive grouped by full repository with local tasks last', () => {
    // Given one card in every main column and a local todo
    // When the board renders
    const container = render([
      task('backlog-z', 'backlog', 'zeta/repo'),
      task('todo-a', 'todo', 'Alpha/Repo'),
      task('todo-local', 'todo'),
      task('running-a', 'running', 'Alpha/Repo'),
      task('done-a', 'done', 'Alpha/Repo'),
      task('failed-z', 'failed', 'zeta/repo'),
    ])

    // Then all five columns carry the full source label and the local fallback
    for (const status of ['backlog', 'todo', 'running', 'done', 'failed']) {
      expect(sourceGroups(container.querySelector('section[data-status="' + status + '"]')!)).not.toHaveLength(0)
    }
    expect(sourceLabels(container.querySelector('section[data-status="backlog"]')!)).toEqual(['zeta/repo'])
    expect(sourceLabels(container.querySelector('section[data-status="todo"]')!)).toEqual(['Alpha/Repo', '本地任务'])
    expect(sourceLabels(container.querySelector('section[data-status="running"]')!)).toEqual(['Alpha/Repo'])
    expect(sourceLabels(container.querySelector('section[data-status="done"]')!)).toEqual(['Alpha/Repo'])
    expect(sourceLabels(container.querySelector('section[data-status="failed"]')!)).toEqual(['zeta/repo'])

    // And archive uses the same grouping while remaining expanded by default
    const archive = render([task('archived-a', 'done', 'Alpha/Repo', { archivedAt: NOW })], true)
    const archivedColumn = archive.querySelector('section[data-status="archived"]')!
    expect(sourceLabels(archivedColumn)).toEqual(['Alpha/Repo'])
    expect(archivedColumn.querySelectorAll('article[data-dsh-part="card"]')).toHaveLength(1)
  })

  it('operator gets folded done sources, persistent expansion, and search reveal', () => {
    // Given two repositories and a local group in the done column
    const container = render([
      task('Alpha one', 'done', 'Alpha/Repo'),
      task('Alpha two', 'done', 'Alpha/Repo'),
      task('Beta unique', 'done', 'Beta/Repo'),
      task('Local done', 'done'),
    ])
    const done = container.querySelector('section[data-status="done"]')!
    const cards = () => [...done.querySelectorAll('article[data-dsh-part="card"]')]

    // Then all source summaries render without any cards
    expect(sourceLabels(done)).toEqual(['Alpha/Repo', 'Beta/Repo', '本地任务'])
    expect(cards()).toHaveLength(0)
    const alphaToggle = sourceGroups(done)[0]!.querySelector<HTMLButtonElement>('[data-dsh-part="card-group-toggle"]')!
    expect(alphaToggle.getAttribute('aria-expanded')).toBe('false')

    // When Alpha expands, only its two cards render and the choice persists
    act(() => { alphaToggle.click() })
    expect(cards()).toHaveLength(2)
    expect(JSON.parse(globalThis.localStorage.getItem(SOURCE_GROUP_FOLDS_KEY) ?? '{}')).toMatchObject({ 'done:fake:alpha/repo': false })

    // When searching for Beta, its folded source reveals the match automatically
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setValue?.call(search, 'Beta unique')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(cards().map(card => card.textContent)).toEqual([expect.stringContaining('Beta unique')])
    expect(sourceGroups(done)[0]?.querySelector<HTMLButtonElement>('[data-dsh-part="card-group-toggle"]')?.disabled).toBe(true)
  })

  it('operator expanding one repository earlier group does not unfold another repository', () => {
    // Given 31 failed cards in each of two repositories, one fresh and thirty old
    const old = NOW - 30 * 24 * 60 * 60 * 1000
    const settled = (at: number) => ({ id: 'e-' + String(at), sessionId: undefined, startedAt: at - 1, endedAt: at, result: 'failed' as const, error: undefined })
    const tasks = (['Alpha/Repo', 'Beta/Repo'] as const).flatMap(source => [
      task(source + ' fresh', 'failed', source, { executions: [settled(NOW)] }),
      ...Array.from({ length: 30 }, (_, index) => task(source + ' old ' + String(index), 'failed', source, { executions: [settled(old - index)] })),
    ])
    const container = render(tasks)
    const failed = container.querySelector('section[data-status="failed"]')!
    const cards = () => [...failed.querySelectorAll('article[data-dsh-part="card"]')]

    // Then each source starts expanded but folds its own thirty earlier cards
    expect(sourceLabels(failed)).toEqual(['Alpha/Repo', 'Beta/Repo'])
    expect(cards()).toHaveLength(2)
    const earlier = [...failed.querySelectorAll('[data-group="earlier"]')]
    expect(earlier).toHaveLength(2)

    // When Alpha's earlier group expands, Beta stays folded
    const alphaEarlierToggle = earlier[0]!.querySelector<HTMLButtonElement>('[data-dsh-part="card-group-toggle"]')!
    act(() => { alphaEarlierToggle.click() })
    expect(cards()).toHaveLength(32)
    expect(cards().filter(card => card.textContent?.includes('Beta/Repo old'))).toHaveLength(0)
  })
})
