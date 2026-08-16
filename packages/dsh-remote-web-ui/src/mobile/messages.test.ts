/** foldEvents: message-list folding from a session event stream. */
import { describe, expect, it } from 'vitest'
import { foldEvents, type WireEvent } from './messages.ts'

/** Assemble one event with an auto-incrementing seq / time. */
function makeEvent(
  type: string,
  data: unknown,
  seq: number,
  time = seq * 1_000,
): WireEvent {
  return { type, seq, time, data }
}

/** A DSH-shaped user message payload (content: text blocks). */
function userMessageData(id: string, text: string): unknown {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

/** A DSH-shaped assistant message payload for one step. */
function assistantMessageData(
  id: string,
  turn: number,
  step: number,
  text: string,
): unknown {
  return {
    turn,
    step,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: 'fx', model: 'fx-1' },
    },
  }
}

/** A DSH-shaped text-delta chunk for one step. */
function textChunk(turn: number, step: number, text: string, seq: number): WireEvent {
  return makeEvent('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } }, seq)
}

describe('foldEvents', () => {
  it('folds one full turn: user message, streamed chunks, final assistant message', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '查一下天气'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '今天' } }, 1),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '晴天' } }, 2),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '今天晴天'), 3),
    ]
    const result = foldEvents(events)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ kind: 'user', id: 'u-1', text: '查一下天气', seq: 0 })
    expect(result[1]).toMatchObject({
      kind: 'assistant',
      id: 'a-1',
      text: '今天晴天',
      seq: 3,
      pending: false,
    })
  })

  it('keeps the streamed pending assistant alive while chunks arrive, then finalizes', () => {
    const first = foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '你', 1),
      textChunk(0, 0, '好', 2),
    ])
    const pending = first.find(message => message.kind === 'assistant')
    expect(pending).toMatchObject({ text: '你好', pending: true, seq: 2 })

    const finalized = foldEvents(
      [makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '你好！'), 3)],
      first,
    )
    const assistant = finalized.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ id: 'a-1', text: '你好！', pending: false, seq: 3 })
    // No duplicate assistant message appears.
    expect(finalized.filter(message => message.kind === 'assistant')).toHaveLength(1)
  })

  it('message/update replaces text and message/delete removes the row', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '旧文本'), 0),
      makeEvent('user/message', userMessageData('u-2', '要删掉'), 1),
      makeEvent('message/update', { id: 'u-1', text: '新文本' }, 2),
      makeEvent('message/delete', { id: 'u-2' }, 3),
    ]
    const result = foldEvents(events)
    expect(result.map(message => message.id)).toEqual(['u-1'])
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user', text: '新文本', seq: 2 })
  })

  it('accumulates toolSummary on the assistant message owning the tool calls', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '改文件'), 0),
      textChunk(0, 0, '正在处理', 1),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '已完成'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.toolSummary).toBe('使用 bash / read')
    expect(assistant?.tools).toEqual([
      { callId: 'c1', name: 'bash', arguments: '{}' },
      { callId: 'c2', name: 'read', arguments: '{"path":"a.txt"}' },
    ])
  })

  it('keeps reasoning text apart from the message body and folds reasoning-delta chunks', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '复杂问题'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '先分析' } }, 1),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '再行动' } }, 2),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 1, text: '结论' } }, 3),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: {
          id: 'a-1',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '先分析再行动' },
            { type: 'text', text: '结论' },
          ],
          source: { kind: 'model', provider: 'fx', model: 'fx-1' },
        },
      }, 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ text: '结论', reasoning: '先分析再行动', pending: false })
  })

  it('keeps streamed reasoning when the final assistant message omits the reasoning block', () => {
    const streamed = foldEvents([
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'reasoning-delta', index: 0, text: '思考过程' } }, 1),
    ])
    const finalized = foldEvents(
      [makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '回答'), 2)],
      streamed,
    )
    const assistant = finalized.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ text: '回答', reasoning: '思考过程', pending: false })
  })

  it('dedupes repeated tool/call events by callId', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', '跑测试'), 0),
      textChunk(0, 0, '开始', 1),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }, 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'done'), 4),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.tools).toEqual([{ callId: 'c1', name: 'bash', arguments: '{"cmd":"a"}' }])
  })

  it('marks the assistant message failed when turn/end ends in an error', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hello'), 0),
      makeEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: '部分' } }, 1),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ failed: true, pending: false, kind: 'assistant' })
  })

  it('does not flag failed for a completed turn', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hello'), 0),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'ok'), 1),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.failed).toBeFalsy()
    expect(assistant?.pending).toBeFalsy()
  })

  it('is idempotent: applying the same batch twice yields an identical list', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      textChunk(0, 0, '一', 1),
      textChunk(0, 0, '二', 2),
      makeEvent('tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }, 3),
      makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, '一二'), 4),
      makeEvent('turn/end', { turn: 0, reason: { kind: 'completed' } }, 5),
    ]
    const once = foldEvents(events)
    const twice = foldEvents(events, once)
    expect(twice).toEqual(once)
    expect(twice.filter(message => message.kind === 'assistant')).toHaveLength(1)
    // Text must not have doubled from re-aggregating the streamed chunks.
    expect(twice.find(message => message.kind === 'assistant')?.text).toBe('一二')
  })

  it('skips unknown / unsupported event types safely', () => {
    const events: WireEvent[] = [
      makeEvent('session/end-seed', {}, 0),
      makeEvent('turn/start', { turn: 0 }, 1),
      makeEvent('user/message', userMessageData('u-1', 'hello'), 2),
      makeEvent('some/future-plugin', { whatever: true }, 3),
      makeEvent('goal/change', { objective: 'x' }, 4),
    ]
    const result = foldEvents(events)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user' })
  })

  it('does not mutate the caller-supplied existing list', () => {
    const first = foldEvents([makeEvent('user/message', userMessageData('u-1', 'hello'), 0)])
    const snapshot = JSON.stringify(first)
    foldEvents([makeEvent('assistant/message', assistantMessageData('a-1', 0, 0, 'world'), 1)], first)
    expect(JSON.stringify(first)).toBe(snapshot)
  })

  it('request/context sets the context window used by a later assistant/message with usage', () => {
    const events: WireEvent[] = [
      makeEvent('request/context', { provider: 'fx', model: 'fx-1', contextWindow: 100_000 }, 0),
      makeEvent('user/message', userMessageData('u-1', 'hi'), 1),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 10, outputTokens: 5 },
      }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 5 },
      contextWindow: 100_000,
    })
  })

  it('usage without a context window carries no contextWindow', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 10, outputTokens: 5 },
      }, 1),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({ usage: { inputTokens: 10, outputTokens: 5 } })
    expect(assistant?.contextWindow).toBeUndefined()
  })

  it('usage and contextWindow are both attached when request/context precedes the message', () => {
    const events: WireEvent[] = [
      makeEvent('request/context', { provider: 'fx', model: 'fx-1', contextWindow: 200_000 }, 0),
      makeEvent('user/message', userMessageData('u-1', 'hi'), 1),
      makeEvent('assistant/message', {
        turn: 0,
        step: 0,
        message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        usage: { inputTokens: 30, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 1 },
      }, 2),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant).toMatchObject({
      usage: { inputTokens: 30, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 1 },
      contextWindow: 200_000,
    })
  })

  it('assistant/message without usage has no usage field', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', userMessageData('u-1', 'hi'), 0),
      makeEvent('assistant/message', { turn: 0, step: 0, message: { id: 'a-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }, 1),
    ]
    const result = foldEvents(events)
    const assistant = result.find(message => message.kind === 'assistant')
    expect(assistant?.usage).toBeUndefined()
    expect(assistant?.contextWindow).toBeUndefined()
  })

  it('attaches sourceKind from source.kind for a user message', () => {
    const events: WireEvent[] = [
      makeEvent('user/message', {
        id: 'u-plugin',
        role: 'user',
        content: [{ type: 'text', text: '系统注入' }],
        source: { kind: 'plugin', name: 'react-extension' },
      }, 0),
    ]
    const result = foldEvents(events)
    expect(result[0]).toMatchObject({ id: 'u-plugin', kind: 'user', sourceKind: 'plugin' })
  })

  it('keeps sourceKind on a replayed/replaced user/message', () => {
    const first = foldEvents([makeEvent('user/message', {
      id: 'u-1',
      role: 'user',
      content: [{ type: 'text', text: '第一版' }],
      source: { kind: 'plugin' },
    }, 0)])
    const second = foldEvents([makeEvent('user/message', {
      id: 'u-1',
      role: 'user',
      content: [{ type: 'text', text: '第二版' }],
      source: { kind: 'plugin' },
    }, 1)], first)
    expect(second[0]).toMatchObject({ id: 'u-1', text: '第二版', sourceKind: 'plugin' })
  })

  it('request/context and unknown events are still ignored by the fold', () => {
    const events: WireEvent[] = [
      makeEvent('some/future-event', { nope: true }, 0),
      makeEvent('request/context', { provider: 'fx', model: 'fx-1' }, 1),
      makeEvent('user/message', userMessageData('u-1', '真实消息'), 2),
    ]
    const result = foldEvents(events)
    // request/context with no window and the unknown event render nothing.
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'u-1', kind: 'user' })
  })
})
