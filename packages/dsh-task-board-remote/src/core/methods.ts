/**
 * The three methods of the board surface, over the host's capability face.
 *
 * Whatever a caller can trip on is decided by the host. This module checks only
 * the envelope of `board.apply` — an idempotency key and an action object — and
 * forwards the action verbatim; the host's own refusal text becomes
 * `board-refused` unchanged, so the phone shows what the board said instead of a
 * second rule invented here. No task field is read, which is why a card that
 * gains one needs no change in this file.
 * @module dsh-task-board-remote/core/methods
 */

import {
  BOARD_DELTA_KEY,
  BOARD_DELTA_MAX_ROWS,
  CAP_DELTA,
  CODE_BOARD_REFUSED,
  CODE_BOARD_UNAVAILABLE,
  CODE_INVALID_ARGS,
  FRAME_ENVELOPE_BYTES,
  MAX_RESPONSE_BYTES,
  METHOD_BOARD_APPLY,
  METHOD_BOARD_OPTIONS,
  METHOD_BOARD_SNAPSHOT,
  REPLAY_LIMIT,
} from '../protocol.ts'
import type { BoardCall, BoardFace, BoardMethodHandler, BoardMethodResult, BoardSnapshotFace, DeltaRowFace } from './seam.ts'

/** One task as the delta window keys it; the rest of the record stays opaque. */
interface BoardTaskRow extends DeltaRowFace {
  readonly [key: string]: unknown
}

/**
 * The board meta keys §12.3 publishes beside the acceptance options. Each is
 * forwarded only when the host set it, so "this deployment configures nothing"
 * stays distinguishable from a configured blank value.
 */
const META_KEYS = ['sessionDefaultPermission', 'cardDefaults', 'maxSubtaskDepth'] as const

/** Where the host face is read from for one call. */
export interface BoardMethodsOptions {
  /** The host face as it stands right now; undefined while the board is absent. */
  readonly board: () => BoardFace | undefined
}

/**
 * The applied requestIds this process replays, newest last.
 *
 * Promises are stored, not resolved answers, so two calls racing on one key
 * collapse into one action; an entry that answered `board-unavailable` is
 * forgotten, because nothing was applied and a retry has to be allowed to work.
 */
class ReplayLog {
  readonly #limit: number
  readonly #entries = new Map<string, Promise<BoardMethodResult>>()

  constructor(limit: number) {
    this.#limit = limit
  }

  get(key: string): Promise<BoardMethodResult> | undefined {
    return this.#entries.get(key)
  }

  set(key: string, answer: Promise<BoardMethodResult>): void {
    this.#entries.delete(key)
    this.#entries.set(key, answer)
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next()
      if (oldest.done === true) break
      this.#entries.delete(oldest.value)
    }
  }

  /** Drop the entry only when it is still this very attempt. */
  forget(key: string, answer: Promise<BoardMethodResult>): void {
    if (this.#entries.get(key) === answer) this.#entries.delete(key)
  }
}

/** @returns the message a caller can act on, from either an Error or a thrown value. */
function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @returns the value of a non-empty string field, or undefined. */
function textField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function unavailable(msg: string): BoardMethodResult {
  return { ok: false, code: CODE_BOARD_UNAVAILABLE, msg }
}

function invalid(msg: string): BoardMethodResult {
  return { ok: false, code: CODE_INVALID_ARGS, msg }
}

/**
 * Wrap one response body, refusing a body that cannot cross the bridge.
 *
 * The bound is protocol v1's frame cap minus the envelope's room (§1, §12.6):
 * a response that would arrive as a dropped frame is a refusal the client can
 * retry against a smaller page, not a write nobody receives.
 */
function carried(r: unknown): BoardMethodResult {
  let bytes: number
  try {
    bytes = new TextEncoder().encode(JSON.stringify(r)).length
  } catch {
    return unavailable('the task board answered a body that cannot be serialized')
  }
  if (bytes > MAX_RESPONSE_BYTES - FRAME_ENVELOPE_BYTES) {
    return unavailable(`the task board answered ${bytes} bytes, past the ${MAX_RESPONSE_BYTES} byte frame cap`)
  }
  return { ok: true, r }
}

/**
 * Read one snapshot from the host.
 * @param board - the host face, already known to be present.
 * @returns the snapshot, or the refusal to answer with.
 */
function readSnapshot(board: BoardFace): { readonly ok: true; readonly snapshot: BoardSnapshotFace } | { readonly ok: false; readonly result: BoardMethodResult } {
  let snapshot: unknown
  try {
    snapshot = board.snapshot()
  } catch (error) {
    return { ok: false, result: unavailable(`the task board could not be read: ${textOf(error)}`) }
  }
  if (!isRecord(snapshot) || typeof snapshot.revision !== 'number') {
    return { ok: false, result: unavailable('the task board answered no snapshot with a revision') }
  }
  return { ok: true, snapshot: snapshot as BoardSnapshotFace }
}

/**
 * The opaque `since` token one request carried.
 *
 * Anything that is not a non-empty string names no base, so the answer is a
 * reset — the same answer an unknown token gets.
 */
function sinceOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  const value = payload.since
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * @param rows - the host's task table.
 * @returns whether every row carries the id a delta is keyed by.
 *
 * A set that cannot be keyed is answered whole: inventing a key, or dropping the
 * row that lacks one, would send a delta a client cannot reconcile.
 */
function keyedById(rows: readonly unknown[]): rows is readonly BoardTaskRow[] {
  return rows.every(row => typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string')
}

/**
 * Answer one board read: the whole board, or the increment since a token (§15).
 *
 * The reset body keeps the host snapshot verbatim under `snapshot` — what every
 * client written before §15 already reads — and publishes the same two facts
 * `tasks` and `revision` beside it, so a delta-capable client parses one shape
 * across both modes while an older one parses the shape it always did.
 * @param board - the host face, or undefined when the board is not mounted.
 * @param payload - `{since?}`.
 * @param call - who is asking: its declared capabilities and its delta windows.
 */
function snapshotAnswer(board: BoardFace | undefined, payload: Readonly<Record<string, unknown>>, call: BoardCall): BoardMethodResult {
  if (board === undefined) return unavailable('the task board is not mounted on this host')
  const read = readSnapshot(board)
  if (!read.ok) return read.result
  const snapshot = read.snapshot
  const revision = snapshot.revision
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : undefined
  const whole = (token: string): BoardMethodResult => carried({
    mode: 'reset',
    token,
    snapshot,
    revision,
    ...(tasks === undefined ? {} : { tasks }),
  })
  // Nothing to diff without a window seat, a declared capability, or a task
  // table that can be keyed: the whole board is the answer, and no copy of it is
  // retained because there is no base this answer could be continued from. A
  // connection that already had a base — it declared the capability and then
  // re-helloed without it — has that base dropped here rather than kept for a
  // client that can no longer continue from it.
  const deltas = call.deltas
  if (call.declares?.(CAP_DELTA) !== true || deltas === undefined) {
    deltas?.drop?.(BOARD_DELTA_KEY)
    return whole('')
  }
  if (tasks === undefined || !keyedById(tasks)) return whole('')
  const answer = deltas
    .window<BoardTaskRow>(BOARD_DELTA_KEY, { maxRows: BOARD_DELTA_MAX_ROWS })
    .answer(tasks, sinceOf(payload))
  if (answer.mode === 'reset') return whole(answer.token)
  return carried({ mode: 'delta', token: answer.token, revision, changed: answer.changed, removed: answer.removed })
}

async function optionsAnswer(board: BoardFace | undefined): Promise<BoardMethodResult> {
  if (board === undefined) return unavailable('the task board is not mounted on this host')
  let document: unknown
  try {
    document = await board.modelCatalogOptions()
  } catch (error) {
    return unavailable(`the task board could not resolve its model catalog: ${textOf(error)}`)
  }
  if (!isRecord(document) || !isRecord(document.catalog)) return unavailable('the task board answered no model catalog')
  const read = readSnapshot(board)
  if (!read.ok) return read.result
  const meta: Record<string, unknown> = {}
  for (const key of META_KEYS) {
    const value = read.snapshot[key]
    if (value !== undefined) meta[key] = value
  }
  return carried({ catalog: document.catalog, meta })
}

/**
 * Apply one action through the host's own gates.
 * @param board - the host face, already known to be present.
 * @param requestId - the idempotency key the client minted.
 * @param action - the action, forwarded verbatim.
 */
async function applyOnce(board: BoardFace, requestId: string, action: Readonly<Record<string, unknown>>): Promise<BoardMethodResult> {
  let snapshot: unknown
  try {
    // No initiator: the board documents that field as the id of the DSH session
    // issuing the action, and a phone is not one. Passing a stand-in would put a
    // non-session identity into the execution audit trail and into the workspace
    // inheritance lookup, which reads the field as a session id.
    snapshot = await board.apply(requestId, action)
  } catch (error) {
    // The host refuses by throwing and its text is the whole diagnostic.
    return { ok: false, code: CODE_BOARD_REFUSED, msg: textOf(error) }
  }
  if (!isRecord(snapshot) || typeof snapshot.revision !== 'number') {
    return unavailable('the task board answered no snapshot with a revision')
  }
  return carried({ snapshot, revision: snapshot.revision })
}

async function applyAnswer(
  board: BoardFace | undefined,
  payload: Readonly<Record<string, unknown>>,
  call: BoardCall,
  replay: ReplayLog,
): Promise<BoardMethodResult> {
  const requestId = textField(payload, 'requestId')
  if (requestId === undefined) return invalid('board.apply requires a non-empty requestId')
  const action = payload.action
  if (!isRecord(action)) return invalid('board.apply requires an action object')
  if (board === undefined) return unavailable('the task board is not mounted on this host')
  // The key is scoped to the connection (§12.3): two phones may mint the same
  // requestId, and neither may be answered with the other's result.
  const key = `${call.connectionId}\u0000${requestId}`
  const replayed = replay.get(key)
  if (replayed !== undefined) return await replayed
  const attempt = applyOnce(board, requestId, action)
  replay.set(key, attempt)
  const answer = await attempt
  if (answer.ok !== true && answer.code === CODE_BOARD_UNAVAILABLE) replay.forget(key, attempt)
  return answer
}

/**
 * Build the method table registered on the bridge.
 * @param options - where the host face is read from.
 * @returns the three handlers, keyed by their wire names.
 */
export function createBoardMethods(options: BoardMethodsOptions): Readonly<Record<string, BoardMethodHandler>> {
  const replay = new ReplayLog(REPLAY_LIMIT)
  return {
    [METHOD_BOARD_SNAPSHOT]: (payload, call) => snapshotAnswer(options.board(), payload, call),
    [METHOD_BOARD_OPTIONS]: () => optionsAnswer(options.board()),
    [METHOD_BOARD_APPLY]: (payload, call) => applyAnswer(options.board(), payload, call, replay),
  }
}
