// @vitest-environment jsdom
/**
 * Claim audit UI (issue #6): the task detail shows the freeze source session
 * and each execution row shows the initiator session id.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskDetail } from '../src/client/board/TaskDetail.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount() })
  document.body.replaceChildren()
})

function card(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'card-1',
    title: '续接卡',
    description: '',
    prompt: '继续干活',
    status: 'running',
    createdAt: 0,
    updatedAt: 0,
    executions: [{
      id: 'e1', sessionId: 'session-run', startedAt: 0, endedAt: undefined, result: undefined, error: undefined,
      initiatedBy: 'session-claimer', frozenAt: 0, frozenBy: 'session-source',
    }],
    freeze: { goal: '目标', progress: '进度', next: '下一步', frozenAt: 0, frozenBy: 'session-source' },
    ...overrides,
  }
}

function controller(): BoardController {
  const state: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: 'card-1',
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: { revision: 1, scheduler: { timeZone: 'UTC' }, power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true }, sessionDefaultPermission: 'read-only' },
  }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    closeTask: () => {},
  } as unknown as BoardController
}

function render(element: React.ReactElement): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return container
}

describe('claim audit UI (issue #6)', () => {
  it('shows the freeze source session and the execution initiator in the detail view', () => {
    const container = render(<TaskDetail controller={controller()} task={card()} />)
    const freeze = container.querySelector('[data-dsh-part="freeze"]')
    expect(freeze).not.toBeNull()
    expect(freeze!.textContent).toContain('session-source')
    const executionList = container.querySelector('ul.executionList')
    // The last execution list on the page is the history; assert any row text.
    expect(container.textContent).toContain('session-claimer')
  })
})
