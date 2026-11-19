/**
 * The host half's own reading of the payload it stores on a card.
 *
 * `src/core/ledger.ts` owns the frozen wire schema: the target pin, the active
 * run and the bounded history, all of it re-parsed from `unknown` because the
 * board hands back whatever was stored. This module adds the two things only
 * the host half knows — an instruction waiting for the run that will carry it,
 * and the write that keeps the whole document under the board's 64 KiB ceiling —
 * without changing a byte of that schema: the extra member travels beside it and
 * is tolerated by the frozen parser, which refuses unknown containers but not
 * unknown members inside one.
 *
 * @module dsh-task-board-ssh/host/payload
 */
import { TASK_BOARD_MESSAGE_MAX_LENGTH } from '../core/contract.ts'
import {
  SSH_INTEGRATION_KEY,
  SSH_LEDGER_LIMIT_BYTES,
  SSH_LEDGER_VERSION,
  parseSshLedgerPayload,
  trimSshLedgerPayload,
} from '../core/ledger.ts'
import { isTerminalRunPhase, type SshRunRecord, type SshTarget } from '../core/target.ts'

export { SSH_INTEGRATION_KEY }

/** How many settled runs one card keeps here, oldest dropped first. */
export const HOST_HISTORY_LIMIT = 20

/** Bytes reserved for the container around one instruction, in the store budget. */
const PENDING_OVERHEAD_BYTES = 256

/** An instruction the card owes a run, queued behind the run already in flight. */
export interface SshPendingInstruction {
  /** Which entry asked for it; a follow-up continues the session, a rework redoes the work. */
  kind: 'follow-up' | 'rework'
  /** Text the next run's prompt carries. */
  text: string
  /** Instant it was queued (ms epoch). */
  queuedAt: number
  /** Session known when it was queued, when one was. */
  resumeSessionId?: string
}

/** One card's payload, as the host half reads and writes it. */
export interface HostSshPayload {
  /** Instant this payload was last written (ms epoch). */
  updatedAt: number
  /** The target the card pins. */
  target?: SshTarget
  /** The run the card is waiting on. */
  activeRun?: SshRunRecord
  /** Bounded past runs, oldest first. */
  history: SshRunRecord[]
  /** An instruction waiting for the run that will carry it. */
  pending?: SshPendingInstruction
}

/** Whether a value is a plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Read one queued instruction out of a stored payload.
 *
 * Host-owned bookkeeping, so every field is re-validated: a payload that arrived
 * from an older build, a hand edit or another process must not be able to hand
 * the engine a blank instruction or an unbounded one.
 * @param value - the stored member.
 * @returns the instruction, or undefined when it is absent or unusable.
 */
function readPendingInstruction(value: unknown): SshPendingInstruction | undefined {
  if (!isPlainObject(value)) return undefined
  const kind = value.kind === 'rework' ? 'rework' : value.kind === 'follow-up' ? 'follow-up' : undefined
  const text = typeof value.text === 'string' ? value.text : undefined
  const queuedAt = typeof value.queuedAt === 'number' && Number.isFinite(value.queuedAt) ? value.queuedAt : undefined
  if (kind === undefined || text === undefined || queuedAt === undefined) return undefined
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > TASK_BOARD_MESSAGE_MAX_LENGTH) return undefined
  const resumeSessionId = typeof value.resumeSessionId === 'string' && value.resumeSessionId !== ''
    ? value.resumeSessionId
    : undefined
  return {
    kind,
    text: trimmed,
    queuedAt,
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
  }
}

/**
 * Parse one stored payload into what the host half works with.
 * @param raw - the card's `integrations.ssh` value, or undefined when it carries none.
 * @returns the payload, or undefined when the card carries none this build understands.
 */
export function readHostPayload(raw: unknown): HostSshPayload | undefined {
  const frozen = parseSshLedgerPayload(raw)
  if (!frozen.ok) return undefined
  const payload: HostSshPayload = {
    updatedAt: frozen.value.updatedAt,
    history: [...frozen.value.history],
  }
  if (frozen.value.target !== undefined) payload.target = frozen.value.target
  if (frozen.value.activeRun !== undefined) payload.activeRun = frozen.value.activeRun
  if (isPlainObject(raw)) {
    const pending = readPendingInstruction(raw.pending)
    if (pending !== undefined) payload.pending = pending
  }
  return payload
}

/**
 * Serialize one payload for storage, keeping it strictly under the board's ceiling.
 *
 * The frozen part is trimmed first with the instruction's own bytes already
 * subtracted from the budget, so the store can drop the oldest history without
 * ever having to drop the instruction a person is waiting on.
 * @param next - the payload to store.
 * @param now - clock instant written into the document (ms epoch).
 * @returns the board-ready extension payload.
 */
export function writeHostPayload(next: HostSshPayload, now: number): Record<string, unknown> {
  const pendingBytes = next.pending === undefined
    ? 0
    : new TextEncoder().encode(JSON.stringify({ pending: next.pending })).length + PENDING_OVERHEAD_BYTES
  const trimmed = trimSshLedgerPayload({
    version: SSH_LEDGER_VERSION,
    updatedAt: now,
    ...(next.target === undefined ? {} : { target: next.target }),
    ...(next.activeRun === undefined ? {} : { activeRun: next.activeRun }),
    history: next.history,
  }, {
    maxBytes: Math.max(1_024, SSH_LEDGER_LIMIT_BYTES - pendingBytes),
    maxHistory: HOST_HISTORY_LIMIT,
  })
  const wire: Record<string, unknown> = { ...trimmed }
  // The board merges a written payload into the stored one key by key, so a
  // member this write clears has to be present as an explicit undefined (the
  // board deletes such a key, and JSON drops it on the way to disk).
  wire.target = next.target
  wire.activeRun = next.activeRun
  wire.pending = next.pending
  return wire
}

/**
 * The same payload carrying one run as the run in flight.
 * @param payload - the current payload.
 * @param run - the run to carry.
 * @returns the next payload.
 */
export function withActiveRun(payload: HostSshPayload, run: SshRunRecord): HostSshPayload {
  const next: HostSshPayload = { ...payload, updatedAt: payload.updatedAt, activeRun: run, history: [...payload.history] }
  return next
}

/**
 * The same payload with one run settled into the bounded history.
 * @param payload - the current payload.
 * @param run - the settled run.
 * @returns the next payload, the active run cleared.
 */
export function withSettledRun(payload: HostSshPayload, run: SshRunRecord): HostSshPayload {
  const history = [...payload.history.filter(record => record.runId !== run.runId), run]
  const next: HostSshPayload = {
    updatedAt: payload.updatedAt,
    history: history.slice(Math.max(0, history.length - HOST_HISTORY_LIMIT)),
  }
  if (payload.target !== undefined) next.target = payload.target
  if (payload.pending !== undefined) next.pending = payload.pending
  if (payload.activeRun !== undefined && payload.activeRun.runId !== run.runId) next.activeRun = payload.activeRun
  return next
}

/**
 * The most recent session this card's runs recorded, which is the one a
 * follow-up would continue.
 * @param payload - the payload to read.
 * @returns the session id, or undefined when no run of this card reported one.
 */
export function latestSessionId(payload: HostSshPayload): string | undefined {
  const candidates = [...payload.history, ...(payload.activeRun === undefined ? [] : [payload.activeRun])]
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const sessionId = candidates[index]?.sessionId
    if (sessionId !== undefined && sessionId !== '') return sessionId
  }
  return undefined
}

/**
 * The run a card is waiting on, when it is still in a phase that schedules work.
 * @param payload - the payload to read.
 * @returns the live run, or undefined when the card waits on nothing.
 */
export function liveRunOf(payload: HostSshPayload): SshRunRecord | undefined {
  const run = payload.activeRun
  if (run === undefined) return undefined
  return isTerminalRunPhase(run.phase) ? undefined : run
}
