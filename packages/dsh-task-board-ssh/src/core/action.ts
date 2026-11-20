/**
 * The action protocol between this provider's browser half and its host half.
 *
 * The browser never calls the host directly: it hands an envelope to the
 * board's same-origin `dispatch`, the board forwards it as
 * `{ extensionId, action, taskId?, payload? }`, and this module turns that
 * untrusted envelope into a typed request. Everything arrives from outside the
 * process, so parsing reports every problem with its path instead of throwing;
 * a malformed action must never become an exception in the board's channel.
 *
 * @module dsh-task-board-ssh/core/action
 */
import { TASK_BOARD_MESSAGE_MAX_LENGTH } from './contract.ts'
import { parseSshTarget, type SshTarget, type SshValidationIssue, type SshValidationResult } from './target.ts'

/** Extension id the board routes this provider's actions under. */
export const SSH_EXTENSION_ID = 'ssh'

/** Every action this provider accepts, in the order the card surface offers them. */
export const SSH_ACTION_NAMES = ['run', 'cancel', 'follow-up', 'rework', 'set-target', 'refresh'] as const

/** One action name. */
export type SshActionName = (typeof SSH_ACTION_NAMES)[number]

/** Start the pinned card's remote run now. */
export interface SshRunActionRequest {
  /** Action discriminator. */
  action: 'run'
  /** Card to run. */
  taskId: string
}

/** Stop the card's active remote run through the launcher's cancel verb. */
export interface SshCancelActionRequest {
  /** Action discriminator. */
  action: 'cancel'
  /** Card whose run to stop. */
  taskId: string
}

/** Deliver one follow-up user message into the card's remote agent session. */
export interface SshFollowUpActionRequest {
  /** Action discriminator. */
  action: 'follow-up'
  /** Card whose session receives the message. */
  taskId: string
  /** Message text, bounded like every board message. */
  text: string
}

/** Send the card back with rework instructions, in the same remote session. */
export interface SshReworkActionRequest {
  /** Action discriminator. */
  action: 'rework'
  /** Card to send back. */
  taskId: string
  /** Rework instructions, bounded like every board message. */
  instructions: string
}

/** Pin or replace the card's execution target. */
export interface SshSetTargetActionRequest {
  /** Action discriminator. */
  action: 'set-target'
  /** Card to retarget. */
  taskId: string
  /** The target to pin. */
  target: SshTarget
}

/** Re-read a run's remote state (the card's poll bypass, and the settings probe). */
export interface SshRefreshActionRequest {
  /** Action discriminator. */
  action: 'refresh'
  /** Card to refresh, or omitted to refresh every targeted card. */
  taskId?: string
  /** One run of that card to re-read, or omitted to re-read whatever is active. */
  runId?: string
  /** Byte offset to replay the run's log from (defaults to 0). */
  offset?: number
}

/** One request this provider's host half accepts. */
export type SshActionRequest =
  | SshRunActionRequest
  | SshCancelActionRequest
  | SshFollowUpActionRequest
  | SshReworkActionRequest
  | SshSetTargetActionRequest
  | SshRefreshActionRequest

/** A successful reply, as the browser half reads it. */
export interface SshActionReplyOk {
  /** Discriminator. */
  ok: true
  /** Card the reply is about, when it is about one. */
  taskId?: string
  /** Run the reply is about, when it is about one. */
  runId?: string
  /** One sentence the card shows next to the run state. */
  message?: string
}

/** A refused reply; `issues` carries the field diagnostics when there are any. */
export interface SshActionReplyFailure {
  /** Discriminator. */
  ok: false
  /** One sentence a person can act on. */
  error: string
  /** Field-level diagnostics, when the refusal came from a malformed request. */
  issues?: readonly SshValidationIssue[]
}

/** What an action returns; never a throw, so the browser always has a value. */
export type SshActionReply = SshActionReplyOk | SshActionReplyFailure

/** Longest accepted id (task or run), in characters. */
const ID_MAX_LENGTH = 128

/** Collects diagnostics while one envelope is parsed. */
class ActionIssues {
  readonly errors: SshValidationIssue[] = []
  add(path: string, message: string): void {
    this.errors.push({ path, message })
  }
}

/** Whether a value is a plain object (not an array, not null, no exotic prototype). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Join one path segment onto a parent path. */
function pathOf(parent: string, key: string | number): string {
  return parent === '' ? String(key) : `${parent}.${String(key)}`
}

/** Read one bounded identifier. */
function readId(value: unknown, path: string, issues: ActionIssues, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) issues.add(path, 'is required')
    return undefined
  }
  if (typeof value !== 'string') {
    issues.add(path, 'must be a string')
    return undefined
  }
  const text = value.trim()
  if (text.length === 0) {
    issues.add(path, 'must not be empty')
    return undefined
  }
  if (text.length > ID_MAX_LENGTH) {
    issues.add(path, `must be at most ${ID_MAX_LENGTH} characters`)
    return undefined
  }
  if (/\s/.test(text)) {
    issues.add(path, 'must not contain whitespace')
    return undefined
  }
  return text
}

/** Read one bounded free-text message. */
function readMessage(value: unknown, path: string, issues: ActionIssues): string | undefined {
  if (typeof value !== 'string') {
    issues.add(path, 'must be a string')
    return undefined
  }
  if (value.trim().length === 0) {
    issues.add(path, 'must not be empty')
    return undefined
  }
  if (value.length > TASK_BOARD_MESSAGE_MAX_LENGTH) {
    issues.add(path, `must be at most ${TASK_BOARD_MESSAGE_MAX_LENGTH} characters`)
    return undefined
  }
  return value
}

/** Refuse keys the action's payload does not define. */
function rejectUnknownPayloadKeys(payload: Record<string, unknown>, allowed: readonly string[], issues: ActionIssues): void {
  for (const key of Object.keys(payload)) {
    if (!allowed.includes(key)) issues.add(pathOf('payload', key), `unknown field (accepted: ${allowed.join(', ')})`)
  }
}

/**
 * Parse one dispatched envelope.
 * @param value - candidate request as the board forwards it.
 * @returns the typed request, or every reason it was refused.
 */
export function parseSshActionRequest(value: unknown): SshValidationResult<SshActionRequest> {
  const issues = new ActionIssues()
  if (!isPlainObject(value)) return { ok: false, errors: [{ path: '', message: 'must be an object' }] }
  for (const key of Object.keys(value)) {
    if (!['extensionId', 'action', 'taskId', 'payload'].includes(key)) {
      issues.add(key, `unknown field (accepted: extensionId, action, taskId, payload)`)
    }
  }
  if (value.extensionId !== SSH_EXTENSION_ID) {
    issues.add('extensionId', `must be "${SSH_EXTENSION_ID}"`)
  }
  const action = typeof value.action === 'string' && (SSH_ACTION_NAMES as readonly string[]).includes(value.action)
    ? (value.action as SshActionName)
    : undefined
  if (action === undefined) {
    issues.add('action', `must be one of: ${SSH_ACTION_NAMES.join(', ')}`)
    return { ok: false, errors: issues.errors }
  }
  const payload = value.payload === undefined ? {} : value.payload
  if (!isPlainObject(payload)) {
    issues.add('payload', 'must be an object')
    return { ok: false, errors: issues.errors }
  }
  const taskId = readId(value.taskId, 'taskId', issues, action !== 'refresh')

  switch (action) {
    case 'run':
    case 'cancel': {
      rejectUnknownPayloadKeys(payload, [], issues)
      if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
      return { ok: true, value: { action, taskId: taskId as string } }
    }
    case 'follow-up': {
      rejectUnknownPayloadKeys(payload, ['text'], issues)
      const text = readMessage(payload.text, 'payload.text', issues)
      if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
      return { ok: true, value: { action, taskId: taskId as string, text: text as string } }
    }
    case 'rework': {
      rejectUnknownPayloadKeys(payload, ['instructions'], issues)
      const instructions = readMessage(payload.instructions, 'payload.instructions', issues)
      if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
      return { ok: true, value: { action, taskId: taskId as string, instructions: instructions as string } }
    }
    case 'set-target': {
      rejectUnknownPayloadKeys(payload, ['target'], issues)
      const parsed = parseSshTarget(payload.target)
      if (!parsed.ok) {
        for (const issue of parsed.errors) {
          issues.add(issue.path === '' ? 'payload.target' : pathOf('payload.target', issue.path), issue.message)
        }
      }
      if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
      if (!parsed.ok) return { ok: false, errors: issues.errors }
      return { ok: true, value: { action, taskId: taskId as string, target: parsed.value } }
    }
    default: {
      rejectUnknownPayloadKeys(payload, ['runId', 'offset'], issues)
      const runId = readId(payload.runId, 'payload.runId', issues, false)
      let offset: number | undefined
      if (payload.offset !== undefined) {
        if (typeof payload.offset !== 'number' || !Number.isInteger(payload.offset) || payload.offset < 0) {
          issues.add('payload.offset', 'must be a non-negative integer')
        } else {
          offset = payload.offset
        }
      }
      if (issues.errors.length > 0) return { ok: false, errors: issues.errors }
      const refresh: SshRefreshActionRequest = { action: 'refresh' }
      if (taskId !== undefined) refresh.taskId = taskId
      if (runId !== undefined) refresh.runId = runId
      if (offset !== undefined) refresh.offset = offset
      return { ok: true, value: refresh }
    }
  }
}
