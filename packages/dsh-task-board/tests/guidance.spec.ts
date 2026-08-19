import { describe, expect, it } from 'vitest'
import { TASK_BOARD_GUIDANCE } from '../src/index.ts'

describe('task-board model guidance', () => {
  it('tells agents to close visible todo_write plans before the final answer', () => {
    expect(TASK_BOARD_GUIDANCE).toContain('todo_write')
    expect(TASK_BOARD_GUIDANCE).toContain('最终回复前')
    expect(TASK_BOARD_GUIDANCE).toContain('completed')
  })
})
