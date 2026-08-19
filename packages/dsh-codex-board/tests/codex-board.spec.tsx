// @vitest-environment jsdom
/**
 * CodexBoard component smoke tests: the floating board renders the progress
 * summary, per-row status markers, and responds to collapse interaction.
 * The component is a pure presentation layer over the injected props, so
 * these tests drive it directly with a fixture locale seat.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, beforeEach } from 'vitest'
import { CodexBoard } from '../src/client/CodexBoard.tsx'
import type { TodoItem } from '../src/core/derive.ts'
import { NS, zh } from '../src/client/locales.ts'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => { root.unmount() })
  }
  document.body.replaceChildren()
  localStorage.clear()
})

beforeEach(() => {
  localStorage.clear()
})

/** Minimal locale seat bound to the zh dictionary (test copy). */
function t(key: string, params?: Record<string, string | number>): string {
  const template = (zh as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}

function mount(props: { sessionId?: string; todos: readonly TodoItem[] | null }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<CodexBoard sessionId={props.sessionId} todos={props.todos} t={t as never} />)
  })
  return container
}

describe('CodexBoard', () => {
  it('renders nothing without a session', () => {
    const container = mount({ sessionId: undefined, todos: [{ content: 'a', status: 'pending' }] })
    expect(container.querySelector('[data-testid="codex-board"]')).toBeNull()
  })

  it('renders nothing when the todos projection is absent (null)', () => {
    const container = mount({ sessionId: 's1', todos: null })
    expect(container.querySelector('[data-testid="codex-board"]')).toBeNull()
  })

  it('renders nothing for an empty list', () => {
    const container = mount({ sessionId: 's1', todos: [] })
    expect(container.querySelector('[data-testid="codex-board"]')).toBeNull()
  })

  it('shows the completed/total count and all rows', () => {
    const todos: TodoItem[] = [
      { content: 'step one', status: 'completed' },
      { content: 'step two', status: 'in_progress' },
      { content: 'step three', status: 'pending' },
    ]
    const container = mount({ sessionId: 's1', todos })
    const board = container.querySelector('[data-testid="codex-board"]')
    expect(board).not.toBeNull()
    expect(board!.getAttribute('data-dsh-plugin')).toBe('codex-board')
    expect(container.querySelector('[data-testid="codex-board-count"]')!.textContent).toBe('1/3')
    const rows = container.querySelectorAll('[data-testid="codex-board-row"]')
    expect(rows.length).toBe(3)
    expect(rows[0].getAttribute('data-status')).toBe('completed')
    expect(rows[1].getAttribute('data-status')).toBe('in_progress')
    expect(rows[2].getAttribute('data-status')).toBe('pending')
  })

  it('renders the progress bar width from the completion ratio', () => {
    const todos: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
      { content: 'c', status: 'pending' },
      { content: 'd', status: 'pending' },
    ]
    const container = mount({ sessionId: 's1', todos })
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar).not.toBeNull()
    expect((bar as HTMLElement).style.width).toBe('50%')
  })

  it('collapses and expands on header click, persisting per session', () => {
    const todos: TodoItem[] = [{ content: 'a', status: 'in_progress' }]
    const container = mount({ sessionId: 's1', todos })
    const header = container.querySelector('[data-testid="codex-board-header"]') as HTMLButtonElement
    expect(header.getAttribute('aria-expanded')).toBe('true')
    act(() => { header.click() })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-testid="codex-board-list"]')).toBeNull()
    // Collapse state persisted: remount with the same session restores it.
    const container2 = mount({ sessionId: 's1', todos })
    const header2 = container2.querySelector('[data-testid="codex-board-header"]') as HTMLButtonElement
    expect(header2.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps sessions independent for the collapsed state', () => {
    const todos: TodoItem[] = [{ content: 'a', status: 'pending' }]
    const c1 = mount({ sessionId: 's1', todos })
    const header1 = c1.querySelector('[data-testid="codex-board-header"]') as HTMLButtonElement
    act(() => { header1.click() })
    const c2 = mount({ sessionId: 's2', todos })
    const header2 = c2.querySelector('[data-testid="codex-board-header"]') as HTMLButtonElement
    expect(header2.getAttribute('aria-expanded')).toBe('true')
  })
})
