/**
 * The host half's reading of the payload it stores on a card.
 *
 * The schema itself belongs to `src/core/ledger.ts` — the target pin, the active
 * run, the bounded history and the one instruction a future run still owes — and
 * the host half adds no member of its own to it. What this module owns is the
 * write: it stamps the document, keeps it under the board's 64 KiB ceiling and
 * makes every member it clears explicit, because the board merges a written
 * payload into the stored one key by key.
 *
 * @module dsh-task-board-ssh/host/payload
 */
import {
  SSH_INTEGRATION_KEY,
  SSH_LEDGER_VERSION,
  parseSshLedgerPayload,
  trimSshLedgerPayload,
  type SshLedgerPayload,
} from '../core/ledger.ts'
import { isTerminalRunPhase, type SshRunRecord } from '../core/target.ts'

export { SSH_INTEGRATION_KEY }
export type { SshPendingInstruction } from '../core/ledger.ts'

/** How many settled runs one card keeps here, oldest dropped first. */
export const HOST_HISTORY_LIMIT = 20

/** One card's payload: exactly the frozen document, with nothing added beside it. */
export type HostSshPayload = Omit<SshLedgerPayload, 'version'>

/**
 * Parse one stored payload into what the host half works with.
 * @param raw - the card's `integrations.ssh` value, or undefined when it carries none.
 * @returns the payload, or undefined when the card carries none this build understands.
 */
export function readHostPayload(raw: unknown): HostSshPayload | undefined {
  const frozen = parseSshLedgerPayload(raw)
  if (!frozen.ok) return undefined
  const { version: _version, ...payload } = frozen.value
  return { ...payload, history: [...payload.history] }
}

/**
 * Serialize one payload for storage, keeping it strictly under the board's ceiling.
 *
 * The frozen trimmer does the budgeting, including the room it reserves for a
 * queued instruction, so the store may drop the oldest history and never the
 * message a person is waiting on.
 * @param next - the payload to store.
 * @param now - clock instant written into the document (ms epoch).
 * @returns the board-ready extension payload.
 */
export function writeHostPayload(next: HostSshPayload, now: number): Record<string, unknown> {
  const trimmed = trimSshLedgerPayload({ ...next, version: SSH_LEDGER_VERSION, updatedAt: now }, {
    maxHistory: HOST_HISTORY_LIMIT,
  })
  // The board merges a written payload into the stored one key by key, so a
  // member this write clears has to be present as an explicit undefined (the
  // board deletes such a key, and JSON drops it on the way to disk).
  return {
    ...trimmed,
    target: trimmed.target,
    activeRun: trimmed.activeRun,
    pending: trimmed.pending,
  }
}

/**
 * The same payload carrying one run as the run in flight.
 * @param payload - the current payload.
 * @param run - the run to carry.
 * @returns the next payload.
 */
export function withActiveRun(payload: HostSshPayload, run: SshRunRecord): HostSshPayload {
  return { ...payload, activeRun: run, history: [...payload.history] }
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
    ...payload,
    history: history.slice(Math.max(0, history.length - HOST_HISTORY_LIMIT)),
  }
  delete next.activeRun
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
