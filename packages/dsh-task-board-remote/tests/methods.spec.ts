import { describe, expect, it } from 'vitest'
import { createBoardMethods } from '../src/core/methods.ts'
import {
  MAX_RESPONSE_BYTES,
  METHOD_BOARD_APPLY,
  METHOD_BOARD_OPTIONS,
  METHOD_BOARD_SNAPSHOT,
} from '../src/protocol.ts'
import type { BoardCall } from '../src/core/seam.ts'
import { FakeBoard } from './support/doubles.ts'

const CALL: BoardCall = { connectionId: 'c1' }

/** The three handlers over one board accessor. */
function methodsOf(board: () => FakeBoard | undefined) {
  return createBoardMethods({ board })
}

describe('board.snapshot', () => {
  it('user asks for the board and receives the host snapshot verbatim', async () => {
    // Given a mounted board with one card
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    // When the phone asks for the board
    const answer = await methods[METHOD_BOARD_SNAPSHOT]({}, CALL)
    // Then the host's own document crosses unchanged, field for field, with the
    // §15 keys beside it: a reset, and no token because this client declared no
    // capability it could continue from
    const snapshot = board.snapshot()
    expect(answer).toEqual({
      ok: true,
      r: { mode: 'reset', token: '', snapshot, revision: snapshot.revision, tasks: snapshot.tasks },
    })
  })

  it('user asks for the board on a host that mounts none and is told it is unavailable', async () => {
    // Given a host whose board is not mounted
    const methods = methodsOf(() => undefined)
    // When the phone asks for the board
    const answer = await methods[METHOD_BOARD_SNAPSHOT]({}, CALL)
    // Then the surface reports the missing board instead of an unknown method
    expect(answer).toEqual({ ok: false, code: 'board-unavailable', msg: 'the task board is not mounted on this host' })
  })

  it('user reads the host failure text when the board cannot read its own ledger', async () => {
    // Given a board whose read fails
    const board = new FakeBoard()
    board.snapshotError = new Error('ledger is locked')
    const methods = methodsOf(() => board)
    // When the phone asks for the board
    const answer = await methods[METHOD_BOARD_SNAPSHOT]({}, CALL)
    // Then the host's own text is what the phone shows
    expect(answer).toEqual({ ok: false, code: 'board-unavailable', msg: 'the task board could not be read: ledger is locked' })
  })

  it('user asks for a board past the frame cap and is told it is unavailable', async () => {
    // Given a board whose full snapshot cannot cross one frame (§12.6)
    const board = new FakeBoard()
    board.oversize = true
    const methods = methodsOf(() => board)
    // When the phone asks for the board
    const answer = await methods[METHOD_BOARD_SNAPSHOT]({}, CALL)
    // Then the answer is the documented refusal rather than a dropped frame
    expect(answer.ok).toBe(false)
    expect(answer.ok === false && answer.code).toBe('board-unavailable')
    expect(answer.ok === false && answer.msg.startsWith('the task board answered ')).toBe(true)
    expect(answer.ok === false && answer.msg.includes(String(MAX_RESPONSE_BYTES))).toBe(true)
  })
})

describe('board.options', () => {
  it('user asks for options and receives the model catalog with the published meta', async () => {
    // Given a board that publishes its permission baseline and subtask depth
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    // When the phone asks for the options
    const answer = await methods[METHOD_BOARD_OPTIONS]({}, CALL)
    // Then the catalog is the host's own, and meta carries only the keys it set
    expect(answer).toEqual({
      ok: true,
      r: {
        catalog: { groups: [] },
        meta: {
          sessionDefaultPermission: 'read-only',
          maxSubtaskDepth: 1,
        },
      },
    })
  })

  it('user sees no new-card defaults key when the board sets none', async () => {
    // Given a board whose meta has no cardDefaults
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    // When the phone asks for the options
    const answer = await methods[METHOD_BOARD_OPTIONS]({}, CALL)
    // Then the key is absent, so the phone can tell "none configured" from a blank one
    const meta = (answer as { r: { meta: Record<string, unknown> } }).r.meta
    expect('cardDefaults' in meta).toBe(false)
  })

  it('user is told the options are unavailable when the board cannot resolve them', async () => {
    // Given a board whose options read fails
    const board = new FakeBoard()
    board.optionsError = new Error('no model catalog')
    const methods = methodsOf(() => board)
    // When the phone asks for the options
    const answer = await methods[METHOD_BOARD_OPTIONS]({}, CALL)
    // Then the failure names the options rather than the whole board
    expect(answer).toEqual({
      ok: false,
      code: 'board-unavailable',
      msg: 'the task board could not resolve its model catalog: no model catalog',
    })
  })

  it('user asks for options on a host that mounts no board and is told it is unavailable', async () => {
    // Given a host with no board
    const methods = methodsOf(() => undefined)
    // When the phone asks for the options
    const answer = await methods[METHOD_BOARD_OPTIONS]({}, CALL)
    // Then the same unavailable answer covers every method of the surface
    expect(answer).toEqual({ ok: false, code: 'board-unavailable', msg: 'the task board is not mounted on this host' })
  })
})

describe('board.apply', () => {
  it('user applies an action and the host receives it verbatim under the client key', async () => {
    // Given a mounted board
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    const action = { kind: 'move', taskId: 't-1', status: 'done' }
    // When the phone applies one action
    const answer = await methods[METHOD_BOARD_APPLY]({ requestId: 'req-1', action }, CALL)
    // Then the host got exactly that action and the client got the new snapshot and revision
    expect(board.applied).toEqual([{ requestId: 'req-1', action, initiator: undefined }])
    const { snapshot, revision } = (answer as { r: { snapshot: { revision: number }; revision: number } }).r
    expect(revision).toBe(5)
    expect(snapshot.revision).toBe(5)
  })

  it('user repeats one requestId on the same connection and the action is applied once', async () => {
    // Given one applied action
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    const payload = { requestId: 'req-1', action: { kind: 'move', taskId: 't-1', status: 'done' } }
    const first = await methods[METHOD_BOARD_APPLY](payload, CALL)
    // When the phone retransmits the same key
    const second = await methods[METHOD_BOARD_APPLY](payload, CALL)
    // Then the host saw one action and the client is handed the first answer again
    expect(board.applied).toHaveLength(1)
    expect(second).toEqual(first)
  })

  it('user on a second connection minting the same requestId gets its own action applied', async () => {
    // Given two paired phones that happened to pick the same key
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    const payload = { requestId: 'req-1', action: { kind: 'move', taskId: 't-1', status: 'done' } }
    await methods[METHOD_BOARD_APPLY](payload, { connectionId: 'c1' })
    // When the other connection applies its own action under that key
    await methods[METHOD_BOARD_APPLY](payload, { connectionId: 'c2' })
    // Then the idempotency scope is the connection, so both reached the host
    expect(board.applied).toHaveLength(2)
  })

  it('user applies without a key or without an action object and nothing reaches the host', async () => {
    // Given a mounted board
    const board = new FakeBoard()
    const methods = methodsOf(() => board)
    // When the phone sends an unusable envelope
    const noKey = await methods[METHOD_BOARD_APPLY]({ action: { kind: 'move' } }, CALL)
    const noAction = await methods[METHOD_BOARD_APPLY]({ requestId: 'req-1', action: 'move' }, CALL)
    // Then both are refused as arguments and the host was never asked
    expect(noKey).toEqual({ ok: false, code: 'invalid-args', msg: 'board.apply requires a non-empty requestId' })
    expect(noAction).toEqual({ ok: false, code: 'invalid-args', msg: 'board.apply requires an action object' })
    expect(board.applied).toEqual([])
  })

  it('user reads board-refused with the host text when the host refuses the action', async () => {
    // Given a board that refuses by throwing, as the host does
    const board = new FakeBoard()
    board.applyError = new Error('a card above the session permission must be confirmed on the Host')
    const methods = methodsOf(() => board)
    // When the phone applies the action
    const answer = await methods[METHOD_BOARD_APPLY]({ requestId: 'req-1', action: { kind: 'run', taskId: 't-1' } }, CALL)
    // Then the refusal is the host's own sentence under the documented code
    expect(answer).toEqual({
      ok: false,
      code: 'board-refused',
      msg: 'a card above the session permission must be confirmed on the Host',
    })
  })

  it('user retries under the same key after an unusable host answer and the action applies again', async () => {
    // Given a board whose first answer is unusable
    const board = new FakeBoard()
    board.applyAnswer = { tasks: [] }
    const methods = methodsOf(() => board)
    const payload = { requestId: 'req-1', action: { kind: 'move', taskId: 't-1', status: 'done' } }
    const first = await methods[METHOD_BOARD_APPLY](payload, CALL)
    // When the board recovers and the phone retries the same key
    board.applyAnswer = undefined
    const second = await methods[METHOD_BOARD_APPLY](payload, CALL)
    // Then the failed attempt was not replayed: nothing had been applied, so a retry must work
    expect(first).toEqual({ ok: false, code: 'board-unavailable', msg: 'the task board answered no snapshot with a revision' })
    expect(second.ok).toBe(true)
    expect(board.applied).toHaveLength(2)
  })

  it('user applies on a host that mounts no board and is told it is unavailable', async () => {
    // Given a host with no board
    const methods = methodsOf(() => undefined)
    // When the phone applies an action
    const answer = await methods[METHOD_BOARD_APPLY]({ requestId: 'req-1', action: { kind: 'move' } }, CALL)
    // Then the surface reports the missing board
    expect(answer).toEqual({ ok: false, code: 'board-unavailable', msg: 'the task board is not mounted on this host' })
  })
})
