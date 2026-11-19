/**
 * The ledger payload this provider owns on a card.
 *
 * The board stores one opaque payload per extension under
 * `TaskRecord.integrations[SSH_INTEGRATION_KEY]` and refuses anything above
 * 64 KiB. Log bytes never enter it: the payload names the run and the account
 * of what happened, and the log itself stays a remote file read by byte offset.
 * Everything else here exists to keep that promise — the bounding constants,
 * the bounded history, and {@link trimSshLedgerPayload}, which is the one
 * function a writer calls before storing.
 *
 * @module dsh-task-board-ssh/core/ledger
 */
import { TASK_BOARD_PAYLOAD_LIMIT_BYTES } from './contract.ts'
import {
  parseSshRunRecord,
  parseSshTarget,
  type SshRunRecord,
  type SshTarget,
  type SshValidationIssue,
  type SshValidationResult,
} from './target.ts'

/** Key this provider's payload occupies inside `TaskRecord.integrations`. */
export const SSH_INTEGRATION_KEY = 'ssh'

/** Schema version of {@link SshLedgerPayload}; a payload at another version is refused. */
export const SSH_LEDGER_VERSION = 1

/**
 * Budget for one stored payload, in bytes of its JSON serialization. It equals
 * the board's own ceiling and is kept below it: the board refuses a payload
 * that is not strictly under its limit, so trimming targets the same number.
 */
export const SSH_LEDGER_LIMIT_BYTES = TASK_BOARD_PAYLOAD_LIMIT_BYTES

/** How many run records one payload keeps by default. */
export const SSH_HISTORY_LIMIT = 50

/** Longest stored agent summary, in characters. */
export const SSH_SUMMARY_MAX_LENGTH = 512

/** Longest stored failure text, in characters. */
export const SSH_ERROR_MAX_LENGTH = 512

/** Longest stored branch name, in characters. */
export const SSH_BRANCH_MAX_LENGTH = 200

/** Longest stored session id, in characters. */
export const SSH_SESSION_ID_MAX_LENGTH = 200

/**
 * What one card remembers about its remote runs.
 *
 * `activeRun` is the run the card is waiting on; `history` keeps the bounded
 * past, oldest first. Neither carries log bytes.
 */
export interface SshLedgerPayload {
  /** Schema version; a reader that does not know it refuses the payload. */
  version: typeof SSH_LEDGER_VERSION
  /** Instant this payload was last written (ms epoch). */
  updatedAt: number
  /** The target the card pins, absent while the card pins none. */
  target?: SshTarget
  /** The run in flight, absent between runs. */
  activeRun?: SshRunRecord
  /** Bounded run history, oldest first. */
  history: SshRunRecord[]
}

/** What one trimming pass may change. */
export interface SshLedgerTrimOptions {
  /** Byte budget for the serialized result; defaults to {@link SSH_LEDGER_LIMIT_BYTES}. */
  maxBytes?: number
  /** How many history records to keep at most; defaults to {@link SSH_HISTORY_LIMIT}. */
  maxHistory?: number
}

/** Cut text to a character budget without splitting a surrogate pair. */
function boundText(text: string, max: number): string {
  if (text.length <= max) return text
  const characters = Array.from(text)
  if (characters.length <= max) return text
  return characters.slice(0, max).join('')
}

/** Copy one run record with every free-text field cut to its stored budget. */
function boundRun(record: SshRunRecord): SshRunRecord {
  return {
    ...record,
    runId: boundText(record.runId, 128),
    sessionId: record.sessionId === undefined ? undefined : boundText(record.sessionId, SSH_SESSION_ID_MAX_LENGTH),
    branch: record.branch === undefined ? undefined : boundText(record.branch, SSH_BRANCH_MAX_LENGTH),
    summary: record.summary === undefined ? undefined : boundText(record.summary, SSH_SUMMARY_MAX_LENGTH),
    error: record.error === undefined ? undefined : boundText(record.error, SSH_ERROR_MAX_LENGTH),
  }
}

/** Copy one run record with the optional free text removed. */
function stripRunText(record: SshRunRecord): SshRunRecord {
  const stripped: SshRunRecord = {
    runId: record.runId,
    phase: record.phase,
    startedAt: record.startedAt,
  }
  if (record.finishedAt !== undefined) stripped.finishedAt = record.finishedAt
  if (record.exitCode !== undefined) stripped.exitCode = record.exitCode
  if (record.sessionId !== undefined) stripped.sessionId = record.sessionId
  if (record.bytes !== undefined) stripped.bytes = record.bytes
  if (record.followUps !== undefined) stripped.followUps = record.followUps
  return stripped
}

/**
 * Byte length of a payload as the board measures it.
 * @param payload - payload to measure.
 * @returns UTF-8 byte length of its JSON serialization.
 */
export function sshLedgerPayloadBytes(payload: SshLedgerPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).length
}

/**
 * Cut a payload down to the stored budget.
 *
 * The order is fixed and lossy on purpose: free text is bounded first, then the
 * oldest run records go, then the active run's optional text, then the active
 * run itself, and only then the pinned target. A payload therefore always comes
 * back strictly under `maxBytes`, and the newest history — the part a card
 * shows — is the last to be dropped.
 * @param payload - payload to trim; not mutated.
 * @param options - byte budget and history cap.
 * @returns a payload whose serialization is under the budget.
 */
export function trimSshLedgerPayload(payload: SshLedgerPayload, options: SshLedgerTrimOptions = {}): SshLedgerPayload {
  const maxBytes = options.maxBytes ?? SSH_LEDGER_LIMIT_BYTES
  const maxHistory = Math.max(0, options.maxHistory ?? SSH_HISTORY_LIMIT)
  let history = payload.history.map(boundRun)
  if (history.length > maxHistory) history = history.slice(history.length - maxHistory)
  let activeRun = payload.activeRun === undefined ? undefined : boundRun(payload.activeRun)
  let target = payload.target

  const build = (): SshLedgerPayload => {
    const next: SshLedgerPayload = { version: SSH_LEDGER_VERSION, updatedAt: payload.updatedAt, history }
    if (target !== undefined) next.target = target
    if (activeRun !== undefined) next.activeRun = activeRun
    return next
  }

  let candidate = build()
  while (sshLedgerPayloadBytes(candidate) >= maxBytes) {
    if (history.length > 0) {
      history = history.slice(1)
      candidate = build()
      continue
    }
    if (activeRun !== undefined && (activeRun.branch !== undefined || activeRun.summary !== undefined || activeRun.error !== undefined)) {
      activeRun = stripRunText(activeRun)
      candidate = build()
      continue
    }
    if (activeRun !== undefined) {
      activeRun = undefined
      candidate = build()
      continue
    }
    if (target !== undefined) {
      target = undefined
      candidate = build()
      continue
    }
    break
  }
  return candidate
}

/**
 * Parse one stored payload.
 *
 * The container is read strictly (version, timestamp, history array) while a
 * single malformed history entry is dropped alone, the same rule the board
 * applies to integrations: one bad record never takes the card's account with
 * it. Nothing here throws, so a corrupted payload degrades to a readable one.
 * @param value - candidate payload from the ledger or an action.
 * @returns the payload, or every reason it was refused.
 */
export function parseSshLedgerPayload(value: unknown): SshValidationResult<SshLedgerPayload> {
  const errors: SshValidationIssue[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: [{ path: '', message: 'must be an object' }] }
  }
  const record = value as Record<string, unknown>
  if (record.version !== SSH_LEDGER_VERSION) {
    return { ok: false, errors: [{ path: 'version', message: `must be ${SSH_LEDGER_VERSION}` }] }
  }
  if (typeof record.updatedAt !== 'number' || !Number.isFinite(record.updatedAt)) {
    errors.push({ path: 'updatedAt', message: 'must be a finite millisecond timestamp' })
  }
  let target: SshTarget | undefined
  if (record.target !== undefined) {
    const parsed = parseSshTarget(record.target)
    if (parsed.ok) target = parsed.value
    else errors.push(...parsed.errors.map(issue => ({ path: issue.path === '' ? 'target' : `target.${issue.path}`, message: issue.message })))
  }
  let activeRun: SshRunRecord | undefined
  if (record.activeRun !== undefined) {
    const parsed = parseSshRunRecord(record.activeRun)
    if (parsed.ok) activeRun = parsed.value
    else errors.push(...parsed.errors.map(issue => ({ path: issue.path === '' ? 'activeRun' : `activeRun.${issue.path}`, message: issue.message })))
  }
  const history: SshRunRecord[] = []
  if (record.history !== undefined) {
    if (!Array.isArray(record.history)) {
      errors.push({ path: 'history', message: 'must be an array' })
    } else {
      for (const entry of record.history) {
        const parsed = parseSshRunRecord(entry)
        // A dropped entry is not an error of the payload: it is one record the
        // card can no longer account for, and the rest still describes the card.
        if (parsed.ok) history.push(parsed.value)
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  const payload: SshLedgerPayload = { version: SSH_LEDGER_VERSION, updatedAt: record.updatedAt as number, history }
  if (target !== undefined) payload.target = target
  if (activeRun !== undefined) payload.activeRun = activeRun
  return { ok: true, value: payload }
}
