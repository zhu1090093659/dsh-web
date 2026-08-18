/**
 * Git service integration tests over the real git binary in temp
 * repositories: listing, switching, creating, and every guard rejection
 * path (conflicts, in-progress operations, other-worktree checkouts,
 * overwrite classification, name gates, workspace gating).
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GitService, gitSpawnArgv, type GitRunner, type GitRunResult, type WorkspaceGate } from '../src/host/git-service.ts'

const execFileAsync = promisify(execFile)

/** Plain child_process runner standing in for the subprocess seam. */
const runner = {
  async run(argv: readonly string[], cwd: string): Promise<GitRunResult> {
    try {
      const { stdout, stderr } = await execFileAsync('git', [...argv], {
        cwd, encoding: 'utf8', maxBuffer: 1 << 20,
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

/** Gate that admits exactly the seeded workspace roots. */
function allowGate(...paths: string[]): WorkspaceGate {
  const allowed = new Set(paths)
  return async (path) => {
    if (!allowed.has(path)) {
      return { ok: false, error: { code: 'workspace-unknown', message: 'not a workspace' } }
    }
    return { ok: true, canonical: path }
  }
}

/** Run one git command in the repo with identity overrides (commits need them). */
async function git(repo: string, ...args: string[]): Promise<GitRunResult> {
  return runner.run(['-c', 'user.email=test@dsh.local', '-c', 'user.name=Test', ...args], repo)
}

/** Commit the current index (or an empty commit) on the checked-out branch. */
async function commit(repo: string, message: string): Promise<void> {
  await git(repo, 'commit', '--allow-empty', '-m', message)
}

describe('GitService', () => {
  let root: string
  let repo: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-git-graph-'))
    repo = join(root, 'repo')
    await mkdir(repo)
    await git(repo, 'init', '-b', 'main')
    await writeFile(join(repo, 'README.md'), 'hello\n')
    await git(repo, 'add', '.')
    await commit(repo, 'initial')
    await git(repo, 'checkout', '-b', 'feature/x')
    await writeFile(join(repo, 'feature.txt'), 'x\n')
    await git(repo, 'add', '.')
    await commit(repo, 'feature work')
    await git(repo, 'checkout', 'main')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const service = (): GitService => new GitService(runner, allowGate(repo))

  it('reports status with the current branch, head, and dirtiness', async () => {
    const status = await service().status(repo)
    expect(status).not.toBeNull()
    expect(status?.branch).toBe('main')
    expect(status?.head).toMatch(/^[0-9a-f]{7}$/)
    expect(status?.dirtyFiles).toBe(0)
    await writeFile(join(repo, 'README.md'), 'changed\n')
    const dirty = await service().status(repo)
    expect(dirty?.dirtyFiles).toBe(1)
  })

  it('returns null for non-repositories and gated paths', async () => {
    const outside = join(root, 'not-a-repo')
    await mkdir(outside)
    expect(await service().status(outside)).toBeNull()
    const service2 = new GitService(runner, allowGate())
    expect(await service2.status(repo)).toBeNull()
  })

  it('lists local branches with the current one marked', async () => {
    const view = await service().branches(repo)
    expect(view).not.toBeNull()
    expect(view?.branch).toBe('main')
    expect(view?.branches.map(row => [row.name, row.current])).toEqual([
      ['feature/x', false],
      ['main', true],
    ])
  })

  it('switches the workspace branch for real', async () => {
    const result = await service().switchBranch(repo, 'feature/x')
    expect(result).toEqual({ ok: true, branch: 'feature/x' })
    const status = await service().status(repo)
    expect(status?.branch).toBe('feature/x')
  })

  it('treats switching to the current branch as a no-op success', async () => {
    const result = await service().switchBranch(repo, 'main')
    expect(result).toEqual({ ok: true, branch: 'main' })
  })

  it('rejects a missing target branch', async () => {
    const result = await service().switchBranch(repo, 'nope')
    expect(result).toEqual({ ok: false, error: { code: 'target-branch-not-found', message: expect.any(String) } })
  })

  it('rejects switching with unresolved conflicts', async () => {
    await git(repo, 'checkout', '-b', 'conflicting', 'main')
    await writeFile(join(repo, 'README.md'), 'from conflicting\n')
    await git(repo, 'add', '.')
    await commit(repo, 'conflicting edit')
    await git(repo, 'checkout', 'main')
    await writeFile(join(repo, 'README.md'), 'from main\n')
    await git(repo, 'add', '.')
    await commit(repo, 'main edit')
    await git(repo, 'merge', 'conflicting')
    const result = await service().switchBranch(repo, 'feature/x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('conflicts-present')
  })

  it('rejects switching during an in-progress operation', async () => {
    await writeFile(join(repo, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    const result = await service().switchBranch(repo, 'feature/x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('operation-in-progress')
  })

  it('rejects switching to a branch checked out in another worktree', async () => {
    const other = join(root, 'wt2')
    await git(repo, 'worktree', 'add', '-b', 'wt-branch', other)
    const result = await service().switchBranch(repo, 'wt-branch')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('branch-in-other-worktree')
  })

  it('classifies an untracked-file overwrite with the blocked paths', async () => {
    await git(repo, 'checkout', '-b', 'blocks', 'main')
    await writeFile(join(repo, 'blocked.txt'), 'tracked\n')
    await git(repo, 'add', '.')
    await commit(repo, 'adds blocked.txt')
    await git(repo, 'checkout', 'main')
    await writeFile(join(repo, 'blocked.txt'), 'untracked\n')
    const result = await service().switchBranch(repo, 'blocks')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('untracked-changes-would-be-overwritten')
      expect(result.error.paths).toEqual(['blocked.txt'])
    }
  })

  it('creates and switches to a new branch from the current HEAD', async () => {
    const result = await service().createBranch(repo, 'feature/new')
    expect(result).toEqual({ ok: true, branch: 'feature/new' })
    const status = await service().status(repo)
    expect(status?.branch).toBe('feature/new')
  })

  it('rejects duplicate branch names', async () => {
    const result = await service().createBranch(repo, 'feature/x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('branch-already-exists')
  })

  it('rejects invalid branch names', async () => {
    for (const name of ['bad name', 'a..b', '-lead']) {
      const result = await service().createBranch(repo, name)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('invalid-branch-name')
    }
  })

  it('serves the topo-ordered graph with refs', async () => {
    await git(repo, 'checkout', '-b', 'graph-branch', 'main')
    await commit(repo, 'graph work')
    await git(repo, 'checkout', 'main')
    await git(repo, 'tag', 'v1')
    const view = await service().graph(repo, 50)
    expect(view).not.toBeNull()
    expect(view?.commits.length).toBeGreaterThanOrEqual(2)
    expect(view?.commits.some(commit => commit.refs.includes('main'))).toBe(true)
    expect(view?.commits.some(commit => commit.refs.includes('v1'))).toBe(true)
    expect(view?.hasMore).toBe(false)
  })

  it('rejects mutation on a path outside the workspace registry', async () => {
    const result = await service().switchBranch(repo, 'feature/x')
    expect(result).toEqual({ ok: true, branch: 'feature/x' })
    const service2 = new GitService(runner, allowGate())
    const rejected = await service2.switchBranch(repo, 'feature/x')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error.code).toBe('workspace-unknown')
  })

  it('detects operation markers with a single rev-parse spawn', async () => {
    const calls: string[][] = []
    const countingRunner = {
      async run(argv: readonly string[], cwd: string): Promise<GitRunResult> {
        calls.push([...argv])
        return runner.run(argv, cwd)
      },
    }
    const service = new GitService(countingRunner, allowGate(repo))

    // A clean repo: exactly one --git-path spawn carrying all seven markers.
    expect(await service.status(repo)).toMatchObject({ operationInProgress: false })
    const markerCalls = calls.filter((argv) => argv[0] === 'rev-parse' && argv.includes('--git-path'))
    expect(markerCalls).toHaveLength(1)
    expect(markerCalls[0]).toEqual([
      'rev-parse',
      '--git-path', 'MERGE_HEAD',
      '--git-path', 'CHERRY_PICK_HEAD',
      '--git-path', 'REVERT_HEAD',
      '--git-path', 'BISECT_LOG',
      '--git-path', 'rebase-merge',
      '--git-path', 'rebase-apply',
      '--git-path', 'sequencer',
    ])

    // A real marker file flips the flag through the same single call.
    await writeFile(join(repo, '.git', 'MERGE_HEAD'), 'deadbeef\n')
    expect(await service.status(repo)).toMatchObject({ operationInProgress: true })
    expect(calls.filter((argv) => argv[0] === 'rev-parse' && argv.includes('--git-path'))).toHaveLength(2)
  })

  it('falls back to per-marker probes when the combined marker spawn returns non-zero', async () => {
    // A real operation marker flips the verdict; the combined spawn is made
    // to fail (exitCode 1 / empty stdout) so the fallback path must carry it.
    await writeFile(join(repo, '.git', 'MERGE_HEAD'), 'deadbeef\n')

    let combinedCalls = 0
    let singleMarkerCalls = 0
    const fallbackRunner = {
      async run(argv: readonly string[], cwd: string): Promise<GitRunResult> {
        const isRevParsePath = argv[0] === 'rev-parse' && argv.includes('--git-path')
        if (isRevParsePath) {
          const gitPathCount = argv.filter((arg) => arg === '--git-path').length
          if (gitPathCount > 1) {
            combinedCalls += 1
            return { exitCode: 1, stdout: '', stderr: '' }
          }
          singleMarkerCalls += 1
        }
        return runner.run(argv, cwd)
      },
    }
    const service = new GitService(fallbackRunner, allowGate(repo))

    // One combined spawn fails; the fallback probes every marker with its
    // own git rev-parse --git-path and MERGE_HEAD turns the verdict on.
    expect(await service.status(repo)).toMatchObject({ operationInProgress: true })
    expect(combinedCalls).toBe(1)
    expect(singleMarkerCalls).toBe(7)
  })
})

describe('gitSpawnArgv', () => {
  it('keeps the plain git binary on POSIX', () => {
    expect(gitSpawnArgv('linux', ['status', '--porcelain'])).toEqual(['git', 'status', '--porcelain'])
    expect(gitSpawnArgv('darwin', ['rev-parse', '--show-toplevel'])).toEqual(['git', 'rev-parse', '--show-toplevel'])
  })

  it('uses git.exe on Windows to bypass .cmd shims', () => {
    // git for Windows ships git.exe; a .cmd/.bat shim in PATH would be the
    // spawn resolution that Node cannot launch directly. Naming git.exe
    // always reaches the native executable.
    expect(gitSpawnArgv('win32', ['status', '--porcelain'])).toEqual(['git.exe', 'status', '--porcelain'])
  })
})

describe('GitService status single-flight', () => {
  it('shares the workspace gate before any git subprocess starts', async () => {
    let releaseGate: ((value: { ok: true; canonical: string }) => void) | undefined
    const gate = vi.fn((_path: string) => new Promise<{ ok: true; canonical: string }>((resolve) => { releaseGate = resolve }))
    const calls: string[][] = []
    const fakeRunner: GitRunner = {
      async run(argv) {
        calls.push([...argv])
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') return { exitCode: 0, stdout: '/repo\n', stderr: '' }
        if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') return { exitCode: 0, stdout: 'main\n', stderr: '' }
        if (argv[0] === 'rev-parse' && argv[1] === '--short') return { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const service = new GitService(fakeRunner, gate)

    const first = service.status('/w', new AbortController().signal)
    const second = service.status('/w', new AbortController().signal)
    await vi.waitFor(() => { expect(releaseGate).toBeTypeOf('function') })

    expect(gate).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(0)

    releaseGate!({ ok: true, canonical: '/w' })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ root: '/repo' }),
      expect.objectContaining({ root: '/repo' }),
    ])
  })

  it('shares one underlying status scan and its cancellation signal', async () => {
    let releaseStatus: ((result: GitRunResult) => void) | undefined
    let abortObserved = false
    const calls: Array<{ argv: readonly string[]; signal?: AbortSignal }> = []
    const fakeRunner: GitRunner = {
      async run(argv, _cwd, signal) {
        calls.push({ argv: [...argv], signal })
        if (argv[0] === 'rev-parse' && argv[1] === '--show-toplevel') {
          return { exitCode: 0, stdout: '/repo\n', stderr: '' }
        }
        if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') {
          return { exitCode: 0, stdout: 'main\n', stderr: '' }
        }
        if (argv[0] === 'status') {
          signal?.addEventListener('abort', () => { abortObserved = true }, { once: true })
          return new Promise((resolve) => { releaseStatus = resolve })
        }
        if (argv[0] === 'rev-parse' && argv[1] === '--short') {
          return { exitCode: 0, stdout: 'abc1234\n', stderr: '' }
        }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    }
    const gate: WorkspaceGate = async (path) => ({ ok: true, canonical: path })
    const service = new GitService(fakeRunner, gate)
    const firstController = new AbortController()
    const secondController = new AbortController()

    const first = service.status('/w', firstController.signal)
    const second = service.status('/w', secondController.signal)
    await vi.waitFor(() => { expect(releaseStatus).toBeTypeOf('function') })

    expect(calls.filter(({ argv }) => argv[0] === 'status')).toHaveLength(1)
    expect(calls.find(({ argv }) => argv[0] === 'status')?.signal).toBe(firstController.signal)

    firstController.abort(new Error('git status timed out'))
    expect(abortObserved).toBe(true)
    const retryWhileTerminating = service.status('/w', new AbortController().signal)
    await Promise.resolve()
    expect(calls.filter(({ argv }) => argv[0] === 'status')).toHaveLength(1)

    releaseStatus!({ exitCode: 0, stdout: '', stderr: '' })
    await expect(Promise.all([first, second, retryWhileTerminating])).resolves.toEqual([
      expect.objectContaining({ root: '/repo', head: 'abc1234' }),
      expect.objectContaining({ root: '/repo', head: 'abc1234' }),
      expect.objectContaining({ root: '/repo', head: 'abc1234' }),
    ])
  })
})
