/**
 * The pinned execution target and the run record are parsed from untrusted
 * input, so every spec here is about what is refused and how the refusal names
 * the field a person has to fix.
 */
import { describe, expect, it } from 'vitest'
import { isTerminalRunPhase, parseSshRunRecord, parseSshTarget } from '../src/core/target.ts'

/** A minimal valid target the cases start from. */
const inPlaceTarget = {
  mode: 'direct',
  host: 'build-box',
  agent: { kind: 'claude' },
  workspace: { kind: 'in-place', path: '/srv/work/repo' },
} as const

describe('execution target parsing', () => {
  it('operator pinning an in-place direct target gets it accepted unchanged', () => {
    // Given a complete target
    // When it is parsed
    const parsed = parseSshTarget(inPlaceTarget)

    // Then the parsed value is the same target
    expect(parsed).toEqual({ ok: true, value: inPlaceTarget })
  })

  it('operator pinning a git target from a repository URL gets it accepted', () => {
    // Given a git workspace whose repository the host can reach itself
    const target = {
      mode: 'direct',
      host: 'build-box',
      agent: { kind: 'dsh' },
      workspace: { kind: 'git', source: { kind: 'url', url: 'git@example.com:team/repo.git', base: 'main' } },
    }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the source survives with its base branch
    expect(parsed).toEqual({ ok: true, value: target })
  })

  it('operator pinning a git target from the local workspace gets it accepted', () => {
    // Given a git workspace built from a local workspace repository
    const target = {
      mode: 'proxy',
      host: 'edge_1',
      agent: { kind: 'codex' },
      workspace: { kind: 'git', source: { kind: 'workspace', workspaceId: 'ws-42' } },
    }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then proxy mode and the workspace source both survive
    expect(parsed).toEqual({ ok: true, value: target })
  })

  it('operator writing a field name wrongly is told which field was not understood', () => {
    // Given a target with a misspelled top-level field
    const target = { ...inPlaceTarget, workspac: { kind: 'in-place', path: '/srv' } }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the diagnostic names that field
    expect(parsed.ok).toBe(false)
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'workspac', message: 'unknown field (accepted: mode, host, agent, workspace)' }],
    })
  })

  it('operator pinning a relative work directory is told it must be absolute', () => {
    // Given an in-place path that is not absolute
    const target = { ...inPlaceTarget, workspace: { kind: 'in-place', path: 'work/repo' } }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the refusal points at that path
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'workspace.path', message: 'must be an absolute remote path' }],
    })
  })

  it('operator naming a host that is not an alias is told so', () => {
    // Given a host name with a space in it
    const target = { ...inPlaceTarget, host: 'build box' }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the refusal names the host field
    expect(parsed.ok).toBe(false)
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'host', message: 'must be a dshSsh host alias (letters, digits, dots, hyphens, underscores)' }],
    })
  })

  it('operator configuring a custom agent without a prompt placeholder is told what is missing', () => {
    // Given a custom agent command that never mentions the prompt
    const target = { ...inPlaceTarget, agent: { kind: 'custom', command: 'myagent --dir {cwd}' } }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the refusal says which placeholder is required
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'agent.command', message: 'the start template must reference {prompt_file}' }],
    })
  })

  it('operator attaching a command template to a built-in agent is refused', () => {
    // Given a built-in agent kind that carries a template anyway
    const target = { ...inPlaceTarget, agent: { kind: 'dsh', command: 'dsh --json' } }

    // When it is parsed
    const parsed = parseSshTarget(target)

    // Then the refusal explains where templates belong
    expect(parsed).toEqual({ ok: false, errors: [{ path: 'agent', message: 'command templates apply to kind "custom" only' }] })
  })

  it('operator handing over something that is not a target gets a diagnostic instead of an exception', () => {
    // Given values that are not objects at all
    const malformed = [null, 42, 'direct', [], true]

    // When each is parsed
    const parsed = malformed.map(parseSshTarget)

    // Then each is refused with the same first reason
    expect(parsed.map(result => result.ok)).toEqual(malformed.map(() => false))
    expect(parsed.map(result => (result.ok ? [] : result.errors[0].path))).toEqual(malformed.map(() => ''))
  })
})

describe('run record parsing', () => {
  it('operator reading a settled run gets its phase, exit code and session back', () => {
    // Given a complete run record
    const record = {
      runId: 'run-20261119-01',
      phase: 'succeeded',
      startedAt: 1_700_000_000_000,
      finishedAt: 1_700_000_060_000,
      exitCode: 0,
      sessionId: 'session-4c3bb987',
      bytes: 4_096,
      summary: 'pong',
    }

    // When it is parsed
    const parsed = parseSshRunRecord(record)

    // Then the record comes back intact
    expect(parsed).toEqual({ ok: true, value: record })
  })

  it('operator reading a record with an invented phase is told the allowed phases', () => {
    // Given a phase outside the vocabulary
    const record = { runId: 'run-1', phase: 'zombie', startedAt: 1 }

    // When it is parsed
    const parsed = parseSshRunRecord(record)

    // Then the diagnostic lists the phases
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'phase', message: 'must be one of: queued, running, succeeded, failed, cancelled, lost' }],
    })
  })

  it('operator reading a record whose id is a path is refused', () => {
    // Given a run id that would escape its directory
    const record = { runId: '../../etc/passwd', phase: 'running', startedAt: 1 }

    // When it is parsed
    const parsed = parseSshRunRecord(record)

    // Then the id is refused before it can become a path
    expect(parsed.ok).toBe(false)
    expect(parsed).toEqual({
      ok: false,
      errors: [{ path: 'runId', message: 'must be 1-128 characters of letters, digits, dots, underscores or hyphens' }],
    })
  })

  it('operator asking whether a phase is terminal gets the answer the ledger relies on', () => {
    // Given every phase the vocabulary holds
    const phases = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'lost'] as const

    // When each is classified
    const terminal = phases.map(isTerminalRunPhase)

    // Then only the settled ones are terminal
    expect(terminal).toEqual([false, false, true, true, true, true])
  })
})
