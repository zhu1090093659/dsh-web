/**
 * Regression tests for the missing-git-binary degradation (issue: the SSE git
 * poll re-spawned ENOENT every poll tick and spammed the terminal forever):
 * - The poll probes git availability once and stops polling when the binary
 *   is missing, pushing exactly one gitUnavailable SSE event per connection.
 * - Machines with git installed keep the normal polling behavior.
 * - A non-repo root keeps the interval running but never spawns git status;
 *   the route layer keeps asking the canonical repo probe each tick, while
 *   GitService's TTL cache limits the real rev-parse re-probes.
 * - GitService caches the probe verdict so status() answers null without
 *   spawning anything on a git-less machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPanelRoutes } from '../src/host/routes.ts'
import { GitService, type GitRunner } from '../src/host/git-service.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'

/** One SSE connection with the bytes the host pushed. */
interface Connection {
  writes: string[]
  close: () => void
  emitError: () => void
}

/** A minimal ctx/webServer/fs/git harness for registerPanelRoutes. */
function makeEnv(): {
  sse: (req: unknown, res: unknown) => Promise<void>
  git: {
    gitAvailable: ReturnType<typeof vi.fn>
    isRepositoryCanonical: ReturnType<typeof vi.fn>
    statusCanonical: ReturnType<typeof vi.fn>
    repositoriesCanonical: ReturnType<typeof vi.fn>
  }
  warn: ReturnType<typeof vi.fn>
} {
  const warn = vi.fn()
  const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
  const ctx = {
    logger: { warn },
    webServer: {
      register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
        registrations.push(row)
        return () => {}
      },
    },
  }
  const fs = {
    verify: async (root: string) => ({ ok: true, canonical: root }),
    watch: (_root: string, _onChange: () => void) => () => {},
  }
  const git = {
    gitAvailable: vi.fn(async () => true),
    isRepositoryCanonical: vi.fn(async () => true),
    statusCanonical: vi.fn(async () => null),
    repositoriesCanonical: vi.fn(async () => []),
  }
  registerPanelRoutes(ctx as never, fs as never, git as never)
  const row = registrations.find((item) => item.kind === 'exact')
  if (row === undefined) throw new Error('SSE route not registered')
  return { sse: row.handler, git, warn }
}

/** Open one SSE connection and collect everything the host writes to it. */
async function connect(
  sse: (req: unknown, res: unknown) => Promise<void>,
  root: string,
  resOverrides: Partial<{ writableEnded: boolean; destroyed: boolean; write: (chunk: unknown) => void }> = {},
): Promise<Connection> {
  const writes: string[] = []
  const closeHandlers: Array<() => void> = []
  const errorHandlers: Array<() => void> = []
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead: () => {},
    write: (chunk: unknown) => { writes.push(String(chunk)) },
    end: () => {},
    on: (event: string, handler: () => void) => {
      if (event === 'error') errorHandlers.push(handler)
    },
    ...resOverrides,
  }
  const req = {
    url: '/aionui-panel/events?root=' + encodeURIComponent(root),
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: '127.0.0.1' },
    on: (event: string, handler: () => void) => {
      if (event === 'close') closeHandlers.push(handler)
    },
  }
  await sse(req, res)
  return {
    writes,
    close: () => {
      for (const handler of closeHandlers) handler()
    },
    emitError: () => {
      for (const handler of errorHandlers) handler()
    },
  }
}

/** Count pushes of one event kind in the collected SSE bytes. */
function eventsOfKind(writes: string[], kind: string): number {
  return writes.filter((write) => write.includes('"kind":"' + kind + '"')).length
}

describe('SSE subscriber lifecycle', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does not write to a closed response during heartbeat or fs watch', async () => {
    const env = makeEnv()
    let watchCallback: (() => void) | undefined
    const fs = {
      verify: async (root: string) => ({ ok: true, canonical: root }),
      watch: (_root: string, onChange: () => void) => {
        watchCallback = onChange
        return () => { watchCallback = undefined }
      },
    }
    const warn = vi.fn()
    const registrations: Array<{ kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }> = []
    const ctx = {
      logger: { warn },
      webServer: {
        register: (row: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => {
          registrations.push(row)
          return () => {}
        },
      },
    }
    const git = {
      gitAvailable: vi.fn(async () => true),
      isRepositoryCanonical: vi.fn(async () => true),
      statusCanonical: vi.fn(async () => null),
    }
    registerPanelRoutes(ctx as never, fs as never, git as never)
    const row = registrations.find((item) => item.kind === 'exact')
    if (row === undefined) throw new Error('SSE route not registered')

    let writeCalls = 0
    const conn = await connect(row.handler, '/w', {
      write: () => {
        writeCalls += 1
        if (writeCalls > 1) throw new Error('write after end')
      },
    })
    conn.close()

    await vi.advanceTimersByTimeAsync(15_000)
    watchCallback?.()

    expect(writeCalls).toBe(1)
  })
})

describe('SSE git polling with a missing git binary', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('probes once, pushes one gitUnavailable event, and stops polling', async () => {
    const env = makeEnv()
    env.git.gitAvailable.mockResolvedValue(false)
    const conn = await connect(env.sse, '/w')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(env.git.gitAvailable).toHaveBeenCalledTimes(1)
    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(1)
    expect(env.warn).toHaveBeenCalledTimes(1)
    expect(env.git.statusCanonical).not.toHaveBeenCalled()

    // Thirty more ticks: still exactly one event, no status spawns, no logs.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(1)
    expect(env.warn).toHaveBeenCalledTimes(1)
    expect(env.git.gitAvailable).toHaveBeenCalledTimes(1)
    expect(env.git.statusCanonical).not.toHaveBeenCalled()

    conn.close()
  })

  it('pushes gitUnavailable to connections opened after the probe failed', async () => {
    const env = makeEnv()
    env.git.gitAvailable.mockResolvedValue(false)
    const first = await connect(env.sse, '/w')
    await vi.advanceTimersByTimeAsync(30_000)
    const second = await connect(env.sse, '/w')

    expect(eventsOfKind(first.writes, 'gitUnavailable')).toBe(1)
    expect(eventsOfKind(second.writes, 'gitUnavailable')).toBe(1)
    expect(env.git.gitAvailable).toHaveBeenCalledTimes(1)

    first.close()
    second.close()
  })
})

describe('SSE git polling with git installed', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('keeps polling and pushing status changes', async () => {
    const env = makeEnv()
    const status = { root: '/w', branch: 'main', staged: [], unstaged: [], untracked: [] }
    env.git.repositoriesCanonical.mockResolvedValue([status])
    const conn = await connect(env.sse, '/w')

    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.git.gitAvailable).toHaveBeenCalledTimes(1)
    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(1)
    expect(eventsOfKind(conn.writes, 'git')).toBe(1)
    expect(conn.writes.some((write) => write.includes('"repositories"'))).toBe(true)

    // Unchanged status pushes nothing; a branch change pushes again.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(2)
    expect(eventsOfKind(conn.writes, 'git')).toBe(1)
    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(0)

    env.git.repositoriesCanonical.mockResolvedValue([{ ...status, branch: 'dev' }])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(3)
    expect(eventsOfKind(conn.writes, 'git')).toBe(2)
    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(0)

    conn.close()
  })
})

describe('SSE git polling on a non-repository workspace', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('keeps polling but never spawns git status while the workspace is not a repo', async () => {
    const env = makeEnv()
    env.git.repositoriesCanonical.mockResolvedValue([])
    const conn = await connect(env.sse, '/w')

    await vi.advanceTimersByTimeAsync(30_000)

    expect(env.git.gitAvailable).toHaveBeenCalledTimes(1)
    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(1)
    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(0)

    // Two more ticks: the interval keeps running so the repo probe is
    // re-asked every tick (GitService re-runs discovery only when its TTL
    // expires), but no git event is pushed.
    await vi.advanceTimersByTimeAsync(60_000)

    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(3)
    expect(eventsOfKind(conn.writes, 'gitUnavailable')).toBe(0)

    conn.close()
  })

  it('polls every connected subscriber while the workspace stays non-repo', async () => {
    const env = makeEnv()
    env.git.repositoriesCanonical.mockResolvedValue([])
    const first = await connect(env.sse, '/w')
    await vi.advanceTimersByTimeAsync(30_000)

    const second = await connect(env.sse, '/w')
    await vi.advanceTimersByTimeAsync(30_000)

    // One tick for the first subscriber alone, then one tick for both.
    expect(env.git.repositoriesCanonical).toHaveBeenCalledTimes(3)

    first.close()
    second.close()
  })
})

describe('GitService availability probe', () => {
  const gate: WorkspaceGate = async (root) => ({ ok: true, canonical: root })

  function enoentRunner(calls: string[][]): GitRunner {
    return {
      async run(argv) {
        calls.push([...argv])
        return { exitCode: 127, stdout: '', stderr: 'spawn ENOENT' }
      },
    }
  }

  it('probes git --version once and caches the verdict', async () => {
    const calls: string[][] = []
    const service = new GitService(enoentRunner(calls), gate, vi.fn())

    expect(await service.gitAvailable()).toBe(false)
    expect(await service.gitAvailable()).toBe(false)
    expect(calls.filter((call) => call[0] === '--version')).toHaveLength(1)
  })

  it('status returns null without spawning git when the binary is missing', async () => {
    const calls: string[][] = []
    const service = new GitService(enoentRunner(calls), gate, vi.fn())

    expect(await service.status('/w')).toBeNull()
    expect(await service.status('/w')).toBeNull()
    expect(calls.filter((call) => call[0] === '--version')).toHaveLength(1)
    expect(calls.some((call) => call[0] === 'rev-parse')).toBe(false)
  })
})
