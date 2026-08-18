import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  createActivityProjectionRuntime,
  displayToolName,
  projectOfficialEvent,
} from '../src/core/activity-projection.ts'

function event(value: object): SessionEvent {
  return value as SessionEvent
}

describe('official activity projection', () => {
  it('projects parallel tools with bounded names and completion counts', () => {
    const runtime = createActivityProjectionRuntime()
    const longName = '  search    with a deliberately very long tool name  '

    expect(displayToolName(longName)).toBe('search with a deliber...')
    expect(projectOfficialEvent(event({
      type: 'tool/call',
      data: { callId: 'one', name: longName },
    }), runtime)).toMatchObject({
      phase: 'tool',
      tool: { activeCount: 1, completedCount: 0 },
    })
    expect(projectOfficialEvent(event({
      type: 'tool/call',
      data: { callId: 'two', name: 'shell' },
    }), runtime)).toMatchObject({
      phase: 'tool',
      statusLine: '正在使用 shell',
      tool: { activeCount: 2, completedCount: 0 },
    })
    expect(projectOfficialEvent(event({
      type: 'tool/result',
      data: {
        message: {
          source: { callId: 'one' },
          content: [{ type: 'tool-result', isError: false }],
        },
      },
    }), runtime)).toMatchObject({
      phase: 'tool',
      statusLine: '还有 1 个工具运行中',
      tool: { name: 'shell', activeCount: 1, completedCount: 1 },
    })
    expect(projectOfficialEvent(event({
      type: 'tool/result',
      data: {
        error: { code: 'FAILED' },
        message: {
          source: { callId: 'two' },
          content: [{ type: 'tool-result', isError: true }],
        },
      },
    }), runtime)).toMatchObject({
      phase: 'failed',
      statusLine: '工具执行失败',
      tool: { activeCount: 0, completedCount: 2 },
    })
  })

  it('keeps compatibility copy for the full official sequence', () => {
    const runtime = createActivityProjectionRuntime()
    expect(projectOfficialEvent(event({ type: 'turn/start', data: { turn: 1 } }), runtime))
      .toMatchObject({ phase: 'waiting', statusLine: '准备开始' })
    expect(projectOfficialEvent(event({
      type: 'assistant/chunk',
      data: { chunk: { type: 'reasoning-delta', text: 'analysis' } },
    }), runtime)).toMatchObject({ phase: 'thinking', statusLine: '正在思考' })
    expect(projectOfficialEvent(event({
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'answer' } },
    }), runtime)).toMatchObject({ phase: 'review', statusLine: '整理回复中' })
    expect(projectOfficialEvent(event({
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    }), runtime)).toEqual({ phase: 'done', statusLine: '完成啦', completedTurn: 1 })
    expect(projectOfficialEvent(event({
      type: 'turn/end',
      data: { turn: 2, reason: { kind: 'blocked' } },
    }), runtime)).toEqual({ phase: 'blocked', statusLine: '任务受阻，等待继续' })
  })

  it('ignores unknown events instead of replacing meaningful activity', () => {
    const runtime = createActivityProjectionRuntime()
    expect(projectOfficialEvent(event({ type: 'log', data: {} }), runtime)).toBeUndefined()
  })
})
