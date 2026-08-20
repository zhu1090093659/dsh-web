import { describe, expect, it } from 'vitest'
import {
  assistantFinalizedInTurn,
  lastCompletedUserTarget,
  lastUserInTurn,
  turnHasToolActivity,
  userText,
} from '../src/core/transcript.ts'
import { assistantMsg, contextMsg, imageUserMsg, snapshot, steeringMsg, toolResult, userMsg } from './fixtures.ts'

describe('userText', () => {
  it('joins text-only content verbatim', () => {
    expect(userText([{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }])).toBe('hello world')
  })

  it('rejects messages with any non-text block (attachments cannot be copied)', () => {
    expect(userText([{ type: 'text', text: 'prompt' }, { type: 'image', attachment: {} as never }])).toBeNull()
    expect(userText([])).toBeNull()
  })
})

describe('lastCompletedUserTarget', () => {
  it('targets the LAST user message in a completed turn and cuts the fork anchor before it', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'first'), assistantMsg(3, 1), userMsg(5, 'second'), assistantMsg(9, 2)],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    const target = lastCompletedUserTarget(snap)
    expect(target).not.toBeNull()
    expect(target?.seq).toBe(5)
    expect(target?.text).toBe('second')
    expect(target?.turn).toBe(2)
    expect(target?.forkAtSeq).toBe(3)
  })

  it('returns null for a first-turn message (no earlier turn/end to fork before)', () => {
    const target = lastCompletedUserTarget(snapshot({
      nodes: [userMsg(1, 'first')],
      turnEnds: new Map([[1, 5]]),
    }))
    // Still editable — the edit flow falls back to a fresh blank session.
    expect(target?.forkAtSeq).toBeNull()
    expect(target?.text).toBe('first')
  })

  it('ignores steering and injected context nodes', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), steeringMsg(4), contextMsg(5)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(lastCompletedUserTarget(snap)?.seq).toBe(1)
  })

  it('rejects image messages', () => {
    const snap = snapshot({
      nodes: [imageUserMsg(1), assistantMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(lastCompletedUserTarget(snap)).toBeNull()
  })

  it('rejects while the session is running or removed', () => {
    const nodes = [userMsg(1, 'a'), assistantMsg(3, 1)]
    const turnEnds = new Map([[1, 3]])
    expect(lastCompletedUserTarget(snapshot({ nodes, turnEnds, running: true }))).toBeNull()
    expect(lastCompletedUserTarget(snapshot({ nodes, turnEnds, removed: true }))).toBeNull()
  })

  it('rejects a last user message whose turn never ended', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'unended')],
      turnEnds: new Map([[1, 3]]),
    })
    expect(lastCompletedUserTarget(snap)).toBeNull()
  })

  it('edits the first turn of a session (fork anchor null) but not a running one', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a')],
      turnEnds: new Map([[1, 2]]),
    })
    const target = lastCompletedUserTarget(snap)
    expect(target?.forkAtSeq).toBeNull()
    expect(target?.turn).toBe(1)
  })
})

describe('turn helpers', () => {
  it('finds the last user message of a turn by seq bounds', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1), userMsg(5, 'b'), assistantMsg(9, 2)],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    expect(lastUserInTurn(snap, 2)?.seq).toBe(5)
    expect(lastUserInTurn(snap, 1)?.seq).toBe(1)
  })

  it('detects tool and command activity inside a turn only', () => {
    const withTool = snapshot({
      nodes: [userMsg(1, 'a'), toolResult(2), assistantMsg(3, 1), userMsg(5, 'b'), assistantMsg(9, 2)],
      turnEnds: new Map([[1, 3], [2, 9]]),
    })
    expect(turnHasToolActivity(withTool, 1)).toBe(true)
    expect(turnHasToolActivity(withTool, 2)).toBe(false)
    const withCommand = snapshot({
      nodes: [userMsg(1, 'a'), { kind: 'command', seq: 2, time: 2, commandId: 'x' as never, name: 'run', args: '', outcome: null }, assistantMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(turnHasToolActivity(withCommand, 1)).toBe(true)
  })

  it('detects finalized assistants only when a durable messageId exists', () => {
    const snap = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1, { messageId: undefined, interrupted: true })],
      turnEnds: new Map([[1, 3]]),
    })
    expect(assistantFinalizedInTurn(snap, 1)).toBe(false)
    const done = snapshot({
      nodes: [userMsg(1, 'a'), assistantMsg(3, 1)],
      turnEnds: new Map([[1, 3]]),
    })
    expect(assistantFinalizedInTurn(done, 1)).toBe(true)
  })
})
