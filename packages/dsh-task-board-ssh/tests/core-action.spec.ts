/**
 * The browser-to-host action protocol. Every case here is malformed input the
 * board's action channel can genuinely deliver, and every one must come back as
 * a diagnostic that names the field instead of an exception that would take the
 * channel down with it.
 */
import { describe, expect, it } from 'vitest'
import { parseSshActionRequest, SSH_ACTION_NAMES, SSH_EXTENSION_ID } from '../src/core/action.ts'

/** A target the set-target cases send. */
const target = {
  mode: 'direct',
  host: 'build-box',
  agent: { kind: 'dsh' },
  workspace: { kind: 'in-place', path: '/srv/work/repo' },
} as const

describe('action request parsing', () => {
  it('operator running, cancelling, following up, sending back, retargeting and refreshing all parse', () => {
    // Given one envelope per action the surface offers
    const envelopes = [
      { extensionId: SSH_EXTENSION_ID, action: 'run', taskId: 'task-1' },
      { extensionId: SSH_EXTENSION_ID, action: 'cancel', taskId: 'task-1' },
      { extensionId: SSH_EXTENSION_ID, action: 'follow-up', taskId: 'task-1', payload: { text: 'please also run the linter' } },
      { extensionId: SSH_EXTENSION_ID, action: 'rework', taskId: 'task-1', payload: { instructions: 'the tests do not pass' } },
      { extensionId: SSH_EXTENSION_ID, action: 'set-target', taskId: 'task-1', payload: { target } },
      { extensionId: SSH_EXTENSION_ID, action: 'refresh' },
    ]

    // When each is parsed
    const parsed = envelopes.map(parseSshActionRequest)

    // Then each becomes the request the host half dispatches on
    expect(parsed).toEqual([
      { ok: true, value: { action: 'run', taskId: 'task-1' } },
      { ok: true, value: { action: 'cancel', taskId: 'task-1' } },
      { ok: true, value: { action: 'follow-up', taskId: 'task-1', text: 'please also run the linter' } },
      { ok: true, value: { action: 'rework', taskId: 'task-1', instructions: 'the tests do not pass' } },
      { ok: true, value: { action: 'set-target', taskId: 'task-1', target } },
      { ok: true, value: { action: 'refresh' } },
    ])
  })

  it('operator refreshing one specific run of a card gets the run id carried through', () => {
    // Given a refresh naming both the card and one of its runs
    const envelope = { extensionId: SSH_EXTENSION_ID, action: 'refresh', taskId: 'task-1', payload: { runId: 'run-20261119-0007' } }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then both ids reach the host half
    expect(parsed).toEqual({ ok: true, value: { action: 'refresh', taskId: 'task-1', runId: 'run-20261119-0007' } })
  })

  it('operator sending an action for another extension is told which extension this provider is', () => {
    // Given an envelope addressed elsewhere
    const envelope = { extensionId: 'github', action: 'run', taskId: 'task-1' }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then both the extension and the action are unknown
    expect(parsed).toEqual({ ok: false, errors: [{ path: 'extensionId', message: 'must be "ssh"' }] })
  })

  it('operator sending an action name the host does not serve is told the ones it does', () => {
    // Given an envelope with an invented action
    const envelope = { extensionId: SSH_EXTENSION_ID, action: 'deploy', taskId: 'task-1' }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then the refusal lists every served action
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'action', message: 'must be one of: ' + SSH_ACTION_NAMES.join(', ') }],
    })
  })

  it('operator running a card without naming it is told the card id is required', () => {
    // Given an envelope with no task id
    const envelope = { extensionId: SSH_EXTENSION_ID, action: 'run' }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then the refusal names the field
    expect(parsed).toEqual({ ok: false, errors: [{ path: 'taskId', message: 'is required' }] })
  })

  it('operator pasting a follow-up longer than the board allows is told the limit', () => {
    // Given a message past the board's message ceiling
    const envelope = {
      extensionId: SSH_EXTENSION_ID,
      action: 'follow-up',
      taskId: 'task-1',
      payload: { text: 'x'.repeat(4_001) },
    }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then the refusal names the field and the ceiling
    expect(parsed).toEqual({ ok: false, errors: [{ path: 'payload.text', message: 'must be at most 4000 characters' }] })
  })

  it('operator sending a broken target is told which part of the target is broken', () => {
    // Given a target whose host is not an alias
    const envelope = {
      extensionId: SSH_EXTENSION_ID,
      action: 'set-target',
      taskId: 'task-1',
      payload: { target: { ...target, host: 'build box' } },
    }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then the path runs through the payload and the target
    expect(parsed.ok).toBe(false)
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'payload.target.host', message: 'must be a dshSsh host alias (letters, digits, dots, hyphens, underscores)' }],
    })
  })

  it('operator sending fields the envelope does not define is told each of them', () => {
    // Given an envelope with an unknown top-level field and an unknown payload field
    const envelope = {
      extensionId: SSH_EXTENSION_ID,
      action: 'cancel',
      taskId: 'task-1',
      taskID: 'typo',
      payload: { reason: 'user asked' },
    }

    // When it is parsed
    const parsed = parseSshActionRequest(envelope)

    // Then both unknown fields are reported with their paths
    expect(parsed).toEqual({
      ok: false,
      errors: [
        { path: 'taskID', message: 'unknown field (accepted: extensionId, action, taskId, payload)' },
        { path: 'payload.reason', message: 'unknown field (accepted: )' },
      ],
    })
  })

  it('operator sending nothing at all gets a diagnostic instead of an exception', () => {
    // Given values that are not envelopes
    const malformed = [null, 42, [], 'run', true]

    // When each is parsed
    const parsed = malformed.map(parseSshActionRequest)

    // Then each is refused with the same reason and none of them threw
    expect(parsed).toEqual(malformed.map(() => ({ ok: false, errors: [{ path: '', message: 'must be an object' }] })))
  })
})
