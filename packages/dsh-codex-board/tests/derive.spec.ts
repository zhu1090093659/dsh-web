// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { deriveProgress, readCollapsed, writeCollapsed, type TodoItem } from '../src/core/derive.ts'

describe('deriveProgress', () => {
  it('returns empty progress for null (no todos yet)', () => {
    expect(deriveProgress(null)).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      ratio: 0,
      activeIndex: 0,
    })
  })

  it('returns empty progress for an empty list', () => {
    expect(deriveProgress([])).toEqual({
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      ratio: 0,
      activeIndex: 0,
    })
  })

  it('counts the three statuses and computes the ratio', () => {
    const todos: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
      { content: 'd', status: 'completed' },
    ]
    expect(deriveProgress(todos)).toEqual({
      total: 4,
      completed: 2,
      inProgress: 1,
      pending: 1,
      ratio: 0.5,
      activeIndex: 2,
    })
  })

  it('reports the first in-progress row index (1-based)', () => {
    const todos: TodoItem[] = [
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'in_progress' },
    ]
    expect(deriveProgress(todos).activeIndex).toBe(2)
    expect(deriveProgress(todos).inProgress).toBe(2)
  })

  it('reports activeIndex 0 and ratio 1 when everything is completed', () => {
    const todos: TodoItem[] = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'completed' },
    ]
    const progress = deriveProgress(todos)
    expect(progress.completed).toBe(2)
    expect(progress.inProgress).toBe(0)
    expect(progress.pending).toBe(0)
    expect(progress.ratio).toBe(1)
    expect(progress.activeIndex).toBe(0)
  })
})

describe('collapsed persistence', () => {
  const SESSION = 'session-test-1'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to expanded (false)', () => {
    expect(readCollapsed(SESSION)).toBe(false)
  })

  it('round-trips collapse state per session', () => {
    writeCollapsed(SESSION, true)
    expect(readCollapsed(SESSION)).toBe(true)
    writeCollapsed(SESSION, false)
    expect(readCollapsed(SESSION)).toBe(false)
  })

  it('keeps sessions independent', () => {
    writeCollapsed('session-a', true)
    expect(readCollapsed('session-a')).toBe(true)
    expect(readCollapsed('session-b')).toBe(false)
  })
})
