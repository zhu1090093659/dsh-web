/**
 * Owns the whole-squad run as this package serves it: the Lead session composed
 * like a member session, the squad run record written before the Lead's first
 * message, the ledger gate that recognizes a squad-run session, and the
 * 'team:squad' context that tells the Lead who its members are.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentsError } from '../src/core/errors.ts'
import { AGENTS_LEDGER_FILE } from '../src/host/ledger.ts'
import type { MemberRunGateway } from '../src/host/run-gateway.ts'
import { AgentsHostService } from '../src/host/service.ts'
import { briefText, squadContextText, squadRunFor, type SquadLedgerView } from '../src/host/squad.ts'
import {
  DSH_AGENTS_ROUTE_PATHS,
  parseSquadRunRequestBody,
  parseTeamDraft,
  type MemberDefinition,
  type RunRecord,
  type TeamDefinition,
} from '../src/protocol.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace/types'

const NOW = 1_700_000_000_000
const services: AgentsHostService[] = []
const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-agents-squad-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function memberOf(overrides: Partial<MemberDefinition> = {}): MemberDefinition {
  return {
    id: 'member-1',
    teamId: 'team-1',
    name: 'Scout',
    preset: 'xundong',
    permission: 'read-only',
    model: 'deepseek/deepseek-v4',
    brief: 'Reads the diff and names the risky parts',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function teamOf(overrides: Partial<TeamDefinition> = {}): TeamDefinition {
  return {
    id: 'team-1',
    name: 'Research squad',
    workspaceId: 'ws-1',
    leadPreset: 'xundong',
    createdAt: NOW,
    updatedAt: NOW,
    members: [
      memberOf(),
      memberOf({
        id: 'member-2',
        name: 'Builder',
        preset: 'michun',
        permission: 'workspace-write',
        model: 'deepseek/deepseek-v4',
        brief: 'Builds the change and runs the suite',
      }),
    ],
    ...overrides,
  }
}

function gateway(overrides: Partial<MemberRunGateway> = {}): MemberRunGateway {
  return {
    listPresets: vi.fn(async () => [{ id: 'xundong' }, { id: 'michun' }]),
    createSession: vi.fn(async () => ({ sessionId: 'lead-session' })),
    renameSession: vi.fn(async () => undefined),
    applyPermission: vi.fn(async () => undefined),
    selectModel: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
    ...overrides,
  }
}

const workspaces = { list: (): readonly Workspace[] => [{ id: 'ws-1', name: 'repo' } as unknown as Workspace] }

function service(options: { gateway?: MemberRunGateway; dir?: string } = {}): AgentsHostService {
  let counter = 0
  const instance = new AgentsHostService({
    dir: options.dir ?? tempDir(),
    gateway: options.gateway ?? gateway(),
    workspaces: () => workspaces,
    now: () => NOW + counter++,
    idFactory: () => 'id-' + (++counter),
  })
  services.push(instance)
  return instance
}

function seedTeam(instance: AgentsHostService, team: TeamDefinition = teamOf()): TeamDefinition {
  // Created first, then completed with the editable fields: the ledger mints the
  // id, so a spec cannot address a team before it exists.
  const created = instance.saveTeam({ name: team.name, workspaceId: team.workspaceId })
  const withLead = instance.saveTeam({
    id: created.id,
    name: created.name,
    workspaceId: created.workspaceId,
    ...(team.leadPreset === undefined ? {} : { leadPreset: team.leadPreset }),
  })
  for (const member of team.members) {
    instance.saveMember(withLead.id, {
      name: member.name,
      preset: member.preset,
      permission: member.permission,
      model: member.model,
      brief: member.brief,
    })
  }
  return instance.state.teams[0] as TeamDefinition
}

function codeOf(action: () => Promise<unknown>): Promise<string> {
  return action().then(() => 'no-error', (error: unknown) => {
    if (error instanceof AgentsError) return error.code
    throw error
  })
}

describe('team:squad context', () => {
  it('operator renders every member name, preset, permission, model, and brief summary for a two-member squad', () => {
    // Given a two-member squad and a recorded squad run with a goal, When the team:squad context is rendered for the Lead, Then each member's name, preset, permission, model, and brief summary appears with the goal.
    const text = squadContextText('lead-session', {
      teams: [teamOf()],
      runs: [{ id: 'run-1', teamId: 'team-1', sessionId: 'lead-session', createdAt: NOW, status: 'running', kind: 'squad', goal: 'Ship the M2 runtime' }],
    })

    expect(text).toContain('Research squad')
    expect(text).toContain('Squad goal: Ship the M2 runtime')
    expect(text).toContain('Members (2):')
    expect(text).toContain('- Scout | preset xundong | permission read-only, inherited from you: a teammate always runs with its parent session permission | model deepseek/deepseek-v4 | brief: Reads the diff and names the risky parts')
    expect(text).toContain('- Builder | preset michun | permission workspace-write, inherited from you: a teammate always runs with its parent session permission | model deepseek/deepseek-v4 | brief: Builds the change and runs the suite')
    expect(text).toContain('Start each member with the subagent tool')
    expect(text).toContain('asks the Host to switch Team mode on for this session')
  })

  it('operator renders nothing for a session that leads no squad run', () => {
    // Given the same ledger, When the context is rendered for a session with no squad run, Then it is empty and the squad lookup finds nothing.
    const view: SquadLedgerView = {
      teams: [teamOf()],
      runs: [{ id: 'run-1', teamId: 'team-1', sessionId: 'lead-session', createdAt: NOW, status: 'running', kind: 'squad' as const }],
    }
    expect(squadContextText('ordinary-session', view)).toBe('')
    expect(squadContextText(undefined, view)).toBe('')
    expect(squadRunFor('lead-session', view)?.run.id).toBe('run-1')
  })

  it('operator flattens a member brief without truncating it', () => {
    // Given briefs that are missing, multi-line, or long, When the roster renders them, Then each is one line and the whole brief survives: the Lead pastes it verbatim into the spawn prompt, so a truncated brief would reach the teammate as a broken instruction.
    expect(briefText(undefined)).toBe('none; state the task in the spawn prompt')
    expect(briefText('  two\n lines  ')).toBe('two lines')
    expect(briefText('x'.repeat(400)).length).toBe(400)
  })
})

describe('whole-squad run', () => {
  it('operator opens the Lead session from the pinned lead preset and records the run before the first prompt', async () => {
    // Given a squad pinning a workspace and a lead preset, When the Host runs the whole squad, Then the Lead session is created from that preset, renamed, and its run is already durable when the first prompt is queued.
    const order: string[] = []
    let runsAtPrompt: readonly RunRecord[] = []
    let instance: AgentsHostService
    let minted = 0
    const pins = {
      listPresets: vi.fn(async () => [{ id: 'xundong' }]),
      createSession: vi.fn(async () => { order.push('create'); return { sessionId: 'lead-session' } }),
      renameSession: vi.fn(async () => { order.push('rename') }),
      applyPermission: vi.fn(async () => undefined),
      selectModel: vi.fn(async () => undefined),
      prompt: vi.fn(async () => {
        order.push('prompt')
        runsAtPrompt = instance.state.runs
      }),
    } as MemberRunGateway
    instance = new AgentsHostService({
      dir: tempDir(),
      gateway: pins,
      workspaces: () => workspaces,
      now: () => NOW,
      idFactory: () => 'id-' + (++minted),
    })
    services.push(instance)
    const seeded = seedTeam(instance)

    const run = await instance.runSquad({ teamId: seeded.id, goal: 'Ship the M2 runtime', firstMessage: 'Begin.' })

    expect(order).toEqual(['create', 'rename', 'prompt'])
    expect(runsAtPrompt.map(candidate => candidate.kind)).toEqual(['squad'])
    expect(run.kind).toBe('squad')
    expect(run.memberId).toBeUndefined()
    expect(run.goal).toBe('Ship the M2 runtime')
    expect(run.sessionId).toBe('lead-session')
    expect(run.status).toBe('running')
    expect(pins.createSession).toHaveBeenCalledWith({ workspaceId: 'ws-1', agentPreset: 'xundong' })
    expect(pins.renameSession).toHaveBeenCalledWith('lead-session', 'Research squad / Lead')
    expect(instance.leadsSquadRun('lead-session')).toBe(true)
    expect(instance.leadsSquadRun('ordinary-session')).toBe(false)
    expect(instance.squadContext('lead-session')).toContain('Squad goal: Ship the M2 runtime')
  })

  it('operator runs a squad that pins no workspace and its Lead lands on the host default', async () => {
    // Given a squad that pins no workspace, When the Host runs the whole squad, Then a Lead session is created with no workspaceId and the run is recorded.
    const requested: unknown[] = []
    const pins = gateway({ createSession: vi.fn(async (input) => { requested.push(input); return { sessionId: 'lead-session' } }) })
    const instance = service({ gateway: pins })
    const seeded = instance.saveTeam({ name: 'Research squad' })

    const run = await instance.runSquad({ teamId: seeded.id })
    expect(requested).toEqual([{}])
    expect(requested.map(input => Object.keys(input as Record<string, unknown>))).toEqual([[]])
    expect(run).toMatchObject({ teamId: seeded.id, sessionId: 'lead-session', kind: 'squad', status: 'running' })
    expect(instance.state.runs).toEqual([run])
  })

  it('operator fails closed when the pinned lead preset is unknown', async () => {
    // Given a squad whose lead preset is not in the Host registry, When the Host runs the whole squad, Then preset-unknown is refused before any session exists.
    const pins = gateway({ listPresets: async () => [{ id: 'michun' }] })
    const instance = service({ gateway: pins })
    const seeded = instance.saveTeam({ name: 'Research squad', workspaceId: 'ws-1', leadPreset: 'xundong' })

    expect(await codeOf(() => instance.runSquad({ teamId: seeded.id }))).toBe('preset-unknown')
    expect(pins.createSession).not.toHaveBeenCalled()
  })

  it('operator keeps the run record and marks it failed when the first message cannot be queued', async () => {
    // Given a Host whose prompt call fails, When the Host runs the whole squad, Then the squad run record survives and is settled as failed.
    const pins = gateway({ prompt: async () => { throw new Error('queue closed') } })
    const instance = service({ gateway: pins })
    const seeded = seedTeam(instance)

    expect(await codeOf(() => instance.runSquad({ teamId: seeded.id, firstMessage: 'Begin.' }))).toBe('session-prompt-failed')
    expect(instance.state.runs.map(run => ({ kind: run.kind, status: run.status }))).toEqual([{ kind: 'squad', status: 'failed' }])
  })
})

describe('M2 protocol additions stay backwards compatible', () => {
  it('operator still loads an M1 ledger whose member runs carry no kind', () => {
    // Given a ledger written by M1 with a member run carrying no kind, When this build opens and rewrites it, Then the run still loads and keeps its M1 shape.
    const dir = tempDir()
    writeFileSync(join(dir, AGENTS_LEDGER_FILE), JSON.stringify({
      schemaVersion: 1,
      revision: 3,
      teams: [],
      runs: [{ id: 'run-old', teamId: 'team-1', memberId: 'member-1', sessionId: 'session-1', createdAt: NOW, status: 'running' }],
    }))
    const instance = new AgentsHostService({ dir, gateway: gateway(), workspaces: () => workspaces })
    services.push(instance)

    const runs = instance.state.runs
    expect(runs).toHaveLength(1)
    expect(runs[0]?.memberId).toBe('member-1')
    expect(runs[0]?.kind).toBeUndefined()
    // A rewritten document keeps the M1 shape of an M1 run.
    instance.saveTeam({ name: 'Research squad' })
    const persisted = JSON.parse(readFileSync(join(dir, AGENTS_LEDGER_FILE), 'utf8')) as { runs: Array<Record<string, unknown>> }
    expect(persisted.runs[0]?.kind).toBeUndefined()
    expect(persisted.runs[0]?.memberId).toBe('member-1')
  })

  it('operator gates the squad run body exactly like every other route', () => {
    // Given squad run bodies with unknown fields, blank ids, or over-long goals, When each body is gated, Then only the well-formed bodies pass.
    expect(parseSquadRunRequestBody({ teamId: 'team-1' })).toEqual({ teamId: 'team-1' })
    expect(parseSquadRunRequestBody({ teamId: 'team-1', goal: '  Ship it  ' })).toEqual({ teamId: 'team-1', goal: 'Ship it' })
    expect(parseSquadRunRequestBody({ teamId: 'team-1', unknown: 1 })).toBeUndefined()
    expect(parseSquadRunRequestBody({})).toBeUndefined()
    expect(parseSquadRunRequestBody({ teamId: 'team-1', goal: 'x'.repeat(4_001) })).toBeUndefined()
  })

  it('operator accepts a pinned lead preset on a team draft and keeps the route list authoritative', () => {
    // Given a team draft carrying a lead preset and one carrying a non-string, When both are gated, Then only the first passes and the frozen route list still ends with the squad run path.
    expect(parseTeamDraft({ name: 'Research squad', leadPreset: 'xundong' })).toEqual({ name: 'Research squad', leadPreset: 'xundong' })
    expect(parseTeamDraft({ name: 'Research squad', leadPreset: 7 })).toBeUndefined()
    expect(DSH_AGENTS_ROUTE_PATHS).toContain('/dsh-agents/api/squad/run')
    expect(DSH_AGENTS_ROUTE_PATHS).toHaveLength(8)
  })
})
