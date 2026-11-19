/**
 * Every git command line a workspace strategy sends to a host.
 *
 * Built from `core/shell.ts` words and never by interpolating a path into a
 * string: the remote side is an arbitrary `sh` on a machine this package does
 * not own, so a directory whose name contains a space or a quote has to survive
 * as one argument. `GIT_TERMINAL_PROMPT=0` belongs to every command because a
 * remote run has nobody at a terminal to answer a credential prompt, and
 * `env` carries it instead of relying on a shell assignment.
 *
 * @module dsh-task-board-ssh/host/workspace/remote-git
 */
import { shellEnsureDir, shellJoin } from '../../core/shell.ts'
import type { SshGitSource } from '../../core/target.ts'
import type { GitWorkspaceLayout } from './layout.ts'

/** Prefix every remote git invocation carries. */
const GIT_PREFIX = ['env', 'GIT_TERMINAL_PROMPT=0', 'git'] as const

/** Namespace a url source's remote branches land in. */
const REMOTE_REF_NAMESPACE = 'refs/dsh-remote/'

/** Ref a url source's remote HEAD lands in. */
const REMOTE_HEAD_REF = 'refs/dsh-remote-head'

/**
 * Compose one git command line.
 * @param words - git arguments, unquoted.
 * @returns the quoted command line.
 */
function gitCommand(...words: readonly string[]): string {
  return shellJoin([...GIT_PREFIX, ...words])
}

/**
 * Ref a fetched url source leaves its start commit on.
 * @param source - the pinned url source.
 * @returns the remote branch's ref, or the remote HEAD's when no base was pinned.
 */
export function remoteStartRef(source: Extract<SshGitSource, { kind: 'url' }>): string {
  return source.base === undefined ? REMOTE_HEAD_REF : `${REMOTE_REF_NAMESPACE}${source.base}`
}

/**
 * Build the probe that answers whether one absolute directory exists.
 * @param path - absolute remote directory.
 * @returns one shell command.
 */
export function directoryProbeCommand(path: string): string {
  return shellJoin(['test', '-d', path])
}

/**
 * Build the probe that answers whether a run's worktree is already in place.
 * @param layout - the run's paths.
 * @returns one shell command that exits zero only when both halves hold.
 */
export function preparedProbeCommand(layout: GitWorkspaceLayout): string {
  const worktree = shellJoin(['test', '-d', layout.worktreeDir])
  return `${worktree} && ${branchProbeCommand(layout)}`
}

/**
 * Build the probe that answers whether a run's branch exists in the cache.
 * @param layout - the run's paths.
 * @returns one shell command.
 */
export function branchProbeCommand(layout: GitWorkspaceLayout): string {
  return gitCommand('-C', layout.cacheDir, 'show-ref', '--verify', '--quiet', layout.branchRef)
}

/**
 * Build the command that creates the bare cache and drops dead worktrees.
 *
 * `git init --bare` on an existing cache is a no-op, which is what makes this
 * safe to replay; `worktree prune` forgets registrations whose directory is
 * gone, so a worktree a person deleted by hand can be re-attached instead of
 * refused as "already registered".
 * @param layout - the run's paths.
 * @returns one shell command.
 */
export function prepareCacheCommand(layout: GitWorkspaceLayout): string {
  return [
    shellEnsureDir(layout.reposDir),
    gitCommand('init', '--bare', '--quiet', layout.cacheDir),
    gitCommand('-C', layout.cacheDir, 'worktree', 'prune'),
  ].join(' && ')
}

/**
 * Build the command that fetches a url source's branches into the cache.
 * @param layout - the run's paths.
 * @param url - clone URL the host can reach.
 * @returns one shell command.
 */
export function fetchUrlCommand(layout: GitWorkspaceLayout, url: string): string {
  return gitCommand(
    '-C',
    layout.cacheDir,
    'fetch',
    '--no-tags',
    url,
    `+refs/heads/*:${REMOTE_REF_NAMESPACE}*`,
    `+HEAD:${REMOTE_HEAD_REF}`,
  )
}

/**
 * Build the command that fetches an uploaded bundle into the cache.
 *
 * A bundle of a working-tree snapshot can only name the commit HEAD points at,
 * so the snapshot's own commit arrives as an object and is pinned to its ref by
 * {@link pinBaseCommand} on the next step.
 * @param layout - the run's paths.
 * @param bundlePath - absolute remote path of the uploaded bundle.
 * @returns one shell command.
 */
export function fetchBundleCommand(layout: GitWorkspaceLayout, bundlePath: string): string {
  return gitCommand('-C', layout.cacheDir, 'fetch', '--no-tags', bundlePath, `+HEAD:${layout.baseRef}`)
}

/**
 * Build the command that pins the commit a run branch starts from.
 * @param layout - the run's paths.
 * @param commit - object name to pin.
 * @returns one shell command.
 */
export function pinBaseCommand(layout: GitWorkspaceLayout, commit: string): string {
  return gitCommand('-C', layout.cacheDir, 'update-ref', layout.baseRef, commit)
}

/**
 * Build the command that creates a run's worktree on a new branch.
 * @param layout - the run's paths.
 * @param startRef - ref or commit the branch starts from.
 * @returns one shell command.
 */
export function addWorktreeCommand(layout: GitWorkspaceLayout, startRef: string): string {
  const add = gitCommand(
    '-C',
    layout.cacheDir,
    'worktree',
    'add',
    '-q',
    '-b',
    layout.branch,
    layout.worktreeDir,
    startRef,
  )
  return `${shellEnsureDir(layout.workspacesDir)} && ${add}`
}

/**
 * Build the command that re-attaches a run's worktree to its existing branch.
 * @param layout - the run's paths.
 * @returns one shell command.
 */
export function attachWorktreeCommand(layout: GitWorkspaceLayout): string {
  const add = gitCommand('-C', layout.cacheDir, 'worktree', 'add', '-q', layout.worktreeDir, layout.branch)
  return `${shellEnsureDir(layout.workspacesDir)} && ${add}`
}

/**
 * Build the command that counts the commits a run branch carries past its base.
 * @param layout - the run's paths.
 * @returns one shell command that prints one integer.
 */
export function countRunCommitsCommand(layout: GitWorkspaceLayout): string {
  return gitCommand('-C', layout.cacheDir, 'rev-list', '--count', `${layout.baseRef}..${layout.branchRef}`)
}

/**
 * Build the command that pushes a run branch to a url source's repository.
 * @param layout - the run's paths.
 * @param url - clone URL the host can reach.
 * @returns one shell command.
 */
export function pushBranchCommand(layout: GitWorkspaceLayout, url: string): string {
  return gitCommand('-C', layout.cacheDir, 'push', url, `${layout.branchRef}:${layout.branchRef}`)
}

/**
 * Build the command that bundles a run branch without its base.
 *
 * The base commit is the local repository's own HEAD or its working-tree
 * snapshot, so leaving it out keeps the download to the commits the run made.
 * @param layout - the run's paths.
 * @param bundlePath - absolute remote path to write.
 * @returns one shell command.
 */
export function bundleResultCommand(layout: GitWorkspaceLayout, bundlePath: string): string {
  return gitCommand(
    '-C',
    layout.cacheDir,
    'bundle',
    'create',
    '--quiet',
    bundlePath,
    layout.branchRef,
    '--not',
    layout.baseRef,
  )
}
