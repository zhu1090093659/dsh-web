// @vitest-environment jsdom
/**
 * Task-tag UI (issue #1521), exercised through the real components rather than
 * through the pure helpers: the mounted board must render one badge per label,
 * offer a chip per label in use, filter conjunctively, and the shared tag
 * editor must add, remove, and adopt labels.
 *
 * The live DSH Web GUI cannot be driven from here (its per-process token is not
 * available to this process), so this is the strongest user-visible evidence
 * the environment supports: real React rendering against jsdom.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskBoard } from '../src/client/board/TaskBoard.tsx'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { TaskTagFields, cleanTags } from '../src/client/board/TaskForm.tsx'
import { TASK_TAG_LIMIT, tagTone, type TaskRecord, type TaskTag } from '../src/core/tasks.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { t } from '../src/client/locales.ts'

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

function fakeController(tasks: TaskRecord[], snapshot?: Partial<ControllerSnapshot>): BoardController {
  const state: ControllerSnapshot = {
    tasks,
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
    updateTask: async () => true,
    closeTask: () => {},
  } as unknown as BoardController
}

async function mountDetailView(tRecord: TaskRecord, controller: BoardController) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<TaskDetail controller={controller} task={tRecord} />) })
  return container
}

async function mountBoardView(tasks: TaskRecord[], snapshot?: Partial<ControllerSnapshot>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => { root.render(<TaskBoard controller={fakeController(tasks, snapshot)} />) })
  return container
}

function click(element: Element): void {
  act(() => { (element as HTMLElement).click() })
}

describe('card badges', () => {
  it('renders one badge per label with the hashed tone', async () => {
    const container = await mountBoardView([task({ tags: [{ name: 'work' }, { name: 'urgent', promptPrefix: 'ship today' }] })])
    const badges = container.querySelectorAll('[data-dsh-part="tag-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0]!.textContent).toBe('work')
    expect(badges[0]!.getAttribute('data-tag-tone')).toBe(String(tagTone('work')))
    expect(badges[1]!.textContent).toBe('urgent')
    expect(badges[1]!.getAttribute('data-tag-tone')).toBe(String(tagTone('urgent')))
    // The execution hint is exposed on hover, not printed on the card.
    expect(badges[1]!.getAttribute('title')).toBe('ship today')
  })

  it('renders no badge container for an untagged task', async () => {
    const container = await mountBoardView([task()])
    expect(container.querySelectorAll('[data-dsh-part="tag-badge"]')).toHaveLength(0)
  })
})

describe('tag filter bar', () => {
  const tasks = [
    task({ id: 'a', title: 'Work urgent', tags: [{ name: 'work' }, { name: 'urgent' }] }),
    task({ id: 'b', title: 'Work only', tags: [{ name: 'work' }] }),
    task({ id: 'c', title: 'Home', tags: [{ name: 'home' }] }),
  ]

  it('offers one chip per label in use, sorted by first appearance', async () => {
    const container = await mountBoardView(tasks)
    const filter = container.querySelector('[data-dsh-part="tag-filter"]')
    expect(filter).not.toBeNull()
    const chips = [...container.querySelectorAll('[data-dsh-part="tag-chip"]')]
    expect(chips.map(chip => chip.textContent)).toEqual(['work', 'urgent', 'home'])
    for (const chip of chips) expect(chip.getAttribute('aria-pressed')).toBe('false')
  })

  it('is absent when no task carries a label', async () => {
    const container = await mountBoardView([task()])
    expect(container.querySelector('[data-dsh-part="tag-filter"]')).toBeNull()
  })

  it('narrows to the selected label and restores on a second click', async () => {
    const container = await mountBoardView(tasks)
    const cards = () => [...container.querySelectorAll('[data-dsh-part="card"]')].map(card => card.textContent)
    expect(cards()).toHaveLength(3)

    const work = container.querySelector('[data-dsh-part="tag-chip"]')!
    click(work)
    expect(work.getAttribute('aria-pressed')).toBe('true')
    expect(cards().join('|')).toContain('Work urgent')
    expect(cards().join('|')).toContain('Work only')
    expect(cards().join('|')).not.toContain('Home')

    click(work)
    expect(work.getAttribute('aria-pressed')).toBe('false')
    expect(cards()).toHaveLength(3)
  })

  it('filters conjunctively: two labels need a card carrying both', async () => {
    const container = await mountBoardView(tasks)
    const chips = [...container.querySelectorAll('[data-dsh-part="tag-chip"]')]
    const work = chips.find(chip => chip.textContent === 'work')!
    const urgent = chips.find(chip => chip.textContent === 'urgent')!
    click(work)
    click(urgent)
    const rendered = [...container.querySelectorAll('[data-dsh-part="card"]')].map(card => card.textContent)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toContain('Work urgent')
  })

  it('shows the tag-specific empty copy when the filter excludes everything', async () => {
    const container = await mountBoardView(tasks)
    const chips = [...container.querySelectorAll('[data-dsh-part="tag-chip"]')]
    click(chips.find(chip => chip.textContent === 'urgent')!)
    click(chips.find(chip => chip.textContent === 'home')!)
    const empty = [...container.querySelectorAll('div')].filter(node => node.textContent === t('board.tagEmpty'))
    expect(empty.length).toBeGreaterThan(0)
  })

  it('keeps a label offered while its only task is archived', async () => {
    const container = await mountBoardView([
      task({ id: 'a', tags: [{ name: 'work' }] }),
      task({ id: 'b', tags: [{ name: 'shelved' }], archivedAt: 5 }),
    ])
    const chips = [...container.querySelectorAll('[data-dsh-part="tag-chip"]')].map(chip => chip.textContent)
    expect(chips).toEqual(['work', 'shelved'])
    // The archived card itself is not on the board.
    expect([...container.querySelectorAll('[data-dsh-part="card"]')]).toHaveLength(1)
  })

  it('hides the filter bar in the archive view', async () => {
    const container = await mountBoardView(
      [task({ id: 'a', tags: [{ name: 'work' }] })],
      { archiveView: true },
    )
    expect(container.querySelector('[data-dsh-part="tag-filter"]')).toBeNull()
  })
})

describe('tag editor', () => {
  function mountEditor(tags: TaskTag[], knownTags: TaskTag[] = []) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    let current = tags
    const render = (next: TaskTag[]): void => {
      current = next
      act(() => {
        root.render(<TaskTagFields tags={current} knownTags={knownTags} onChange={render} />)
      })
    }
    render(tags)
    return { container, value: () => current }
  }

  function inputs(container: HTMLElement): HTMLInputElement[] {
    return [...container.querySelectorAll('input')]
  }

  /**
   * Type into a React-controlled input. Assigning `value` directly is swallowed
   * by React's value tracker, so the native setter is used before the event.
   */
  function typeInto(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('adds and removes rows through the shared form', () => {
    const editor = mountEditor([])
    const add = [...editor.container.querySelectorAll('button')].find(button => button.textContent!.includes('+'))!
    click(add)
    expect(editor.value()).toHaveLength(1)

    typeInto(inputs(editor.container)[0]!, 'work')
    expect(editor.value()[0]!.name).toBe('work')

    click([...editor.container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') !== null)!)
    expect(editor.value()).toHaveLength(0)
  })

  it('stops offering new rows at the limit', () => {
    const tags = Array.from({ length: TASK_TAG_LIMIT }, (_, index) => ({ name: 'tag' + String(index) }))
    const editor = mountEditor(tags)
    const add = [...editor.container.querySelectorAll('button')].find(button => button.textContent!.includes('+'))! as HTMLButtonElement
    expect(add.disabled).toBe(true)
  })

  it('adopts the hint of a label already in use', () => {
    const editor = mountEditor([{ name: '' }], [{ name: 'work', promptPrefix: 'archive to 02-work/' }])
    typeInto(inputs(editor.container)[0]!, 'work')
    expect(editor.value()[0]).toEqual({ name: 'work', promptPrefix: 'archive to 02-work/' })
  })

  it('drops blank rows before the wire', () => {
    expect(cleanTags([{ name: '  ' }, { name: ' work ', promptPrefix: ' ' }, { name: 'x', promptPrefix: ' y ' }]))
      .toEqual([{ name: 'work' }, { name: 'x', promptPrefix: 'y' }])
  })

  it('enforces length, limit, and deduplication matching the protocol wire gate', () => {
    const tooLongName = 'n'.repeat(33)
    const longPrompt = 'p'.repeat(250)
    const tags = [
      { name: tooLongName }, // dropped: exceeds 32 chars
      { name: 'tag1', promptPrefix: longPrompt }, // prompt truncated to 200 chars
      { name: 'tag1', promptPrefix: 'other' }, // deduplicated: dropped
      ...Array.from({ length: 10 }, (_, i) => ({ name: `item${i}` })),
    ]
    const cleaned = cleanTags(tags)
    expect(cleaned).toHaveLength(8) // capped at TASK_TAG_LIMIT = 8
    expect(cleaned[0]).toEqual({ name: 'tag1', promptPrefix: 'p'.repeat(200) })
    expect(cleaned.map(t => t.name)).not.toContain(tooLongName)
  })
})

describe('task detail tags and edit-tags flow', () => {
  it('renders badges in detail and exposes editTags button once executed', async () => {
    const executedTask = task({
      id: 'ex1',
      tags: [{ name: 'frontend' }, { name: 'core' }],
      executions: [{ id: 'e1', startedAt: 100, endedAt: 200, result: 'succeeded', sessionId: undefined, error: undefined }],
    })
    const updateTaskMock = vi.fn(async () => true)
    const ctrl = { ...fakeController([executedTask]), updateTask: updateTaskMock } as unknown as BoardController

    const container = await mountDetailView(executedTask, ctrl)
    // Renders tag badges in detail view
    const badges = container.querySelectorAll('[data-dsh-part="tags"] [data-dsh-part="tag-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges[0]!.textContent).toBe('frontend')
    expect(badges[1]!.textContent).toBe('core')

    // Edit content button must NOT be present
    const buttons = [...container.querySelectorAll('footer button')]
    expect(buttons.some(b => b.textContent === t('detail.edit'))).toBe(false)

    // Edit tags button MUST be present
    const editTagsBtn = buttons.find(b => b.textContent === t('detail.editTags'))
    expect(editTagsBtn).toBeDefined()

    // Click editTags button to open modal
    click(editTagsBtn!)

    // Modal should be open
    expect(document.querySelector('[role="dialog"][aria-label="' + t('detail.editTags') + '"]')).not.toBeNull()

    // Submit save
    const saveBtn = [...document.querySelectorAll('button')].find(b => b.textContent === t('edit.save'))!
    click(saveBtn)
    await act(async () => {})

    // Should call updateTask with only tags in patch (no title, description, or prompt)
    expect(updateTaskMock).toHaveBeenCalledWith('ex1', {
      tags: [{ name: 'frontend' }, { name: 'core' }],
    })
  })

  it('exposes full edit button instead of editTags for unexecuted task', async () => {
    const freshTask = task({ id: 'f1', tags: [{ name: 'fresh' }], executions: [] })
    const ctrl = fakeController([freshTask])
    const container = await mountDetailView(freshTask, ctrl)

    const buttons = [...container.querySelectorAll('footer button')]
    expect(buttons.some(b => b.textContent === t('detail.edit'))).toBe(true)
    expect(buttons.some(b => b.textContent === t('detail.editTags'))).toBe(false)
  })
})

