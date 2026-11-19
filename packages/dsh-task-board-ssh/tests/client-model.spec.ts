/**
 * What a card's SSH payload means, and what the chip on its card says.
 *
 * The reader, the phase derivation and the form's draft round-trip are the parts
 * the badge and the detail section are built on, so they are pinned here without
 * a DOM: an untargeted card has no view at all, every phase maps to its own
 * chip, and a hostile payload costs one field rather than the card's account.
 */
import { describe, expect, it } from 'vitest'
import {
  draftOf,
  draftToTarget,
  isSshRunActive,
  isSshTargeted,
  readSshLedger,
  sshCardView,
  targetSummaryParts,
  validateDraft,
  type SshTargetDraft,
} from '../src/client/ssh/model.ts'
import type { SshTarget } from '../src/core/target.ts'
import type { TaskRecord } from '../src/core/task-record.ts'

/** A card carrying whatever integrations the case needs. */
function card(integrations?: Record<string, unknown>): TaskRecord {
  return {
    id: 'task-1',
    title: 'A card',
    description: '',
    prompt: 'do it',
    status: 'todo',
    createdAt: 1,
    updatedAt: 1,
    executions: [],
    ...(integrations === undefined ? {} : { integrations }),
  }
}

/** A pinned direct-mode target on one host. */
const TARGET: SshTarget = {
  mode: 'direct',
  host: 'devbox',
  agent: { kind: 'dsh' },
  workspace: { kind: 'in-place', path: '/srv/app' },
}

/** A payload version 1 carrying the pieces a case needs. */
function payload(parts: Record<string, unknown>): Record<string, unknown> {
  return { version: 1, updatedAt: 10, history: [], ...parts }
}

/** One run record at a phase. */
function run(runId: string, phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { runId, phase, startedAt: 5, ...extra }
}

describe('reading a card payload', () => {
  it('user viewing a card whose payload belongs to another provider gets no target and no chip', () => {
    // Given a card whose integrations carry another provider only
    const task = card({ github: { issueNumber: 7 } })

    // When the badge and the section ask what it pins
    const view = sshCardView(task)

    // Then nothing is claimed: no target, idle phase, and no chip
    expect(view.target).toBeUndefined()
    expect(view.phase).toBe('idle')
    expect(isSshTargeted(task)).toBe(false)
    expect(readSshLedger(task)).toBeUndefined()
  })

  it('user viewing a card with one unreadable run still gets the target and the readable history', () => {
    // Given a payload whose active run is malformed but whose target is fine
    const task = card({ ssh: payload({ target: TARGET, activeRun: { runId: 'bad id!', phase: 'running' } }) })

    // When the section derives its view
    const view = sshCardView(task)

    // Then the target still stands and the card reads as finished history
    expect(view.target).toEqual(TARGET)
    expect(view.activeRun).toBeUndefined()
    expect(view.phase).toBe('idle')
  })

  it('operator reading a payload from a newer version sees an untargeted card instead of a guess', () => {
    // Given a payload from a future version
    const task = card({ ssh: payload({ version: 2, target: TARGET }) })

    // When it is read
    const view = sshCardView(task)

    // Then the card reads as untargeted rather than being guessed at
    expect(view.target).toBeUndefined()
    expect(view.phase).toBe('idle')
  })
})

describe('run phase on the card and in the section', () => {
  it('user reading a card in each phase sees that phase, and only two of them count as active', () => {
    // Given one card per phase
    const cases: Array<{ phase: string, parts: Record<string, unknown> }> = [
      { phase: 'queued', parts: { activeRun: run('r1', 'queued') } },
      { phase: 'running', parts: { activeRun: run('r1', 'running', { bytes: 40 }) } },
      { phase: 'succeeded', parts: { history: [run('r1', 'succeeded', { exitCode: 0 })] } },
      { phase: 'failed', parts: { history: [run('r1', 'failed', { exitCode: 2 })] } },
      { phase: 'lost', parts: { history: [run('r1', 'lost')] } },
      { phase: 'cancelled', parts: { history: [run('r1', 'cancelled')] } },
    ]

    // When each is derived
    const views = cases.map(entry => sshCardView(card({ ssh: payload({ target: TARGET, ...entry.parts }) })))

    // Then the phase is the run's, the run id travels with it, and only the two
    // in-flight phases count as active
    expect(views.map(view => view.phase)).toEqual(cases.map(entry => entry.phase))
    expect(views.map(view => view.runId)).toEqual(cases.map(() => 'r1'))
    expect(views.map(view => isSshRunActive(view.phase))).toEqual([true, true, false, false, false, false])
  })

  it('user watching a card that is running and has older history sees the run in flight', () => {
    // Given a card with history and a run in flight
    const task = card({
      ssh: payload({
        target: TARGET,
        activeRun: run('r2', 'running'),
        history: [run('r1', 'failed')],
      }),
    })

    // When it is derived
    const view = sshCardView(task)

    // Then the chip and the section report the run that is happening now
    expect(view.phase).toBe('running')
    expect(view.runId).toBe('r2')
    expect(view.lastRun?.runId).toBe('r1')
  })
})

describe('the target form draft', () => {
  it('operator opening an untargeted card gets the published defaults with no host pinned', () => {
    // Given a provider that publishes a default mode and agent
    const draft = draftOf(undefined, { mode: 'proxy', agent: 'claude', workspace: 'git' })

    // When the form opens on an untargeted card
    // Then the defaults prefill and the host stays empty for the picker
    expect(draft.mode).toBe('proxy')
    expect(draft.agent).toBe('claude')
    expect(draft.workspaceKind).toBe('git')
    expect(draft.host).toBe('')
  })

  it('operator reopening a pinned card gets the same target back after the draft round-trip', () => {
    // Given a git target whose repository is the local workspace
    const target: SshTarget = {
      mode: 'direct',
      host: 'devbox',
      agent: { kind: 'custom', command: 'run {prompt_file}', resumeCommand: 'again {prompt_file}' },
      workspace: { kind: 'git', source: { kind: 'workspace', workspaceId: 'ws-1' } },
    }

    // When the draft is read from it and validated again
    const draft = draftOf(target)
    const result = validateDraft(draft)

    // Then the parsed target is the one the card pinned
    expect(result.target).toEqual(target)
    expect(result.issues).toEqual([])
  })

  it('operator saving an in-place target sends no repository field at all', () => {
    // Given a draft whose repository fields still hold text from an earlier edit
    const draft: SshTargetDraft = {
      ...draftOf(TARGET),
      host: 'devbox',
      workspaceKind: 'in-place',
      workspacePath: '/srv/app',
      repositoryUrl: 'not a url at all',
    }

    // When the wire shape is built
    const wire = draftToTarget(draft)

    // Then only the field the workspace kind shows is sent
    expect(wire).toEqual({ mode: 'direct', host: 'devbox', agent: { kind: 'dsh' }, workspace: { kind: 'in-place', path: '/srv/app' } })
  })

  it('operator submitting an incomplete target is told which fields carry the problem', () => {
    // Given an in-place draft with a relative path and no host
    const draft: SshTargetDraft = { ...draftOf(undefined), host: '', workspacePath: 'srv/app' }

    // When it is validated before submit
    const result = validateDraft(draft)

    // Then both fields are named and no target is produced
    expect(result.target).toBeUndefined()
    expect(Object.keys(result.errors).sort()).toEqual(['host', 'workspacePath'])
  })

  it('operator writing a custom agent without the prompt file is refused on that command field', () => {
    // Given a custom agent whose template never reads the prompt
    const draft: SshTargetDraft = { ...draftOf(undefined), host: 'devbox', agent: 'custom', agentCommand: 'claude -p' }

    // When it is validated
    const result = validateDraft(draft)

    // Then the refusal is addressed to the command input
    expect(result.errors.agentCommand?.message).toContain('{prompt_file}')
    expect(result.errors.host).toBeUndefined()
  })
})

describe('the target summary line', () => {
  it('user reading the target line sees the host, the agent and the workspace of its mechanism', () => {
    // Given an in-place target and a git target
    const inPlace = targetSummaryParts(TARGET)
    const fromUrl = targetSummaryParts({
      ...TARGET,
      workspace: { kind: 'git', source: { kind: 'url', url: 'git@example.com:t/r.git', base: 'main' } },
    })

    // When the section renders its one summary line
    // Then each mechanism contributes its own workspace value
    expect(inPlace).toEqual({ host: 'devbox', agent: 'dsh', workspace: '/srv/app' })
    expect(fromUrl.workspace).toBe('git@example.com:t/r.git')
  })
})