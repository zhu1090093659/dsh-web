/**
 * GitService behavior tests with a fake runner + gate: stage/unstage batch
 * plumbing, and the discard path — tracked files restore through git while
 * untracked files delete through the fs seam, with the membership check on
 * the ABSOLUTE path (regression: comparing repo-relative paths against the
 * resolved absolute list silently failed every discard).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService, subprocessRunner, type GitRunner } from '../src/host/git-service.ts'
import type { WorkspaceGate } from '../src/host/gate.ts'

const ROOT = '/w'
const REPO = '/w'

/** A runner recording argv, canned per-command. */
function fakeRunner(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: GitRunner = {
    async run(argv, cwd) {
      calls.push([...argv, `@${cwd}`])
      const command = argv[0]
      if (command === 'rev-parse' && argv[1] === '--show-toplevel') {
        return { exitCode: 0, stdout: `${REPO}\n`, stderr: '' }
      }
      if (command === 'rev-parse' && argv[1] === '--abbrev-ref') {
        return { exitCode: 0, stdout: 'main\n', stderr: '' }
      }
      if (command === 'status') {
        return { exitCode: 0, stdout: 'M  tracked.txt\0?? new.txt\0', stderr: '' }
      }
      if (command === 'ls-files') {
        // Batch -z form: stdout echoes the tracked matches (new.txt is the
        // fixture's untracked path); discard classifies from this output.
        if (argv.includes('-z')) {
          const tracked = argv
            .filter((arg) => arg.startsWith(':(literal)') && arg !== ':(literal)new.txt')
            .map((arg) => arg.slice(':(literal)'.length))
          return { exitCode: 0, stdout: tracked.map((name) => name + '\0').join(''), stderr: '' }
        }
        // --error-unmatch fails for untracked paths. Paths are passed with the
        // :(literal) pathspec magic so names can't be parsed as magic tokens.
        return argv.some((arg) => arg === ':(literal)' + 'new.txt')
          ? { exitCode: 1, stdout: '', stderr: 'no match' }
          : { exitCode: 0, stdout: '', stderr: '' }
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  }
  return { runner, calls }
}

const gate: WorkspaceGate = async (root) => ({ ok: true, canonical: root })

const execFileAsync = promisify(execFile)

/** Real git runner for repository-discovery integration coverage. */
const realRunner: GitRunner = {
  async run(argv, cwd) {
    try {
      const { stdout, stderr } = await execFileAsync('git', [...argv], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 1 << 20,
      })
      return { exitCode: 0, stdout, stderr }
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string }
      return {
        exitCode: failure.code ?? 1,
        stdout: failure.stdout ?? '',
        stderr: failure.stderr ?? '',
      }
    }
  },
}

/** Run a git command with a local test identity. */
async function realGit(repo: string, ...argv: string[]): Promise<void> {
  const result = await realRunner.run([
    '-c', 'user.email=test@dsh.local',
    '-c', 'user.name=Test',
    ...argv,
  ], repo)
  if (result.exitCode !== 0) throw new Error(result.stderr)
}

describe('GitService nested repository discovery', () => {
  let workspace: string
  let nested: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'aionui-nested-repos-'))
    nested = join(workspace, 'nested')

    await realGit(workspace, 'init', '-b', 'main')
    await writeFile(join(workspace, '.gitignore'), 'nested/\n')
    await writeFile(join(workspace, 'outer.txt'), 'outer baseline\n')
    await realGit(workspace, 'add', '.')
    await realGit(workspace, 'commit', '-m', 'outer baseline')

    await mkdir(nested)
    await realGit(nested, 'init', '-b', 'main')
    await writeFile(join(nested, 'inner.txt'), 'inner baseline\n')
    await realGit(nested, 'add', '.')
    await realGit(nested, 'commit', '-m', 'inner baseline')

    await writeFile(join(workspace, 'outer.txt'), 'outer changed\n')
    await writeFile(join(nested, 'inner.txt'), 'inner changed\n')
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('lists changes from the workspace repository and ignored nested repositories', async () => {
    const service = new GitService(realRunner, gate, async () => ({ ok: true as const }))

    const repositories = await service.repositories(workspace)

    expect(repositories).toEqual([
      expect.objectContaining({ root: workspace, unstaged: [expect.objectContaining({ path: 'outer.txt' })] }),
      expect.objectContaining({ root: nested, unstaged: [expect.objectContaining({ path: 'inner.txt' })] }),
    ])
  })

  it('routes stage operations to the selected nested repository', async () => {
    const service = new GitService(realRunner, gate, async () => ({ ok: true as const }))

    const result = await service.stage(workspace, ['inner.txt'], nested)

    expect(result).toEqual({ applied: ['inner.txt'], failed: [] })
    const nestedIndex = await realRunner.run(['diff', '--cached', '--name-only'], nested)
    const outerIndex = await realRunner.run(['diff', '--cached', '--name-only'], workspace)
    expect(nestedIndex.stdout.trim()).toBe('inner.txt')
    expect(outerIndex.stdout.trim()).toBe('')
  })

  it('reads diffs from the selected nested repository', async () => {
    const service = new GitService(realRunner, gate, async () => ({ ok: true as const }))

    const result = await service.diff(workspace, 'inner.txt', false, nested)

    expect(result).toHaveProperty('content')
    expect('content' in result ? result.content : '').toContain('+inner changed')
  })

  it('routes unstage operations to the selected nested repository', async () => {
    const service = new GitService(realRunner, gate, async () => ({ ok: true as const }))
    await service.stage(workspace, ['inner.txt'], nested)

    const result = await service.unstage(workspace, ['inner.txt'], nested)

    expect(result).toEqual({ applied: ['inner.txt'], failed: [] })
    const nestedIndex = await realRunner.run(['diff', '--cached', '--name-only'], nested)
    expect(nestedIndex.stdout.trim()).toBe('')
  })

  it('routes discard operations to the selected nested repository', async () => {
    const service = new GitService(realRunner, gate, async () => ({ ok: true as const }))

    const result = await service.discard(workspace, ['inner.txt'], nested)

    expect(result).toEqual({ applied: ['inner.txt'], failed: [] })
    const nestedWorktree = await realRunner.run(['diff', '--name-only'], nested)
    expect(nestedWorktree.stdout.trim()).toBe('')
  })
})

describe('GitService.discard', () => {
  it('deletes untracked files through the fs seam (absolute membership check)', async () => {
    const { runner, calls } = fakeRunner()
    const fsDelete = vi.fn(async () => ({ ok: true as const }))
    const service = new GitService(runner, gate, fsDelete)

    const result = await service.discard(ROOT, ['new.txt'])
    expect(result).toEqual({ applied: ['new.txt'], failed: [] })
    expect(fsDelete).toHaveBeenCalledWith(ROOT, 'new.txt')
  })

  it('restores tracked files through git and never touches the fs seam', async () => {
    const { runner, calls } = fakeRunner()
    const fsDelete = vi.fn(async () => ({ ok: true as const }))
    const service = new GitService(runner, gate, fsDelete)

    const result = await service.discard(ROOT, ['tracked.txt'])
    expect(result).toEqual({ applied: ['tracked.txt'], failed: [] })
    expect(fsDelete).not.toHaveBeenCalled()
    expect(calls.some((call) => call[0] === 'restore' && call[1] === '--worktree')).toBe(true)
  })

  it('rejects paths outside the repo root', async () => {
    const { runner, calls } = fakeRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.discard(ROOT, ['../outside.txt'])
    expect(result).toEqual({ applied: [], failed: ['../outside.txt'] })
  })

  it('reports fs-seam failures in failed[]', async () => {
    const { runner, calls } = fakeRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({
      code: 'write-failed' as const,
      message: 'nope',
    })))
    const result = await service.discard(ROOT, ['new.txt'])
    expect(result).toEqual({ applied: [], failed: ['new.txt'] })
  })
})

describe('GitService.stage/unstage', () => {
  it('stages through git add and reports outside paths as failed', async () => {
    const { runner, calls } = fakeRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.stage(ROOT, ['new.txt', '../evil.txt'])
    expect(result.applied).toEqual(['new.txt'])
    expect(result.failed).toEqual(['../evil.txt'])
    expect(calls.some((call) => call[0] === 'add')).toBe(true)
  })

  it('unstages through git restore --staged', async () => {
    const { runner, calls } = fakeRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.unstage(ROOT, ['tracked.txt'])
    expect(result.applied).toEqual(['tracked.txt'])
    expect(calls.some((call) => call[0] === 'restore' && call[1] === '--staged')).toBe(true)
  })
})

describe('GitService.diff', () => {
  const DIFF_OUT = 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n'

  function diffRunner(): { runner: GitRunner; calls: string[][] } {
    const calls: string[][] = []
    const runner: GitRunner = {
      async run(argv, cwd) {
        calls.push([...argv, `@${cwd}`])
        const command = argv[0]
        if (command === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: `${REPO}\n`, stderr: '' }
        }
        if (command === 'ls-files') {
          return argv.includes('new.txt')
            ? { exitCode: 1, stdout: '', stderr: 'no match' }
            : { exitCode: 0, stdout: '', stderr: '' }
        }
        if (command === 'diff') {
          return { exitCode: argv.includes('--no-index') ? 1 : 0, stdout: DIFF_OUT, stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    return { runner, calls }
  }

  it('diffs the worktree against the index for unstaged paths', async () => {
    const { runner, calls } = diffRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.diff(ROOT, 'a.txt', false)
    expect(result).toEqual({ content: DIFF_OUT })
    expect(calls.some((call) => call[0] === 'diff' && call[1] === '--' && call[2] === 'a.txt')).toBe(true)
    expect(calls.some((call) => call.includes('--cached'))).toBe(false)
  })

  it('diffs the index against HEAD for staged paths', async () => {
    const { runner, calls } = diffRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.diff(ROOT, 'a.txt', true)
    expect(result).toEqual({ content: DIFF_OUT })
    expect(calls.some((call) => call[0] === 'diff' && call[1] === '--cached' && call[2] === '--')).toBe(true)
  })

  it('diffs untracked paths against /dev/null and treats exit 1 as success', async () => {
    const { runner, calls } = diffRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.diff(ROOT, 'new.txt', false)
    expect(result).toEqual({ content: DIFF_OUT })
    expect(calls.some((call) => call[0] === 'diff' && call.includes('--no-index') && call.includes('/dev/null'))).toBe(true)
  })

  it('rejects paths outside the repo root', async () => {
    const { runner } = diffRunner()
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))
    const result = await service.diff(ROOT, '../outside.txt', false)
    expect('content' in result).toBe(false)
  })
})

describe('GitService repository detection cache', () => {
  it('probes rev-parse once per workspace and never spawns status for non-repos', async () => {
    const calls: string[][] = []
    const runner: GitRunner = {
      async run(argv, cwd) {
        calls.push([...argv, `@${cwd}`])
        if (argv[0] === '--version') return { exitCode: 0, stdout: 'git version 2.39.0\n', stderr: '' }
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 128, stdout: '', stderr: 'not a git repository' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))

    expect(await service.isRepository(ROOT)).toBe(false)
    expect(await service.isRepository(ROOT)).toBe(false)
    expect(await service.status(ROOT)).toBeNull()
    expect(await service.status(ROOT)).toBeNull()

    expect(calls.filter((call) => call[0] === 'rev-parse' && call[1] === '--show-toplevel')).toHaveLength(1)
    expect(calls.some((call) => call[0] === 'status')).toBe(false)
  })

  it('caches the repo top-level so repeated status calls skip rev-parse', async () => {
    const calls: string[][] = []
    const runner: GitRunner = {
      async run(argv, cwd) {
        calls.push([...argv, `@${cwd}`])
        if (argv[0] === '--version') return { exitCode: 0, stdout: 'git version 2.39.0\n', stderr: '' }
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: `${REPO}\n`, stderr: '' }
        }
        if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') {
          return { exitCode: 0, stdout: 'main\n', stderr: '' }
        }
        if (argv[0] === 'status') return { exitCode: 0, stdout: '', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))

    expect(await service.isRepository(ROOT)).toBe(true)
    const first = await service.status(ROOT)
    const second = await service.status(ROOT)
    expect(first).toMatchObject({ root: ROOT, branch: 'main' })
    expect(second).toMatchObject({ root: ROOT, branch: 'main' })

    expect(calls.filter((call) => call[0] === 'rev-parse' && call[1] === '--show-toplevel')).toHaveLength(1)
    expect(calls.filter((call) => call[0] === 'status')).toHaveLength(2)
  })
})

describe('GitService repository cache TTL and self-heal', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('re-detects a repository after the negative verdict expires (git init later)', async () => {
    const calls: string[][] = []
    let isRepo = false
    const runner: GitRunner = {
      async run(argv) {
        calls.push([...argv])
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return isRepo
            ? { exitCode: 0, stdout: `${REPO}\n`, stderr: '' }
            : { exitCode: 128, stdout: '', stderr: 'not a git repository' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))

    expect(await service.isRepositoryCanonical(ROOT)).toBe(false)
    expect(await service.isRepositoryCanonical(ROOT)).toBe(false)
    isRepo = true
    // The negative verdict is still fresh, so git init is not seen yet.
    expect(await service.isRepositoryCanonical(ROOT)).toBe(false)

    // Negative TTL is 30s; once it expires the next probe finds the repo.
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await service.isRepositoryCanonical(ROOT)).toBe(true)

    expect(calls.filter((call) => call[0] === 'rev-parse' && call[1] === '--show-toplevel')).toHaveLength(2)
  })

  it('never caches a 127 rev-parse failure and retries on the next call', async () => {
    const calls: string[][] = []
    const runner: GitRunner = {
      async run(argv) {
        calls.push([...argv])
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 127, stdout: '', stderr: 'spawn ENOENT' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))

    expect(await service.isRepositoryCanonical(ROOT)).toBe(false)
    expect(await service.isRepositoryCanonical(ROOT)).toBe(false)
    expect(await service.statusCanonical(ROOT)).toBeNull()

    expect(calls.filter((call) => call[0] === 'rev-parse' && call[1] === '--show-toplevel')).toHaveLength(3)
    expect(calls.some((call) => call[0] === 'status')).toBe(false)
  })

  it('re-probes rev-parse after the positive verdict expires', async () => {
    const calls: string[][] = []
    const runner: GitRunner = {
      async run(argv) {
        calls.push([...argv])
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: `${REPO}\n`, stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(runner, gate, vi.fn(async () => ({ ok: true as const })))

    expect(await service.isRepositoryCanonical(ROOT)).toBe(true)
    expect(await service.isRepositoryCanonical(ROOT)).toBe(true)

    // Positive TTL is 60s; after expiry the next call re-runs rev-parse.
    await vi.advanceTimersByTimeAsync(60_001)
    expect(await service.isRepositoryCanonical(ROOT)).toBe(true)

    expect(calls.filter((call) => call[0] === 'rev-parse' && call[1] === '--show-toplevel')).toHaveLength(2)
  })
})

describe('subprocessRunner spawn degradation', () => {
  const collected = {
    stdout: { readFrom: (offset: number) => ({ text: 'ok' }) },
    stderr: { readFrom: (offset: number) => ({ text: '' }) },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('degrades to a failed run when spawn throws synchronously', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = {
      subprocess: {
        spawn: vi.fn(() => {
          throw new Error('spawn ENOENT')
        }),
      },
    }
    const runner = subprocessRunner(ctx as never)

    const result = await runner.run(['status'], '/w')

    expect(result.exitCode).toBe(127)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('spawn failed')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('returns the spawned outcome with collected output', async () => {
    const ctx = {
      subprocess: {
        spawn: vi.fn(() => ({
          done: Promise.resolve({ exitCode: 0 }),
          collected,
        })),
      },
    }
    const runner = subprocessRunner(ctx as never)

    const result = await runner.run(['status'], '/w')

    expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    expect(ctx.subprocess.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ argv: ['git', 'status'], cwd: '/w' }),
    )
  })

  it('degrades to a failed run when the done promise rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = {
      subprocess: {
        spawn: vi.fn(() => ({
          done: Promise.reject(new Error('killed')),
          collected,
        })),
      },
    }
    const runner = subprocessRunner(ctx as never)

    const result = await runner.run(['status'], '/w')

    expect(result.exitCode).toBe(127)
    expect(result.stderr).toContain('run failed')
    expect(errorSpy).toHaveBeenCalled()
  })
})
