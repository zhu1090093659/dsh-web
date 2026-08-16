/**
 * Official trajectory row projection: cellIndex enumeration mirroring the
 * shipped ui-trajectory layout, with per-row file-op state.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationNode, RunningToolCall } from '@deepseek-ai/dsh-client-runtime/client'
import { projectOfficialRows, type OfficialRowProjection } from '../src/core/official-rows.ts'

function userNode(seq: number, text = 'hello'): ConversationNode {
  return { kind: 'user', seq, time: seq * 1000, content: [{ type: 'text', text }], source: null } as ConversationNode
}

function assistantNode(seq: number, turn: number, step: number, blocks: readonly unknown[] = []): ConversationNode {
  return { kind: 'assistant', seq, time: seq * 1000, turn, step, blocks } as unknown as ConversationNode
}

function toolCallBlock(callId: string, name: string, argsRaw: string): unknown {
  return { kind: 'tool-call', callId, name, argsRaw }
}

function toolResultNode(
  seq: number,
  callId: string,
  name: string,
  argsRaw: string,
  resultText: string,
  subCalls: readonly unknown[] = [],
): ConversationNode {
  return {
    kind: 'tool-result', seq, time: seq * 1000, callId,
    call: { name, argsRaw },
    callTime: seq * 1000 - 5,
    content: [{ type: 'text', text: resultText }],
    isError: false,
    callView: null, resultView: null, subCalls: subCalls as never,
  } as unknown as ConversationNode
}

const writeArgs = (path: string, content: string): string => JSON.stringify({ file_path: path, content })
const editArgs = (path: string, oldString: string, newString: string): string =>
  JSON.stringify({ file_path: path, old_string: oldString, new_string: newString })

function rowsOf(
  nodes: readonly ConversationNode[],
  extra: { requests?: readonly unknown[]; runningCalls?: readonly RunningToolCall[] } = {},
): readonly OfficialRowProjection[] {
  return projectOfficialRows({
    nodes,
    requests: extra.requests,
    runningCalls: extra.runningCalls ?? [],
  })
}

describe('projectOfficialRows', () => {
  it('enumerates user/message/tool rows with the assistant-block dedupe', () => {
    const rows = rowsOf([
      userNode(1),
      assistantNode(2, 1, 1, [toolCallBlock('c1', 'write', writeArgs('a.txt', 'v1'))]),
      toolResultNode(3, 'c1', 'write', writeArgs('a.txt', 'v1'), 'Created a.txt'),
    ])
    expect(rows.map(row => [row.cellIndex, row.kind])).toEqual([
      [1, 'user'],
      [2, 'message'],
      [3, 'tool'],
    ])
    // The tool row carries the op; the duplicate tool-result node emits no row.
    const tool = rows[2]
    expect(tool?.op?.path).toBe('a.txt')
    expect(tool?.op?.created).toBe(true)
    expect(tool?.stateIndex).toBe(1)
    expect(rows[0]?.stateIndex).toBe(0)
    expect(rows[1]?.stateIndex).toBe(0)
  })

  it('emits a tool row from a tool-result node whose call head is out of window', () => {
    const rows = rowsOf([
      userNode(1),
      toolResultNode(2, 'c9', 'write', writeArgs('b.txt', 'v2'), 'Created b.txt'),
    ])
    expect(rows.map(row => [row.cellIndex, row.kind])).toEqual([
      [1, 'user'],
      [2, 'tool'],
    ])
    expect(rows[1]?.op?.path).toBe('b.txt')
    expect(rows[1]?.stateIndex).toBe(1)
  })

  it('accumulates stateIndex across write/edit ops', () => {
    const rows = rowsOf([
      userNode(1),
      assistantNode(2, 1, 1, [toolCallBlock('c1', 'write', writeArgs('a.txt', 'v1'))]),
      toolResultNode(3, 'c1', 'write', writeArgs('a.txt', 'v1'), 'Created a.txt'),
      assistantNode(4, 1, 2, [toolCallBlock('c2', 'edit', editArgs('a.txt', 'v1', 'v2'))]),
      toolResultNode(5, 'c2', 'edit', editArgs('a.txt', 'v1', 'v2'), 'Updated a.txt'),
    ])
    const ops = rows.filter(row => row.op !== undefined)
    expect(ops.map(row => [row.kind, row.op?.path, row.stateIndex])).toEqual([
      ['tool', 'a.txt', 1],
      ['tool', 'a.txt', 2],
    ])
    expect(ops[1]?.op?.kind).toBe('edit')
    expect(rows[rows.length - 1]?.stateIndex).toBe(2)
  })

  it('keeps calls without an in-window result op-less', () => {
    const rows = rowsOf([
      userNode(1),
      // Block present but no tool-result node in the window.
      assistantNode(2, 1, 1, [toolCallBlock('c1', 'write', writeArgs('a.txt', 'v1'))]),
    ])
    expect(rows[1]?.kind).toBe('message')
    expect(rows[2]?.kind).toBe('tool')
    expect(rows[2]?.op).toBeUndefined()
    expect(rows[2]?.stateIndex).toBe(0)
  })

  it('renders running calls as op-less tool rows and settled sub-calls as subtools', () => {
    const running: RunningToolCall[] = [{
      callId: 'r1', name: 'write', argsRaw: writeArgs('c.txt', 'c'),
      turn: 1, step: 2, time: 6000, callView: null,
      subCalls: [{
        kind: 'tool-result', seq: 7, time: 7000, callId: 'r1s',
        call: { name: 'edit', argsRaw: editArgs('c.txt', 'c', 'd') },
        callTime: 6500,
        content: [{ type: 'text', text: 'Updated c.txt' }],
        isError: false, callView: null, resultView: null, subCalls: [],
      }] as never,
    }]
    const rows = rowsOf([userNode(1)], { runningCalls: running })
    expect(rows.map(row => [row.kind, row.callId])).toEqual([
      ['user', undefined],
      ['tool', 'r1'],
      ['subtool', 'r1s'],
    ])
    expect(rows[1]?.op).toBeUndefined()
    expect(rows[2]?.op?.kind).toBe('edit')
    expect(rows[2]?.stateIndex).toBe(1)
  })

  it('skips a running call already emitted by its assistant block', () => {
    const running: RunningToolCall[] = [{
      callId: 'c1', name: 'write', argsRaw: writeArgs('a.txt', 'v1'),
      turn: 1, step: 1, time: 6000, callView: null, subCalls: [],
    }]
    const rows = rowsOf([
      userNode(1),
      assistantNode(2, 1, 1, [toolCallBlock('c1', 'write', writeArgs('a.txt', 'v1'))]),
      toolResultNode(3, 'c1', 'write', writeArgs('a.txt', 'v1'), 'Created a.txt'),
    ], { runningCalls: running })
    expect(rows).toHaveLength(3)
  })

  it('counts request, system, and compaction rows for index accuracy', () => {
    const requests: readonly unknown[] = [
      {
        purpose: 'assistant', startSeq: 2, turn: 1, step: 1,
        promptChange: { seq: 0, kind: 'initial' }, prompt: { system: 's' },
      },
      {
        purpose: 'compaction', startSeq: 6, turn: 1, step: 0, status: 'complete', summary: 'sum',
      },
    ]
    const rows = rowsOf([
      userNode(1),
      assistantNode(2, 1, 1, [toolCallBlock('c1', 'write', writeArgs('a.txt', 'v1'))]),
      toolResultNode(3, 'c1', 'write', writeArgs('a.txt', 'v1'), 'Created a.txt'),
    ], { requests })
    // initial system row first, then user, message, tool; the compaction row
    // is emitted after (its startSeq sorts later than the nodes).
    expect(rows.map(row => [row.cellIndex, row.kind])).toEqual([
      [1, 'system'],
      [2, 'user'],
      [3, 'message'],
      [4, 'tool'],
      [5, 'compacted'],
    ])
    expect(rows[3]?.stateIndex).toBe(1)
  })

  it('emits request-only rows for assistant requests without a represented step', () => {
    const requests: readonly unknown[] = [
      { purpose: 'assistant', startSeq: 1, turn: 1, step: 3 },
    ]
    const rows = rowsOf([userNode(2)], { requests })
    expect(rows.map(row => [row.cellIndex, row.kind])).toEqual([
      [1, 'request'],
      [2, 'user'],
    ])
  })

  it('treats the partial assistant like a normal message with op-less tool rows', () => {
    const rows = projectOfficialRows({
      nodes: [userNode(1)],
      partial: { turn: 1, step: 1, blocks: [toolCallBlock('p1', 'write', writeArgs('p.txt', 'p'))] },
      runningCalls: [],
    })
    expect(rows.map(row => [row.cellIndex, row.kind])).toEqual([
      [1, 'user'],
      [2, 'message'],
      [3, 'tool'],
    ])
    expect(rows[2]?.op).toBeUndefined()
  })
})
