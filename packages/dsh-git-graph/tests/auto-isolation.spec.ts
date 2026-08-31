/**
 * Auto-isolation wrapper tests: fake workspaces/sessions services and a
 * stubbed GitApi verify the routing matrix — off passthrough, non-git
 * passthrough, no-nesting, worktree redirect, degradation on failure, and
 * shape-mismatch refusal.
 */
import { describe, expect, it, vi } from 'vitest'
import { installAutoIsolation } from '../src/client/auto-isolation.ts'
import type { GitApi } from '../src/client/api.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

const HOME = '/home/u/.dsh/worktrees'

interface FakeOptions {
  autoIsolate?: boolean
  statusNull?: boolean
  addFails?: boolean
  createFails?: boolean
}

/** One fake client scope: workspaces service + sessions list + stubbed git api. */
function fakeScope(options: FakeOptions = {}) {
  const items = [
    { workspaceId: 'ws-main', path: '/repo', sessionIds: ['sess-1'] },
    { workspaceId: 'ws-wt', path: `${HOME}/repo-a1b2c3d4/s-abc`, sessionIds: [] },
  ]
  const startSession = vi.fn()
  const create = options.createFails
    ? vi.fn(async () => { throw new Error('registry full') })
    : vi.fn(async ({ path }: { path: string }) => ({ workspaceId: `ws-${path.split('/').pop()}` }))
  const workspaces = {
    startSession,
    create,
    connectWorkspace: vi.fn(async (id: string) => `sess-${id}`),
    list: {
      getSnapshot: () => ({ items, recentWorkspaceId: 'ws-main' }),
    },
  }
  const sessions = { list: { getSnapshot: () => ({ current: 'sess-1' as const, byId: {} }) } }
  const git = {
    config: vi.fn(async () => ({
      ok: true as const,
      value: {
        autoIsolate: options.autoIsolate ?? true,
        autoBaseline: 'current' as const,
        worktreesHome: HOME,
      },
    })),
    status: vi.fn(async () => options.statusNull === true
      ? { ok: true as const, value: null }
      : { ok: true as const, value: { branch: 'main' } }),
    addWorktree: options.addFails
      ? vi.fn(async () => ({ ok: false as const, error: { code: 'internal' as const, message: 'boom' } }))
      : vi.fn(async (_path: string, name: string) => ({
        ok: true as const,
        value: { path: `${HOME}/repo-a1b2c3d4/${name}`, branch: `wt/${name}`, name },
      })),
    removeWorktree: vi.fn(async () => ({ ok: true as const, value: { removed: true as const } })),
  }
  const scope = { workspaces, sessions } as unknown as ClientContext
  return { scope, workspaces, startSession, create, git }
}

/** Flush the wrapper's async routing (it returns void synchronously). */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

describe('installAutoIsolation', () => {
  it('passes through unchanged when autoIsolate is off', async () => {
    const { scope, workspaces, startSession, git } = fakeScope({ autoIsolate: false })
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('passes through for non-git workspaces', async () => {
    const { scope, workspaces, startSession, git } = fakeScope({ statusNull: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('redirects a git workspace new-session into a fresh worktree workspace', async () => {
    const { scope, workspaces, startSession, create, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-main')
    await flush()
    expect(git.addWorktree).toHaveBeenCalledWith('/repo', expect.stringMatching(/^s-/), undefined)
    expect(create).toHaveBeenCalledWith({ path: expect.stringContaining(HOME) })
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(startSession.mock.calls[0]?.[0]).toMatch(/^ws-/)
    expect(startSession.mock.calls[0]?.[0]).not.toBe('ws-main')
  })

  it('never nests: a workspace already under the managed home passes through', async () => {
    const { scope, workspaces, startSession, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-wt')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-wt')
    expect(git.addWorktree).not.toHaveBeenCalled()
  })

  it('degrades to the official behavior when worktree creation fails', async () => {
    const { scope, workspaces, startSession } = fakeScope({ addFails: true })
    const { git } = fakeScope({ addFails: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-main')
    await flush()
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('rolls back the worktree when workspace registration fails', async () => {
    const { scope, workspaces, startSession, git } = fakeScope({ createFails: true })
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession('ws-main')
    await flush()
    expect(git.removeWorktree).toHaveBeenCalledWith('/repo', expect.stringContaining(HOME), { force: true })
    expect(startSession).toHaveBeenCalledWith('ws-main')
  })

  it('resolves the target from the current session when no workspaceId is given', async () => {
    const { scope, workspaces, git } = fakeScope()
    installAutoIsolation(scope, git as unknown as GitApi)
    workspaces.startSession()
    await flush()
    // The current session sess-1 belongs to ws-main (/repo), a git workspace.
    expect(git.addWorktree).toHaveBeenCalledWith('/repo', expect.any(String), undefined)
  })

  it('refuses to wrap a shape-mismatched service and restores on dispose', async () => {
    const { scope, workspaces, startSession } = fakeScope()
    const broken = { ...workspaces, create: 42 }
    const brokenScope = { workspaces: broken, sessions: (scope as unknown as { sessions: unknown }).sessions } as unknown as ClientContext
    const disposer = installAutoIsolation(brokenScope, {} as GitApi)
    expect(broken.startSession).toBe(workspaces.startSession)
    disposer()

    const good = installAutoIsolation(scope, {} as GitApi)
    expect(workspaces.startSession).not.toBe(startSession)
    good()
    expect(workspaces.startSession).toBe(startSession)
  })
})