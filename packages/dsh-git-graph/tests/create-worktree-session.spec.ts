// @vitest-environment jsdom
/**
 * createWorktreeSession verb contract: after the worktree registers as a
 * workspace, the sessions face must both create the blank session and
 * navigate to it. 0.1.2's ISessions.create only adopts the workspace and
 * resolves the new SessionId — open() is the separate selection step — so
 * the verb has to call open() itself. A sessions-face failure rolls the
 * worktree back (no half-made environment).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, type GitGraphInjected } from '../src/client/index.ts'

/** The worktree the stubbed /git/worktree-add route serves. */
const WORKTREE = { path: '/home/u/.dsh/worktrees/proj-a1b2c3d4/fix-login', branch: 'wt/fix-login', name: 'fix-login' }

interface Harness {
  /** Replace the sessions.create resolution (default: resolve 'sess-new'). */
  createSession?: (workspaceId: string) => Promise<SessionId>
  /** Replace the sessions.open behavior (default: record only). */
  openSession?: (id: SessionId) => void
}

/**
 * Run apply() against stubbed services and return the registered chip's
 * inject face plus the spies. The sessions double encodes the real 0.1.2
 * contract: create() resolves the SessionId without selecting it, and
 * open() is the selector the caller must drive.
 */
function setup(harness: Harness = {}) {
  const removeCalls: { path: string; worktreePath: string }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    if (url === '/git/worktree-add') {
      return new Response(JSON.stringify({ ok: true, value: WORKTREE }), { headers: { 'content-type': 'application/json' } })
    }
    if (url === '/git/worktree-remove') {
      removeCalls.push({ path: body.path as string, worktreePath: body.worktreePath as string })
      return new Response(JSON.stringify({ ok: true, value: { removed: true } }), { headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const sessions = {
    list: { getSnapshot: () => ({ byId: { 'sess-1': { cwd: '/ws/proj', blank: true } } }) },
    create: vi.fn(harness.createSession ?? (async () => 'sess-new' as SessionId)),
    open: vi.fn(harness.openSession ?? (() => undefined)),
  }
  const workspaces = {
    create: vi.fn(async ({ path }: { path: string }) => {
      expect(path).toBe(WORKTREE.path)
      return { workspaceId: 'ws-new' }
    }),
    // The auto-isolation probe needs the full member shape; it wraps and
    // stays idle unless its verbs fire.
    startSession: vi.fn(),
    connectWorkspace: vi.fn(),
    list: { getSnapshot: () => ({ items: [] }) },
  }

  const disposers: (() => void)[] = []
  const track = vi.fn((fn: () => unknown) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(dispose as () => void)
    return () => {}
  })
  const register = vi.fn(() => () => undefined)
  const scope = {
    // The context hole is declared, so the chip registers synchronously and
    // the dock fallback never arms a second mount.
    slots: {
      inject: vi.fn((_name: string, callback: () => () => void) => {
        callback()
        return () => undefined
      }),
      register,
    },
    conversation: {},
    sessions,
    workspaces,
    effect: track,
  }
  const ctx = {
    effect: track,
    locale: { register: vi.fn(() => () => undefined) },
    inject: vi.fn((_services: unknown, callback: (s: typeof scope) => void) => { callback(scope) }),
  }

  apply(ctx as never)
  const entry = register.mock.calls[0]?.[0] as { inject: () => GitGraphInjected } | undefined
  if (entry === undefined) throw new Error('the chip never registered on the context hole')

  return {
    face: entry.inject(),
    sessions,
    removeCalls,
    /** Dispose the fibers and drop the fetch stub. */
    cleanup(): void {
      for (const dispose of disposers) dispose()
      vi.unstubAllGlobals()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWorktreeSession', () => {
  it('creates the worktree session and navigates to it with open()', async () => {
    const bench = setup()
    try {
      const result = await bench.face.createWorktreeSession('sess-1' as SessionId, 'fix-login')
      expect(result).toEqual({ ok: true, path: WORKTREE.path, branch: WORKTREE.branch, name: WORKTREE.name })
      expect(bench.sessions.create).toHaveBeenCalledTimes(1)
      expect(bench.sessions.create).toHaveBeenCalledWith({ workspaceId: 'ws-new' })
      // Navigation: 0.1.2 create() resolves the SessionId without selecting
      // it, so the verb must open the created session itself.
      expect(bench.sessions.open).toHaveBeenCalledTimes(1)
      expect(bench.sessions.open).toHaveBeenCalledWith('sess-new')
      expect(bench.removeCalls).toEqual([])
    } finally {
      bench.cleanup()
    }
  })

  it('opens the exact session id create() resolved, after create resolves', async () => {
    const bench = setup({
      createSession: async () => 'sess-adoptive-42' as SessionId,
    })
    try {
      await bench.face.createWorktreeSession('sess-1' as SessionId, 'fix-login')
      expect(bench.sessions.create).toHaveResolvedWith('sess-adoptive-42')
      expect(bench.sessions.open).toHaveBeenCalledWith('sess-adoptive-42')
    } finally {
      bench.cleanup()
    }
  })

  it('rolls the worktree back when the sessions face fails', async () => {
    const bench = setup({
      createSession: async () => {
        throw new Error('host refused')
      },
    })
    try {
      const result = await bench.face.createWorktreeSession('sess-1' as SessionId, 'fix-login')
      expect(result).toEqual({
        ok: false,
        error: { code: 'internal', message: expect.stringContaining('workspace registration failed') },
      })
      expect(bench.removeCalls).toEqual([{ path: '/ws/proj', worktreePath: WORKTREE.path }])
      expect(bench.sessions.open).not.toHaveBeenCalled()
    } finally {
      bench.cleanup()
    }
  })

  it('rolls the worktree back when open() fails loud', async () => {
    const bench = setup({
      openSession: () => {
        throw new Error('unknown session')
      },
    })
    try {
      const result = await bench.face.createWorktreeSession('sess-1' as SessionId, 'fix-login')
      expect(result).toEqual({
        ok: false,
        error: { code: 'internal', message: expect.stringContaining('workspace registration failed') },
      })
      expect(bench.removeCalls).toEqual([{ path: '/ws/proj', worktreePath: WORKTREE.path }])
    } finally {
      bench.cleanup()
    }
  })
})
