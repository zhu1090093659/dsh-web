/**
 * Owns the forked Agent Teams runtime as this package mounts it: the one
 * 'agentTeam' projection on the root context, the squad-run gate that decides
 * which sessions may see the Team tool surface, and the pin ordering a teammate
 * spawn must honour before its first prompt is checkpointed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createTeammatePins, type TeammatePinFaces } from '../src/host/run-gateway.ts'
import { TeamError } from '../src/team/error.ts'
import { TeamService, type TeamServiceContext } from '../src/team/index.ts'
import { teamProjectionDefinition } from '../src/team/projection.ts'
import { installTeamTools } from '../src/tools/index.ts'
import { createTeamHarness } from './team-harness.ts'

/** The complete Team tool surface a squad-run session receives. */
const TEAM_TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
]

function spawnRequest(overrides: Record<string, unknown> = {}): Parameters<TeamService['spawnTeammate']>[1] {
  return {
    name: 'scout',
    description: 'Reads the diff and reports the risky parts',
    prompt: [{ type: 'text', text: 'Read the diff' }],
    context: 'fresh',
    provider: 'spawn',
    signal: new AbortController().signal,
    ...overrides,
  } as Parameters<TeamService['spawnTeammate']>[1]
}

describe('forked Agent Teams projection', () => {
  it('operator registers exactly one agentTeam projection at stateVersion 4 on the root context', async () => {
    // Given a fresh Host context, When the forked Team service is constructed once, Then exactly one projection registers, at key agentTeam and stateVersion 4.
    const harness = createTeamHarness()
    harness.teamService = await TeamService.create(harness.ctx)

    expect(harness.projections).toEqual([{ key: 'agentTeam', stateVersion: 4 }])
    expect(teamProjectionDefinition.key).toBe('agentTeam')
    expect(teamProjectionDefinition.stateVersion).toBe(4)
  })
})

describe('squad-run gate on the Team tool surface', () => {
  it('operator installs nothing into a plain root session and the whole set into a squad-run session', async () => {
    // Given a plain root session and a squad-run session, When both are published to the installer, Then only the squad-run session receives the whole nine-tool Team surface and its policy section.
    const harness = createTeamHarness()
    harness.teamService = await TeamService.create(harness.ctx)
    const plain = harness.createAgent('plain-session')
    harness.createAgent('squad-lead')
    // Stands in for the ledger lookup the Host wires in: only a session this
    // Host launched as a squad run is in the set.
    const qualifying = new Set(['squad-lead'])
    const installation = installTeamTools(harness.ctx as unknown as TeamServiceContext, {
      isTeamSession: agent => qualifying.has(agent.id),
    })

    expect(harness.tools).toEqual(TEAM_TOOL_NAMES)
    expect(harness.sections).toEqual(['squad-lead:team:policy'])
    expect(harness.contexts).toEqual(['squad-lead:team:identity'])
    expect(harness.sections.some(entry => entry.startsWith(plain.id))).toBe(false)

    // A later ordinary session sees neither a tool nor the policy section.
    const late = harness.createAgent('late-plain')
    harness.published(late)
    expect(harness.tools).toEqual(TEAM_TOOL_NAMES)

    // A later squad Lead is installed on its own creation edge.
    const lateLead = harness.createAgent('late-lead')
    qualifying.add(lateLead.id)
    harness.published(lateLead)
    expect(harness.tools).toEqual([...TEAM_TOOL_NAMES, ...TEAM_TOOL_NAMES])
    expect(harness.sections).toContain('late-lead:team:policy')
    installation.dispose()
  })

  it('operator re-scans live sessions on refresh so a Lead created before its run record still gets the tools', async () => {
    // Given a Lead that existed before its squad run record was written, When the Host calls refresh after recording, Then the Team tools land in that live session.
    const harness = createTeamHarness()
    harness.teamService = await TeamService.create(harness.ctx)
    const lead = harness.createAgent('squad-lead')
    const qualifying = new Set<string>()
    const installation = installTeamTools(harness.ctx as unknown as TeamServiceContext, {
      isTeamSession: agent => qualifying.has(agent.id),
    })
    expect(harness.tools).toEqual([])

    qualifying.add('squad-lead')
    installation.refresh()
    expect(harness.tools).toEqual(TEAM_TOOL_NAMES)
    expect(lead.id).toBe('squad-lead')
    installation.dispose()
  })

  it('operator never registers a row, config, or source that disables the native subagent tools', () => {
    // Given this package's row, manifest, and the sources it owns, When every file is scanned for the native delegation tool names, Then none of them is mentioned, disabled, or renamed.
    const root = fileURLToPath(new URL('..', import.meta.url))
    const files: string[] = [join(root, 'cordis.patch.yml'), join(root, 'package.json')]
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts')) files.push(path)
      }
    }
    walk(join(root, 'src'))
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      // A generated copy states what its shared source says, and `node scripts/sync-shared.mjs --check` is what keeps it honest; the fence measures the files this package owns.
      if (text.startsWith('// Generated by scripts/sync-shared.mjs')) continue
      expect(text.includes('tool-subagent'), file).toBe(false)
    }
  })
})

describe('teammate pins', () => {
  function pinFaces(order: string[], presets = [{ id: 'xundong' }]): TeammatePinFaces {
    return {
      listPresets: async () => {
        order.push('preset')
        return presets
      },
      applyPermission: async (_sessionId, permission) => {
        order.push('permission:' + permission)
      },
      selectModel: async (_sessionId, route, reasoningEffort) => {
        order.push('model:' + String(route.provider) + '/' + route.model + '/' + String(reasoningEffort))
      },
    }
  }

  it('operator applies preset, permission, and model before the first prompt is checkpointed', async () => {
    // Given a member definition pinning preset, permission, and model, When the Lead spawns that teammate, Then the preset reaches the activation request and permission and model are applied before the initial prompt checkpoint.
    const harness = createTeamHarness()
    const lead = harness.createAgent('squad-lead')
    harness.teamService = await TeamService.create(harness.ctx, {}, { pins: createTeammatePins(pinFaces(harness.order)) })

    const result = await harness.teamService.spawnTeammate(lead as unknown as Agent, spawnRequest({
      preset: 'xundong',
      permission: 'read-only',
      model: 'deepseek/deepseek-v4',
      reasoningEffort: 'high',
    }))

    expect(harness.order).toEqual([
      'preset',
      'start',
      'permission:read-only',
      'model:deepseek/deepseek-v4/high',
      'checkpoint',
    ])
    const started = harness.started[0] as { request: { agentPreset?: string } }
    expect(started.request.agentPreset).toBe('xundong')
    expect(result.member.name).toBe('scout')
  })

  it('operator fails the spawn with a named error when the pinned preset cannot be resolved', async () => {
    // Given a Host registry without the pinned preset, When the Lead spawns the teammate, Then the spawn fails with TEAM_PRESET_UNKNOWN before any child activation starts.
    const harness = createTeamHarness()
    const lead = harness.createAgent('squad-lead')
    harness.teamService = await TeamService.create(harness.ctx, {}, { pins: createTeammatePins(pinFaces(harness.order, [{ id: 'michun' }])) })

    const failure = await harness.teamService
      .spawnTeammate(lead as unknown as Agent, spawnRequest({ preset: 'xundong' }))
      .then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(TeamError)
    expect((failure as TeamError).code).toBe('TEAM_PRESET_UNKNOWN')
    expect(harness.order).toEqual(['preset'])
    expect(harness.started).toEqual([])
  })

  it('operator fails the spawn when the child session refuses the pinned model route', async () => {
    // Given a child session that refuses the pinned model route, When the Lead spawns the teammate, Then the spawn fails with TEAM_MODEL_PIN_FAILED and no prompt is ever checkpointed.
    const harness = createTeamHarness()
    const lead = harness.createAgent('squad-lead')
    const faces = pinFaces(harness.order)
    harness.teamService = await TeamService.create(harness.ctx, {}, {
      pins: createTeammatePins({
        ...faces,
        selectModel: async () => {
          throw new Error('unknown model')
        },
      }),
    })

    const failure = await harness.teamService
      .spawnTeammate(lead as unknown as Agent, spawnRequest({ model: 'deepseek/deepseek-v9' }))
      .then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(TeamError)
    expect((failure as TeamError).code).toBe('TEAM_MODEL_PIN_FAILED')
    // The refused model pin stops the spawn before the checkpoint, so no prompt
    // is ever durably accepted for a teammate that did not get the pinned route.
    expect(harness.order).toEqual(['start'])
  })
})
