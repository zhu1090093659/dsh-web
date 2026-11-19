/**
 * The board's in-process action seat, and the execution facts this package
 * reads off a card.
 *
 * A provider's own writes reach the ledger through exactly what the browser
 * uses: the board service's `apply`, which every gate (running lock, content
 * freeze, permission confirmation, spend cap) still judges. The registration
 * contract this package restates in `src/core/contract.ts` carries the read
 * face only, so the seat is read structurally off the same injected service and
 * refused when the board revision does not serve it — a provider without it
 * still mounts, it just cannot open or close a run.
 *
 * @module dsh-task-board-ssh/host/board
 */
import { TASK_BOARD_SERVICE_NAME, type ServiceLookupSeat } from '../core/contract.ts'
import type { TaskRecord } from '../core/task-record.ts'

/** One action this package submits to the board. Field names are the board's own. */
export type BoardAction =
  | { kind: 'run'; taskId: string }
  | { kind: 'rerun'; taskId: string }
  | {
    kind: 'record-external-outcome'
    taskId: string
    result: 'succeeded' | 'failed'
    initiatedBy: string
    summary?: string
  }

/**
 * The board service's `apply`, as this package drives it.
 *
 * Structurally the board's own: the returned value is the board snapshot, which
 * no caller here reads beyond "the write was accepted", so it stays `unknown`.
 */
export interface BoardActionSeat {
  /** Submit one action; a refusal throws the board's own message. */
  apply(requestId: string, action: BoardAction, initiator?: string): unknown
}

/** Prefix every external execution record this package writes carries. */
export const SSH_INITIATOR_PREFIX = 'ssh:'

/**
 * Read the action seat off the board service face.
 * @param face - the resolved `taskBoard` host service.
 * @returns the seat, or undefined when this board revision serves no applier.
 */
export function readBoardActionSeat(face: unknown): BoardActionSeat | undefined {
  if (typeof face !== 'object' || face === null) return undefined
  const apply = (face as { apply?: unknown }).apply
  if (typeof apply !== 'function') return undefined
  return {
    apply: (requestId: string, action: BoardAction, initiator?: string): unknown =>
      (apply as (this: unknown, a: string, b: BoardAction, c?: string) => unknown).call(face, requestId, action, initiator),
  }
}

/**
 * Resolve the board's action seat off the injected service.
 *
 * The registration contract this package restates carries the read face only, so
 * the applier is read off the same service structurally: the board publishes one
 * object with both, and a revision that serves no applier answers undefined here
 * instead of failing the provider.
 * @param ctx - the injected scope the board service was resolved from.
 * @returns the seat, or undefined when this board revision serves no applier.
 */
export function resolveBoardActionSeat(ctx: ServiceLookupSeat): BoardActionSeat | undefined {
  try {
    return readBoardActionSeat(ctx.get(TASK_BOARD_SERVICE_NAME))
  } catch {
    return undefined
  }
}

/** The `initiatedBy` a board execution record carries, when it recorded one. */
function executionInitiator(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const initiatedBy = (record as { initiatedBy?: unknown }).initiatedBy
  return typeof initiatedBy === 'string' ? initiatedBy : undefined
}

/**
 * Whether the card's execution history already holds the outcome of one run.
 *
 * Reconciliation must close a run that finished while the local host was down
 * exactly once, and a crash between the board write and the payload write would
 * otherwise record it twice: the board appends a fresh external execution for
 * every call, so this package's own marker is the only idempotency key there is.
 * @param task - the card to read.
 * @param runId - the run whose outcome may already be recorded.
 * @returns true when a record this package wrote for `runId` is present.
 */
export function alreadyRecorded(task: TaskRecord, runId: string): boolean {
  const executions: unknown = (task as { executions?: unknown }).executions
  if (!Array.isArray(executions)) return false
  const marker = SSH_INITIATOR_PREFIX + runId
  return executions.some(record => {
    const initiator = executionInitiator(record)
    return initiator !== undefined && initiator.startsWith(marker)
  })
}
