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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GIT_LOCALE_ENV } from '../src/core/git-command.ts'
import { GitService, type GitRunResult, type WorkspaceGate } from '../src/host/git-service.ts'

const execFileAsync = promisify(execFile)

/** Plain child_process runner standing in for the subprocess seam. */
const runner = {
  async run(argv: readonly string[], cwd: string): Promise<GitRunResult> {
    try {
      const { stdout, stderr } = await execFileAsync('git', [...argv], {
        // Pin the locale like the production runner: the failure classifier
        // matches English stderr regardless of the ambient locale.
        cwd, encoding: 'utf8', maxBuffer: 1 << 20, env: { ...process.env, ...GIT_LOCALE_ENV },
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
})
