// @vitest-environment jsdom
/**
 * The detail panel's information hierarchy: what the card says reads on one
 * track and what the board does with it on another, the execution history
 * folds after five rows, the acceptance report folds to a verdict, and the
 * card's nine same-weight buttons became one move menu plus a footer with one
 * primary action and a separated destructive one. Menu behavior here is the
 * keyboard contract: Escape and an outside press close it, focus returns to the
 * trigger, and Escape never reaches the panel's own close handler.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import { t, zh } from '../src/client/locales.ts'
import { openFormSection } from './form-sections.ts'
import { VISIBLE_EXECUTIONS } from '../src/client/board/ExecutionLog.tsx'
import { OVERLAY_EXIT_MS } from '../src/client/board/overlay.tsx'
import { MISSING_WORKSPACE_REASON } from '../src/core/workspace-target.ts'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import { createTask, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
  vi.useRealTimers()
})

/** One card with the fields the detail view reads. */
function card(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    ...createTask({ title: 'Panel card', description: 'body', prompt: 'do the thing' }, 0, 'card-1'),
    ...overrides,
  }
}

/** One settled execution record. */
function run(id: string, startedAt: number): ExecutionRecord {
  return { id, sessionId: `session-${id}`, startedAt, endedAt: startedAt + 1000, result: 'succeeded', error: undefined }
}

/** The host face of one board snapshot. */
function hostState(overrides: Record<string, unknown> = {}): ControllerSnapshot['host'] {
  return {
    revision: 1,
    scheduler: { timeZone: 'UTC' },
    power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true },
    sessionDefaultPermission: 'read-only',
    ...overrides,
  } as ControllerSnapshot['host']
}

/** A controller whose snapshot is the one board state the test needs. */
function controller(task: TaskRecord, hostOverrides: Record<string, unknown> = {}): BoardController {
  const state: ControllerSnapshot = {
    tasks: [task],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: task.id,
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: hostState(hostOverrides),
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

/** Render the detail panel over one card. */
function renderDetail(task: TaskRecord, hostOverrides: Record<string, unknown> = {}): { container: HTMLElement; controller: BoardController } {
  const board = controller(task, hostOverrides)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<TaskDetail controller={board} task={task} />) })
  return { container, controller: board }
}

/** The first button whose text is exactly one label. */
function buttonOf(container: ParentNode, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label)
  if (found === undefined) throw new Error('no button labelled ' + label)
  return found
}

/** Dispatch one keydown the way the browser reports it: from the focused node up. */
function pressKey(node: EventTarget, key: string): void {
  act(() => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

describe('detail panel hierarchy', () => {
  it('user opening a card reads its content and its execution on two tracks', () => {
    // Given a card with a prompt and a settled run
    const { container } = renderDetail(card({ executions: [run('e1', 1_000)] }))

    // When the panel renders
    const columns = container.querySelectorAll('[data-detail-layout] > [data-detail-column]')

    // Then the two tracks exist, in reading order, and each owns its half
    expect([...columns].map(column => column.getAttribute('data-detail-column'))).toEqual(['content', 'execution'])
    expect(columns[0]!.textContent).toContain('do the thing')
    expect(columns[1]!.textContent).toContain('执行记录')
    expect(columns[1]!.textContent).toContain('执行设置')
    expect(columns[0]!.textContent).not.toContain('执行设置')
  })

  it('user scanning a long history sees the five latest runs until they ask for all of them', () => {
    // Given a card with eight settled runs
    const executions = Array.from({ length: 8 }, (_, index) => run(`e${index}`, 1_000 + index))
    const { container } = renderDetail(card({ executions }))

    // Then the closed region echoes the ledger in one line and renders no row
    const foldHeader = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
      .find(button => (button.textContent ?? '').startsWith(t('detail.execution')))!
    expect(foldHeader.textContent).toContain('8 次')
    expect(foldHeader.textContent).toContain(t('detail.result.succeeded'))
    expect(container.querySelectorAll('[data-execution-id]')).toHaveLength(0)

    // When the reader opens the history region
    openFormSection(container, t('detail.execution'))
    const rows = (): number => container.querySelectorAll('[data-execution-id]').length
    const disclosure = buttonOf(container, '显示全部 8 条')

    // Then only the five latest rows are on screen, behind one disclosure
    expect(VISIBLE_EXECUTIONS).toBe(5)
    expect(rows()).toBe(5)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    const controlled = disclosure.getAttribute('aria-controls') ?? ''
    expect(document.getElementById(controlled)?.id).toBe(controlled)

    // When the reader opens it
    act(() => { disclosure.click() })

    // Then every run is listed
    expect(rows()).toBe(8)

    // When they close it again the extra rows play their exit leg first
    vi.useFakeTimers()
    try {
      act(() => { buttonOf(container, '收起').click() })
      expect(rows()).toBe(8)
      expect(container.querySelectorAll('[data-execution-fold="closing"]')).toHaveLength(1)
      act(() => { vi.advanceTimersByTime(OVERLAY_EXIT_MS + 1) })
      expect(rows()).toBe(5)
      expect(buttonOf(container, '显示全部 8 条').getAttribute('aria-expanded')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('status moves behind one menu', () => {
  it('user moving a card opens one menu instead of five same-weight buttons and picks a column', () => {
    // Given a card in the to-do column
    const task = card()
    const { container, controller: board } = renderDetail(task)

    // When the panel renders
    const trigger = buttonOf(container, '移动到…')

    // Then the five moves are no longer five buttons on the panel
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[role="menu"]')).toBeNull()

    // When the reader opens the menu
    act(() => { trigger.click() })

    // Then it lists exactly the manual columns
    const items = [...container.querySelectorAll('[role="menuitem"]')]
    expect(items.map(item => item.textContent)).toEqual(['移到待规划', '移到待办', '移到进行中', '移到已完成', '移到已失败'])
    expect(trigger.getAttribute('aria-expanded')).toBe('true')

    // And picking one moves the card through the controller and closes the menu
    act(() => { buttonOf(container.querySelector('[role="menu"]') as HTMLElement, '移到已完成').click() })
    expect(board.moveTask).toHaveBeenCalledWith(task.id, 'done')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('user pressing Escape closes the menu without closing the whole detail panel', () => {
    // Given an open move menu
    const { container, controller: board } = renderDetail(card())
    const trigger = buttonOf(container, '移动到…')
    act(() => { trigger.click() })
    const item = container.querySelector('[role="menuitem"]') as HTMLButtonElement

    // When Escape is pressed from inside the menu
    pressKey(item, 'Escape')

    // Then the menu closes, focus returns to the trigger, and the panel's own
    // Escape handler never ran
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(board.closeTask).not.toHaveBeenCalled()
  })

  it('user pressing anywhere outside the menu closes it', () => {
    // Given an open move menu
    const { container } = renderDetail(card())
    const trigger = buttonOf(container, '移动到…')
    act(() => { trigger.click() })
    expect(container.querySelectorAll('[role="menu"]')).toHaveLength(1)

    // When the reader presses outside it
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })

    // Then it closes
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('detail footer actions', () => {
  it('user gets three footer actions in primary order with delete away from the primary action', () => {
    // Given a card that has settled
    const { container } = renderDetail(card({ executions: [run('e1', 1_000)], status: 'done' }))

    // When the footer renders
    const footer = container.querySelector('footer')
    const labels = [...footer!.querySelectorAll('button')].map(button => button.textContent?.trim())

    // Then it holds exactly the three actions, in the order primary actions read
    // (a card that already ran keeps only its labels editable)
    expect(labels).toEqual(['编辑标签', '重新执行', '删除'])

    // And the creation stamp sits between the primary action and delete, so the
    // destructive control is never adjacent to the main action
    const children = [...footer!.children]
    const primaryAt = children.findIndex(node => node.tagName === 'BUTTON' && node.textContent?.trim() === '重新执行')
    expect(children.filter(node => node.tagName === 'BUTTON')).toHaveLength(3)
    const stampAt = children.findIndex(node => node.textContent?.includes('创建于'))
    const deleteAt = children.findIndex(node => node.tagName === 'BUTTON' && node.textContent?.trim() === '删除')
    expect(primaryAt).toBeGreaterThan(-1)
    expect(stampAt).toBeGreaterThan(primaryAt)
    expect(deleteAt).toBeGreaterThan(stampAt)
  })

  it('user finding the secondary actions uses the header menu instead of extra footer buttons', () => {
    // Given a settled card that can still be duplicated and archived
    const task = card({ executions: [run('e1', 1_000)], status: 'done' })
    const { container, controller: board } = renderDetail(task)

    // When the header renders
    const trigger = buttonOf(container.querySelector('header') as HTMLElement, '更多操作')

    // Then duplicate and archive are one press away, and out of the footer
    expect(container.querySelector('footer')!.textContent).not.toContain('归档')
    act(() => { trigger.click() })
    expect([...container.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['修改并新建副本', '归档'])

    // And archiving goes through the same controller call as before
    act(() => { buttonOf(container.querySelector('[role="menu"]') as HTMLElement, '归档').click() })
    expect(board.archiveTask).toHaveBeenCalledWith(task.id)
  })
})

describe('folded execution column', () => {
  /** The execution column of the panel. */
  function rightColumn(container: HTMLElement): HTMLElement {
    const column = container.querySelector('[data-detail-column="execution"]')
    if (column === null) throw new Error('no execution column')
    return column as HTMLElement
  }

  /** The fold header whose title is one label. */
  function foldHeader(container: HTMLElement, title: string): HTMLButtonElement {
    const header = [...container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
      .find(button => (button.textContent ?? '').startsWith(title))
    if (header === undefined) throw new Error('no folded region titled ' + title)
    return header
  }

  it('user opening a card sees no long explanation paragraph in the execution column', () => {
    // Given a card with the advanced switch already on
    const { container } = renderDetail(card({ reuseSession: true }))

    // When the panel renders in its default state
    const right = rightColumn(container)

    // Then the execution targets stay visible, the switches stay folded, and
    // none of the long explanations is on the surface
    expect(right.querySelectorAll('select').length).toBeGreaterThanOrEqual(4)
    expect(right.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    expect(right.textContent).not.toContain(t('exec.hint'))
    expect(right.textContent).not.toContain(t('exec.reuseSessionHint'))
  })

  it('user reading a closed fold sees which switches are on, in the short form the view allows', () => {
    // Given: the advanced switch on, on a card whose switches read in one line
    const { container } = renderDetail(card({ reuseSession: true }))

    // When the closed region renders
    const header = foldHeader(container, t('detail.settings.run'))
    const summary = header.textContent ?? ''

    // Then the row is named exactly as the create dialog names the same section
    expect(header.textContent).toContain(t('new.section.run'))

    // And it echoes the switches that are on, and never one that is off
    expect(summary).toContain(t('detail.settings.summary.reuseSession'))

    // And every short explanation the panel shows stays inside one meta line
    for (const key of ['exec.hint.short', 'exec.reuseSessionHint.short'] as const) {
      expect([...zh[key]].length).toBeLessThanOrEqual(30)
    }
  })

  it('user opening the advanced fold reaches the session-reuse switch and it still save immediately', () => {
    // Given a card with nothing switched on
    const { container, controller: board } = renderDetail(card())

    // When the reader opens the advanced region
    const header = openFormSection(container, t('detail.settings.run'))

    // Then the switch and its one-line explanation are there, and the
    // retired team-run option is not one of them
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(header.getAttribute('aria-controls') ?? '')?.id).toBe(header.getAttribute('aria-controls'))
    const boxes = [...rightColumn(container).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes).toHaveLength(1)
    expect(container.textContent).toContain(t('exec.reuseSessionHint.short'))

    // And toggling one writes through the controller exactly as before
    act(() => { boxes[0]!.click() })
    expect(board.updateTask).toHaveBeenCalledWith('card-1', { reuseSession: true })
  })

  it('user reading the closed schedule fold sees whether it is armed and what it will do', () => {
    // Given an armed recurring rule with a future run
    const now = Date.now()
    const { container } = renderDetail(card({
      schedule: {
        enabled: true,
        mode: 'cron',
        cron: '0 9 * * *',
        nextRunAt: now + 60 * 60 * 1000,
        lastTriggeredAt: undefined,
        runCount: 2,
      },
    }))

    // When the panel renders in its default state
    const summary = foldHeader(container, t('detail.schedule')).textContent ?? ''

    // Then the row says it is armed and when it fires next, and the rule that
    // produced that instant is not on the row at all
    expect(summary).toContain('已启用')
    expect(summary).not.toContain('0 9 * * *')
    expect(container.querySelector('input[aria-label="' + t('detail.schedule.cron') + '"]')).toBeNull()

    // And the rule rides the row's tooltip instead, so hovering the row still
    // reads the whole line the folded summary had to drop
    const hint = foldHeader(container, t('detail.schedule')).getAttribute('title') ?? ''
    expect(hint).toContain(t('detail.schedule.summary.planCron', { cron: '0 9 * * *' }))
    expect(hint).toContain('已启用')

    // And a card without a rule says so in one line
    const { container: idle } = renderDetail(card())
    expect(foldHeader(idle, t('detail.schedule')).textContent).toContain(t('detail.schedule.summary.off'))
  })

  it('user reading the three closed folds sees one group with one tooltip each', () => {
    // Given a card whose execution column renders all three folds closed
    const { container } = renderDetail(card())
    const advanced = foldHeader(container, t('detail.settings.run'))
    const schedule = foldHeader(container, t('detail.schedule'))
    const history = foldHeader(container, t('detail.execution'))

    // When the panel paints them
    // Then the three hang off one group element, which is what spaces them as a
    // list instead of three separate sections
    const group = schedule.parentElement?.parentElement
    expect(group).toBe(history.parentElement?.parentElement)
    expect(group?.parentElement).toBe(rightColumn(container))
    expect(group?.contains(advanced)).toBe(true)

    // And each of the three carries the whole line as its tooltip
    for (const header of [advanced, schedule, history]) {
      expect(header.getAttribute('title') ?? '').not.toBe('')
    }
  })

  it('user opening the schedule fold gets the editor with every field it always had', () => {
    // Given an armed recurring rule
    const { container } = renderDetail(card({
      schedule: { enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: Date.now() + 60_000, lastTriggeredAt: undefined, runCount: 1, maxRuns: 2 },
    }))

    // When the reader opens the region
    openFormSection(container, t('detail.schedule'))

    // Then the cron field, the plan kind, the cap, the zone and the cancel
    // action are all reachable again
    expect((container.querySelector('input[aria-label="' + t('detail.schedule.cron') + '"]') as HTMLInputElement).value).toBe('0 9 * * *')
    const labels = [...container.querySelectorAll('select')].map(select => select.getAttribute('aria-label'))
    expect(labels).toContain(t('detail.schedule.mode'))
    expect(labels).toContain(t('detail.schedule.maxRuns'))
    expect(labels).toContain(t('detail.schedule.timeZone'))
    expect(buttonOf(container, t('detail.schedule.cancel')).textContent?.trim()).toBe(t('detail.schedule.cancel'))
    expect(container.textContent).toContain(t('detail.schedule.runs', { done: '1', total: '2' }))
  })

  it('user collapsing a fold from inside its body gets the focus back on the region row', () => {
    // Given an open advanced region with one of its switches focused
    const { container } = renderDetail(card())
    const header = openFormSection(container, t('detail.settings.run'))
    const box = rightColumn(container).querySelector('input[type="checkbox"]') as HTMLInputElement
    act(() => { box.focus() })
    expect(document.activeElement).toBe(box)

    // When the reader closes the region from its row
    act(() => { header.click() })

    // Then the focus is on the row that owns the folded body, not on the body
    expect(document.activeElement).toBe(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('user reading a run refused for pinning no workspace sees the fix, not the Host wording', () => {
    // Given a card whose latest run was refused because it pins no workspace
    const refused: ExecutionRecord = { ...run('e1', 1_000), result: 'failed', error: MISSING_WORKSPACE_REASON }
    const { container } = renderDetail(card({ executions: [refused] }))

    // When the reader opens the history region
    openFormSection(container, t('detail.execution'))

    // Then the row states what to do in the reader's language, never the raw
    // Host text that the ledger stored
    const row = container.querySelector('[data-execution-id="e1"]')
    expect(row?.textContent).toContain(t('exec.error.noWorkspace'))
    expect(row?.textContent).not.toContain(MISSING_WORKSPACE_REASON)
  })

  it('user reaching a fold from the keyboard toggles it from the region row itself', () => {
    // Given a card whose history is folded
    const { container } = renderDetail(card({ executions: [run('e1', 1_000)] }))

    // When the reader focuses the region row and opens it
    const header = foldHeader(container, t('detail.execution'))
    act(() => { header.focus() })
    expect(document.activeElement).toBe(header)
    expect(header.tagName).toBe('BUTTON')
    act(() => { header.click() })

    // Then the region expanded, the row kept the focus (Esc and Tab land on the
    // panel, never inside a hidden body), and the body exists for the controls
    const bodyId = header.getAttribute('aria-controls') ?? ''
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(header)
    expect(document.getElementById(bodyId)?.id).toBe(bodyId)
  })
})
