/**
 * The three workspace strategies driven for real.
 *
 * No git call is mocked: every fixture repository is a real repository in a
 * temporary directory, and the "remote host" is a `dshSsh` face that runs each
 * command through `sh -c` on this machine and copies files for a transfer. That
 * is enough to exercise what the strategies actually promise — the cache, the
 * per-run worktree, the branch, the bundle round trip, and the fact that the
 * local repository comes out of it untouched.
 *
 * The waits are none: `prepare` and `collect` settle when their commands
 * settle, so nothing here polls a timer.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DshSshService } from '../src/core/contract.ts'
import type { SshGitSource } from '../src/core/target.ts'
import type { SshWorkspaceRun } from '../src/core/workspace.ts'
import { createSshWorkspaceStrategy, SshWorkspaceError } from '../src/host/workspace/index.ts'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-task-board-ssh-workspace-'))

/** Host alias every fixture run addresses. */
const HOST = 'workspace-fixture'

/** Identity the fixture commits use, so no global git config decides anything. */
const IDENTITY = [
  '-c',
  'user.name=workspace fixture',
  '-c',
  'user.email=workspace@example.test',
  '-c',
  'commit.gpgsign=false',
]

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

/** One command the fake host ran. */
interface RecordedCommand {
  /** Alias the command addressed. */
  alias: string
  /** Command line, as the strategy built it. */
  command: string
}

/**
 * A `dshSsh` face whose host is this machine.
 *
 * `exec` hands the command line to a real `sh`, which is what a remote host
 * does: a value the strategies failed to quote would split or execute here.
 * `upload` and `download` copy files, so a transfer has to name a path that
 * exists rather than merely return a byte count.
 */
function localSsh(): DshSshService & { readonly log: RecordedCommand[] } {
  const log: RecordedCommand[] = []
  return {
    log,
    apiVersion: 1,
    hosts: {
      list: () => [],
      find: () => undefined,
    },
    async exec(alias, command) {
      log.push({ alias, command })
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' })
      return {
        success: result.status === 0,
        exitCode: result.status,
        timedOut: false,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        durationMs: 0,
      }
    },
    async upload(_alias, localPath, remotePath) {
      copyFileSync(localPath, remotePath)
      return { bytes: statSync(remotePath).size, files: 1 }
    },
    async download(_alias, remotePath, localPath) {
      copyFileSync(remotePath, localPath)
      return { bytes: statSync(localPath).size }
    },
  }
}

/** Run one git command against a fixture repository and return its raw output. */
function fixtureGit(repository: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' })
}

/** Run one git command and keep its exit code, for "this must be absent" checks. */
function fixtureGitCode(repository: string, ...args: string[]): number {
  return spawnSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).status ?? -1
}

/** Commit what is staged in one fixture repository, and return the new commit. */
function fixtureCommit(repository: string, message: string): string {
  execFileSync('git', ['-C', repository, ...IDENTITY, 'commit', '-q', '-m', message], { encoding: 'utf8' })
  return fixtureGit(repository, 'rev-parse', 'HEAD').trim()
}

/** Create an empty work tree repository with a branch and a local identity. */
function createRepository(path: string): string {
  execFileSync('git', ['init', '-q', '-b', 'main', path], { encoding: 'utf8' })
  for (const [key, value] of [['user.name', 'workspace fixture'], ['user.email', 'workspace@example.test']] as const) {
    execFileSync('git', ['-C', path, 'config', key, value], { encoding: 'utf8' })
  }
  return path
}

/** Create a repository whose main branch carries one file. */
function seedRepository(path: string, fileName = 'README.md', content = 'fixture\n'): string {
  const repository = createRepository(path)
  writeFileSync(join(repository, fileName), content)
  fixtureGit(repository, 'add', fileName)
  fixtureCommit(repository, 'first commit')
  return repository
}

/** Clone one fixture repository into the bare repository a url source points at. */
function createBareRemote(source: string, path: string): string {
  execFileSync('git', ['clone', '-q', '--bare', source, path], { encoding: 'utf8' })
  return path
}

/** One run addressed at the fixture host. */
function makeRun(options: {
  runId: string
  stateDir: string
  ssh?: DshSshService
  source?: SshGitSource
  localRepository?: string
}): SshWorkspaceRun {
  return {
    runId: options.runId,
    host: HOST,
    stateDir: options.stateDir,
    ssh: options.ssh ?? localSsh(),
    source: options.source,
    localRepository: options.localRepository,
  }
}

/** Every file under one directory, recursively, relative to it. */
function listFiles(root: string): string[] {
  return existsSync(root) ? readdirSync(root, { recursive: true, encoding: 'utf8' }) : []
}

/** The one bare cache a fixture host holds for a source. */
function onlyCacheDir(stateDir: string): string {
  const entries = readdirSync(join(stateDir, 'repos'))
  return join(stateDir, 'repos', entries[0] as string)
}

/** Local scratch directories one run left behind, named after it. */
function scratchDirs(runId: string): string[] {
  return readdirSync(tmpdir()).filter(name => name.startsWith(`dsh-task-board-ssh-${runId}-`))
}

/** Wait for one promise and return what it rejected with. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(() => undefined, (error: unknown) => error)
}

describe('in-place workspace', () => {
  it('operator preparing a card pinned to an existing remote directory gets that directory back', async () => {
    // Given a remote directory whose name has a space and a quote
    const pinned = join(scratch, "in place 'pinned'")
    mkdirSync(pinned, { recursive: true })
    const strategy = createSshWorkspaceStrategy({ kind: 'in-place', path: pinned })
    const run = makeRun({ runId: 'run-in-place', stateDir: join(scratch, 'in-place-state') })

    // When the run is prepared
    const prepared = await strategy.prepare(run)

    // Then the pinned directory is the working directory, unchanged
    expect(prepared).toEqual({ cwd: pinned })

    // When it is collected
    const collected = await strategy.collect(run)

    // Then there is nothing to bring back: in-place work stays where it was made
    expect(collected).toEqual({})
  })

  it('operator whose pinned directory is missing gets a diagnostic error and no new directory', async () => {
    // Given a pinned directory that was never created
    const missing = join(scratch, "never created 'pinned'")
    const strategy = createSshWorkspaceStrategy({ kind: 'in-place', path: missing })

    // When the run is prepared
    const run = makeRun({ runId: 'run-missing', stateDir: join(scratch, 'missing-state') })
    const failure = await rejection(strategy.prepare(run))

    // Then the failure names the directory and says it was not created
    expect(failure).toBeInstanceOf(SshWorkspaceError)
    expect((failure as Error).message).toContain(missing)
    expect((failure as Error).message).toContain('does not exist')
    expect(existsSync(missing)).toBe(false)
  })

  it('operator whose host cannot be reached is told that, not that the directory is gone', async () => {
    // Given a host whose connection fails without running anything
    const unreachable: DshSshService = {
      ...localSsh(),
      async exec() {
        return {
          success: false,
          exitCode: null,
          timedOut: false,
          stdout: '',
          stderr: '',
          durationMs: 0,
          error: 'connection refused',
        }
      },
    }
    const strategy = createSshWorkspaceStrategy({ kind: 'in-place', path: join(scratch, 'unreachable-pinned') })

    // When the run is prepared
    const run = makeRun({ runId: 'run-unreachable', stateDir: join(scratch, 'unreachable-state'), ssh: unreachable })
    const failure = await rejection(strategy.prepare(run))

    // Then the diagnostic is about the host, not about a missing directory
    expect((failure as Error).message).toContain('cannot reach workspace-fixture')
    expect((failure as Error).message).toContain('connection refused')
  })
})

describe('git workspace from a url', () => {
  it('operator whose run commits in its worktree gets the branch pushed to that repository', async () => {
    // Given a bare repository the host reaches by path, with one commit on main
    const source = seedRepository(join(scratch, 'url-source'), 'README.md', 'one\n')
    const origin = createBareRemote(source, join(scratch, 'url-origin.git'))
    const base = fixtureGit(origin, 'rev-parse', 'refs/heads/main').trim()
    const stateDir = join(scratch, 'url-state')
    const ssh = localSsh()
    const target = { kind: 'git', source: { kind: 'url', url: origin, base: 'main' } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({ runId: 'run-url-1', stateDir, ssh, source: target.source })

    // When the run is prepared
    const prepared = await strategy.prepare(run)

    // Then the worktree sits on the pinned base ref, on the run's own branch
    expect(prepared).toEqual({ cwd: join(stateDir, 'workspaces', 'run-url-1') })
    expect(fixtureGit(prepared.cwd, 'rev-parse', 'HEAD').trim()).toBe(base)
    expect(fixtureGit(prepared.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dsh-task/run-url-1')
    expect(readFileSync(join(prepared.cwd, 'README.md'), 'utf8')).toBe('one\n')

    // When the run commits there
    writeFileSync(join(prepared.cwd, 'result.txt'), 'from the run\n')
    fixtureGit(prepared.cwd, 'add', 'result.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')

    // Then collect pushes the run branch to that repository
    await expect(strategy.collect(run)).resolves.toEqual({ branch: 'dsh-task/run-url-1' })
    expect(fixtureGit(origin, 'rev-parse', 'refs/heads/dsh-task/run-url-1').trim()).toBe(committed)
    expect(fixtureGit(origin, 'show', 'dsh-task/run-url-1:result.txt')).toBe('from the run\n')

    // Then every command addressed the run's host alias
    expect(ssh.log.length).toBeGreaterThan(0)
    expect(ssh.log.every(entry => entry.alias === HOST)).toBe(true)
  })

  it('operator preparing and collecting the same run twice gets the same result and no leftover bundle', async () => {
    // Given a prepared run whose worktree already carries a commit
    const source = seedRepository(join(scratch, 'url-idem-source'))
    const origin = createBareRemote(source, join(scratch, 'url-idem-origin.git'))
    const stateDir = join(scratch, 'url-idem-state')
    const target = { kind: 'git', source: { kind: 'url', url: origin } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({ runId: 'run-url-idem', stateDir, source: target.source })
    const prepared = await strategy.prepare(run)
    writeFileSync(join(prepared.cwd, 'result.txt'), 'once\n')
    fixtureGit(prepared.cwd, 'add', 'result.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')
    const firstCollection = await strategy.collect(run)

    // When prepare runs a second time
    const again = await strategy.prepare(run)

    // Then the same worktree comes back, on the same branch and the same commit
    expect(again).toEqual(prepared)
    expect(fixtureGit(prepared.cwd, 'rev-parse', 'HEAD').trim()).toBe(committed)
    expect(fixtureGit(prepared.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dsh-task/run-url-idem')

    // When collect runs a second time
    const secondCollection = await strategy.collect(run)

    // Then it reports what it reported the first time, and the branch still holds the commit
    expect(secondCollection).toEqual(firstCollection)
    expect(fixtureGit(origin, 'rev-parse', 'refs/heads/dsh-task/run-url-idem').trim()).toBe(committed)

    // Then one cache serves the run and nothing temporary is left behind
    expect(readdirSync(join(stateDir, 'repos'))).toHaveLength(1)
    expect(listFiles(stateDir).filter(file => file.endsWith('.bundle'))).toEqual([])
    expect(scratchDirs('run-url-idem')).toEqual([])
  })

  it('operator whose worktree directory disappeared gets it back on the same branch with its commits', async () => {
    // Given a prepared run that already committed, whose directory a person removed
    const source = seedRepository(join(scratch, 'url-restore-source'))
    const origin = createBareRemote(source, join(scratch, 'url-restore-origin.git'))
    const target = { kind: 'git', source: { kind: 'url', url: origin } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({
      runId: 'run-url-restore',
      stateDir: join(scratch, 'url-restore-state'),
      source: target.source,
    })
    const prepared = await strategy.prepare(run)
    writeFileSync(join(prepared.cwd, 'result.txt'), 'once\n')
    fixtureGit(prepared.cwd, 'add', 'result.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')
    rmSync(prepared.cwd, { recursive: true, force: true })

    // When prepare runs again
    const again = await strategy.prepare(run)

    // Then the worktree is back on the same branch, at the same commit, with its file
    expect(again.cwd).toBe(prepared.cwd)
    expect(fixtureGit(again.cwd, 'rev-parse', 'HEAD').trim()).toBe(committed)
    expect(fixtureGit(again.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dsh-task/run-url-restore')
    expect(readFileSync(join(again.cwd, 'result.txt'), 'utf8')).toBe('once\n')
  })

  it('operator whose run committed nothing gets no branch and no push', async () => {
    // Given a prepared run that never commits
    const source = seedRepository(join(scratch, 'url-empty-source'))
    const origin = createBareRemote(source, join(scratch, 'url-empty-origin.git'))
    const target = { kind: 'git', source: { kind: 'url', url: origin } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({ runId: 'run-url-empty', stateDir: join(scratch, 'url-empty-state'), source: target.source })
    await strategy.prepare(run)

    // When it is collected
    const collected = await strategy.collect(run)

    // Then the collection says there is no branch, and the repository has none
    expect(collected).toEqual({})
    expect(fixtureGitCode(origin, 'show-ref', '--verify', '--quiet', 'refs/heads/dsh-task/run-url-empty')).toBe(1)
  })

  it('operator whose directories and base branch carry awkward characters gets an intact round trip', async () => {
    // Given a repository whose base branch has a slash and a dot, and directories with a space and a quote
    const source = seedRepository(join(scratch, "url quote 'source'"), 'README.md', 'one\n')
    fixtureGit(source, 'branch', 'release/one.two')
    const origin = createBareRemote(source, join(scratch, "url quote 'origin'.git"))
    const base = fixtureGit(origin, 'rev-parse', 'refs/heads/release/one.two').trim()
    const stateDir = join(scratch, "url quoted 'state'")
    const target = { kind: 'git', source: { kind: 'url', url: origin, base: 'release/one.two' } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const runId = 'run.2026-11-19_quoted'
    const run = makeRun({ runId, stateDir, source: target.source })

    // When the run is prepared on a branch named after that run id
    const prepared = await strategy.prepare(run)

    // Then the worktree exists at the quoted path, on the slashed base branch's commit
    expect(prepared).toEqual({ cwd: join(stateDir, 'workspaces', runId) })
    expect(fixtureGit(prepared.cwd, 'rev-parse', 'HEAD').trim()).toBe(base)
    expect(fixtureGit(prepared.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(`dsh-task/${runId}`)

    // When the run commits and is collected
    writeFileSync(join(prepared.cwd, 'result.txt'), 'quoted round trip\n')
    fixtureGit(prepared.cwd, 'add', 'result.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')
    await strategy.collect(run)

    // Then the branch name survived both shells and the push
    expect(fixtureGit(origin, 'rev-parse', `refs/heads/dsh-task/${runId}`).trim()).toBe(committed)
    expect(fixtureGit(origin, 'show', `dsh-task/${runId}:result.txt`)).toBe('quoted round trip\n')
  })

  it('operator whose run id git would refuse is refused before anything leaves this machine', async () => {
    // Given a run id that cannot name a git ref
    const source = { kind: 'url', url: join(scratch, 'unused.git') } as const
    const strategy = createSshWorkspaceStrategy({ kind: 'git', source })
    const ssh = localSsh()

    // When the run is prepared
    const failure = await rejection(
      strategy.prepare(makeRun({ runId: 'run..escaped', stateDir: join(scratch, 'ref-state'), ssh })),
    )

    // Then the failure says so and no command was sent
    expect((failure as Error).message).toContain('cannot name a git branch')
    expect(ssh.log).toEqual([])
  })
})

describe('git workspace from the local workspace', () => {
  it('operator whose local repository has an uncommitted change gets it on the host and a branch back', async () => {
    // Given a local repository with one tracked change and one untracked file
    const repository = seedRepository(join(scratch, 'local-source'), 'app.txt', 'first\n')
    writeFileSync(join(repository, 'app.txt'), 'first\ndirty\n')
    writeFileSync(join(repository, 'notes.txt'), 'untracked\n')
    const before = {
      status: fixtureGit(repository, 'status', '--porcelain'),
      stash: fixtureGit(repository, 'stash', 'list'),
      branch: fixtureGit(repository, 'rev-parse', '--abbrev-ref', 'HEAD'),
      index: fixtureGit(repository, 'diff', '--cached', '--name-only'),
    }
    const stateDir = join(scratch, 'local-state')
    const target = { kind: 'git', source: { kind: 'workspace', workspaceId: 'workspace-fixture' } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({ runId: 'run-local-1', stateDir, source: target.source, localRepository: repository })
    expect(before.status).toBe(' M app.txt\n?? notes.txt\n')
    expect(before.stash).toBe('')
    expect(before.branch).toBe('main\n')

    // When the run is prepared
    const prepared = await strategy.prepare(run)

    // Then the host's worktree carries the tracked change and not the untracked file
    expect(prepared.cwd).toBe(join(stateDir, 'workspaces', 'run-local-1'))
    expect(fixtureGit(prepared.cwd, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('dsh-task/run-local-1')
    expect(readFileSync(join(prepared.cwd, 'app.txt'), 'utf8')).toBe('first\ndirty\n')
    expect(existsSync(join(prepared.cwd, 'notes.txt'))).toBe(false)
    expect(prepared.untrackedFiles).toBe(1)

    // When the run commits on the host
    writeFileSync(join(prepared.cwd, 'app.txt'), 'first\ndirty\nresult\n')
    fixtureGit(prepared.cwd, 'add', 'app.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')

    // Then collect fetches the result branch into the local repository
    await expect(strategy.collect(run)).resolves.toEqual({ branch: 'dsh-task/run-local-1' })
    expect(fixtureGit(repository, 'rev-parse', 'refs/heads/dsh-task/run-local-1').trim()).toBe(committed)
    expect(fixtureGit(repository, 'show', 'dsh-task/run-local-1:app.txt')).toBe('first\ndirty\nresult\n')

    // Then the local working tree, index, branch and stash list are exactly what they were
    expect(fixtureGit(repository, 'status', '--porcelain')).toBe(before.status)
    expect(fixtureGit(repository, 'stash', 'list')).toBe(before.stash)
    expect(fixtureGit(repository, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(before.branch)
    expect(fixtureGit(repository, 'diff', '--cached', '--name-only')).toBe(before.index)
  })

  it('operator repeating prepare and collect on one local run gets the same result and no residue', async () => {
    // Given a prepared run whose worktree carries a commit
    const repository = seedRepository(join(scratch, 'local-idem-source'), 'app.txt', 'first\n')
    const stateDir = join(scratch, 'local-idem-state')
    const target = { kind: 'git', source: { kind: 'workspace', workspaceId: 'workspace-idem' } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const run = makeRun({ runId: 'run-local-idem', stateDir, source: target.source, localRepository: repository })
    const prepared = await strategy.prepare(run)
    writeFileSync(join(prepared.cwd, 'result.txt'), 'once\n')
    fixtureGit(prepared.cwd, 'add', 'result.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')
    const firstCollection = await strategy.collect(run)
    const baseRef = 'refs/dsh-base/run-local-idem'
    const baseAfterFirstPrepare = fixtureGit(onlyCacheDir(stateDir), 'rev-parse', baseRef).trim()

    // When prepare runs a second time
    const again = await strategy.prepare(run)

    // Then the same worktree and the same note come back, and nothing moved
    expect(again).toEqual(prepared)
    expect(again.untrackedFiles).toBe(0)
    expect(fixtureGit(prepared.cwd, 'rev-parse', 'HEAD').trim()).toBe(committed)

    // When collect runs a second time
    const secondCollection = await strategy.collect(run)

    // Then it reports the same branch, at the same commit, off the same base
    expect(secondCollection).toEqual(firstCollection)
    expect(fixtureGit(repository, 'rev-parse', 'refs/heads/dsh-task/run-local-idem').trim()).toBe(committed)
    expect(fixtureGit(onlyCacheDir(stateDir), 'rev-parse', baseRef).trim()).toBe(baseAfterFirstPrepare)

    // Then no bundle survived on the host and no scratch directory on this machine
    expect(listFiles(stateDir).filter(file => file.endsWith('.bundle'))).toEqual([])
    expect(scratchDirs('run-local-idem')).toEqual([])
  })

  it('operator whose local repository is clean gets a worktree on HEAD and no untracked note', async () => {
    // Given a local repository with nothing uncommitted
    const repository = seedRepository(join(scratch, 'local-clean'), 'app.txt', 'first\n')
    const head = fixtureGit(repository, 'rev-parse', 'HEAD').trim()
    const stateDir = join(scratch, 'local-clean-state')
    const target = { kind: 'git', source: { kind: 'workspace', workspaceId: 'workspace-clean' } } as const
    const strategy = createSshWorkspaceStrategy(target)

    // When the run is prepared
    const prepared = await strategy.prepare(
      makeRun({ runId: 'run-local-clean', stateDir, source: target.source, localRepository: repository }),
    )

    // Then the worktree starts on the local HEAD and reports no untracked files
    expect(fixtureGit(prepared.cwd, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(prepared.untrackedFiles).toBe(0)
  })

  it('operator whose repository path and state directory are awkward gets an intact round trip', async () => {
    // Given a local repository at a path with a space and a quote
    const repository = seedRepository(join(scratch, "local quote 'source'"), 'app.txt', 'first\n')
    writeFileSync(join(repository, 'app.txt'), 'first\ndirty\n')
    const stateDir = join(scratch, "local quoted 'state'")
    const target = { kind: 'git', source: { kind: 'workspace', workspaceId: 'workspace-quoted' } } as const
    const strategy = createSshWorkspaceStrategy(target)
    const runId = 'run.local_2026-11-19'
    const run = makeRun({ runId, stateDir, source: target.source, localRepository: repository })

    // When the run is prepared
    const prepared = await strategy.prepare(run)

    // Then the worktree exists at the quoted path with the dirty file intact
    expect(prepared.cwd).toBe(join(stateDir, 'workspaces', runId))
    expect(readFileSync(join(prepared.cwd, 'app.txt'), 'utf8')).toBe('first\ndirty\n')

    // When the run commits and is collected
    writeFileSync(join(prepared.cwd, 'app.txt'), 'first\ndirty\nquoted\n')
    fixtureGit(prepared.cwd, 'add', 'app.txt')
    const committed = fixtureCommit(prepared.cwd, 'run result')
    await strategy.collect(run)

    // Then the branch reached the local repository under the same name
    expect(fixtureGit(repository, 'rev-parse', `refs/heads/dsh-task/${runId}`).trim()).toBe(committed)
  })

  it('operator whose run carries no local repository gets a diagnostic error instead of a remote failure', async () => {
    // Given a workspace source and a run that never resolved its repository
    const source = { kind: 'workspace', workspaceId: 'workspace-absent' } as const
    const strategy = createSshWorkspaceStrategy({ kind: 'git', source })
    const ssh = localSsh()

    // When the run is prepared
    const failure = await rejection(
      strategy.prepare(makeRun({ runId: 'run-local-absent', stateDir: join(scratch, 'local-absent-state'), ssh })),
    )

    // Then the failure names the workspace and no command was sent
    expect(failure).toBeInstanceOf(SshWorkspaceError)
    expect((failure as Error).message).toContain('workspace-absent')
    expect((failure as Error).message).toContain('was not resolved')
    expect(ssh.log).toEqual([])
  })
})
