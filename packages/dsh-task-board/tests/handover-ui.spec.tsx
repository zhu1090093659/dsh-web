// @vitest-environment jsdom
/**
 * Handover UI smoke (issue #5): the task detail shows the handover bundle
 * section, the pending-confirmation banner with a confirm button, and the
 * confirmed stamp after confirmation.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    title: '交接卡',
    description: '',
    prompt: 'p',
    status: 'todo',
    createdAt: 0,
    updatedAt: 0,
    executions: [],
    handover: { workspaceId: 'ws-1', mode: undefined, permission: 'danger-full-access', references: ['docs/a.md'], bundledAt: 0 },
    ...overrides,
  }
}

function controller(snapshotOverrides: Partial<ControllerSnapshot> = {}, confirm?: (id: string) => void): BoardController {
  const state: ControllerSnapshot = {
    tasks: [],
    boardOpen: true,
    archiveView: false,
    selectedTaskId: 'card-1',
    executionOptions: { workspaces: [], presets: [] },
    pendingTaskIds: [],
    host: { revision: 1, scheduler: { timeZone: 'UTC' }, power: { platform: 'linux', phase: 'unsupported', enabled: false, runningSessions: 0, armedSchedules: 0, sessionStateKnown: true }, sessionDefaultPermission: 'read-only' },
    ...snapshotOverrides,
  }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    closeTask: () => {},
    confirmPermission: confirm ?? (async () => true),
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

describe('handover UI (issue #5)', () => {
  it('shows the bundle references and the pending-confirmation banner with a confirm button', () => {
    const confirm = vi.fn(async () => true)
    const container = render(<TaskDetail controller={controller({}, confirm)} task={card()} />)
    const section = container.querySelector('[data-dsh-part="handover"]')
    expect(section).not.toBeNull()
    expect(section!.textContent).toContain('docs/a.md')
    const gate = container.querySelector('[data-dsh-part="permission-gate"]')
    expect(gate).not.toBeNull()
    const button = gate!.querySelector('button')
    expect(button).not.toBeNull()
    act(() => { button!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(confirm).toHaveBeenCalledWith('card-1')
  })

  it('shows the confirmed stamp instead of the banner once confirmed', () => {
    const container = render(<TaskDetail controller={controller()} task={card({ permissionConfirmedAt: 5 })} />)
    expect(container.querySelector('[data-dsh-part="permission-gate"]')).toBeNull()
    expect(container.textContent).toContain('已确认权限绑定')
  })

  it('shows no gate when the effective permission is at or below the session default', () => {
    const container = render(<TaskDetail controller={controller()} task={card({ handover: { references: [], permission: 'read-only', bundledAt: 0 } })} />)
    expect(container.querySelector('[data-dsh-part="permission-gate"]')).toBeNull()
  })
})
