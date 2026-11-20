/**
 * The ledger payload this provider owns on a card.
 *
 * The board stores one opaque payload per extension under
 * `TaskRecord.integrations[SSH_INTEGRATION_KEY]` and refuses anything above
 * 64 KiB. Log bytes never enter it: the payload names the run and the account
 * of what happened, and the log itself stays a remote file read by byte offset.
 * Everything else here exists to keep that promise — the bounding constants,
 * the bounded history, the one instruction a card owes its next run, and
 * {@link trimSshLedgerPayload}, which is the one function a writer calls before
 * storing.
 *
 * @module dsh-task-board-ssh/core/ledger
 */
import { TASK_BOARD_MESSAGE_MAX_LENGTH, TASK_BOARD_PAYLOAD_LIMIT_BYTES } from './contract.ts'
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

/** Longest stored instruction text, in characters; the board's own message ceiling. */
export const SSH_PENDING_TEXT_MAX_LENGTH = TASK_BOARD_MESSAGE_MAX_LENGTH

/** Which entry queued an instruction for the card's next run. */
export type SshPendingKind = 'follow-up' | 'rework'

/**
 * One instruction the card owes a run: the follow-up or rework message that
 * arrived while a run was already in flight.
 *
 * It is stored beside the frozen run account rather than in it, because it is
 * not a record of what happened — it is work still to do. A card carries at most
 * one, and {@link trimSshLedgerPayload} treats it as the last thing it may drop:
 * the account of finished runs can shrink, but a message a person sent is
 * carried until nothing else is left.
 */
export interface SshPendingInstruction {
  /** Which entry asked for it. */
  kind: SshPendingKind
  /** Text the next run's prompt carries, bounded like every board message. */
  text: string
  /** Instant it was queued (ms epoch). */
  queuedAt: number
  /** Session known when it was queued, when the card had one. */
  resumeSessionId?: string
}

/**
 * What one card remembers about its remote runs.
 *
 * `activeRun` is the run the card is waiting on; `history` keeps the bounded
 * past, oldest first; `pending` is the one instruction still owed to a future
 * run. None of them carries log bytes.
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
  /** The one instruction a future run still owes, absent when none is queued. */
  pending?: SshPendingInstruction
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

/** Bound an optional string field, turning empty strings into undefined so `parseSshRunRecord` keeps the record. */
function boundOptionalText(text: string | undefined, max: number): string | undefined {
  if (text === undefined || text.length === 0) return undefined
  return boundText(text, max)
}

/** Copy one run record with every free-text field cut to its stored budget. */
function boundRun(record: SshRunRecord): SshRunRecord {
  const sessionId = boundOptionalText(record.sessionId, SSH_SESSION_ID_MAX_LENGTH)
  const branch = boundOptionalText(record.branch, SSH_BRANCH_MAX_LENGTH)
  const summary = boundOptionalText(record.summary, SSH_SUMMARY_MAX_LENGTH)
  const error = boundOptionalText(record.error, SSH_ERROR_MAX_LENGTH)
  const next: SshRunRecord = {
    runId: boundText(record.runId, 128),
    phase: record.phase,
    startedAt: record.startedAt,
  }
  if (record.finishedAt !== undefined) next.finishedAt = record.finishedAt
  if (record.exitCode !== undefined) next.exitCode = record.exitCode
  if (sessionId !== undefined) next.sessionId = sessionId
  if (record.bytes !== undefined) next.bytes = record.bytes
  if (branch !== undefined) next.branch = branch
  if (summary !== undefined) next.summary = summary
  if (error !== undefined) next.error = error
  if (record.followUps !== undefined) next.followUps = record.followUps
  return next
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

/** Copy one instruction with both free-text fields cut to their stored budget. */
function boundPending(pending: SshPendingInstruction): SshPendingInstruction {
  const bounded: SshPendingInstruction = {
    kind: pending.kind,
    text: boundText(pending.text, SSH_PENDING_TEXT_MAX_LENGTH),
    queuedAt: pending.queuedAt,
  }
  if (pending.resumeSessionId !== undefined) bounded.resumeSessionId = boundText(pending.resumeSessionId, SSH_SESSION_ID_MAX_LENGTH)
  return bounded
}

/** UTF-8 byte length of one JSON value. */
function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/**
 * Byte length of a payload as the board measures it.
 * @param payload - payload to measure.
 * @returns UTF-8 byte length of its JSON serialization.
 */
export function sshLedgerPayloadBytes(payload: SshLedgerPayload): number {
  return jsonBytes(payload)
}

/**
 * Cut a payload down to the stored budget.
 *
 * The order is fixed and lossy on purpose. Free text is bounded first, and the
 * queued instruction's own bytes are reserved before anything else is measured,
 * so a pass that trims history can never be the reason a person's message is
 * lost. What then goes, in this order: the oldest run records, the active run's
 * optional text, the active run itself, the pinned target — and only with
 * nothing else left, the queued instruction. A payload therefore always comes
 * back strictly under `maxBytes`, and the newest history is the last account of
 * the run to be dropped.
 * @param payload - payload to trim; not mutated.
 * @param options - byte budget and history cap.
 * @returns a payload whose serialization is under the budget.
 */
export function trimSshLedgerPayload(payload: SshLedgerPayload, options: SshLedgerTrimOptions = {}): SshLedgerPayload {
  const maxBytes = options.maxBytes ?? SSH_LEDGER_LIMIT_BYTES
  const maxHistory = Math.max(0, options.maxHistory ?? SSH_HISTORY_LIMIT)
  const initialHistory = payload.history.map(boundRun)
  const cappedHistory = initialHistory.length > maxHistory ? initialHistory.slice(initialHistory.length - maxHistory) : initialHistory
  const initialActiveRun = payload.activeRun === undefined ? undefined : boundRun(payload.activeRun)
  const initialTarget = payload.target
  let history = [...cappedHistory]
  let activeRun = initialActiveRun
  let target = initialTarget
  let pending = payload.pending === undefined ? undefined : boundPending(payload.pending)

  const build = (): SshLedgerPayload => {
    const next: SshLedgerPayload = { version: SSH_LEDGER_VERSION, updatedAt: payload.updatedAt, history }
    if (target !== undefined) next.target = target
    if (activeRun !== undefined) next.activeRun = activeRun
    if (pending !== undefined) next.pending = pending
    return next
  }

  /** Reduce the run account until the full payload (including `pending`) fits `budget`. */
  const shrink = (budget: number): SshLedgerPayload => {
    let candidate = build()
    while (jsonBytes(candidate) >= budget) {
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

  // `build()` already includes `pending`, so shrinking directly against
  // `maxBytes` preserves `pending` without double-counting its byte size.
  const candidate = shrink(maxBytes)
  if (jsonBytes(candidate) < maxBytes || pending === undefined) return candidate
  // Even with the entire run account stripped, `pending` alone exceeds the
  // budget: drop `pending`, restore the full run account, and trim it cleanly
  // against the full `maxBytes` budget.
  pending = undefined
  history = [...cappedHistory]
  activeRun = initialActiveRun
  target = initialTarget
  return shrink(maxBytes)
}

/**
 * Read one queued instruction.
 *
 * Host-owned bookkeeping that a card may also have carried across builds, so
 * every field is re-validated and an unknown member makes the instruction
 * unusable: a message this build cannot interpret is not one it may hand an
 * agent. Nothing is trimmed here — the parsers report, the trimmer bounds.
 * @param value - the stored member.
 * @returns the instruction, or undefined when it is absent or unusable.
 */
function parsePendingInstruction(value: unknown): SshPendingInstruction | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const known = new Set(['kind', 'text', 'queuedAt', 'resumeSessionId'])
  if (Object.keys(record).some(key => !known.has(key))) return undefined
  const kind = record.kind === 'follow-up' || record.kind === 'rework' ? record.kind : undefined
  const text = typeof record.text === 'string' && record.text.trim() !== '' && record.text.length <= SSH_PENDING_TEXT_MAX_LENGTH
    ? record.text
    : undefined
  const queuedAt = typeof record.queuedAt === 'number' && Number.isFinite(record.queuedAt) ? record.queuedAt : undefined
  if (kind === undefined || text === undefined || queuedAt === undefined) return undefined
  const pending: SshPendingInstruction = { kind, text, queuedAt }
  if (record.resumeSessionId !== undefined) {
    const sessionId = typeof record.resumeSessionId === 'string' && record.resumeSessionId !== ''
      && record.resumeSessionId.length <= SSH_SESSION_ID_MAX_LENGTH
      ? record.resumeSessionId
      : undefined
    if (sessionId === undefined) return undefined
    pending.resumeSessionId = sessionId
  }
  return pending
}

/**
 * Parse one stored payload.
 *
 * The container is read strictly (version, timestamp, history array) while a
 * single malformed history entry — or an unusable queued instruction — is
 * dropped alone, the same rule the board applies to integrations: one bad member
 * never takes the card's account with it. Nothing here throws, so a corrupted
 * payload degrades to a readable one.
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
  const pending = parsePendingInstruction(record.pending)
  if (pending !== undefined) payload.pending = pending
  return { ok: true, value: payload }
}

/**
 * The payload a create dialog reports for a card that does not exist yet: the
 * target the new card pins, and no run account beside it.
 *
 * A card being created has never run, so the document carries an empty history
 * and no active run or queued instruction — exactly what the host half stores
 * when it pins a target on an existing card, minus the runs. The result is read
 * back through {@link parseSshLedgerPayload} before it is returned: a draft this
 * build could store but not read back is never reported at all, so a card
 * created through a create dialog always opens on a payload its own detail seat
 * can account for.
 * @param target - the target the reader picked, already parsed.
 * @param updatedAt - instant the draft is reported (ms epoch).
 * @returns the payload, or undefined when the document does not parse.
 */
export function composeDraftPayload(target: SshTarget, updatedAt: number): SshLedgerPayload | undefined {
  const draft: SshLedgerPayload = { version: SSH_LEDGER_VERSION, updatedAt, history: [], target }
  return parseSshLedgerPayload(draft).ok ? draft : undefined
}
