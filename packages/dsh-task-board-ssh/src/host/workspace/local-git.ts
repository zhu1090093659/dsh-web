/**
 * The local half of the workspace strategies: git on `node:child_process`.
 *
 * Every call is `execFile` with an argument vector, so no path, ref or branch
 * name ever passes through a shell on this side either. Two operations touch
 * the workspace repository, and neither can change what the user is working on:
 * `git stash create` writes objects and returns a commit without touching the
 * working tree, the index, a ref or the stash list, and `git fetch` writes one
 * new ref plus objects, with `--no-write-fetch-head` so not even
 * `.git/FETCH_HEAD` moves. Nothing here checks out, resets or stashes.
 *
 * @module dsh-task-board-ssh/host/workspace/local-git
 */
import { execFile } from 'node:child_process'
import { SshWorkspaceError, boundedLine } from './errors.ts'

/** Ceiling on one local git command's captured output, in bytes. */
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024

/** Object name shape a bundle's start commit has between here and the host. */
const COMMIT_RE = /^[0-9a-f]{40,64}$/

/** What a working-tree snapshot found, and what it left behind. */
export interface LocalWorkspaceSnapshot {
  /** Commit `HEAD` points at. */
  head: string
  /** Commit the run branch starts from: the snapshot when dirty, `head` otherwise. */
  base: string
  /** Whether tracked but uncommitted changes were folded in. */
  dirty: boolean
}

/**
 * Read the diagnosis out of a failed git invocation.
 * @param error - what `execFile` reported.
 * @returns one bounded line.
 */
function describeGitFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  if (typeof stderr === 'string') {
    const line = boundedLine(stderr)
    if (line !== undefined) return line
  }
  const message = error instanceof Error ? error.message : String(error)
  return boundedLine(message) ?? 'unknown failure'
}

/**
 * Run one git command against one repository.
 * @param repository - path handed to `git -C`, so no working directory is shared.
 * @param args - git arguments, unquoted and unjoined.
 * @param signal - cancellation of the run this command serves.
 * @returns captured standard output.
 * @throws SshWorkspaceError when git failed, or the abort itself when cancelled.
 */
export async function runLocalGit(repository: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  const argv = ['--no-pager', '-C', repository, ...args]
  return await new Promise<string>((resolve, reject) => {
    execFile('git', argv, { encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES, signal }, (error, stdout) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      if (error.name === 'AbortError' || (error as { code?: unknown }).code === 'ABORT_ERR') {
        reject(error)
        return
      }
      reject(new SshWorkspaceError(`git ${args.join(' ')} failed: ${describeGitFailure(error)}`, { cause: error }))
    })
  })
}

/**
 * Require one path to be the root of a working tree.
 * @param repository - candidate repository path.
 * @param signal - cancellation of the run this command serves.
 * @throws SshWorkspaceError when the path is not a work tree of any repository.
 */
export async function assertLocalWorkTree(repository: string, signal?: AbortSignal): Promise<void> {
  const inside = (await runLocalGit(repository, ['rev-parse', '--is-inside-work-tree'], signal)).trim()
  if (inside !== 'true') throw new SshWorkspaceError(`the local workspace is not a git work tree: ${repository}`)
}

/**
 * Count the untracked files a bundle does not carry.
 *
 * Ignored files stay out: a `node_modules` is not something the card has to
 * warn about, and counting it would make the number meaningless.
 * @param repository - local workspace repository.
 * @param signal - cancellation of the run this command serves.
 * @returns how many untracked, non-ignored files the working tree holds.
 */
export async function countUntrackedFiles(repository: string, signal?: AbortSignal): Promise<number> {
  const listing = await runLocalGit(repository, ['ls-files', '--others', '--exclude-standard', '-z'], signal)
  return listing.split('\u0000').filter(entry => entry !== '').length
}

/**
 * Refuse an object name that is not one.
 * @param commit - candidate commit read from git.
 * @returns the commit, unchanged.
 * @throws SshWorkspaceError when it has the wrong shape, so it never reaches a host.
 */
function assertCommit(commit: string): string {
  if (!COMMIT_RE.test(commit)) {
    throw new SshWorkspaceError(`git reported an object name that is not a commit: ${commit}`)
  }
  return commit
}

/**
 * Bundle the state a remote run starts from.
 *
 * `HEAD` is the history the bundle carries. When the working tree holds tracked
 * uncommitted changes, their snapshot commit travels with it, so the run starts
 * from what the user has on disk rather than from what they last committed.
 * @param input - repository, destination and cancellation.
 * @returns the commit the run branch starts from, and whether it was a snapshot.
 * @throws SshWorkspaceError when the repository has no commit or git refused.
 */
export async function createWorkspaceBundle(input: {
  /** Local workspace repository. */
  repository: string
  /** Local path the bundle is written to. */
  bundlePath: string
  /** Cancellation of the run this bundle serves. */
  signal?: AbortSignal
}): Promise<LocalWorkspaceSnapshot> {
  const { repository, bundlePath, signal } = input
  await assertLocalWorkTree(repository, signal)
  const head = assertCommit((await runLocalGit(repository, ['rev-parse', '--verify', 'HEAD'], signal)).trim())
  const snapshot = (await runLocalGit(repository, ['stash', 'create'], signal)).trim()
  const dirty = snapshot !== ''
  const base = dirty ? assertCommit(snapshot) : head
  const revisions = dirty ? [base, 'HEAD'] : ['HEAD']
  await runLocalGit(repository, ['bundle', 'create', '--quiet', bundlePath, ...revisions], signal)
  return { head, base, dirty }
}

/**
 * Fetch the branch a host bundled back into the local repository.
 *
 * The working tree, the index, `HEAD` and the stash list are untouched: a fetch
 * writes the branch ref and objects only, and the run's result stays a branch
 * the user can inspect before doing anything with it.
 * @param input - repository, bundle and destination branch.
 * @throws SshWorkspaceError when the bundle does not apply or git refused.
 */
export async function fetchRunBranch(input: {
  /** Local workspace repository. */
  repository: string
  /** Local path of the downloaded bundle. */
  bundlePath: string
  /** Branch ref the bundle's branch is written to. */
  branchRef: string
  /** Cancellation of the run this fetch serves. */
  signal?: AbortSignal
}): Promise<void> {
  await runLocalGit(
    input.repository,
    ['fetch', '--no-write-fetch-head', '--no-tags', input.bundlePath, `+${input.branchRef}:${input.branchRef}`],
    input.signal,
  )
}
