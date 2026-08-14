import { describe, expect, it } from 'vitest'
import { roundsOf, type RoundEntry } from '../src/client/RoundJumpSurface.tsx'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

function userNode(key: string, text: string): ChatConversationViewNode {
  return {
    key,
    kind: 'user',
    id: key,
    target: 'chat',
    anchorSeq: 0,
    location: { kind: 'turn', turn: 0, step: 0, seq: 0 },
    visibility: 'visible',
    data: { content: [{ type: 'text', text }] },
  }
}

function assistantNode(key: string): ChatConversationViewNode {
  return {
    key,
    kind: 'assistant',
    id: key,
    target: 'chat',
    anchorSeq: 0,
    location: { kind: 'turn', turn: 0, step: 0, seq: 0 },
    visibility: 'visible',
    data: {},
  }
}

describe('roundsOf', () => {
  it('collects user nodes in chat order, skipping other kinds', () => {
    const order = ['a0', 'm1', 'a1', 'm2']
    const nodes = new Map<string, ChatConversationViewNode>([
      ['a0', assistantNode('a0')],
      ['m1', userNode('m1', '第一轮提问')],
      ['a1', assistantNode('a1')],
      ['m2', userNode('m2', '第二轮提问')],
    ])
    const rounds: RoundEntry[] = roundsOf(order, nodes)
    expect(rounds).toEqual([
      { key: 'm1', preview: '第一轮提问' },
      { key: 'm2', preview: '第二轮提问' },
    ])
  })

  it('collapses whitespace and truncates long previews', () => {
    const order = ['m1']
    const nodes = new Map<string, ChatConversationViewNode>([
      ['m1', userNode('m1', `  第\n一轮   提问  ${'长'.repeat(200)}  `)],
    ])
    const rounds = roundsOf(order, nodes)
    expect(rounds[0].preview.startsWith('第 一轮 提问')).toBe(true)
    expect(rounds[0].preview.endsWith('…')).toBe(true)
    expect(rounds[0].preview.length).toBeLessThanOrEqual(121)
  })

  it('omits nodes missing from the store', () => {
    const order = ['m1', 'missing']
    const nodes = new Map<string, ChatConversationViewNode>([
      ['m1', userNode('m1', '只有这一条')],
    ])
    expect(roundsOf(order, nodes)).toEqual([{ key: 'm1', preview: '只有这一条' }])
  })

  it('returns an empty list for an empty order', () => {
    expect(roundsOf([], new Map())).toEqual([])
  })
})
