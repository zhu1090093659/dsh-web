/**
 * Controller state machine: workspace selection, catalog refresh, toggles,
 * installs, and uninstalls with a mocked snapshot store and api client.
 */

import { describe, expect, it, vi } from 'vitest'
// The npm SDK's client half is a closure-factory bundle for the GUI's
// __ModuleLoader__ (not importable under vitest); provide the minimal
// snapshot-store engine the controller needs.
vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  createSnapshotStore: (init: unknown) => {
    let state = init
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      update: (mutator: (draft: unknown) => void) => { mutator(state) },
      set: (next: unknown) => { state = next },
    }
  },
}))
import { SkillManagerController } from '../src/client/controller.ts'
import { SkillManagerApi, SkillManagerApiError } from '../src/client/api.ts'
import type { ListResponse, SkillRow } from '../src/core/protocol.ts'
import type { WorkspaceView } from '@deepseek-ai/dsh-client-connection/client'

const row = (name: string, extra: Partial<SkillRow> = {}): SkillRow => ({
  name,
  description: 'Description.',
  source: 'user-dsh',
  provider: 'filesystem',
  toggleable: true,
  installed: false,
  modelInvocable: true,
  userInvocable: true,
  ...extra,
})

function makeDeps(overrides: Partial<{
  list: ListResponse
  listError?: { message: string; code?: string }
  toggleError: Error
  installError: Error
  uninstallError: Error
}> = {}) {
  const api = {
    list: vi.fn(async (): Promise<ListResponse> => {
      if (overrides.listError !== undefined) {
        const error = overrides.listError
        delete overrides.listError
        throw new SkillManagerApiError(error.message, error.code)
      }
      return overrides.list ?? { skills: [], cwd: '/work', live: true }
    }),
    toggle: vi.fn(async () => {
      if (overrides.toggleError !== undefined) throw overrides.toggleError
      return { ok: true as const, name: 'alpha', path: '/x/SKILL.md', modelInvocable: false, userInvocable: false }
    }),
    install: vi.fn(async () => {
      if (overrides.installError !== undefined) throw overrides.installError
      return { ok: true as const, entries: [{ name: 'alpha', kind: 'dir' as const, path: '/x/alpha' }] }
    }),
    uninstall: vi.fn(async () => {
      if (overrides.uninstallError !== undefined) throw overrides.uninstallError
      return { ok: true as const, name: 'alpha', path: '/x/alpha' }
    }),
  } as unknown as SkillManagerApi
  const sessions = {
    list: {
      getSnapshot: () => ({
        current: 's1' as unknown as import('@deepseek-ai/dsh-client-connection/client').SessionId,
        ids: ['s1' as unknown as import('@deepseek-ai/dsh-client-connection/client').SessionId],
        byId: { s1: { running: true, updatedAt: 1 } },
        phase: 'ready',
      }),
      subscribe: () => () => {},
    },
  }
  const workspaces = vi.fn(async () => ({
    result: {
      ok: true as const,
      value: {
        items: [
          { workspaceId: 'w1' as WorkspaceView['workspaceId'], title: 'Alpha', path: '/w1', sessionIds: ['s1'] as WorkspaceView['sessionIds'], createdAt: '', updatedAt: '' },
          { workspaceId: 'w2' as WorkspaceView['workspaceId'], title: 'Beta', path: '/w2', sessionIds: [] as WorkspaceView['sessionIds'], createdAt: '', updatedAt: '' },
        ],
      },
    },
  }))
  const controller = new SkillManagerController({ api, sessions, workspaces })
  return { api, sessions, workspaces, controller }
}

describe('SkillManagerController', () => {
  it('loads workspaces and selects the one containing the current session', async () => {
    const { controller, workspaces } = makeDeps()
    await controller.load()
    expect(workspaces).toHaveBeenCalled()
    const state = controller.getSnapshot()
    expect(state.selectedWorkspaceId).toBe('w1')
    expect(state.selectedSessionId).toBe('s1')
  })

  it('lists the catalog for the selected session', async () => {
    const { controller } = makeDeps({ list: { skills: [row('alpha')], cwd: '/w1', live: true } })
    await controller.load()
    const state = controller.getSnapshot()
    expect(state.phase).toBe('ready')
    expect(state.skills[0]?.name).toBe('alpha')
    expect(state.cwd).toBe('/w1')
  })

  it('falls back to the first usable workspace when none contains the current session', async () => {
    const second = makeDeps()
    ;(second.sessions.list as { getSnapshot(): { current?: import('@deepseek-ai/dsh-client-connection/client').SessionId; ids: import('@deepseek-ai/dsh-client-connection/client').SessionId[]; byId: Record<string, { running: boolean; updatedAt: number }>; phase: string } }).getSnapshot = () => ({
    current: undefined,
    ids: ['s1' as import('@deepseek-ai/dsh-client-connection/client').SessionId],
    byId: { s1: { running: true, updatedAt: 1 } },
    phase: 'ready',
  })
    await second.controller.load()
    expect(second.controller.getSnapshot().selectedWorkspaceId).toBe('w1')
    expect(second.controller.getSnapshot().selectedSessionId).toBe('s1')
  })

  it('toggles a skill and updates the row', async () => {
    const { controller } = makeDeps({ list: { skills: [row('alpha')], cwd: '/w1', live: true } })
    await controller.load()
    await controller.toggle('alpha', false)
    const state = controller.getSnapshot()
    expect(state.skills[0]).toMatchObject({ modelInvocable: false, userInvocable: false })
    expect(state.toggleError).toBeUndefined()
  })

  it('surfaces toggle failures', async () => {
    const { controller } = makeDeps({ list: { skills: [row('alpha')], cwd: '/w1', live: true }, toggleError: new Error('boom') })
    await controller.load()
    await controller.toggle('alpha', false)
    expect(controller.getSnapshot().toggleError).toBe('boom')
  })

  it('installs and refreshes the catalog', async () => {
    const { controller, api } = makeDeps({ list: { skills: [], cwd: '/w1', live: true } })
    await controller.load()
    controller.setSourceKind('git')
    controller.setSourceValue('https://example.com/repo.git')
    await controller.install()
    expect(api.install).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1',
      source: { kind: 'git', value: 'https://example.com/repo.git' },
      destination: 'workspace',
    }))
    expect(controller.getSnapshot().notice).toEqual({ kind: 'installed', count: 1 })
  })

  it('re-picks the session and retries when the picked session is not attached', async () => {
    const { controller } = makeDeps({
      list: { skills: [row('alpha')], cwd: '/w1', live: true },
      listError: { message: 'session \"s1\" not found', code: 'session-not-found' },
    })
    await controller.load()
    const state = controller.getSnapshot()
    expect(state.phase).toBe('ready')
    expect(state.skills[0]?.name).toBe('alpha')
  })

  it('uninstalls the confirmed skill and drops the row', async () => {
    const { controller } = makeDeps({ list: { skills: [row('alpha', { installed: true })], cwd: '/w1', live: true } })
    await controller.load()
    controller.confirmUninstall('alpha')
    await controller.uninstall()
    const state = controller.getSnapshot()
    expect(state.skills).toHaveLength(0)
    expect(state.notice).toEqual({ kind: 'uninstalled', name: 'alpha' })
    expect(state.uninstallTarget).toBeUndefined()
  })
})
