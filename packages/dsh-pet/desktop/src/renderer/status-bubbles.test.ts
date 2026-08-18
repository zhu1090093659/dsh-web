import { describe, expect, it } from 'vitest'

import type { PetSnapshot } from '../shared/desktop-api.ts'
import { desktopStatusBubbles } from './status-bubbles.ts'

const snapshot: PetSnapshot = {
  animation: 'waiting',
  bubble: '正在思考',
  phase: 'thinking',
  sessionActive: true,
  affinity: {
    points: 0, rank: '初见', pets: 0, feeds: 0, turns: 0,
    petCooldown: false, feedCooldown: false,
  },
  treats: { stocked: 0, max: 20 },
}

describe('desktop status bubbles', () => {
  it('shows the compatibility status while a task is active', () => {
    expect(desktopStatusBubbles(snapshot)).toEqual([
      { id: 'status', text: '正在思考', kind: 'status' },
    ])
  })

  it('shows recent session statuses and summarizes overflow', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => ({
      sessionId: `session-${String(index)}`,
      animation: 'running' as const,
      bubble: `任务 ${String(index)}`,
      phase: 'tool',
    }))
    expect(desktopStatusBubbles({ ...snapshot, sessions })).toEqual([
      { id: 'session-0', text: '任务 0', kind: 'status' },
      { id: 'session-1', text: '任务 1', kind: 'status' },
      { id: 'session-2', text: '任务 2', kind: 'status' },
      { id: 'more', text: '另有 2 个会话进行中', kind: 'status' },
    ])
  })

  it('temporarily gives interaction feedback priority', () => {
    expect(desktopStatusBubbles(snapshot, { text: '摸摸成功', kind: 'pet' })).toEqual([
      { id: 'feedback', text: '摸摸成功', kind: 'pet' },
    ])
  })

  it('lets the latest pet whisper replace the primary status bubble', () => {
    expect(desktopStatusBubbles({
      ...snapshot,
      whisper: '我在这里陪着你',
      sessions: [
        { sessionId: 'primary', animation: 'running', bubble: '正在思考', phase: 'thinking' },
        { sessionId: 'secondary', animation: 'review', bubble: '正在检查', phase: 'review' },
      ],
    })).toEqual([
      { id: 'primary', text: '我在这里陪着你', kind: 'whisper' },
      { id: 'secondary', text: '正在检查', kind: 'status' },
    ])
  })
})
